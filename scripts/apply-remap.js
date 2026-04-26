/**
 * Phase B: Bulk-Update Kategorien in Firebase
 * Usage:
 *   node apply-remap.js --dry-run   (nur loggen, kein Schreiben)
 *   node apply-remap.js             (echter Run — braucht Firebase-ENVs)
 *
 * ENVs für echten Run:
 *   FIREBASE_DATABASE_URL
 *   FIREBASE_SERVICE_ACCOUNT   (JSON-String des Service-Account)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const __dir    = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes("--dry-run");

console.log(isDryRun ? "🔍 DRY-RUN — kein Schreiben in Firebase\n"
                     : "🚀 LIVE-RUN — schreibt in Firebase\n");

// ── Plan laden ─────────────────────────────────────────────────────────────
const plan = JSON.parse(readFileSync(join(__dir, "remap-plan.json"), "utf8"));
console.log(`Plan geladen: ${Object.keys(plan).length} Items`);

// ── Aktuellen Firebase-Stand holen (öffentlicher REST-Read) ────────────────
const DB_URL = "https://einkaufsliste-e2f0c-default-rtdb.europe-west1.firebasedatabase.app";
console.log("Fetche aktuellen Stand aus Firebase…");
const current = await fetch(`${DB_URL}/items.json`).then(r => r.json());
console.log(`Firebase: ${Object.keys(current).length} Items geladen\n`);

// ── Nur Items mit tatsächlicher Änderung ───────────────────────────────────
const toChange = Object.entries(plan).filter(([key, newCat]) => {
  const old = current[key]?.cat || "❓ Sonstiges";
  return old !== newCat;
});
const unchanged = Object.keys(plan).length - toChange.length;

console.log(`Tatsächliche Änderungen: ${toChange.length}  (${unchanged} bereits korrekt)\n`);
console.log("Alle geplanten Änderungen:");
toChange.forEach(([key, newCat]) => {
  const item = current[key];
  const old  = item?.cat || "❓ Sonstiges";
  console.log(`  ${(item?.name || key).padEnd(35)} ${old}  →  ${newCat}`);
});

// ── Dry-Run endet hier ─────────────────────────────────────────────────────
if (isDryRun) {
  console.log("\n✅ Dry-Run abgeschlossen — kein Firebase-Schreiben.");
  process.exit(0);
}

// ── Live-Run ───────────────────────────────────────────────────────────────
const SVC_RAW = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SVC_RAW) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT nicht gesetzt.");
  process.exit(1);
}

// Pre-Remap-Backup schreiben
const backupsDir = join(__dir, "..", "backups");
mkdirSync(backupsDir, { recursive: true });
const ts      = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_");
const prePath = join(backupsDir, `items_pre-remap_${ts}.json`);
writeFileSync(prePath, JSON.stringify(current, null, 2), "utf8");
console.log(`\n💾 Pre-Remap-Backup: ${prePath}  (${Object.keys(current).length} Items)`);

// Firebase-Admin initialisieren
initializeApp({ credential: cert(JSON.parse(SVC_RAW)), databaseURL: DB_URL });
const db = getDatabase();

// PATCHes ausführen
console.log(`\nStarte ${toChange.length} PATCHes…`);
let ok = 0, fail = 0;
for (const [key, newCat] of toChange) {
  try {
    await db.ref(`items/${key}`).update({ cat: newCat });
    console.log(`  ✅ ${(current[key]?.name || key).padEnd(35)} → ${newCat}`);
    ok++;
  } catch (e) {
    console.error(`  ❌ ${key} (${current[key]?.name}): ${e.message}`);
    fail++;
  }
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Fertig: ${ok} aktualisiert, ${fail} Fehler.`);
process.exit(fail > 0 ? 1 : 0);
