# M+ Szimulátor (Android)

Mythic+ csapat-szimulátor: Raider.io karakterek + MDT route + kulcsszint → becsült idő, időbe érés esélye, javasolt kulcsszint, képesség-audit.

**Letöltés (mindig a legfrissebb):** https://github.com/9hm2/MPlusSim/releases/latest/download/MPlusSim.apk

## Funkciók
- **Csapat**: karakterkeresés név alapján (mint az armory keresőben), régióválasztás, spec/szerep felülírás, ügyesség és komfortszint; csapat betöltése egy Raider.io futás linkjéből; csapatok mentése.
- **Route-ok**: MDT export (`!~MDT2~…`) importálása, dungeononként több route; mind a 16 Midnight dungeon MDT-adata beépítve.
- **Szimuláció**: kulcsszint-tartomány, timer, heti affix, kalibrálás egy valódi futásra; Monte Carlo emberi tényezővel (mechanika, mozgás, halál, wipe, napi forma); pullonkénti bontás.
- **Audit**: kick / stun / CC / dispel / purge / soothe / bres / lust lefedettség; pullonkénti kick-igény; CC-érzékenység; túlélési táblázat (jelenleg Temple of Sethraliss).

## Modell
- DPS: SimulationCraft (MID1/MID2 profilok) 32 specre, 280–340 ilvl, 1 és 5 célpont → `www/data/dps_table.json`; a karakter ilvl-jére interpolálva, felszereltségi (hiányzó enchant, tier) és ügyességi szorzóval.
- Mob életerő és skálázás: Mythic Dungeon Tools adatai és képlete (1.07/szint +10-ig, utána 1.10; +10-től Fortified és Tyrannical).
- Emberi tényező: becsült paraméterek (`www/engine.js` → `MODEL`). Kalibrálással a csapat valódi idejéhez igazítható.

## Fordítás
GitHub Actions (`.github/workflows/android.yml`): Capacitor 8, JDK 21 → debug APK, Release-be töltve.

## Térképek
A pull-tervező dungeon-térképei a [Mythic Dungeon Tools](https://github.com/Nnoggie/MythicDungeonTools) (GPL-2.0) csempéiből vannak összefűzve.
