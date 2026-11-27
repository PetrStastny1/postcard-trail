# Postcard Trail

HTML5 zeměpisně-kulturní kvíz: deset ilustrovaných zastávek evropské metropole, pohlednice za každé město, denní výzva. Zadání je v [docs/game/BRIEF.md](docs/game/BRIEF.md), plán stavby v [docs/plan/PLAN.md](docs/plan/PLAN.md).

## Spuštění

Potřebuješ Node.js podle `.nvmrc` (funguje i 22.18+).

```bash
npm ci
npm run dev            # http://localhost:5173
```

## Kontroly

```bash
npm run lint
npm run typecheck
npm test               # validace obsahu + unit testy
npm run build          # validace obsahu + build pro GitHub Pages (base /postcard-trail/)
npx playwright install chromium
npm run test:e2e       # port E2E_PORT, výchozí 43301
```

Portálové buildy: `npm run build:poki`, `npm run build:crazygames`. Proměnné prostředí jsou v `.env.example`.

## Nasazení

Push do `main` spustí workflow `Deploy to GitHub Pages` a hra je na https://petrstastny1.github.io/postcard-trail/. Do `main` se dostává jen schválený pull request.

## Kontrolní seznam před vydáním

- Ověřit `effectiveUtcDate` první verze katalogu v `src/content/catalog.json` proti skutečnému dni vydání.
- Ověřit měnící se fakta: B09 proti statickému plánu GTFS BKK, LIS03 proti trase Carris 28E. Při změně upravit městský soubor a znovu spustit `npm run content:import`.
- Ověřit podmínky pro kresbu Atomia (BRIEF §17) a název Postcard Trail.
- Při nahrávání na Poki a CrazyGames ověřit v jejich náhledových nástrojích, že SDK stihne inicializaci do limitu 5 s.
- Na CrazyGames se v první verzi ukládá do `localStorage`. Cloudové ukládání (Data module) je plánované později.
