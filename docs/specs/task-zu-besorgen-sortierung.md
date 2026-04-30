# Task: Sortierung für „Zu besorgen"-Liste

## Ziel

Die „Zu besorgen"-Liste soll dieselbe Sortierfunktion bekommen wie die Artikelliste (Liste-Tab).

## Referenz: Bestehende Sortierung in Liste-Tab

Die Artikelliste hat eine Sortier-Leiste mit 4 Buttons:
- **Neu** (default, dunkel hervorgehoben)
- **A–Z**
- **Kategorie**
- **Markt**

State-Variable: `listSort`
Render-Funktion: vermutlich `renderList()` oder ähnlich

## Zu implementieren

### 1. Neuer State
```js
let shoppingSort = "default"; // analog zu listSort
```
**Wichtig:** Eigene Variable, nicht `listSort` wiederverwenden — die beiden Tabs sollen unabhängig sortierbar sein.

### 2. Sortier-UI im „Zu besorgen"-Tab
- **Identisches Markup** wie im Liste-Tab (gleiche Klassen, gleiche Reihenfolge der Buttons, gleiche Icons/Labels)
- **Position:** direkt unter dem Suchfeld, falls vorhanden — ansonsten oben im Tab
- Active-Button visuell hervorgehoben (gleicher Style wie Liste-Tab)

### 3. Render-Funktion erweitern
- Die Funktion, die die „Zu besorgen"-Items rendert, muss `shoppingSort` auswerten
- **Sortierlogik 1:1 von der Artikelliste übernehmen** (am besten gemeinsame Helper-Funktion `sortItems(items, sortKey)` extrahieren, falls nicht schon vorhanden)
- Beide Tabs (`renderList` und das Render der „Zu besorgen") nutzen dann denselben Helper

### 4. Default-Sortierung
- **Neu** (gleicher Default wie Artikelliste)

## Scope-Abgrenzung — NICHT ändern

- Keine Änderung an der Artikelliste-Sortierung
- Keine neuen Sortier-Optionen (genau die 4 wie im Liste-Tab)
- Kein Persistieren in Firebase — `shoppingSort` ist lokaler UI-State (wie `listSort`)
- Keine Änderung am Aussehen der Items selbst
- Keine Änderung an Filterung, Suche oder anderen Funktionen

## Testfälle nach Implementierung

1. „Zu besorgen"-Tab öffnen → Sortier-Leiste sichtbar, „Neu" aktiv
2. Auf „A–Z" tippen → Items alphabetisch sortiert, „A–Z" aktiv hervorgehoben
3. Auf „Kategorie" tippen → Items nach Kategorie gruppiert
4. Auf „Markt" tippen → Items nach Markt gruppiert
5. Zwischen Liste-Tab und „Zu besorgen"-Tab wechseln → jeder Tab merkt sich seine eigene Sortierung
