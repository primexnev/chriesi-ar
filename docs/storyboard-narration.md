# Storyboard & Sprechertext — «Vom Chriesibaum ins Glas» (Entwurf 1)

Status: ENTWURF, braucht Freigabe mit Kinderkultur Zug (SW04), danach Aufnahme (SW10). Umgesetzt in `src/story/narration.de.json` und `src/scenes/chronicle/`.
Gemessen mit Platzhalter-Stimme (`say`, schneller als eine echte Sprecherin): Intro 52 s + Chronik 158 s = 3:30 reine Laufzeit.
Ziel: Animation max. 4:20 reine Laufzeit (ohne Wartezeit bei den Spielen). Sprechtempo für Kinder ≈ 2 Wörter/Sekunde → Text ≈ 400–450 Wörter, Rest sind Musik-, Geräusch- und Schaumomente.
Fakten: siehe [research-zuger-chriesi.md](research-zuger-chriesi.md). Alle Szenen spielen im Kanton Zug.

`|` = Untertitel-Umbruch · **[TIPP]** = Interaktion (Auto-Weiter nach 20 s, im Intro 35 s)

---

## 0 · Intro — Wiese am Zugersee (≈ 1:00)
Bild: bestehende Intro-Szene (Wiese, See, Alpen). Figur sucht Schaufel, gräbt, Truhe.

| ID | Text |
|---|---|
| intro_walk | An einem sonnigen Morgen spaziert unser Freund über die Wiese am Zugersee. |
| intro_spot | Hm? Hier sieht die Erde ganz anders aus. | Liegt da etwas versteckt? |
| intro_search | Zum Graben brauche ich eine Schaufel. Wo ist sie nur? |
| intro_help | **[TIPP]** Hilfst du mir suchen? Tipp auf die Schaufel! |
| intro_thanks | Danke! Die habe ich gar nicht gesehen. |
| intro_dig | Jetzt graben wir ganz vorsichtig. |
| intro_chest | Eine alte Truhe! Machen wir sie auf. |
| intro_treasure | Ein Buch und ein kleiner Chriesistein! | Auf dem Buch steht: «Die Geschichte der Zuger Chriesi». |
| intro_end | Schlagen wir es auf? Komm, wir reisen zurück in die Zeit! |

## 1 · Das Buch öffnet sich (≈ 0:08)
Bild: Buch legt sich auf die Seite, erste Seite klappt als Pop-up hoch. Papier-Rascheln, Musik.

| ID | Text |
|---|---|
| book_open | Seite eins. | Es war einmal, vor sehr, sehr langer Zeit … |

## 2 · Zug-Sumpf, um 1000 v. Chr. (≈ 0:15)
Bild: Pfahlbau-Dorf am Ufer (Papierfiguren), am Waldrand ein wilder Kirschbaum. Sepia-Ton.

| ID | Text |
|---|---|
| prehist | Vor dreitausend Jahren wohnten hier Menschen in Holzhäusern direkt am Zugersee. | Am Waldrand wuchsen schon wilde Chriesi – klein und ein bisschen sauer. |

## 3 · Cham-Hagendorn, Römerzeit um 200 n. Chr. (≈ 0:30)
Bild: Römische Mühle am Bach, Wasserrad. Familie mit Schale Chriesi. Regen, Bach tritt über, Schlamm deckt Schale zu → Kamera fährt durch Erdschichten nach unten → 1944: Archäologen mit Pinsel.

| ID | Text |
|---|---|
| roman_mill | Vor rund 1800 Jahren, in Hagendorn bei Cham: | Hier steht eine Mühle der Römer. |
| roman_prompt | **[TIPP]** Tipp aufs Wasserrad, damit es sich dreht! |
| roman_cherries | Nach der Arbeit gibt es süsse Chriesi aus einer Schale. |
| roman_flood | Doch dann tritt der Bach über die Ufer, | und Schlamm deckt alles zu. |
| roman_dig | Viele Jahre später graben Archäologen hier | und finden die Chriesisteine der Römer – genau wie wir vorhin! |

## 4 · Chriesimärt 1627, Zug (≈ 0:20)
Bild: Platz am See (heute Landsgemeindeplatz), Marktstände, Körbe, Leute aus dem 17. Jh.

| ID | Text |
|---|---|
| market | Im Jahr 1627 schreibt jemand in Zug auf: Es gibt einen Chriesimärt! | Die Bauern bringen ihre Körbe voller Chriesi auf den Platz am See. |

## 5 · Chriesigloggä und Allmend, 1711 (≈ 0:45, Hauptspiel)
Bild: Nacht, Chriesiwächter mit Laterne unter den Bäumen → Tag, Kirche St. Michael mit Glocke → Leute rennen mit Leitern und Körben auf die Allmend. Spiel aus `scene1` (Glocke + Pflücken) wird hier wiederverwendet.

| ID | Text |
|---|---|
| allmend_watch | Damals gehören viele Chriesibäume allen Zugern zusammen. Sie stehen auf der Allmend. | Ein Chriesiwächter passt Tag und Nacht auf: Niemand darf zu früh pflücken! |
| bell_prompt | **[TIPP]** Jetzt sind die Chriesi reif. Tipp auf die Glocke! |
| bell_rung | Bim, bam! Die Chriesigloggä läutet! | Alle rennen mit Leitern und Körben los. |
| ladder_prompt | **[TIPP]** Wer zuerst seine Leiter an einen Baum stellt, darf dort pflücken. Tipp auf einen Baum! |
| pick_prompt | **[TIPP]** Jetzt pflücken! Tipp auf die roten Chriesi. |
| pick_hint | *(nur wenn das Kind wartet)* Da hängen noch Chriesi. Tipp drauf! |
| pick_bird | *(während des Spiels)* Oh, ein Vogel nascht mit. | Es hat genug für alle! |
| pick_done | Der Korb ist voll! |

## 6 · Die erste Zuger Kirschtorte, 1915 (≈ 0:25)
Bild: Backstube in Zug, Konditor mit Schürze, Kupferschüssel (Motiv der Druckseite), Torte mit Puderzucker.

| ID | Text |
|---|---|
| cake_intro | Im Jahr 1915 hat der Zuger Konditor Heinrich Höhn eine Idee: | eine ganz besondere Torte für Zug! |
| cake_prompt | **[TIPP]** Hilf ihm beim Rühren – mal mit dem Finger einen Kreis! |
| cake_done | Fertig ist die Zuger Kirschtorte. | Man kennt sie bis heute auf der ganzen Welt. |

## 7 · Die Bäume verschwinden, 1950 → 2000 (≈ 0:15)
Bild: Zeitraffer. Bäume klappen als Papier um, Häuser und Strassen klappen hoch. Leise, etwas traurige Musik.

| ID | Text |
|---|---|
| decline | Später werden in Zug viele Häuser und Strassen gebaut. | Immer mehr Chriesibäume verschwinden. |

## 8 · Neue Bäume und der Chriesisturm, heute (≈ 0:30)
Bild: Menschen pflanzen junge Bäume, Zähler bis 1000. Altstadt, Glocke, Teams rennen mit Leitern und Hutten. Am Schluss: Kind/Figur pflanzt den Chriesistein aus der Truhe.

| ID | Text |
|---|---|
| revival | Da sagen ein paar Zugerinnen und Zuger: Wir pflanzen neue Bäume! | Tausend Stück, rund um die Stadt. |
| race_today | Und jedes Jahr im Juni läutet wieder die Chriesigloggä. | Beim Chriesisturm rennen Gross und Klein mit Leitern durch die Altstadt. |
| plant_prompt | **[TIPP]** Jetzt bist du dran: Pflanz unseren Chriesistein! |

## 9 · Schluss (≈ 0:12)
Bild: Aus dem Stein wächst im Zeitraffer ein Baum, Buch klappt zu.

| ID | Text |
|---|---|
| outro | Aus dem kleinen Stein wächst ein neuer Chriesibaum. | Komm, wir suchen zusammen einen echten Chriesibaum in Zug! |

---

## Hinweise für Produktion

- **Timing folgt dem Ton.** Jede Zeile ist ein eigener Clip; die Szene wartet auf `narrator.say()`. Wenn die echte Aufnahme länger oder kürzer ist, passt sich die Animation automatisch an. Fixe Längen nur für Musik und Zeitraffer.
- **Ablauf:** Text freigeben → Platzhalter mit `npm run narration` erzeugen → Animation darauf timen → echte Aufnahme (SW10) → `.m4a` austauschen, keine Code-Änderung nötig.
- **Sprecher:** eine Erzählstimme reicht. Optional zweite Stimme für unseren Freund (intro_spot, intro_search, intro_thanks).
- **Mundart oder Hochdeutsch?** Entwurf ist Hochdeutsch mit Zuger Wörtern (Chriesi, Chriesigloggä, Allmend). Mit Kinderkultur Zug klären.

## Offene Fakten-Checks

- **Kirche 1711:** Die heutige Kirche St. Michael wurde um 1900 neu gebaut; 1711 läutete die Glocke der *alten* St.-Michaels-Kirche. Für die 3D-Szene nicht die heutige neugotische Kirche modellieren. (Vor dem Modellieren beim Amt für Denkmalpflege/Stadtarchiv bestätigen.)
- **Römer-Szene:** Überschwemmungen sind für Hagendorn belegt; dass eine Schale Chriesi zugedeckt wurde, ist erzählerisch erfunden. Die Chriesisteine stammen aus der Grabung 1944/45 bzw. sind auf 170–270 n. Chr. datiert.
- **Zug-Sumpf:** nur ein einziger Wildkirschenstein belegt; «wuchsen wilde Chriesi» ist vertretbar, mehr nicht behaupten.
- **1711:** «allen Zugern zusammen» vereinfacht «den Stadtzuger Bürgern».
