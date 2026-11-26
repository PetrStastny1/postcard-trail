# Postcard Trail / Poznej město

## Zadání od Petra

Aktuální pravidla určuje [třetí revize](ZMENY-PO-REVIZI-3.md). Nadále platí slučitelné požadavky z [druhé revize](ZMENY-PO-REVIZI-2.md), [první revize](ZMENY-PO-REVIZI.md) a [původního zadání](ZADANI-PRO-DESIGNERA.md). První verze nabídne 20 evropských hlavních měst, 200 samostatných scén a 200 poznávacích otázek v EN a CS. Po dohrání každého města hráč získá jednu pohlednici. Další aktualizace doplní evropské hlavní metropole podle pořadí v §5.

## 1. Shrnutí

Prozkoumej deset ilustrovaných zastávek skutečného města, přečti stopy v obraze a odnes si pohlednici. Jde o zeměpisně-kulturní kvíz s procházkami a sbírkou. [Průzkum konkurence a názvu](RESEARCH.md), [rozpracovaný koncept](CONCEPTS.md)

Trasa pokračuje po skutečných místech. Hráč spojuje viditelnou stopu v právě otevřeném výjevu se skutečným názvem místa, dominanty, řeky nebo typického místního symbolu. Dvě úvodní otázky pracují se státní vlajkou. Zpětná vazba pojmenuje místo a detail. Hra cílí na příležitostné hráče od 12 let včetně těch, kteří město nenavštívili. Město zabere přibližně 3–6 minut, denní výzva 1–2 minuty. HTML5 pro CrazyGames a Poki, desktop i mobil, na výšku i na šířku. Výchozí angličtina, přepínač English / Čeština v nastavení. První spuštění použije angličtinu bez ohledu na prohlížeč. Změna se uloží a projeví i v rozehrané otázce se stejným pořadím voleb.

## 2. Herní smyčky

- **Zastávka** — po zobrazení celé scény běží čas. Hráč prohlédne obraz, zvolí odpověď nebo žolíka, přečte jednu větu o místě a klikne na „Další“ / „Next“. Zpětná vazba zůstává do potvrzení.
- **Trasa** — deset zastávek v pevném pořadí. Každý výsledek posune trasu, i když se hráč splete. Městský souhrn ukáže výsledek, nejlepší sérii, hvězdy, pohlednici a nově odemčenou trasu.
- **Návrat** — mapa evropských metropolí, dokončování sbírky, zlepšování nejlepších hvězd a denní výzva. Odemčené trasy lze opakovat.

## 3. Pravidla

Každé město je deset stabilně identifikovaných zastávek se čtyřmi unikátními volbami a jedinou správnou odpovědí. Stav jednoho průchodu drží ID trasy, index, fázi, zbývající čas v ms, použité žolíky, výsledky, aktuální a nejlepší sérii. Fáze průchodu jsou načítání scény, otázka, zpětná vazba a souhrn. Pauza překrývá aktuální fázi.

- Zastávky 1–4 mají 25 s, 5–8 mají 20 s, 9–10 mají 18 s. Čas otázky běží od okamžiku, kdy jsou připraveny scéna i volby a otázka je v popředí. Hráč má v nastavení volbu „Bez časového limitu“ / „Untimed“. Použije se od příštího nového průchodu, městského i denního, se stejnými odměnami a se skrytým žolíkem +10 s. Rozhoduje kvalita odpovědi.
- Kliknutí na volbu ji ihned uzamkne. Správná se zvýrazní a v případě chyby se označí i zvolená chybná. Timeout nebo přeskočení zvýrazní správnou. Ve všech případech je vidět výsledek slovem i symbolem a stejná informativní věta ze zastávky.
- U městské trasy se při startu pořadí voleb každé zastávky zamíchá rovnoměrným Fisherovým–Yatesovým postupem a uloží jako ID voleb. U denní výzvy dostane stejné datum stejné pořadí na všech zařízeních se stejnou verzí katalogu: zdrojem pro výběr je FNV-1a 32bit z textu `YYYY-MM-DD:cityId:questionId` a zbytek po dělení 24 vybere jednu z 24 permutací v lexikografickém pořadí podle zdrojových indexů. Žolíky, klávesy i čtečka používají skutečné zobrazené pořadí. Obnovení a jazyková změna ponechají původní permutace. B09 vždy zobrazuje M1, M2, M3, M4 v tomto pořadí.
- Každý ze tří žolíků je k dispozici jednou za průchod. **50:50** ihned skryje dvě nesprávné volby. Zůstane první nesprávná v původním zobrazeném pořadí otázky, číselné zkratky ostatních se vypnou. **+10 s** přičte 10 000 ms. Oba nechají možnost započítat správnou odpověď. **Přeskočit za video** je v pauze od třetí zastávky města či denní výzvy, pokud je žolík dostupný. Otevře potvrzení s informací o výsledku, čas zůstává pozastavený. Po úspěšném spotu otázku uzavře jako přeskočenou: zachová aktuální sérii a nepřičte správnou odpověď. Při stornu, nedostupnosti nebo nedokončení otázka i žolík zůstanou. Návrat z potvrzení nebo stavu nedostupnosti tlačítkem „Zpět k odpovědi“ obnoví otázku a její čas. Křížek v těchto oknech vrací do pauzy. Na jednu otázku lze kombinovat žolíky.
- Každé město končí po potvrzení desáté zpětné vazby včetně chyb a timeoutů. Ukončený průchod je dokončen i s nulou správných. Trasu lze opakovat ze souhrnu nebo mapy.
- Datum výzvy se určuje v UTC. Vydání obsahuje seznam verzí katalogu `{effectiveUtcDate, orderedCityIds}`. Vybere se poslední verze účinná v daném dni. Její seznam obsahuje právě všechny vydané trasy v pořadí odemykání, včetně těch, které má hráč ještě zamčené. První verze je účinná ode dne vydání, před tímto dnem se denní výzva nenabízí. Pro n = počet měst a D = počet celých UTC dnů od účinnosti verze je index města D modulo n (od 0), první zastávka má číslo 1 + floor(D / n) modulo 8. Hraje se tato zastávka a další dvě v původním pořadí, se stejnými scénami, časy a otázkami. Pro první katalog to znamená 20 měst v každém dvacetidenním kole a všech 8 možných začátků každé trasy během 160 dnů. Po vydání balíku začne od data účinnosti nové kolo s rozšířeným katalogem. Datum, verze a přesná ID tří zastávek se uloží při startu, takže změna dne či katalogu rozehranou výzvu nezmění. Určené pořadí se používá i u hráčů s odlišným postupem. Denní výsledek je nejvýš jeden na datum a nepřidává hvězdy, pohlednice ani odemčení. Denní přehled se zpřístupní po dokončení prvního města.
- Zařízení drží jeden aktivní průchod jakéhokoli typu. Při výběru jiného průchodu se ukáže potvrzení „Zahodit rozehranou trasu?“ / „Discard your current route?“. Zrušení vrátí do okna výběru. Potvrzení smaže jen rozehranou relaci, včetně jejích žolíků a série. Dokončené odměny zůstávají.

| Situace | Výsledek |
|---|---|
| Volba nebo žolík přesně na nule | Nejdřív se vyhodnotí vypršení, čas zpracované akce musí být přísně před termínem. |
| Dvojklik nebo opakovaná klávesa | Platí první přijatá akce v dané fázi. Opakovaný vstup přes přechod se ignoruje, nové kolo má vlastní ID. |
| Skrytí panelu, pauza nebo změna orientace | Skrytí ihned zmrazí otázku, po návratu čeká „Pokračovat“. Změna orientace pouze přepočítá layout. Ruční pauza i otevřená nastavení drží čas zmrazený. |
| Obnova stránky nebo odchod na úvod | Uložený kontrolní bod obnoví scénu, fázi, žolíky, výsledek, čas a pořadí, vždy pozastavené. Zápis při akci, průchodu celou sekundou během odpočtu a skrytí stránky. Tvrdé zavření může přidat nejvýše neuložený zlomek sekundy. Přerušená reklama se obnoví jako nedokončená. |
| Zpožděný nebo opakovaný callback reklamy | Výsledek přijme jen právě probíhající pokus se správným ID, nejvýš jednou. Bez potvrzeného úspěchu přeskočení nevznikne. |
| Došla otázka, po odpovědi se čeká | Čas stojí a Další je jediná akce posouvající hru. Poslední výsledek se uloží s dokončením při jeho potvrzení. |
| Scéna se nenačetla | Čas nezačne. „Zkusit znovu“ a „Úvod“ umožní návrat, další pokus stahuje stejný asset. |
| Chybějící či poškozené uložené údaje | Neznámé verze či nevalidní pole se nepoužijí. Validní nastavení a dosažená odemčení se zachovají po jednotlivých oddílech. Při nedostupném úložišti hra pokračuje v paměti a ukáže jednou upozornění. |
| Denní průchod přes půlnoc, aktualizaci nebo návrat hodin | Výsledek náleží dni startu. Seznam uložených zastávek má přednost před výpočtem z nové verze. Datum s výsledkem už další pokus neotevře. |

## 4. Ovládání

Myš a dotyk aktivují viditelná tlačítka. Klávesy 1–4 odpovídají pozicím voleb, Tab/Shift+Tab prochází prvky, Enter/Mezerník aktivují tlačítko ve fokusu. Po výsledku se fokus přesune na „Další“. Escape při hraní pozastaví, v okně funguje jako křížek. Adresát akce musí být aktuálně zobrazený a povolený. Kliknutí mimo cíl nic neprovede. Všechna tlačítka 44 × 44 CSS px nebo větší, zřetelný fokus, žádné funkce výhradně na hover. Dialog drží fokus, po zavření ho vrátí na otevírací prvek. Čtečka oznamuje výsledek a popis scény bez skryté odpovědi; čas neoznamuje každou sekundu.

## 5. Úrovně a obtížnost

### Pořadí a rozsah vydání

Pořadí je redakční odhad známosti pro mezinárodní publikum založený na viditelnosti měst v cestovním ruchu a rozpoznatelnosti jejich dominant. Paříž, Londýn a Řím jsou zadáním určený začátek. Bratislava má zadané 8. místo kvůli známosti pro české a slovenské hráče. Žebříčky nepokrývají všechna hlavní města stejnou metodou, proto je u dalších měst pořadí návrhem pro hru. [Euromonitor – City Destinations Index](https://www.euromonitor.com/newsroom/press-releases/december-2025/euromonitor-international-unveils-worlds-top-100-city-destinations-for-2025), [Europe’s Best Cities 2025](https://cdn.paris.fr/paris/2025/05/07/best-cities-europes-best-cities-2025-Pu5y.pdf)

| Pořadí | První verze | Pořadí | První verze |
|---:|---|---:|---|
| 1 | [Paříž](cities/paris.md) | 11 | [Lisabon](cities/lisbon.md) |
| 2 | [Londýn](cities/london.md) | 12 | [Dublin](cities/dublin.md) |
| 3 | [Řím](cities/rome.md) | 13 | [Kodaň](cities/copenhagen.md) |
| 4 | [Berlín](cities/berlin.md) | 14 | [Stockholm](cities/stockholm.md) |
| 5 | [Madrid](cities/madrid.md) | 15 | [Brusel](cities/brussels.md) |
| 6 | [Amsterdam](cities/amsterdam.md) | 16 | [Budapešť](cities/budapest.md) |
| 7 | [Atény](cities/athens.md) | 17 | [Varšava](cities/warsaw.md) |
| 8 | [Bratislava](cities/bratislava.md) | 18 | [Oslo](cities/oslo.md) |
| 9 | [Vídeň](cities/vienna.md) | 19 | [Helsinky](cities/helsinki.md) |
| 10 | [Praha](cities/prague.md) | 20 | [Reykjavík](cities/reykjavik.md) |

Evropský atlas má v plánu 47 tras. Zahrnuje 41 státních hlavních měst z evropského regionu OSN M49 po výjimkách z §16, pět státních hlavních měst členů Rady Evropy se statistickým zařazením do Asie a Prištinu z dosavadního katalogu. U Prištiny se politický status neboduje. Londýn je hlavní město Spojeného království. Bern je sídlem spolkových orgánů Švýcarska. Vatikán má vlastní trasu se scénami odlišnými od římských. [OSN M49](https://unstats.un.org/unsd/methodology/m49/overview/), [Rada Evropy](https://www.coe.int/en/web/about-us/our-member-states), [Švýcarsko – Bern](https://www.eda.admin.ch/aboutswitzerland/en/home/politik-geschichte/politisches-system/bundesstadt-bern.html)

Dosavadní vymezení už pokrývá způsobilé státní metropole. Po vyřazení tří tras proto poslední balík obsahuje 7 měst. Mapa, sbírka i denní rotace pracují pouze s vydanými trasami.

| Aktualizace | Pořadí odemykání v rámci balíku |
|---|---|
| A, 21–30 | 21 Vatikán · 22 Bukurešť · 23 Bělehrad · 24 Tallinn · 25 Ankara · 26 Riga · 27 Záhřeb · 28 Tbilisi · 29 Lublaň · 30 Sofie |
| B, 31–40 | 31 Sarajevo · 32 Vilnius · 33 Valletta · 34 Lucemburk · 35 Bern · 36 Monako · 37 Nikósie · 38 Tirana · 39 Skopje · 40 Jerevan |
| C, 41–47 | 41 Baku · 42 Kišiněv · 43 Podgorica · 44 Priština · 45 San Marino · 46 Andorra la Vella · 47 Vaduz |

Balíky se přidávají na konec katalogu a ID starších tras i postup hráčů se zachovají. Po vydání nového balíku se první nové město zpřístupní hráči, který má dohráno předchozí město v pořadí. Každá trasa přidá 10 scén a 10 otázek v EN/CS. Balíky A a B tedy přidají po 100 scénách a otázkách a balík C přidá 70. Platí stejná validace jako u první verze.

### Tvorba otázek

| Zastávky | Obtížnost | Požadavek na obsah |
|---|---|---|
| 1–4 | Lehká / Easy | Všechny 4 zastávky vyžadují spojit scénu se známou dominantou, řekou, místem nebo městským symbolem. Výjimkou jsou dvě úvodní otázky na stát podle vlajky. Odpověď zvládne hráč bez návštěvy ze všeobecného přehledu či známé siluety. |
| 5–8 | Těžká / Hard | Rozpoznat konkrétní místní stavbu, náměstí, trasu, park nebo detail s místní identitou. Volby jsou uvěřitelné a v obraze je patrný rozdíl. |
| 9–10 | Expert | Méně známé místo nebo místní detail s jednoznačným znakem, který pomůže postupně vyloučit tři nesprávné možnosti. Vzor je nízké nástupiště se žlutou soupravou M1. |

Každá otázka funguje samostatně nad aktuální scénou, i v denní výzvě. Barva, tvar, počet, materiál a podobné vlastnosti slouží jako stopy k rozpoznání, jednoduché vyjmenování toho, co je v obraze, správnou volbu neurčuje. Vynechej letopočty, zakladatele, bývalé obyvatele, kapely a názvy slohů jako odpovědi. Název řešení drž mimo viditelné nápisy, zadání, alternativní text i popisek aktuální zastávky před odpovědí. Každé město má nejvýš 1 otázku, jejímž řešením je název chrámu včetně katedrály či baziliky; používej jen architektonicky rozpoznatelný exemplář. Všechny volby musí odpovídat položené otázce. Podobné budovy jsou vhodnými možnostmi jen tehdy, pokud je scéna umí odlišit. Dobový výjev lze pro rozpoznání použít s doloženou scénou, nikoli jako test historie. Scény a formulace volit tak, aby hra byla vhodná i pro děti.

Stát nebo státní vlajka jako předmět otázky se počítají společně do limitu dvou měst při vydání. Použije se jen PAR02 v první Paříži a P01 v úvodu Prahy. Ve všech ostatních městech je předmětem jednotlivých otázek konkrétní místní název nebo symbol.

Pro redakční ověření u každé lehké otázky popiš obraz bez názvů a zkus určit, zda čistý popis, znění otázky nebo popisek obrazovky sám vybírá správnou možnost. V takovém případě uprav otázku nebo volby. U každého experta popis **Rozlišovací znak** v městském souboru určuje potřebný záběr a vysvětluje, čím scéna vyloučí ostatní volby. Před schválením ilustrace ověř viditelnost znaku na mobilu a připoj fotopodklad konkrétního místa.

Data v `src/content`: město má stabilní `id` shodné s názvem souboru, `name:{en,cs}`, souřadnice, `postcardQuestionId` a přesně deset zastávek. Zastávka má `id`, `place:{en,cs}`, `difficulty`, `sceneAsset`, `sceneAlt:{en,cs}`, `question:{en,cs}`, čtyři `choices` s ID a `label:{en,cs}`, `correctChoiceId`, `feedback:{en,cs}`, `sourceUrls`, `photoReferenceUrls`, `verifiedOn` a `stability: stable|changeable`. Scéna a fotografie se vážou na jedno ID, datum ze záhlaví městského souboru se přenese ke všem jeho záznamům. Strany o architektuře dokumentují skutečný objekt a fotografie slouží ke kontrole konkrétního rozlišovacího detailu. Při vydání se měnící se údaje ověří v dopravních podkladech. Pro B09 použij statický plán [GTFS BKK](https://opendata.bkk.hu/data-sources), pro LIS03 zveřejněnou trasu [Carris 28E](https://www.carris.pt/viaje/carreiras/28e/). Při neplatném měnícím se faktu stopne validace stavbu vydání k opravě obsahu. Trasy jsou psané s konkrétními záběry a veřejnými zdroji, otázky a ilustrace se při hraní negenerují.

### Papírové průchody úvodní trasy

| Zastávka | Rozhodnutí pozorováním | Výsledek |
|---|---|---|
| PAR01 | Hráč vidí čtyři nohy, příhradový kov a siluetu celé věže; vyloučí kamennou Pisu a válcovou CN Tower. | Zvolí Eiffelovu věž, získá 1 správnou a po větě přejde na most. |
| PAR02 | Svislá modrá, bílá a červená v tomto pořadí ho dovedou k francouzské trikolóře. | Zvolí Francii, série 2. |
| PAR03 | Pohled mezi Trocadérem a věží ukazuje známý pařížský tok. Hráč může spotřebovat 50:50. | Zůstanou Seina a první nesprávná volba v zobrazeném pořadí. Správná Seina dává sérii 3. |
| PAR04 | Zlatá kupole a nízká křídla dvora odliší pařížský komplex od Panthéonu i Sainte-Chapelle. | Zvolí Invalidovnu a pokračuje k mostu. |
| PAR05 | Hráč zkoumá nízký most a okřídlené siluety na vysokých sloupech. Při váhání může použít +10 s nebo v pauze nabídku videa. | Správná volba prodlouží sérii. Úspěšné video přeskočí otázku a sérii zachová bez bodu. |
| PAR09 | Z mostů vybírá podle kamenných oblouků, půlkruhových výstupků a cípu ostrova. | Rozpozná Pont Neuf nebo se po volbě dozví jeho název z výsledku. |
| B09 | Žlutý vůz a nízká stanice odlišují linku M1. | Výsledek ukáže název stanice. Další pokračuje zpět na povrchu v Městském parku. |
| P10 | Hráč hledá uličku podle drobných domků vestavěných pod hradbu. | Zlatá ulička ukončí procházku Hradem a souhrn přidá pohlednici Prahy při prvním dokončení. |

## 6. Učení hry

1. Na první zastávce hráč vidí scénu, otázku a čtyři volby ve čteném pořadí. První výsledek zavede jednu větu a tlačítko „Další“.
2. Druhá zastávka ukáže počitadlo série, pokud je série aspoň 2. Prvních 1 500 ms se u 50:50 jednou zobrazí popisek „Odebere dvě volby“ / „Removes two choices“. Popisek čas ani interakci nezastaví, je i v přístupném názvu.
3. Třetí zastávka zvýrazní posun značky na liniové trase a předvede, jak další pohled navazuje. Každý žolík má stručný přístupný název. Při první sérii délky 3 se u pauzy jednou ukáže, že uvnitř lze najít přeskočení, pokud adaptér odměnu nabízí.

## 7. Skóre a odměny

Správná volba přidá 1 správnou odpověď a prodlouží sérii o 1. Chyba a timeout ji vynulují. Přeskočení za potvrzené video ji ponechá beze změny. Série se vede uvnitř průchodu, nejlepší se ukazuje v souhrnu. Za město 0–3 správně = 0 hvězd; 4–6 = 1; 7–8 = 2; 9–10 = 3. Mapa a úvod ukazují součet nejlepších výsledků jednotlivých měst, maximum 60 při vydání a 3 × počet vydaných měst po rozšíření. Opakování nemůže snížit už získané hvězdy.

Na začátku je dostupná Paříž. Dokončení v libovolném skóre odemkne následující vydanou trasu z §5. První dokončení každého města přidá právě jednu pohlednici se scénou určenou v jeho městském souboru. Opakování pohlednici neduplikuje. Karta ukáže obraz a po otevření lokalizované jméno města a větu ze zastávky, která jí dala ilustraci. Sbírka ukazuje jednu pozici za každé vydané město a počet získaných z celku. Denní výzva ukazuje dnešní výsledek z 3 a počet po sobě jdoucích dokončených dnů. Série končí včerejškem nebo dneškem, jinak je 0. Pro souběh přes půlnoc se spočítá z uložených dat bez ohledu na pořadí dokončení.

## 8. Pocit ze hry

| Událost | Animace a easing | Zvuk | Vibrace |
|---|---|---|---|
| Volba | 120 ms, ease-out, zvýraznění rámečku | tlumené kliknutí | žádná |
| Správně / chybně | 220 ms, ease-out, symbol a změna rámečku | dva tóny / jeden měkký tón | 25 ms jen správně, pokud podporováno a povoleno |
| Další scéna | 250 ms opacity ease-in-out, značka trasy o krok | žádný | žádná |
| Získání pohlednice | 550 ms, ease-out, pohlednice se vysune | krátký akord | 35 ms podle nastavení |
| Úvod | smyčka 8 000 ms, odlesky a loď se vrátí přes okraj | ticho | žádná |

Při `prefers-reduced-motion` a v herním nastavení Bez animací nahradí pohyb statický obraz nebo změna stavu do 100 ms.

## 9. Vizuální styl

### Ilustrace

Tři [budapešťské reference](reference/STYLE.md) určují styl. Horní ilustrace v referenčních obrazovkách jsou přibližně čtvercové a odlišené od ovládání. Vyrábí se samostatná scéna **1:1, 1280 × 1280 px**, export AVIF/WebP, bez ovládacích prvků. Dominanta a otázková stopa mají být v centrálních 80 % šířky a 80 % výšky, silueta má zůstat čitelná při 304 px. Zobrazit s `contain`, detail lze otevřít do dostupné plochy, při zvětšení se čas pozastaví a odpovědi zakryje. Křížek vrací stejnou otázku. Klamné prvky smějí být jen v možnostech, samotná scéna má věrně zobrazit místo.

| Vrstva | Barvy a provedení |
|---|---|
| Osvětlený kámen | medová `#E4A855`, krémová `#FFD796`, světla `#FFF0C8` |
| Stíny a obrys | tmavá námořnická `#202740`, stín do fialova `#514568`, okrové detaily `#91562F` |
| Voda, obloha, vegetace | modrá `#426FAD`, odrazy `#E7A36C`, večerní nebe `#D184A8`, listy `#6D773F` |
| Podzemí | teplá žluť `#F3AD18` proti patinované zeleni `#3E5B46` a lesklé slonovině `#F0DEC0`; konkrétní materiály podle stanice |

V měřítku 1280 px má silueta popředí 4–6 px, architektonické dělení 2–3 px a vzdálené detaily 1–2 px nebo barevnou hranu. Kontura má odstín podle materiálu a světla. Budovy mají čitelné římsy, okna a střechy, stíny mají viditelné hrany i měkčí odražené světlo. Pouliční scénu kreslit ve výšce očí (cca 1,6 m), běžná perspektiva s dojmem 30–40 mm, široké panoráma jen pokud pomáhá stopě. V ulici zachovat směr stínů, monumentální měřítko a sousedství průčelí. Západ a pouliční světla zdůrazní odrazy v řece, otevřené náměstí může být v ostrém slunci a podzemí pod žárovkami. Detaily a sytost ubývají směrem do dálky. Jediná hlavní stopa má lokální kontrast jasem a tvarem.

**Opakovatelný prompt pro generování**

> Square 1280×1280 richly drawn travel-quiz illustration of [exact place, city], viewed from [real camera location and direction] at [time and weather]. Use the three Budapest illustrations as style references. Draw [verified landmark geometry, materials and surrounding features] as observed in the location photo, including [feature needed to answer], within the central 80% of the frame. Eye-level travel perspective, clear foreground, layered architecture and atmospheric distance. Deep saturated navy and violet shadows, warm amber reflected light, crisp 4–6 px foreground silhouettes, 2–3 px architectural contours, fine colored distant detail, hand-drawn ink and painterly light together. Preserve plausible scale, roof shapes, window rhythm and street layout. Include [one purposeful small foreground or motion cue]. Full-bleed art only, no game UI, invented lettering, logos, answer labels, unrelated landmarks, collage or flat paper-cut treatment.

**Praha P04 k překreslení.** Z [obsahové reference](reference/praha-01-karluv-most.png) ponechat Vltavu, Karlův most, Staroměstskou mosteckou věž a siluetu Hradčan. Použít doložený pohled z pravého břehu jižně od mostu a přizpůsobit vzájemnou polohu stavbám, zakreslit věž na správném konci mostu. Na vodě modrofialové stíny a jantarové odrazy, syté střechy a jasně členěné pískovcové oblouky ve stylu Budapešti. Přesný pohled vychází z fotopodkladu P04 v [pražské trase](cities/prague.md#p04--lehká).

U všech otázek postavit výstup vedle fotopodkladu daného místa a zkontrolovat stopu, architekturu a skutečný směr pohledu. Jestliže podklad zachycuje jen detail nebo je pořízený z jiného stanoviště, produkce doplní snímek z předepsaného místa dřív, než scénu schválí. Pokud znak nesedí nebo je na mobilu nečitelný, scénu upravit nebo přegenerovat. Fotografie se nepřibaluje. Alternativní text pojmenuje přímo vnímatelné stopy, například tvar, barvu, počet či polohu předmětů. U otázek na název místa, linky nebo odvozenou kategorii popíše identifikační znaky, samotné řešení vysloví až výsledek. M1 využije referenci pro výtvarný styl a fotku Hősök tere pro skutečné nástupiště, výzdobu a vlak. Text tabulí odpovídá místu, číslo linky u B09 zůstane mimo záběr.

### Rozhraní

Systémové písmo `system-ui`; nadpisy 24–40 px, otázka 18–24 px, volby a ovládání 16 px. Podklad `#FFF4E0`, text a obrys `#151F44`, akcent `#FFBF36` s tmavým textem, správně `#186045` s bílou, chyba `#9C2E32` s bílou. Bílý text na námořnickém pruhu, barvu doprovází symbol. Všechny textové kombinace WCAG AA, fokus s nejméně 3:1 proti sousední ploše. Dotykové cíle nejméně 44 px, mezery 8 px. Podpora od 320 × 568 na výšku a 568 × 320 na šířku. Vysoký text nebo delší překlad dovolí svislé posouvání, 2×2 volby se při kolizi přelomí do jednoho sloupce. V horizontální hře je scéna vlevo a panel s otázkou vpravo.

```text
Úvod na výšku           Úvod na šířku
┌──────────────────┐    ┌───────────────────┬───────────────────┐
│ Postcard Trail   │    │                   │ Postcard Trail    │
│                  │    │  Paříž     │ [ Hrát ]          │
│ Paříž     │    │  animace           │ Mapa / Nastavení  │
│ animace          │    │                   │ Denní / Sbírka    │
│ [ Hrát ]         │    │                   │ 0/20 měst, 0/60 ★  │
│ Mapa / Nastavení │    └───────────────────┴───────────────────┘
│ Denní / Sbírka   │
│ 0/20 měst, 0/60 ★│
└──────────────────┘

Hra na výšku           Hra na šířku
[×] Město · 4/10       [×] Město · 4/10                       [Pauza]
[obraz + zvětšit]      [ obraz + zvětšit ] | [otázka + volby 2×2]
[otázka + volby 2×2]   [                   ] | [čas + žolíky / další]
[čas + žolíky / další]
```

## 10. Obrazovky a stavy

Úvod je samostatná celoplošná obrazovka. Logo má tučné námořnické bezpatkové písmo ve dvou řádcích, jantarový oblouk jako rám evokuje most. Animovaný záběr vychází ze zastávky PAR03 a ukáže loď na vodě, Eiffelovu věž v pozadí a odrazy u nábřeží. V UI ani v alternativním textu animace se název řeky před hrou nezobrazuje. Text a ovládání zůstávají na stabilním plném pozadí. Primární tlačítko o výšce 56 px „Hrát“ otevře první dostupnou nedokončenou trasu, po dokončení všech otevře mapu. Při aktivním průchodu je tlačítko „Pokračovat“ a otevře uloženou scénu. Vedlejší ovládání „Mapa měst“, „Nastavení“, „Sbírka“ a „Denní výzva“ seřazené pod hlavní akcí. Denní dlaždice je před odemčením vidět se stručnou podmínkou. Postup ukazuje dohraná města z počtu vydaných tras, hvězdy z trojnásobku tohoto počtu a počet získaných pohlednic.

V ostatních oknech je nahoře viditelný **×** a odkaz **Úvod / Home**. Křížek v modálním okně vrací do rodiče, u samostatné herní trasy na úvod se zachováním postupu. Escape z herní plochy otevírá pauzu. V reklamním přehrávači má ovládání spotu SDK.

| Obrazovka | Obsah a cesty |
|---|---|
| Načítání | Logo, stav načítání a při chybě opakování. Úvod se zobrazí po načtení jeho základního rozhraní, scéna hry se řeší zvlášť. |
| Mapa | Vlastní schéma Evropy s 20 vydanými body při startu a s dalšími body při aktualizacích podle §5. Pořadí je zřetelné v seznamu pod mapou. Blízké body tvoří skupiny s počtem, kliknutí mapu přiblíží a seznam pod ní stále umožní aktivovat konkrétní město. Detail zamčeného města ukáže podmínku a detail vydané trasy ukáže scénu, hvězdy a „Hrát“ nebo „Znovu“. |
| Otázka a výsledek zastávky | Název města, počet 1–10 (v denní 1–3), čára trasy, scéna, obtížnost, otázka, čtyři volby, čas a žolíky. Výsledek přidá větu a Další, žolíky zmizí. Křížek ukládá a vrací na úvod. |
| Pauza a nastavení | Pauza: Pokračovat, Nastavení, Úvod a Přeskočit za video, pokud je tento žolík dostupný. Nastavení: jazyk, zvuk, vibrace, omezení pohybu a režim bez časového limitu s termínem účinku. Křížek pauzy pokračuje, křížek nastavení vrátí do rodiče. |
| Souhrn města | Skóre z 10, série, hvězdy z 3, běžná pohlednice a nově odemčené město. Primární „Další město“, po posledním „Mapa“, vedlejší „Hrát znovu“. Při nízkém skóre nabídne stejný souhrn s dosaženými 0–3 hvězdami. Křížek vede na úvod. |
| Potvrzení změny průchodu | Dvě volby „Ponechat průchod“ a „Zahodit a začít“. Křížek i první volba vracejí do původního okna výběru, Úvod zachová rozehraný postup. |
| Sbírka a detail karty | Jedna pozice za každé vydané město. U získané karty je detail s ilustrací, městem a krátkou větou ze zastávky. Detail × vrací do sbírky. |
| Denní výzva a souhrn | Datum UTC, stav, dnešní skóre a aktuální série dnů. Start nebo pokračování. Souhrn vede na denní přehled nebo úvod. |
| Potvrzení / nedostupná reklama | Před spotem „Přeskočíš tuto otázku a zachováš sérii. Správná odpověď se nepřičte.“ a 2 současně viditelná rovnocenná tlačítka. „Zpět k odpovědi“ je vedle nebo nad „Pustit video“ stejné velikosti a barvy (jantarové, s ikonou videa u druhého). Během požadavku na spot a přehrávání se vstup blokuje až do výsledku SDK. Pokud spot selže, informace a „Zpět k odpovědi“. Křížek vrací do pauzy, Úvod uloží stav. |
| Chyba načtení | Pouze číslo zastávky a krátká stavová věta, „Zkusit znovu“, × a „Úvod“. |

## 11. Zvuk

Web Audio syntéza pro kliknutí, správnou/chybnou odpověď a dokončení města. Výchozí hlasitost 60 % po prvním vstupu. Úvod je tichý. Vypnutí zvuku platí ihned a uloží se. Reklama ztlumí zvuk po dobu přehrávání, pak se obnoví uložená úroveň. Každá zvuková odezva má viditelný ekvivalent.

## 12. Portál a monetizace

Průběžné reklamy mají četnost 0. Dobrovolný spot za přeskočení nejvýš jednou úspěšně na průchod, vždy po potvrzení uživatelem. SDK signály mají pokrýt zahájení a dokončení načtení, start a stop aktivního hraní při přechodech do pauzy, pozadí, souhrnu a reklamy. První signál hraní na Poki vznikne při vstupu hráče, dvojité signály startu i konce se sloučí a během reklamy se herní signály pozastaví. Detail katalogu, načítání a interaktivní hra mají samostatné stavy. Reklama běží přes adaptér. V lokálním režimu se bez SDK nabídne stav nedostupnosti, pro automatické testy umí lokální adaptér simulovat úspěch, chybu a duplicitní callback. Pokud adaptér předem hlásí, že portál odměny neposkytuje (např. Basic Launch), ve hře žolík skrýt. Selhání po vyžádání spotu vede na stav nedostupnosti s návratem, bez sdělení o blokátoru. Pro Poki ověřit plné využití náhledu 16:9 na 640 × 360, 836 × 470 a 1031 × 580, bez posouvání rodičovské stránky. Publikační podklady zahrnou statickou i animovanou miniaturu. Při implementaci ověřit aktuální podmínky. [CrazyGames – reklamy](https://docs.crazygames.com/requirements/ads/), [Poki – požadavky](https://developers.poki.com/guide/requirements-quality)

Verzované uložení v lokálním úložišti podle profilu browseru, případné portálové ukládání pouze přes adaptér. Nástup nového schématu vyžaduje migraci validních odměn. Při současné hře ve dvou kartách si průchod vlastní poslední karta, která jej výslovně obnovila, předchozí jej zastaví. Stav odměn slučuje maximum hvězd a sjednocení ID karet, hotových měst a denních výsledků; stejný den zachová první uložený výsledek. Lokální uložení a restart zařízení nemají udělit kartu dvakrát.

## 13. Měření

Vývojový lokální záznam a portálové standardní události přes adaptér. Podle možností portálu použít agregované události bez identifikátorů hráče. `route_started`, `question_resolved` (ID města, index, režim, správně/chybně/čas/přeskočeno), `route_completed` (správně, hvězdy), `route_left` (index, opuštěno/pozastaveno), `lifeline_used` (typ), `rewarded_ad_outcome` (completed/cancelled/unavailable), `daily_completed`, `postcard_unlocked`. Rozlišit nový průchod od obnovení. Odpovědět, kolik průchodů dojde na 1., 5. a 10. zastávku, kde hráči odcházejí, kolik naváže dalším městem a který žolík pomáhá. Výsledek spotu je v lokálním vývojovém záznamu, Poki ho měří samo. Na Poki lze z vlastních událostí o žolíku zaznamenat jeho použití. Lokální export z testovacího běhu ověří tok i bez portálu. Do vydání bez analytické služby třetí strany. [Poki – herní události](https://developers.poki.com/guide/game-events)

## 14. Technické zadání

TypeScript + Vite, statický build bez backendu a účtů. Čistý deterministický modul ve `src/game/logic`, čas přijímá od rozhraní v ms a browserové stavy řeší vrstva aplikace. DOM/CSS v `src/game/render` pro přístupné ovládání a statické ilustrace, bez herního enginu. Volbu stacku zaznamenat při stavbě. `src/platform` pro obě portálová SDK a lokální adaptér, `src/content` pro otázky, `src/i18n/en.json` a `cs.json` pro ostatní texty. Build servíruje vlastní assety ze stejného původu a za běhu odkazuje jen na potřebné SDK. Lazy-load dalších tras, přednačtení jedné další scény. Cíl 60 fps u animací na středním mobilu, při laboratorním připojení 5 Mb/s a RTT 100 ms interaktivní úvod do 3 s. Přenesený startovní payload do 700 kB a celý build první verze do 36 MB včetně 200 ilustrací, cílově do 150 kB na scénu, měřeno bez SDK. Lint, typecheck, test, build a test:e2e jsou samostatné příkazy.

## 15. Akceptační kritéria

1. Validátor ověří 20 měst ve schváleném pořadí, 200 stabilních jedinečných ID otázek a scén, čtyři různé volby s jednou označenou správnou ve stejném slotu v obou jazycích, fotopodklad, zdroj, datum a stálost. B09 přesně zobrazuje „Na kterou linku metra právě čekáš?“ a M1 / M2 / M3 / M4.
2. Unit testy pokryjí timeout, vstup na hranici odpočtu, dvojklik, skóre, sérii, restart, kombinaci žolíků, nečasovaný režim a stavy z §3. Test s kontrolovanou náhodou ověří různé permutace městské trasy, zachování po obnově a v jiném jazyce, shodu denní permutace a pevné B09. Nulové skóre dokončí trasu, odemkne právě následující město a udělí právě jednu kartu. Obnovení, opakování a ukončení aplikace po posledním kliknutí odměnu neduplikují.
3. Playwright projde Paříž na desktopu a v mobilním zobrazení, odemkne Londýn, zobrazí uzamčený Řím, obnoví aktivní otázku a výsledek, přepne jazyk a orientaci. Stav se 20 dohranými městy ukáže 20 pohlednic, nejvýš 60 hvězd a mapu jako další krok.
4. Test denní výzvy ověří 20 různých měst během 20 dní, 8 různých počátečních pozic každého města během 160 dní, UTC, zamčené město a zachování uloženého průchodu přes půlnoc i aktualizaci. Nový katalog zahrne všechny vydané trasy a začne ve stanovený den. Pokrytí 8 začátků na město se ověří i pro katalogy s 30, 40 a 47 městy. Výsledek nemění městskou sbírku ani hvězdy.
5. Lokální adaptér pokryje úspěch, odmítnutí, nedostupnost, přerušené video a duplicitní callback. Automatický spot se nespustí. Úspěšné přeskočení zachová sérii i skóre. Při předem známé nedostupnosti je reklamní žolík skrytý.
6. Každé herní okno má funkční křížek a přímou cestu na úvod. Ověřit klávesnici, kontrast WCAG AA, cíle 44 px, obě minimální velikosti, rozměry Poki a delší překlad. U každého náhledu je stopa čitelná na mobilu nebo přes zvětšení.
7. Každý výsledný obrázek porovnat s fotkou konkrétního záběru nebo znaku a každou otázku zodpovědět samostatně bez předchozí zastávky. U 80 lehkých ověřit, že prostý popis obrazu ani textové nápovědy UI nevyberou správný název. U 40 expertních zkontrolovat viditelnost zapsaného rozlišovacího znaku a možnost vyloučit zbylé volby. V každém městě ověřit strop 1 poznávací otázky na chrám a vhodnost všech 10 otázek pro děti. V katalogu první verze jsou jen dvě otázky na stát nebo státní vlajku, PAR02 a P01. P04 překreslit ve stylu Budapešti. Ověřit načítání a výkon podle §14.

## 16. Mimo rozsah první verze

Dalších 27 měst je v plánu podle §5. Moskva, Kyjev a Minsk jsou mimo vydání i mimo tyto tři aktualizace. Lze je přidat později samostatným rozhodnutím. Po dokončení evropského atlasu lze navrhnout samostatné rozšíření s globálně známými světovými metropolemi. Mimo první verzi jsou také volný pohyb, uživatelské trasy, multiplayer, účty, nákupy, žebříčky, synchronizace mezi portály a generování otázek za běhu.

## 17. Rizika a otevřené body

- **K potvrzení Petrem před vydáním** — pro název **Postcard Trail** se ve zkontrolované veřejné nabídce čtyř katalogů nenašla doslovná titulová shoda. Google Play nabízí **Postcard Trails** a App Store hru **Postcard Trails:Word Solitaire**. Oba názvy jsou zaměnitelné zejména ve vyhledávání. Rozhodnutí o názvu pro zveřejnění zůstává Petrovi. [Záznam vyhledávání](RESEARCH.md#anglický-název)
- Výtvarná výroba první verze znamená 200 originálních scén. Prvních 10 ověří průchod celým městem a kvalitu stylu, v testovací sadě mají být i otázky B09 a P10 pro méně nápadné stopy. Po úpravě vzoru pokračuje tvorba po městech podle pořadí z §5.
- U bruselského Atomia ověřit před komerčním zveřejněním podmínky pro kresbu v cílových portálech a pro její případné použití v propagaci. [Držitel práv k Atomiu](https://copyright.atomium.be/en), [Belgická výjimka pro veřejný prostor](https://www.wipo.int/en/web/wipolex/w/news/2016/article_0015)
- Fotografie jsou pracovní podklady. Při produkci záběr nebo kontrolní fotografii zpřesnit, pokud neukazuje příslušnou stopu ze stejného stanoviště. Rozpoznatelnost konkrétního místa na malém obraze ověřit před výrobou celé sady.

## 18. Test s lidmi (dělá Petr)

Po dokončení hratelného prototypu dej hru bez vysvětlení 20 lidem. Alespoň 12 Paříž osobně nezná a alespoň 10 začne na mobilu. Sleduj první volbu do 10 s, dokončení Paříže, otevření Londýna, délku sezení a případné sdílení. Po hře se zeptej, kterou všeobecně známou dominantu nebo symbol hráči na lehké scéně poznali a podle čeho. Rozlož mezi hráče i otázky BRA09, B09 a P10 bez předchozí procházky. U experta si nech ukázat znak a vysvětlit vyloučení aspoň 2 chybných možností.

Pokračovat, pokud první volbu zkusí nejméně 16/20, Paříž dokončí nejméně 13/20 a Londýn otevře nejméně 8/20. Při 8–12 dokončeních nebo 4–7 navázáních upravit nalezený problém a test opakovat. Při nejvýš 7 dokončeních nebo nejvýš 3 navázáních i po druhém testu pozastavit výrobu zbývajících scén a upravit herní smyčku.
