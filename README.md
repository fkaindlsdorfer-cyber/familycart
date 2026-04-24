# FamilyCart

Österreichische Grocery-Deal-App für Flo & Vicy. Durchsucht automatisch Aktionen bei Hofer, Lidl, Eurospar und Maximarkt via Marktguru und Gemini Vision, speichert Treffer in Firebase und zeigt sie im React-Frontend an.

## Tech Stack

- **Frontend:** React (index.html, single-file)
- **Backend/Scraping:** Node.js (`scripts/check-deals.js`)
- **Datenbank:** Firebase Realtime Database
- **Datenquellen:** [marktguru.at](https://marktguru.at) npm-Package + Marktguru Leaflet-API
- **KI:** Google Gemini Vision API (Prospekt-Scan für Maximarkt)
- **Automatisierung:** GitHub Actions (nächtlicher Run)

## Setup

```bash
git clone https://github.com/fkaindlsdorfer-cyber/familycart.git
cd familycart/scripts
npm install
```

ENV-Datei anlegen:

```bash
cp ../.env.example ../.env
# .env ausfüllen (siehe unten)
```

Script manuell ausführen:

```bash
node check-deals.js
```

## ENV-Variablen

| Variable | Woher |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) → API-Key erstellen |
| `GEMINI_MODEL` | Optional, Default: `gemini-2.5-flash` |
| `FIREBASE_DATABASE_URL` | Firebase Console → Projekt → Realtime Database → URL kopieren |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Console → Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren → JSON-Inhalt einzeilig als String |

## Nightly Run (GitHub Actions)

Der Workflow `.github/workflows/flugblatt-check.yml` läuft automatisch jede Nacht und kann manuell getriggert werden.

Die ENV-Variablen müssen als **Repository Secrets** gepflegt werden (nicht als `.env`-Datei):
GitHub Repo → Settings → Secrets and variables → Actions → New repository secret

Benötigte Secrets:
- `GEMINI_API_KEY`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_SERVICE_ACCOUNT`

`GEMINI_MODEL` ist optional — ohne Secret wird `gemini-2.5-flash` verwendet.
