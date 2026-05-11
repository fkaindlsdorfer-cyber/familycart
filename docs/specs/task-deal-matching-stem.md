# Task: Deal-Matching mit Stem-basiertem Wort-Boundary

## Problem

Die aktuelle `matchesArticleName()`-Logik nutzt strikte Wort-Boundary
(`\btoken\b`) und scheitert daher an:

1. **Singular/Plural** — Liste „Küchenrollen" findet nicht „Küchenrolle"
2. **Verbundene Formen** — Liste „Tomaten" findet nicht „Tomatensauce"

Das verwirft bis zu 80 % echter Treffer in manchen Kategorien.

## Ziel

Lockerung des Match-Patterns auf **Stem + beliebige Endung**, sodass:
- „Küchenrollen" matcht „Küchenrolle", „Küchenrollen"
- „Tomaten" matcht „Tomate", „Tomaten", „Tomatensauce", „Tomatensaft"
- „Butter" matcht „Butter", „Buttermilch", „Butterkäse"
- „Knoblauchbutter" wird **NICHT** mehr gematcht (Wort-Boundary bleibt am
  Anfang des Stems aktiv)

User-Prinzip: Lieber zu viele Treffer als zu wenige. User entscheidet
selbst über Relevanz.

## Implementation

In `scripts/check-deals.js`, Helper-Funktion `germanStem()` einfügen
direkt vor `matchesArticleName()`:

```js
function germanStem(token) {
  // Reihenfolge wichtig: längste Endung zuerst.
  // Mindestlänge nach Stem >= 4 Zeichen (sonst zu unspezifisch).
  if (token.length > 6 && token.endsWith("nen")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("en"))  return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("er"))  return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("e"))   return token.slice(0, -1);
  if (token.length > 4 && token.endsWith("n"))   return token.slice(0, -1);
  if (token.length > 4 && token.endsWith("s"))   return token.slice(0, -1);
  return token;
}
```

`matchesArticleName()` anpassen:

```js
function matchesArticleName(articleName, fullText) {
  const tokens = (articleName || "").toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(t => t.length >= 4);
  if (!tokens.length) return false;
  const hay = (fullText || "").toLowerCase();
  return tokens.some(t => {
    const stem = germanStem(t);
    // \bstem\w*\b — Wort beginnt mit stem, Endung beliebig
    return new RegExp(`\\b${escapeRegex(stem)}\\w*\\b`, 'u').test(hay);
  });
}
```

## Test-Cases (zur Verifikation)

| Listen-Artikel | Such-String | Erwartung |
|---|---|---|
| Küchenrollen | „Plenty Küchenrolle Original" | ✅ match |
| Küchenrollen | „BI Home Küchenrolle" | ✅ match |
| Tomaten | „Tomatensauce 500ml" | ✅ match |
| Tomaten | „Faschiertes" | ❌ kein match |
| Butter | „SPAR Butter Irish Gold" | ✅ match |
| Butter | „Buttermilch 1L" | ✅ match |
| Butter | „Knoblauchbutter 100g" | ❌ kein match (Wort-Boundary vorne) |
| Butter | „Erdnussbutter Trio Riegel" | ❌ kein match |
| Karotten | „Echt Bio Zuckerkarotten" | ❌ kein match (Compound-Suffix) |
| Karotten | „Bio Karotte 1kg" | ✅ match |
| Erdbeeren | „Erdbeer Combino Eis" | ⚠️ match (akzeptiert, false positive) |
| Mais | „Maishendl" | ⚠️ match (akzeptiert, false positive) |
| Mais | „Grillmais" | ❌ kein match (Compound-Suffix bleibt blind spot) |

## Bewusst nicht gelöst

- **Compound-Suffix** („Grillmais" bei Suche „Mais") — würde `\bbutter\b`
  als Suffix-Match wieder zu „Knoblauchbutter" führen. Workaround für
  User: Listen-Artikel umbenennen zu spezifischerem Namen oder zusätzliche
  Variante anlegen.

## Migration

Keine. Stem-Match wirkt ab nächstem nächtlichem Lauf, bestehende Deals
werden ohnehin überschrieben.

## Verifikation

Nach Implementation einen manuellen Workflow-Run triggern und Logs prüfen:

1. Bei „Küchenrollen" sollten die meisten Treffer durchkommen
2. Bei „Tomaten" sollten Tomatensaucen/-säfte durchkommen
3. Bei „Butter" sollten „Knoblauchbutter" / „Trio Riegel" weiterhin
   verworfen werden
