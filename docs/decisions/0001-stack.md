# 0001 – Stack

Zadání (§14) určuje TypeScript + Vite, statický build bez backendu, DOM/CSS bez herního enginu. Projekt je založený generátorem `create-vite@9.4.0` se šablonou `vanilla-ts`.

| Co | Verze | Proč |
|---|---|---|
| Node.js | 26.13.1 (`.nvmrc`) | Aktuální Active LTS. Lokálně ověřeno i na Node 22.20, CI běží na verzi z `.nvmrc`. |
| TypeScript | ~7.0.2 | Verze z generátoru Vite, stabilní major s opravnou verzí. |
| Vite | ^8.4.0 | Verze z generátoru, major 8 má opravné verze. |
| oxlint | ^1.95.0 | Linter z ekosystému Vite, rychlý, bez konfigurace. |
| @playwright/test | ^1.65.1 | E2E testy, také měření rozměrů a výkonu. |
| node:test | vestavěný | Unit testy bez další závislosti, Node spouští `.ts` přímo. |

Bez frameworku UI: obrazovek je málo, zadání chce přístupný DOM a startovní payload do 700 kB. Bez herního enginu podle zadání. Hosting: GitHub Pages přes Actions (stejně jako parcel-pull), portálové buildy přes `VITE_PLATFORM`.
