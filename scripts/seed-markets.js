/**
 * One-shot seed: writes /markets/ catalog and initializes /settings/activeMarkets.
 * Run once: node seed-markets.js
 * Won't overwrite /settings/activeMarkets if it already exists.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";

const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({ credential: cert(FIREBASE_SERVICE), databaseURL: FIREBASE_DB_URL });
const db = getDatabase();

const MARKETS = {
  spar:         { name: "Spar",       group: "spar",     uniqueName: "spar",       icon: "🌲" },
  eurospar:     { name: "Eurospar",   group: "spar",     uniqueName: "eurospar",   icon: "🌲" },
  maximarkt:    { name: "Maximarkt",  group: "spar",     uniqueName: "maximarkt",  icon: "🏪" },
  interspar:    { name: "Interspar",  group: "spar",     uniqueName: "interspar",  icon: "🌲" },
  billa:        { name: "Billa",      group: "rewe",     uniqueName: "billa",      icon: "🛒" },
  "billa-plus": { name: "Billa Plus", group: "rewe",     uniqueName: "billa-plus", icon: "🛍️" },
  hofer:        { name: "Hofer",      group: "discount", uniqueName: "hofer",      icon: "🏷️" },
  lidl:         { name: "Lidl",       group: "discount", uniqueName: "lidl",       icon: "🔵" },
  penny:        { name: "Penny",      group: "discount", uniqueName: "penny",      icon: "🔴" },
  bipa:         { name: "Bipa",       group: "drogerie", uniqueName: "bipa",       icon: "💗" },
  dm:           { name: "dm",         group: "drogerie", uniqueName: "dm",         icon: "🧡" },
  obi:          { name: "Obi",        group: "baumarkt", uniqueName: "obi",        icon: "🟠" },
};

const DEFAULT_ACTIVE = ["hofer", "lidl", "eurospar", "maximarkt"];

async function seed() {
  console.log("📦 Seeding /markets/...");
  await db.ref("markets").set(MARKETS);
  console.log("✅ /markets/ seeded\n");

  const snap = await db.ref("settings/activeMarkets").get();
  if (!snap.exists()) {
    await db.ref("settings/activeMarkets").set(DEFAULT_ACTIVE);
    console.log("✅ /settings/activeMarkets initialized:", DEFAULT_ACTIVE);
  } else {
    console.log("ℹ️  /settings/activeMarkets already exists:", snap.val(), "– skipping");
  }

  console.log("\n✅ Seed abgeschlossen.");
  process.exit(0);
}

seed().catch(e => { console.error("❌ Seed-Fehler:", e.message); process.exit(1); });
