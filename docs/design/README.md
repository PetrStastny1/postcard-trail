# Schválený vizuální směr

Klíčová obrazovka je otázka zastávky a její výsledek. Schválil ji arbitr 26. 11. 2026 ve třetím kole (záznam v [LOG.md](../decisions/LOG.md)). Ostatní obrazovky se z ní odvozují.

- Prototyp: [prototype/question.html](prototype/question.html) a [prototype/question.css](prototype/question.css). Parametry `?state=question|result|result-correct|result-timeout|loading|error|fifty|untimed`, `&lang=cs`, `&focus=choice|next`.
- Screenshoty: [approved/](approved/). Název je `<stav>.<jazyk>.<velikost>[.focus-<prvek>][.dark].png`. Výsledky automatické kontroly jsou v [approved/checks.txt](approved/checks.txt).
- Kontrola rozvržení: [check-layout.mjs](check-layout.mjs), spustí se `node docs/design/check-layout.mjs <url> <výstupní složka>` proti běžícímu Vite. Implementace v `src/` musí projít stejnými kontrolami.

## Co je závazné

**Tokeny.** Jediným zdrojem barev, písma, mezer a pohybu je `src/styles/tokens.css`, paleta je ze zadání §9. Hra drží světlou paletu i při tmavém schématu systému (k potvrzení Petrem). V komponentách nesmí být barvy ani rozměry zapsané napřímo.

**Hierarchie písma.**
- Písmo `system-ui`.
- Otázka 18–24 px tučně.
- Volby, ovládání a věta o místě 16 px.
- Štítky (obtížnost, série) a popisek scény 14 px.
- Nadpisy obrazovek 24–40 px.

**Rám obrazovky.**
- Námořnický pruh přes celou šířku. Vlevo ×, uprostřed název a pozice, vpravo pauza.
- Pod pruhem je čára trasy s body zastávek a jantarovou značkou aktuální zastávky. Vedle ní je štítek obtížnosti a počítadlo série, které je vidět jen od 2.
- Bezpečné oblasti displeje (`env(safe-area-inset-*)`) jsou ošetřené.

**Scéna.**
- Čtverec s rámečkem. Velikost závisí jen na viewportu, nikdy na stavu.
- Na 375 × 812 a větších má aspoň 304 px. Na nejmenších velikostech kolem 200 px (k potvrzení Petrem).
- Tlačítko zvětšení je v otázce a na šířku v pravém dolním rohu obrazu. Ve výsledku na výšku je ve výsledkovém pásu (vedlejší ikonové tlačítko s obrysem, v řadě s verdiktem nad „Další“) a roh obrazu je prázdný, protože po posunu na konec výsledku by roh mohl zajet pod horní pruh. Zvětšení musí být vidět v otázce i ve výsledku, vždy právě jedno.
- Pod zástupnou scénou je popis (`sceneAlt`).

**Volby.**
- Mřížka 2 × 2 s číslem klávesové zkratky.
- Název se nikdy nedělí uvnitř slova. Když se nevejde, mřížka se složí do jednoho sloupce (třída `is-stacked`, rozhoduje měření popisků).
- Po 50:50 zůstanou odebrané pozice jako prázdná čárkovaná místa, mřížka se nepřeskládá.

**Řádek akcí.**
- Čas a žolíky, po odpovědi místo nich verdikt slovem i symbolem, věta o místě a jediné plné tlačítko „Další“ (na výšku nad ním vedlejší tlačítko zvětšení).
- Řádek je přilepený ke spodní hraně. Když pod ním pokračuje obsah, má nad sebou stín (`has-more`) a první skrytá volba vykukuje.
- Po odpovědi se obsah posune tak, aby výsledek nic nepřekrýval.
- Žolíky jsou vedlejší tlačítka s obrysem. Použitý žolík je čárkovaný a přeškrtnutý.

**Na šířku.**
- Scéna vlevo, velikost podle výšky.
- Vpravo panel, ve kterém otázka, volby a řádek akcí tvoří jednu skupinu svisle na střed. Panel se posouvá jen při dlouhém textu.

**Stavy.**
- Načítání: obraz se stavem, volby i žolíky zakázané a vizuálně neaktivní, čas ukazuje plný limit zastávky.
- Chyba načtení: jen trasa, věta s číslem zastávky, „Zkusit znovu“, ×, „Úvod“.
- Výsledek:
  - správně: zelený verdikt a série +1,
  - chybně: zvolená volba červeně, správná zeleně, série zmizí,
  - čas vypršel: zvýrazní se jen správná volba.
- Nečasovaný režim: bez času a bez +10 s.

**Ovládání.** Všechny cíle 44 × 44 px a víc, fokus má obrys v barvě textu s oddělovacím okrajem podkladu.

## Otevřené body

- Na 568 × 320 zůstane po odpovědi nad volbami útržek otázky, protože panel se dál posunout nedá. Arbitr to doporučil zlepšit, není to podmínka.
- Obraz v prototypu je zástupný. Finální ilustrace mají stejný formát 1:1 a stejné umístění.
