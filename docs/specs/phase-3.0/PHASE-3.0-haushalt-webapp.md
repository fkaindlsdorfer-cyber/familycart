# Phase 3.0 — Haushalt-System (Web-App Migration)

**Projekt:** FamilyCart / my Wagerl
**Strategie:** A — Web-App zuerst migrieren, Native folgt in Phase 3.1
**Ziel-Repo:** `fkaindlsdorfer-cyber/familycart` (Native-Repo wartet)
**Status:** ✅ Freigegeben für Implementierung (15.05.2026) · alle offenen Q's entschieden

---

## 1 · Ziel

Die Web-App von einem impliziten Single-Household-Modell (flache Firebase-Pfade, hartcodierte „du"/„frau"-Slots) auf ein explizites Haushalt-System migrieren, sodass:

- Mehrere Haushalte parallel im selben Firebase-Projekt existieren können.
- Vicy per **Beitritts-Code** in Flos Haushalt eintreten kann (Native-App wird genauso funktionieren).
- Deals **zentral** unter `/deals/global` bleiben (geteilt über alle Haushalte, Scraper schreibt einmal).
- Die Datenstruktur 1:1 von der Native-App in Phase 3.1 wiederverwendet werden kann — kein erneutes Schema-Refactoring.

**Nicht-Ziel:** Echte Authentifizierung in der Web-App. Anonymous Auth bleibt aktiv. Email/Google-Login ist Native-App-only (E1, bereits umgesetzt).

---

## 2 · Aktueller Zustand (Web-App)

### Firebase-Pfade (flach, single-household-implizit)

| Pfad | Inhalt | Schreiber |
|---|---|---|
| `/items/{key}` | aktuelle Einkaufsliste | beide User |
| `/template/{key}` | „zu besorgen"-Vorlagen | beide User |
| `/favorites/{user}/{key}` | Favoriten (user = `du`\|`frau`) | jeweiliger User |
| `/notifications/{key}` | Push-Nachrichten zwischen den beiden | beide User |
| `/settings/activeMarkets` | Array aktiver Markt-IDs | beide User |
| `/deals/{key}` | Rabatte | **Scraper** (Service Account) |
| `/leaflets/{key}` | Flugblatt-Metadaten | **Scraper** |

### Identitätsmodell

Hartcodiert in `index.html` Zeile 269:

```js
const USERS = {
  du:   { name: "Flo",  emoji: "🧑", color: "#3b82f6" },
  frau: { name: "Vicy", emoji: "👩", color: "#ec4899" }
};
```

`currentUser` wird beim `login("du"|"frau")` gesetzt — keine echte Auth, nur ein UI-Switch. Anonymous Auth läuft im Hintergrund nur als RTDB-Access-Guard (`auth != null`).

---

## 3 · Ziel-Zustand

### Firebase-Pfade (Ziel-Schema)

| Pfad | Inhalt | Scope | Notiz |
|---|---|---|---|
| `/households/{hhId}/items/{key}` | Einkaufsliste | per Haushalt | wie bisher, nur tiefer |
| `/households/{hhId}/template/{key}` | Vorlagen | per Haushalt | |
| `/households/{hhId}/favorites/{memberId}/{key}` | Favoriten | per Mitglied | siehe §4.1 zu `memberId` |
| `/households/{hhId}/notifications/{key}` | Push-Nachrichten | per Haushalt | |
| `/households/{hhId}/settings/activeMarkets` | aktive Märkte | per Haushalt | |
| `/households/{hhId}/meta` | Name, createdAt, ownerId, schemaVersion | per Haushalt | siehe §4.2 |
| `/households/{hhId}/members/{memberId}` | Name, emoji, color, joinedAt | per Haushalt | siehe §4.1 |
| `/households/{hhId}/joinCodes/{code}` | createdAt, expiresAt, createdBy | per Haushalt | siehe §4.3 |
| `/deals/global/{key}` | Rabatte (alle Märkte, alle Haushalte) | **global** | Scraper schreibt hier |
| `/leaflets/{key}` | Flugblatt-Metadaten | **global** | bleibt flach |
| `/marketsRegistry/{marketId}` | optional: Wenn Scraper Union aller `activeMarkets` braucht, siehe §6 | global | offen |

**Rationale für `/deals/global`:** Reserviert Platz unter `/deals/` für künftige Differenzierung (`/deals/regional/{plz}`, `/deals/private/{hhId}` für nutzergenerierte Deals). Falls dieser Use-Case unwahrscheinlich ist → ggf. flach lassen als `/deals/`. **→ Offene Entscheidung, siehe §11.**

### Haushalt-Datenmodell (Detail)

```
/households/h_8f3k2a/
  meta:
    name: "Flo & Vicy"
    ownerId: "flo"
    createdAt: 1716000000000
    schemaVersion: 1
  members:
    flo:  { name: "Flo",  emoji: "🧑", color: "#3b82f6", joinedAt: 1716000000000 }
    vicy: { name: "Vicy", emoji: "👩", color: "#ec4899", joinedAt: 1716050000000 }
  joinCodes:
    WGRL-4F7K: { createdAt: ..., expiresAt: ..., createdBy: "flo" }
  items: { ... }
  template: { ... }
  favorites:
    flo:  { ... }
    vicy: { ... }
  notifications: { ... }
  settings:
    activeMarkets: ["hofer", "lidl", "eurospar", "maximarkt"]
```

---

## 4 · Designentscheidungen

### 4.1 · Member-Identität in der Web-App

Die Web-App hat keine echte Auth. Member-IDs sind **generische Slots** (`m1`, `m2`) innerhalb des Haushalts, nicht abgeleitet von Firebase-UIDs. Anzeigename, Emoji und Farbe liegen in `members.{id}.name|emoji|color`.

- Beim ersten Login wählt der User einen Member-Slot → gespeichert in `localStorage.fc_memberId`.
- Migration: `du` → `m1`, `frau` → `m2`. Reihenfolge ist arbiträr, da nur die Anzeigedaten sichtbar sind.
- `USERS`-Konstante (Z. 269) wird entfernt und durch dynamisches Laden von `/households/{hhId}/members` ersetzt.
- Vorteil: Beim späteren 3. Mitglied (Familien-Erweiterung) ist `m3` trivial. Namen sind austauschbar.

### 4.2 · Haushalt-Bootstrapping (Migration des Bestands)

Flo hat aktive Daten unter den flachen Pfaden. Beim ersten Web-App-Start nach dem Deploy: **automatische Migration** (kein User-Trigger nötig).

1. Web-App prüft `localStorage.fc_householdId`.
2. Falls nicht gesetzt **und** `/items` (flach) hat Daten → automatischer Migrations-Flow:
   - **Pflicht-Backup:** JSON-Dump aller flachen Daten (`items`, `template`, `favorites`, `notifications`, `settings`) nach `localStorage.fc_migrationBackup` schreiben. Erst danach weitermachen.
   - Generiere `hhId` (z.B. `h_` + 6 Zeichen base32).
   - Kopiere alle flachen Daten unter `/households/{hhId}/...`. Favoriten-Keys werden gemappt: `du`→`m1`, `frau`→`m2`.
   - Schreibe `meta`, `members.m1` (Flo) und `members.m2` (Vicy).
   - Setze `localStorage.fc_householdId` und `localStorage.fc_memberId="m1"` (Flos Gerät).
   - **Lösche die flachen Pfade NICHT sofort** — erst in Cutover-PR Schritt 7 (§7).
3. Falls keine flachen Daten existieren → Onboarding-Screen „Haushalt erstellen / Beitritts-Code eingeben".

### 4.3 · Beitritts-Code

- Format: `WGRL-XXXX` (4 Zeichen base32, keine Zahl/Buchstabe-Verwechsler — kein `0`, `O`, `I`, `1`).
- Gültigkeit: 7 Tage ab Erstellung.
- Erstellung: Settings-Screen → „Mitglied einladen" Button → generiert Code, zeigt ihn an.
- Einlösung: Onboarding-Screen → Eingabefeld → liest `/joinCodes/{code}` über Inverse-Index (siehe unten).
- **Sicherheitsproblem:** Wenn `/households/{hhId}/joinCodes/{code}` nur unter dem Haushalt liegt, kann ein Nicht-Mitglied es nicht finden, ohne die `hhId` zu kennen. Lösung: zusätzlicher flacher Index `/joinCodes/{code} = hhId`. Sichtbar für `auth != null`, aber nicht enumerierbar (RTDB liefert kein „list all keys" für unauthentifizierte oder anonyme User ohne expliziten Read auf den Root-Node).

```
/joinCodes/WGRL-4F7K: "h_8f3k2a"
```

Beim erfolgreichen Beitritt: Code wird aus beiden Pfaden gelöscht.

### 4.4 · Scraper (`scripts/check-deals.js`)

Schreibt aktuell `/deals` und `/leaflets`. Änderungen:

- **`/deals` → `/deals/global`** — einzige Pfadänderung im Scraper, sonst unverändert.
- **`/leaflets`** bleibt flach (global, scraper-owned).
- **`activeMarkets`**: Scraper liest aktuell `/settings/activeMarkets`. Mit Mehr-Haushalt-Modell muss er die **Union** aller `/households/*/settings/activeMarkets` berechnen, um zu wissen, welche Märkte zu scrapen sind. Während es nur einen Haushalt gibt, kann er als Fallback alle 4 Märkte scrapen — siehe §11 Q3.

### 4.5 · Security Rules (Web-App: loose)

**Entscheidung:** Web-App bleibt in 3.0 bei `auth != null`-Gate (Option a). Die Trennung zwischen Haushalten erfolgt über `localStorage.fc_householdId`, nicht über strikte RTDB-Rules. Echte Strenge folgt in 3.1 für die Native-App, wo echte UIDs existieren.

```json
{
  "rules": {
    "households": {
      "$hhId": {
        ".read":  "auth != null",
        ".write": "auth != null"
      }
    },
    "joinCodes": {
      "$code": {
        ".read":  "auth != null",
        ".write": "auth != null"
      }
    },
    "deals":     { ".read": "auth != null", ".write": false },
    "leaflets":  { ".read": "auth != null", ".write": false }
  }
}
```

**Bewusste Tradeoffs:**
- Ein Angreifer mit Anon-Auth kann theoretisch fremde Haushalte lesen, **wenn** er die `hhId` erraten kann. `hhId` ist 6 Zeichen base32 → ausreichend gegen Brute-Force für eine nicht-öffentliche Web-App.
- Schreib-Schutz gegen Drittparteien bleibt durch Anon-Auth erhalten (Status quo).
- Scraper schreibt weiterhin via Service-Account (bypasst Rules).

---

## 5 · Frontend-Änderungen (`index.html`)

Konkrete Stellen, die in dieser Etappe angefasst werden:

| Stelle (Zeile ca.) | Was ändert sich |
|---|---|
| Z. 281 (`state`) | `state.householdId` ergänzen, `state.members` ergänzen, `state.favorites` bleibt aber Keys sind `memberId` statt `du`/`frau` |
| Z. 293–316 (`attachListeners`) | Alle `db.ref(k)` werden zu `db.ref('households/'+hhId+'/'+k)`, außer `deals` (→ `deals/global`) und `leaflets` (bleibt) |
| Z. 318–338 (`initApp`) | Nach `auth.onAuthStateChanged`: Bootstrap-Check (`fc_householdId` in localStorage), ggf. Migration oder Onboarding |
| Z. 389–407 (`login`/`logout`) | `currentUser` wird `memberId`; USERS-Lookup über `state.members[memberId]` statt Konstante |
| Z. 533, 537–559 (Item-Operationen) | Alle `db.ref('items/'+k)` etc. werden `db.ref('households/'+hhId+'/items/'+k)` — ein Helper `hhRef(path)` einführen |
| Z. 565 (`pushNotif`) | `to`-Empfänger: alle Members außer `currentUser` (statt hartcodiertem „other") |
| Z. 269 (`USERS`-Konstante) | Entfernen, ersetzen durch dynamische `state.members` |
| Z. 1277, 1279 (Notif-Rendering) | `USERS[n.from]` → `state.members[n.from]` |

**Helper-Funktion:** `function hhRef(path){ return db.ref('households/'+state.householdId+'/'+path); }` — minimiert Diff-Größe und Fehlerrisiko.

### Neue UI-Bausteine

1. **Onboarding-Screen** (vor erstem Login): „Haushalt erstellen" / „Beitritts-Code eingeben"
2. **Settings → Haushalt-Section:** Name, Mitglieder-Liste, „Mitglied einladen" (Code generieren)
3. **Member-Picker** beim Login (ersetzt den hartcodierten Du/Vicy-Button) — liest `state.members`

---

## 6 · Scraper-Änderungen (`scripts/check-deals.js`)

Minimal-invasiv:

1. Alle `firebase.ref('deals/...')` → `firebase.ref('deals/global/...')`. Falls Pfad nicht mehrfach vorkommt: 1 Zeile.
2. `activeMarkets`-Lesen umstellen auf Union über alle Haushalte:
   ```js
   const snap = await db.ref('households').once('value');
   const union = new Set();
   snap.forEach(hh => {
     const am = hh.child('settings/activeMarkets').val();
     if (Array.isArray(am)) am.forEach(m => union.add(m));
   });
   const activeMarkets = union.size ? [...union] : ALL_MARKETS;
   ```
3. Leaflets-Pfad: unverändert.

---

## 7 · Migrations-Plan (Reihenfolge)

1. **Spec-Review** (jetzt) — offene Entscheidungen klären.
2. **Security Rules vorbereiten** (in Firebase Console drafting, noch nicht aktivieren).
3. **Scraper-Branch:** `/deals` → `/deals/global`, deployen, Schreibziele verifizieren. Alt-Pfad nicht löschen, läuft eine Nacht parallel.
4. **Web-App-Branch (Migration-Mode):** Liest **noch** flach, schreibt schon nach `/households/{hhId}/...`. Lesen aus `/deals/global` zuerst, Fallback auf `/deals`.
   - Hier wird die einmalige Migration durchgeführt (§4.2).
   - Smoke-Test mit Vicy: Beitritts-Code-Flow.
5. **Cutover:** Web-App liest nur noch `/households/{hhId}/...` und `/deals/global`. Flache Pfade werden ignoriert.
6. **Aktive Rules-Änderung** in Firebase Console.
7. **Cleanup:** Alte flache Pfade (`/items`, `/template`, `/favorites`, `/notifications`, `/settings`, `/deals`) werden gelöscht, **nachdem** 7 Tage stabil gelaufen.

---

## 8 · Rollback-Strategie

- **Schritt 3 (Scraper) rückgängig:** Pfad zurück auf `/deals` — 1 Commit-Revert.
- **Schritt 4–5 (Web-App):** Da flache Pfade bis Schritt 7 erhalten bleiben, kann die Web-App auf den vorherigen Commit zurückgerollt werden, ohne Datenverlust.
- **localStorage-Reset-Knopf** im Settings-Screen für den Fall, dass die Migration auf einem Gerät fehlschlägt.

---

## 9 · Testing / Definition of Done

- [ ] Migration bei Flo läuft durch → alle Items/Templates/Favorites in `/households/{hhId}/...` vorhanden, flacher Pfad unverändert (noch).
- [ ] Vicy kann Beitritts-Code einlösen und sieht sofort die Liste.
- [ ] Beide schreiben gleichzeitig in `items` → Realtime-Sync funktioniert.
- [ ] Deal-Badges (`🏷️`) erscheinen weiterhin, gelesen aus `/deals/global`.
- [ ] Scraper-Nachtlauf befüllt `/deals/global`, alte `/deals` bleibt unverändert (parallel).
- [ ] Push-Notifications zwischen Flo und Vicy funktionieren mit dem neuen Member-Modell.
- [ ] activeMarkets-Toggle in Settings persistiert pro Haushalt.
- [ ] Security Rules: Anonymer User kann nicht auf fremden `hhId` schreiben (manuell mit zweitem Browser-Tab + erfundener `hhId` getestet).

---

## 10 · Was bewusst NICHT in 3.0 ist

- Native-App-Anpassung an die neue Struktur → Phase 3.1.
- Mehrere Haushalte pro User (Wechsel-UI).
- Rollen (Admin/Member).
- Mitglied-Entfernen.
- Haushalt-Löschen.
- Pro-Status-Flag am Haushalt — kommt mit Monetarisierung später.
- Echte Auth in der Web-App (Email/Google).

---

## 11 · Entschieden (15.05.2026)

| # | Frage | Entscheidung |
|---|---|---|
| Q1 | Member-IDs | Generisch: `m1`, `m2`. Anzeigename in `members.{id}.name`. |
| Q2 | `/deals/global` vs. flach | `/deals/global` (laut Memory bereits beschlossen). |
| Q3 | Scraper-Markt-Logik | Union aller `/households/*/settings/activeMarkets`. Fallback: alle 4 Märkte. |
| Q4 | Web-App Rules-Strenge | Loose: `auth != null`. Strenge UID-Rules erst in Native 3.1. |
| Q5 | Beitritts-Code-Format | `WGRL-XXXX` (4 Zeichen base32, ohne `0/O/I/1`). 7 Tage gültig. |
| Q6 | Migrations-Trigger | Automatisch beim ersten Start, mit Pflicht-Backup nach `localStorage.fc_migrationBackup`. |

---

## 12 · Claude-Code-Handoff

Aufteilung in 3 PRs/Commits:

1. **Scraper-PR:** `/deals` → `/deals/global` + Markt-Union. Klein, isoliert, in 1 Lauf testbar.
2. **Web-App Migration-Mode PR:** Schreiben nach `/households/{hhId}`, Migration-Code (mit `fc_migrationBackup`), Onboarding-Screen, Beitritts-Code, Member-Picker. Lese-Fallbacks auf flache Pfade bleiben aktiv.
3. **Cutover-PR:** Flache Lese-Fallbacks entfernen, Security Rules (§4.5) aktivieren, flache Pfade in RTDB löschen nach 7 Tagen Stabilität.

Pro PR ein separater Prompt-File unter `docs/specs/phase-3.0/prompts/` für Claude Code.

---

**Nächster Schritt:** PR-1-Prompt für Scraper schreiben.
