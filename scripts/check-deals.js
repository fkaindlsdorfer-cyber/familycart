/**
 * My Wagerl – Aktions-Check via marktguru.at
 *
 * Märkte via search() + Maximarkt via Leaflet-Scan (marktguru Prospekte)
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import { search }              from "marktguru.at";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const ZIP_CODE         = "5204"; // Strasswalchen

const SKIP_OUTDOOR_LEAFLETS = true; // "Outdoor"-Prospekte überspringen

initializeApp({ credential: cert(FIREBASE_SERVICE), databaseURL: FIREBASE_DB_URL });
const db = getDatabase();

// ── Store normalisation ───────────────────────────────────────────────────────
function normalizeStore(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("interspar"))                             return "interspar";
  if (n.includes("eurospar"))                              return "eurospar";
  if (n.includes("spar"))                                  return "spar";
  if (n.includes("hofer") || n.includes("aldi"))           return "hofer";
  if (n.includes("billa plus") || n.includes("billa+"))    return "billa-plus";
  if (n.includes("billa"))                                 return "billa";
  if (n.includes("maximarkt"))                             return "maximarkt";
  if (n.includes("lidl"))                                  return "lidl";
  if (n.includes("penny"))                                 return "penny";
  if (n.includes("bipa"))                                  return "bipa";
  if (n.includes("dm drogerie") || n.trim() === "dm")      return "dm";
  if (n.includes("obi"))                                   return "obi";
  if (n.includes("mpreis"))                                return "mpreis";
  if (n.includes("t&g") || n.includes("t & g"))           return "tg";
  if (n.includes("metro"))                                 return "metro";
  if (n.includes("lagerhaus"))                             return "lagerhaus";
  if (n.includes("xxxlutz") || n.includes("xxx lutz"))     return "xxxlutz";
  if (n.includes("norma"))                                 return "norma";
  if (n.includes("mömax") || n.includes("moemax"))         return "moemax";
  return n;
}

// ── Marktguru API-Key extraction ──────────────────────────────────────────────
async function getMarktguruKeys() {
  const res = await fetch("https://marktguru.at", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  const html = await res.text();
  const regex = /<script\s+type="application\/json">([\s\S]*?)<\/script>/gm;
  let configStr = "";
  let m;
  while ((m = regex.exec(html)) !== null) configStr = m[1];
  if (!configStr) throw new Error("Marktguru API-Keys nicht gefunden");
  const { config: { apiKey, clientKey } } = JSON.parse(configStr);
  return { apiKey, clientKey };
}

// ── Maximarkt: fetch active leaflets via publishers API ───────────────────────
async function fetchMaximarktLeaflets() {
  console.log("\n📰 Lade Maximarkt Leaflets...");

  const { apiKey, clientKey } = await getMarktguruKeys();
  const url = "https://api.marktguru.at/api/v1/publishers/retailer/maximarkt/leaflets?as=mobile&limit=20&offset=0&zipCode=4910";
  const res = await fetch(url, {
    headers: {
      "X-ApiKey":    apiKey,
      "X-ClientKey": clientKey,
      "User-Agent":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
  });

  if (!res.ok) {
    console.log(`   ❌ Maximarkt leaflets API: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const now  = Date.now();

  if ((data.results || []).length > 0)
    console.log("   🔍 Erstes Leaflet-Objekt:", JSON.stringify(data.results[0]));

  const active = (data.results || [])
    .map(r => ({
      id:        r.mainLeafletId || r.id,
      name:      r.name ?? "",
      validFrom: r.validFrom?.slice(0, 10) ?? null,
      validTo:   r.validTo?.slice(0, 10)   ?? null,
      pageCount: r.pageImages?.count ?? r.pageCount ?? 1,
    }))
    .filter(l => new Date(l.validTo).getTime() >= now)
    .filter(l => !(SKIP_OUTDOOR_LEAFLETS && /outdoor/i.test(l.name)));

  active.forEach(l =>
    console.log(`   ✅ ID ${l.id}: "${l.name}" | ${l.pageCount} Seiten | ${l.validFrom} → ${l.validTo}`)
  );
  console.log(`   📰 ${active.length} aktive Maximarkt-Leaflets\n`);
  return active;
}

// ── Maximarkt: scan one leaflet with Gemini Vision ────────────────────────────
async function scanMaximarktLeaflet(leaflet, articles) {
  if (!GEMINI_API_KEY) {
    console.log("   ⚠️  GEMINI_API_KEY nicht gesetzt – Leaflet-Scan übersprungen.");
    return [];
  }

  const estSecs = leaflet.pageCount * 4;
  console.log(`\n🤖 Scanne "${leaflet.name}" (${leaflet.pageCount} Seiten, ~${estSecs}s)...`);
  console.log(`[DBG] KEY_LEN=${GEMINI_API_KEY?.length || 0}`);
  const itemList  = articles.map(a => a.name).slice(0, 60).join(", ");
  const checkedAt = new Date().toISOString();
  const deals     = [];

  for (let page = 0; page < leaflet.pageCount; page++) {
    const imageUrl = `https://mgat.b-cdn.net/api/v1/leaflets/${leaflet.id}/images/pages/${page}/xlarge.webp`;
    if (page === 0) console.log(`   Image URL: ${imageUrl}`);
    process.stdout.write(`   📄 Seite ${page + 1}/${leaflet.pageCount}... `);

    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.log(`⚠️  Bild nicht erreichbar (${imgRes.status})`);
        await sleep(4000); continue;
      }
      const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

      const prompt =
        `Das ist Seite ${page + 1} aus dem Maximarkt Prospekt "${leaflet.name}" (gültig bis ${leaflet.validTo}).

Gesuchte Artikel: ${itemList}

Welche dieser Artikel sind auf dieser Seite mit Preis oder Rabatt zu sehen?
Antworte NUR mit JSON – keine weiteren Texte:
{"deals":[{"articleName":"Name exakt wie in der Suche","price":"1,99 EUR","savings":"-20%","oldPrice":"2,49 EUR"}]}
Keine Treffer: {"deals":[]}`;

      const callGemini = () => fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method:  "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType: "image/jpeg", data: base64 } },
              { text: prompt },
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 500 },
          }),
        }
      );

      // Exponential backoff: 10s → 30s → 60s
      let res = await callGemini();
      const backoffs = [10000, 30000, 60000];
      for (const delay of backoffs) {
        if (res.status !== 429) break;
        process.stdout.write(`⏳ 429, ${delay / 1000}s... `);
        await sleep(delay);
        res = await callGemini();
      }
      if (res.status === 429) {
        console.log("⚠️  übersprungen (429 nach 3 Retries)");
        await sleep(4000); continue;
      }

      const data = await res.json();

      // Hard-abort on API error (expired key, quota, etc.)
      if (data.error) {
        throw new Error(`Gemini API error ${data.error.code}: ${data.error.message}`);
      }

      if (page === 0) {
        console.log(`[RAW-API] leaflet=${leaflet.id} page=0`);
        console.log(JSON.stringify(data, null, 2).slice(0, 2000));
      }

      const rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      console.log(`[DBG] leaflet=${leaflet.id} page=${page} responseText=|${rawText.slice(0, 500)}| length=${rawText.length}`);
      const jsonM = rawText.match(/\{[\s\S]*\}/);

      if (jsonM) {
        const found = (JSON.parse(jsonM[0]).deals || []).filter(d => d.articleName);
        if (found.length > 0) {
          console.log(`${found.length} Treffer`);
          found.forEach(d => {
            console.log(`      ✅ ${d.articleName} – ${d.price || "?"}`);
            deals.push({
              articleName:  d.articleName,
              storeId:      "maximarkt",
              storeName:    "Maximarkt",
              title:        d.articleName,
              price:        d.price    || null,
              oldPrice:     d.oldPrice || null,
              savings:      d.savings  || null,
              validUntil:   leaflet.validTo,
              source:       "marktguru.at leaflet scan",
              leafletId:    leaflet.id,
              leafletTitle: leaflet.name,
              pageIndex:    page,
              checkedAt,
            });
          });
        } else {
          console.log("–");
        }
      } else {
        console.log("–");
      }
    } catch (e) {
      console.log(`[ERR] leaflet=${leaflet.id} page=${page} error=${e.message} stack=${e.stack?.split('\n')[0]}`);
      if (e.message.startsWith("Gemini API error")) throw e; // propagate fatal errors
    }

    await sleep(4000);
  }

  console.log(`   → ${deals.length} Deals aus "${leaflet.name}"\n`);
  return deals;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("🛒 My Wagerl – Aktions-Check via marktguru.at");
  console.log(`📅 ${new Date().toLocaleString("de-AT")}`);
  console.log(`📍 PLZ: ${ZIP_CODE}`);
  console.log("═══════════════════════════════════════════════════\n");

  // Aktive Märkte + Artikel aus Firebase laden
  const [itemsSnap, templateSnap, settingsSnap] = await Promise.all([
    db.ref("items").get(),
    db.ref("template").get(),
    db.ref("settings/activeMarkets").get(),
  ]);

  let activeMarkets = settingsSnap.val();
  if (!Array.isArray(activeMarkets) || activeMarkets.length === 0) {
    console.warn("⚠️  activeMarkets not set, falling back to defaults");
    activeMarkets = ["hofer", "lidl", "eurospar", "maximarkt"];
  }
  console.log(`🏪 Aktive Märkte: ${activeMarkets.join(", ")}\n`);

  const allItems = [
    ...Object.values(itemsSnap.val()    || {}),
    ...Object.values(templateSnap.val() || {}),
  ];
  const seenNames = new Set();
  const articles  = allItems.filter(i =>
    i.name && !seenNames.has(i.name.toLowerCase()) && seenNames.add(i.name.toLowerCase())
  );

  if (articles.length === 0) {
    console.log("⚠️  Keine Artikel gefunden. Bitte Artikel in der App anlegen!");
    process.exit(0);
  }

  console.log(`📦 ${articles.length} Artikel werden gesucht:`);
  articles.forEach(a => console.log(`   - ${a.name}`));
  console.log("");

  const allDeals  = [];
  const checkedAt = new Date().toISOString();

  // ── marktguru search() für alle aktiven Märkte ─────────────────────────────
  for (const article of articles) {
    console.log(`🔍 Suche: "${article.name}"`);
    try {
      const results = await search(article.name, { limit: 10, zipCode: ZIP_CODE });

      if (!results || results.length === 0) {
        console.log(`   📭 Keine Aktionen\n`);
      } else {
        console.log(`   ✅ ${results.length} Angebot(e):`);
        for (const offer of results) {
          const storeName  = offer.advertisers?.[0]?.name || "Unbekannt";
          const storeId    = normalizeStore(storeName);
          if (!activeMarkets.includes(storeId)) continue;
          const price      = offer.price    ? `${offer.price} EUR`    : null;
          const oldPrice   = offer.oldPrice ? `${offer.oldPrice} EUR` : null;
          const savings    = (offer.price && offer.oldPrice)
            ? `-${(offer.oldPrice - offer.price).toFixed(2)} EUR` : null;
          const validUntil = offer.validityDates?.[0]?.to?.slice(0, 10) || null;
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

  // ── Maximarkt Leaflet-Scan (VOR Dedupe/Save) ───────────────────────────────
  if (activeMarkets.includes("maximarkt")) {
    try {
      const maximarktLeaflets = await fetchMaximarktLeaflets();
      console.log(`📰 ${maximarktLeaflets.length} aktive Maximarkt-Leaflets`);
      for (const leaflet of maximarktLeaflets) {
        const leafletDeals = await scanMaximarktLeaflet(leaflet, articles);
        allDeals.push(...leafletDeals);
      }
    } catch (e) {
      console.error(`⚠️  Maximarkt Leaflet-Fehler: ${e.message}`);
    }
  } else {
    console.log("\n⏭️  Maximarkt nicht aktiv – übersprungen.");
  }

  // ── Dedupe ────────────────────────────────────────────────────────────────
  const seenDeals   = new Set();
  const uniqueDeals = allDeals.filter(d => {
    const key = `${d.articleName}_${d.storeId}_${d.validUntil}`;
    if (seenDeals.has(key)) return false;
    seenDeals.add(key); return true;
  });

  // ── In Firebase speichern ────────────────────────────────────────────────
  if (uniqueDeals.length > 0) {
    const dealsObj = {};
    uniqueDeals.forEach((d, i) => { dealsObj[`deal_${Date.now()}_${i}`] = d; });
    await db.ref("deals").set(dealsObj);

    const top = uniqueDeals.slice(0, 3).map(d => `${d.articleName} bei ${d.storeName}`).join(", ");
    await db.ref("notifications").push({
      msg:  `🔥 ${uniqueDeals.length} Aktionen gefunden! ${top}`,
      from: "system", to: "all", id: Date.now(),
      time: new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }),
    });
    console.log(`\n💾 ${uniqueDeals.length} Deals gespeichert!`);
    const maxiCount = uniqueDeals.filter(d => d.storeId === "maximarkt").length;
    if (maxiCount > 0) console.log(`   davon Maximarkt: ${maxiCount}`);
  } else {
    await db.ref("deals").set(null);
    console.log("\n📭 Keine Aktionen gefunden.");
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${uniqueDeals.length} Deals`);
  console.log("═══════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fehler:", e.message); process.exit(1); });
