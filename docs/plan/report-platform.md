# Co se změnilo
Oblast platform přidává tři portálové adaptéry za kontraktem `src/platform/types.ts`: lokální, Poki a CrazyGames. Adaptér se vybírá při buildu přes `createPlatform()` a `VITE_PLATFORM`. Lokální adaptér ve vývojovém režimu simuluje reklamu za odměnu podle parametru adresy (`?ad=completed|cancelled|unavailable|interrupted|duplicate|late`, `?ads=none`), v produkci reklamu nenabízí. Portálové adaptéry načítají SDK až v `init()` s limitem 5 s, slučují signály načítání a hraní, během reklamy do SDK nic neposílají a výsledky SDK převádějí na `completed`, `cancelled` nebo `unavailable` se správným ID pokusu. Nově je i zvuk (Web Audio syntéza) a vibrace v `src/game/feedback/`. Hra je zatím nepoužívá, napojí je oblast app ve vlně 2 podle `docs/specs/platform/spec.md`.

(Zprávu napsal projektový manažer oblasti. Do souboru ji uložil ředitel, protože subagent nesměl zapisovat soubory se zprávou.)

# Akceptační kritéria
| Kritérium | Jak ověřeno | Výsledek |
|---|---|---|
| Lokální adaptér simuluje úspěch, odmítnutí, nedostupnost (výchozí), přerušené video, duplicitní a pozdní callback; `?ads=none` hlásí předem známou nedostupnost; výsledky nesou `attemptId` | `src/platform/local.test.ts`, QA scénáře 1–9 | splněno |
| Produkční lokální build ignoruje parametry adresy a reklamu nenabízí | `local.test.ts`, QA scénář 10 (`vite preview`) | splněno |
| Žádný spot ani průběžná reklama se nespustí sama | `local.test.ts`, `portals.test.ts`, QA 11–12 | splněno |
| Poki a CrazyGames posílají signály podle §12 bez zdvojení, před spotem zastaví hraní, během reklamy nic neposílají | `portals.test.ts`, QA 13–16 | splněno |
| Předem známá nedostupnost na portálech, `init()` se vždy vyřeší | `portals.test.ts`, QA 17–21 | splněno |
| Výsledky SDK se mapují bez odměny při chybě, pozdní a opakované callbacky mají správné `attemptId` | `portals.test.ts`, QA 22–23 | splněno |
| Lokální build neobsahuje SDK, portálový jen SDK svého portálu | ruční build s dočasným vstupem (vývojář, reviewer, QA) | splněno ručně, bez automatického testu |
| `store` všech adaptérů je `localStorage` s prefixem `postcard-trail:` a chyby propouští | `local.test.ts`, `portals.test.ts`, QA 25 | splněno |
| `recordedEvents()` ve vývoji ve všech adaptérech, v produkci prázdné; Poki `measure` bez ID hráče | testy P3 a S7.1, QA 26–28 | splněno |
| Zvuk: čtyři podněty, hlasitost 0,6 po prvním vstupu, okamžité vypnutí, ztlumení po dobu reklamy | `src/game/feedback/feedback.test.ts`, QA 29–35 | splněno |
| Vibrace 25 ms u správné odpovědi a 35 ms u pohlednice podle nastavení | `feedback.test.ts`, QA 36 | splněno |
| lint, typecheck, test, build, build:poki, build:crazygames, test:e2e | PM, reviewer, QA | splněno |

# Kontroly
- lint, typecheck, test (113/113), build, build:poki, build:crazygames, test:e2e: prošly na 8cc1438 (Node 22.20).
- Reviewer balíčků: local 2 kola, feedback 5 kol (spor po třetím kole rozhodl arbitr), portals 3 kola, nakonec bez blocker a major.
- Reviewer celé oblasti: bez blocker a major, 2 minor (otevřené body).
- QA: 37 scénářů, všechny prošly, falešná SDK přes `page.route`.
- Vizuální kontrola: netýká se. Druhý názor (Codex): netýká se.

# Databáze
Beze změny.

# Nové závislosti
Žádné.

# Co ověřeno není
- Skutečná SDK Poki a CrazyGames (podoba `PokiSDK.rewardedBreak`, kódy `adError`, `SDK.environment` v náhledových nástrojích).
- Limit 5 000 ms pro init SDK v náhledových nástrojích portálů.
- Projektové buildy kód platformy zatím neobsahují (`src/main.ts` ho neimportuje).
- Zvuk na iOS Safari a skutečná vibrace na telefonu.
- Node 26.13.1 podle `.nvmrc`.

# Rozhodnutí bez Petra
K potvrzení Petrem:
- Úložiště na CrazyGames je `localStorage` s prefixem, bez CrazyGames Data module. Ověřit požadavek na Data module pro Full Launch.
- Limit 5 000 ms na init SDK ověřit v náhledových nástrojích portálů.

Ostatní rozhodnutí jsou v `docs/decisions/LOG.md` (záznamy „Platform: …“).

# Otevřené body mimo rozsah
- Návrh změny kontraktu: CrazyGames `game.settings.muteAudio` (`portalAudioMuted()`, `onPortalAudioMutedChange()`).
- Upřesnění JSDoc `init` o limitu 5 s.
- Kontrola výstupu buildů na přítomnost SDK po napojení v app.
- Pro app: `unlock()` v handleru vstupu, `rewardedAdsOffered()` po `init()`, `gameplayStart` až v aktivní otázce, vystavit `recordedEvents()` pro Playwright.
- Minor: obranná kontrola `typeof navigator` ve feedbacku; společný `src/platform/portal.ts` pro dva adaptéry.
- Rozpor se zadáním: Poki doporučuje `commercialBreak()`, zadání má průběžné reklamy 0. CrazyGames nechce `gameplayStop` při ztrátě fokusu, hra se ale po skrytí stránky pozastavuje.
