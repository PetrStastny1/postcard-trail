# Co se změnilo
Oblast logic přidává čistá deterministická pravidla hry a verzované uložení. Nepoužívá DOM, skutečný čas ani náhodu, čas v ms, náhodu a ID dostává zvenku.

- `src/game/logic/choiceOrder.ts`: pořadí voleb (Fisher–Yates s předanou náhodou, lexikografické permutace 0–23, pevné pořadí B09).
- `src/game/logic/run.ts`: průchod jako reducer (odpočet, hranice času, kola, 50:50, +10 s, nečasovaný režim, pauza, přeskočení za video s ID pokusu, obnova).
- `src/game/logic/progress.ts`: hvězdy, odemykání odvozené z katalogu, pohlednice, součty, idempotentní slučování.
- `src/game/logic/daily.ts`: výběr verze katalogu, rozvrh, FNV-1a, start denního průchodu, výsledky, série dnů.
- `src/game/storage/`: uložení po oddílech nad `KeyValueStore` (schéma v1, validace po oddílech, ochrana novější verze, slučování odměn mezi kartami, vlastnictví průchodu, paměťová náhrada s jedním upozorněním).

Přesné podpisy pro oblast app jsou v `docs/specs/logic/spec.md`, sekce Rozhraní pro app.

(Zprávu napsal projektový manažer oblasti, ředitel ji uložil.)

# Akceptační kritéria
| Kritérium | Jak ověřeno | Výsledek |
|---|---|---|
| K2: timeout, hranice odpočtu, dvojklik, skóre, série, restart, kombinace žolíků, nečasovaný režim | `run.test.ts`, QA 1–8 | splněno |
| K2: stavy z tabulky §3 | `run.test.ts`, `daily.test.ts`, `gameStorage.test.ts`, QA 8–11, 23, 29–36 | splněno |
| K2: řízená náhoda, permutace, zachování po obnově a v jiném jazyce, FNV-1a, pevné B09 | `choiceOrder.test.ts`, `run.test.ts`, `daily.test.ts`, mutace | splněno |
| K2: nulové skóre dokončí trasu, odemkne právě další město, dá právě jednu kartu | `progress.test.ts`, `gameStorage.test.ts`, QA 16 | splněno |
| K2: obnovení, opakování a ukončení po posledním kliknutí neduplikují odměnu | `progress.test.ts`, `gameStorage.test.ts` | splněno |
| §7: hvězdy, opakování nesníží, součty 3 × počet měst | `progress.test.ts`, QA 17 | splněno |
| K4: 20 měst za 20 dní, 8 začátků za 160 dní, katalogy 30/40/47 | `daily.test.ts`, QA 19 | splněno |
| K4: UTC nezávisle na pásmu | `daily.test.ts` (TZ +14, −11), QA ve 4 pásmech | splněno |
| K4: zamčená města, půlnoc, aktualizace katalogu, nový katalog ve stanovený den, před první verzí nic | `daily.test.ts`, `gameStorage.test.ts`, QA 21–23 | splněno |
| K4: denní výsledek nemění sbírku ani hvězdy, jeden na datum, série dnů | `daily.test.ts`, `gameStorage.test.ts`, QA 24 | splněno |
| K5 logická část: přeskočení jen po `completed` se správným ID, nejvýš jednou, série a skóre zachované | `run.test.ts`, `daily.test.ts`, QA 25–28 | splněno |
| §12: verzované oddíly, novější verze se nepřepíše, slučování odměn, první denní výsledek zůstává | `gameStorage.test.ts`, QA 29–32 | splněno |
| §12: průchod vlastní poslední karta, která ho obnovila | `gameStorage.test.ts`, QA 33–34 | splněno (události prohlížeče napojí app) |
| Bez DOM, `Date.now`, `Math.random` a úložiště mimo `KeyValueStore` | zdrojové testy, QA 39, kontrola ředitele | splněno |
| lint, typecheck, test, build, test:e2e | na 8ac09ab (PM i ředitel) | splněno |

# Kontroly
- lint, typecheck, test (241), build, test:e2e: prošly na 8ac09ab.
- Review balíčků (run, progress, daily, storage): blocker s typecheckem testů vyřešil ředitel v dff6ba1, minor opraveny, jeden zamítnutý (obranná kontrola `route.id === plan.cityId`).
- Review oblasti: 3 kola, blocker (chyběl test nezávislosti na jazyce) opraven, minor opraveny.
- QA oblasti: 3 kola (39, 27 a 25 scénářů), mutační testy, fuzz 360 000 stavů bez odmítnutí. Jeden minor zůstává otevřený.
- Vizuální kontrola a druhý názor (Codex): netýká se.

# Databáze
Beze změny. Lokální uložení má schéma v1 pod klíči `settings`, `progress`, `daily-results`, `active-run`, prefix přidává adaptér.

# Nové závislosti
Žádné.

# Co ověřeno není
- Napojení na prohlížeč (skutečný čas, `visibilitychange`, `storage` ve dvou kartách, plná kvóta `localStorage`). Patří oblasti app.
- Testy neběží proti skutečnému `catalog.json` a trase Budapešti s B09, ty vznikají v oblasti content.
- E2E obsahuje jen smoke test.

# Rozhodnutí bez Petra
Nic k potvrzení Petrem. Rozhodnutí arbitra jsou v `docs/decisions/LOG.md`:
- Pevné pořadí B09 řeší konstanta v `choiceOrder.ts`.
- Přeskočení za video od 3. zastávky průchodu, v denní výzvě jen u 3. otázky.
- Oddíl s novější verzí schématu se nepoužije ani nepřepíše, hra běží v paměti s upozorněním.
- Při selhání zápisu odměn zůstává hotový průchod uložený a nabízí se znovu. Jak ho nabídnout, rozhodne app.

# Otevřené body mimo rozsah
- Pro app: dokončení uloženého průchodu ve fázi `summary` po obnovení, vlastnictví přes událost `storage` a `ownsActiveRun(event.newValue, tabId)` (klíč s prefixem `postcard-trail:active-run`), `elapsedMs` z monotónních hodin, `emptyProgress` a `emptyDailyResults` neměnit na místě, `question_resolved.index` je `stopIndex + 1`.
- Test K2 nezachytí řazení podle délky popisku, protože fixtury mají stejně dlouhé popisky (kód popisky nečte).
- `createRun({ stops: [] })` skončí `TypeError`, vstup mimo podmínky volajícího.
