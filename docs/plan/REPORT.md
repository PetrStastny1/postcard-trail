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
| lint, typecheck, test, build, build:poki, build:crazygames, test:e2e | lokálně na macOS a v linuxovém kontejneru (DejaVu Sans) na `97a117b` | splněno (454 unit, 407 e2e) |

## Kontroly celku
- **Lokálně na `97a117b`** (Node 22.20, macOS a linuxový kontejner s DejaVu Sans): `npm ci`, lint, typecheck, test 454/454, build, build:poki, build:crazygames, test:e2e 407/407.
- **Reviewer** (diff `main...release/v1` na 66a9a6c): 1 blocker (CrazyGames `loadingStart`), 4 minor. Opravy zkontrolované ve dvou kolech bez blocker a major.
- **QA** napříč oblastmi (produkční build, `vite preview`, portálové buildy v iframe s falešnými SDK): 37 scénářů, 1 major (stejný CrazyGames). Opravy: 41 a 18 scénářů, nakonec bez nálezů.
- **Druhý názor (Codex):** celý diff (1,7 M znaků) přesáhl limit vstupu. Codex proto dostal diff bez generovaných dat tras, dokumentace, scén, lockfile a testů (383 k znaků) a vynechané soubory si mohl číst v repozitáři. Našel 5 major a 1 minor, opraveno: CrazyGames `loadingStart`, zahození jen potvrzeného průchodu, denní výzva jednou za den i při souběhu, start trasy pod otevřeným Nastavením, uložený průchod nesedící na trasu. Na opravy pak hlásil 3 major. Arbitr je zařadil jako známá omezení (viz níže) a nechal opravit jen chybovou obrazovku trasy pod Nastavením.
- **Vizuální kontrola:** u oblasti app tři kola (všechny obrazovky, 6 velikostí, EN i CS), u oprav celku nové upozornění, Nastavení během načítání a pauza. Bez blocker a major.
- **CI:** do `.github/workflows/ci.yml` přibyly `build:poki` a `build:crazygames`. Výsledek CI pull requestu: viz popis PR.

## Opravy po prvním běhu CI na PR #1
CI na `release/v1` poprvé běželo až s tímto PR a spadlo ve dvou jobech:
- **e2e (11 testů):** 10 testů rozvržení selhalo, protože runner ubuntu-latest kreslí systémové písmo jako DejaVu Sans (asi o 18 % širší než macOS). Stejné šíře písma mají i hráči na části Androidu, Windows a Linuxu. Opraveno v `src/styles/` (verdikt nad větou, užší žolíky na šířku a pod 360 px, menší postup na úvodu v nízkém landscape). Jedenáctý test selhal na obsazeném portu: na Linuxu leží 43302 v rozsahu dočasných portů, preview proto teď při obsazení posune port výš.
- **Semgrep:** akce nebyly připnuté na SHA a Dependabot neměl cooldown (opravil ředitel), `RegExp` se sestavoval z proměnné v e2e a ve validátoru (přepsáno bez regulárních výrazů z proměnných, chování validátoru ověřeno fuzz testem na 300 000 dvojicích).
- **Zvětšení scény ve výsledku na výšku:** měření všech 200 zastávek ukázalo, že na 320 × 568 bylo tlačítko zvětšení ve výsledku mimo zobrazení u 183 ze 400 výsledků s DejaVu a u 80 ze 400 i na macOS. E2E to dřív nezachytily, protože testovaly jen Paříž. Podle rozhodnutí arbitra je ve výsledku na výšku zvětšení teď ve výsledkovém pásu nad „Další“ a scéna zůstává kolem 200 px. Po změně jednorázové měření všech 200 zastávek (EN i CS, chybná odpověď, 320 × 568, 375 × 812, 568 × 320) prošlo: 0 z 1200 chyb na macOS i s DejaVu, zvětšení nejméně 302 px pod horní lištou. E2E nově pokrývají 8 nejhorších zastávek, `check-layout.mjs` hlídá právě jedno viditelné zvětšení. Prototyp a schválené screenshoty výsledku v `docs/design/approved/` jsou přegenerované.
- Ověřeno lokálně na macOS, v oficiálním obrazu Playwrightu `v1.65.1-noble` a v obrazu s DejaVu Sans: lint, typecheck, test 454/454, tři buildy, e2e 407/407; semgrep `p/default --error` 0 nálezů. Reviewer, QA a vizuální kontrola bez blocker a major.

## Co ověřeno není
- Skutečná SDK Poki a CrazyGames a jejich náhledové nástroje (jen falešná SDK se stejným rozhraním).
- Jiné prohlížeče než Chromium, skutečná zařízení, čtečka obrazovky, zvuk a vibrace na telefonu, 60 fps na středním mobilu.
- Části K7 závislé na finálních ilustracích, publikační miniatury, test s lidmi (§18).
- Trvalé selhání celého `localStorage` včetně zápisu kontrolního bodu summary (po reloadu se nabídne „Pokračovat“ na posledním výsledku).

## Rozhodnutí bez Petra (tato relace)
Všechna jsou v `docs/decisions/LOG.md`, žádné není k potvrzení:
- **App A11, poslední kolo oprav** (27. 11.): po třetím kole s major v A11 čtvrté a poslední kolo s pevným rozsahem; nové minory k A11 jen do otevřených bodů.
- **Nálezy Codexu na opravy celku** (27. 11.): souběh karet mezi kontrolou a zápisem (zahození, denní výzva) je známé omezení, protože vše běží synchronně v jedné úloze JS a compare-and-set nad `localStorage` atomicitu mezi kartami nezaručí. Dokončení hotového průchodu ve fázi summary bez ověření proti trase je záměrná výjimka A11/A15: odměna závisí jen na `cityId` a `correct`.
- **Zvětšení ve výsledku na výšku** (28. 11.): po měření všech 200 zastávek se zvětšení přesunulo do výsledkového pásu, scéna zůstává kolem 200 px. Nahrazuje dřívější rozhodnutí téhož dne o zmenšení scény na úzkém portrétu, jeho bod k potvrzení odpadá. Změna umístění tlačítka je tímto uvedena k Petrovu schválení PR.
- Ředitel: nové upozornění „uložená trasa nesedí na tuto verzi a byla odstraněna“ (`storage.runRemoved`) jako vlastní pruh vzhledu A3, protože jednorázové upozornění A3 je ve storage a mluví o neukládajícím prohlížeči.
- Ředitel: kritérium „obnova po reloadu“ u ověření uloženého průchodu proti trase znamená „Pokračovat“ po novém načtení stránky, ne automatické dokončení ve fázi summary.

## Otevřené body
- **Známá omezení (arbitr):** souběh dvou karet mezi synchronní kontrolou a zápisem při zahození a u denní výzvy; průchod ve fázi summary se dokončí bez ověření proti trase.
- Spec A10 neuvádí výjimku z A11: karta s „Route paused“ zapisuje dokončení hotového průchodu z jiné karty.
- Otevřený detail města a okno změny průchodu se po dokončení průchodu v jiné kartě nepřekreslí (data správná, popsáno v A11).
- Odstranění nesedícího průchodu může po nasazení smazat průchod, který jiná karta s novým buildem hraje (A15 to připouští).
- Chybějící e2e: zahození u denní výzvy dokončené jinou kartou, zmizelý potvrzený průchod, Nastavení během načítání po „Pokračovat“. Obranné větve `run === null` v `src/app/app.ts`. Negativní tvrzení po `waitForTimeout`.
- `e2e/contrast.spec.ts:119` je pod zátěží nestabilní (měří „Nová pohlednice“ během animace, 1.23:1). Samostatně 36/36 a v klidném běhu celé sady prochází. Sledovat v CI.
- Ze změn po CI: na tabletu a čtvercovém okně na výšku (768 × 1024, 900 × 900, 1024 × 1366) se výsledek nově posune o 13–19 px a štítek obtížnosti se ořízne; po otočení zařízení s otevřeným zvětšením spadne fokus na `body`; mezi zvětšením a „Další“ je na 375 × 812 u krátké věty jen 5 px; `role="status"` výsledku obsahuje i tlačítko zvětšení; spec B1 nepopisuje pás výsledku na výšku; užší žolíky a menší postup úvodu nejsou v prototypu `docs/design/prototype/`.
- S DejaVu Sans protíná oblouk loga horní část slova „Postcard“; nápověda 50:50 na 320 × 568 EN má tři řádky.
- Obsah: věta výsledku AMS03 EN opakuje „Nieuwezijds Voorburgwal“.
- Validátor nekontroluje dekódovatelnost WebP (jen hlavičku).
- Escape na chybě scény nic nedělá, na chybě trasy funguje jako ×.
- `Settings.volume` ve schématu v1 nikdo nečte (feedback má pevnou hlasitost).
- Vzhled: hlavní tlačítka oken mají 44 a 56 px; popisek scény na 568 × 320 se ořízne; v pauze se po načtení scény posunou tlačítka, když přibude „Přeskočit za video“; pruh upozornění má při třech řádcích malý svislý odstup; denní souhrn má Úvod dvakrát; pruh načítání nebere `safe-area-inset-top`.
- Z oblastí: návrh `portalAudioMuted` byl zapracován; Poki doporučuje `commercialBreak()`, zadání má 0 průběžných reklam; CrazyGames nechce `gameplayStop` při ztrátě fokusu, hra se po skrytí stránky pozastavuje.
