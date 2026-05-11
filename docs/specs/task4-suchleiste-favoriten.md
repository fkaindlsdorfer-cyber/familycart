# Task 4: Suchleiste-Refactor & Favoriten-Section

## Problem

Die Artikelliste-Suche und das Layout um Favoriten/Artikelliste haben fünf Schwächen:

1. **Suche zu unscharf** — Query "Milch" liefert Sahne, Toastkäse, Topfen, weil zusätzlich gegen `category` gematcht wird (alle in Kategorie `🧀 Milchprodukte`).
2. **Suche ruckelt** — bei jedem Tastendruck wird die komplette Liste neu gerendert.
3. **Suchtreffer untergehen** — Treffer liegen unten, Favoriten oben dazwischen.
4. **Favoriten nicht einklappbar** — nehmen permanent Platz weg.
5. **Keine visuelle Trennung** zwischen Favoriten und Artikelliste.

## Akzeptanzkriterien

### AC1 — Suche matched ausschließlich `name`

- `category` darf NICHT mehr in den Filter einfließen.
- Match-Logik:
  - Vergleich case-insensitive
  - Diakritika normalisieren: `s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()` (damit "Müsli" / "muesli" / "MÜSLI" alle matchen)
  - Substring-Match auf normalisiertem `name`
- Ranking innerhalb der Treffer:
  1. Exakter Match (`name === query`)
  2. `name.startsWith(query)`
  3. `name.includes(query)`

**Test:** Query "Milch" → Treffer enthalten Milch, Buttermilch, Milchreis o.Ä., aber keine Sahne, Topfen, Käse, Joghurt.

### AC2 — Performance der Sucheingabe

- Debounce der Filteroperation auf **150 ms** (input event).
- Filter und Render trennen:
  - Filter berechnet `Set<itemId>` der sichtbaren IDs.
  - Render togglet nur `element.hidden = true/false` (oder `style.display`) auf bereits existierenden DOM-Knoten.
  - **Kein** `innerHTML = ...` oder `removeChild`-Loop bei jedem Tastendruck.
- Erstes Render der Liste bleibt wie gehabt (volle Erstellung). Folge-Filter operieren nur auf Sichtbarkeit.

**Test:** Schnell "Buttermilch" tippen — keine spürbare Verzögerung, keine UI-Stutter.

### AC3 — Suchtreffer-Sektion ganz oben, Favoriten & Liste ausgeblendet

Verhalten in Abhängigkeit von `query.trim().length`:

| State | Suchtreffer-Sektion | Favoriten-Sektion | Artikelliste-Sektion |
|---|---|---|---|
| `=== 0` | hidden | sichtbar | sichtbar |
| `> 0` | sichtbar (oben) | hidden | hidden |

- Suchtreffer-Sektion-Header: `🔍 Suchergebnisse ({n})`.
- Sortierung der Treffer nach Ranking aus AC1.
- Bei 0 Treffern: kleine Empty-State-Zeile "Keine Artikel gefunden".

### AC4 — Favoriten ein-/ausklappbar

- Header der Favoritenliste wird klickbar:
  `⭐ Favoriten ▾` (aufgeklappt) bzw. `⭐ Favoriten ▸` (eingeklappt).
- State **lokal** in `localStorage` unter Key `familycart.ui.favoritesCollapsed` (Boolean).
  → **Nicht** in Firebase. UI-Präferenz pro Gerät, nicht family-shared.
- Default beim ersten Aufruf: aufgeklappt.
- Beim Einklappen werden die Favoriten-Items selbst hidden, der Header bleibt sichtbar.

### AC5 — Visuelle Trennung Favoriten ↔ Artikelliste

- Zwischen letztem Favoriten-Item und Artikelliste-Header: `margin-top: 24px` (oder vorhandenes Spacing-Token).
- Neuer Section-Header **`🛒 Artikelliste`** im exakt gleichen visuellen Stil wie der Favoriten-Header.
- Der Artikelliste-Header ist (in dieser Iteration) **nicht** klickbar/einklappbar — siehe Out of Scope.

## Implementierungs-Hinweise

### Datenfluss

```
input event → debounce(150ms) → computeVisibleIds(query)
                                       ↓
                                applyVisibility(ids)
                                       ↓
                          toggleSectionVisibility(query)
```

### Filterfunktion (Skizze)

```js
function normalize(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function rankItem(item, q) {
  const n = normalize(item.name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q))   return 2;
  return -1; // kein Treffer
}

function getSearchHits(items, query) {
  const q = normalize(query.trim());
  if (!q) return [];
  return items
    .map(it => ({ it, r: rankItem(it, q) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.it.name.localeCompare(b.it.name))
    .map(x => x.it);
}
```

### DOM-Strategie

- Items werden EINMAL beim Initial-Render erzeugt mit stabilem `data-id` Attribut.
- Bei Filter-Änderung: einmaliger Pass über alle Item-Knoten, `el.hidden = !visibleIds.has(el.dataset.id)`.
- Section-Header (Favoriten / Suchergebnisse / Artikelliste) toggeln separat via `hidden`-Attribut.

### localStorage Keys

| Key | Type | Default |
|---|---|---|
| `familycart.ui.favoritesCollapsed` | `"true"` / `"false"` | `"false"` |

## Edge Cases

- Leerer String / nur Whitespace → wie kein Suchterm (alles normal).
- Query mit Sonderzeichen (`%`, `*`) → werden als Literal behandelt, kein Regex.
- Query länger als jeder Artikelname → 0 Treffer, Empty-State-Zeile.

## Out of Scope (nicht in dieser Task)

- Artikelliste-Header einklappbar (Scope creep — kann später als eigene Mini-Task).
- Suche in Notizen, Tags, alternativen Bezeichnungen.
- Voice-Search, Such-History, Tippfehler-Toleranz / Fuzzy-Matching.
- Highlighting des Match-Substrings im Treffer.

## Verifikation nach Implementierung

1. "Milch" → keine Sahne/Topfen/Käse mehr in Treffern.
2. "Müsli" und "muesli" liefern dieselben Treffer.
3. Schnelles Tippen von "Buttermilch" → kein Ruckeln.
4. Bei leerer Suche: Favoriten-Header sichtbar, Klick togglet Items.
5. Bei aktiver Suche: nur Suchergebnisse sichtbar, Favoriten + Artikelliste hidden.
6. Reload nach Einklappen der Favoriten → bleibt eingeklappt (localStorage).
7. Visuelle Lücke + sichtbarer "🛒 Artikelliste"-Header bei leerer Suche.
