/**
 * Phase B: Kategorie-Remap-Vorschau
 * Liest aktuellstes backups/items_*.json, erstellt:
 *   backups/remap-preview.txt  — menschlesbare Vorschau
 *   backups/remap-plan.json    — {itemKey: newCat} für Bulk-Update
 * Kein Schreiben in Firebase!
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const backupsDir = join(__dir, "..", "backups");

// ── Kategorie-Strings (muss mit index.html übereinstimmen) ─────────────────
const CATS = [
  "🥦 Obst & Gemüse",
  "🥩 Fleisch & Wurst",
  "🐟 Fisch",
  "🍝 Nudeln & Reis",
  "🥨 Snacks",
  "🍫 Süßes",
  "🥫 Vorrat",
  "🧀 Milchprodukte",
  "🍷 Getränke",
  "🍞 Backwaren",
  "🧴 Hygiene & Reinigung",
  "❓ Sonstiges",
];

// ── Keyword-Listen (lowercase, Substring-Match) ────────────────────────────
const FISCH_KW   = ["fisch","lachs","tunfisch","tonno","hering","garnelen","oktopus","sushi","fischstäb","tk fisch","sardine","makrele","shrimps","thunfisch"];
const NUDELN_KW  = ["nudel","pasta","spaghetti","lasagn","barilla","orzo","reisnudel","suppennudel","basmati","risotto"," reis","couscous","polenta","gnocchi","tortellini","penne","fusilli","farfalle","tagliatelle"];
const SNACKS_KW  = ["chips","pop-bär","pom-bär","nossi","crizzlies","soletti","salzstangerl","kellys","cracker","popcorn","nüsse","nuss","sesam","erdnuss","pistazie","mandeln","walnuss","cashew","studentenfutter","salzgebäck","brezen","brezel","brezeln","flips","chio"];
const SUES_KW    = ["schoko","gummibär","katjes","lachgummi","haribo","kekse","kinder","manner","marmelade","vanille","kakao","zucker","honig","glasur","streusel","bonbon","tic tac","süß","bombons","lebkuchen","mignon","staud","yoghurette","duplo","smarties","country","pfeiflutscher","skittles","candy","schokolade","nutella","ferrero","milka","ritter sport","toblerone","trolli","mamba","nimm 2","wrigley","caramel","karamell","torte","kuchen","eis ","speiseeis","tiramisu","mousse","pudding","konfitüre","gelee"];

function matchesAny(name, keywords) {
  const n = name.toLowerCase();
  return keywords.some(kw => n.includes(kw));
}

function classify(key, item) {
  const oldCat = item.cat || "❓ Sonstiges";
  const name   = item.name || "";

  // 1. Label-Rename (Hygiene)
  if (oldCat === "🧴 Hygiene") return { newCat: "🧴 Hygiene & Reinigung", reason: "rename" };

  // 2. Fleisch & Fisch aufteilen
  if (oldCat === "🥩 Fleisch & Fisch") {
    if (matchesAny(name, FISCH_KW)) return { newCat: "🐟 Fisch", reason: "split-fisch" };
    return { newCat: "🥩 Fleisch & Wurst", reason: "split-fleisch" };
  }

  // 3. Vorrat aufteilen
  if (oldCat === "🥫 Vorrat") {
    if (matchesAny(name, NUDELN_KW)) return { newCat: "🍝 Nudeln & Reis", reason: "split-nudeln" };
    if (matchesAny(name, SUES_KW))   return { newCat: "🍫 Süßes",         reason: "split-sues"   };
    if (matchesAny(name, SNACKS_KW)) return { newCat: "🥨 Snacks",        reason: "split-snacks" };
    return { newCat: "🥫 Vorrat", reason: "unchanged" };
  }

  // 4. Backwaren: süße Ausreißer → Süßes
  if (oldCat === "🍞 Backwaren") {
    if (matchesAny(name, SUES_KW)) return { newCat: "🍫 Süßes", reason: "uncertain", hint: "Backwaren→Süßes?" };
    return { newCat: oldCat, reason: "unchanged" };
  }

  // 5. Sonstiges: könnte in neue Cats passen
  if (oldCat === "❓ Sonstiges") {
    if (matchesAny(name, NUDELN_KW)) return { newCat: "🍝 Nudeln & Reis", reason: "uncertain", hint: "Sonstiges→Nudeln?" };
    if (matchesAny(name, SUES_KW))   return { newCat: "🍫 Süßes",         reason: "uncertain", hint: "Sonstiges→Süßes?"  };
    if (matchesAny(name, SNACKS_KW)) return { newCat: "🥨 Snacks",        reason: "uncertain", hint: "Sonstiges→Snacks?" };
    if (matchesAny(name, FISCH_KW))  return { newCat: "🐟 Fisch",         reason: "uncertain", hint: "Sonstiges→Fisch?"  };
    return { newCat: oldCat, reason: "unchanged" };
  }

  // 6. Alle anderen (Obst & Gemüse, Milchprodukte, Getränke) — unverändert
  return { newCat: oldCat, reason: "unchanged" };
}

// ── Backup laden ───────────────────────────────────────────────────────────
const backupFiles = readdirSync(backupsDir).filter(f => f.startsWith("items_") && f.endsWith(".json")).sort();
if (!backupFiles.length) { console.error("Kein items_*.json in backups/ gefunden."); process.exit(1); }
const latestFile = join(backupsDir, backupFiles.at(-1));
console.log("Lese:", latestFile);
const items = JSON.parse(readFileSync(latestFile, "utf8"));

// ── Klassifizieren ─────────────────────────────────────────────────────────
const plan      = {};  // {key: newCat}
const unchanged = [];
const renames   = [];
const splits    = { fisch: [], fleisch: [], nudeln: [], snacks: [], sues: [], vorratRest: [] };
const uncertain = [];

for (const [key, item] of Object.entries(items)) {
  const oldCat = item.cat || "❓ Sonstiges";
  const { newCat, reason, hint } = classify(key, item);
  plan[key] = newCat;

  if (reason === "unchanged") {
    unchanged.push({ name: item.name, cat: oldCat });
  } else if (reason === "rename") {
    renames.push({ name: item.name, old: oldCat, new: newCat });
  } else if (reason === "split-fisch") {
    splits.fisch.push(item.name);
  } else if (reason === "split-fleisch") {
    splits.fleisch.push(item.name);
  } else if (reason === "split-nudeln") {
    splits.nudeln.push(item.name);
  } else if (reason === "split-snacks") {
    splits.snacks.push(item.name);
  } else if (reason === "split-sues") {
    splits.sues.push(item.name);
  } else if (reason === "uncertain") {
    uncertain.push({ name: item.name, old: oldCat, suggested: newCat, hint });
    // Im Plan trotzdem den Vorschlag hinterlegen
  }
}

// "Vorrat bleibt" = unchanged mit oldCat Vorrat
const vorratRest = unchanged.filter(i => i.cat === "🥫 Vorrat");

// ── Neue Kategorie-Verteilung zählen ───────────────────────────────────────
const dist = {};
for (const cat of Object.values(plan)) dist[cat] = (dist[cat] || 0) + 1;

// ── Preview-Text bauen ─────────────────────────────────────────────────────
const lines = [];
const ts = new Date().toLocaleString("de-AT");
lines.push(`REMAP-VORSCHAU für ${Object.keys(items).length} Items`);
lines.push(`Erstellt: ${ts}`);
lines.push("=".repeat(50));

lines.push("");
lines.push(`NEUE KATEGORIE-VERTEILUNG:`);
lines.push("-".repeat(40));
for (const [cat, n] of Object.entries(dist).sort((a,b) => b[1]-a[1])) {
  lines.push(`  ${n.toString().padStart(3)}  ${cat}`);
}

lines.push("");
lines.push(`UNVERÄNDERT (${unchanged.length} Items — keine Änderung):`);
lines.push("-".repeat(40));
lines.push("  [keine Auflistung nötig]");

lines.push("");
lines.push(`LABEL-ÄNDERUNG — 🧴 Hygiene → 🧴 Hygiene & Reinigung (${renames.length} Items):`);
lines.push("-".repeat(40));
for (const r of renames) lines.push(`  - ${r.name}`);

lines.push("");
lines.push(`AUFTEILUNG aus 🥩 Fleisch & Fisch (${splits.fisch.length + splits.fleisch.length} Items):`);
lines.push("-".repeat(40));
lines.push(`→ 🐟 Fisch (${splits.fisch.length} Items):`);
for (const n of splits.fisch) lines.push(`    - ${n}`);
lines.push(`→ 🥩 Fleisch & Wurst (${splits.fleisch.length} Items):`);
for (const n of splits.fleisch) lines.push(`    - ${n}`);

lines.push("");
lines.push(`AUFTEILUNG aus 🥫 Vorrat (${splits.nudeln.length+splits.snacks.length+splits.sues.length+vorratRest.length} Items):`);
lines.push("-".repeat(40));
lines.push(`→ 🍝 Nudeln & Reis (${splits.nudeln.length} Items):`);
for (const n of splits.nudeln) lines.push(`    - ${n}`);
lines.push(`→ 🥨 Snacks (${splits.snacks.length} Items):`);
for (const n of splits.snacks) lines.push(`    - ${n}`);
lines.push(`→ 🍫 Süßes aus Vorrat (${splits.sues.length} Items):`);
for (const n of splits.sues) lines.push(`    - ${n}`);
lines.push(`→ 🥫 Vorrat bleibt (${vorratRest.length} Items):`);
for (const i of vorratRest) lines.push(`    - ${i.name}`);

lines.push("");
lines.push(`UNSICHER / MANUELL ENTSCHEIDEN (${uncertain.length} Items):`);
lines.push("-".repeat(40));
for (const u of uncertain) lines.push(`  - ${u.name}  [aktuell: ${u.old}  →  Vorschlag: ${u.suggested}  (${u.hint})]`);

const previewText = lines.join("\n");
const previewPath = join(backupsDir, "remap-preview.txt");
writeFileSync(previewPath, previewText, "utf8");
console.log("✅ Preview:", previewPath);

const planPath = join(backupsDir, "remap-plan.json");
writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf8");
console.log("✅ Plan:   ", planPath);
console.log("\n--- VERTEILUNG ---");
for (const [cat, n] of Object.entries(dist).sort((a,b) => b[1]-a[1])) console.log(` ${n.toString().padStart(3)}  ${cat}`);
console.log(`\nUnsichere Items: ${uncertain.length}`);
console.log("Kein Firebase-Schreiben erfolgt.");
