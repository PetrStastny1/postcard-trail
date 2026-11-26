# Postup oblasti content

Požadavky jsou v [spec.md](spec.md). WP1 je první, protože ostatní stavějí na jeho datech. WP2 a WP3 běží souběžně a nesahají na stejné soubory. WP4 navazuje na oba.

## WP1 Import (`wp/content/import`)

- [x] Tabulka `tools/content/city-coordinates.json` se zdrojem každé hodnoty (R1).
- [x] Parser městského souboru a importér `tools/content/import.ts` s exportovanou funkcí pro import v paměti (R1).
- [x] Katalog `src/content/catalog.json` s první verzí `2026-12-01` a zachováním `versions` při dalším importu (R2).
- [x] `src/content/catalog.ts` a `src/content/index.ts` s `loadRoute` (R3).
- [x] Vygenerovaná a commitnutá data 20 tras.
- [x] Testy importu na chybných vstupech a idempotence.

## WP2 Zástupné scény a velikost buildu (`wp/content/scenes`)

- [x] Generátor `tools/content/placeholders.ts` a 200 scén v `public/scenes/` s `placeholders.json` (R5).
- [x] Test buildu: trasy v samostatných chuncích, `dist` do 36 MB (R7).

## WP3 Validátor (`wp/content/validator`)

- [x] Strukturální kontrola JSON před věcnými a čitelný výpis chyb, parametr `--root` (R4).
- [x] Kontroly 1–10 z R4 s testy na poškozených datech.
- [x] Test, který spustí validátor jako proces nad vadnými daty a ověří nenulový exit.

## WP4 Validace scén (`wp/content/scene-checks`)

- [x] Kontrola 11 z R4 ve validátoru s testy na poškozených scénách.

## Předání oblasti

- [ ] Review, QA a `.handoff/REPORT.md` oblasti.
