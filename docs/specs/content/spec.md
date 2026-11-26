# Specifikace oblasti content

Oblast převádí městské soubory `docs/game/cities/*.md` do dat hry, drží katalog vydaných tras, načítá trasy po částech, validuje obsah a vyrábí zástupné scény. Kontrakt dat je `src/content/types.ts`, rozhraní pro ostatní oblasti `docs/plan/API.md`. Rozhodnutí jsou v `docs/decisions/LOG.md`.

## Soubory

| Cesta | Obsah | Kdo ho píše |
|---|---|---|
| `tools/content/import.ts` | Importér, `npm run content:import`. | ručně |
| `tools/content/city-coordinates.json` | Souřadnice center měst se zdrojem každé hodnoty. | ručně |
| `src/content/routes/<cityId>.json` | Jedna trasa (`Route`), commituje se. | importér |
| `src/content/catalog.json` | Katalog (`Catalog`). `cities` píše importér, `versions` jen člověk nebo importér s výslovným datem. | importér + ručně |
| `src/content/catalog.ts` | `export const catalog: Catalog`. | ručně |
| `src/content/index.ts` | `loadRoute(cityId)`, lazy-load tras. | ručně |
| `tools/content/validate.ts` | Validátor, `npm run validate:content`. | ručně |
| `tools/content/placeholders.ts` | Generátor zástupných scén, `npm run content:placeholders`. | ručně |
| `public/scenes/<stopId>.webp` | Scéna 1280 × 1280, commituje se. | generátor nebo výtvarník |
| `public/scenes/placeholders.json` | `{ "stopIds": string[] }`, scény, které jsou zatím zástupné. | generátor |

## R1 Import městských souborů

Importér přečte městské soubory v pořadí z tabulky vydání v BRIEF §5 (odkazy `cities/<id>.md` s pořadovým číslem) a zapíše `src/content/routes/<cityId>.json` a `cities` v `src/content/catalog.json`. Texty přenáší 1:1, mění jen typografii nutnou ke zpracování: odstraní tučné značky, koncovou tečku za poslední volbou a koncovou tečku položky u dvojic `Místo CS / EN` a `Popis scény CS / EN` (`… / On the Champ de Mars.` → `On the Champ de Mars`). `feedback` se přenáší i s tečkou. Výstup je deterministický: JSON s odsazením 2 mezery, klíče v pořadí podle `types.ts`, koncový nový řádek.

Mapování:

| Markdown | Data |
|---|---|
| název souboru | `Route.id`, `CatalogCity.id` |
| `# <CS> / <EN>` (nebo jen `# <název>` pro oba jazyky) | `name.cs`, `name.en` |
| `**Pohlednice** — scéna <ID>.` | `postcardQuestionId` |
| `**Ověřeno** — D. M. RRRR.` (za datem může pokračovat poznámka) | `verifiedOn` všech zastávek (`YYYY-MM-DD`) |
| `## <ID> · Lehká / Těžká / Expert` | `id`, `difficulty` `easy` / `hard` / `expert` |
| `**Místo CS / EN**` | `place` |
| `**Popis scény CS / EN**` | `sceneAlt` |
| `**CS**`, `**EN**` | `question` (text do posledního `?` včetně) a čtyři volby oddělené ` · ` nebo ` / `; tučná je správná |
| `**Po odpovědi CS**`, `**After answering EN**` | `feedback` |
| `**Stabilní**` / `**Může se změnit (<fakt>)**` | `stability` `stable` / `changeable`, u `changeable` `changeableFact` = text v závorce. Poznámka za tučným `**Stabilní**` (OSL, „doložený galerijní výjev“) se nepřenáší. |
| odkazy `[text](<url>)` nebo `[text](url)` (adresa bez `<…>` smí obsahovat jednu úroveň závorek, např. `File:A_(b).jpg`) na řádku stálosti a v odrážce, která obsahuje jen odkazy (LIS10) | `photoReferenceUrls` = odkazy, jejichž text začíná „fotografický podklad“, `sourceUrls` = ostatní, v pořadí zdroje |
| `**Rozlišovací znak**` | `distinguishingFeature` |
| `**Scéna**` | nepřenáší se, je to výrobní pokyn pro ilustraci |

- Volby mají ID `a`, `b`, `c`, `d` podle pořadí ve zdroji. `correctChoiceId` je ID tučné volby. `sceneAsset` je `scenes/<id>.webp`.
- Pohlednice v katalogu: `stopId` = `postcardQuestionId`, `sceneAsset` téže zastávky, `sentence` = její `feedback`.
- Souřadnice bere importér z `tools/content/city-coordinates.json` (`{ "<cityId>": { "lat", "lon", "source" } }`, WGS84, 4 desetinná místa, zdrojem je položka Wikidata s vlastností P625). Nové město musí mít řádek v tabulce.
- `tools/content/import.ts` exportuje `readContent(root?)`, která vrátí `{ routes, cities }` z městských souborů v paměti bez zápisu (použije ji validátor, kontrola 10), a `importContent({ root?, effectiveDate? })`, která soubory zapíše. Příkaz bere `--root <adresář>` se stejnou strukturou jako repozitář a `--effective-date=YYYY-MM-DD`, výchozí kořen je repozitář.
- Řádek zastávky, který není známé pole, řádek stálosti ani odrážka s odkazy, je chyba. Stejně tak chybějící řádek stálosti, pohlednice mimo zastávky trasy, neplatné datum Ověřeno a město z tabulky §5 bez souboru.
- Chyby se sbírají za všechna města a vypíšou se najednou, každá na řádek ve tvaru `<soubor> <ID zastávky>: <chyba>` (u chyb záhlaví bez ID). Proces skončí kódem 1 bez stack trace a nezapíše nic.

Scénáře:

- Import nad repozitářem vytvoří 20 tras a katalog, druhé spuštění soubory nezmění (žádný diff).
- B09 má otázku „Na kterou linku metra právě čekáš?“ / „Which metro line are you waiting for?“, volby M1, M2, M3, M4 v tomto pořadí a správnou M1.
- LIS03 a B09 jsou `changeable` s `changeableFact`, ostatních 198 je `stable` bez `changeableFact`.
- Zastávka, u které CS a EN označí tučně jinou pozici, nemá právě jednu tučnou volbu, nemá čtyři volby, postrádá povinné pole nebo má neznámou obtížnost, import ukončí nenulovým kódem a čitelnou chybou s ID zastávky. Nic se nezapíše.
- Město bez řádku v tabulce souřadnic import ukončí chybou.

## R2 Katalog a verze katalogu

- `cities` jsou vydaná města v pořadí odemykání podle BRIEF §5.
- `versions` jsou seřazené vzestupně podle `effectiveUtcDate`, každá verze obsahuje všechna do té doby vydaná města v pořadí odemykání a pozdější verze jen přidává města na konec.
- Poslední verze má `orderedCityIds` shodné s pořadím `cities`.
- Datum první verze je `2026-12-01` (LOG, k potvrzení Petrem) a je zapsané jen v `src/content/catalog.json`, nikde v kódu.
- Importér `versions` zachová. Když se seznam vydaných měst liší od poslední verze (nebo katalog ještě žádnou verzi nemá), vyžaduje parametr `--effective-date=YYYY-MM-DD` a přidá novou verzi na konec. Bez něj skončí chybou a nic nezapíše.
- Importér odmítne datum, které není platné nebo není pozdější než poslední verze, nový seznam, který jen nepřidává města na konec poslední verze, a `--effective-date` při nezměněném seznamu.

## R3 Načítání tras

- `src/content/catalog.ts` exportuje `catalog: Catalog` staticky.
- `src/content/index.ts` exportuje `loadRoute(cityId: string): Promise<Route>`. Každá trasa je v buildu ve vlastním chunku a vstupní chunk texty tras neobsahuje.
- Neznámé `cityId` vrátí odmítnutý promise s chybou, která ID uvádí.
- Trasy se načítají přes `import.meta.glob('./routes/*.json')` bez `eager`, takže nová trasa nepotřebuje změnu kódu.

## R4 Validace obsahu

`npm run validate:content` (součást `npm test` i `npm run build`) zkontroluje data a při jakékoli chybě skončí nenulovým kódem a vypíše seznam chyb, každou na řádek s ID trasy nebo zastávky. Nikdy nevypíše stack trace. Cestu ke kořeni dat jde předat parametrem (`--root <adresář>` se stejnou strukturou jako repozitář), výchozí je repozitář. `tools/content/validate.ts` exportuje `validateContent(root?)`, která vrátí seznam chyb, a `countryQuestionStopIds(routes)` pro kontrolu 8.

Výpis začíná řádkem `Content validation failed:` a pokračuje jednou chybou na řádek ve tvaru `<trasa>: …`, `<trasa> <zastávka>: …`, `catalog <město>: …`, `catalog versions[<i>]: …`, `<soubor>: …` (chybějící soubor, neplatný JSON, soubor nebo složka, kterou nejde přečíst: `<cesta>: cannot read (<kód>)`, např. `EISDIR`, `ENOTDIR`, `EACCES`) nebo `src/i18n/<soubor> <klíč>: …` (když je kořen souboru přímo řetězec, místo klíče stojí `(root)`). Chyby importu městských souborů z kontroly 10 mají předponu `source`; chyba souborového systému při importu je `source[ <cesta>]: cannot read (<kód>)`, cesta chybí, když ji systém neuvede (např. `EISDIR`).

Pořadí: nejdřív se ověří existence souborů a struktura JSON (typy polí, povinná pole, n-tice čtyř voleb, lokalizované texty v `en` i `cs`). Věcné kontroly běží jen nad strukturálně platnými daty: když existuje jakákoli chyba souborů nebo struktury katalogu či tras, vypíšou se jen tyto chyby.

Kontroly:

1. Složka `src/content/routes` existuje, počet tras se rovná počtu měst v katalogu a ID tras odpovídají katalogu i názvům souborů.
2. Katalog má 20 měst v pořadí BRIEF §5 (pořadí dává `readContent`), splňuje R2 (alespoň jedna verze, platná data přísně vzestupně, každá další verze zachová předchozí a přidá aspoň jedno město na konec, poslední verze = `cities`), `name` města se shoduje s trasou a souřadnice leží v rozsahu Evropy (zeměpisná šířka 34–72, délka −25 až 50, pokrývá Reykjavík i města §5 řazená v M49 do Asie).
3. Každá trasa má právě 10 zastávek, ID zastávek jsou jedinečná napříč katalogem a odpovídají vzoru `^[A-Z]+[0-9]{2}$`, `postcardQuestionId` je jedna ze zastávek trasy a pohlednice v katalogu jí odpovídá.
4. Obtížnost podle pořadí: zastávky 1–4 `easy`, 5–8 `hard`, 9–10 `expert`. Expertní zastávky mají `distinguishingFeature`.
5. Čtyři volby mají různá ID a v každém jazyce různé neprázdné popisky. `correctChoiceId` je jedna z nich.
6. `sceneAsset` je `scenes/<id>.webp`, `sourceUrls` a `photoReferenceUrls` mají aspoň jednu adresu a všechny jsou platné adresy `https://`, `verifiedOn` je platné datum `YYYY-MM-DD`, `stability` je `stable` nebo `changeable`, `changeableFact` je neprázdný právě u `changeable`.
7. B09 zobrazuje přesně „Na kterou linku metra právě čekáš?“ / „Which metro line are you waiting for?“ a volby M1, M2, M3, M4 v tomto pořadí ve zdroji.
8. Otázky na stát nebo státní vlajku jsou jen PAR02 a P01. Pozná je podle celých slov v anglické nebo české otázce po odstranění diakritiky (EN `flag(s)`, `country`, `countries`, `state(s)`; CS všechny pádové tvary slov `vlajka`, `stát` (stát, státu, státě, státem, státy, států, státům, státech) a `země` a slova začínající `státní`), stačí shoda v jednom jazyce. „Zeměkoule“ ani „statue“ se nepočítají. Na současných datech kontrola najde právě PAR02 a P01, jinde nic.
9. Únik odpovědi (K7): `question` ani `sceneAlt` v žádném jazyce neobsahuje popisek správné volby, porovnává se bez ohledu na velikost písmen a diakritiku. Žádný řetězec v `src/i18n/*.json` (pokud složka existuje, včetně vnořených objektů a polí) neobsahuje popisek správné volby žádné zastávky v kterémkoli jazyce jako celé slovo či slovní spojení, opět bez ohledu na velikost písmen a diakritiku. Chybějící `src/i18n` není chyba. `place` se nekontroluje, protože je to text výsledku (R6).
10. Generovaná data odpovídají zdroji: import městských souborů v paměti (`readContent(root)`) dá stejné trasy a stejné `cities` jako commitnuté soubory. Rozdíl se hlásí s ID trasy a pokynem `run npm run content:import`. Řádek `tools/content/city-coordinates.json` pro město, které není v tabulce BRIEF §5, je chyba `tools/content/city-coordinates.json: <cityId> is not a released city` (chybějící řádek hlásí import).
11. Scény: pro každou zastávku existuje `public/scenes/<id>.webp`, je to WebP 1280 × 1280 a má nejvýš 150 000 B. `public/scenes/placeholders.json` má tvar `{ "stopIds": string[] }`, obsahuje jen existující ID zastávek bez duplicit a smí být libovolnou podmnožinou katalogu (po dodání finální scény se ID odebere). Ve složce nejsou soubory bez zastávky.
    - WebP se pozná podle hlavičky: `RIFF`, délka, `WEBP` a první chunk `VP8 `, `VP8L` nebo `VP8X`, ze kterého se čtou rozměry. Délka v hlavičce RIFF musí odpovídat velikosti souboru (jinak je soubor zkrácený), hlavička chunku musí být celá a deklarovaná velikost prvního chunku aspoň 10 B (`VP8 `, `VP8X`) nebo 5 B (`VP8L`), `VP8 ` musí mít počáteční kód snímku `9d 01 2a` a `VP8L` podpisový bajt `0x2f`. Čtení hlavičky je v `tools/content/webp-header.ts` (`readWebpDimensions`) a používají ho validátor i testy generátoru. Limity `sceneSize` a `maxSceneBytes` jsou v `tools/content/scene-limits.ts` (bez Playwrightu) a importuje je generátor, validátor i testy.
    - Chyby scény zastávky: `<trasa> <zastávka>: scene public/scenes/<id>.webp not found`, `… is <šířka> × <výška>, expected 1280 × 1280`, `… has <n> bytes, at most 150000 allowed`, `… is not a valid WebP (<co je špatně s naměřenou hodnotou>)`, např. `(truncated VP8X header, the file has 20 bytes, at least 30 needed)`, `(damaged VP8 header, the frame start code is 00 00 00 instead of 9d 01 2a)`, `(damaged VP8L header, the signature byte is 00 instead of 2f)`, `(the VP8 chunk declares 9 bytes, at least 10 needed)`. Scénu, kterou nejde přečíst, hlásí řádek `public/scenes/<id>.webp: cannot read (<kód>)`.
    - Soubor nebo složka ve `public/scenes/`, která není `<id zastávky>.webp`, `placeholders.json` ani skrytý soubor (název začíná tečkou, stejně jako u generátoru), je chyba `public/scenes/<soubor>: not the scene of a catalog stop`.
    - Chybějící `public/scenes` je `public/scenes: directory not found`, chybějící seznam `public/scenes/placeholders.json: file not found`. Neplatný JSON, kořen, který není objekt, a `stopIds`, které nejsou pole řetězců, hlásí řádek s cestou k seznamu. Duplicitní a neznámé ID se hlásí jednou za ID.
    - Kontrola scén je věcná: běží jen nad strukturálně platným katalogem a trasami.

Scénáře: ke každé kontrole existuje test na záměrně poškozených datech a aspoň jeden test spustí validátor jako proces nad vadnou kopií dat a ověří nenulový kód a čitelný výpis.

## R5 Zástupné scény

- `npm run content:placeholders` vytvoří pro každou zastávku bez finální scény soubor `public/scenes/<id>.webp` (WebP 1280 × 1280, nejvýš 150 000 B) a zapíše `public/scenes/placeholders.json` (`{ "stopIds": [...] }`, odsazení 2 mezery, koncový nový řádek) se všemi zástupnými ID v pořadí katalogu a tras. ID zastávek bere z `src/content/catalog.json` a `src/content/routes/*.json`. Příkaz bere `--root <adresář>` se stejnou strukturou jako repozitář, výchozí kořen je repozitář.
- Scéna je abstraktní kompozice v ilustrační paletě BRIEF §9. Barvy generátor čte z proměnných `--scene-*` v `src/styles/tokens.css`, chybějící proměnná je chyba. Kompozici popisuje čistá funkce `sceneComposition(stopId, palette)` (tvary a jejich barvy v pořadí kreslení), Chromium ji jen vykreslí. Kompozice je pro stejné ID vždy stejná (seed z ID, bez `Math.random()`) a liší se mezi zastávkami: náladou (den, soumrak, večer, noc, podzemí) a tvarem siluety. Jediný text ve scéně je ID zastávky na štítku, nikdy název volby, místa ani města. Štítek má barvu z palety, která se liší od barvy země nebo nástupiště pod ním, a text má jinou barvu než štítek.
- Finální scéna je soubor, jehož ID v `placeholders.json` není. Generátor ji nikdy nepřepíše ani nepřidá do seznamu. Seznam je proto libovolná podmnožina ID katalogu ve stejném pořadí, ne nutně všech 200.
- Skryté soubory ve `public/scenes/` (název začíná tečkou, např. `.DS_Store`) generátor ignoruje: nekreslí je, nemaže je a nehlásí je.
- Poškozený `placeholders.json` (neplatný JSON, chybí `stopIds` nebo to není pole řetězců) ukončí běh kódem 1 se zprávou, která uvádí cestu k souboru, bez stack trace, a nic se nezapíše.
- Zástupná scéna, jejíž ID je v seznamu, ale už není v katalogu, se smaže a ze seznamu vypadne. Jiný soubor ve `public/scenes/` (finální scéna bez zastávky, soubor jiného typu) generátor nesmaže: skončí kódem 1, vypíše každý takový soubor na řádek a nic nezapíše.
- Převod do WebP dělá Chromium z Playwrightu (`canvas.toDataURL('image/webp', kvalita)`), bez nové závislosti. Generátor zkouší kvality 0,85, 0,7, 0,55 a 0,4 a vezme první, se kterou je scéna do limitu; když se nevejde ani s nejnižší, skončí chybou. Když Chromium chybí, skončí kódem 1 se zprávou, která uvádí `npx playwright install chromium`. Nic se nezapíše, dokud nejsou vykreslené všechny scény. Když není co vykreslit (všechny scény jsou finální), prohlížeč se nespouští.
- Generátor se spouští ručně a výstup se commituje. `npm test` prohlížeč nespouští.

Scénáře:

- Běh nad repozitářem bez finálních scén vytvoří 200 scén a seznam s 200 ID. Opakovaný běh na stejném systému dá bajtově stejné soubory (žádný diff). Na jiném systému se může lišit vykreslení ID na štítku, protože písmo `system-ui` je závislé na OS; kompozice (`sceneComposition`) je stejná všude.
- Soubor `PAR01.webp`, který v seznamu není, zůstane po běhu beze změny a do seznamu se nepřidá.
- Zástupná scéna s ID mimo katalog se smaže, finální soubor s ID mimo katalog ukončí běh chybou s jeho cestou.
- Bez nainstalovaného Chromia skončí běh kódem 1 se zprávou o `npx playwright install chromium` a ve `public/scenes/` nic nevznikne.

## R6 Pravidla pro ostatní oblasti

- `place` je text pro výsledek zastávky. Na obrazovce otázky (i v denní výzvě a po obnovení) se nezobrazuje, protože u 30 zastávek obsahuje název správné volby.
- Pod zástupnou scénou (ID v `placeholders.json`) aplikace ukáže `sceneAlt` v aktuálním jazyce.

## R7 Velikost buildu

Test buildu (`tools/content/build-size.test.ts`) spustí Vite build přes jeho API do dočasného adresáře se vstupem, který importuje `catalog` a `loadRoute`, a s `public/` repozitáře. Ověří, že každá z tras je v samostatném chunku mimo vstupní chunk, vstupní chunk neobsahuje texty tras (otázky PAR01 a B09 v obou jazycích) a celý `dist` včetně 200 scén má nejvýš 36 MB (36 000 000 B, BRIEF §14). Naměřené velikosti (vstupní chunk i gzip, součet scén, celý build) vypíše do výstupu testu.
