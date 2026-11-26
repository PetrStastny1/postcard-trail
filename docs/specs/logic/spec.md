# Specifikace oblasti logic

Čistá deterministická pravidla hry Postcard Trail a verzované uložení. Zdroj pravidel je [BRIEF.md](../../game/BRIEF.md) (§3, §5, §6, §7, §12), rozhraní mezi oblastmi [API.md](../../plan/API.md), rozhodnutí [LOG.md](../../decisions/LOG.md).

## Obecné zásady

- `src/game/logic/` nepoužívá DOM, `Date.now()`, `new Date()` bez argumentu, `Math.random()` ani úložiště. Čas dostává v ms, náhodu jako funkci `() => number` s hodnotou v `[0, 1)`, ID průchodu, pokusu o reklamu a karty jako řetězce.
- `src/game/storage/` přistupuje k datům jen přes předaný `KeyValueStore` ze `src/platform/types.ts`.
- Všechny stavy jsou neměnné hodnoty serializovatelné do JSON. Funkce vrací nový stav a vstup nemění.
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

Fáze: `loading` (scéna se načítá, čas neběží), `question` (čas běží, pokud není pauza), `feedback` (výsledek, čas stojí), `summary` (průchod dokončen). Pauza je příznak nad fází.

### Požadavky

- **R1 Časy.** Zastávka s číslem v trase 1–4 má 25 000 ms, 5–8 má 20 000 ms, 9–10 má 18 000 ms. V denní výzvě platí číslo zastávky v trase, ne pořadí v průchodu.
- **R2 Start odpočtu.** Odpočet začne až akcí „scéna připravena“ ve fázi `loading`. Do té doby žádná akce čas nemění.
- **R3 Uplynulý čas.** Akce v běžící otázce (`question`, bez pauzy) nesou `elapsedMs` od poslední započtené akce. Reducer nejdřív odečte `elapsedMs`. Je-li `elapsedMs >= remainingMs`, otázka skončí timeoutem a vlastní akce se zahodí. Volba nebo žolík přesně na nule tedy prohrají.
- **R4 Kola.** Každá zastávka má vlastní číslo kola. Akce nesou číslo kola. Akce s jiným číslem kola než aktuálním se ignorují (stav se vrátí beze změny, stejná reference).
- **R5 První akce platí.** Volba ve fázi `question` uzamkne otázku a přejde do `feedback`. Další volba, žolík nebo opakované „Další“ ve stejném kole stav nezmění.
- **R6 Skóre a série.** Správná volba: +1 správná, série +1, nejlepší série je maximum. Chybná volba a timeout: série 0. Přeskočení za video: počet správných i série beze změny.
- **R7 50:50.** Jednou za průchod, jen ve fázi `question` bez pauzy. Skryje dvě nesprávné volby; zůstane správná a první nesprávná v zobrazeném pořadí. Skrytou volbu nelze zvolit.
- **R8 +10 s.** Jednou za průchod, jen ve fázi `question` bez pauzy a jen v časovaném režimu. Přičte 10 000 ms. V nečasovaném režimu je nedostupný a akce se ignoruje.
- **R9 Kombinace.** Na jedné otázce lze použít 50:50 i +10 s a pak správně odpovědět.
- **R10 Nečasovaný režim.** Volba se přebírá jen při startu nového průchodu. Odpočet neběží, timeout nenastane, `elapsedMs` se ignoruje.
- **R11 Pauza.** Pauza zmrazí čas (`elapsedMs` pauzovací akce se započte podle R3). Pokračování po pauze čas nemění. Pauza je možná i ve fázi `loading` a `feedback` a čas tam neovlivní.
- **R12 Přeskočit za video – dostupnost.** Jen v pauze ve fázi `question`, jednou za průchod, od 3. zastávky průchodu (index ≥ 2): ve městě od 3. z 10, v denní výzvě jen u 3. ze 3 (rozhodnutí v LOG.md). Zda portál reklamy nabízí, rozhoduje app podle adaptéru; logika žolík jen povolí nebo zakáže podle stavu.
- **R13 Přeskočit za video – pokus.** Žádost o reklamu uloží ID pokusu. Výsledek reklamy se přijme jen s ID právě probíhajícího pokusu a jen jednou. `completed` uzavře otázku jako `skipped`, označí žolík jako použitý, zruší pauzu a přejde do `feedback`. `cancelled` a `unavailable` pokus zruší, otázka zůstane v pauze se stejným časem a žolík zůstane k dispozici. Výsledek s jiným ID, opakovaný výsledek nebo výsledek bez probíhajícího pokusu se ignoruje. Bez potvrzeného `completed` přeskočení nevznikne.
- **R14 Další.** „Další“ je jediná akce, která ve fázi `feedback` posouvá hru. Po zastávce, která není poslední, přejde na další zastávku do `loading` s novým číslem kola. Po poslední přejde do `summary`.
- **R15 Dokončení.** Průchod je dokončen ve fázi `summary` i s nulou správných.
- **R16 Obnova.** Obnova uloženého průchodu vrátí stejnou fázi, zastávku, žolíky, výsledky, čas a pořadí voleb, vždy s pauzou. Probíhající pokus o reklamu se zruší (přerušená reklama je nedokončená) a žolík zůstane.
- **R17 Restart.** Nový průchod stejné trasy (opakování, „Hrát znovu“) je nový stav s novým ID průchodu, novými permutacemi a bez žolíků, výsledků a série předchozího průchodu.
- **R18 Jazyk.** Stav neobsahuje texty ani jazyk. Změna jazyka pořadí voleb nemění.

### Scénáře (tabulka BRIEF §3 a K2)

- Volba s `elapsedMs` rovným zbývajícímu času → timeout, série 0. Volba s `elapsedMs` o 1 ms menším → přijatá volba.
- Totéž pro 50:50 a +10 s na hranici: žolík se nepoužije a otázka skončí timeoutem.
- Dvě volby za sebou ve stejném kole → platí první. „Další“ se starým číslem kola po přechodu na další zastávku → ignorováno.
- Série: správně, správně, chybně, správně → série 1, nejlepší 2. Timeout vynuluje sérii.
- Přeskočení za video se sérií 3 → série 3, správných beze změny, výsledek `skipped`.
- Výsledek reklamy s cizím ID, opakovaný `completed`, `completed` po `cancelled` stejného pokusu → nic dalšího se nestane.
- Reklama na 2. zastávce města nebo na 2. otázce denní výzvy → zakázáno. Na 3. otázce denní výzvy začínající zastávkou 1, 2 i 6 → povoleno.
- Nečasovaný režim: libovolně velké `elapsedMs` nevede k timeoutu, +10 s nejde použít.
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
- **D6 Jeden výsledek na den.** Pro každé datum se ukládá nejvýš jeden výsledek (ID města a počet správných 0–3). Výsledek patří datu startu. Datum s výsledkem další pokus neotevře. Při slučování zůstává první uložený výsledek.
- **D7 Série dnů.** Počet po sobě jdoucích dnů s výsledkem končících dnes nebo včera (podle předaného dnešního data), jinak 0. Nezávisí na pořadí, v jakém se výsledky uložily.
- **D8 Bez vlivu na postup.** Denní výsledek nemění hvězdy, pohlednice, dokončená města ani odemčení.
- **D9 Zpřístupnění.** Denní přehled je dostupný po dokončení prvního města (alespoň jedno dokončené město).
- **D10 Datum z času.** Funkce převede čas v ms od epochy na datum UTC (pomocí `Date` s předaným časem, bez čtení hodin).

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
- Druhý výsledek pro stejné datum → zůstane první.

## 5. Uložení (`src/game/storage/`)

### Požadavky

- **S1 Oddíly.** Data se ukládají po oddílech pod samostatnými klíči: nastavení, postup, denní výsledky, aktivní průchod. Hodnota každého klíče je JSON s číslem verze schématu a daty oddílu. Aktuální verze schématu je 1.
- **S2 Validace po oddílech.** Každý oddíl se při čtení validuje zvlášť. Nevalidní nebo chybějící oddíl se nahradí výchozím stavem, ostatní oddíly se použijí. V postupu a denních výsledcích se zachovají validní záznamy a zahodí jen nevalidní (např. neplatné hvězdy jednoho města nezahodí ostatní města).
- **S3 Verze.** Oddíl se známou starší verzí se migruje na aktuální. Oddíl s vyšší než aktuální verzí se nepoužije ani nepřepíše; hra pro něj pracuje v paměti a hlásí stejné jednorázové upozornění jako při nedostupném úložišti (rozhodnutí v LOG.md). Chybějící, nečíselná nebo nevalidní verze znamená poškozená data, která se smí přepsat.
- **S4 Slučování odměn.** Zápis postupu a denních výsledků nejdřív přečte uložený stav a sloučí ho podle P9 a D6, aby souběžná karta odměny nepřepsala.
- **S5 Jeden aktivní průchod.** Úložiště drží nejvýš jeden aktivní průchod. Zahození smaže jen aktivní průchod, odměny zůstanou.
- **S6 Vlastnictví mezi kartami.** Aktivní průchod nese ID karty, která ho naposled výslovně začala nebo obnovila. Karta, která není vlastníkem, průchod nepřepíše ani nesmaže. Čistá funkce nad uloženými daty a ID karty určí, zda karta průchod vlastní; app ji volá při událostech `storage` a `visibilitychange`.
- **S7 Dokončení.** Uložení dokončeného průchodu zapíše odměny (městský postup nebo denní výsledek) a smaže aktivní průchod. Opakované uložení téhož dokončení nic nezduplikuje.
- **S8 Nedostupné úložiště.** Když `read` nebo `write` vyhodí výjimku, hra pokračuje v paměti a upozornění se nabídne právě jednou za relaci.
- **S9 Nastavení.** Jazyk (`en` výchozí), zvuk zapnutý, hlasitost 0,6, vibrace zapnuté, bez animací vypnuto, nečasovaný režim vypnutý, seznam už zobrazených jednorázových nápověd.

### Scénáře

- Prázdné úložiště → výchozí stav všech oddílů.
- Poškozený JSON v postupu, validní nastavení → nastavení zachované, postup výchozí.
- Postup s jedním městem s hvězdami 7 a jedním validním → validní město zachované.
- Oddíl postupu s verzí 2 → nepoužit, po zápisu jiného oddílu i po zápisu postupu zůstane uložená hodnota beze změny, upozornění jednou.
- Dvě karty nad stejným úložištěm: karta A dokončí Paříž, karta B (se starým stavem v paměti) dokončí Londýn → uložené obě pohlednice.
- Dva denní výsledky stejného data z různých karet → zůstane první uložený.
- Karta B obnoví průchod → karta A už není vlastník a její zápis průchodu se neprovede.
- `KeyValueStore`, jehož metody vyhazují → hra běží v paměti, upozornění jednou, data v rámci relace se čtou zpět.

## Rozhraní

Sekci doplňují vývojáři balíčků přesnými podpisy a typy, jak jsou v kódu. Tady je plánovaná podoba, ze které balíčky vycházejí.

### `src/game/logic/choiceOrder.ts`

```ts
export type RandomSource = () => number // [0, 1)
export function keepsSourceOrder(stopId: string): boolean
export function shuffledChoiceIds(stop: Stop, random: RandomSource): string[]
export function permutedChoiceIds(stop: Stop, permutationNumber: number): string[] // 0–23 podle CO2
```

### `src/game/logic/run.ts`

```ts
export type RunPhase = 'loading' | 'question' | 'feedback' | 'summary'
export type StopOutcome = 'correct' | 'wrong' | 'timeout' | 'skipped'
export interface RunStop { stopId: string; routeStopNumber: number; timeLimitMs: number; choiceIds: string[]; correctChoiceId: string }
export interface StopResult { stopId: string; outcome: StopOutcome; chosenChoiceId: string | null }
export interface DailyRunInfo { utcDate: string; catalogEffectiveUtcDate: string }
export interface RunState { /* viz Stav */ }
export type RunAction =
  | { type: 'sceneReady'; round: number }
  | { type: 'tick'; round: number; elapsedMs: number }
  | { type: 'choose'; round: number; choiceId: string; elapsedMs: number }
  | { type: 'useFiftyFifty'; round: number; elapsedMs: number }
  | { type: 'useExtraTime'; round: number; elapsedMs: number }
  | { type: 'pause'; round: number; elapsedMs: number }
  | { type: 'resume'; round: number }
  | { type: 'requestSkip'; round: number; attemptId: string }
  | { type: 'adResult'; result: RewardedAdResult }
  | { type: 'next'; round: number }
export function timeLimitMs(routeStopNumber: number): number
export function createRun(options: { runId: string; mode: RunMode; cityId: string; untimed: boolean; stops: RunStop[]; daily?: DailyRunInfo }): RunState
export function startCityRun(options: { route: Route; runId: string; untimed: boolean; random: RandomSource }): RunState
export function reduceRun(run: RunState, action: RunAction): RunState
export function restoreRun(run: RunState): RunState
export function currentStop(run: RunState): RunStop
export function visibleChoiceIds(run: RunState): string[]
export function canUseSkip(run: RunState): boolean
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
export interface DailyPlan { utcDate: string; catalogEffectiveUtcDate: string; cityId: string; firstStopNumber: number }
export interface DailyResult { cityId: string; correct: number }
export type DailyResults = Record<string, DailyResult> // klíč je datum UTC
export function fnv1a32(text: string): number
export function utcDateOf(epochMs: number): string
export function catalogVersionFor(catalog: Catalog, utcDate: string): CatalogVersion | null
export function dailyPlan(catalog: Catalog, utcDate: string): DailyPlan | null
export function startDailyRun(options: { route: Route; plan: DailyPlan; runId: string; untimed: boolean }): RunState
export function recordDailyResult(results: DailyResults, utcDate: string, result: DailyResult): DailyResults
export function dailyStreak(results: DailyResults, todayUtcDate: string): number
export function mergeDailyResults(stored: DailyResults, incoming: DailyResults): DailyResults
export function dailyUnlocked(progress: Progress): boolean
```

### `src/game/storage/`

Doplní balíček 4.
