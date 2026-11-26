# Postup oblasti platform

Požadavky a scénáře jsou ve [spec.md](spec.md). Vývojář zaškrtává hotové kroky svého balíčku.

## Balíček 1: local (lokální adaptér, úložiště, záznam událostí)

- [x] Typ `VITE_PLATFORM` pro `import.meta.env` v `src/platform/` (bez `any`).
- [x] Úložiště s prefixem `postcard-trail:` nad `localStorage` (P2, S2.1–S2.3).
- [x] Záznam událostí měření pro všechny adaptéry (P3, S3.1–S3.3).
- [x] Lokální adaptér se simulací reklamy podle tabulky P4 (S4.1–S4.5).
- [x] `createPlatform()` v `src/platform/index.ts` vybírá lokální adaptér (P1).
- [x] Unit testy přes veřejné funkce adaptéru pro všechny řádky tabulky P4 a produkční režim.

## Balíček 2: portals (Poki, CrazyGames, výběr při buildu)

Závisí na balíčku 1.

- [x] Načtení skriptu SDK až v `init()` portálového adaptéru, odolné vůči zablokování (S5.5).
- [x] Slučování herních signálů a jejich pozastavení během reklamy (S5.1, S5.2).
- [x] Adaptér Poki: init, načítání, hraní, `rewardedBreak`, `measure` (S5.3, S6.1, S7.1).
- [x] Adaptér CrazyGames: init, prostředí, načítání, hraní, `requestAd('rewarded')`, `adsDisabled` (S5.4, S6.2, S7.2).
- [x] Společná pravidla požadavku na reklamu (S6.3–S6.5) a žádné průběžné reklamy (S5.7).
- [x] `createPlatform()` vybírá adaptér podle `VITE_PLATFORM`, lokální build neobsahuje SDK (S1.1, S1.2).
- [x] Unit testy s nahrazeným SDK (bez sítě).

## Balíček 3: feedback (zvuk a vibrace)

- [ ] `createFeedback` podle veřejného rozhraní ve spec.md.
- [ ] Odemčení zvuku prvním vstupem a hlasitost 0,6 (S8.1).
- [ ] Syntéza podnětů `choice`, `correct`, `wrong`, `postcard` (S8.2).
- [ ] Vypnutí zvuku a ztlumení po dobu reklamy (S8.3, S8.4).
- [ ] Vibrace 25 ms a 35 ms podle nastavení (S9.1–S9.3).
- [ ] Unit testy s nahrazeným `AudioContext` a `navigator.vibrate`.

## Předání oblasti

- [ ] Review a QA oblasti proti akceptačním kritériím, `.handoff/REPORT.md`.
