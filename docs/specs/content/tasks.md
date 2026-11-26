# Postup oblasti content

Požadavky jsou v [spec.md](spec.md). Balíčky jdou za sebou, protože každý staví na datech předchozího.

## WP1 Import (`wp/content/import`)

- [ ] Tabulka `tools/content/city-coordinates.json` se zdrojem každé hodnoty (R1).
- [ ] Parser městského souboru a importér `tools/content/import.ts` s exportovanou funkcí pro import v paměti (R1).
- [ ] Katalog `src/content/catalog.json` s první verzí `2026-12-01` a zachováním `versions` při dalším importu (R2).
- [ ] `src/content/catalog.ts` a `src/content/index.ts` s `loadRoute` (R3).
- [ ] Vygenerovaná a commitnutá data 20 tras.
- [ ] Testy importu na chybných vstupech a idempotence.

## WP2 Zástupné scény a velikost buildu (`wp/content/scenes`)

- [ ] Generátor `tools/content/placeholders.ts` a 200 scén v `public/scenes/` s `placeholders.json` (R5).
- [ ] Test buildu: trasy v samostatných chuncích, `dist` do 36 MB (R7).

## WP3 Validátor (`wp/content/validator`)

- [ ] Strukturální kontrola JSON před věcnými a čitelný výpis chyb, parametr `--root` (R4).
- [ ] Kontroly 1–11 z R4 s testy na poškozených datech.
- [ ] Test, který spustí validátor jako proces nad vadnými daty a ověří nenulový exit.

## Předání oblasti

- [ ] Review, QA a `.handoff/REPORT.md` oblasti.
