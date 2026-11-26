# Specifikace oblasti logic

Čistá deterministická pravidla hry Postcard Trail a verzované uložení. Zdroj pravidel je [BRIEF.md](../../game/BRIEF.md) (§3, §5, §6, §7, §12), rozhraní mezi oblastmi [API.md](../../plan/API.md), rozhodnutí [LOG.md](../../decisions/LOG.md).

## Obecné zásady

- `src/game/logic/` nepoužívá DOM, `Date.now()`, `new Date()` bez argumentu, `Math.random()` ani úložiště. Čas dostává v ms, náhodu jako funkci `() => number` s hodnotou v `[0, 1)`, ID průchodu, pokusu o reklamu a karty jako řetězce.
- `src/game/storage/` přistupuje k datům jen přes předaný `KeyValueStore` ze `src/platform/types.ts`.
- Všechny stavy jsou neměnné hodnoty serializovatelné do JSON. Funkce vrací nový stav a vstup nemění.
- ID (průchodu, pokusu o reklamu, trasy, zastávky, volby) jsou neprázdné řetězce. Logika prázdné ID odmítne výjimkou `Error` (chyba volajícího). Validace uloženého průchodu (S2) proto přijme každý stav, který vytvoří `startCityRun` nebo `startDailyRun` nad trasou splňující kontrakt `Route` (10 zastávek, každá se 4 různými volbami a správnou volbou mezi nimi) a který z něj vznikne přes `reduceRun`. U `createRun` to platí, jen když volající splní podmínky na `stops` uvedené v [Rozhraní](#rozhraní).
- Datum UTC je vždy řetězec `YYYY-MM-DD`.
- Čísla zastávek pro hráče a měření jsou 1-based. Indexy v polích jsou 0-based a v názvech mají slovo `index`.

Tato specifikace popisuje chování. Přesné podpisy veřejných funkcí a typů jsou v sekci [Rozhraní](#rozhraní) a vývojář je drží ve shodě s kódem ve stejném commitu.

## 1. Pořadí voleb (`src/game/logic/choiceOrder.ts`)

### Požadavky

- **CO1** Městská trasa při startu zamíchá pořadí voleb každé zastávky rovnoměrným Fisherovým–Yatesovým postupem s předanou náhodou a uloží ho jako pole ID voleb.
- **CO2** Permutace číslo `k` (0–23) je `k`-tá permutace zdrojových indexů `[0, 1, 2, 3]` v lexikografickém pořadí. Permutace 0 je `[0, 1, 2, 3]`, permutace 23 je `[3, 2, 1, 0]`.
- **CO3** Zastávky s pevným pořadím (konstanta s ID `B09`, BRIEF §3, rozhodnutí v LOG.md) mají vždy zdrojové pořadí `Stop.choices` v městském i denním průchodu a nespotřebují žádné volání náhody.

### Scénáře

- Při dvou různých řízených zdrojích náhody dostane alespoň jedna zastávka trasy různé pořadí. Každé pořadí obsahuje právě čtyři ID voleb zastávky.
- Zdroj náhody vracející stále 0 a stále `0.999…` dává pořadí podle Fisherova–Yatese (test na přesné pořadí).
- B09 má pořadí `M1, M2, M3, M4` (ID voleb ve zdrojovém pořadí) při libovolné náhodě i libovolném datu denní výzvy.

## 2. Průchod (`src/game/logic/run.ts`)

### Stav

Průchod drží: ID průchodu, režim (`city` / `daily`), ID trasy, u denní výzvy datum UTC a `effectiveUtcDate` použité verze katalogu, příznak nečasovaného režimu zvolený při startu, seznam zastávek průchodu (ID, číslo zastávky v trase 1–10, časový limit, zobrazené pořadí ID voleb, ID správné volby), index aktuální zastávky, číslo kola, fázi, zbývající čas v ms, pauzu, skryté volby po 50:50, použité žolíky, ID právě probíhajícího pokusu o reklamu, výsledky (ID zastávky, výsledek `correct | wrong | timeout | skipped`, zvolené ID volby), počet správných, aktuální a nejlepší sérii.

Fáze: `loading` (scéna se načítá, čas neběží; zbývající čas je limit zastávky), `question` (čas běží, pokud není pauza), `feedback` (výsledek, čas stojí), `summary` (průchod dokončen). Pauza je příznak nad fází.

### Požadavky

- **R1 Časy.** Zastávka s číslem v trase 1–4 má 25 000 ms, 5–8 má 20 000 ms, 9–10 má 18 000 ms. V denní výzvě platí číslo zastávky v trase, ne pořadí v průchodu.
- **R2 Start odpočtu.** Odpočet začne až akcí „scéna připravena“ ve fázi `loading`. Do té doby žádná akce čas nemění.
- **R3 Uplynulý čas.** Akce v běžící otázce (`question`, bez pauzy) nesou `elapsedMs` od poslední započtené akce. `elapsedMs` je konečné nezáporné číslo naměřené monotónními hodinami app (`performance.now()`); jiná hodnota (záporná, `NaN`, `Infinity`) je chyba volajícího a logika ji nevaliduje. Reducer nejdřív odečte `elapsedMs`. Je-li `elapsedMs >= remainingMs`, otázka skončí timeoutem a vlastní akce se zahodí. Volba nebo žolík přesně na nule tedy prohrají. Odečtení platí i tehdy, když se vlastní akce potom nepoužije (skrytá nebo neznámá volba, už použitý žolík), takže app po každé takové akci měří čas od ní.
- **R4 Kola.** Každá zastávka má vlastní číslo kola, první zastávka má kolo 1 a každé „Další“ ho zvýší o 1. Akce nesou číslo kola. Akce s jiným číslem kola než aktuálním se ignorují (stav se vrátí beze změny, stejná reference).
- **R5 První akce platí.** Volba ve fázi `question` uzamkne otázku a přejde do `feedback`. Další volba, žolík nebo opakované „Další“ ve stejném kole stav nezmění.
- **R6 Skóre a série.** Správná volba: +1 správná, série +1, nejlepší série je maximum. Chybná volba a timeout: série 0. Přeskočení za video: počet správných i série beze změny.
- **R7 50:50.** Jednou za průchod, jen ve fázi `question` bez pauzy. Skryje dvě nesprávné volby; zůstane správná a první nesprávná v zobrazeném pořadí. Skrytou volbu nelze zvolit.
- **R8 +10 s.** Jednou za průchod, jen ve fázi `question` bez pauzy a jen v časovaném režimu. Přičte 10 000 ms. V nečasovaném režimu je nedostupný a akce se ignoruje.
- **R9 Kombinace.** Na jedné otázce lze použít 50:50 i +10 s a pak správně odpovědět.
- **R10 Nečasovaný režim.** Volba se přebírá jen při startu nového průchodu. Odpočet neběží, timeout nenastane, `elapsedMs` se ignoruje.
- **R11 Pauza.** Pauza zmrazí čas (`elapsedMs` pauzovací akce se započte podle R3). Pokračování po pauze čas nemění. Pauza je možná i ve fázi `loading` a `feedback` a čas tam neovlivní. Pauza přesně na nule skončí timeoutem podle R3 a průchod zůstane v pauze i ve fázi `feedback`, takže „Další“ čeká na pokračování. Pokračování zruší probíhající pokus o reklamu (R13).
- **R12 Přeskočit za video – dostupnost.** Jen v pauze ve fázi `question`, jednou za průchod, od 3. zastávky průchodu (index ≥ 2): ve městě od 3. z 10, v denní výzvě jen u 3. ze 3 (rozhodnutí v LOG.md). Zda portál reklamy nabízí, rozhoduje app podle adaptéru; logika žolík jen povolí nebo zakáže podle stavu.
- **R13 Přeskočit za video – pokus.** Žádost o reklamu s prázdným ID pokusu vyhodí `Error` (chyba volajícího) vždy, i ve fázi `summary` a se starým číslem kola. Žádost o reklamu uloží ID pokusu, jen když je žolík dostupný podle R12 a žádný pokus neprobíhá. Výsledek reklamy se přijme jen s ID právě probíhajícího pokusu a jen jednou. `completed` uzavře otázku jako `skipped`, označí žolík jako použitý, zruší pauzu a přejde do `feedback`. `cancelled` a `unavailable` pokus zruší, otázka zůstane v pauze se stejným časem a žolík zůstane k dispozici. Výsledek s jiným ID, opakovaný výsledek nebo výsledek bez probíhajícího pokusu se ignoruje. Bez potvrzeného `completed` přeskočení nevznikne. Pokračování z pauzy pokus zruší, takže pozdní výsledek běžící otázku nepřeskočí.
- **R14 Další.** „Další“ je jediná akce, která ve fázi `feedback` posouvá hru, a v pauze se ignoruje. Po zastávce, která není poslední, přejde na další zastávku do `loading` s novým číslem kola. Po poslední přejde do `summary`.
- **R15 Dokončení.** Průchod je dokončen ve fázi `summary` i s nulou správných.
- **R16 Obnova.** Obnova uloženého průchodu vrátí stejnou fázi, zastávku, žolíky, výsledky, čas a pořadí voleb, vždy s pauzou (kromě dokončeného průchodu ve fázi `summary`). Probíhající pokus o reklamu se zruší (přerušená reklama je nedokončená) a žolík zůstane.
- **R17 Restart.** Nový průchod stejné trasy (opakování, „Hrát znovu“) je nový stav s novým ID průchodu, novými permutacemi a bez žolíků, výsledků a série předchozího průchodu.
- **R18 Jazyk.** Stav neobsahuje texty ani jazyk. Změna jazyka pořadí voleb nemění.

### Scénáře (tabulka BRIEF §3 a K2)

- Volba s `elapsedMs` rovným zbývajícímu času → timeout, série 0. Volba s `elapsedMs` o 1 ms menším → přijatá volba.
- Totéž pro 50:50 a +10 s na hranici: žolík se nepoužije a otázka skončí timeoutem.
- Dvě volby za sebou ve stejném kole → platí první. „Další“ se starým číslem kola po přechodu na další zastávku → ignorováno.
- Série: správně, správně, chybně, správně → série 1, nejlepší 2. Timeout vynuluje sérii.
- Přeskočení za video se sérií 3 → série 3, správných beze změny, výsledek `skipped`.
- Výsledek reklamy s cizím ID, opakovaný `completed`, `completed` po `cancelled` stejného pokusu → nic dalšího se nestane.
- Reklama na 2. zastávce města nebo na 2. otázce denní výzvy → zakázáno. Na 3. otázce denní výzvy (přes `startDailyRun`) začínající zastávkou 1, 2 i 6 → povoleno, na 1. a 2. otázce zakázáno.
- Stejná trasa se dvěma sadami popisků (jiné texty `en` i `cs`) a stejná řízená náhoda, u denní výzvy stejný plán → shodné pořadí voleb; serializovaný stav neobsahuje žádný text ani jazyk (R18, K2).
- Prázdné ID průchodu, trasy, zastávky nebo volby při startu a žádost o reklamu s prázdným ID pokusu (i se starým číslem kola a ve fázi `summary`) → `Error`.
- Nečasovaný režim: libovolně velké `elapsedMs` nevede k timeoutu, +10 s nejde použít.
- Pokus o reklamu, pak pokračování z pauzy a pozdní `completed` → ignorováno, otázka běží dál.
- Pauza s `elapsedMs` rovným zbývajícímu času → timeout, fáze `feedback` v pauze, „Další“ ignorováno do pokračování.
- Pauza, obnova ze serializovaného JSON a pokračování → stejný zbývající čas a pořadí voleb.
- Deset timeoutů → `summary`, 0 správných.

## 3. Postup hráče (`src/game/logic/progress.ts`)

### Požadavky

- **P1 Hvězdy.** 0–3 správně = 0 hvězd, 4–6 = 1, 7–8 = 2, 9–10 = 3.
- **P2 Nejlepší výsledek.** Uloží se nejvíc hvězd za každé město. Opakování nemůže snížit získané hvězdy.
- **P3 Odemykání.** Odemčené je první město katalogu a každé město, jehož předchůdce v pořadí katalogu je dokončený. Po přidání balíku na konec katalogu se tak první nové město odemkne hráči, který dohrál předchozí poslední město.
- **P4 Pohlednice.** První dokončení města přidá jeho pohlednici, právě jednu. Opakování ji neduplikuje.
- **P5 Idempotentní dokončení.** Použití stejného dokončeného průchodu podruhé (opakované uložení, obnova z uloženého stavu, ukončení aplikace po posledním „Další“) nezmění postup a nevrátí znovu novou pohlednici ani nové odemčení. Plyne z toho, že postup se jen slučuje (maximum, sjednocení).
- **P6 Souhrn města.** Dokončení vrátí hvězdy průchodu, zda je pohlednice nově získaná a ID nově odemčeného města (nebo nic).
- **P7 Součty.** Dohraná města z počtu vydaných, součet nejlepších hvězd z `3 × počet vydaných měst`, počet pohlednic. Počítají se jen města z předaného katalogu.
- **P8 Další krok.** „Hrát“ otevře první odemčené nedokončené město v pořadí katalogu; po dokončení všech vrátí, že dalším krokem je mapa.
- **P9 Slučování.** Sloučení dvou postupů dá maximum hvězd a sjednocení dokončených měst a pohlednic. Je komutativní a idempotentní.
- **P10 Denní výzva** postup nemění (viz D8).

### Scénáře

- Paříž dokončená s 0 správnými → 0 hvězd, dokončená, právě jedna pohlednice, odemčen Londýn, Řím zůstává zamčený.
- Paříž znovu s 9 správnými → 3 hvězdy, pohlednice se nepřidá, nové odemčení žádné. Potom s 2 správnými → stále 3 hvězdy.
- Stejný průchod použitý dvakrát → druhé použití nic nezmění a hlásí, že nic nového nevzniklo.
- 20 dokončených měst s nejlepšími výsledky → 20 pohlednic, nejvýš 60 hvězd, dalším krokem je mapa.
- Katalog rozšířený z 20 na 30 měst, hráč má dohráno 20 → odemčené je 21. město, součty z 30 a 90.

## 4. Denní výzva (`src/game/logic/daily.ts`)

### Požadavky

- **D1 Verze katalogu.** Pro dané datum UTC se vybere poslední verze s `effectiveUtcDate <= datum`. Před první verzí se denní výzva nenabízí.
- **D2 Rozvrh.** `D` = počet celých dnů od `effectiveUtcDate` vybrané verze, `n` = počet měst verze. Město je `orderedCityIds[D mod n]`, první zastávka má číslo `1 + (floor(D / n) mod 8)`. Hrají se zastávky s čísly `první`, `první + 1`, `první + 2` v pořadí trasy.
- **D3 Zamčená města.** Rozvrh nezávisí na postupu hráče, zahrnuje i zamčená města.
- **D4 Permutace.** Pořadí voleb každé denní zastávky je permutace číslo `FNV-1a 32bit("YYYY-MM-DD:cityId:stopId") mod 24` podle CO2 (FNV-1a nad UTF-8 bajty, offset basis `2166136261`, prime `16777619`, výsledek bez znaménka). Výjimka B09 podle CO3.
- **D5 Uložení startu.** Denní průchod nese datum, `effectiveUtcDate` verze a ID tří zastávek. Obnova a pokračování po půlnoci nebo po aktualizaci katalogu používá uložená data, výpočet se znovu nedělá.
- **D6 Jeden výsledek na den.** Pro každé datum se ukládá nejvýš jeden výsledek (ID města a počet správných 0–3). Výsledek se zapisuje jen z dokončeného denního průchodu (fáze `summary`, režim `daily`) k datu uloženému v průchodu, tedy k datu startu; zápis jiného průchodu je chyba. Datum s výsledkem další pokus neotevře (logika řekne, zda datum výsledek má). Při slučování zůstává první uložený výsledek. Výsledky mají klíče (data) seřazené vzestupně, takže stejné výsledky mají jednu podobu v JSON.
- **D7 Série dnů.** Počet po sobě jdoucích dnů s výsledkem končících dnes nebo včera (podle předaného dnešního data), jinak 0. Nezávisí na pořadí, v jakém se výsledky uložily.
- **D8 Bez vlivu na postup.** Denní výsledek nemění hvězdy, pohlednice, dokončená města ani odemčení.
- **D9 Zpřístupnění.** Denní přehled je dostupný po dokončení prvního města (alespoň jedno dokončené město).
- **D10 Datum z času.** Funkce převede čas v ms od epochy na datum UTC (pomocí `Date` s předaným časem, bez čtení hodin). Výsledek nezávisí na místním časovém pásmu.

### Scénáře (K4)

- 20 po sobě jdoucích dnů prvního katalogu → 20 různých měst.
- 160 dní → každé město 8 různých prvních zastávek 1–8.
- Katalog s 30, 40 a 47 městy → za `8n` dní každé město 8 různých začátků.
- Den před `effectiveUtcDate` → nenabízí se. Den účinnosti → město 0, zastávka 1.
- Druhá verze katalogu účinná od data X → den X začne nové kolo (město 0 nové verze, zastávka 1). Den X − 1 se řídí starou verzí.
- Datum `23:59:59.999` UTC a `00:00:00.000` UTC následujícího dne → dva různé dny; místní časové pásmo nerozhoduje.
- Průchod začatý ve 23:59 a dokončený po půlnoci → výsledek patří dni startu, zastávky beze změny.
- Průchod začatý před vydáním nové verze katalogu a obnovený po něm → uložené zastávky beze změny.
- Stejné datum a katalog dvakrát → stejné město, zastávky a pořadí voleb (shoda s pevnými očekávanými hodnotami FNV-1a).
- Výsledky dnes, včera, předevčírem → série 3. Výsledky včera a předevčírem → 2. Výsledek před třemi dny → 0. Stejné výsledky uložené v obráceném pořadí → stejná série.
- Druhý výsledek pro stejné datum → zůstane první. Datum s výsledkem je poznat.
- Sloučení výsledků dvou karet → pro každé datum výsledek uloženého stavu, sjednocená data, klíče seřazené.
- Série přes hranici měsíce, roku a přestupného dne → správný počet.
- Zápis nedokončeného nebo městského průchodu jako denního výsledku → chyba.
- Dokončení a zápis denního průchodu → `Progress` beze změny. Bez dokončeného města denní přehled zamčený, s jedním dostupný.

## 5. Uložení (`src/game/storage/`)

### Požadavky

- **S1 Oddíly.** Data se ukládají po oddílech pod samostatnými klíči `settings`, `progress`, `daily-results` a `active-run` (bez prefixu `postcard-trail:`, ten přidává adaptér). Hodnota každého klíče je JSON `{ "version": 1, "data": … }`. Aktuální verze schématu je 1. Data aktivního průchodu jsou `{ ownerTabId, run }`, nebo `null`, když žádný průchod není. `KeyValueStore` nemá mazání, proto se průchod maže zápisem `null`.
- **S2 Validace po oddílech.** Každý oddíl se při čtení validuje zvlášť. Nevalidní nebo chybějící oddíl se nahradí výchozím stavem, ostatní oddíly se použijí. V nastavení se nevalidní pole nahradí výchozím a ostatní pole zůstanou. V postupu a denních výsledcích se zachovají validní záznamy a zahodí jen nevalidní (město s hvězdami mimo 0–3, prázdné nebo nečíselné ID, datum, které není skutečné datum `YYYY-MM-DD`, počet správných mimo celá čísla 0–3). Načtený postup a denní výsledky mají normalizovaný tvar výstupu `mergeProgress` a `mergeDailyResults`. Aktivní průchod, který neprojde validací tvaru `RunState` (rozsah `stopIndex`, čtyři různé volby se správnou volbou, výčtové hodnoty) nebo konzistence jeho polí, nebo nemá ID vlastníka, se nepoužije a platí jako žádný průchod. Konzistence: `mode: 'daily'` má právě 3 zastávky a vyplněné `daily`, `mode: 'city'` má právě 10 zastávek a `daily: null`; počet výsledků je `stopIndex` ve fázích `loading` a `question` a `stopIndex + 1` ve fázích `feedback` a `summary`; `hiddenChoiceIds` jsou jen volby aktuální zastávky a nikdy ne její správná volba; `correct` se rovná počtu výsledků `correct` (tedy nepřesahuje počet výsledků); výsledek na pozici `i` patří zastávce `stops[i]` (stejné `stopId`); fáze `summary` je jen na poslední zastávce (`stopIndex` je poslední index). Poškozený průchod tak nejde dohrát ani dokončit s výsledkem, který by načtení denních výsledků zahodilo.
- **S3 Verze.** Verze 1 je první, starší verze neexistují, proto se nic nemigruje. Oddíl s celočíselnou verzí vyšší než 1 se nepoužije ani nepřepíše; hra pro něj do konce relace pracuje v paměti (co v relaci zapíše, to čte zpět) a nabídne stejné jednorázové upozornění jako při nedostupném úložišti (rozhodnutí v LOG.md). Novější verze se zjišťuje i před zápisem oddílu, který ještě nebyl načtený. Chybějící, nečíselná nebo nevalidní verze (`0`, záporná, `"1"`, `1.5`, `null`) a nečitelný JSON znamenají poškozená data, která se nahradí výchozími, smí se přepsat a upozornění nevyvolají.
- **S4 Slučování odměn.** Zápis postupu a denních výsledků nejdřív přečte uložený stav a sloučí ho podle P9 a D6, aby souběžná karta odměny nepřepsala. Nastavení se neslučuje, platí poslední zápis.
- **S5 Jeden aktivní průchod.** Úložiště drží nejvýš jeden aktivní průchod. Začátek nového průchodu nahradí předchozí. Zahození smaže jen aktivní průchod, odměny a nastavení zůstanou.
- **S6 Vlastnictví mezi kartami.** Aktivní průchod nese ID karty (dodává app), která ho naposled výslovně začala (`startRun`) nebo obnovila (`resumeRun`, akce „Pokračovat“). Samotné načtení stránky průchod nepřebírá. Kontrolní bod, zahození a dokončení se provedou jen tehdy, když uložený průchod má stejné ID průchodu a vlastníkem je tato karta; jinak se nic nezapíše a metoda vrátí `notOwner`. Čistá funkce `ownsActiveRun` nad uloženou hodnotou klíče `active-run` a ID karty určí, zda karta průchod vlastní; app ji volá při událostech `storage` (`newValue`). Rozhodující pro app je tato událost: když `ownsActiveRun(event.newValue, tabId)` vrátí `false`, karta průchod zastaví bez ohledu na `isActiveRunOwner()`. `isActiveRunOwner()` vrací vlastnictví podle dat, která tato instance právě vidí (úložiště, u oddílu v paměti podle S8 jeho paměťová kopie), a app ho může použít navíc při `visibilitychange`; `false` z kteréhokoli z obou zdrojů znamená zastavit, `true` z `isActiveRunOwner()` nepřebíjí událost `storage`.
- **S7 Dokončení.** Dokončení městského průchodu sloučí odměny s uloženým postupem přes `applyCompletedCityRun`, zapíše postup, pak smaže aktivní průchod a vrátí souhrn města. Dokončení denního průchodu zapíše výsledek k datu startu průchodu přes `recordDailyRun` a smaže průchod; postup nemění. Druhé dokončení téhož průchodu vrátí `notOwner` (průchod už není aktivní) a nic nepřidá; dokončení obnoveného průchodu, jehož odměny už jsou uložené, nic nezduplikuje a nevrátí novou pohlednici ani nové odemčení. Dokončení nedokončeného průchodu nebo průchodu jiného režimu vyhodí `Error` (chyba volajícího). Když zápis odměn (postupu, u denní výzvy denních výsledků) do úložiště selže a oddíl zůstane v paměti podle S8, aktivní průchod se v úložišti nesmaže: oddíl `active-run` od té chvíle také zůstává v paměti, průchod se smaže jen tam (relace ho dál nevidí a druhé dokončení vrátí `notOwner`) a po obnovení stránky ho jde obnovit a dokončit znovu. Protože odměny se do úložiště nedostaly, druhé dokončení je zapíše poprvé a nic nezduplikuje. U oddílu odměn s novější verzí (S3) se průchod smaže obvyklým způsobem, protože tento build do takového oddílu odměny nikdy nezapíše. Známé omezení při trvalé chybě zápisu odměn: průchod ve fázi `summary` zůstává v úložišti a každé další dokončení v nové relaci vrátí souhrn s `postcardEarned` nebo `newlyUnlockedCityId` (u denní výzvy denní výsledek), které se znovu neuloží; upozornění podle S8 se ukáže jednou za relaci. Uložený průchod ve fázi `summary` je hotový; jak ho app nabídne nebo dokončí, rozhoduje oblast app.
- **S8 Nedostupné úložiště.** Když `read` nebo `write` vyhodí výjimku, výjimka neprojde ven, dotčený oddíl se do konce relace drží v paměti (poslední přečtená nebo zapsaná hodnota) a do úložiště se už nezapisuje. Upozornění (`takeUnavailableNotice()`) se nabídne právě jednou za relaci, i když selže víc operací nebo se přidá novější verze podle S3. Je-li v paměti oddíl `active-run`, `isActiveRunOwner()` a kontroly vlastnictví v S6 se vyhodnocují nad paměťovou kopií, takže převzetí jinou kartou nevidí; kontrolní body, zahození i dokončení se pak zapisují jen do paměti této karty a úložiště ani stav jiné karty nezmění. Převzetí jinou kartou se taková karta dozví jen z události `storage` podle S6. Selhání zápisu odměn při dokončení převede do paměti i oddíl `active-run` (S7), takže další průchody této relace se do úložiště už neukládají.
- **S9 Nastavení.** Jazyk (`en` výchozí, `en` nebo `cs`), zvuk zapnutý, hlasitost 0,6 (0–1), vibrace zapnuté, bez animací vypnuto, nečasovaný režim vypnutý, seznam už zobrazených jednorázových nápověd (prázdný, bez duplicit).
- **S10 Obnova.** Obnovený průchod se vrací přes `restoreRun`: vždy v pauze a bez probíhajícího pokusu o reklamu, se stejnou zastávkou, fází, časem, žolíky, výsledky a pořadím voleb. Obnovená podoba se uloží jako kontrolní bod nového vlastníka.

### Scénáře

- Prázdné úložiště → výchozí nastavení, prázdný postup, prázdné denní výsledky, žádný aktivní průchod, žádné upozornění.
- Poškozený JSON v postupu, validní nastavení → nastavení zachované, postup výchozí. Neznámý jazyk, hlasitost 1,5 a nebooleovské vibrace → tato pole výchozí, ostatní zachovaná.
- Postup s jedním městem s hvězdami 7 a jedním validním → validní město zachované. Denní výsledky s neplatným datem nebo počtem mimo 0–3 → zahozené jen tyto záznamy.
- Nevalidní tvar aktivního průchodu → žádný aktivní průchod, odměny zůstanou.
- Oddíl postupu s verzí 2 → nepoužit, po zápisu jiného oddílu i po dokončení města zůstane uložená hodnota beze změny, v relaci se čte dokončené město, upozornění jednou. Verze `0`, `"1"`, `1.5` → postup výchozí a přepsatelný, bez upozornění.
- Dvě karty nad stejným úložištěm: karta A dokončí Paříž, karta B (se starým stavem v paměti) dokončí Londýn → uložené obě pohlednice a obě města.
- Dva denní výsledky stejného data z různých karet → zůstane první uložený.
- Nulové skóre přes úložiště → Paříž dokončená, právě jedna pohlednice, odemčený Londýn. Opakované dokončení i dokončení po obnově souhrnu → bez nové pohlednice a odemčení.
- Karta A začne průchod, karta B ho obnoví → `ownsActiveRun` vrátí pro A `false` a pro B `true`, kontrolní bod, zahození i dokončení z A vrátí `notOwner` a uložený stav zůstane stavem B. Totéž u denního průchodu: dokončení z A vrátí `notOwner` a `daily-results` zůstanou beze změny. Dokončení průchodu s jiným ID než aktivní → bez odměn.
- Aktivní průchod s nekonzistentními poli (denní se 4 nebo 5 zastávkami a `correct` 5, denní bez `daily`, městský se 3 zastávkami nebo s `daily`, počet výsledků neodpovídá `stopIndex` a fázi, skrytá volba z jiné zastávky nebo správná volba, všechny volby skryté, `correct` neodpovídá výsledkům nebo je 4 v denním) → žádný aktivní průchod. Konzistentní průchody ve všech fázích se načtou beze změny.
- Aktivní průchod ve fázi `summary` před poslední zastávkou (městský i denní) nebo s výsledkem, jehož `stopId` neodpovídá zastávce na stejné pozici (jiná zastávka, obrácené pořadí) → žádný aktivní průchod.
- Průchod, který reducer postaví z nejkratších přijatých ID (`'r'`, pokus `'a'`) s probíhajícím pokusem o reklamu, se uloží a načte beze změny (městský i denní).
- Úložiště, jehož zápis selhává jen u klíče `progress` (u denní výzvy `daily-results`): dokončení vrátí `completed`, uložený aktivní průchod zůstane, relace ho nevidí a druhé dokončení vrátí `notOwner`. Po obnovení stránky s funkčním úložištěm jde průchod obnovit a dokončit: odměny se zapíšou právě jednou, pohlednice a odemčení se nahlásí jako nové a průchod se smaže.
- Úložiště, jehož zápis u klíče `progress` selhává trvale: v každé nové relaci jde uložený průchod ve fázi `summary` obnovit a dokončit, souhrn znovu nahlásí pohlednici a odemčení, postup se neuloží, průchod v úložišti zůstane a upozornění se nabídne jednou za relaci.
- Výchozí `shownHintIds` vrácené z `loadSettings()` změněné na místě → další načtení vrátí opět `[]`.
- `KeyValueStore`, jehož metody vyhazují (obě, jen zápis, jen čtení) → hra běží v paměti, data v rámci relace se čtou zpět, upozornění jednou.

## Rozhraní

Sekci doplňují vývojáři balíčků přesnými podpisy a typy, jak jsou v kódu. Tady je plánovaná podoba, ze které balíčky vycházejí.

### `src/game/logic/choiceOrder.ts`

```ts
export type RandomSource = () => number // [0, 1)
export function keepsSourceOrder(stopId: string): boolean // jen 'B09'
export function shuffledChoiceIds(stop: Stop, random: RandomSource): string[] // 3 volání náhody, u B09 žádné
export function permutedChoiceIds(stop: Stop, permutationNumber: number): string[] // 0–23 podle CO2
```

### `src/game/logic/run.ts`

```ts
export type RunPhase = 'loading' | 'question' | 'feedback' | 'summary'
export type StopOutcome = 'correct' | 'wrong' | 'timeout' | 'skipped'
export interface RunStop { stopId: string; routeStopNumber: number; timeLimitMs: number; choiceIds: string[]; correctChoiceId: string }
export interface StopResult { stopId: string; outcome: StopOutcome; chosenChoiceId: string | null }
export interface DailyRunInfo { utcDate: string; catalogEffectiveUtcDate: string }
export interface RunState {
  runId: string
  mode: RunMode // ze src/platform/types.ts
  cityId: string
  daily: DailyRunInfo | null
  untimed: boolean
  stops: RunStop[]
  stopIndex: number
  round: number
  phase: RunPhase
  remainingMs: number
  paused: boolean
  hiddenChoiceIds: string[]
  usedLifelines: LifelineKind[] // ze src/platform/types.ts
  skipAttemptId: string | null
  results: StopResult[]
  correct: number
  streak: number
  bestStreak: number
}
export type RunAction =
  | { type: 'sceneReady'; round: number }
  | { type: 'tick'; round: number; elapsedMs: number }
  | { type: 'choose'; round: number; choiceId: string; elapsedMs: number }
  | { type: 'useFiftyFifty'; round: number; elapsedMs: number }
  | { type: 'useExtraTime'; round: number; elapsedMs: number }
  | { type: 'pause'; round: number; elapsedMs: number }
  | { type: 'resume'; round: number }
  | { type: 'requestSkip'; round: number; attemptId: string } // attemptId neprázdný, jinak Error
  | { type: 'adResult'; result: RewardedAdResult }
  | { type: 'next'; round: number }
// elapsedMs: konečné nezáporné číslo z monotónních hodin app; jiná hodnota je chyba volajícího (R3)
export function timeLimitMs(routeStopNumber: number): number
export function createRun(options: { runId: string; mode: RunMode; cityId: string; untimed: boolean; stops: RunStop[]; daily?: DailyRunInfo }): RunState // Error při prázdném runId, cityId, stopId, correctChoiceId nebo ID volby; ostatní podmínky ověřuje volající: `stops` má 10 zastávek pro `mode: 'city'` (bez `daily`) a 3 pro `mode: 'daily'` (s `daily` s platnými daty UTC), každá zastávka má 4 různá `choiceIds` se `correctChoiceId` mezi nimi, `routeStopNumber` celé číslo 1–10 a `timeLimitMs` konečné kladné číslo; jinak stav validace uloženého průchodu (S2) nemusí přijmout
export function startCityRun(options: { route: Route; runId: string; untimed: boolean; random: RandomSource }): RunState // přes createRun, stejná pravidla pro ID
export function reduceRun(run: RunState, action: RunAction): RunState // akce bez účinku vrací stejnou referenci, pokud nezapočte čas podle R3; requestSkip s prázdným attemptId vyhodí Error
export function restoreRun(run: RunState): RunState
export function currentStop(run: RunState): RunStop
export function visibleChoiceIds(run: RunState): string[]
export function canUseSkip(run: RunState): boolean // dostupnost podle R12, bez ohledu na probíhající pokus
```

### `src/game/logic/progress.ts`

```ts
export type Stars = 0 | 1 | 2 | 3
/** City IDs in both arrays and the `bestStars` keys are unique and sorted ascending, so equal progress has one JSON form. */
export interface Progress { completedCityIds: string[]; bestStars: Record<string, Stars>; postcardCityIds: string[] }
export interface CompletedCityRun { cityId: string; correct: number }
export interface CityRunSummary { progress: Progress; stars: Stars; postcardEarned: boolean; newlyUnlockedCityId: string | null }
export interface ProgressTotals { completedCities: number; releasedCities: number; stars: number; maxStars: number; postcards: number }
export const emptyProgress: Progress
export function starsFor(correct: number): Stars
export function applyCompletedCityRun(progress: Progress, run: CompletedCityRun, catalog: Catalog): CityRunSummary
export function unlockedCityIds(progress: Progress, catalog: Catalog): string[] // v pořadí katalogu
export function progressTotals(progress: Progress, catalog: Catalog): ProgressTotals
export function nextCityToPlay(progress: Progress, catalog: Catalog): string | null // null = mapa
export function mergeProgress(a: Progress, b: Progress): Progress
```

`applyCompletedCityRun` je `mergeProgress` s postupem jednoho města. `stars` jsou hvězdy tohoto průchodu (ne nejlepší), `postcardEarned` je `true` jen při první pohlednici města, `newlyUnlockedCityId` je město odemčené tímto dokončením, které předtím odemčené nebylo. `mergeProgress` vrací pole i klíče `bestStars` seřazené a bez duplicit, takže je komutativní podle `deepEqual` i podle `JSON.stringify` a `mergeProgress(a, a)` je shodné s `a` pro každý postup v tomto tvaru.

### `src/game/logic/daily.ts`

```ts
export interface DailyPlan { utcDate: string; catalogEffectiveUtcDate: string; cityId: string; firstStopNumber: number } // firstStopNumber 1–8
export interface DailyResult { cityId: string; correct: number } // correct 0–3
/** Keyed by the UTC date the run started on; keys are sorted ascending, so equal results have one JSON form. */
export type DailyResults = Record<string, DailyResult>
export const emptyDailyResults: DailyResults
export function fnv1a32(text: string): number // nad UTF-8 bajty, bez znaménka
export function utcDateOf(epochMs: number): string
export function catalogVersionFor(catalog: Catalog, utcDate: string): CatalogVersion | null // null = před první verzí
export function dailyPlan(catalog: Catalog, utcDate: string): DailyPlan | null // null = výzva se nenabízí
export function startDailyRun(options: { route: Route; plan: DailyPlan; runId: string; untimed: boolean }): RunState // přes createRun, stejná pravidla pro ID
export function recordDailyRun(results: DailyResults, run: RunState): DailyResults // vyhodí Error, není-li run dokončený denní průchod
export function hasDailyResult(results: DailyResults, utcDate: string): boolean
export function dailyStreak(results: DailyResults, todayUtcDate: string): number
export function mergeDailyResults(stored: DailyResults, incoming: DailyResults): DailyResults
export function dailyUnlocked(progress: Progress): boolean
```

`startDailyRun` dostává trasu města `plan.cityId` a staví průchod přes `createRun` s `mode: 'daily'` a `daily` z plánu; časové limity podle čísla zastávky v trase (`timeLimitMs`), pořadí voleb `` permutedChoiceIds(stop, fnv1a32(`${plan.utcDate}:${route.id}:${stop.id}`) % 24) ``. `recordDailyRun` zapíše `{ cityId: run.cityId, correct: run.correct }` k `run.daily.utcDate` přes `mergeDailyResults`, takže už uložený výsledek data zůstane. `mergeDailyResults` pro každé datum ponechá výsledek ze `stored`, sjednotí data a vrací klíče seřazené. `dailyStreak` počítá po sobě jdoucí dny s výsledkem od dneška, a když dnešek výsledek nemá, od včerejška.

### `src/game/storage/`

```ts
// schema.ts
export const schemaVersion = 1
export const storageKeys = { settings: 'settings', progress: 'progress', dailyResults: 'daily-results', activeRun: 'active-run' } as const
export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys]
export interface Settings {
  locale: Locale // ze src/content/types.ts
  soundEnabled: boolean
  volume: number // 0–1
  vibrationEnabled: boolean
  reducedMotion: boolean
  untimed: boolean
  shownHintIds: string[]
}
export const defaultSettings: Settings // en, zvuk ano, 0.6, vibrace ano, bez animací ne, nečasovaný ne, []
export interface ActiveRun { ownerTabId: string; run: RunState }
export type DecodedSection = { status: 'usable'; data: unknown } | { status: 'newer' } | { status: 'damaged' }
export function encodeSection(data: unknown): string // {"version":1,"data":…}
export function decodeSection(stored: string | null): DecodedSection
export function parseSettings(data: unknown): Settings // po polích, vždy nové pole shownHintIds
export function parseProgress(data: unknown): Progress // po záznamech, normalizované přes mergeProgress
export function parseDailyResults(data: unknown): DailyResults // po záznamech, normalizované přes mergeDailyResults
export function parseActiveRun(data: unknown): ActiveRun | null
export function ownsActiveRun(storedActiveRun: string | null, tabId: string): boolean // čistá, např. nad StorageEvent.newValue

// gameStorage.ts
export type RunWriteResult = 'written' | 'notOwner'
export type CityRunCompletion = { status: 'completed'; summary: CityRunSummary } | { status: 'notOwner' }
export type DailyRunCompletion = { status: 'completed'; dailyResults: DailyResults } | { status: 'notOwner' }
export class GameStorage {
  constructor(store: KeyValueStore, tabId: string)
  loadSettings(): Settings
  saveSettings(settings: Settings): void // bez slučování, poslední zápis platí
  loadProgress(): Progress
  loadDailyResults(): DailyResults
  loadActiveRun(): RunState | null // uložený průchod beze změny vlastníka, např. pro nabídku „Pokračovat“
  isActiveRunOwner(): boolean // nad daty, která instance vidí, včetně paměťové náhrady; rozhoduje událost storage (S6)
  startRun(run: RunState): void // nahradí předchozí průchod, karta se stane vlastníkem
  resumeRun(): RunState | null // restoreRun(uložený), karta se stane vlastníkem
  saveRunCheckpoint(run: RunState): RunWriteResult
  discardRun(runId: string): RunWriteResult
  completeCityRun(run: RunState, catalog: Catalog): CityRunCompletion // vyhodí Error, není-li run dokončený městský průchod; při selhaném zápisu odměn průchod v úložišti zůstane (S7)
  completeDailyRun(run: RunState): DailyRunCompletion // vyhodí Error, není-li run dokončený denní průchod; při selhaném zápisu odměn průchod v úložišti zůstane (S7)
  takeUnavailableNotice(): boolean // true právě jednou za relaci po selhání úložiště nebo novější verzi
}
```

Jedna instance `GameStorage` patří jedné kartě (jedné relaci stránky). Neuchovává postup ani výsledky v paměti, každé čtení jde do `KeyValueStore`; jen oddíl, jehož čtení nebo zápis selhal nebo má novější verzi, se do konce relace čte a zapisuje v paměti instance. `parse*` a `decodeSection` jsou veřejné kvůli `GameStorage`, app je nepotřebuje. `loadProgress()` a `loadDailyResults()` (a `parseProgress`, `parseDailyResults`) mohou vrátit sdílené hodnoty `emptyProgress` a `emptyDailyResults` z `logic`, proto se vrácené hodnoty nesmí měnit na místě; změny jdou přes funkce z `logic`, které vracejí nové hodnoty. `loadSettings()` vrací vždy nové pole `shownHintIds`. `RunWriteResult` `notOwner` znamená, že uložený průchod má jiné ID nebo jiného vlastníka; app pak průchod v této kartě zastaví.
