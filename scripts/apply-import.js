/**
 * Phase C: Bulk-Import neue Stammartikel in Firebase /items/
 * Usage:
 *   node apply-import.js --dry-run   (nur loggen)
 *   node apply-import.js             (echter Run — braucht FIREBASE_SERVICE_ACCOUNT)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const __dir    = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes("--dry-run");

console.log(isDryRun ? "🔍 DRY-RUN — kein Schreiben in Firebase\n"
                     : "🚀 LIVE-RUN — schreibt in Firebase\n");

// ── Plan laden ─────────────────────────────────────────────────────────────
const plan = JSON.parse(readFileSync(join(__dir, "import-plan.json"), "utf8"));
const toImport = plan.to_import;
console.log(`Plan: ${toImport.length} Items in to_import\n`);

// ── Aktuellen Firebase-Stand holen (öffentlicher REST-Read) ────────────────
const DB_URL = "https://einkaufsliste-e2f0c-default-rtdb.europe-west1.firebasedatabase.app";
console.log("Fetche aktuellen Stand aus Firebase…");
const current = await fetch(`${DB_URL}/items.json`).then(r => r.json());
const existingNorm = new Set(
  Object.values(current || {}).map(i => (i.name || "").toLowerCase().trim())
);
console.log(`Firebase: ${existingNorm.size} Items vorhanden\n`);

// ── Live-Duplikate rausfiltern ─────────────────────────────────────────────
const alreadyExists = toImport.filter(i => existingNorm.has(i.name.toLowerCase().trim()));
const reallyNew     = toImport.filter(i => !existingNorm.has(i.name.toLowerCase().trim()));

if (alreadyExists.length) {
  console.log(`Bereits vorhanden (übersprungen): ${alreadyExists.length}`);
  alreadyExists.forEach(i => console.log(`  ⏭  ${i.name}`));
  console.log();
}
console.log(`Tatsächlich neu: ${reallyNew.length} Items werden importiert\n`);

// Kategorien-Verteilung loggen
const dist = {};
reallyNew.forEach(({ cat }) => dist[cat] = (dist[cat] || 0) + 1);
console.log("Verteilung nach Kategorie:");
Object.entries(dist).sort((a, b) => b[1] - a[1])
  .forEach(([cat, n]) => console.log(`  ${String(n).padStart(3)}  ${cat}`));
console.log();

// ── Dry-Run endet hier ─────────────────────────────────────────────────────
if (isDryRun) {
  console.log("Stichproben (erste 10):");
  reallyNew.slice(0, 10).forEach(i => console.log(`  ${i.name.padEnd(35)} ${i.cat}`));
  if (reallyNew.length > 10) console.log(`  ... +${reallyNew.length - 10} weitere`);
  console.log("\n✅ Dry-Run abgeschlossen — kein Firebase-Schreiben.");
  process.exit(0);
}

// ── Live-Run ───────────────────────────────────────────────────────────────
const SVC_RAW = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SVC_RAW) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT nicht gesetzt.");
  process.exit(1);
}

// Pre-Import-Backup
const backupsDir = join(__dir, "..", "backups");
mkdirSync(backupsDir, { recursive: true });
const ts      = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_");
const prePath = join(backupsDir, `items_pre-import_${ts}.json`);
writeFileSync(prePath, JSON.stringify(current, null, 2), "utf8");
console.log(`💾 Pre-Import-Backup: ${prePath}  (${Object.keys(current).length} Items)\n`);

// Firebase-Admin initialisieren
initializeApp({ credential: cert(JSON.parse(SVC_RAW)), databaseURL: DB_URL });
const db = getDatabase();

// Push neue Items
console.log(`Starte Import von ${reallyNew.length} Items…`);
let ok = 0, fail = 0;
for (const item of reallyNew) {
  const entry = {
    name:    item.name,
    cat:     item.cat,
    qty:     item.qty  || "1",
    unit:    item.unit || "",
    done:    false,
    storeId: item.storeId || "",
  };
  try {
    await db.ref("items").push(entry);
    console.log(`  ✅ ${item.name.padEnd(35)} ${item.cat}`);
    ok++;
  } catch (e) {
    console.error(`  ❌ ${item.name}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Fertig: ${ok} importiert, ${fail} Fehler.`);
process.exit(fail > 0 ? 1 : 0);
