/* M+ Szimulátor – felület */
{
  const E = window.Engine;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const parseT = s => { const m = /^(\d+):(\d{1,2})$/.exec((s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
  const pct = v => `${Math.round(v * 100)}%`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mps_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mps_' + k, JSON.stringify(v)); } catch (e) { } },
  };
  const CLASS_COLOR = { 'Death Knight': '#C41E3A', 'Demon Hunter': '#A330C9', Druid: '#FF7C0A', Evoker: '#33937F', Hunter: '#AAD372', Mage: '#3FC7EB',
    Monk: '#00FF98', Paladin: '#F48CBA', Priest: '#FFFFFF', Rogue: '#FFF468', Shaman: '#0070DD', Warlock: '#8788EE', Warrior: '#C69B6D' };
  const SPECS = { 'Death Knight': ['Blood', 'Frost', 'Unholy'], 'Demon Hunter': ['Havoc', 'Vengeance', 'Devourer'], Druid: ['Balance', 'Feral', 'Guardian', 'Restoration'],
    Evoker: ['Devastation', 'Preservation', 'Augmentation'], Hunter: ['Beast Mastery', 'Marksmanship', 'Survival'], Mage: ['Arcane', 'Fire', 'Frost'],
    Monk: ['Brewmaster', 'Mistweaver', 'Windwalker'], Paladin: ['Holy', 'Protection', 'Retribution'], Priest: ['Discipline', 'Holy', 'Shadow'],
    Rogue: ['Assassination', 'Outlaw', 'Subtlety'], Shaman: ['Elemental', 'Enhancement', 'Restoration'], Warlock: ['Affliction', 'Demonology', 'Destruction'],
    Warrior: ['Arms', 'Fury', 'Protection'] };
  const TANKS = ['Blood', 'Vengeance', 'Guardian', 'Brewmaster'], HEALS = ['Restoration', 'Preservation', 'Mistweaver', 'Discipline'];
  const roleOf = (cls, spec) => TANKS.includes(spec) || (spec === 'Protection') ? 'tank' : HEALS.includes(spec) || (spec === 'Holy') ? 'healer' : 'dps';
  const ROLE_HU = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };

  let DATA = {};
  const alertBox = t => { $('#hdr').textContent = t; };
  let team = store.get('team', [null, null, null, null, null]);
  let routes = store.get('routes', []);
  let timers = store.get('timers', {});

  // ------------------------------------------------ hálózat
  async function getJson(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const RIO = 'https://raider.io';
  const profileUrl = (region, realm, name) => `${RIO}/api/v1/characters/profile?region=${encodeURIComponent(region)}&realm=${encodeURIComponent(realm)}&name=${encodeURIComponent(name)}&fields=gear,talents,mythic_plus_scores_by_season:current,mythic_plus_best_runs`;

  async function loadChar(region, realm, name, ov) {
    const d = await getJson(profileUrl(region, realm, name));
    const m = E.memberFromRio(d, ov);
    m.region = region; m.realmSlug = realm; m.crawled = d.last_crawled_at || null; m.key = `${region}/${realm}/${d.name}`;
    if (ov && ov.loadout) m.loadout = ov.loadout;
    m.autoSkill = null;
    return m;
  }

  // ------------------------------------------------ nézetek
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + b.dataset.v));
    if (b.dataset.v === 'sim' || b.dataset.v === 'audit') fillRouteSelects();
    window.scrollTo(0, 0);
  }));

  // ------------------------------------------------ CSAPAT
  function saveTeam() { store.set('team', team); }
  function renderSlots() {
    const box = $('#slots');
    box.innerHTML = team.map((m, i) => m ? memberCard(m, i) : emptySlot(i)).join('');
    team.forEach((m, i) => m ? bindMember(i) : bindEmpty(i));
    $('#hdr').textContent = team.filter(Boolean).length + '/5 csapattag · ' + routes.length + ' route';
  }
  function emptySlot(i) {
    return `<div class="card" id="slot${i}"><label for="q${i}">${i + 1}. csapattag – név</label>
      <input id="q${i}" placeholder="Karakter neve" autocomplete="off" autocapitalize="off">
      <div id="r${i}"></div></div>`;
  }
  function memberCard(m, i) {
    E.finishMember(m);
    const col = CLASS_COLOR[m.cls] || '#ccc';
    const specOpts = (SPECS[m.cls] || [m.spec]).map(s => `<option ${s === m.spec ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const ench = m.role === 'healer' ? '' : (m.missingEnchants.length ? `<span class="warn">${m.missingEnchants.length} enchant hiányzik</span>` : '<span class="ok">enchantok rendben</span>');
    return `<div class="card" id="slot${i}">
      <div class="slot"><div class="ava" style="color:${col};border:1px solid ${col}">${esc((m.name || '?')[0])}</div>
        <div><div class="nm" style="color:${col}">${esc(m.name)}</div>
          <div class="sub">${esc(m.realm || m.realmSlug || '')} · ${esc(m.spec)} ${esc(m.cls)} · ${Math.round(m.ilvl)} ilvl · ${Math.round(m.score)} score</div></div>
        <div><button class="link" data-ref="${i}" aria-label="Frissítés">⟳</button><button class="link" data-del="${i}" aria-label="Eltávolítás">✕</button></div></div>
      <div class="grid2" style="margin-top:6px">
        <div><label for="sp${i}">Spec</label><select id="sp${i}">${specOpts}</select></div>
        <div><label for="ro${i}">Szerep</label><select id="ro${i}">${['dps', 'tank', 'healer'].map(r => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLE_HU[r]}</option>`).join('')}</select></div>
        <div><label for="sk${i}">Ügyesség: <b id="skv${i}">${Math.round(m.skill * 100)}</b></label><input id="sk${i}" type="range" min="50" max="97" value="${Math.round(m.skill * 100)}"></div>
        <div><label for="cf${i}">Komfort kulcs</label><input id="cf${i}" type="number" inputmode="decimal" value="${(+m.comfort).toFixed(1)}"></div>
      </div>
      <p class="sub" style="margin:8px 0 0">${m.specFrom === 'run' ? 'Spec: a futásból' : m.specFrom === 'manual' ? 'Spec: kézzel állítva' : 'Spec: aktuális (Raider.io)'}${m.crawled ? ' · frissítve ' + esc(new Date(m.crawled).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}<br>Tier: ${m.tier} db · ${ench}${m.role !== 'healer' ? ` · felszereltség ${Math.round(m.gearQ * 100)}%` : ''}${m.talents ? '' : ' · talentek: ismeretlen'}</p>
    </div>`;
  }
  function bindMember(i) {
    const m = team[i];
    $(`[data-del="${i}"]`).onclick = () => { team[i] = null; saveTeam(); renderSlots(); };
    $(`[data-ref="${i}"]`).onclick = async e => {
      e.target.textContent = '…';
      try {
        const keep = m.specFrom === 'manual' || m.specFrom === 'run' ? { spec: m.spec, role: m.role, loadout: m.loadout } : null;
        const n = await loadChar(m.region, m.realmSlug, m.name, keep);
        n.specFrom = m.specFrom; n.skill = m.skillManual ? m.skill : null; n.skillManual = m.skillManual;
        team[i] = n; saveTeam(); renderSlots();
      } catch (err) { e.target.textContent = '⟳'; alertBox(`Frissítési hiba: ${err.message}`); }
    };
    $(`#sp${i}`).onchange = e => { m.spec = e.target.value; m.role = roleOf(m.cls, m.spec); m.talents = null; m.specFrom = 'manual'; saveTeam(); renderSlots(); };
    $(`#ro${i}`).onchange = e => { m.role = e.target.value; saveTeam(); };
    $(`#sk${i}`).oninput = e => { m.skill = +e.target.value / 100; m.skillManual = true; $(`#skv${i}`).textContent = e.target.value; saveTeam(); };
    $(`#cf${i}`).onchange = e => { m.comfort = +e.target.value || m.comfort; saveTeam(); };
  }
  function bindEmpty(i) {
    const inp = $(`#q${i}`), out = $(`#r${i}`);
    let tmr = null, seq = 0;
    inp.addEventListener('input', () => {
      clearTimeout(tmr);
      const q = inp.value.trim();
      if (q.length < 2) { out.innerHTML = ''; return; }
      tmr = setTimeout(async () => {
        const my = ++seq;
        out.innerHTML = '<p class="note"><span class="spin"></span> Keresés…</p>';
        try {
          const d = await getJson(`${RIO}/api/search?term=${encodeURIComponent(q)}`);
          if (my !== seq) return;
          const reg = $('#region').value;
          const list = (d.matches || []).filter(x => x.type === 'character').map(x => x.data)
            .sort((a, b) => (b.region.slug === reg) - (a.region.slug === reg)).slice(0, 12);
          if (!list.length) { out.innerHTML = '<p class="note">Nincs találat. Írd be pontosan a nevet.</p>'; return; }
          out.innerHTML = '<ul class="res">' + list.map((c, j) => `<li data-j="${j}"><span><b style="color:${CLASS_COLOR[c.class.name] || '#ccc'}">${esc(c.name)}</b> <span class="sub">${esc(c.realm.name)}</span></span><span class="sub">${esc(c.region.slug.toUpperCase())} · ${esc(c.class.name)}</span></li>`).join('') + '</ul>';
          out.querySelectorAll('li').forEach(li => li.onclick = async () => {
            const c = list[+li.dataset.j];
            out.innerHTML = '<p class="note"><span class="spin"></span> Betöltés…</p>';
            try { team[i] = await loadChar(c.region.slug, c.realm.slug, c.name); saveTeam(); renderSlots(); }
            catch (e) { out.innerHTML = `<p class="err">Nem sikerült betölteni: ${esc(e.message)}</p>`; }
          });
        } catch (e) { if (my === seq) out.innerHTML = `<p class="err">Keresési hiba: ${esc(e.message)}. Van internet?</p>`; }
      }, 350);
    });
  }
  $('#btnFromRun').onclick = () => { const b = $('#runBox'); b.hidden = !b.hidden; };
  $('#btnRunLoad').onclick = async () => {
    const url = $('#runUrl').value.trim(), m = /mythic-plus-runs\/([^/]+)\/(\d+)/.exec(url);
    const box = $('#runBox');
    if (!m) { box.insertAdjacentHTML('beforeend', '<p class="err">Ez nem Raider.io futás-link.</p>'); return; }
    $('#btnRunLoad').disabled = true;
    try {
      const rd = await getJson(`${RIO}/api/v1/mythic-plus/run-details?season=${m[1]}&id=${m[2]}`);
      const out = [];
      for (const r of rd.roster.slice(0, 5)) {
        const c = r.character, tl = c.talentLoadout || {};
        const lm = await loadChar(c.region.slug, c.realm.slug, c.name, { spec: c.spec.name, role: r.role || c.spec.role, loadout: tl.loadout });
        lm.specFrom = 'run'; out.push(lm);
      }
      out.sort((a, b) => ({ tank: 0, healer: 1, dps: 2 }[a.role] - { tank: 0, healer: 1, dps: 2 }[b.role]));
      team = [0, 1, 2, 3, 4].map(i => out[i] || null);
      saveTeam(); renderSlots(); box.hidden = true;
      // kalibrálás előtöltése
      store.set('lastRun', { idx: rd.dungeon.map_challenge_mode_id, name: rd.dungeon.name, level: rd.mythic_level, time: Math.round(rd.clear_time_ms / 1000), timer: Math.round(rd.keystone_time_ms / 1000) });
      timers[rd.dungeon.name] = Math.round(rd.keystone_time_ms / 1000); store.set('timers', timers);
    } catch (e) { box.insertAdjacentHTML('beforeend', `<p class="err">Hiba: ${esc(e.message)}</p>`); }
    $('#btnRunLoad').disabled = false;
  };
  function renderTeamSel() {
    const saved = store.get('teams', {});
    $('#teamSel').innerHTML = '<option value="">– válassz –</option>' + Object.keys(saved).map(n => `<option>${esc(n)}</option>`).join('');
  }
  $('#teamSel').onchange = e => { const saved = store.get('teams', {}); if (saved[e.target.value]) { team = saved[e.target.value]; saveTeam(); renderSlots(); } };
  $('#btnSaveTeam').onclick = () => {
    const names = team.filter(Boolean).map(m => m.name);
    if (!names.length) return;
    const saved = store.get('teams', {}); saved[names.join(', ')] = team; store.set('teams', saved); renderTeamSel();
    $('#btnSaveTeam').textContent = 'Mentve ✓'; setTimeout(() => $('#btnSaveTeam').textContent = 'Csapat mentése', 1500);
  };

  // ------------------------------------------------ ROUTE-OK
  $('#btnImport').onclick = () => {
    const msg = $('#impMsg');
    try {
      const str = $('#mdtIn').value;
      const r = E.decodeRoute(str);
      const idx = r.value.currentDungeonIdx, d = DATA.dungeons[idx];
      if (!d) throw new Error(`Ismeretlen dungeon (MDT index ${idx}). Csak a Midnight dungeonjai támogatottak.`);
      const pulls = E.buildPulls(r, d);
      const name = $('#routeName').value.trim() || r.text || 'Route';
      routes.push({ id: Date.now(), name, idx, dungeon: d.name, str, pulls: pulls.length, count: pulls.reduce((a, p) => a + p.count, 0), total: d.total });
      store.set('routes', routes);
      $('#mdtIn').value = ''; $('#routeName').value = '';
      msg.innerHTML = `<p class="ok">Importálva: ${esc(d.name)} – ${esc(name)} (${pulls.length} pull)</p>` + (d.skipped && d.skipped.length ? `<p class="note">Kihagyva mint eseménymob (nem kell megölni): ${esc(d.skipped.join(', '))}</p>` : '');
      renderRoutes();
    } catch (e) { msg.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  function renderRoutes() {
    const by = {};
    routes.forEach(r => (by[r.dungeon] = by[r.dungeon] || []).push(r));
    $('#routeList').innerHTML = Object.keys(by).sort().map(dn => `<h3>${esc(dn)}</h3>` + by[dn].map(r => {
      const short = r.count < r.total;
      return `<div class="card"><div class="row"><div class="grow"><div class="nm">${esc(r.name)}</div>
        <div class="sub">${r.pulls} pull · <span class="${short ? 'bad' : 'ok'}">${r.count}/${r.total} count</span></div></div>
        <button class="link" data-rdel="${r.id}">Törlés</button></div></div>`;
    }).join('')).join('') || '<p class="note">Még nincs route. Az MDT-ben: route → Export, majd ide beillesztve.</p>';
    document.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { routes = routes.filter(r => r.id !== +b.dataset.rdel); store.set('routes', routes); renderRoutes(); });
    $('#hdr').textContent = team.filter(Boolean).length + '/5 csapattag · ' + routes.length + ' route';
  }
  function fillRouteSelects() {
    const opts = routes.map(r => `<option value="${r.id}">${esc(r.dungeon)} – ${esc(r.name)}</option>`).join('') || '<option value="">Nincs route</option>';
    for (const id of ['#simRoute', '#audRoute']) { const v = $(id).value; $(id).innerHTML = opts; if (v) $(id).value = v; }
    syncTimer();
  }
  function syncTimer() {
    const r = routes.find(x => x.id === +$('#simRoute').value);
    if (!r) return;
    const t = timers[r.dungeon] || E.KNOWN_TIMERS[r.idx];
    $('#timer').value = t ? fmtT(t) : '';
    const lr = store.get('lastRun', null);
    if (lr && lr.name && lr.name.replace(/'/g, '') === r.dungeon.replace(/'/g, '') && !$('#calL').value) { $('#calL').value = lr.level; $('#calT').value = fmtT(lr.time); }
  }
  $('#simRoute').onchange = syncTimer;

  function getRouteObjs(id) {
    const r = routes.find(x => x.id === +id);
    if (!r) throw new Error('Válassz route-ot (Route-ok fül).');
    const d = DATA.dungeons[r.idx];
    return { r, d, pulls: E.buildPulls(E.decodeRoute(r.str), d) };
  }
  function getTeam() {
    const t = team.filter(Boolean);
    if (!t.length) throw new Error('Adj hozzá csapattagokat (Csapat fül).');
    return JSON.parse(JSON.stringify(t));
  }

  // ------------------------------------------------ SZIMULÁCIÓ
  $('#btnSim').onclick = () => {
    const out = $('#simOut');
    try {
      const { r, d, pulls } = getRouteObjs($('#simRoute').value);
      const members = getTeam();
      const timer = parseT($('#timer').value);
      if (!timer) throw new Error('Add meg a dungeon timerét (pp:mm). Egy Raider.io futás betöltése kitölti.');
      timers[r.dungeon] = timer; store.set('timers', timers);
      let a = Math.max(2, +$('#kFrom').value || 2), b = Math.min(30, +$('#kTo').value || 16);
      if (b < a) [a, b] = [b, a];
      const levels = []; for (let L = a; L <= b; L++) levels.push(L);
      E.MODEL.healerDpsShare = (+$('#pHeal').value || 30) / 100;
      E.MODEL.deathPenalty = +$('#pDeath').value || 15;
      E.MODEL.walkTrash = +$('#pWalk').value || 10; E.MODEL.walkBoss = E.MODEL.walkTrash * 1.5;
      E.MODEL.extraPullChance = Math.max(0, +$('#pExtra').value || 0) / 100;
      E.MODEL.bargainOverhead = Math.max(0, +$('#pBarg').value || 0) / 100;
      const calT = parseT($('#calT').value), calL = +$('#calL').value;
      out.innerHTML = '<p class="note"><span class="spin"></span> Számolás…</p>';
      const mode = $('#mode').value;
      let hm = store.get('histModels', {})[teamKey()]; if (hm && hm.v !== 4) hm = null;
      if (mode === 'hist' && !hm) throw new Error('Előbb töltsd be az előzményeket (Előzmények betöltése és illesztése), vagy válassz másik kalibrálást.');
      members.forEach(m => { m.key = (m.key || `${m.region}/${m.realmSlug}/${m.name}`).toLowerCase(); });
      setTimeout(() => {
        if (mode === 'hist') {
          const res = E.simulateHistory({ model: hm, members, pulls, idx: r.idx, levels, week: $('#week').value || null, timer, table: DATA.dps, runs: Math.min(5000, +$('#pRuns').value || 1500) });
          renderSim(res, members, pulls, timer, r, d, true);
          return;
        }
        const res = E.simulate({ members, pulls, levels, week: $('#week').value || null, timer, table: DATA.dps,
          calib: mode === 'one' && calT && calL ? { level: calL, time: calT } : null, runs: Math.min(5000, +$('#pRuns').value || 1500) });
        renderSim(res, members, pulls, timer, r, d, !!(calT && calL));
      }, 30);
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  function renderSim(res, members, pulls, timer, r, d, cal) {
    const chip = (t, v) => `<span class="chip">${t}: <b>${v ? '+' + v : '–'}</b></span>`;
    const col = v => v >= 0.85 ? 'var(--ok)' : v >= 0.6 ? 'var(--warn)' : v >= 0.3 ? '#e8884a' : 'var(--bad)';
    let h = `<div class="card"><div class="chips">${chip('Biztos (≥85%)', res.safe)}${chip('Javasolt (≥60%)', res.rec)}${chip('Próbálkozás (≥30%)', res.push)}</div>
      <p class="note" style="margin:8px 0 0">${esc(d.name)} · timer ${fmtT(timer)} · ${res.history ? `előzmény-modell: fix idő ${fmtT(res.A)}, a csapat ${res.vsPug <= 1 ? Math.round((1 / res.vsPug - 1) * 100) + '%-kal gyorsabb' : Math.round((res.vsPug - 1) * 100) + '%-kal lassabb'} egy PUG-nál, ${res.known}/${members.length} tag ismert, komfort +${res.comfort}` : cal ? `egy futásra kalibrálva (×${res.eff.toFixed(2)})` : 'nincs kalibrálva – becsült hatékonyság'}</p></div>`;
    h += `<div class="scroll"><table><thead><tr><th>Kulcs</th><th>Medián</th><th>10–90%</th><th>Időben</th><th>+2</th><th>+3</th>${res.history ? '<th>Feladás</th>' : '<th>Halál</th><th>Extra pull</th>'}</tr></thead><tbody>` +
      res.rows.map(x => `<tr data-lv="${x.level}"><td><b>+${x.level}</b></td><td>${fmtT(x.median)}</td><td>${fmtT(x.p10)}–${fmtT(x.p90)}</td>
        <td><span style="color:${col(x.pTime)}">${pct(x.pTime)}</span><div class="bar"><i style="width:${x.pTime * 100}%;background:${col(x.pTime)}"></i></div></td>
        <td>${pct(x.p2)}</td><td>${pct(x.p3)}</td>${res.history ? `<td>${pct(x.abandon)}</td>` : `<td>${x.deaths.toFixed(1)}</td><td>${x.extras.toFixed(1)}</td>`}</tr>`).join('') + '</tbody></table></div>';
    h += `<p class="note">Koppints egy sorra a pullonkénti bontásért.</p><div id="pullBox"></div>`;
    h += `<h3>Csapat becsült sebzése</h3><div class="scroll"><table><thead><tr><th>Tag</th><th>1 célpont</th><th>5 célpont</th></tr></thead><tbody>` +
      members.map(m => `<tr><td style="color:${CLASS_COLOR[m.cls] || '#ccc'}">${esc(m.name)} <span class="sub">${esc(m.spec)}</span></td><td>${Math.round(m.estDps.st / 1000)}k</td><td>${Math.round(m.estDps.aoe / 1000)}k</td></tr>`).join('') +
      `<tr><td><b>Összesen</b></td><td><b>${Math.round(res.team.st / 1000)}k</b></td><td><b>${Math.round(res.team.aoe / 1000)}k</b></td></tr></tbody></table></div>
      <p class="note">SimC-táblából (spec + ilvl), a felszereltséggel és az ügyességgel szorozva. A healer sebzése becsült.</p>`;
    $('#simOut').innerHTML = h;
    $('#simOut').querySelectorAll('tr[data-lv]').forEach(tr => tr.onclick = () => {
      const x = res.rows.find(q => q.level === +tr.dataset.lv);
      $('#pullBox').innerHTML = `<h3>+${x.level} pullonként (${res.history ? 'harcidő a csapat-szorzóval, fix idő nélkül' : 'tiszta harcidő, kalibrálás és emberi tényező nélkül'})</h3><div class="scroll"><table><thead><tr><th>Pull</th><th class="l">Mobok</th><th>Count</th><th>Idő</th></tr></thead><tbody>` +
        pulls.map((p, i) => `<tr><td>${p.extra ? '＋' : i + 1}${p.lust ? ' ⚡' : ''}</td><td class="l">${esc([...new Set(p.mobs.map(m => m.n))].join(', '))}</td><td>${p.count}</td><td>${fmtT(x.pulls[i])}</td></tr>`).join('') +
        `</tbody></table></div><p class="note">⚡ = lust (az MDT jegyzetből, vagy az első pull). ＋ = a route-ból hiányzó count pótlása (automatikus extra pull).</p>`;
      $('#pullBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ------------------------------------------------ AUDIT
  $('#btnAudit').onclick = () => {
    const out = $('#audOut');
    try {
      const { r, d, pulls } = getRouteObjs($('#audRoute').value);
      const members = getTeam();
      const levels = [2, 5, 8, 10, 12, 14, 16];
      const a = E.audit(members, d, r.idx, DATA.kits, DATA.spells, pulls, levels);
      const who = l => l.length ? l.map(x => `${esc(x.who)}: ${esc(x.k.n)}${x.k.unsure ? ' (?)' : ''}`).join(', ') : '<span class="bad">nincs</span>';
      const HT = { magic: 'Magic', curse: 'Curse', poison: 'Méreg', disease: 'Betegség', bleed: 'Vérzés' };
      let h = `<h3>Eszközök</h3><div class="card"><p><b>Kick</b> (~${a.kickCap.toFixed(1)} / 15 mp): ${who(a.tools.kick)}</p><p><b>Stun</b>: ${who(a.tools.stun)}</p><p><b>Egyéb CC</b>: ${who(a.tools.cc)}</p>` +
        Object.entries(a.tools.dispel).map(([t, l]) => `<p><b>Dispel – ${HT[t]}</b>: ${who(l)}</p>`).join('') +
        `<p><b>Purge</b>: ${who(a.tools.purge)}</p><p><b>Soothe</b>: ${who(a.tools.soothe)}</p><p><b>Bres</b>: ${who(a.tools.bres)}</p><p><b>Lust</b>: ${who(a.tools.lust)}</p>
        <p class="note">(?) = talenthez kötött, a talentlista nem ismert.</p></div>`;
      h += `<h3>Hiányok</h3><div class="card">${a.gaps.length ? '<ul>' + a.gaps.map(g => `<li class="bad">${esc(g)}</li>`).join('') + '</ul>' : '<p class="ok">Minden kick / dispel / purge igény lefedve.</p>'}</div>`;
      if (a.pullKicks.length) {
        const V = { ok: '<span class="ok">rendben</span>', tight: '<span class="warn">szoros – kick-sorrend</span>', over: '<span class="bad">túl sok – stun/CC kell</span>' };
        h += `<h3>Kick-igény pullonként</h3><div class="scroll"><table><thead><tr><th>Pull</th><th class="l">Casterek</th><th>Stunolható</th><th class="l">Megítélés</th></tr></thead><tbody>` +
          a.pullKicks.map(p => `<tr><td>${p.pull}</td><td class="l">${p.n} – ${esc(p.names.join(', '))}</td><td>${p.stun}/${p.n}</td><td class="l">${V[p.verdict]}</td></tr>`).join('') + '</tbody></table></div>';
      }
      h += `<h3>Kickelendő / dispelelendő képességek</h3><div class="scroll"><table><thead><tr><th class="l">Mob</th><th class="l">Képesség</th><th class="l">Teendő</th><th>Ember</th></tr></thead><tbody>` +
        a.needs.map(n => `<tr><td class="l">${esc(n.mob)}</td><td class="l">${esc(n.spell)}</td><td class="l">${esc(n.need.replace('dispel:', 'dispel: '))}</td><td>${n.who.length ? n.who.length : '<span class="bad">0</span>'}</td></tr>`).join('') + '</tbody></table></div>';
      if (a.teamCc.length) {
        h += `<details><summary>CC-érzékenység mobonként</summary><div class="scroll"><table><thead><tr><th class="l">Mob</th>${a.teamCc.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
          a.ccTable.map(x => `<tr><td class="l">${esc(x.mob)}</td>${x.cc.map(v => `<td class="${v ? 'ok' : 'bad'}">${v ? '✓' : '✗'}</td>`).join('')}</tr>`).join('') + '</tbody></table></div></details>';
      }
      if (a.dmg) {
        const CAT = { tank: 'Tankbuster', group: 'Csapat-AoE', soak: 'Soak (szétosztva)', nuke: 'Célzott ütés', dot: 'DoT – ha nem kickelik/dispelik', avoid: 'Elkerülhető (1 találat)' };
        const cell = v => `<td class="${v >= 1 ? 'bad' : v >= 0.8 ? 'warn' : v >= 0.5 ? 'warn' : ''}">${Math.round(v * 100)}%</td>`;
        h += `<h3>Túlélés (a célpont HP-jának %-a)</h3><p class="note">Becsült HP és páncél ilvl alapján, defenzív nélkül. A sebzés Wowhead tooltip-értékekből jön – logból ellenőrizendő.</p>`;
        for (const c of Object.keys(CAT)) {
          const rows = a.dmg.filter(x => x.cat === c).sort((x, y) => y.v[y.v.length - 1] - x.v[x.v.length - 1]);
          if (!rows.length) continue;
          h += `<h3>${CAT[c]}</h3><div class="scroll"><table><thead><tr><th class="l">Képesség</th>${levels.map(L => `<th>+${L}</th>`).join('')}</tr></thead><tbody>` +
            rows.map(x => `<tr><td class="l">${esc(x.name)}<div class="sub">${esc(x.src)} → ${esc(x.tgt)}</div></td>${x.v.map(cell).join('')}</tr>`).join('') + '</tbody></table></div>';
        }
      } else h += `<p class="note">Ehhez a dungeonhoz még nincs sebzés-adatbázis (jelenleg: Temple of Sethraliss). A kick/dispel/CC audit így is működik.</p>`;
      out.innerHTML = h;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };

  // ------------------------------------------------ ELŐZMÉNY-KALIBRÁLÁS
  const teamKey = () => team.filter(Boolean).map(m => (m.key || `${m.region}/${m.realmSlug}/${m.name}`).toLowerCase()).sort().join('|');
  const syncMode = () => { const v = $('#mode').value; $('#histBox').hidden = v !== 'hist'; $('#oneBox').hidden = v !== 'one'; };
  $('#mode').onchange = () => { syncMode(); store.set('mode', $('#mode').value); };
  function slimRoster(rd) {
    return (rd.roster || []).map(r => { const c = r.character || {}, it = (r.items && r.items.items) || {};
      const items = {}; for (const [k, v] of Object.entries(it)) if (v) items[k] = { enchant: v.enchant || (v.enchants && v.enchants[0]) || 0, tier: v.tier || null };
      return { role: r.role, character: { name: c.name, region: { slug: c.region && c.region.slug }, realm: { slug: c.realm && c.realm.slug }, class: { name: c.class && c.class.name }, spec: { name: c.spec && c.spec.name, role: c.spec && c.spec.role } },
        items: { item_level_equipped: r.items ? r.items.item_level_equipped : 0, items } }; });
  }
  async function pool(tasks, n, onDone) {
    let i = 0; const out = [];
    await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; try { out[k] = await tasks[k](); } catch (e) { out[k] = null; } onDone(); } }));
    return out;
  }
  $('#btnHist').onclick = async () => {
    const out = $('#histOut'), btn = $('#btnHist');
    const mem = team.filter(Boolean);
    if (!mem.length) { out.innerHTML = '<p class="err">Előbb adj hozzá csapattagokat.</p>'; return; }
    btn.disabled = true;
    try {
      out.innerHTML = '<p class="note"><span class="spin"></span> Futások listája…</p>';
      const runMap = {};
      for (const m of mem) {
        const d = await getJson(`${RIO}/api/v1/characters/profile?region=${m.region}&realm=${encodeURIComponent(m.realmSlug)}&name=${encodeURIComponent(m.name)}&fields=mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_alternate_runs`);
        for (const r of [].concat(d.mythic_plus_recent_runs || [], d.mythic_plus_best_runs || [], d.mythic_plus_alternate_runs || [])) {
          const se = /mythic-plus-runs\/([^/]+)\//.exec(r.url || ''); if (!se) continue;
          runMap[r.keystone_run_id] = { id: r.keystone_run_id, season: se[1], mapId: r.map_challenge_mode_id, level: r.mythic_level, time: r.clear_time_ms / 1000,
            timer: r.par_time_ms / 1000, upgrades: r.num_keystone_upgrades, affixes: (r.affixes || []).map(a => a.name), dungeon: r.dungeon };
          timers[r.dungeon] = Math.round(r.par_time_ms / 1000);
        }
      }
      store.set('timers', timers);
      const list = Object.values(runMap);
      let done = 0;
      const cache = store.get('runcache', {});
      const tasks = list.map(r => async () => {
        if (cache[r.id]) return cache[r.id];
        const rd = await getJson(`${RIO}/api/v1/mythic-plus/run-details?season=${r.season}&id=${r.id}`);
        return (cache[r.id] = slimRoster(rd));
      });
      const prog = () => { done++; out.innerHTML = `<p class="note"><span class="spin"></span> Futások részletei: ${done}/${list.length}</p>`; };
      const rosters = await pool(tasks, 3, prog);
      store.set('runcache', cache);
      list.forEach((r, k) => { r.roster = rosters[k]; });
      const model = E.fitHistory(list.filter(r => r.roster), DATA.dungeons, DATA.dps, { focus: mem.map(m => (m.key || `${m.region}/${m.realmSlug}/${m.name}`)) });
      if (!model.ok) { out.innerHTML = `<p class="err">${esc(model.reason)}</p>`; btn.disabled = false; return; }
      const saved = store.get('histModels', {}); saved[teamKey()] = Object.assign(model, { at: Date.now() }); store.set('histModels', saved);
      renderHist(model);
    } catch (e) { out.innerHTML = `<p class="err">Hiba: ${esc(e.message)}</p>`; }
    btn.disabled = false;
  };
  function renderHist(m) {
    const mem = team.filter(Boolean);
    const keys = mem.map(x => (x.key || `${x.region}/${x.realmSlug}/${x.name}`).toLowerCase());
    const uT = keys.reduce((a, k) => a + (m.playerEff[k] ? m.playerEff[k].u : (m.mu || 0)), 0) / keys.length;
    const vs = Math.exp(uT - (m.mu || 0));
    let h = `<p class="ok">Illesztve ${m.n} futásból · átlagos eltérés ${fmtT(m.mae)} · szórás ±${Math.round(m.sigma * 100)}%${m.at ? ' · ' + esc(new Date(m.at).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}</p>`;
    h += `<p><b>Ez a csapat ${vs <= 1 ? Math.round((1 / vs - 1) * 100) + '%-kal gyorsabb' : Math.round((vs - 1) * 100) + '%-kal lassabb'}</b> egy átlagos PUG-csapatnál (ugyanazon a kulcson és dungeonban).</p>`;
    h += `<div class="scroll"><table><thead><tr><th class="l">Játékos</th><th>Futás az adatokban</th></tr></thead><tbody>` +
      mem.map((x, i) => { const e = m.playerEff[keys[i]]; return `<tr><td class="l" style="color:${CLASS_COLOR[x.cls] || '#ccc'}">${esc(x.name)}</td><td>${e ? e.n : 0}</td></tr>`; }).join('') + '</tbody></table></div>';
    h += `<p class="note">${m.together} futásban volt együtt a teljes csapat. Egyéni hatékonyságot nem mutatok: aki minden futásban benne van, annak a hatása nem választható szét a többiekétől – a csapat együttes értéke viszont megbízható.</p>`;
    h += `<p class="note">Fix idő ≈ a timer ${Math.round(m.a * 100)}%-a · harcidő-szorzó ×${Math.exp(m.beta).toFixed(2)} · kulcsszintenként ${m.delta >= 0 ? '+' : ''}${(m.delta * 100).toFixed(1)}% idő</p>`;
    h += `<details><summary>Dungeonok fix ideje és a futások</summary><div class="scroll"><table><thead><tr><th class="l">Dungeon</th><th>Fix idő</th></tr></thead><tbody>` +
      Object.entries(m.A).map(([i, a]) => `<tr><td class="l">${esc(DATA.dungeons[i].name)}</td><td>${fmtT(a)}</td></tr>`).join('') + '</tbody></table></div>' +
      `<div class="scroll"><table><thead><tr><th class="l">Futás</th><th>Valódi</th><th>Modell</th></tr></thead><tbody>` +
      m.runs.slice().sort((a, b) => a.dungeon.localeCompare(b.dungeon) || a.level - b.level).map(r => `<tr><td class="l">${esc(r.dungeon)} +${r.level}${r.timed ? '' : ' <span class="bad">✗</span>'}</td><td>${fmtT(r.T)}</td><td>${fmtT(r.pred)}</td></tr>`).join('') +
      '</tbody></table></div></details>';
    $('#histOut').innerHTML = h;
  }

  // heti affixok a Raider.io-ról: a +7-es affix az, amelyik előbb szerepel a listában
  async function loadAffixes() {
    try {
      const d = await getJson(`${RIO}/api/v1/mythic-plus/affixes?region=${$('#region').value}&locale=en`);
      const names = (d.affix_details || []).map(a => a.name);
      const fi = names.indexOf('Fortified'), ti = names.indexOf('Tyrannical');
      const first = fi < 0 ? 'tyrannical' : ti < 0 ? 'fortified' : (ti < fi ? 'tyrannical' : 'fortified');
      if (fi >= 0 || ti >= 0) $('#week').value = first;
      const bargain = names.find(n => n.startsWith("Xal'atath's Bargain")) || '';
      $('#affixNote').textContent = `Ezen a héten (${$('#region').value.toUpperCase()}): ${names.join(', ')}. A +7–9 affix: ${first === 'tyrannical' ? 'Tyrannical' : 'Fortified'}${bargain ? '; +5–11: ' + bargain.replace("Xal'atath's Bargain: ", 'Bargain: ') : ''}.`;
    } catch (e) { $('#affixNote').textContent = 'A heti affixokat nem sikerült lekérni – válaszd ki kézzel.'; }
  }

  // ------------------------------------------------ indulás
  (async () => {
    try {
      const [dungeons, dps, kits, spells] = await Promise.all(['dungeons', 'dps_table', 'class_kits', 'spell_db'].map(n => fetch(`data/${n}.json`).then(r => r.json())));
      DATA = { dungeons, dps, kits, spells };
    } catch (e) { $('#hdr').textContent = 'Adatbetöltési hiba: ' + e.message; }
    $('#region').value = store.get('region', 'eu');
    $('#region').onchange = e => { store.set('region', e.target.value); loadAffixes(); };
    renderTeamSel(); renderSlots(); renderRoutes(); fillRouteSelects();
    loadAffixes();
    $('#mode').value = store.get('mode', 'hist'); syncMode();
    const hm0 = store.get('histModels', {})[teamKey()]; if (hm0 && hm0.v === 4) renderHist(hm0);
  })();
}
