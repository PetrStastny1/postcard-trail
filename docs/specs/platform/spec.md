# Specifikace oblasti platform

Oblast dodává portálové adaptéry za kontraktem [`src/platform/types.ts`](../../../src/platform/types.ts) a zvukovou a vibrační odezvu v `src/game/feedback/`. Kontrakt a [API.md](../../plan/API.md) mění jen ředitel. Rozhodnutí k oblasti jsou v [LOG.md](../../decisions/LOG.md) (záznamy „Platform: …“).

Podklady: BRIEF §3 (tabulka reklam a obnovy), §8 (pocit ze hry), §11 (zvuk), §12 (portál a monetizace), §13 (měření). SDK ověřeno 26. 11. 2026 podle [Poki SDK HTML5](https://developers.poki.com/guide/sdk-html5), [Poki SDK overview](https://developers.poki.com/guide/sdk-overview), [Poki požadavky](https://developers.poki.com/guide/requirements-quality), [Poki herní události](https://developers.poki.com/guide/game-events), [CrazyGames SDK v3](https://docs.crazygames.com/sdk/intro/), [Game module](https://docs.crazygames.com/sdk/game/), [Video ads](https://docs.crazygames.com/sdk/video-ads/) a [požadavky na reklamy](https://docs.crazygames.com/requirements/ads/).

## Veřejné rozhraní pro oblast app

Jiné soubory než níže uvedené jsou vnitřní a app je nemá importovat.

### `src/platform/index.ts`

```ts
export function createPlatform(): PlatformAdapter
```

- Vybere adaptér podle `import.meta.env.VITE_PLATFORM`: `poki`, `crazygames`, jinak `local`. Volba platí pro celý build.
- Vývojový režim je `import.meta.env.DEV` (`npm run dev`, tedy i e2e). Produkční je každý `vite build`.
- Volá se jednou při startu. Pak app zavolá `await adapter.init()` a teprve potom ostatní metody. Portálové adaptéry volání před vyřešením `init()` neposílají do SDK.
- Lokální build (`npm run build`) neobsahuje kód ani adresu SDK Poki a CrazyGames. Portálový build obsahuje jen SDK svého portálu.

### `src/game/feedback/index.ts`

```ts
export type FeedbackCue = 'choice' | 'correct' | 'wrong' | 'postcard'

export interface FeedbackSettings {
  sound: boolean
  vibration: boolean
}

export interface Feedback {
  /**
   * Call at the start of the handler of every activating player input (`click`, `keydown`), not only the first
   * and not from `pointerdown`: browsers allow audio to start only on an activating input, and a resume that was
   * refused, never finished, or was cut by an iOS interruption is retried only on the next call. Creates the audio
   * context if there is none and asks a halted one to resume; a cue played in the same handler still sounds.
   */
  unlock(): void
  play(cue: FeedbackCue): void
  setSoundEnabled(enabled: boolean): void
  setVibrationEnabled(enabled: boolean): void
  /** Call from `RewardedAdRequest.onStart`. */
  muteForAd(): void
  /** Call when the attempt has a result (or is abandoned). */
  restoreAfterAd(): void
}

export function createFeedback(settings: FeedbackSettings): Feedback
```

- App volá `unlock()` na začátku handleru každého aktivujícího vstupu hráče (`click`, `keydown`), ne jen prvního a ne z `pointerdown`. Prohlížeče dovolí spustit zvuk jen při aktivujícím vstupu (dotykový `pointerdown` jím není). Obnova zvuku po odmítnutém nebo nedokončeném `resume()` a po přerušení na iOS (`interrupted`) spoléhá na další `unlock()`.
- Nastavení zvuku a vibrací ukládá oblast logic, feedback dostává jen jejich hodnoty.
- Úvod je tichý: app na úvodní obrazovce `play` nevolá.
- Každý podnět má viditelný ekvivalent v UI (zajišťuje app).

## Požadavky

### P1 Výběr adaptéru při buildu

`createPlatform()` vrací adaptér `local`, `poki` nebo `crazygames` podle `VITE_PLATFORM` (výchozí `local`). SDK se načítá jen v příslušném portálovém buildu. Testy nevolají skutečné SDK ani síť.

- **S1.1** Lokální produkční build (`npm run build`) neobsahuje řetězce `poki-sdk` ani `crazygames-sdk`.
- **S1.2** Build `build:poki` obsahuje adresu SDK Poki a neobsahuje adresu SDK CrazyGames, `build:crazygames` naopak.

### P2 Lokální úložiště

`store` všech tří adaptérů je `localStorage` s prefixem klíče `postcard-trail:` (rozhodnutí „Platform: úložiště na CrazyGames“). Adaptér nedělá schéma ani validaci.

- **S2.1** `store.write('save', 'x')` zapíše hodnotu pod klíč `postcard-trail:save` a `store.read('save')` ji vrátí. Neexistující klíč vrátí `null`.
- **S2.2** Když přístup k `localStorage` nebo zápis hází (soukromý režim, plná kvóta, zablokované cookies), `read` i `write` výjimku propustí dál. Náhradu v paměti řeší `src/game/storage`.
- **S2.3** Úložiště se otevírá až při volání `read`/`write`, takže vytvoření adaptéru neháže ani bez přístupu k `localStorage`.

### P3 Záznam událostí měření

- **S3.1** Ve vývojovém režimu každý adaptér přidá každou událost z `track` do `recordedEvents()` v pořadí volání, včetně opakovaných.
- **S3.2** V produkčním režimu je `recordedEvents()` vždy prázdné pole a lokální adaptér nic neodesílá (do vydání bez analytické služby třetí strany).
- **S3.3** `recordedEvents()` vrací kopii nebo neměnné pole, změna výsledku neovlivní záznam.
- Export pro e2e a ruční kontrolu je `JSON.stringify(adapter.recordedEvents())`. Zpřístupnění na stránce (například pro Playwright) řeší app.

### P4 Lokální adaptér: reklama za odměnu

Ve vývojovém režimu se chování čte jednou při vytvoření adaptéru z parametrů adresy (`location.search`):

| Parametr | `rewardedAdsOffered()` | Průběh `requestRewardedAd` |
|---|---|---|
| žádný `ad`, nebo neznámá hodnota | `true` | výsledek `unavailable`, bez `onStart` |
| `ad=completed` | `true` | `onStart`, po `SIMULATED_SPOT_MS` výsledek `completed` |
| `ad=cancelled` | `true` | `onStart`, po `SIMULATED_SPOT_MS` výsledek `cancelled` |
| `ad=unavailable` | `true` | výsledek `unavailable`, bez `onStart` |
| `ad=interrupted` | `true` | `onStart` a žádný výsledek (spot skončí reloadem stránky) |
| `ad=duplicate` | `true` | `onStart`, po `SIMULATED_SPOT_MS` dvakrát po sobě výsledek `completed` se stejným `attemptId` |
| `ad=late` | `true` | `onStart`, po `SIMULATED_SPOT_MS` výsledek `cancelled`, po dalších `LATE_RESULT_DELAY_MS` výsledek `completed` se stejným `attemptId` přes callback téhož požadavku |
| `ads=none` (přednost před `ad`) | `false` | výsledek `unavailable`, bez `onStart` |

Konstanty: `SIMULATED_SPOT_MS = 500`, `LATE_RESULT_DELAY_MS = 2000`.

V produkčním režimu se parametry adresy ignorují: `rewardedAdsOffered()` je `false` a případný požadavek skončí `unavailable` bez `onStart`.

- **S4.1** Výsledek nese `attemptId` z požadavku.
- **S4.2** Žádný callback se nevolá synchronně uvnitř `requestRewardedAd`. `onStart` přijde v následující úloze (timer 0 ms), výsledek `unavailable` také.
- **S4.3** Každý požadavek běží samostatně podle tabulky, i když předchozí ještě neskončil (u `late` tak pozdní `completed` starého ID může dorazit během nového pokusu).
- **S4.4** Adaptér nikdy sám reklamu nespustí. Bez `requestRewardedAd` se nevolá žádný callback.
- **S4.5** `name` je `'local'`, `init()` se vyřeší hned. Signály načítání a hraní nic neodesílají.

### P5 Signály načítání a hraní na portálech

Platí pro adaptéry Poki a CrazyGames.

- **S5.1** `gameplayStart()` pošle do SDK `gameplayStart` jen tehdy, když poslední odeslaný herní signál nebyl start. Stejně `gameplayStop()` pošle `gameplayStop` jen po odeslaném startu. Před prvním startem se stop neposílá.
- **S5.2** `requestRewardedAd` nejdřív pošle `gameplayStop`, pokud bylo hraní spuštěné. Po dobu požadavku (od zavolání do prvního výsledku z SDK) se volání `gameplayStart`, `gameplayStop` a měřicí volání SDK ignorují a neodkládají. Po výsledku je hraní zastavené, app zavolá `gameplayStart` při návratu do aktivní otázky.
- **S5.3** Poki: `loadingStarted()` nemá v SDK v2 obdobu a nic neposílá. `loadingFinished()` pošle `PokiSDK.gameLoadingFinished()` nejvýš jednou za relaci.
- **S5.4** CrazyGames: `loadingStarted()` pošle `SDK.game.loadingStart()` a `loadingFinished()` pošle `SDK.game.loadingStop()`. Opakované volání bez opačného signálu se sloučí.
- **S5.5** Když se SDK nenačte, inicializace selže nebo je CrazyGames v prostředí `disabled`, adaptér do SDK nic neposílá a hra běží dál. Poki po `init()` v `.catch` signály posílá dál (SDK je načtené).
- **S5.6** První herní signál vzniká při vstupu hráče: app volá `gameplayStart` až v aktivní otázce otevřené akcí hráče (také po obnově, která je vždy pozastavená). Adaptér to nekontroluje.
- **S5.7** Průběžné reklamy mají četnost 0: adaptéry nikdy nevolají `PokiSDK.commercialBreak` ani `requestAd('midgame')`.

### P6 Reklama za odměnu na portálech

- **S6.1** Poki: `rewardedAdsOffered()` je `true` po vyřešeném `PokiSDK.init()`, jinak `false`. `requestRewardedAd` zavolá `PokiSDK.rewardedBreak(onStart)`. Výsledek `true` → `completed`; `false` po spuštění spotu → `cancelled`; `false` bez spuštění nebo zamítnutý promise → `unavailable`.
- **S6.2** CrazyGames: `rewardedAdsOffered()` je `true` po úspěšném `SDK.init()` v prostředí `crazygames` nebo `local`, jinak `false`. Po prvním `adError` s kódem `adsDisabled` je `false` až do konce relace. `requestRewardedAd` zavolá `SDK.ad.requestAd('rewarded', { adStarted, adFinished, adError })`: `adStarted` → `onStart`, `adFinished` → `completed`, `adError` po `adStarted` → `cancelled`, `adError` bez `adStarted` → `unavailable`. `adError` nikdy nevede na `completed`.
- **S6.3** Když `rewardedAdsOffered()` je `false`, požadavek skončí `unavailable` bez volání SDK a bez `onStart`, asynchronně.
- **S6.4** Adaptér předá každý callback, který SDK zavolá, i opakovaně nebo pozdě, vždy s `attemptId` požadavku. Odfiltrování řeší logic.
- **S6.5** Když přijde nový požadavek, zatímco předchozí na portálu ještě nemá výsledek, nový skončí `unavailable` bez volání SDK.
- **S6.6** App čte `rewardedAdsOffered()` při každém vykreslení pauzy, ne jen při startu.

### P7 Měření na portálech

- **S7.1** Poki posílá vybrané události přes `PokiSDK.measure(category, what, action)` (bez `/` a `^`, bez identifikátorů hráče):

| Událost | `measure` |
|---|---|
| `route_started`, `resumed: false` | `(mode, cityId, 'start')` |
| `route_started`, `resumed: true` | `(mode, cityId, 'resume')` |
| `route_completed` | `(mode, cityId, 'complete')` |
| `question_resolved` | `(\`${mode}-stop\`, String(index), outcome)` |
| `route_left` | `(\`${mode}-stop\`, String(index), \`left-${reason}\`)` |
| `lifeline_used` | `('lifeline', lifeline, 'used')` |
| `postcard_unlocked` | `('postcard', cityId, 'unlocked')` |
| `rewarded_ad_outcome`, `daily_completed` | neposílá se (Poki měří reklamy samo, denní dokončení pokrývá `route_completed` s `mode: 'daily'`) |

- **S7.2** CrazyGames SDK v3 nemá obecné vlastní události, adaptér je neposílá.

### P8 Zvuk

- **S8.1** Před `unlock()` se nevytváří `AudioContext` a `play` nehraje zvuk. `unlock()` vytvoří kontext s hlavní hlasitostí 0,6, nebo obnoví existující kontext, který neběží (`suspended`, na iOS Safari po přerušení `interrupted`). Uzavřený kontext (`closed`) neobnovuje. Opakované `unlock()` nový kontext nevytváří. Dokud kontext neběží, volá každé `unlock()` znovu `resume()`, i když předchozí `resume()` ještě neskončilo (Chrome ho bez aktivace uživatele nechá viset). Kontext, který po vytvoření rovnou běží, neobnovuje. Odmítnutí `resume()` nic nehází, zvuk se zkusí obnovit při dalším `unlock()`. Bez Web Audio API, nebo když vytvoření kontextu selže (např. `NotSupportedError`), hra pokračuje bez zvuku: `unlock()` nic nehází, další pokus o vytvoření kontextu už nedělá a `play` jen vibruje.
- **S8.2** Podněty (syntéza oscilátory s obálkou bez lupnutí):

| Podnět | Zvuk |
|---|---|
| `choice` | tlumené kliknutí: jeden krátký tón do 40 ms |
| `correct` | dva vzestupné tóny po sobě |
| `wrong` | jeden měkký nízký tón |
| `postcard` | krátký akord: tři tóny současně, do 600 ms |

Zvolené hodnoty (pojmenované konstanty v `src/game/feedback/index.ts`). Každý tón jde přes vlastní obálku: od 0 náběh 4 ms na vrchol a lineární doběh na 0 v okamžiku zastavení oscilátoru. Obálky vedou do hlavní hlasitosti.

| Podnět | Tóny |
|---|---|
| `choice` | trojúhelník 660 Hz, 30 ms, vrchol 0,25 |
| `correct` | sinus 523,25 Hz (C5) 90 ms, hned po něm sinus 783,99 Hz (G5) 140 ms, vrchol 0,3 |
| `wrong` | trojúhelník 196 Hz (G3), 220 ms, vrchol 0,3 |
| `postcard` | sinus 523,25, 659,25 a 783,99 Hz (C dur) současně, 500 ms, vrchol 0,18 na hlas |

Tóny se plánují do kontextu ve stavu `running`, nebo když `unlock()` požádal o obnovu ve stejné synchronní úloze (do konce aktuálního handleru). Nový i obnovovaný kontext přejde do `running` až asynchronně, takže `play` ve stejném handleru jako `unlock()` (např. první volba po obnovené otázce) zazní hned po rozběhnutí. V pozdější úloze kontext, který neběží (`suspended`, `interrupted`, `closed`, i po odmítnutém nebo nedokončeném `resume()`), oscilátor nedostane, aby podněty z doby pozastavení nezazněly po obnovení najednou. Vibrace se tím nemění.

- **S8.3** `setSoundEnabled(false)` ztlumí hlavní hlasitost ihned (v aktuálním čase kontextu, naplánované změny se zruší), i probíhající tón, a další `play` nevytvoří oscilátor. Vypnutí před `unlock()` znamená, že kontext začne potichu. `setSoundEnabled(true)` vrátí 0,6.
- **S8.4** `muteForAd()` ztlumí ihned. `restoreAfterAd()` vrátí uloženou úroveň: 0,6 při zapnutém zvuku, jinak ticho. Zapnutí zvuku během reklamy se projeví až po `restoreAfterAd()`.

### P9 Vibrace

- **S9.1** `correct` vibruje 25 ms a `postcard` 35 ms přes `navigator.vibrate`, jen když je vibrace zapnutá a API existuje. `choice` a `wrong` nevibrují.
- **S9.2** Vibrace nezávisí na zvuku ani na `unlock()`. Během `muteForAd()` se nevibruje.
- **S9.3** Bez `navigator.vibrate` nebo při vypnutém nastavení se nic neděje a nic nehází.

## Otevřené body pro ředitele a app

- App volá `feedback.unlock()` na začátku handleru každého aktivujícího vstupu hráče (`click`, `keydown`), ne jen prvního a ne z `pointerdown`. Jinak zvuk po odmítnutém nebo nedokončeném `resume()` či po přerušení na iOS do konce relace nezazní.
- CrazyGames vyžaduje respektovat `SDK.game.settings.muteAudio` s předností před herním nastavením. Kontrakt `PlatformAdapter` ho nevystavuje. Návrh změny kontraktu je v předávací zprávě oblasti.
- Poki doporučuje `commercialBreak()` při návratu z pauzy. Zadání nastavuje průběžné reklamy na 0 (§12, K5), adaptér je proto nevolá.
- CrazyGames nechce `gameplayStop` při pouhé ztrátě fokusu. Hra se ale po skrytí stránky skutečně pozastaví a čeká na „Pokračovat“, takže `gameplayStop` při skrytí je oprávněný.
