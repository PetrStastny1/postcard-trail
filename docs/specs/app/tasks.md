# Postup oblasti app

Požadavky jsou ve [spec.md](spec.md). Vývojář balíčku zaškrtává hotové kroky a upravuje spec.md v rozsahu svého balíčku. Balíčky 3 a 4 mohou běžet souběžně, ostatní jdou postupně.

## Balíček 1: Kostra a nastavení (`shell`)

- [x] Spuštění: platforma, `init`, signály načítání, feedback, portálové ztlumení, `GameStorage` s ID karty, odemčení zvuku na každém vstupu, export událostí ve vývoji (A1, A4, A5 export)
- [x] Načítání v `index.html` s chybou a opakováním, upozornění na nedostupné úložiště (A2, A3)
- [x] Texty `src/i18n/en.json` a `cs.json`, přepínání jazyka a `lang` dokumentu (A12)
- [x] Úvod s logem, animací a postupem (C1 bez napojení „Hrát“, mapy, sbírky a denní výzvy)
- [x] Nastavení se všemi volbami a okamžitým účinkem (A12, A13)
- [x] Rám okna s × a „Úvod“, dialog s držením a vracením fokusu, Escape (A14)
- [x] Sdílený e2e pomocník kontroly rozvržení (rozměry, 44 px, překryv, vodorovné posouvání) a e2e testy balíčku

## Balíček 2: Hra (`play`), po balíčku 1

- [x] Začátek městského průchodu, „Hrát“ a „Pokračovat“ na úvodu, lazy-load trasy (A16)
- [x] Herní obrazovka podle prototypu, načítání, chyba, zástupný popisek, přednačtení další scény (B1–B5)
- [x] Volba, výsledek, odpočet, žolíky 50:50 a +10 s, nápovědy (B6, B7, B12)
- [x] Pauza bez přeskočení za video, zvětšení scény (B8, B10)
- [x] Čas, kontrolní body, viditelnost, vlastnictví mezi kartami, obnova, hotový průchod po obnovení (A6–A11, B11)
- [x] Konec průchodu a měření (A5, B13; do balíčku 4 vede konec na úvod)
- [x] E2E testy balíčku včetně kontrol `check-layout` a testu, že otázka neukazuje `Stop.place`

## Balíček 3: Přeskočení za video (`skip`), po balíčku 2

- [x] „Přeskočit za video“ v pauze podle `canUseSkip` a `rewardedAdsOffered()`, nápověda při první sérii 3 (B8)
- [x] Potvrzení, blokace během spotu, výsledky `completed`, `cancelled`, `unavailable`, visící spot po 90 s (B9)
- [x] E2E se všemi režimy `?ad` a `?ads=none` (UI část K5)

## Balíček 4: Mapa, souhrny, sbírka a denní výzva (`screens`), po balíčku 2

- [ ] Potvrzení změny průchodu (A15)
- [ ] Mapa se schématem Evropy, skupinami, seznamem a detailem města (C2)
- [ ] Souhrn města a napojení konce městského průchodu (C3, B13)
- [ ] Sbírka a detail karty (C4)
- [ ] Denní výzva a denní souhrn, napojení z úvodu (C5, C6)
- [ ] E2E testy balíčku včetně `Stop.place` v denní výzvě

## Balíček 5: Celé toky, přístupnost a výkon (`quality`), po balíčcích 3 a 4

- [ ] K3: Paříž na desktopu a v mobilním zobrazení, Londýn, zamčený Řím, obnova otázky a výsledku, jazyk a orientace, stav s 20 městy
- [ ] D1: všechny obrazovky na minimálních a Poki rozměrech, delší překlad, rodič se neposouvá
- [ ] D2, D3: kontrast a klávesnice na všech obrazovkách, reduced motion a Bez animací
- [ ] D4: startovní payload, velikost buildu, lazy-load tras a přednačtení jedné scény
