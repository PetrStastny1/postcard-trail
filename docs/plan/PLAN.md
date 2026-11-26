# Plán první verze – Postcard Trail

## Cíl

Hratelná první verze HTML5 hry Postcard Trail podle [zadání](../game/BRIEF.md): 20 evropských metropolí, 200 zastávek a otázek v EN/CS, mapa, sbírka pohlednic, denní výzva, žolíky včetně přeskočení za video přes portálový adaptér a lokální uložení postupu. Hra běží jako statický web na GitHub Pages (`/postcard-trail/`) a v portálových buildech pro CrazyGames a Poki. Pro hráče od 12 let na desktopu i mobilu.

Ilustrace jsou v této verzi zástupné (rozhodnutí Petra). Skutečné obrázky se dodají později výměnou souborů scén bez změny kódu ani obsahu.

## Akceptační kritéria celku

Vycházejí z §15 zadání. Kritéria 1–6 se ověřují v této verzi. Z kritéria 7 se ověřuje jen to, co nezávisí na finálních ilustracích.

- [ ] **K1 Obsah.** `npm run validate:content` (součást `npm test` i `npm run build`) ověří 20 měst ve schváleném pořadí z §5, 200 stabilních jedinečných ID zastávek a scén, čtyři různé volby s jednou správnou ve stejném slotu v obou jazycích, fotopodklad, zdroj, datum ověření a stálost. B09 přesně zobrazuje „Na kterou linku metra právě čekáš?“ a M1 / M2 / M3 / M4. Otázky na stát nebo vlajku jsou jen PAR02 a P01. Neplatný záznam zastaví build.
- [ ] **K2 Pravidla.** Unit testy pokryjí timeout, vstup na hranici odpočtu, dvojklik, skóre, sérii, restart, kombinaci žolíků, nečasovaný režim a stavy z tabulky v §3. Test s řízenou náhodou ověří různé permutace městské trasy, jejich zachování po obnově a v jiném jazyce, shodu denní permutace (FNV-1a) a pevné pořadí B09. Nulové skóre dokončí trasu, odemkne právě následující město a udělí právě jednu kartu. Obnovení, opakování a ukončení po posledním kliknutí odměnu neduplikují.
- [ ] **K3 Celý tok v prohlížeči.** Playwright projde Paříž na desktopu i v mobilním zobrazení, odemkne Londýn, zobrazí uzamčený Řím, obnoví aktivní otázku i výsledek po reloadu, přepne jazyk a orientaci. Stav s 20 dohranými městy ukáže 20 pohlednic, nejvýš 60 hvězd a mapu jako další krok.
- [ ] **K4 Denní výzva.** Testy ověří 20 různých měst za 20 dní, 8 různých počátečních pozic každého města za 160 dní, výpočet v UTC, zařazení zamčených měst, zachování uloženého průchodu přes půlnoc i aktualizaci katalogu, start nového katalogu ve stanovený den a pokrytí 8 začátků i pro katalogy s 30, 40 a 47 městy. Denní výsledek nemění sbírku ani hvězdy.
- [ ] **K5 Reklama.** Lokální adaptér pokryje úspěch, odmítnutí, nedostupnost, přerušené video a duplicitní callback. Automatický spot se nespustí. Úspěšné přeskočení zachová sérii i skóre. Při předem známé nedostupnosti je žolík skrytý. Portálové adaptéry posílají signály načítání a hraní podle §12 bez zdvojení.
- [ ] **K6 Ovládání a přístupnost.** Každé herní okno má funkční křížek a cestu na úvod. Klávesnice podle §4, kontrast WCAG AA, cíle 44 px, velikosti 320 × 568 a 568 × 320, Poki náhledy 640 × 360, 836 × 470 a 1031 × 580 bez posouvání rodiče, delší překlad nerozbije layout. Reduced motion a nastavení Bez animací.
- [ ] **K7 Výkon a texty.** Startovní payload do 700 kB, build do 36 MB, lazy-load tras a přednačtení jedné další scény. Žádný text v UI, alt textu ani popisku před odpovědí neobsahuje název správné volby (automatická kontrola nad obsahem i i18n). Kontroly ilustrací proti fotografiím, překreslení P04 a čitelnost stopy na mobilu jsou odložené do dodání skutečných obrázků.

## Společný základ (dělá ředitel před paralelní prací)

Na větvi `release/v1`:

- Kostra z `create-vite` (vanilla-ts), skripty `lint`, `typecheck`, `test`, `build`, `test:e2e`, CI a Pages workflow podle parcel-pull, `docs/decisions/0001-stack.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`.
- Kontrakty (typy a podpisy funkcí, bez implementace):
  - `src/content/types.ts` – město, zastávka, volby, katalog a verze katalogu,
  - `src/platform/types.ts` – portálový adaptér (reklama, signály, události měření, ukládání),
  - `docs/plan/API.md` – veřejné funkce každého modulu, které ostatní oblasti volají.
- Design tokeny podle §9 (`src/styles/tokens.css`) a jedna schválená klíčová obrazovka (otázka zastávky na výšku i na šířku) ve `docs/design/`.
- Skripty `validate:content` (součást `test` i `build`), `build:poki`, `build:crazygames`, `E2E_PORT` z prostředí, každá oblast má vlastní port. Hra nemá databázi ani backend.
- Sdílené konfigurační soubory (`package.json`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.github/`) vlastní ředitel. Závislost nebo skript si oblast vyžádá.

Kontrakty od této chvíle mění jen ředitel.

## Oblasti

### content

- Odpovědnost: převod 20 městských souborů `docs/game/cities/*.md` do dat v `src/content`, katalog s pořadím a první verzí katalogu, načítání tras po částech, validátor obsahu (K1, automatická část K7), generátor zástupných scén.
- Hranice: `src/content/` (kromě `types.ts`), `tools/content/`, `public/scenes/`, `docs/specs/content/`. Zástupné scény jsou WebP 1280 × 1280 na cestě `scenes/<id>.webp`, stejně jako budoucí finální.
- Závisí na: `src/content/types.ts`.
- Akceptační kritéria: K1, kontrola textových nápověd z K7, zástupná scéna pro každé ze 200 ID ve formátu 1:1 v paletě §9 bez názvu správné volby, velikost scény do 150 kB.
- Pracovní balíčky:
  1. Importér Markdown → JSON pro 20 měst včetně souřadnic, `postcardQuestionId`, zdrojů, data ověření a stálosti. Generovaná data se commitují.
  2. Validátor (`npm run validate:content`) a jeho testy na záměrně poškozených datech.
  3. Zástupné scény a katalog s lazy-loadem tras (`loadRoute(cityId)`), měření velikosti buildu.

### logic

- Odpovědnost: čistá deterministická pravidla bez DOM a bez skutečného času: průchod (fáze, odpočet v ms, žolíky, výsledky, série), skóre a hvězdy, odemykání a pohlednice, denní výzva (verze katalogu, rozvrh, FNV-1a permutace, série dnů), míchání voleb s předanou náhodou. Verzované uložení: schéma, validace po oddílech, migrace, slučování odměn, vlastnictví průchodu mezi kartami.
- Hranice: `src/game/logic/`, `src/game/storage/`, `docs/specs/logic/`. Bez DOM, bez skutečného času a náhody. Události prohlížeče pro vlastnictví průchodu mezi kartami obsluhuje app přes funkce z `src/game/storage/`.
- Závisí na: `src/content/types.ts`, `KeyValueStore` ze `src/platform/types.ts`.
- Akceptační kritéria: K2, K4, logická část K5 (přeskočení jen po potvrzeném výsledku se správným ID pokusu, nejvýš jednou).
- Pracovní balíčky:
  1. Průchod trasou: reducer, odpočet, hranice času, dvojklik, žolíky, nečasovaný režim, skóre a série.
  2. Postup hráče: hvězdy, odemykání, pohlednice, idempotentní dokončení.
  3. Denní výzva: verze katalogu, rozvrh, permutace, série dnů, chování přes půlnoc.
  4. Uložení: schéma v1, validace po oddílech, slučování, vlastnictví mezi kartami, paměťová náhrada.

### platform

- Odpovědnost: adaptéry `local`, `poki` a `crazygames` za jedním kontraktem: inicializace SDK, signály načítání a hraní se sloučením duplicit, reklama za odměnu s ID pokusu, hlášení předem známé nedostupnosti, události měření, lokální vývojový záznam s exportem. Zvuk (Web Audio syntéza) a vibrace.
- Hranice: `src/platform/` (kromě `types.ts`), `src/game/feedback/`, `docs/specs/platform/`. Adaptér dává jen surové úložiště `KeyValueStore`, schéma a validace patří do logic.
- Závisí na: `src/platform/types.ts`.
- Akceptační kritéria: K5, zvukové a vibrační chování z §8 a §11.
- Pracovní balíčky:
  1. Lokální adaptér se simulací úspěchu, odmítnutí, nedostupnosti, přerušení a duplicitního callbacku. Výběr chování přes parametr adresy jen ve vývojovém a testovacím buildu.
  2. Adaptéry Poki a CrazyGames podle aktuální dokumentace SDK, výběr adaptéru při buildu (`VITE_PLATFORM`).
  3. Zvuk, vibrace a měření.

### app

- Odpovědnost: všechny obrazovky z §10 v DOM/CSS, aplikační vrstva (skutečný čas, viditelnost stránky, kontrolní body, přechody mezi obrazovkami), texty `src/i18n`, napojení na logiku, obsah a platformu, e2e testy, ověření přístupnosti, rozměrů a výkonu.
- Hranice: `src/main.ts`, `src/app/`, `src/game/render/`, `src/ui/`, `src/i18n/`, `src/styles/` (tokeny jen čte), `e2e/`, `index.html`, `docs/specs/app/`. Validátor obsahu kontroluje i `src/i18n/*.json` a app ho drží zelený.
- Závisí na: výsledcích oblastí content, logic a platform (vlna 1) a na schválené klíčové obrazovce.
- Akceptační kritéria: K3, K6, K7 (výkon a lazy-load), UI část K5 (potvrzení videa, stav nedostupnosti, skrytý žolík).
- Pracovní balíčky:
  1. Kostra aplikace: načítání, úvod s animací, nastavení, jazyk, navigace a křížky, potvrzení změny průchodu.
  2. Hra: otázka, výsledek, odpočet, žolíky, pauza, zvětšení scény, potvrzení videa, chyba načtení, kontrolní body.
  3. Mapa, souhrn města, sbírka a detail karty, denní výzva a její souhrn.
  4. E2E toky, klávesnice, kontrast, minimální velikosti, Poki rozměry, měření payloadu.

## Vlny

1. `content`, `logic`, `platform` souběžně.
2. `app` po integraci vlny 1 do `release/v1`.

## Rozhodnutí ke schválení plánu

Arbitr plán schválil s podmínkami, které jsou zapracované výše a v [API.md](API.md). Záznam je v [LOG.md](../decisions/LOG.md).

- **Datum účinnosti první verze katalogu** je pevné a zapsané jen v `src/content/catalog.json`. Před vydáním se ověří proti skutečnému dni vydání. **K potvrzení Petrem.**
- **Zástupná scéna** je abstraktní obraz v paletě §9 s ID zastávky. Pod ní se viditelně zobrazí `sceneAlt` v aktuálním jazyce, jen u scén uvedených v `public/scenes/placeholders.json`. Čtečka popis nečte dvakrát a layout projde kontrolami K6 s popiskem i bez něj. **K potvrzení Petrem.**

## Mimo tuto verzi nebo jen částečně

- **Měnící se fakta (§5).** Validátor ověří u `changeable` záznamů `stability`, `changeableFact`, `verifiedOn` a zdroj. Ruční kontrola B09 proti GTFS BKK a LIS03 proti trase Carris 28E je krok kontrolního seznamu vydání v `README.md`.
- **Publikační miniatury (§12)** se připraví až se skutečnými ilustracemi.
- **Redakční části K7** (strop jednoho chrámu, vhodnost pro děti, samostatnost otázek) ověřil game critic podle [LOG.md](../decisions/LOG.md). Platí, protože importér přenáší obsah z `docs/game/cities/*.md` 1:1. Validátor navíc hlídá limit otázek na stát a vlajku.
- **Test s lidmi (§18)** dělá Petr.
