/**
 * Phase C: Import-Analyse
 * Liest scripts/import-list.txt, vergleicht mit bestehendem Firebase-Stand
 * (via backups/items_*.json), klassifiziert in A/B/C.
 * Schreibt: backups/import-preview.txt, backups/import-plan.json
 * Kein Firebase-Schreiben!
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir     = dirname(fileURLToPath(import.meta.url));
const rootDir   = join(__dir, "..");
const backupsDir = join(rootDir, "backups");
mkdirSync(backupsDir, { recursive: true });

// ── Kategorien ─────────────────────────────────────────────────────────────
const C = {
  OBST:     "🥦 Obst & Gemüse",
  FLEISCH:  "🥩 Fleisch & Wurst",
  FISCH:    "🐟 Fisch",
  NUDELN:   "🍝 Nudeln & Reis",
  SNACKS:   "🥨 Snacks",
  SUES:     "🍫 Süßes",
  VORRAT:   "🥫 Vorrat",
  MILCH:    "🧀 Milchprodukte",
  GETRAENK: "🍷 Getränke",
  BACKWAREN:"🍞 Backwaren",
  HYGIENE:  "🧴 Hygiene & Reinigung",
  SONST:    "❓ Sonstiges",
};

// ── Keyword-Listen ──────────────────────────────────────────────────────────
const KW = {
  fisch:    ["fisch","lachs","tunfisch","tonno","hering","garnelen","oktopus","sushi","sardine","makrele","shrimps"],
  fleisch:  ["faschiertes","frankfurter","hendlhax","hendl","hühnerfi","hühnerfleisch","kotelett","leberkäs","minutensteak","putenfleisch","putenschinken","putenschnitzel","schinkenspeck","schweinefilet","spare rib","surbratl","surfleisch","bratwürst","burger patties","käsekrainer","knabbernossi","salami","toastschinken","bratfleisch","filet steak","bergsteiger","berner","atterseer"],
  obst:     ["äpfel","apfel","bananen","banane","birnen","birne","brokkoli","champignon","erdbeere","gurke","heidelbeere","karotten","kartoffel","kiwi","knoblauch","kraut","lauch","melone","nektarinen","paprika","pilze","rotkraut","salat","satsumas","sauerkraut","sellerie","seitlinge","spargel","spinat","tomaten","tomate","weintrauben","zucchini","zwiebel","aubergine","mais","wassermelone","pfirsich","himbeere","himbeer","obst"],
  milch:    ["butter","creme fraiche","frischkäse","joghurt","käse","mascarpone","milch","mozzarella","parmesan","raclette","sauerrahm","schlagobers","topfen","cheddar","pizzakäse","moosbacher","sprühsahne","sahne","toastkäse","rama","actimel"],
  getraenk: ["bier","cola","himbeersaft","kindersekt","orangensaft","pepsi","radler","säfte","weißwein","schweppes","amaretto","aperol","baileys","saft","wein ","wein$","getränk"],
  nudeln:   ["nudeln","nudel","pasta","spaghetti","lasagn","barilla","orzo","reisnudel","suppennudel","basmati","risotto","couscous","gnocchi","tortellini","penne","fusilli","farfalle","tagliatelle","wraps"],
  sues:     ["schoko","gummibär","katjes","lachgummi","haribo","kekse","kinder ","kinder$","manner","marmelade","vanilleeis","kakao","zucker","honig","glasur","streusel","bonbon","tic tac","lebkuchen","mignon","duplo","smarties","skittles","schokolade","nutella","ferrero","milka","yoghurette","eis ","tiramisu","mousse","pudding","konfitüre","gelee","pfeiflutscher","chocos","hagelzucker","vollmilchschoko","schokobons","schokostreusel","waffelbecher","tictac","staubzucker","vanillezucker","schokodek","schokoglasur","fishermen","fruchtmüsli"],
  snacks:   ["chips","pom-bär","pombären","soletti","salzstangerl","kellys","cracker","popcorn","nüsse","nuss","sesam","erdnuss","pistazie","mandeln","walnuss","cashew","salzgebäck","brezel","flips","chio","puffoletti","knabbersachen","knabbern"],
  backwaren:["baguette","blätterteig","burger semmeln","kräuterbaguette","laugenbrezel","toast","faschingskrapfen","weizenmehl","weizengrieß","mehl"],
  hygiene:  ["bad reiniger","badeschaum","buntwaschmittel","deo","duschgel","entkalker","entkalkung","feinwaschmittel","frischhaltefolie","geschirrspülsalz","gesichtsreinigung","haarpflege","katzenstreu","klarspüler","küchenrolle","labello","nasenspray","oral b","putzschwamm","rasierer","reinigungsmaske","servietten","silbershampoo","spülbürste","spülmittel","tabs geschirrspüler","taschentücher","wattepads","wc spray","wetex","zahnbürste","zahnpasta","wärmepflaster","erkältungsbad","geschirrspülsalz","salz geschirrspüler"],
  vorrat:   ["backpulver","balsamico","bambussprossen","biskotten","butterschmalz","currypulver","dinkelmehl","essig","kamillentee","ketchup","kokosfett","kokosmilch","kren","maggi","maizena","olivenöl","oregano","paprikapulver","pomito","rapsöl","salz","senf","suppenwürze","zimt","artischocken","backerbsen","misopaste","germ","lavazza","sonnenblumenöl","weißweinessig","zimtstangen","apfessig","apfelessi","curry sauce","frivissa","semmelbrösel","gelierzucker","haferflocken","müsli","cornflakes","mehl glatt","mehl"],
};

// Nicht-Lebensmittel — exakte Substringmatches (lowercase)
const NONFOOD_TOKENS = ["gemeinde","dünger","batterie","uhu stick","seil für","straßenkreide","rhododendron","vogelfutter","trockenfutter","felgenreiniger","ph minus","h&m","algenschutz","sackerl biomüll","biomüll sackerl","gelbe säcke","sackerl 20l","sackerl gelb","straßenkreiden"];
const NONFOOD_EXACT  = new Set(["erde"]);

function norm(s)        { return s.toLowerCase().trim(); }
function matchAny(n, kws) { return kws.some(kw => kw.endsWith("$") ? n.endsWith(kw.slice(0,-1)) : n.includes(kw)); }

function classifyName(name) {
  const n = norm(name);
  if (matchAny(n, KW.fisch))     return C.FISCH;
  if (matchAny(n, KW.fleisch))   return C.FLEISCH;
  if (matchAny(n, KW.obst))      return C.OBST;
  if (matchAny(n, KW.milch))     return C.MILCH;
  if (matchAny(n, KW.getraenk))  return C.GETRAENK;
  if (matchAny(n, KW.nudeln))    return C.NUDELN;
  if (matchAny(n, KW.sues))      return C.SUES;
  if (matchAny(n, KW.snacks))    return C.SNACKS;
  if (matchAny(n, KW.backwaren)) return C.BACKWAREN;
  if (matchAny(n, KW.hygiene))   return C.HYGIENE;
  if (matchAny(n, KW.vorrat))    return C.VORRAT;
  return C.SONST;
}

function detectSpecialCase(name) {
  const n = norm(name);

  // Nicht-Lebensmittel
  if (NONFOOD_EXACT.has(n))                   return { type: "non-food", suggestion: "weglassen" };
  if (NONFOOD_TOKENS.some(t => n.includes(t))) return { type: "non-food", suggestion: "weglassen" };
  // Farb-/Einzelwort-Anomalien
  if (/^[a-zA-ZäöüÄÖÜß]{1,4}$/.test(name))   return { type: "anomaly",  suggestion: "prüfen" };
  // Abgeschnittene Wörter
  if (/\b[A-Za-zÄÖÜäöüß]{1,3}$/.test(name) && name.split(/\s+/).length >= 2 && !name.includes("("))
                                               return { type: "anomaly",  suggestion: "prüfen (abgeschnitten?)" };
  // Kategorie-Name als Artikel
  if (Object.values(C).some(c => norm(c.replace(/\p{Emoji}/gu,"").trim()) === n))
                                               return { type: "anomaly",  suggestion: "weglassen (Kategorie-Name)" };
  // Anlass / Wochentag
  if (/\bfür\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(name))
                                               return { type: "occasion", suggestion: "weglassen oder bereinigten Namen verwenden" };
  // "Aktion"-Suffix
  if (/\baktion\b/i.test(name))               return { type: "occasion", suggestion: `als "${name.replace(/\s*aktion\s*/i,"").trim()}" importieren` };
  // Store-spezifische Variante (enthält Supermarkt-Namen + Größe)
  if (/\b(hofer|spar|maximarkt|billa|lidl)\b/i.test(name) && name.split(/\s+/).length >= 3)
                                               return { type: "occasion", suggestion: "generischeren Namen überlegen" };
  // Lange Beschreibung (>4 Wörter ohne (, ), /)
  const wordCount = name.replace(/\(.*?\)/g,"").split(/\s+/).filter(Boolean).length;
  if (wordCount >= 5)                          return { type: "long-desc", suggestion: `als "${name.split(/\s+/).slice(0,2).join(" ")}" + Notiz` };

  return null;
}

// ── Bestehende Items laden ──────────────────────────────────────────────────
const backupFiles = readdirSync(backupsDir).filter(f => f.startsWith("items_") && f.endsWith(".json")).sort();
if (!backupFiles.length) { console.error("Kein items_*.json in backups/ gefunden."); process.exit(1); }
const existing = JSON.parse(readFileSync(join(backupsDir, backupFiles.at(-1)), "utf8"));
const existingNorm = new Set(Object.values(existing).map(i => norm(i.name || "")));
console.log(`Bestehende Items: ${existingNorm.size} (aus ${backupFiles.at(-1)})`);

// ── Import-Liste laden ──────────────────────────────────────────────────────
const rawLines = readFileSync(join(__dir, "import-list.txt"), "utf8")
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean);
console.log(`Import-Liste: ${rawLines.length} Zeilen`);

// In-Liste-Duplikate finden
const seenInList = {};
rawLines.forEach(name => { const k = norm(name); seenInList[k] = (seenInList[k] || 0) + 1; });
const inListDupes = Object.entries(seenInList).filter(([,n]) => n > 1);

// Unique names (preserving first occurrence casing)
const uniqueNames = [...new Map(rawLines.map(n => [norm(n), n])).values()];
console.log(`Unique Items: ${uniqueNames.length}  (${rawLines.length - uniqueNames.length} Zeilen-Duplikate)\n`);

// ── Klassifizieren ──────────────────────────────────────────────────────────
const catA = [];                            // Duplikate (existiert in Firebase)
const catB = [];                            // Neue Artikel
const catC = { "non-food": [], anomaly: [], occasion: [], "long-desc": [], "in-list-dupes": [] };

for (const name of uniqueNames) {
  const n = norm(name);

  // C: In-Liste-Duplikate (merken, aber trotzdem weiter klassifizieren)
  if (seenInList[n] > 1) {
    catC["in-list-dupes"].push({ name, count: seenInList[n] });
  }

  // A: Duplikat in Firebase?
  if (existingNorm.has(n)) { catA.push(name); continue; }

  // C: Sonderfälle?
  const special = detectSpecialCase(name);
  if (special) {
    catC[special.type].push({ name, suggestion: special.suggestion, cat: classifyName(name) });
    continue;
  }

  // B: Neuer Artikel
  catB.push({ name, cat: classifyName(name) });
}

// B-Verteilung
const bDist = {};
catB.forEach(({ cat }) => bDist[cat] = (bDist[cat] || 0) + 1);

// C total
const cTotal = Object.values(catC).reduce((sum, arr) => sum + arr.length, 0);

// ── Console-Output ──────────────────────────────────────────────────────────
console.log("═".repeat(50));
console.log(`A — Duplikate (übersprungen):   ${catA.length}`);
console.log(`B — Neue Artikel (importiert):  ${catB.length}`);
console.log(`C — Sonderfälle (Entscheidung): ${cTotal} (davon ${catC["in-list-dupes"].length} Zeilen-Duplikate in Liste)`);
console.log("─".repeat(50));
console.log("B-Verteilung:");
Object.entries(bDist).sort((a,b)=>b[1]-a[1]).forEach(([cat,n])=>console.log(`  ${String(n).padStart(3)}  ${cat}`));

// ── Preview-Text ────────────────────────────────────────────────────────────
const L = [];
L.push(`IMPORT-VORSCHAU`);
L.push(`Erstellt: ${new Date().toLocaleString("de-AT")}`);
L.push("=".repeat(55));
L.push(`Gesamt in Liste: ${rawLines.length}  |  Unique: ${uniqueNames.length}`);
L.push(`A Duplikate: ${catA.length}  |  B Neu: ${catB.length}  |  C Sonderfälle: ${cTotal}`);

// ── A ──────────────────────────────────────────────────────────────────────
L.push(""); L.push(`KATEGORIE A — DUPLIKATE (${catA.length} Items, werden übersprungen):`);
L.push("-".repeat(55));
catA.forEach(n => L.push(`  - ${n}`));

// ── B ──────────────────────────────────────────────────────────────────────
L.push(""); L.push(`KATEGORIE B — NEUE ARTIKEL (${catB.length} Items, werden importiert):`);
L.push("-".repeat(55));
L.push("Verteilung:"); Object.entries(bDist).sort((a,b)=>b[1]-a[1]).forEach(([cat,n])=>L.push(`  ${String(n).padStart(3)}  ${cat}`));
const bByCat = {};
catB.forEach(({ name, cat }) => { if (!bByCat[cat]) bByCat[cat]=[]; bByCat[cat].push(name); });
L.push("");
for (const [cat, names] of Object.entries(bByCat).sort()) {
  L.push(`${cat}:`);
  names.forEach(n => L.push(`  - ${n}`));
}

// ── C ──────────────────────────────────────────────────────────────────────
L.push(""); L.push(`KATEGORIE C — SONDERFÄLLE (${cTotal} Items, brauchen Entscheidung):`);
L.push("-".repeat(55));

const cLabels = { "non-food": "Nicht-Lebensmittel", anomaly: "Anomalien", occasion: "Anlass-/Store-Notiz im Namen", "long-desc": "Lange Beschreibung", "in-list-dupes": "Duplikate innerhalb der Import-Liste" };
for (const [type, items] of Object.entries(catC)) {
  if (!items.length) continue;
  L.push(""); L.push(`[${cLabels[type]}]`);
  if (type === "in-list-dupes") {
    items.forEach(({ name, count }) => L.push(`  - ${name}  (${count}× in Liste)`));
  } else {
    items.forEach(({ name, suggestion, cat }) => L.push(`  - ${name.padEnd(42)} → ${suggestion}  [${cat}]`));
  }
}

const previewText = L.join("\n");
writeFileSync(join(backupsDir, "import-preview.txt"), previewText, "utf8");
console.log("\n✅ Preview: backups/import-preview.txt");

// ── Plan-JSON ───────────────────────────────────────────────────────────────
const plan = {
  skip_duplicates: catA,
  to_import: catB.map(({ name, cat }) => ({ name, cat, qty: "1", unit: "" })),
  needs_decision: [
    ...catC["non-food"].map(({ name, suggestion, cat }) => ({ name, reason: "Nicht-Lebensmittel", suggestion, cat })),
    ...catC.anomaly.map(({ name, suggestion, cat }) =>    ({ name, reason: "Anomalie",            suggestion, cat })),
    ...catC.occasion.map(({ name, suggestion, cat }) =>   ({ name, reason: "Anlass/Store-Notiz",  suggestion, cat })),
    ...catC["long-desc"].map(({ name, suggestion, cat }) =>({ name, reason: "Lange Beschreibung", suggestion, cat })),
    ...catC["in-list-dupes"].map(({ name, count }) =>     ({ name, reason: `${count}× in Import-Liste`, suggestion: "einmalig importieren oder prüfen" })),
  ],
};
writeFileSync(join(backupsDir, "import-plan.json"), JSON.stringify(plan, null, 2), "utf8");
console.log("✅ Plan:    backups/import-plan.json");
