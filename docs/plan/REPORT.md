# Postcard Trail – první verze: předávací zpráva ředitele

## K potvrzení Petrem před vydáním
- **Název Postcard Trail.** Přesná katalogová shoda nenalezena, na Google Play a App Storu jsou podobné názvy v množném čísle. Před veřejným vydáním posoudit zaměnitelnost (LOG.md 26. 11. 2026).
- **Datum účinnosti katalogu `2026-12-01`** (jen v `src/content/catalog.json`). Potvrzeno jako pracovní datum, před vydáním ověřit proti skutečnému dni vydání.
- **Limit 5 s na `init()` SDK portálu.** Ověřit v náhledových nástrojích Poki a CrazyGames při nahrávání.
- **Úložiště na CrazyGames** je `localStorage` bez Data module (potvrzeno pro první verzi). Ověřit, jestli Full Launch Data module nevyžaduje.
- Ruční body kontrolního seznamu vydání v `README.md` („Kontrolní seznam před vydáním“): B09 proti GTFS BKK, LIS03 proti trase Carris 28E, upload checky portálů.

Ostatní dříve otevřená rozhodnutí Petr potvrdil (zástupná scéna s popisem, scéna kolem 200 px na nejmenších displejích, světlá paleta bez tmavého režimu, visící spot za odměnu po 90 s).

## Co je hotové
Hratelná první verze HTML5 hry podle `docs/game/BRIEF.md`: 20 evropských metropolí s 200 zastávkami v EN a CS, mapa, sbírka pohlednic, denní výzva, žolíky 50:50, +10 s a přeskočení za video přes portálový adaptér, nečasovaný režim, lokální uložení postupu s obnovou po reloadu a mezi kartami. Statický web pro GitHub Pages (`/postcard-trail/`) a portálové buildy pro Poki a CrazyGames. Ilustrace jsou zástupné, skutečné obrázky se dodají výměnou souborů `public/scenes/<stopId>.webp`.

## Stav oblastí
| Oblast | Zpráva | Stav |
|---|---|---|
| content | [report-content.md](report-content.md) | sloučeno, bez otevřených blocker/major |
| logic | [report-logic.md](report-logic.md) | sloučeno, bez otevřených blocker/major |
| platform | [report-platform.md](report-platform.md) | sloučeno, bez otevřených blocker/major |
| app | [report-app.md](report-app.md) | sloučeno; relace manažera spadla před předáním, ředitel spustil kontrolu oblasti znovu a nechal opravit 2 + 1 + 1 major ve čtyřech kolech (poslední kolo A11 podle arbitra) |

## Akceptační kritéria celku
| Kritérium | Jak ověřeno | Výsledek |
|---|---|---|
| K1 Obsah | `validate:content` v `test` i `build`; QA celku 19 záměrných poškození a prohození pořadí měst zastaví build; B09 v CS přesně | splněno |
| K2 Pravidla | unit testy logiky; QA celku: nula správných, opakování a zavření po posledním kliknutí neduplikují odměnu, dvojklik, nečasovaný režim | splněno |
| K3 Celý tok v prohlížeči | `e2e/flows.spec.ts`, `screens.spec.ts`; QA celku v produkčním buildu na desktopu a 320 × 568 / 568 × 320, 20 měst = 20 pohlednic a 60 hvězd | splněno |
| K4 Denní výzva | unit testy rozvrhu a FNV-1a; QA celku nezávislým výpočtem pořadí voleb, přechod přes půlnoc UTC, zamčené město, výsledek nemění sbírku | splněno |
| K5 Reklama | lokální adaptér všechny režimy; Poki a CrazyGames s falešným SDK v iframe. Kontrola celku našla blocker: CrazyGames neposílal `loadingStart`, opraveno (adaptér pošle odložený signál po připojení) a pokryto integračním testem přes `startGame` | splněno po opravě |
| K6 Ovládání a přístupnost | e2e kontrast, klávesnice, 44 px, minimální a Poki velikosti s rodičem 3000 px, reduced motion; QA celku 200 zastávek v CS i EN | splněno |
| K7 Výkon a texty | startovní payload ~39 kB, build 5,2 MB, lazy-load jedné trasy a přednačtení jedné scény; žádný text ani alt neobsahuje správnou volbu ani `place` (QA přes 200 zastávek). Části závislé na ilustracích odloženy | splněno v rozsahu verze |
| lint, typecheck, test, build, build:poki, build:crazygames, test:e2e | lokálně na `0e40b4d` | splněno (453 unit, 390 e2e) |

## Kontroly celku
- **Lokálně na `0e40b4d`** (Node 22.20): `npm ci`, lint, typecheck, test 453/453, build, build:poki, build:crazygames, test:e2e 390/390.
- **Reviewer** (diff `main...release/v1` na 66a9a6c): 1 blocker (CrazyGames `loadingStart`), 4 minor. Opravy zkontrolované ve dvou kolech bez blocker a major.
- **QA** napříč oblastmi (produkční build, `vite preview`, portálové buildy v iframe s falešnými SDK): 37 scénářů, 1 major (stejný CrazyGames). Opravy: 41 a 18 scénářů, nakonec bez nálezů.
- **Druhý názor (Codex):** celý diff (1,7 M znaků) přesáhl limit vstupu. Codex proto dostal diff bez generovaných dat tras, dokumentace, scén, lockfile a testů (383 k znaků) a vynechané soubory si mohl číst v repozitáři. Našel 5 major a 1 minor, opraveno: CrazyGames `loadingStart`, zahození jen potvrzeného průchodu, denní výzva jednou za den i při souběhu, start trasy pod otevřeným Nastavením, uložený průchod nesedící na trasu. Na opravy pak hlásil 3 major. Arbitr je zařadil jako známá omezení (viz níže) a nechal opravit jen chybovou obrazovku trasy pod Nastavením.
- **Vizuální kontrola:** u oblasti app tři kola (všechny obrazovky, 6 velikostí, EN i CS), u oprav celku nové upozornění, Nastavení během načítání a pauza. Bez blocker a major.
- **CI:** do `.github/workflows/ci.yml` přibyly `build:poki` a `build:crazygames`. Výsledek CI pull requestu: viz popis PR.

## Co ověřeno není
- Skutečná SDK Poki a CrazyGames a jejich náhledové nástroje (jen falešná SDK se stejným rozhraním).
- Jiné prohlížeče než Chromium, skutečná zařízení, čtečka obrazovky, zvuk a vibrace na telefonu, 60 fps na středním mobilu.
- Části K7 závislé na finálních ilustracích, publikační miniatury, test s lidmi (§18).
- Trvalé selhání celého `localStorage` včetně zápisu kontrolního bodu summary (po reloadu se nabídne „Pokračovat“ na posledním výsledku).

## Rozhodnutí bez Petra (tato relace)
Všechna jsou v `docs/decisions/LOG.md`, žádné není k potvrzení:
- **App A11, poslední kolo oprav** (27. 11.): po třetím kole s major v A11 čtvrté a poslední kolo s pevným rozsahem; nové minory k A11 jen do otevřených bodů.
- **Nálezy Codexu na opravy celku** (27. 11.): souběh karet mezi kontrolou a zápisem (zahození, denní výzva) je známé omezení, protože vše běží synchronně v jedné úloze JS a compare-and-set nad `localStorage` atomicitu mezi kartami nezaručí. Dokončení hotového průchodu ve fázi summary bez ověření proti trase je záměrná výjimka A11/A15: odměna závisí jen na `cityId` a `correct`.
- Ředitel: nové upozornění „uložená trasa nesedí na tuto verzi a byla odstraněna“ (`storage.runRemoved`) jako vlastní pruh vzhledu A3, protože jednorázové upozornění A3 je ve storage a mluví o neukládajícím prohlížeči.
- Ředitel: kritérium „obnova po reloadu“ u ověření uloženého průchodu proti trase znamená „Pokračovat“ po novém načtení stránky, ne automatické dokončení ve fázi summary.

## Otevřené body
- **Známá omezení (arbitr):** souběh dvou karet mezi synchronní kontrolou a zápisem při zahození a u denní výzvy; průchod ve fázi summary se dokončí bez ověření proti trase.
- Spec A10 neuvádí výjimku z A11: karta s „Route paused“ zapisuje dokončení hotového průchodu z jiné karty.
- Otevřený detail města a okno změny průchodu se po dokončení průchodu v jiné kartě nepřekreslí (data správná, popsáno v A11).
- Odstranění nesedícího průchodu může po nasazení smazat průchod, který jiná karta s novým buildem hraje (A15 to připouští).
- Chybějící e2e: zahození u denní výzvy dokončené jinou kartou, zmizelý potvrzený průchod, Nastavení během načítání po „Pokračovat“. Obranné větve `run === null` v `src/app/app.ts`. Negativní tvrzení po `waitForTimeout`.
- `e2e/contrast.spec.ts:119` jednou selhal při plném běhu se 6 workery, samostatně i v dalším běhu prošel. Sledovat v CI.
- Validátor nekontroluje dekódovatelnost WebP (jen hlavičku).
- Escape na chybě scény nic nedělá, na chybě trasy funguje jako ×.
- `Settings.volume` ve schématu v1 nikdo nečte (feedback má pevnou hlasitost).
- Vzhled: hlavní tlačítka oken mají 44 a 56 px; popisek scény na 568 × 320 se ořízne; v pauze se po načtení scény posunou tlačítka, když přibude „Přeskočit za video“; pruh upozornění má při třech řádcích malý svislý odstup; denní souhrn má Úvod dvakrát; pruh načítání nebere `safe-area-inset-top`.
- Z oblastí: návrh `portalAudioMuted` byl zapracován; Poki doporučuje `commercialBreak()`, zadání má 0 průběžných reklam; CrazyGames nechce `gameplayStop` při ztrátě fokusu, hra se po skrytí stránky pozastavuje.
