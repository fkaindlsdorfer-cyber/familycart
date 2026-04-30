# Task: Favoriten in der Artikelliste anpinnen

## Ziel

Im **Liste-Tab** (Artikelliste) sollen User bis zu **8 Artikel** als Favoriten anpinnen können. Diese werden in einer eigenen Sektion ganz oben angezeigt — unabhängig von der gewählten Sortierung.

Favoriten sind **pro User** (Flo & Vicy haben je eigene Favoriten-Listen).

## Verhalten

### Pinnen
- Jedes Item in der Artikelliste bekommt ein **Pin-Icon** (📌 oder vergleichbar) als Toggle-Button
- 1 Tap → Item wird Favorit (Pin-Icon „aktiv", optisch hervorgehoben)
- Nochmal tappen → Favorit entfernt
- Max. 8 Favoriten pro User. Bei Versuch das 9. zu pinnen: kurzer Toast/Hinweis („Maximal 8 Favoriten — entferne zuerst einen anderen") und Pin wird **nicht** gesetzt. Kein Auto-Verdrängen.

### Anzeige
- Im Liste-Tab erscheint **über** der normalen Artikelliste eine zusätzliche Sektion „⭐ Favoriten" (oder „📌 Favoriten")
- Diese Sektion zeigt alle gepinnten Items des **aktuellen Users**
- Sortierung innerhalb der Favoriten-Sektion: **alphabetisch** (deterministisch, keine Pin-Timestamps nötig)
- Die Favoriten-Sektion wird **immer** angezeigt, unabhängig von der gewählten Sortierung (Neu / A–Z / Kategorie / Markt)
- Items in der Favoriten-Sektion sind **identisch** mit ihrer Darstellung in der Hauptliste (gleiches Markup, gleiche Funktionen — „merken", X, etc.)
- Wenn keine Favoriten existieren: Sektion wird ausgeblendet (kein Empty-State nötig)

### Doppelte Anzeige?
- **Ja:** Ein gepinntes Item erscheint sowohl in der Favoriten-Sektion **als auch** in der Hauptliste an seiner regulären Position. Das ist Absicht — die Favoriten-Sektion ist ein Quick-Access, nicht ein Filter.

## Technik

### State (lokal, pro User)
```js
let favorites = []; // Array von Item-IDs des aktuellen Users
```

### Firebase-Struktur (per-user)
```
favorites/
  flo/
    <itemId1>: true
    <itemId2>: true
    ...
  vicy/
    <itemId3>: true
    ...
```

- Map-Struktur (Object), nicht Array — ermöglicht O(1) Lookup `favorites[userId][itemId]`
- Beim User-Wechsel (Flo ↔ Vicy) wird die Favoriten-Sektion neu geladen
- Realtime-Sync: bei Pin-Änderung sofort in Firebase schreiben, kein Debounce nötig (selten geändert)

### UI-Integration
- Pin-Icon **direkt am Item**, am besten rechts oben — neben dem bestehenden X-Button
- Aktiv-Zustand visuell klar erkennbar (z.B. dunkelgrünes/gefülltes Pin vs. graues/outline Pin)
- Der Pin-Icon-Tap darf **nicht** auf das ganze Item-Klick durchpropagieren (`event.stopPropagation()`)

### Edge Cases
- **Item wird gelöscht:** Beim Löschen eines Items wird automatisch auch sein Pin-Eintrag aus `favorites/{userId}/` entfernt
- **Item nicht mehr in Liste vorhanden, aber noch in favorites:** Ignorieren beim Rendern (nicht crashen, nicht anzeigen)

## Scope-Abgrenzung — NICHT ändern

- **Nur im Liste-Tab.** Keine Favoriten-Sektion im „Zu besorgen"-Tab oder „Rabatte"-Tab
- **Keine Drag&Drop-Sortierung** der Favoriten — alphabetisch reicht
- **Kein Pin-Status-Sync zwischen Usern** — Flo und Vicy haben strikt getrennte Favoriten
- **Kein Pin-Icon in anderen Tabs** — auch wenn ein Item Favorit ist, wird der Pin-Status nur im Liste-Tab visualisiert
- Keine Änderung an Sortierlogik, Filterung, Suche oder Item-Markup (außer dem neuen Pin-Icon)

## Testfälle nach Implementierung

1. Liste-Tab öffnen als Flo → keine Favoriten-Sektion sichtbar (noch keine gepinnt)
2. Pin-Icon bei „Äpfel" tappen → Favoriten-Sektion erscheint mit „Äpfel"
3. 7 weitere Items pinnen → 8 Favoriten alphabetisch sortiert
4. Versuch 9. Item zu pinnen → Toast, Pin bleibt aus
5. Sortierung auf „Markt" wechseln → Favoriten-Sektion bleibt oben, Hauptliste sortiert sich nach Markt
6. Auf Vicy umschalten → Favoriten-Sektion zeigt **nichts** (Vicy hat eigene Favoriten)
7. Vicy pinnt „Milch" → erscheint nur bei Vicy
8. Zurück auf Flo → Vicys „Milch"-Pin nicht sichtbar, Flos 8 Favoriten wieder da
9. Ein gepinntes Item komplett löschen → verschwindet aus Favoriten-Sektion und Hauptliste, Firebase-Pin-Eintrag weg
10. App schließen und neu öffnen → Favoriten persistieren über Firebase
