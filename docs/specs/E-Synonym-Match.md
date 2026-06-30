# E-Synonym-Match

**Status:** Spec
**Repo:** familycart
**Betroffene Datei:** `scripts/lib/match.js` (ausschliesslich)
**Abhaengig von:** keiner
**Datum:** 2026-06-30

---

## 1. Problem

Der Deal-Scraper (`scripts/check-deals.js`) nutzt `matchesArticleName()` aus
`scripts/lib/match.js` als Gate: Ein von marktguru/Gemini gefundenes Angebot
wird nur dann als Deal geschrieben, wenn der Produktname zum Listen-Artikel passt.

Das Gate kennt **nur Wortstaemme** (`pluralStem`), **keine Synonyme**. Dadurch
fallen inhaltlich identische Begriffe systematisch durch.

Beleg aus Scraper-Lauf 2026-06-30 (Run 28424257507):

```
Suche "Nudeln":
  verworfen (kein Wort-Boundary-Match): "Barilla Teigwaren"
  verworfen (kein Wort-Boundary-Match): "Chef Select Bio Teigwaren"
  verworfen (kein Wort-Boundary-Match): "De Cecco Teigwaren"
  verworfen (kein Wort-Boundary-Match): "Despar Pasta Klassik"
Suche "Tomaten":
  verworfen: "Ich bin Oesterreich Paradeiser"
Suche "Sahne":
  verworfen: "Schaerdinger Schlagobers"
```

"nudel" != "teigware" != "pasta", obwohl es dasselbe Produkt ist. Die Funktion
hat keine Moeglichkeit, diese als gleichbedeutend zu erkennen.

---

## 2. Loesung (Ansatz)

**Canonical-Mapping vor dem Stemming.** Beim Tokenisieren von Needle UND Haystack
wird jedes Token, das Teil einer Synonymgruppe ist, auf einen gemeinsamen
Repraesentanten (Canonical-Form) abgebildet. Die bestehende Phrase-/Stamm-Logik
(Rule A, Rule C, STOP_TOKENS) bleibt **vollstaendig unveraendert** und sieht
danach ueberall denselben Stamm.

Beispiel: "teigwaren", "pasta", "nudeln" werden alle zu `nudel`. Sucht der User
nach "Nudeln" und der Treffer heisst "Barilla Teigwaren", dann sehen beide Seiten
`nudel` -> Rule A matcht.

**Warum dieser Ansatz:**
- Minimaler Eingriff: nur eine Normalisierungsstufe wird vorgeschaltet.
- Kein Kollateralschaden: nur explizit definierte Synonyme werden geoeffnet,
  sonst aendert sich am Matchverhalten nichts. Der Rabatte-Tab fuellt sich nicht
  mit Fehltreffern.
- Erweiterbar: neue Gruppen = ein Eintrag in der Tabelle.

---

## 3. Synonymgruppen (initial)

| Canonical | Synonyme (alle Formen, die im Haystack/Needle vorkommen koennen) |
|-----------|------------------------------------------------------------------|
| `nudel`   | nudel, nudeln, teigware, teigwaren, pasta                        |
| `kartoffel` | kartoffel, kartoffeln, erdaepfel, erdapfel, erdaepful           |
| `tomate`  | tomate, tomaten, paradeiser                                      |
| `obers`   | obers, schlagobers, sahne, schlagsahne                           |
| `aubergine` | aubergine, auberginen, melanzani                              |

**Wichtige Designregel fuer den Canonical-Wert:** Der Repraesentant muss so
gewaehlt sein, dass `pluralStem()` ihn **nicht weiter veraendert**. Sonst bricht
der Match, weil Needle-Seite und Haystack-Seite nach dem Stemming wieder
auseinanderlaufen.

`pluralStem()` entfernt am Wortende `-en`, `-n`, `-s` (nur wenn Restwort > 3 Zeichen).
Pruefung der gewaehlten Canonicals:
- `nudel` -> endet auf `-l`, kein Stemming. OK.
- `kartoffel` -> endet auf `-l`, kein Stemming. OK.
- `tomate` -> endet auf `-e`, kein Stemming. OK.
- `obers` -> endet auf `-s`. ACHTUNG: pluralStem("obers") = "ober" (Restwort
  "ober" = 4 Zeichen > 3). Das ist konsistent, SOLANGE das Mapping VOR dem
  Stemming greift und beide Seiten denselben Weg gehen: "sahne"->"obers"->stem
  "ober", "schlagobers"->"obers"->stem "ober". Beide landen auf "ober". OK,
  aber als Testfall AC4 explizit absichern.
- `aubergine` -> endet auf `-e`, kein Stemming. OK.

Da das Mapping VOR `pluralStem` laeuft und auf BEIDE Seiten gleich angewendet
wird, ist die einzige harte Anforderung: ein Synonym darf nicht versehentlich
auf zwei verschiedene Canonicals zeigen. Die Tabelle ist disjunkt (kein Wort in
zwei Gruppen) -> erfuellt.

---

## 4. Implementierung

### 4.1 Datenstruktur

In `match.js` eine flache Lookup-Map `SYNONYM_CANONICAL` (Synonym -> Canonical),
abgeleitet aus den Gruppen. Flache Map, damit der Lookup O(1) ist:

```js
const SYNONYM_GROUPS = {
  nudel:     ["nudel", "nudeln", "teigware", "teigwaren", "pasta"],
  kartoffel: ["kartoffel", "kartoffeln", "erdaepfel", "erdapfel", "erdaepful"],
  tomate:    ["tomate", "tomaten", "paradeiser"],
  obers:     ["obers", "schlagobers", "sahne", "schlagsahne"],
  aubergine: ["aubergine", "auberginen", "melanzani"],
};

const SYNONYM_CANONICAL = (() => {
  const m = new Map();
  for (const [canon, words] of Object.entries(SYNONYM_GROUPS)) {
    for (const w of words) m.set(w, canon);
  }
  return m;
})();

function canonicalize(token) {
  return SYNONYM_CANONICAL.get(token) || token;
}
```

### 4.2 Einbau in tokenize-Pipeline

`canonicalize()` wird auf die Tokens angewendet, NACHDEM `tokenize()` gelaufen ist
und BEVOR `pluralStem()` greift. Konkret in `matchesArticleName()`:

- `needleTokens` nach `tokenize(articleName)`: jedes Token durch `canonicalize`.
- `haystackStems`: Reihenfolge ist aktuell `tokenize(fullText).map(pluralStem)`.
  Wird zu `tokenize(fullText).map(canonicalize).map(pluralStem)`.
- `needleStems`: aktuell `needleTokens.map(pluralStem)`. Da needleTokens schon
  canonicalisiert sind, bleibt `needleTokens.map(pluralStem)`.

WICHTIG: Die Laengen-Checks (`t.length >= 4` beim Bilden von needleTokens,
`lastToken.length >= 5` in Rule C) beziehen sich auf die ORIGINAL-Tokenlaenge,
NICHT auf die canonicalisierte. Beispiel: "pasta" (5 Zeichen) -> canonical
"nudel" (5 Zeichen) - hier egal. Aber generell: Laengenpruefung VOR der
Canonicalisierung durchfuehren, damit das bestehende Verhalten der Heuristik
(Brand =4, Kategorie =5 Zeichen) erhalten bleibt. Falls das eine Umstellung der
Reihenfolge erzwingt, im Self-Check dokumentieren.

### 4.3 STOP_TOKENS

Unveraendert. Keines der neuen Canonicals (`nudel`, `kartoffel`, `tomate`,
`obers`, `aubergine`) und keines der Synonyme darf in STOP_TOKENS stehen, sonst
wuerde Rule C sie ausschliessen. Im Self-Check pruefen: kein Synonym ist in
STOP_TOKENS enthalten.

---

## 5. Akzeptanzkriterien

Jedes AC wird mit einem direkten Funktionsaufruf von `matchesArticleName()`
verifiziert (Node-REPL oder Mini-Testskript), Ergebnis im Self-Check-Report.

**AC1 — Nudeln/Teigwaren:**
`matchesArticleName("Nudeln", "Barilla Teigwaren")` === `true`
(vorher: false)

**AC2 — Nudeln/Pasta:**
`matchesArticleName("Nudeln", "Despar Pasta Klassik")` === `true`

**AC3 — Tomaten/Paradeiser:**
`matchesArticleName("Tomaten", "Ich bin Oesterreich Paradeiser")` === `true`

**AC4 — Sahne/Schlagobers (Stemming-Konsistenz-Fall):**
`matchesArticleName("Sahne", "Schaerdinger Schlagobers")` === `true`
Dieser Fall sichert ab, dass das `-s`-Stemming von `obers` auf beiden Seiten
gleich laeuft.

**AC5 — Aubergine/Melanzani:**
`matchesArticleName("Aubergine", "LGV Melanzani")` === `true`

**AC6 — Kartoffel/Erdaepfel:**
`matchesArticleName("Kartoffeln", "Bauer Erdaepfel")` === `true`

**AC7 — KEINE Regression bei bewusst aussortierten Treffern:**
Diese muessen weiterhin `false` ergeben (das Gate darf nicht generell lockern):
- `matchesArticleName("Aepfel", "Rauch Happy Day Apfelsaft")` === `false`
- `matchesArticleName("Orangen", "Solevita Orangensaft")` === `false`
- `matchesArticleName("Bananen", "Casali Schokobananen")` === `false`
- `matchesArticleName("Eis", "Bon Gelati Stieleis")` === `false`

**AC8 — KEINE Regression bei bestehenden echten Treffern:**
Diese muessen weiterhin `true` ergeben:
- `matchesArticleName("Milch", "Salzburg Milch Premium Bergbauern H-Milch")` === `true`
- `matchesArticleName("Mozzarella", "Milbona Mozzarella")` === `true`
- `matchesArticleName("Haribo", "Haribo Goldbaeren")` === `true`

**AC9 — Disjunktheit der Tabelle:**
Kein Wort taucht in zwei Synonymgruppen auf. Im Self-Check per Code pruefen
(Set-Groesse == Summe der Gruppenlaengen).

---

## 6. Nicht-Ziele (bewusst ausgeklammert)

- Suchstring-Vorverarbeitung (Problem "Basmatireis XXL") ist NICHT Teil dieser
  Spec. Wird separat geloest (Listen-Eintrag manuell umbenannt; spaeter ggf.
  eigene Spec E-Suchstring-Normalisierung).
- Das Frontend (`index.html`, eigene `findDeals`/`tokenize`) wird NICHT angefasst.
  Das Frontend matcht den bereits geschriebenen Deal gegen Listen-Artikel; wenn
  der Scraper den Deal jetzt schreibt, greift der bestehende Frontend-Match.
  Sollte sich zeigen, dass das Frontend-Label dadurch trotzdem nicht erscheint,
  ist das ein separater Folge-Schritt.
- Umlaut-Folding (ae/oe/ue) bleibt wie gehabt aussen vor. Die Synonymliste
  enthaelt die tatsaechlich vorkommenden Schreibweisen direkt.

---

## 7. Vorgehen

1. Spec committen (dieser Datei) auf `main`.
2. AC fuer AC implementieren in `scripts/lib/match.js`.
3. Verifikation per Mini-Testskript (alle AC1-AC9), Self-Check-Report.
4. Ein Commit, `git push`, `git log origin/main..HEAD` (muss leer sein).
5. Naechsten Scraper-Lauf abwarten (oder manuell triggern) und im Log pruefen,
   dass "Barilla Teigwaren" jetzt geschrieben statt verworfen wird.
