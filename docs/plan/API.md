# Rozhraní mezi oblastmi

Kontrakty v kódu: [`src/content/types.ts`](../../src/content/types.ts) a [`src/platform/types.ts`](../../src/platform/types.ts). Mění je jen ředitel. Oblast, která potřebuje změnu, se zastaví a vrátí návrh.

Sdílené soubory `package.json`, `package-lock.json`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.github/` a `index.html` (do vlny 2) vlastní ředitel. Oblast, která potřebuje závislost nebo skript, si o ně řekne.

## Skripty

| Skript | Co dělá |
|---|---|
| `npm run validate:content` | `tools/content/validate.ts`, neplatný obsah ukončí proces s chybou. Je součástí `test` i `build`. |
| `npm run content:import` | `tools/content/import.ts`, převede `docs/game/cities/*.md` do `src/content/routes/*.json` a `src/content/catalog.json`. |
| `npm run content:placeholders` | `tools/content/placeholders.ts`, vytvoří zástupné scény a `public/scenes/placeholders.json`. |
| `npm run build:poki`, `npm run build:crazygames` | Portálový build (`VITE_PLATFORM`), relativní `base`. |
| `npm test` | Validace obsahu a `node --test` nad `src/**/*.test.ts` a `tools/**/*.test.ts`. |
| `npm run test:e2e` | Playwright, port z `E2E_PORT`. |

## content → logic, app

- `src/content/catalog.json` a `src/content/catalog.ts`: `export const catalog: Catalog`. Malý, načítá se staticky. Datum `effectiveUtcDate` první verze je jen tady.
- `src/content/routes/<cityId>.json`: generovaná data trasy, commitují se. Importér přenáší texty z `docs/game/cities/*.md` 1:1.
- `src/content/index.ts`: `loadRoute(cityId: string): Promise<Route>`, každá trasa ve vlastním chunku (lazy-load).
- `public/scenes/<stopId>.webp`: scéna 1280 × 1280, cíl do 150 kB. Zástupné i finální mají stejnou cestu a formát.
- `public/scenes/placeholders.json`: `{ "stopIds": string[] }`, seznam scén, které jsou zatím zástupné. Po dodání finální scény se ID ze seznamu odebere. Aplikace podle něj zobrazí pod scénou viditelný `sceneAlt`.
- Validátor kontroluje i texty `src/i18n/*.json`, pokud existují (žádný text před odpovědí neobsahuje název správné volby). Oblast app ho musí udržet zelený.

## logic → app

Logika je čistá: bez DOM, bez `Date.now()`, `Math.random()` a bez přístupu k úložišti. Čas, náhodu, ID a úložiště dostává zvenku. Přesné podpisy dokumentuje oblast logic v `docs/specs/logic/spec.md` a app je po integraci vlny 1 používá.

- **Průchod** (`src/game/logic/run.ts`): start městské trasy z `Route`, nastavení, zdroje náhody a ID průchodu; reducer `reduceRun(run, action)`. Akce v běžící otázce nesou `elapsedMs` od posledně započtené akce, takže reducer nejdřív vyhodnotí vypršení. Akce nesou ID kola a pokusu o reklamu, opakované vstupy se ignorují.
- **Postup** (`src/game/logic/progress.ts`): hvězdy, odemčení, pohlednice, idempotentní dokončení průchodu, součty pro úvod a mapu.
- **Denní výzva** (`src/game/logic/daily.ts`): volba verze katalogu, města a první zastávky, start denní výzvy z data UTC a katalogu (`startDailyRun`), FNV-1a 32bit, permutace voleb, série dnů.
- **Uložení** (`src/game/storage/`): nad `KeyValueStore` z adaptéru. Verzované schéma, validace po oddílech, migrace, slučování odměn, paměťová náhrada s jednorázovým upozorněním. Vlastnictví průchodu mezi kartami řeší čistou funkcí nad uloženými daty a ID karty. Události prohlížeče (`storage`, `visibilitychange`) obsluhuje app a volá tyto funkce.

## platform → app

- `src/platform/index.ts`: `createPlatform(): PlatformAdapter` podle `import.meta.env.VITE_PLATFORM` (`local` výchozí, `poki`, `crazygames`).
- Lokální adaptér ve vývojovém režimu (`import.meta.env.DEV`, tedy i v e2e) čte chování reklamy z parametru adresy `?ad=completed|cancelled|unavailable|interrupted|duplicate|late` a `?ads=none` pro předem známou nedostupnost. V produkčním buildu bez SDK hlásí nedostupnost. Události měření drží v paměti a ve vývojovém režimu je vystaví pro export a testy.
- `store` lokálního adaptéru je `localStorage` pod klíčem s prefixem `postcard-trail:`.
- `src/game/feedback/`: zvuk (Web Audio syntéza) a vibrace pro podněty `choice`, `correct`, `wrong`, `postcard`. Hlasitost, ztlumení po dobu reklamy a respektování nastavení.
- Portálové ztlumení: app po `await init()` přečte `portalAudioMuted()`, předá ho feedbacku a odebírá změny přes `onPortalAudioMutedChange()`. Ve feedbacku je to samostatný důvod ztlumení, který nepřepisuje uložené herní nastavení zvuku a má před ním přednost.

## Prostředí oblastí

| Oblast | Worktree | Větev | `E2E_PORT` |
|---|---|---|---|
| content | `.worktrees/content` | `area/content` | 43311 |
| logic | `.worktrees/logic` | `area/logic` | 43321 |
| platform | `.worktrees/platform` | `area/platform` | 43331 |
| app | `.worktrees/app` | `area/app` | 43341 |

Hra nemá databázi ani backend.
