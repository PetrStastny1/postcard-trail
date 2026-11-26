# Postup oblasti logic

Požadavky a scénáře jsou ve [spec.md](spec.md). Vývojář balíčku zaškrtává hotové kroky a doplňuje sekci Rozhraní ve spec.md.

## Balíček 1: Průchod trasou (`run`)

- [ ] `choiceOrder.ts`: Fisher–Yates s předanou náhodou, lexikografické permutace 0–23, pevné pořadí B09 (CO1–CO3)
- [ ] `run.ts`: typy stavu a akcí, časy podle čísla zastávky, start městské trasy (R1, R2, R17)
- [ ] Reducer: odpočet, hranice času, kola, první akce platí, skóre a série (R3–R6, R14, R15)
- [ ] Žolíky 50:50 a +10 s, kombinace, nečasovaný režim, pauza (R7–R11)
- [ ] Přeskočení za video s ID pokusu, obnova s pauzou (R12, R13, R16)
- [ ] Testy scénářů ze spec.md §1 a §2, Rozhraní doplněné

## Balíček 2: Postup hráče (`progress`)

- [x] Hvězdy, nejlepší výsledek, odemykání podle pořadí katalogu (P1–P3)
- [x] Pohlednice, idempotentní dokončení, souhrn města (P4–P6)
- [x] Součty, další krok, slučování (P7–P9)
- [x] Testy scénářů ze spec.md §3, Rozhraní doplněné

## Balíček 3: Denní výzva (`daily`), po balíčcích 1 a 2

- [ ] FNV-1a 32bit, datum UTC z ms, výběr verze katalogu, rozvrh (D1–D3, D10)
- [ ] Start denního průchodu s FNV permutacemi a pevným B09 (D4, D5)
- [ ] Denní výsledky, série dnů, slučování, zpřístupnění (D6–D9)
- [ ] Testy scénářů ze spec.md §4 včetně katalogů 30, 40 a 47 měst, Rozhraní doplněné

## Balíček 4: Uložení (`storage`), po balíčcích 1–3

- [ ] Oddíly a schéma v1, validace po oddílech a po záznamech (S1, S2, S9)
- [ ] Verze: migrace starší, zachování novější, přepis poškozené (S3)
- [ ] Slučování odměn, jeden aktivní průchod, dokončení (S4, S5, S7)
- [ ] Vlastnictví mezi kartami (S6)
- [ ] Paměťová náhrada a jednorázové upozornění (S8)
- [ ] Testy scénářů ze spec.md §5 nad paměťovým `KeyValueStore` v testu, Rozhraní doplněné

## Předání oblasti

- [ ] Všechny balíčky sloučené do `area/logic`, lint, typecheck, test, build zelené
- [ ] Review a QA oblasti bez blocker a major nálezů, `.handoff/REPORT.md`
