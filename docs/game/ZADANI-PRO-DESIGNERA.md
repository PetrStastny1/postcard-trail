# Zadání pro herního designéra – Poznej město

Navrhni hru „Poznej město“. Jen navrhni – zadání předám řediteli sám.

## Název a jazyky
- Pracovní název: Poznej město. Navrhni anglický název (primární pro CrazyGames/Poki) a ověř, že ho nemá jiná hra na portálech ani na Google Play/App Store.
- Jazyky: angličtina (výchozí) + čeština.

## Koncept
- Vědomostní hra o městech. Každé město = 10 otázek ve třech úrovních (lehká → těžká → expert), vždy 4 možnosti.
- Každá otázka má vlastní ilustrovanou scénu z místa. Kola na sebe navazují jako procházka městem (např. Náměstí hrdinů → metro M1 přímo pod ním). Po odpovědi se zobrazí krátká věta, kde hráč právě je a co vidí.
- Příklad Budapešti (expert): „Na kterou linku metra právě čekáš?“ M1/M2/M3/M4 – nechat přesně takhle.

## Vizuální styl
- Reference: docs/game/reference, rozhodnutí v docs/game/reference/STYLE.md.
- Platí styl Budapešti (sytá kreslená ilustrace, prokreslené světlo, detailní a věcně správná architektura). Pražský obrázek je obsahově OK, ale ve špatném stylu – překreslit.
- Popiš styl tak přesně (prompt pro generování, paleta, světlo, obrysy, kompozice, poměr stran), aby šel opakovat u všech obrázků.
- U otázek, kde je odpovědí samotný obrázek, porovnat vygenerovaný obrázek s fotkou místa. Žádný složitější proces.

## Meta a odměny
- Mapa světa s odemykáním měst.
- Sbírka pohlednic: běžná za dohrané město, tajné za skryté výkony. První tajná „Až do depa“: po dohrání Budapešti hráč přijede metrem na konečnou, ozve se hlášení v maďarštině a tlačítko „Vystoupit“; kdo zůstane sedět, dostane pohlednici z depa.
- Denní výzva, série správných odpovědí, hvězdy za město.
- Žolíky: 50:50, +10 s, přeskočit otázku za video.
- Reklamy jen dobrovolné za odměnu, nic vnuceného mezi otázkami.

## Obsah
- Každá otázka má zdroj a příznak stability (stabilní / může se změnit – např. počet obyvatel, nejvyšší budova).
- Navrhni počet měst pro první verzi a jak je vybrat pro mezinárodní publikum (známá i méně známá, hratelné i pro ty, kdo tam nebyli). Budapešť a Praha musí být v první verzi.
- Kompletní otázky připrav alespoň pro Budapešť a Prahu, ostatní města jako seznam témat.

## Průzkum
- Začni průzkumem konkurence (GeoGuessr, kvízy o městech a vlajkách, podobné hry na CrazyGames/Poki) a napiš, čím se odlišíme.

## Povinné
- Plná úvodní obrazovka podle skillu (logo, animovaná scéna, hlavní tlačítko, postup hráče); každé okno má křížek a cestu zpět na úvod.
- Výstup: RESEARCH.md, CONCEPTS.md a BRIEF.md podle šablony, s kontrolou game_critic.
