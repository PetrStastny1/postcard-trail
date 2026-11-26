# Postup oblasti logic

Požadavky a scénáře jsou ve [spec.md](spec.md). Vývojář balíčku zaškrtává hotové kroky a doplňuje sekci Rozhraní ve spec.md.

## Balíček 1: Průchod trasou (`run`)

- [x] `choiceOrder.ts`: Fisher–Yates s předanou náhodou, lexikografické permutace 0–23, pevné pořadí B09 (CO1–CO3)
- [x] `run.ts`: typy stavu a akcí, časy podle čísla zastávky, start městské trasy (R1, R2, R17)
- [x] Reducer: odpočet, hranice času, kola, první akce platí, skóre a série (R3–R6, R14, R15)
- [x] Žolíky 50:50 a +10 s, kombinace, nečasovaný režim, pauza (R7–R11)
- [x] Přeskočení za video s ID pokusu, obnova s pauzou (R12, R13, R16)
- [x] Testy scénářů ze spec.md §1 a §2, Rozhraní doplněné

## Balíček 2: Postup hráče (`progress`)

- [x] Hvězdy, nejlepší výsledek, odemykání podle pořadí katalogu (P1–P3)
- [x] Pohlednice, idempotentní dokončení, souhrn města (P4–P6)
- [x] Součty, další krok, slučování (P7–P9)
- [x] Testy scénářů ze spec.md §3, Rozhraní doplněné

## Balíček 3: Denní výzva (`daily`), po balíčcích 1 a 2

- [x] FNV-1a 32bit, datum UTC z ms, výběr verze katalogu, rozvrh (D1–D3, D10)
- [x] Start denního průchodu s FNV permutacemi a pevným B09 (D4, D5)
- [x] Denní výsledky, série dnů, slučování, zpřístupnění (D6–D9)
- [x] Testy scénářů ze spec.md §4 včetně katalogů 30, 40 a 47 měst, Rozhraní doplněné

## Balíček 4: Uložení (`storage`), po balíčcích 1–3

- [x] Oddíly a schéma v1, validace po oddílech a po záznamech (S1, S2, S9)
- [x] Verze: zachování novější, přepis poškozené; starší verze neexistují (S3)
- [x] Slučování odměn, jeden aktivní průchod, dokončení (S4, S5, S7)
- [x] Vlastnictví mezi kartami (S6)
- [x] Paměťová náhrada a jednorázové upozornění (S8)
- [x] Testy scénářů ze spec.md §5 nad paměťovým `KeyValueStore` v testu, Rozhraní doplněné

## Opravy nálezů z review a QA oblasti

- [x] Test nezávislosti pořadí voleb na popiscích a jazyce pro městský i denní průchod (R18, K2)
- [x] Zachování uloženého průchodu při selhaném zápisu odměn (S7, S8)
- [x] Validace fáze `summary` jen na poslední zastávce a shody `stopId` výsledků se zastávkami (S2)
- [x] Prázdná ID odmítnutá v logice, shodně s validací úložiště (Obecné zásady, R13, Rozhraní)
- [x] Test přeskočení u 3. otázky denní výzvy pro začátky 1, 2 a 6 (R12)
- [x] Podmínka volajícího pro `elapsedMs` (R3, Rozhraní)

## Opravy nálezů z druhého kola review a QA

- [x] Sady popisků s různým pořadím řazení v testech K2, ověřené proti regresi řazení podle popisků (R18, K2)
- [x] `requestSkip` s prázdným ID pokusu vyhodí `Error` i ve fázi `summary` a se starým kolem (R13)
- [x] Zúžený slib o validaci stavů z logiky a podmínky volajícího u `createRun` (Obecné zásady, Rozhraní)
- [x] Známé omezení při trvalé chybě zápisu odměn (S7) s testem

## Předání oblasti

- [x] Všechny balíčky sloučené do `area/logic`, lint, typecheck, test, build zelené
- [x] Review a QA oblasti bez blocker a major nálezů, `.handoff/REPORT.md`
