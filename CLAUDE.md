# CLAUDE.md

Diese Datei steuert wie Claude Code in diesem Projekt arbeitet.

## Arbeitsweise

Token-Effizienz hat höchste Priorität. Konkret:

- Nur die Dateien und Ordner öffnen die für die aktuelle Aufgabe wirklich relevant sind.
- Niemals unnötig das ganze Projekt durchsuchen.
- Erklärungen extrem knapp halten.
- Bei Änderungen bevorzugt Diffs oder nur die geänderten Ausschnitte zeigen, nicht ganze Dateien.
- Bestehenden Kontext nicht wiederholen.
- Zwischenergebnisse kompakt zusammenfassen.
- Bei Unklarheit zuerst eine vernünftige Annahme treffen statt lange Rückfragen zu stellen – außer die Gefahr einer falschen Änderung ist hoch.
- Größere Aufgaben in kleine Schritte teilen, zuerst den Teil mit dem höchsten Nutzen bearbeiten.
- Unnötige Refactors außerhalb der eigentlichen Aufgabe vermeiden.
- Lange Logs, lange Listen und lange Begründungen vermeiden.
- Wenn eine kurze Antwort genügt, kurz antworten.

## Ausgabeformat

Nach jeder Aufgabe nur ausgeben:

1. Was geändert wurde
2. Wo es geändert wurde
3. Was als Nächstes sinnvoll wäre

## Prioritäten

1. Wenig Tokens
2. Präzise Lösung
3. Nur notwendige Analyse

## Projektkontext

- **FamilyCart** – Österreichische Grocery-Deal-App für HOFER, Lidl, Eurospar, Maximarkt
- **Nutzer:** Flo und Vicy (shared family)
- **Stack:** React Frontend, Firebase Realtime Database, GitHub Actions (nightly scraping), Marktguru npm package, Gemini API
- **Firebase DB URL:** `https://einkaufsliste-e2f0c-default-rtdb.europe-west1.firebasedatabase.app`
- **Sprache:** Deutsch bevorzugt in Erklärungen und Commit-Messages

## Wichtige Dateien

- `scripts/check-deals.js` – nightly scraping (GitHub Actions)
- `scripts/test-maximarkt-api.js` – Diagnose-Script für Maximarkt
- `.github/workflows/flugblatt-check.yml` – nightly + manual workflow
- `index.html` – Frontend
