/* M+ Szimulátor – számolómotor (böngészőben és Node-ban is fut)
 * MDT route dekódolás, Raider.io karakter -> modell, pullonkénti harcidő,
 * emberi tényező Monte Carlo, képesség-audit.  Minden becsült paraméter a MODEL-ben.
 */
(function (G) {
  'use strict';
  const pako = G.pako || (typeof require !== 'undefined' ? require('pako') : null);

  const MODEL = {
    scalingNormal: 1.07, scalingExtra: 1.10, extraFrom: 11,
    fortHp: 1.20, tyrHp: 1.25, fortDmg: 1.20, tyrDmg: 1.15, lindormiHp: 0.95, lindormiDmg: 0.95,
    deathPenalty: 15, deathPenaltyLow: 5, chest2: 0.80, chest3: 0.60,
    bargainOverhead: 0.04,            // +5..+11 Xal'atath's Bargain (pl. Voidbound Emissary) többletideje
    extraPullChance: 0.08, extraPullSize: [0.3, 0.6],  // véletlen extra pull (patrol / ráhúzás) trash pullonként
    walkTrash: 10, walkBoss: 15,
    downtimeTrash: [0.03, 0.10], downtimeBoss: [0.10, 0.25],
    deathRateTrash: 0.04, deathRateBoss: 0.10, deathGrowth: 0.35,
    wipeMid: 3.0, wipeSlope: 1.1, wipeMaxTrash: 0.10, wipeMaxBoss: 0.35, wipeRunback: 45, maxWipes: 4,
    ilvlPerKey: 3.0, ilvlRefKey: 10, ilvlRef: 305, ilvlRisk: 0.04,
    healerDpsShare: 0.30, augShare: 0.60,
    dayFormCv: 0.06, pullCv: 0.05,
    lustBonus: 0.25, lustDur: 40,
    skillA: 0.55, skillB: 8000, skillMin: 0.50, skillMax: 0.97, scorePerLevel: 33,
    personalDef: 0.30, armorK: 3430, dmgScale: 1.0,
  };
  const KNOWN_TIMERS = { 20: 1921, 17: 1980 };

  // ---------------------------------------------------------------- CBOR
  function utf8(u) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(u);
    let s = ''; for (let i = 0; i < u.length; i++) s += '%' + u[i].toString(16).padStart(2, '0');
    try { return decodeURIComponent(s); } catch (e) { return String.fromCharCode.apply(null, u); }
  }
  function cborDecode(b) {
    let p = 0;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const half = h => { const e = (h >> 10) & 31, f = h & 1023, s = h >> 15 ? -1 : 1;
      return e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); };
    function arg(ai) {
      if (ai < 24) return ai;
      if (ai === 24) return b[p++];
      if (ai === 25) { const v = dv.getUint16(p); p += 2; return v; }
      if (ai === 26) { const v = dv.getUint32(p); p += 4; return v; }
      if (ai === 27) { const v = Number(dv.getBigUint64(p)); p += 8; return v; }
      if (ai === 31) return null;
      throw new Error('CBOR');
    }
    function item() {
      const ib = b[p++], mt = ib >> 5, ai = ib & 31;
      if (mt === 7) {
        if (ai === 20) return false; if (ai === 21) return true; if (ai === 22 || ai === 23) return null;
        if (ai === 25) { const v = half(dv.getUint16(p)); p += 2; return v; }
        if (ai === 26) { const v = dv.getFloat32(p); p += 4; return v; }
        if (ai === 27) { const v = dv.getFloat64(p); p += 8; return v; }
        return null;
      }
      const n = arg(ai);
      if (mt === 0) return n;
      if (mt === 1) return -1 - n;
      if (mt === 2 || mt === 3) {
        if (n === null) { let s = ''; while (b[p] !== 0xff) s += item(); p++; return s; }
        const s = utf8(b.subarray(p, p + n)); p += n; return s;
      }
      if (mt === 4) {
        const a = [];
        if (n === null) { while (b[p] !== 0xff) a.push(item()); p++; } else for (let i = 0; i < n; i++) a.push(item());
        return a;
      }
      if (mt === 5) {
        const o = {}; let c = 0;
        while (n === null ? b[p] !== 0xff : c < n) { const k = item(); o[String(k)] = item(); c++; }
        if (n === null) p++;
        return o;
      }
      if (mt === 6) return item();
      throw new Error('CBOR');
    }
    return item();
  }

  function b64ToBytes(s) {
    if (typeof atob === 'function') { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  function decodeRoute(str) {
    str = (str || '').trim();
    if (!str.startsWith('!~MDT2~')) throw new Error('Csak !~MDT2~ kezdetű MDT export támogatott.');
    const raw = b64ToBytes(str.slice(7).replace(/\s+/g, ''));
    return cborDecode(pako.inflateRaw(raw));
  }

  const vals = o => Array.isArray(o) ? o : Object.values(o || {});

  // Esemény-/díszletmobok kezelése: 0 count, nem boss, de óriási HP (pl. Murder Row "Infernal" 203M).
  //  > 2.5× a legnagyobb boss → kihagyjuk;  > 2× a legnagyobb trash, de bossnyi → bossként kezeljük.
  function sanitize(d) {
    if (d._san) return d;
    const E = Object.values(d.enemies);
    const mx = Math.max(1, ...E.filter(e => !e.b && e.c > 0).map(e => e.h)), mb = Math.max(1, ...E.filter(e => e.b).map(e => e.h));
    d.skipped = [];
    for (const e of E) if (!e.b && e.c === 0 && e.h > 2 * mx) {
      if (e.h > 2.5 * mb) { e.skip = true; d.skipped.push(e.n); } else e.b = 1;
    }
    d._san = true;
    return d;
  }

  function buildPulls(route, dungeon) {
    sanitize(dungeon);
    const E = dungeon.enemies, notes = [], used = new Set();
    for (const o of route.objects || []) {
      const d = o && o.d;
      if (d && d.length >= 5 && typeof d[4] === 'string' && /lust|bl\b|hero/i.test(d[4])) notes.push([+d[0], +d[1], +(d[2] || 1)]);
    }
    const pulls = [];
    for (const pl of vals(route.value.pulls)) {
      const mobs = [], pts = [];
      for (const [k, cl] of Object.entries(pl)) {
        if (k === 'color' || !E[k]) continue;
        for (const c of vals(cl)) {
          used.add(k + ':' + Math.round(c));
          if (E[k].skip) continue;
          mobs.push(E[k]);
          const pos = E[k].cl[String(Math.round(c))];
          if (pos) pts.push(pos);
        }
      }
      if (!mobs.length) continue;
      const cx = pts.length ? pts.reduce((a, q) => a + q[0], 0) / pts.length : 0;
      const cy = pts.length ? pts.reduce((a, q) => a + q[1], 0) / pts.length : 0;
      pulls.push({ mobs, boss: mobs.some(m => m.b), count: mobs.reduce((a, m) => a + m.c, 0), c: [cx, cy, pts[0] ? pts[0][2] : 1], lust: false });
    }
    for (const [nx, ny, ns] of notes) {
      let best = 0, bd = Infinity;
      pulls.forEach((q, i) => { const d = (q.c[2] !== ns ? 1e9 : 0) + (q.c[0] - nx) ** 2 + (q.c[1] - ny) ** 2; if (d < bd) { bd = d; best = i; } });
      if (pulls[best]) pulls[best].lust = true;
    }
    if (pulls.length && !pulls.some(q => q.lust)) { pulls[0].lust = true; }
    // hiányzó count pótlása: a fel nem használt trashből a legjobb count/HP arányú mobok egy extra pullban
    const have = pulls.reduce((a, q) => a + q.count, 0), need = (dungeon.total || 0) - have;
    if (need > 0) {
      const cand = [];
      for (const [k, e] of Object.entries(E)) if (!e.b && e.c > 0 && e.h > 0)
        for (const ci of Object.keys(e.cl)) if (!used.has(k + ':' + ci)) cand.push(e);
      cand.sort((a, b) => b.c / b.h - a.c / a.h);
      const mobs = []; let got = 0;
      for (const e of cand) { if (got >= need) break; mobs.push(e); got += e.c; }
      if (mobs.length) pulls.push({ mobs, boss: false, count: got, c: [0, 0, 1], lust: false, extra: true });
    }
    return pulls;
  }

  // ---------------------------------------------------------------- skálázás
  function keyScale(L) {
    return MODEL.scalingNormal ** Math.min(L - 1, MODEL.extraFrom - 2) * MODEL.scalingExtra ** Math.max(0, L - MODEL.extraFrom + 1);
  }
  function hpMult(L, boss, week) {
    let s = keyScale(L);
    if (L >= 10) s *= boss ? MODEL.tyrHp : MODEL.fortHp;
    else if (L >= 7) {
      if (week === 'tyrannical') s *= boss ? MODEL.tyrHp : 1;
      else if (week === 'fortified') s *= boss ? 1 : MODEL.fortHp;
      else s *= boss ? (1 + MODEL.tyrHp) / 2 : (1 + MODEL.fortHp) / 2;
    }
    if (L <= 5 && !boss) s *= MODEL.lindormiHp;
    return s;
  }
  function dmgMult(L, boss) {
    let s = keyScale(L);
    if (L >= 10) s *= boss ? MODEL.tyrDmg : MODEL.fortDmg;
    if (L <= 5 && !boss) s *= MODEL.lindormiDmg;
    return s * MODEL.dmgScale;
  }

  // ---------------------------------------------------------------- csapattag
  const ENCHANT_SLOTS = ['head', 'shoulder', 'chest', 'legs', 'feet', 'finger1', 'finger2', 'mainhand'];
  function memberFromRio(d, ov) {
    ov = ov || {};
    const m = {
      name: d.name, realm: d.realm, region: d.region, cls: d.class, spec: ov.spec || d.active_spec_name,
      role: ov.role || ({ HEALING: 'healer', TANK: 'tank' }[d.active_spec_role] || 'dps'),
      race: d.race, ilvl: +(d.gear && d.gear.item_level_equipped) || 0, score: 0, comfort: null,
      talents: null, missingEnchants: [], tier: 0, gearQ: 0.8, skill: null, thumb: d.thumbnail_url,
    };
    const sc = d.mythic_plus_scores_by_season;
    if (sc && sc[0]) m.score = +(sc[0].scores && sc[0].scores.all) || 0;
    const best = (d.mythic_plus_best_runs || []).filter(r => r.num_keystone_upgrades > 0).map(r => r.mythic_level).sort((a, b) => b - a);
    if (best.length) { const t = best.slice(0, 4); m.comfort = t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2; }
    const lo = ov.loadout || (d.talentLoadout && d.talentLoadout.loadout);
    if (lo && lo.length) {
      m.talents = [];
      for (const n of lo) { try { if (n.rank > 0) { const e = n.node.entries[n.entryIndex || 0]; if (e.spell) m.talents.push(e.spell.name); } } catch (e) { } }
    }
    const items = (d.gear && d.gear.items) || {};
    for (const s of ENCHANT_SLOTS) {
      const it = items[s];
      if (it && !(it.enchant || (it.enchants && it.enchants.length))) m.missingEnchants.push(s);
    }
    m.tier = Object.values(items).filter(it => it && it.tier).length;
    if (m.role !== 'healer') {
      let q = 0.82 - 0.012 * m.missingEnchants.length - (m.tier < 2 ? 0.03 : 0) - (m.tier < 4 ? 0.03 : 0);
      m.gearQ = Math.max(0.62, Math.min(0.92, q));
    }
    return m;
  }
  function finishMember(m) {
    if (m.skill == null) m.skill = m.score > 0 ? Math.max(MODEL.skillMin, Math.min(MODEL.skillMax, MODEL.skillA + m.score / MODEL.skillB)) : 0.75;
    if (m.comfort == null) m.comfort = m.score > 0 ? (m.score / 8) / MODEL.scorePerLevel : 8;
    return m;
  }

  // ---------------------------------------------------------------- DPS modell
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0] + (ys[1] - ys[0]) * (x - xs[0]) / (xs[1] - xs[0]);
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    const n = xs.length - 1; return ys[n] + (ys[n] - ys[n - 1]) * (x - xs[n]) / (xs[n] - xs[n - 1]);
  }
  function memberDps(m, table) {
    if (m.role === 'healer') return null;
    let key = m.cls + '|' + m.spec, f = 1;
    if (m.spec === 'Augmentation') { key = 'Evoker|Devastation'; f = MODEL.augShare; }
    const t = table[key];
    if (!t) return null;
    const k = f * m.gearQ * (1 - (1 - m.skill) * 0.5);
    return { st: interp(t.il, t.st, m.ilvl) * k, aoe: interp(t.il, t.aoe, m.ilvl) * k };
  }
  function teamDps(members, table) {
    const ds = members.map(m => memberDps(m, table));
    const dpsOnly = ds.filter((d, i) => d && members[i].role === 'dps');
    const avgSt = dpsOnly.length ? dpsOnly.reduce((a, d) => a + d.st, 0) / dpsOnly.length : 100000;
    const avgAoe = dpsOnly.length ? dpsOnly.reduce((a, d) => a + d.aoe, 0) / dpsOnly.length : 250000;
    let st = 0, aoe = 0;
    members.forEach((m, i) => {
      const d = ds[i] || (m.role === 'healer' ? { st: avgSt * MODEL.healerDpsShare, aoe: avgAoe * MODEL.healerDpsShare } : { st: avgSt * 0.6, aoe: avgAoe * 0.6 });
      m.estDps = d;
      st += d.st; aoe += d.aoe;
    });
    return { st, aoe };
  }
  // csapat összes sebzése n célpontra (az AoE-tábla 5 célpontra szól)
  const totalAt = (T, n) => n <= 1 ? T.st : T.st + (T.aoe - T.st) * Math.min(n - 1, 4) / 4 * (n > 5 ? 1 + 0.05 * Math.min(n - 5, 5) : 1);

  // egy pull harcideje: a csapat egyenletesen üt, a legkevesebb HP-s mob hal meg előbb
  function pullTime(pull, L, week, T) {
    let hp = pull.mobs.map(m => m.h * hpMult(L, !!m.b, week)).filter(h => h > 0).sort((a, b) => a - b);
    let t = 0, lustLeft = pull.lust ? MODEL.lustDur : 0;
    while (hp.length) {
      const n = hp.length;
      let rate = totalAt(T, n) / n;
      const boost = lustLeft > 0 ? 1 + MODEL.lustBonus : 1;
      let dt = hp[0] / (rate * boost);
      if (lustLeft > 0 && dt > lustLeft) {   // lust lejár közben
        const done = rate * boost * lustLeft;
        hp = hp.map(h => h - done); t += lustLeft; lustLeft = 0; continue;
      }
      const dmg = rate * boost * dt;
      hp = hp.map(h => h - dmg).filter(h => h > 1);
      t += dt; lustLeft = Math.max(0, lustLeft - dt);
    }
    return t;
  }

  // ---------------------------------------------------------------- Monte Carlo
  function rngFactory(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function normal(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const logistic = x => 1 / (1 + Math.exp(-x));

  function teamFactors(members, L) {
    const w = m => (m.role === 'tank' || m.role === 'healer') ? 1.5 : 1;
    const W = members.reduce((a, m) => a + w(m), 0);
    const skill = members.reduce((a, m) => a + m.skill * w(m), 0) / W;
    const comfort = members.reduce((a, m) => a + m.comfort * w(m), 0) / W;
    const want = MODEL.ilvlRef + (L - MODEL.ilvlRefKey) * MODEL.ilvlPerKey;
    let risk = 1;
    for (const m of members) if (m.ilvl) risk *= Math.exp(w(m) * 1.33 * MODEL.ilvlRisk * Math.max(0, want - m.ilvl) / members.length);
    return { skill, comfort, risk };
  }

  function monteCarlo(L, base, pulls, members, timer, eff, runs, seed) {
    const r = rngFactory(seed || 1), M = MODEL;
    const { skill, comfort, risk } = teamFactors(members, L);
    const d = L - comfort, sloppy = 1.3 - skill, nDps = Math.max(1, members.filter(m => m.role !== 'healer').length);
    const pen = L <= 5 ? 0 : L < 12 ? M.deathPenaltyLow : M.deathPenalty;   // Lindormi: nincs; +12-től Guile: 15 mp
    const bargain = L >= 5 && L <= 11 ? 1 + M.bargainOverhead : 1;
    const pExtra = Math.min(0.5, M.extraPullChance * sloppy / 0.4);
    const res = [];
    for (let k = 0; k < runs; k++) {
      let t = 0, deaths = 0, wipes = 0, dep = false, extras = 0;
      const form = Math.exp(normal(r) * M.dayFormCv * sloppy / 0.4);
      pulls.forEach((p, i) => {
        let b = base[i] * eff * form * bargain * Math.exp(normal(r) * M.pullCv);
        if (!p.boss && r() < pExtra) { extras++; b *= 1 + M.extraPullSize[0] + r() * (M.extraPullSize[1] - M.extraPullSize[0]); }
        if (i) t += (p.boss ? M.walkBoss : M.walkTrash) * (1 + 0.6 * (1 - skill));
        const [lo, hi] = p.boss ? M.downtimeBoss : M.downtimeTrash;
        const rate = p.boss ? M.deathRateBoss : M.deathRateTrash;
        const pw = Math.min(0.9, (p.boss ? M.wipeMaxBoss : M.wipeMaxTrash) * logistic(M.wipeSlope * (d - M.wipeMid)) * risk * sloppy / 0.4);
        let tries = 0, dur;
        for (;;) {
          tries++;
          dur = b * (1 + (lo + r() * (hi - lo)) * sloppy / 0.4);
          if (r() < pw && tries <= M.maxWipes) { wipes++; t += dur * (0.3 + 0.6 * r()) + M.wipeRunback; continue; }
          break;
        }
        if (tries > M.maxWipes) dep = true;
        const lam = rate * Math.exp(M.deathGrowth * d) * risk * sloppy / 0.4;
        let kd = 0, Lm = Math.exp(-lam), pr = 1;
        for (;;) { pr *= r(); if (pr < Lm) break; kd++; }
        for (let j = 0; j < kd; j++) { deaths++; t += pen; dur *= 1 + (1 / nDps) * (0.1 + 0.5 * r()); }
        t += dur;
      });
      res.push([t, deaths, wipes, dep, extras]);
    }
    const ts = res.map(x => x[0]).sort((a, b) => a - b), q = f => ts[Math.min(ts.length - 1, Math.floor(f * ts.length))];
    const frac = f => res.filter(f).length / runs, mean = i => res.reduce((a, x) => a + x[i], 0) / runs;
    return { level: L, median: q(0.5), p10: q(0.1), p90: q(0.9),
      pTime: frac(x => x[0] <= timer && !x[3]), p2: frac(x => x[0] <= timer * M.chest2), p3: frac(x => x[0] <= timer * M.chest3),
      deaths: mean(1), wipes: mean(2), extras: mean(4), comfort, skill };
  }

  function simulate(opts) {
    const { members, pulls, levels, week, timer, table, calib, runs } = opts;
    members.forEach(finishMember);
    const T = teamDps(members, table);
    const baseAt = L => pulls.map(p => pullTime(p, L, week, T));
    let eff = 1;
    if (calib && calib.level && calib.time) {
      const b0 = baseAt(calib.level);
      let lo = 0.4, hi = 3;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; const r = monteCarlo(calib.level, b0, pulls, members, timer, mid, 400, 7); if (r.median < calib.time) lo = mid; else hi = mid; }
      eff = (lo + hi) / 2;
    }
    const rows = levels.map(L => Object.assign(monteCarlo(L, baseAt(L), pulls, members, timer, eff, runs || 2000, L * 97), { pulls: baseAt(L) }));
    const top = th => { const ok = rows.filter(x => x.pTime >= th); return ok.length ? ok[ok.length - 1].level : null; };
    return { rows, eff, team: T, safe: top(0.85), rec: top(0.6), push: top(0.3) };
  }

  // ---------------------------------------------------------------- audit
  const DISPEL = ['magic', 'curse', 'poison', 'disease', 'bleed'];
  const CC_MAP = { stun: 'Stun', stun_aoe: 'Stun', incap: 'Incapacitate', incap_aoe: 'Incapacitate', disorient: 'Disorient', disorient_aoe: 'Disorient',
    fear_aoe: 'Disorient', knock_aoe: 'Knock', root_aoe: 'Root', grip: 'Grip', grip_aoe: 'Grip', silence_aoe: 'Silence' };
  const kitKey = c => (c || '').toLowerCase().replace(/\s+/g, '');
  const specKey = s => (s || '').toLowerCase().replace(/\s+/g, '_');

  function resolveKit(m, kits) {
    const out = [];
    for (const k of kits[kitKey(m.cls)] || []) {
      if (k.specs && m.spec && !k.specs.includes(specKey(m.spec))) continue;
      if (k.talent) {
        if (!m.talents) out.push(Object.assign({}, k, { unsure: true }));
        else if (m.talents.includes(k.talent)) out.push(k);
        continue;
      }
      out.push(k);
    }
    return out;
  }

  function memberHp(m) {
    // HP ~ ilvl alapján (SimC-ből illesztve: 306 ilvl ~ 690k, ~1.37%/ilvl); tankok +12%
    const hp = 690000 * 1.0137 ** ((m.ilvl || 306) - 306) * (m.role === 'tank' ? 1.12 : 1);
    const plate = ['Warrior', 'Paladin', 'Death Knight'].includes(m.cls), mail = ['Hunter', 'Shaman', 'Evoker'].includes(m.cls),
      leather = ['Rogue', 'Druid', 'Monk', 'Demon Hunter'].includes(m.cls);
    let armor = plate ? 3600 : mail ? 2900 : leather ? 1000 : 1300;
    if (m.role === 'tank') armor *= 2.0;
    return { hp, armor, vers: 0.05 };
  }

  function audit(members, dungeon, didx, kits, spellDb, pulls, levels) {
    members.forEach(finishMember);
    const kit = {};
    members.forEach(m => { kit[m.name] = resolveKit(m, kits); });
    const has = pred => members.flatMap(m => kit[m.name].filter(pred).map(k => ({ who: m.name, k })));
    const kicks = has(k => k.t === 'kick');
    const kickCap = kicks.reduce((a, x) => a + 15 / x.k.cd, 0);
    const tools = {
      kick: kicks, stun: has(k => k.t === 'stun' || k.t === 'stun_aoe'),
      cc: has(k => CC_MAP[k.t] && !k.t.startsWith('stun')), purge: has(k => k.t === 'purge'),
      soothe: has(k => k.t === 'soothe' || k.soothe), bres: has(k => k.t === 'bres'), lust: has(k => k.t === 'lust'),
      dispel: Object.fromEntries(DISPEL.map(t => [t, has(k => (k.t === 'dispel' || k.t === 'dispel_aoe') && (k.types || []).includes(t))])),
    };
    const db = spellDb[String(didx)];
    const needs = [], gaps = new Set();
    const seen = new Set();
    for (const e of Object.values(dungeon.enemies)) {
      for (const [sid, flags] of Object.entries(e.sp)) {
        const key = e.n + sid; if (seen.has(key)) continue; seen.add(key);
        const sname = db && db.spells[sid] ? db.spells[sid].name : ('#' + sid);
        const buff = db && db.spells[sid] && db.spells[sid].cat === 'buff_purge';
        if (flags.includes('interruptible')) needs.push({ mob: e.n, spell: sname, need: 'kick', who: tools.kick });
        for (const t of DISPEL) if (flags.includes(t)) {
          const w = buff ? tools.purge : tools.dispel[t];
          needs.push({ mob: e.n, spell: sname, need: buff ? 'purge' : 'dispel:' + t, who: w });
        }
        if (flags.includes('enrage')) needs.push({ mob: e.n, spell: sname, need: 'soothe', who: tools.soothe });
      }
    }
    needs.forEach(n => { if (!n.who.length) gaps.add(n.mob + ' – ' + n.spell + ': ' + n.need); });
    const teamCc = [...new Set(members.flatMap(m => kit[m.name].filter(k => CC_MAP[k.t]).map(k => CC_MAP[k.t])))].sort();
    const ccTable = Object.values(dungeon.enemies).filter(e => !e.b).map(e => ({ mob: e.n, cc: teamCc.map(c => e.cc.includes(c)) }));
    const pullKicks = (pulls || []).map((p, i) => {
      const casters = p.mobs.filter(m => Object.values(m.sp).some(f => f.includes('interruptible')));
      const stun = casters.filter(m => m.cc.includes('Stun')).length;
      const n = casters.length;
      return n ? { pull: i + 1, n, stun, names: [...new Set(casters.map(c => c.n))], verdict: n <= kickCap * 0.8 ? 'ok' : n <= kickCap * 1.3 ? 'tight' : 'over' } : null;
    }).filter(Boolean);
    // sebzés
    let dmg = null;
    if (db) {
      members.forEach(m => { m.def = memberHp(m); });
      const tank = members.find(m => m.role === 'tank');
      const squish = members.filter(m => m.role !== 'tank').sort((a, b) => a.def.hp - b.def.hp)[0] || members[0];
      const bossOf = {}, owner = {};
      for (const e of Object.values(db.mobs)) for (const s of Object.keys(e.spells)) { bossOf[s] = bossOf[s] || e.boss; owner[s] = owner[s] || e.n || ''; }
      for (const [n, e] of Object.entries(db.mobs)) for (const s of Object.keys(e.spells)) if (!owner[s]) owner[s] = n;
      const rows = [], keys = new Set();
      for (const [sid, sp] of Object.entries(db.spells)) {
        if (!['tank', 'nuke', 'dot', 'group', 'avoid', 'soak'].includes(sp.cat)) continue;
        let raw = sp.cat === 'dot' ? sp.hit + sp.dot : sp.cat === 'soak' ? sp.hit / members.length : sp.hit;
        if (!raw) continue;
        const tgt = sp.cat === 'tank' ? tank : squish; if (!tgt) continue;
        const k = sp.name + '|' + owner[sid]; if (keys.has(k)) continue; keys.add(k);
        const v = levels.map(L => {
          let x = raw * dmgMult(L, !!bossOf[sid]) * (1 - tgt.def.vers);
          if (sp.school === 'phys') x *= 1 - tgt.def.armor / (tgt.def.armor + MODEL.armorK);
          return x / tgt.def.hp;
        });
        rows.push({ cat: sp.cat, name: sp.name, src: owner[sid], tgt: tgt.name, v, dot: sp.dot });
      }
      dmg = rows;
    }
    return { tools, kickCap, needs, gaps: [...gaps].sort(), teamCc, ccTable, pullKicks, dmg, kit };
  }


  // ================================================================ ELŐZMÉNY-ALAPÚ KALIBRÁLÁS
  // Modell futásonként:  T = A_d + C × exp(β + átlag u_játékos)
  //   C   = harcidő egy referencia-route-on (minden boss + a count eléréséhez legolcsóbb trash-csomagok),
  //         a futás csapatának DPS-ével (spec + futás kori ilvl), az adott kulcsszinten
  //   A_d = dungeon fix ideje (séta, RP, mechanika)        – dungeononként illesztve, priorral
  //   u   = játékos-hatékonyság (log), 0 = átlagos         – ridge-regresszió, sok futásból
  //   maradék: log(T / T_pred) = γ·nyomás + ε             – nyomás = kulcs − a csapat legjobb időben futott kulcsa
  function refPulls(dungeon) {
    sanitize(dungeon);
    const E = dungeon.enemies, packs = {}, bosses = {};
    for (const [k, e] of Object.entries(E)) {
      if (e.skip) continue;
      for (const ci of Object.keys(e.cl)) {
        const g = e.g && e.g[ci];
        if (e.b) { (bosses[g != null ? 'g' + g : k] = bosses[g != null ? 'g' + g : k] || []).push(e); continue; }
        const key = g != null ? 'g' + g : k + ':' + ci;
        (packs[key] = packs[key] || []).push(e);
      }
    }
    const pulls = [];
    for (const mobs of Object.values(bosses)) pulls.push({ mobs, boss: true, count: mobs.reduce((a, m) => a + m.c, 0), lust: false });
    const list = Object.values(packs).map(mobs => ({ mobs, boss: false, count: mobs.reduce((a, m) => a + m.c, 0), hp: mobs.reduce((a, m) => a + m.h, 0), lust: false }))
      .filter(p => p.count > 0).sort((a, b) => b.count / b.hp - a.count / a.hp);
    let got = pulls.reduce((a, p) => a + p.count, 0);
    for (const p of list) { if (got >= dungeon.total) break; pulls.push(p); got += p.count; }
    if (pulls.length) pulls[0].lust = true;
    const bi = pulls.findIndex(p => p.boss); if (bi >= 0) pulls[bi].lust = true;
    return pulls;
  }

  function memberFromRoster(r) {
    const c = r.character || r;
    const d = { name: c.name, class: c.class && (c.class.name || c.class), active_spec_name: c.spec && c.spec.name,
      active_spec_role: ({ healer: 'HEALING', tank: 'TANK' })[r.role || (c.spec && c.spec.role)] || 'DPS',
      gear: r.items || c.items || { item_level_equipped: 0, items: {} } };
    const m = memberFromRio(d);
    m.key = ((c.region && c.region.slug || '') + '/' + (c.realm && c.realm.slug || '') + '/' + c.name).toLowerCase();
    m.skill = 1; m.comfort = 10;
    return m;
  }

  function combatTime(pulls, L, members, table, week) {
    const T = teamDps(members, table);
    return pulls.reduce((a, p) => a + pullTime(p, L, week, T), 0);
  }

  function weekOf(affixes) {
    const n = (affixes || []).map(a => a.name || a);
    const f = n.indexOf('Fortified'), t = n.indexOf('Tyrannical');
    return f < 0 && t < 0 ? null : f < 0 ? 'tyrannical' : t < 0 ? 'fortified' : (t < f ? 'tyrannical' : 'fortified');
  }

  // runs: [{id, mapId, level, time, timer, upgrades, affixes, roster:[raider.io roster entries]}]
  // Takarékos modell (kevés futásra is stabil):
  //   log T = log( a·timer_d·e^{α_d} + C·e^{β} ) + δ·(L − 10) + átlag_5fő(u) + ε
  //   a   – közös fix-idő arány (séta, RP, mechanika)          prior 0.35 ± 0.15
  //   α_d – dungeononkénti kis eltérés                          prior 0 ± 0.15
  //   β   – harcidő-szorzó (modell vs. valóság)                 prior 0 ± 0.5
  //   δ   – kulcsszintenkénti lassulás (halál, óvatosság)       prior 0 ± 0.05
  //   u   – csak a csapattagoké egyéni (prior 0 ± 0.2), minden más játékos közös μ
  function fitHistory(runs, dungeons, table, opt) {
    opt = Object.assign({ iters: 60 }, opt || {});
    const byMap = {}; for (const [idx, d] of Object.entries(dungeons)) if (d.mapID) byMap[d.mapID] = idx;
    const focus = (opt.focus || []).map(k => k.toLowerCase());
    const refCache = {}, obs = [];
    for (const r of runs) {
      const idx = byMap[r.mapId]; if (!idx || !r.roster || r.roster.length < 3) continue;
      refCache[idx] = refCache[idx] || refPulls(dungeons[idx]);
      const mem = r.roster.map(memberFromRoster);
      const C = combatTime(refCache[idx], r.level, mem, table, weekOf(r.affixes));
      if (!(C > 0) || !(r.time > 0)) continue;
      const fi = mem.map(m => focus.indexOf(m.key)).filter(i => i >= 0);
      obs.push({ r, idx, C, T: r.time, lT: Math.log(r.time), timer: r.timer, level: r.level, fi, nOther: mem.length - fi.length, n: mem.length });
    }
    if (obs.length < 3) return { ok: false, n: obs.length, reason: 'Kevés használható futás (legalább 3 kell).' };
    const Dg = [...new Set(obs.map(o => o.idx))];
    const th = { a: 0.35, beta: 0, delta: 0, mu: 0, mu1: 0, alpha: Object.fromEntries(Dg.map(d => [d, 0])), u: focus.map(() => 0) };
    const pred = (o, t = th) => Math.log(t.a * o.timer * Math.exp(t.alpha[o.idx]) + o.C * Math.exp(t.beta + t.delta * (o.level - 10)))
      + (o.fi.reduce((s2, i) => s2 + t.u[i], 0) + o.nOther * (t.mu + t.mu1 * (o.level - 10))) / o.n;
    let sigma = 0.12;
    const J = () => obs.reduce((s2, o) => s2 + (o.lT - pred(o)) ** 2, 0) / (sigma * sigma)
      + ((th.a - 0.35) / 0.15) ** 2 + (th.beta / 0.5) ** 2 + (th.delta / 0.05) ** 2
      + Object.values(th.alpha).reduce((s2, x) => s2 + (x / 0.15) ** 2, 0) + th.u.reduce((s2, x) => s2 + (x / 0.2) ** 2, 0) + (th.mu / 0.3) ** 2 + (th.mu1 / 0.05) ** 2;
    const golden = (get, set, lo, hi) => { for (let g = 0; g < 40; g++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      set(m1); const f1 = J(); set(m2); const f2 = J(); if (f1 < f2) hi = m2; else lo = m1; } set((lo + hi) / 2); };
    for (let it = 0; it < opt.iters; it++) {
      golden(() => th.a, v => { th.a = v; }, 0.05, 0.8);
      golden(() => th.beta, v => { th.beta = v; }, -1.5, 1.5);
      golden(() => th.delta, v => { th.delta = v; }, 0, 0.2);
      golden(() => th.mu, v => { th.mu = v; }, -1, 1);
      golden(() => th.mu1, v => { th.mu1 = v; }, -0.15, 0);
      for (const d of Dg) golden(() => th.alpha[d], v => { th.alpha[d] = v; }, -0.6, 0.6);
      for (let i = 0; i < th.u.length; i++) golden(() => th.u[i], v => { th.u[i] = v; }, -1, 1);
      const rs = obs.map(o => o.lT - pred(o));
      sigma = Math.max(0.04, Math.sqrt(rs.reduce((s2, x) => s2 + x * x, 0) / Math.max(1, obs.length - 4)));
    }
    const rs = obs.map(o => o.lT - pred(o)), mean = rs.reduce((s2, x) => s2 + x, 0) / rs.length;
    const mae = obs.reduce((s2, o) => s2 + Math.abs(o.T - Math.exp(pred(o))), 0) / obs.length;
    const comfortOf = {};
    obs.forEach(o => { if (o.r.upgrades > 0) o.r.roster.map(memberFromRoster).forEach(m => { comfortOf[m.key] = Math.max(comfortOf[m.key] || 0, o.level); }); });
    const playerEff = {}; focus.forEach((k, i) => { playerEff[k] = { u: th.u[i], n: obs.filter(o => o.fi.includes(i)).length }; });
    const A = {}, timerOf = {}; Dg.forEach(d => { const o = obs.find(x => x.idx === d); timerOf[d] = o.timer; A[d] = th.a * o.timer * Math.exp(th.alpha[d]); });
    const together = obs.filter(o => o.fi.length >= Math.min(5, focus.length) && focus.length).length;
    return { ok: true, v: 6, n: obs.length, th, a: th.a, beta: th.beta, delta: th.delta, mu: th.mu, mu1: th.mu1, sigma, A, timerOf, playerEff, comfortOf, mae, together,
      resid: rs.map(x => x - mean), focus,
      runs: obs.map(o => ({ dungeon: dungeons[o.idx].name, level: o.level, T: o.T, pred: Math.exp(pred(o)), timed: o.r.upgrades > 0 })) };
  }

  function simulateHistory(opts) {
    const { model, members, pulls, idx, levels, week, timer, table, runs } = opts;
    members.forEach(finishMember);
    const mem = members.map(m => Object.assign({}, m, { skill: 1 }));
    const keys = members.map(m => (m.key || '').toLowerCase());
    const known = keys.filter(k => model.playerEff[k]).length;
    const muL = L => model.mu + (model.mu1 || 0) * (L - 10);                  // PUG-átlag az adott kulcsszinten
    const uTeamL = L => keys.reduce((a, k) => a + (model.playerEff[k] ? model.playerEff[k].u : muL(L)), 0) / keys.length;
    const uTeam = uTeamL(10);
    const alpha = model.th.alpha[idx] != null ? model.th.alpha[idx] : 0;
    const A = model.a * timer * Math.exp(alpha);
    const cs = keys.map((k, i) => model.comfortOf[k] || members[i].comfort).sort((a, b) => a - b);
    const comfort = cs[Math.floor(cs.length / 2)];
    const res = model.resid && model.resid.length ? model.resid : [0];
    const extraSd = (5 - known) * 0.02 + (model.th.alpha[idx] == null ? 0.06 : 0);
    const r = rngFactory(11);
    const T0 = teamDps(mem, table);
    members.forEach((m, i) => { m.estDps = mem[i].estDps; });
    const Cm = Math.exp(model.beta);
    const rows = levels.map(L => {
      const C = pulls.reduce((a, p) => a + pullTime(p, L, week, T0), 0);
      const pred = (A + C * Cm * Math.exp(model.delta * (L - 10))) * Math.exp(uTeamL(L));   // a szintfüggő lassulás csak a harcot érinti, a fix idő (séta, RP) nem rövidül
      const beyond = Math.max(0, L - comfort - 1);            // a csapat által már időben lefutott szint fölött
      const ts = [], N = runs || 3000; let dep = 0;
      for (let i = 0; i < N; i++) {
        const e = res[Math.floor(r() * res.length)] + normal(r) * extraSd;
        let t = pred * Math.exp(0.04 * beyond * beyond + e);
        if (r() < Math.min(0.6, 0.04 * beyond * beyond)) { dep++; t = Infinity; }   // feladott kulcs (a Raider.io nem mutatja)
        ts.push(t);
      }
      const fin = ts.filter(isFinite).sort((a, b) => a - b), q = f => fin.length ? fin[Math.min(fin.length - 1, Math.floor(f * fin.length))] : Infinity;
      return { level: L, median: q(0.5), p10: q(0.1), p90: q(0.9), pTime: ts.filter(t => t <= timer).length / N,
        p2: ts.filter(t => t <= timer * MODEL.chest2).length / N, p3: ts.filter(t => t <= timer * MODEL.chest3).length / N,
        deaths: NaN, extras: NaN, abandon: dep / N, pulls: pulls.map(p => pullTime(p, L, week, T0) * Cm * Math.exp(model.delta * (L - 10) + uTeamL(L))), fixed: A };
    });
    const top = th => { const ok = rows.filter(x => x.pTime >= th); return ok.length ? ok[ok.length - 1].level : null; };
    return { rows, eff: Math.exp(uTeam), cmult: Cm, team: T0, safe: top(0.85), rec: top(0.6), push: top(0.3), history: true, known, comfort,
      A: A * Math.exp(uTeam), vsPug: Math.exp(uTeam - model.mu), mu1: model.mu1 || 0 };
  }

  G.Engine = { MODEL, KNOWN_TIMERS, decodeRoute, buildPulls, memberFromRio, finishMember, simulate, audit, hpMult, keyScale, teamDps, pullTime, refPulls, fitHistory, simulateHistory, memberFromRoster, weekOf };
  if (typeof module !== 'undefined') module.exports = G.Engine;
})(typeof window !== 'undefined' ? window : globalThis);
