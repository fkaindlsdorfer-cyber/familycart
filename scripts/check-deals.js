/**
 * My Wagerl – Aktions-Check via marktguru.at npm Paket
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import { search }              from "marktguru.at";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const ZIP_CODE         = "5204"; // Strasswalchen

initializeApp({ credential: cert(FIREBASE_SERVICE), databaseURL: FIREBASE_DB_URL });
const db = getDatabase();

function normalizeStore(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("interspar"))              return "interspar";
  if (n.includes("eurospar"))               return "eurospar";
  if (n.includes("spar"))                   return "spar";
  if (n.includes("hofer") || n.includes("aldi")) return "hofer";
  if (n.includes("billa plus") || n.includes("billa+")) return "billaplus";
  if (n.includes("billa"))                  return "billa";
  if (n.includes("maximarkt"))              return "maximarkt";
  if (n.includes("lidl"))                   return "lidl";
  if (n.includes("penny"))                  return "penny";
  return name;
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("🛒 My Wagerl – Aktions-Check via marktguru.at");
  console.log(`📅 ${new Date().toLocaleString("de-AT")}`);
  console.log(`📍 PLZ: ${ZIP_CODE}`);
  console.log("═══════════════════════════════════════════════════\n");

  // Artikel aus Firebase laden
  const [itemsSnap, templateSnap] = await Promise.all([
    db.ref("items").get(),
    db.ref("template").get(),
  ]);

  const allItems = [
    ...Object.values(itemsSnap.val()    || {}),
    ...Object.values(templateSnap.val() || {}),
  ];

  const seen = new Set();
  const articles = allItems.filter(i =>
    i.name && !seen.has(i.name.toLowerCase()) && seen.add(i.name.toLowerCase())
  );

  if (articles.length === 0) {
    console.log("⚠️  Keine Artikel gefunden. Bitte Artikel in der App anlegen!");
    process.exit(0);
  }

  console.log(`📦 ${articles.length} Artikel werden gesucht:`);
  articles.forEach(a => console.log(`   - ${a.name}`));
  console.log("");

  const allDeals = [];
  const checkedAt = new Date().toISOString();

  for (const article of articles) {
    console.log(`🔍 Suche: "${article.name}"`);
    try {
      const results = await search(article.name, {
        limit:   10,
        zipCode: ZIP_CODE,
      });

      if (!results || results.length === 0) {
        console.log(`   📭 Keine Aktionen\n`);
      } else {
        console.log(`   ✅ ${results.length} Angebot(e):`);
        for (const offer of results) {
          const storeName  = offer.advertisers?.[0]?.name || "Unbekannt";
          const storeId    = normalizeStore(storeName);
          const price      = offer.price     ? `${offer.price} EUR`    : null;
          const oldPrice   = offer.oldPrice  ? `${offer.oldPrice} EUR` : null;
          const savings    = (offer.price && offer.oldPrice)
            ? `-${(offer.oldPrice - offer.price).toFixed(2)} EUR` : null;
          const validUntil = offer.validityDates?.[0]?.to?.slice(0,10) || null;

          console.log(`      🏪 ${storeName}: ${offer.description || article.name} – ${price || "?"}`);

          allDeals.push({
            articleName: article.name,
            storeId, storeName,
            title:      offer.description || article.name,
            price, oldPrice, savings, validUntil,
            source:     "marktguru.at",
            checkedAt,
          });
        }
        console.log("");
      }
    } catch (e) {
      console.error(`   ⚠️  Fehler: ${e.message}\n`);
    }

    await sleep(300);
  }

  // Duplikate entfernen
  const seenDeals = new Set();
  const uniqueDeals = allDeals.filter(d => {
    const key = `${d.articleName}_${d.storeId}_${d.validUntil}`;
    if (seenDeals.has(key)) return false;
    seenDeals.add(key); return true;
  });

  // In Firebase speichern
  if (uniqueDeals.length > 0) {
    const dealsObj = {};
    uniqueDeals.forEach((d, i) => { dealsObj[`deal_${Date.now()}_${i}`] = d; });
    await db.ref("deals").set(dealsObj);

    const top = uniqueDeals.slice(0,3).map(d => `${d.articleName} bei ${d.storeName}`).join(", ");
    await db.ref("notifications").push({
      msg:  `🔥 ${uniqueDeals.length} Aktionen gefunden! ${top}`,
      from: "system", to: "all", id: Date.now(),
      time: new Date().toLocaleTimeString("de-AT", { hour:"2-digit", minute:"2-digit" }),
    });
    console.log(`\n💾 ${uniqueDeals.length} Deals gespeichert!`);
  } else {
    await db.ref("deals").set(null);
    console.log("\n📭 Keine Aktionen gefunden.");
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${uniqueDeals.length} Deals aus marktguru.at`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch(e => { console.error("❌ Fehler:", e.message); process.exit(1); });
