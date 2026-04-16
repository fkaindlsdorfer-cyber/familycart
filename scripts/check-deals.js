/**
 * My Wagerl – Automatischer Aktions-Check via marktguru.at
 *
 * Ablauf:
 * 1. Artikel aus Firebase laden
 * 2. Jeden Artikel auf marktguru.at suchen (direkte API)
 * 3. Gefundene Aktionen in Firebase speichern
 * 4. Benachrichtigung senden
 *
 * Kein PDF-Download, kein Gemini, kein Rate Limit!
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import fetch                   from "node-fetch";

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Konfiguration ──────────────────────────────────────────────────────────
const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Deine Postleitzahl (Strasswalchen)
const ZIP_CODE = "5204";

// marktguru.at API (inoffiziell, öffentlich zugänglich)
const MG_API    = "https://api.marktguru.at/api/v1/offers/search";
const MG_CLIENT = "WU/RH+PMGDi+gkZer3WbMelt6zcYHSTytNB7VpTia90=";
const MG_KEY    = "8Kk+pmbf7TgJ9nVj2cXeA7P5zBGv8iuutVVMRfOfvNE=";

// ─── Firebase initialisieren ─────────────────────────────────────────────────
initializeApp({ credential: cert(FIREBASE_SERVICE), databaseURL: FIREBASE_DB_URL });
const db = getDatabase();

// ─── Marktguru Suche ─────────────────────────────────────────────────────────
async function searchMarktguru(query) {
  const url = `${MG_API}?as=web&limit=10&offset=0&q=${encodeURIComponent(query)}&zipCode=${ZIP_CODE}`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-clientkey": MG_CLIENT,
        "x-apikey":    MG_KEY,
        "User-Agent":  "Mozilla/5.0",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error(`  ⚠️  Suche fehlgeschlagen für "${query}": ${e.message}`);
    return [];
  }
}

// ─── Markt-Namen normalisieren ───────────────────────────────────────────────
function normalizeStore(advertiserName) {
  const n = (advertiserName || "").toLowerCase();
  if (n.includes("spar") && n.includes("interspar")) return "interspar";
  if (n.includes("eurospar"))  return "eurospar";
  if (n.includes("spar"))      return "spar";
  if (n.includes("hofer") || n.includes("aldi")) return "hofer";
  if (n.includes("billa plus") || n.includes("billa+")) return "billaplus";
  if (n.includes("billa"))     return "billa";
  if (n.includes("maximarkt")) return "maximarkt";
  if (n.includes("lidl"))      return "lidl";
  if (n.includes("penny"))     return "penny";
  return advertiserName;
}

// ─── Hauptprogramm ──────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("🛒 My Wagerl – Aktions-Check via marktguru.at");
  console.log(`📅 ${new Date().toLocaleString("de-AT")}`);
  console.log(`📍 PLZ: ${ZIP_CODE}`);
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Artikel aus Firebase laden
  const [itemsSnap, templateSnap] = await Promise.all([
    db.ref("items").get(),
    db.ref("template").get(),
  ]);

  const allItems = [
    ...Object.values(itemsSnap.val()    || {}),
    ...Object.values(templateSnap.val() || {}),
  ];

  // Einzigartige Artikelnamen
  const seen    = new Set();
  const articles = allItems
    .filter(i => i.name && !seen.has(i.name.toLowerCase()) && seen.add(i.name.toLowerCase()))
    .map(i => ({ name: i.name, storeId: i.storeId || "" }));

  if (articles.length === 0) {
    console.log("⚠️  Keine Artikel in Firebase gefunden. Bitte erst Artikel in der App anlegen!");
    process.exit(0);
  }

  console.log(`📦 ${articles.length} Artikel werden gesucht:`);
  articles.forEach(a => console.log(`   - ${a.name}`));
  console.log("");

  // 2. Jeden Artikel auf marktguru suchen
  const allDeals = [];
  const checkedAt = new Date().toISOString();

  for (const article of articles) {
    console.log(`🔍 Suche: "${article.name}"`);
    const results = await searchMarktguru(article.name);

    if (results.length === 0) {
      console.log(`   📭 Keine Aktionen gefunden\n`);
    } else {
      console.log(`   ✅ ${results.length} Angebot(e) gefunden:`);

      for (const offer of results) {
        const storeName  = offer.advertisers?.[0]?.name || "Unbekannt";
        const storeId    = normalizeStore(storeName);
        const price      = offer.price ? `${offer.price} EUR` : null;
        const oldPrice   = offer.oldPrice ? `${offer.oldPrice} EUR` : null;
        const savings    = (offer.price && offer.oldPrice)
          ? `-${(offer.oldPrice - offer.price).toFixed(2)} EUR`
          : null;
        const validFrom  = offer.validityDates?.[0]?.from?.slice(0,10) || null;
        const validUntil = offer.validityDates?.[0]?.to?.slice(0,10)   || null;

        console.log(`      🏪 ${storeName}: ${offer.description || offer.name} – ${price || "?"}`);

        allDeals.push({
          articleName: article.name,
          storeId,
          storeName,
          title:       offer.description || offer.name || article.name,
          price,
          oldPrice,
          savings,
          validFrom,
          validUntil,
          source:      "marktguru.at",
          checkedAt,
        });
      }
      console.log("");
    }

    // Kurze Pause zwischen Anfragen
    await sleep(500);
  }

  // 3. Duplikate entfernen (gleicher Artikel + gleicher Markt)
  const seenDeals = new Set();
  const uniqueDeals = allDeals.filter(d => {
    const key = `${d.articleName}_${d.storeId}_${d.validUntil}`;
    if (seenDeals.has(key)) return false;
    seenDeals.add(key);
    return true;
  });

  // 4. In Firebase speichern
  if (uniqueDeals.length > 0) {
    const dealsObj = {};
    uniqueDeals.forEach((d, i) => {
      dealsObj[`deal_${Date.now()}_${i}`] = d;
    });

    // Alte Deals löschen + neue speichern
    await db.ref("deals").set(dealsObj);
    console.log(`\n💾 ${uniqueDeals.length} Deals in Firebase gespeichert!`);

    // 5. Benachrichtigung
    const top = uniqueDeals.slice(0,3).map(d => `${d.articleName} bei ${d.storeName}`).join(", ");
    await db.ref("notifications").push({
      msg:  `🔥 ${uniqueDeals.length} Aktionen gefunden! ${top}`,
      from: "system",
      to:   "all",
      id:   Date.now(),
      time: new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }),
    });
  } else {
    await db.ref("deals").set(null);
    console.log("\n📭 Keine aktuellen Aktionen für deine Artikel gefunden.");
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${uniqueDeals.length} Deals aus marktguru.at`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch(e => {
  console.error("❌ Fehler:", e.message);
  process.exit(1);
});
