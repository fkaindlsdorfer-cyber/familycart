/**
 * My Wagerl – Aktions-Check via marktguru.at
 *
 * Märkte via search() + Maximarkt via Leaflet-Scan (marktguru Prospekte)
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import { search }              from "marktguru.at";
import { matchesArticleName }  from "./lib/match.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const GEMINI_API_KEY          = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_PRIMARY    = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_MODEL_FALLBACK   = 'gemini-2.5-flash-lite';
let   currentModel            = GEMINI_MODEL_PRIMARY;
const ZIP_CODE                = "5204"; // Strasswalchen

const SKIP_OUTDOOR_LEAFLETS = true; // "Outdoor"-Prospekte überspringen
const DEBUG_MAXIMARKT = process.env.DEBUG_MAXIMARKT === "1";

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

  const active = (data.results || [])
    .filter(r => {
      const pageCount  = r.pageImages?.count ?? r.pageCount ?? 1;
      const offerCount = r.offerCount ?? r.offers?.count ?? 0;
      if (offerCount === 0 && pageCount >= 8) {
        const id = r.mainLeafletId || r.id;
        console.log(`   ⏭️  ID ${id} übersprungen (Outdoor-Prospekt: ${pageCount} Seiten, 0 offers)`);
        return false;
      }
      if (pageCount === 1) {
        const id = r.mainLeafletId || r.id;
        console.log(`   ⏭️  ID ${id} übersprungen (Restaurant-Karte: 1 Seite)`);
        return false;
      }
      return true;
    })
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

// ── Gemini API-Call mit Retry + Fehlerklassifizierung ────────────────────────
async function callGeminiWithRetry(base64, prompt, maxRetries = 3) {
  const PERMANENT_ERRORS = [400, 401, 403, 404];
  const TEMPORARY_ERRORS = [429, 500, 502, 503, 504];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const generationConfig = {
      temperature:      0,
      maxOutputTokens:  8192,
      responseMimeType: "application/json",
      thinkingConfig:   { thinkingBudget: 0 },
    };
    if (DEBUG_MAXIMARKT && attempt === 0) {
      console.log(`[DBG] model: ${currentModel}`);
      console.log(`[DBG] config: ${JSON.stringify(generationConfig)}`);
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64 } },
            { text: prompt },
          ]}],
          generationConfig,
        }),
      }
    );
    const data = await res.json();
    if (DEBUG_MAXIMARKT) {
      console.log(`[DBG] HTTP status: ${res.status}`);
      console.log(`[DBG] raw JSON:\n${JSON.stringify(data, null, 2)}`);
      console.log(`[DBG] candidates count: ${data?.candidates?.length}`);
      console.log(`[DBG] finishReason: ${data?.candidates?.[0]?.finishReason}`);
      console.log(`[DBG] safetyRatings: ${JSON.stringify(data?.candidates?.[0]?.safetyRatings)}`);
      console.log(`[DBG] usageMetadata: ${JSON.stringify(data?.usageMetadata)}`);
    }

    if (!data.error) return data;

    const code = data.error.code;

    if (PERMANENT_ERRORS.includes(code)) {
      throw new Error(`Gemini API error ${code}: ${data.error.message}`);
    }

    if (TEMPORARY_ERRORS.includes(code) && attempt < maxRetries) {
      const baseDelay = Math.min(60000, Math.pow(2, attempt + 1) * 1000);
      const jitter    = Math.floor(Math.random() * 1000);
      const delay     = baseDelay + jitter;
      process.stdout.write(`⏳ ${code}, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s... `);
      await sleep(delay);
      continue;
    }

    console.log(`\n   ⚠️  Seite nach ${maxRetries} Retries übersprungen (${code})`);
    return null;
  }
  return null;
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
  const itemList    = articles.map(a => a.name).slice(0, 60).join(", ");
  const checkedAt   = new Date().toISOString();
  const deals       = [];
  let   skippedPages = 0;
  const totalPages  = leaflet.pageCount;

  for (let page = 0; page < totalPages; page++) {
    const imageUrl = `https://mgat.b-cdn.net/api/v1/leaflets/${leaflet.id}/images/pages/${page}/xlarge.webp`;
    if (page === 0) console.log(`   Image URL: ${imageUrl}`);
    process.stdout.write(`   📄 Seite ${page + 1}/${totalPages}... `);

    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.log(`⚠️  Bild nicht erreichbar (${imgRes.status})`);
        await sleep(4000); continue;
      }
      const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
      if (DEBUG_MAXIMARKT) {
        console.log(`[DBG] image MIME: image/jpeg`);
        console.log(`[DBG] image base64 length: ${base64.length}`);
        console.log(`[DBG] base64 prefix: ${base64.substring(0, 50)}`);
      }

      const prompt =
        `Das ist Seite ${page + 1} aus dem Maximarkt Prospekt "${leaflet.name}" (gültig bis ${leaflet.validTo}).

Gesuchte Artikel: ${itemList}

Welche dieser Artikel sind auf dieser Seite mit Preis oder Rabatt zu sehen?

WICHTIGE REGELN:
1. "1+1 GRATIS" / "2+1 GRATIS": Berechne effektiven Stückpreis als price.
   Beispiel: Statt-Preis 1,99 EUR, "1+1 GRATIS" → price:"1,00 EUR", oldPrice:"1,99 EUR", savings:"1+1 GRATIS"
2. "AB 2 STÜCK/PACKUNGEN/FLASCHEN": price = reduzierter Stückpreis, oldPrice = Normalpreis.
   Beispiel: "STATT 14,99 / AB 2 FL. JE 11,99" → price:"11,99 EUR", oldPrice:"14,99 EUR", savings:"ab 2 Flaschen"
3. "STATT X / NUR Y": price:Y, oldPrice:X.
4. KRITISCH: Wenn price === oldPrice und keine echte Reduktion erkennbar → diesen Eintrag NICHT zurückgeben.
5. productName: vollständiger Produktname inkl. Marke und Variante (z.B. "Monini Olivenöl Classico 750 ml", nicht "Olivenöl").
6. boundingBox: [ymin, xmin, ymax, xmax] mit normalisierten Koordinaten 0–1000.
   Die Box muss den kompletten Aktions-Bereich umschließen: Produktbild + Preis-Block + Aktions-Hinweis.
   Format ist EXAKT so: [ymin, xmin, ymax, xmax] (Reihenfolge beachten!).

WICHTIG: Falls dieses Bild eine RESTAURANT-SPEISEKARTE zeigt (Tagesmenü, Tagessuppe, Wiener Schnitzel, Hauptspeise, Beilagen usw. — Einzelgerichte für den Restaurant-Verzehr, KEINE verpackten Supermarktprodukte), gib {"deals":[]} zurück.

Antworte NUR mit JSON – keine weiteren Texte:
{"deals":[{"productName":"Vollständiger Produktname inkl. Marke und Variante","price":"1,99 EUR","savings":"-20%","oldPrice":"2,49 EUR","boundingBox":[100,50,400,950]}]}
Keine Treffer: {"deals":[]}`;

      if (DEBUG_MAXIMARKT) {
        console.log(`[DBG] prompt length: ${prompt.length}`);
      }
      const data = await callGeminiWithRetry(base64, prompt);

      if (data === null) {
        skippedPages++;
        await sleep(4000); continue;
      }

      const finishReason = data.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.log(`⚠️  Antwort abgeschnitten (MAX_TOKENS)`);
        skippedPages++;
        await sleep(4000); continue;
      }

      const rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      console.log(`[DBG] leaflet=${leaflet.id} page=${page} finishReason=${finishReason} responseText=|${rawText.slice(0, 500)}| length=${rawText.length}`);
      const jsonM = rawText.match(/\{[\s\S]*\}/);

      if (jsonM) {
        const found = (JSON.parse(jsonM[0]).deals || []).filter(d => d.productName || d.articleName);
        if (found.length > 0) {
          let hitCount = 0;
          found.forEach(d => {
            const productName = d.productName || d.articleName;
            if (!productName) return;

            const matchedArticle = articles.find(a => matchesArticleName(a.name, productName));
            if (!matchedArticle) {
              console.log(`      ⏭️  "${productName}" konnte keinem Listen-Artikel zugeordnet werden`);
              return;
            }

            let boundingBox = null;
            if (Array.isArray(d.boundingBox) && d.boundingBox.length === 4
                && d.boundingBox.every(n => typeof n === "number" && n >= 0 && n <= 1000)) {
              const [ymin, xmin, ymax, xmax] = d.boundingBox;
              if (ymin < ymax && xmin < xmax) boundingBox = d.boundingBox;
            }

            console.log(`      ✅ ${productName} → "${matchedArticle.name}" – ${d.price || "?"}`);
            hitCount++;
            deals.push({
              articleName:  matchedArticle.name,
              productName,
              storeId:      "maximarkt",
              storeName:    "Maximarkt",
              title:        productName,
              price:        d.price    || null,
              oldPrice:     d.oldPrice || null,
              savings:      d.savings  || null,
              validUntil:   leaflet.validTo,
              source:       "marktguru.at leaflet scan",
              leafletId:    leaflet.id,
              leafletTitle: leaflet.name,
              pageIndex:    page,
              boundingBox,
              checkedAt,
            });
          });
          if (!hitCount) console.log("–");
        } else {
          console.log("–");
        }
      } else {
        console.log("–");
      }
    } catch (e) {
      console.log(`[ERR] leaflet=${leaflet.id} page=${page} error=${e.message} stack=${e.stack?.split('\n')[0]}`);
      if (e.message.startsWith("Gemini API error")) throw e;
    }

    await sleep(4000);
    if (DEBUG_MAXIMARKT) { console.log(`[DBG] DEBUG_MAXIMARKT: early exit after page 0`); break; }
  }

  if (skippedPages > totalPages / 2 && currentModel === GEMINI_MODEL_PRIMARY) {
    console.log(`⚠️  ${skippedPages}/${totalPages} Seiten übersprungen — Fallback auf ${GEMINI_MODEL_FALLBACK} für Rest des Runs`);
    currentModel = GEMINI_MODEL_FALLBACK;
  }

  console.log(`   → ${deals.length} Deals aus "${leaflet.name}" (${skippedPages} Seiten übersprungen)\n`);
  return deals;
}

// ── Deal-Validierung ─────────────────────────────────────────────────────────
function isValidDeal(d) {
  if (!d.articleName || !d.price) return false;
  const p  = parseFloat(String(d.price   ).replace(",", ".").replace(/[^\d.]/g, ""));
  const op = d.oldPrice ? parseFloat(String(d.oldPrice).replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  if (!isFinite(p) || p <= 0) return false;
  if (isFinite(op) && Math.abs(op - p) < 0.01 && !d.savings) return false;
  return true;
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
          const storeName = offer.advertisers?.[0]?.name || "Unbekannt";
          const storeId   = normalizeStore(storeName);
          if (!activeMarkets.includes(storeId)) continue;

          const productName = [offer.brand?.name, offer.product?.name]
            .filter(Boolean).join(" ").trim() || article.name;

          if (!matchesArticleName(article.name, productName)) {
            console.log(`      ⏭️  verworfen (kein Wort-Boundary-Match): "${productName}"`);
            continue;
          }

          const price      = offer.price    ? `${offer.price} EUR`    : null;
          const oldPrice   = offer.oldPrice ? `${offer.oldPrice} EUR` : null;
          const savings    = (offer.price && offer.oldPrice)
            ? `-${(offer.oldPrice - offer.price).toFixed(2)} EUR` : null;
          const validUntil = offer.validityDates?.[0]?.to?.slice(0, 10) || null;
          const imageUrl   = offer.images?.urls?.large || null;
          const offerUrl   = offer.externalUrl || null;

          console.log(`      🏪 ${storeName}: ${productName} – ${price || "?"}`);
          allDeals.push({
            articleName: article.name,
            productName,
            storeId, storeName,
            title:      offer.description || article.name,
            price, oldPrice, savings, validUntil,
            imageUrl, offerUrl,
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

  // ── Validierung ──────────────────────────────────────────────────────────
  const before     = uniqueDeals.length;
  const validDeals = uniqueDeals.filter(isValidDeal);
  const dropped    = before - validDeals.length;
  if (dropped > 0) console.log(`🚮 ${dropped} Fehlextraktionen verworfen (price === oldPrice oder kein Preis)`);

  // ── In Firebase speichern ────────────────────────────────────────────────
  if (validDeals.length > 0) {
    const dealsObj = {};
    validDeals.forEach((d, i) => { dealsObj[`deal_${Date.now()}_${i}`] = d; });
    await db.ref("deals").set(dealsObj);

    const top = validDeals.slice(0, 3).map(d => `${d.articleName} bei ${d.storeName}`).join(", ");
    await db.ref("notifications").push({
      msg:  `🔥 ${validDeals.length} Aktionen gefunden! ${top}`,
      from: "system", to: "all", id: Date.now(),
      time: new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }),
    });
    console.log(`\n💾 ${validDeals.length} Deals gespeichert!`);
    const maxiCount = validDeals.filter(d => d.storeId === "maximarkt").length;
    if (maxiCount > 0) console.log(`   davon Maximarkt: ${maxiCount}`);
  } else {
    await db.ref("deals").set(null);
    console.log("\n📭 Keine Aktionen gefunden.");
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${validDeals.length} Deals`);
  console.log("═══════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fehler:", e.message); process.exit(1); });
