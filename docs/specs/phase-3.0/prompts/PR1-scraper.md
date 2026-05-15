# PR 1 — Scraper-Migration auf `/deals/global`

**Repo:** `fkaindlsdorfer-cyber/familycart`
**Branch:** `phase-3.0/scraper-deals-global` (von `main`)
**Scope:** Nur `scripts/check-deals.js`. Sonst keine Datei anfassen.
**Spec-Referenz:** `docs/specs/phase-3.0/PHASE-3.0-haushalt-webapp.md` (§4.4, §6, §7.3)

---

## Ziel

Den nächtlichen Scraper auf die neue Haushalt-fähige Pfad-Struktur umstellen, ohne dass die bestehende Web-App in der Zwischenzeit kaputt geht. Das heißt: **Dual-Write** während der Migrationsperiode.

---

## Vor-Recherche (zwingend bevor irgendwas geändert wird)

1. Lies `scripts/check-deals.js` vollständig.
2. Identifiziere und liste mir auf:
   - Alle `db.ref('deals...')`-Aufrufe (mit Zeilennummer).
   - Alle `db.ref('settings/activeMarkets')`-Aufrufe (mit Zeilennummer).
   - Wo `activeMarkets` (oder vergleichbare Variable) im Code-Flow genutzt wird.
   - Eventuell vorhandene Konstante mit Default-Markt-Liste (`['hofer', 'lidl', 'eurospar', 'maximarkt']`).
3. Lies `.github/workflows/` (Action-File für den Nightly-Run), um zu verstehen, wie der Scraper getriggert wird — **nichts ändern**, nur lesen.
4. **Stopp und rapportiere mir das Ergebnis**, bevor du Code änderst. Wenn die Pfade an mehr oder anderen Stellen liegen als die Spec annimmt, klären wir das, bevor wir patchen.

---

## Änderungen

### A) Dual-Write für Deals

Alle Schreib-Operationen, die aktuell auf `/deals` zielen (z.B. `db.ref('deals').set(...)`, `db.ref('deals/'+key).set(...)`, `db.ref('deals').remove()`), müssen **zusätzlich** auf `/deals/global` schreiben. Der alte Pfad bleibt schreibend aktiv, damit die noch nicht migrierte Web-App weiterhin frische Deals sieht.

Konkret:
- Jedes vorhandene Schreiben auf `/deals/...` durch eine Helper-Funktion ersetzen, die in beide Pfade schreibt.
- Falls der Scraper am Anfang das gesamte `/deals`-Node ersetzt (typisches Pattern: vorher löschen, dann frisch befüllen), muss dieser Sweep für **beide** Pfade gemacht werden.
- **Reihenfolge:** Erst neuer Pfad (`/deals/global`), dann alter (`/deals`). Wenn der zweite Schreibvorgang fehlschlägt, ist wenigstens der neue Pfad konsistent.

Beispiel-Helper (Anpassen an die tatsächliche Schreib-API im File):

```js
async function writeDeals(deals) {
  await db.ref('deals/global').set(deals);
  await db.ref('deals').set(deals);  // Legacy, wird in PR 3 entfernt
}
```

**Wichtig:** Wenn der Scraper Deals **inkrementell** schreibt (z.B. pro Markt einzeln), muss der Dual-Write auf der gleichen Granularität passieren. Bitte verifiziere das beim Lesen des Files.

### B) `activeMarkets`-Lesen mit 3-stufigem Fallback

Aktuell liest der Scraper `/settings/activeMarkets`. Das wird ersetzt durch:

```js
async function loadActiveMarkets() {
  const ALL_MARKETS = ['hofer', 'lidl', 'eurospar', 'maximarkt'];

  // 1) Union aller Haushalte (Zielzustand nach Phase 3.0)
  const hhSnap = await db.ref('households').once('value');
  const union = new Set();
  hhSnap.forEach(hh => {
    const am = hh.child('settings/activeMarkets').val();
    if (Array.isArray(am)) am.forEach(m => union.add(m));
    return false; // forEach early-exit signal in firebase-admin
  });
  if (union.size > 0) return [...union];

  // 2) Legacy flat path (vor Migration)
  const flatSnap = await db.ref('settings/activeMarkets').once('value');
  const flatVal = flatSnap.val();
  if (Array.isArray(flatVal) && flatVal.length > 0) return flatVal;

  // 3) Default
  return ALL_MARKETS;
}
```

`ALL_MARKETS` — falls im File bereits eine Konstante mit dieser Liste existiert, diese wiederverwenden statt zu duplizieren.

Diese Funktion ersetzt den bestehenden `activeMarkets`-Lesepfad an genau einer Stelle. Sonst ändert sich an der Logik nichts (gleiche Variable, gleicher Filter-Flow).

### C) Logging

Beim Start des Scraper-Runs eine Zeile loggen, welche Quelle für `activeMarkets` gegriffen hat:

```js
console.log(`[markets] source=households|legacy|default, markets=${activeMarkets.join(',')}`);
```

Hilft beim Verifizieren in den GitHub-Actions-Logs.

---

## Was NICHT geändert wird (Anti-Scope-Creep)

- `/leaflets`-Schreiben bleibt unverändert (flach, global).
- Gemini-Vision-Logik, Modell-Auswahl, `thinkingBudget`, Backoff, Jitter, Lite-Fallback — **alles unverändert**.
- Outdoor-Prospekt-Filter (`offerCount === 0 AND pageCount >= 8`) — unverändert.
- Marktguru-API-Endpunkte, `uniqueName`-Logik — unverändert.
- `firebase-admin`-Init, Service-Account-Auth — unverändert.
- Deal-Validierung (`price !== oldPrice`-Filter) — unverändert.
- GitHub-Actions-Workflow-File — **nicht anfassen**.
- Frontend (`index.html`) — **nicht anfassen**. Das ist PR 2.
- Security Rules — **nicht anfassen**. Das ist PR 3.

---

## Verifikation

1. **Dry-Run lokal:** Scraper mit Test-Credentials gegen einen Test-Pfad laufen lassen oder mit `--dry-run`-Flag (falls vorhanden), Output prüfen.
2. **Diff-Review:** `git diff main -- scripts/check-deals.js` zeigen, manuell durchgehen, dass nur die zwei oben beschriebenen Änderungen drin sind.
3. **Manueller Lauf nach Merge:** GitHub-Actions-Workflow manuell triggern (`workflow_dispatch`), prüfen in der Firebase Console:
   - `/deals/global` hat frische Deals mit aktuellem Timestamp.
   - `/deals` hat ebenfalls frische Deals (Dual-Write OK).
   - `/leaflets` unverändert.
   - Log-Zeile `[markets] source=legacy, markets=...` erscheint (weil noch keine Haushalte existieren).

## Definition of Done

- [ ] Vor-Recherche-Ergebnis an mich rapportiert, bevor Code geändert wird.
- [ ] Dual-Write für Deals implementiert.
- [ ] `loadActiveMarkets()` mit 3-stufigem Fallback implementiert und an genau einer Stelle eingebunden.
- [ ] Log-Zeile drin.
- [ ] Lokaler Dry-Run oder Test-Lauf erfolgreich.
- [ ] PR auf `main` gemergt, manueller Workflow-Run grün.
- [ ] Firebase Console zeigt beide Pfade mit frischen Daten.

---

## Commit-Message

```
feat(scraper): dual-write deals to /deals/global + households-aware activeMarkets

- Add /deals/global write (Phase 3.0 target path)
- Keep legacy /deals write for backward compat (removed in PR 3)
- Read activeMarkets as union of /households/*/settings/activeMarkets,
  fallback to legacy /settings/activeMarkets, fallback to all markets
- No changes to Gemini logic, leaflets, retry, or filters

Refs: docs/specs/phase-3.0/PHASE-3.0-haushalt-webapp.md
```

---

**Bei Unklarheiten oder unerwarteten Code-Strukturen während der Vor-Recherche: stopp und nachfragen.** Nicht raten.
