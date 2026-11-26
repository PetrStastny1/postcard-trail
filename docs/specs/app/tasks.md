# Postup oblasti app

Požadavky jsou ve [spec.md](spec.md). Vývojář balíčku zaškrtává hotové kroky a upravuje spec.md v rozsahu svého balíčku. Balíčky jdou postupně, každý staví na předchozím.

## Balíček 1: Kostra a nastavení (`shell`)

- [ ] Spuštění: platforma, `init`, signály načítání, feedback, portálové ztlumení, `GameStorage` s ID karty, odemčení zvuku na každém vstupu, export událostí ve vývoji (A1, A4, A5 export)
- [ ] Načítání v `index.html` s chybou a opakováním, upozornění na nedostupné úložiště (A2, A3)
- [ ] Texty `src/i18n/en.json` a `cs.json`, přepínání jazyka a `lang` dokumentu (A12)
- [ ] Úvod s logem, animací a postupem (C1 bez napojení „Hrát“, mapy, sbírky a denní výzvy)
- [ ] Nastavení se všemi volbami a okamžitým účinkem (A12, A13)
- [ ] Rám okna s × a „Úvod“, dialog s držením a vracením fokusu, Escape (A14)
- [ ] Sdílený e2e pomocník kontroly rozvržení (rozměry, 44 px, překryv, vodorovné posouvání) a e2e testy balíčku

## Balíček 2: Hra (`play`), po balíčku 1

- [ ] Začátek a změna průchodu, „Hrát“ a „Pokračovat“ na úvodu, lazy-load trasy (A15, A16)
- [ ] Herní obrazovka podle prototypu, načítání, chyba, zástupný popisek, přednačtení další scény (B1–B5)
- [ ] Volba, výsledek, odpočet, žolíky, nápovědy (B6, B7, B12)
- [ ] Pauza, přeskočení za video včetně visícího spotu, zvětšení scény (B8–B10)
- [ ] Čas, kontrolní body, viditelnost, vlastnictví mezi kartami, obnova, hotový průchod po obnovení (A6–A11, B11)
- [ ] Konec průchodu a měření (A5, B13; do balíčku 3 vede konec na úvod)
- [ ] E2E testy balíčku včetně kontrol `check-layout` a testu, že otázka neukazuje `Stop.place`

## Balíček 3: Mapa, souhrny, sbírka a denní výzva (`screens`), po balíčku 2

- [ ] Mapa se schématem Evropy, skupinami, seznamem a detailem města (C2)
- [ ] Souhrn města a napojení konce městského průchodu (C3, B13)
- [ ] Sbírka a detail karty (C4)
- [ ] Denní výzva a denní souhrn, napojení z úvodu (C5, C6)
- [ ] E2E testy balíčku včetně `Stop.place` v denní výzvě

## Balíček 4: Celé toky, přístupnost a výkon (`quality`), po balíčku 3

- [ ] K3: Paříž na desktopu a v mobilním zobrazení, Londýn, zamčený Řím, obnova otázky a výsledku, jazyk a orientace, stav s 20 městy
- [ ] D1: všechny obrazovky na minimálních a Poki rozměrech, delší překlad, rodič se neposouvá
- [ ] D2, D3: kontrast a klávesnice na všech obrazovkách, reduced motion a Bez animací
- [ ] D4: startovní payload, velikost buildu, lazy-load tras a přednačtení jedné scény
- [ ] UI část K5 v e2e se všemi režimy `?ad` a `?ads=none`
