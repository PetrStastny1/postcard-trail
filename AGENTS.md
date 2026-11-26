# Postcard Trail

Use the user's development rules. Standalone TypeScript + Vite HTML5 game without a backend, accounts or database. The rules of the game are in docs/game/BRIEF.md and the city routes in docs/game/cities/. The build plan, areas and their boundaries are in docs/plan/PLAN.md, the interfaces between areas in docs/plan/API.md.

## Structure

- `src/content/`: route data generated from docs/game/cities/*.md, catalog and route loading. `src/content/types.ts` is a contract.
- `src/game/logic/`: pure deterministic rules. No DOM, no `Date.now()`, no `Math.random()`, no storage. Time arrives in ms, randomness and IDs are passed in.
- `src/game/storage/`: versioned save on top of the adapter's `KeyValueStore`.
- `src/game/render/`, `src/ui/`, `src/app/`: accessible DOM/CSS screens and the browser layer.
- `src/platform/`: the local, Poki and CrazyGames adapters. SDK calls stay here. `src/platform/types.ts` is a contract.
- `src/game/feedback/`: Web Audio sound and vibration.
- `src/i18n/en.json`, `src/i18n/cs.json`: player-facing text outside the routes. English is the default.
- `src/styles/tokens.css`: the only source of colours, type, spacing and motion. The approved key screen is in docs/design/.
- `tools/content/`: import, validation and placeholder scene generation.

Contracts (`src/content/types.ts`, `src/platform/types.ts`, docs/plan/API.md) and shared configuration (`package.json`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.github/`) change only on the release branch by the director.

## Domain rules

- Never show the name of the correct choice in UI text, alt text or the place caption before the answer.
- Scenes are `public/scenes/<stopId>.webp`. Placeholder scenes are listed in `public/scenes/placeholders.json`; only for those the scene description is shown under the image.
- The first catalog's `effectiveUtcDate` lives only in `src/content/catalog.json`.

Run npm run lint, npm run typecheck, npm test, npm run build and npm run test:e2e before handoff. Each worktree uses its own `E2E_PORT`.
