# Co se změnilo
Oblast app dává hře všechny obrazovky z BRIEF §10 a aplikační vrstvu nad oblastmi content, logic a platform. Hráč projde načítání, úvod s animací, mapu s detailem města, otázky s výsledkem, odpočtem, žolíky, pauzou a zvětšením scény, přeskočení za video s potvrzením, souhrn města, sbírku s detailem karty, denní výzvu a její souhrn, nastavení a potvrzení změny průchodu. Postup se ukládá do kontrolních bodů, přežije reload, skrytí stránky i druhou kartu a hotový průchod se po obnovení sám dokončí bez zdvojení odměn. E2E testy pokrývají celé toky na desktopu i mobilu, klávesnici, kontrast, minimální a Poki velikosti a výkon.

(Zprávu sestavil ředitel. Relace projektového manažera spadla před předáním, proto ředitel znovu spustil nezávislou kontrolu celé oblasti a doplnil opravy jejích nálezů ve větvi `wp/app/handoff-fixes`.)

# Akceptační kritéria
| Kritérium | Jak ověřeno | Výsledek |
|---|---|---|
| K3: Paříž na desktopu i mobilu, Londýn odemčený, Řím zamčený, obnova otázky i výsledku, jazyk a orientace, 20 měst = 20 pohlednic, nejvýš 60 hvězd, mapa jako další krok | `e2e/flows.spec.ts`, `e2e/screens.spec.ts`, QA scénáře 1–11 | splněno |
| K6: křížek a Úvod v každém okně, klávesnice §4, kontrast AA, 44 px, 320 × 568 a 568 × 320, Poki 640 × 360 / 836 × 470 / 1031 × 580 bez posouvání rodiče, CS layout, reduced motion a Bez animací | `keyboard`, `contrast`, `windows-layout`, `play-layout`, `screens-layout`, `poki`, `motion` spec, QA 13–14, 39–41, vizuální kontrola | splněno (zvětšení scény dostalo Úvod v kole oprav 1) |
| K7: payload do 700 kB, build do 36 MB, lazy-load tras, přednačtení jedné scény, validátor zelený | `e2e/performance.spec.ts`: 37,6 kB gzip, build 5,0 MB, úvod interaktivní za ~290 ms při 5 Mb/s a RTT 100 ms; QA 17 | splněno |
| K5 (UI): potvrzení videa, blokace, nedostupnost a zrušení, skrytý žolík při `?ads=none`, série a skóre zachované, duplicitní a pozdní výsledek, visící spot po 90 s | `e2e/skip.spec.ts`, QA 18–25 | splněno |
| Otázka neukazuje `Stop.place` v UI ani přístupných názvech, i v denní výzvě a po obnovení | `e2e/play.spec.ts`, `daily.spec.ts`, QA 2–4, review (žádné použití `place` v app) | splněno |
| Obrazovka otázky projde `check-layout` (`inspectPlayLayout`) | `e2e/play-layout.spec.ts`, `windows-layout.spec.ts` | splněno |
| Aplikační vrstva A1–A16 včetně hotového průchodu ve fázi summary | e2e, unit `runController.test.ts`, QA 26–38, kola oprav 1–4, `e2e/finished-run-tabs.spec.ts` | splněno, se známým omezením u otevřených oken (viz níže) |
| Obrazovky §10, zástupný popisek scény čtený jednou | e2e, QA 15–17, 29–32, vizuální kontrola 251 + 156 + 102 snímků | splněno |
| lint, typecheck, test, build, test:e2e; spec odpovídá kódu; tasks.md zaškrtnutý | viz Kontroly | splněno (minor v A10, viz otevřené body) |

# Kontroly
- lint, typecheck, test (446/446), build, build:poki, build:crazygames, test:e2e (379/379): prošly na 462fa40 (větev oprav), Node 22.20. Na 2f8a656 před opravami 445 unit a 352 e2e.
- Reviewer oblasti (diff `01f9afa...2f8a656`): 1 major (zvětšení scény bez Úvod), 3 minor. Opravy kola 1–4 kontroloval reviewer na diff každého kola: kolo 1 major (karta otevřená dřív nepozná fázi summary), kolo 2 bez major, kolo 3 major (karta s „Route paused“), kolo 4 bez blocker a major, 1 minor.
- QA oblasti: 45 scénářů, 1 major (hotový průchod se při selhání zápisu odměn neuložil ve fázi summary). Kola oprav: kolo 1 bez major, kolo 2 major (zahození z okna změny průchodu otevřeného dřív), kolo 3 major (stejný jako reviewer), kolo 4 bez nálezů (13 vlastních scénářů).
- Po třetím kole s major v A11 rozhodl arbitr o čtvrtém a posledním kole s pevným rozsahem (LOG.md 27. 11. 2026).
- Vizuální kontrola: oblast bez blocker a major, 11 minor (8 opraveno v kole 1), kolo 1 3 minor (opraveno v kole 2), kolo 2 bez nálezů. Snímky v scratchpadu relace (`visual-app/`, `visual-app-fixes/`, `visual-app-fixes2/`).
- Druhý názor (Codex): proběhne v kontrole celku.
- Limit jednoho řádku podmínky denní výzvy v `e2e/shell.spec.ts` padl záměrně: podmínka je nově pod dlaždicí v jejím sloupci a na úzkých displejích má dva řádky. Test místo toho ověřuje polohu, šířku a odstup.

# Databáze
Beze změny (hra nemá databázi, schéma uložení v `src/game/storage/` se neměnilo).

# Nové závislosti
Žádné.

# Co ověřeno není
- Skutečná SDK Poki a CrazyGames v náhledových nástrojích (jen falešné SDK přes `page.route`), portálové ztlumení CrazyGames ručně.
- Jiné prohlížeče než Chromium, skutečná zařízení, zvuk a vibrace na telefonu.
- Trvalé selhání celého `localStorage` včetně zápisu kontrolního bodu summary: po reloadu se nabídne „Pokračovat“ na posledním výsledku.
- Node 26.13.1 podle `.nvmrc` lokálně (ověří CI).

# Rozhodnutí bez Petra
K potvrzení Petrem: žádné nové. Visící spot za odměnu (90 s) Petr potvrdil 27. 11. 2026.

Ostatní rozhodnutí oblasti jsou v `docs/decisions/LOG.md` (záznamy „App: …“): automatické dokončení hotového průchodu po obnovení, výsledek bez `Stop.place`, poslední kolo oprav A11.

# Otevřené body mimo rozsah
- Spec A10 neuvádí výjimku z A11: karta s „Route paused“ zapisuje dokončení hotového průchodu z jiné karty (reviewer kolo 4, minor, podle arbitra jen zápis).
- Otevřený detail města a okno změny průchodu se po dokončení průchodu v jiné kartě nepřekreslí, data jsou správná (popsáno ve spec A11).
- Hlavní tlačítka oken mají dvě velikosti (44 px a 56 px), sjednotit.
- Popisek zástupné scény se na 568 × 320 ořízne na dva řádky; celý je ve zvětšení. Zvážit kratší `sceneAlt` nebo potvrdit.
- Denní souhrn má Úvod v liště i jako vedlejší tlačítko; text popisku ve zvětšení na 320 × 568 zarovnaný vlevo.
- Pruh načítání trasy nebere `env(safe-area-inset-top)`; spuštěné tlačítko se nijak nezmění.
- Teoretický souběh: karta s „Route paused“ může dokončit průchod podruhé během úspěšného dokončení v jiné kartě. Dokončení je idempotentní a tiché.
