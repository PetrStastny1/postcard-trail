# Co se změnilo
Oblast content převádí 20 městských souborů `docs/game/cities/*.md` na data hry: `src/content/routes/<cityId>.json` (200 zastávek) a `src/content/catalog.json` s pořadím z BRIEF §5 a první verzí katalogu `2026-12-01`. `loadRoute(cityId)` načítá každou trasu jako samostatný chunk. Validátor `npm run validate:content` (součást `npm test` i `npm run build`) zastaví build při jakékoli chybě obsahu, scén nebo i18n textů a vypisuje čitelné řádky bez stack trace. Generátor `npm run content:placeholders` vytvořil 200 abstraktních zástupných scén WebP 1280 × 1280 v paletě §9 (15–32 kB, celkem 4,6 MB) a `public/scenes/placeholders.json`.

Větev `area/content`, HEAD `0440deb423d23665eeafd94e6e8ff8ad28d8aa45`, base pro diff `dff6ba1` (`git merge-base release/v1 HEAD`). Specifikace: `docs/specs/content/spec.md`, postup: `docs/specs/content/tasks.md`.

# Akceptační kritéria
| Kritérium | Jak ověřeno | Výsledek |
|---|---|---|
| Import vytvoří 20 tras a katalog, opakovaný import nic nezmění, texty 1:1 | `tools/content/import.test.ts`; QA scénáře 1–5 (křížová kontrola 200 zastávek proti md: 0 rozdílů) | splněno |
| Katalog: 20 měst v pořadí §5, jedna verze `2026-12-01`, datum jen v `catalog.json` | `import.test.ts`, `route-loading.test.ts` (grep data v `src` a `tools`); QA 6–7 | splněno |
| `catalog`, `loadRoute`, trasa ve vlastním chunku, vstup bez textů tras, neznámé ID odmítnuto | `build-size.test.ts` (Vite build), `route-loading.test.ts` (spuštění přes Vite `ssrLoadModule`); QA 8–10 (síťové požadavky v Chromiu) | splněno |
| `validate:content` nad repozitářem kód 0, součást `test` i `build` | `npm test`, `npm run build`; QA 11 | splněno |
| 20 měst v pořadí, 200 jedinečných ID, 4 různé volby a jedna správná ve stejném slotu v EN i CS, fotopodklad, zdroj, datum, stálost | `validate.test.ts`, `import.test.ts`; QA 12–14 (79 mutací dat) | splněno |
| B09 přesně „Na kterou linku metra právě čekáš?“ a M1 / M2 / M3 / M4 | `validate.test.ts`; QA 15 | splněno |
| Otázky na stát či vlajku jen PAR02 a P01 | `validate.test.ts`; QA 16–18, N1 | splněno |
| Neplatný záznam zastaví build | QA 22 (`npm run build`, `build:poki`, `npm test` → exit 1, `dist` nevznikne) | splněno |
| Chybějící složka nebo jiný počet tras je chyba, struktura před věcnými kontrolami, bez stack trace, procesový test s `--root` | `validate.test.ts` (procesové testy); QA 12, 23, 24 | splněno |
| K7: `question`, `sceneAlt` ani `src/i18n/*.json` neobsahují správnou volbu (velikost písmen, diakritika) | `validate.test.ts`; QA 19–21 | splněno (skloňované tvary viz Co ověřeno není) |
| 200 scén WebP 1280 × 1280 do 150 kB, `placeholders.json` se všemi 200 ID | `placeholders.test.ts`, validátor kontrola 11; QA 25–26 (dekódování všech 200 v Chromiu, největší 31 508 B) | splněno |
| Scéna jen z palety §9, jediný text je ID zastávky | `placeholders.test.ts` (všech 200 ID); QA 27, N4; výklad palety rozhodl arbitr | splněno |
| Generátor nepřepíše finální scénu, WebP bez nové závislosti | `placeholders.test.ts`; QA 29–34, N2; ruční běh s Chromiem nad dočasným kořenem | splněno |
| lint, typecheck, test, build, test:e2e | lokálně na `0440deb` | splněno |

# Kontroly
- lint, typecheck, test (138/138), build, test:e2e (`E2E_PORT=43311`, 1/1): prošlo na `0440deb`, Node 22.20.0, macOS.
- Reviewer: každý ze 4 balíčků samostatně (1–3 kola, nálezy opraveny a znovu zkontrolovány) a celá oblast ve 2 kolech. V oblasti nalezen 1 major (generátor po smazání `placeholders.json` tiše označil všech 200 scén za finální) a 4 minor (test `loadRoute` jen nad zdrojovým textem, tiché zahození textu v odrážce s odkazy, výklad palety, skloňované tvary v K7). Vše opraveno nebo zapsáno do spec, druhé kolo bez nálezů.
- QA: 37 scénářů v 1. kole (4 minor: „vlajek“, chybějící `placeholders.json`, stack trace generátoru u chybějícího `tokens.css`/neplatného katalogu, mezitóny palety), ve 2. kole 18 scénářů, všechny 4 nálezy vyřešené, zůstal 1 minor (viz Otevřené body).
- Vizuální kontrola: netýká se, oblast nemění UI. Zástupné scény si QA prohlédlo.
- Druhý názor (Codex): netýká se, změna není citlivá (bez přihlašování, oprávnění, osobních dat a migrací).
- CI: neověřeno. Větev nepushuji (podle pokynu ředitele), CI poběží až po pushi ředitelem.

# Databáze
Beze změny, hra nemá databázi.

# Nové závislosti
Žádné. Převod do WebP používá Chromium z existující `@playwright/test`, test buildu a `loadRoute` existující `vite`.

# Co ověřeno není
- CI na Linuxu a Node 26 z `.nvmrc`: lokálně jen Node 22.20.0 na macOS.
- Bajtová reprodukovatelnost generátoru scén na jiném OS: štítek s ID se kreslí písmem `system-ui`, na Linuxu vznikne diff ve všech 200 souborech. Kompozice je stejná všude. Scény se generují a commitují ručně, takže CI tím ovlivněné není.
- Kontrola i18n běží jen nad testovacími soubory, `src/i18n` zatím neexistuje (vznikne v oblasti app).
- Automatická kontrola K7 porovnává celý popisek správné volby. České skloňované tvary („na Vltavě“) nepozná, pokrývá je redakční kontrola K7 (spec R4 bod 9). Na dnešních datech QA ani reviewer únik ve skloňovaném tvaru nenašli.
- Platnost těla WebP za hlavičkou validátor nekontroluje. QA všech 200 souborů nezávisle dekódovalo v Chromiu.
- Ruční ověření měnících se faktů B09 a LIS03 v dopravních podkladech (krok kontrolního seznamu vydání v README).

# Rozhodnutí bez Petra
K potvrzení Petrem: žádné nové. Platí dřívější `effectiveUtcDate` `2026-12-01` (rozhodnutí ředitele, k potvrzení).

Rozhodnutí arbitra v této oblasti (`docs/decisions/LOG.md`):
- `place` je text výsledku a před odpovědí se nezobrazuje, protože u 30 zastávek (51 textů) obsahuje název správné volby. Kontrola úniku proto hlídá `question`, `sceneAlt` a i18n, ne `place`.
- Souřadnice měst jsou v `tools/content/city-coordinates.json` (Wikidata P625, 4 desetinná místa). Validátor hlásí chybějící i nadbytečné město.
- Kritérium „v paletě §9“ platí pro kompozici scény, mezitóny přechodu a komprese jsou přípustné.

Drobná rozhodnutí manažera a vývojářů (ve spec): volby `a`–`d` podle pořadí ve zdroji; pohlednice `sentence` = `feedback` zastávky; u `place` a `sceneAlt` se odstraní koncová tečka; poznámky za `**Stabilní**` a pole `Scéna` se nepřenášejí; limity v desítkové soustavě (150 kB = 150 000 B, 36 MB = 36 000 000 B); importér přijme odkaz s `<…>` i bez něj (s jednou úrovní závorek v adrese).

# Návrhy změn kontraktů (pro ředitele)
1. `src/content/types.ts`, `Stop.place`: doplnit komentář „Result text, shown only after the answer. It names the correct choice for 30 stops.“ a totéž pravidlo do `docs/plan/API.md` (sekce content → logic, app). Podmínka arbitra.
2. Oblast app: přidat akceptační kritérium K7, že obrazovka otázky (i v denní výzvě a po obnovení uložené scény) neukazuje `place` v UI ani v přístupných názvech, s e2e nebo DOM testem. Podmínka arbitra, bez ní je rozhodnutí o `place` nesplněné.
3. `docs/plan/PLAN.md` nebo BRIEF §5: uvést `tools/content/city-coordinates.json` jako zdroj souřadnic. Budoucí balíky měst musí doplnit řádek tabulky.

# Otevřené body mimo rozsah
- [minor, QA] Generátor scén při nečitelném vstupu (EISDIR, EACCES, např. `catalog.json` jako složka nebo `tokens.css` s `chmod 000`) skončí kódem 1 se stack trace místo řádku `cannot read (<kód>)`. Nic nezapíše. Je to ruční vývojový nástroj a spec R5 to nevyžaduje.
- Validátor má počet 20 měst pevně podle K1. Při vydání balíku A–C se kontrola musí upravit spolu s novou verzí katalogu.
- Když je městský soubor složka, Node u EISDIR neuvede cestu a výpis validátoru je jen `source: cannot read (EISDIR)`.
- `docs/game/cities/lisbon.md` (LIS10, ř. 118) má samostatnou odrážku s odkazem Carris místo odkazu na řádku stálosti. Importér ji zpracuje správně, ale kvůli jednotnému formátu by šla ve zdroji přesunout.
- `npm test` nově spouští Vite build (test velikosti) a Vite dev server v režimu middleware (test `loadRoute`), takže trvá o několik sekund déle. Prohlížeč nespouští.
