/**
 * My Wagerl – Aktions-Check via marktguru.at npm Paket
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import { search }              from "marktguru.at";
import puppeteer               from "puppeteer";
import { createRequire }       from "module";
import fs                      from "fs";
import path                    from "path";

const require    = createRequire(import.meta.url);
const pdfParse   = require("pdf-parse");
const sleep      = ms => new Promise(r => setTimeout(r, ms));

const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const ZIP_CODE         = "5204"; // Strasswalchen
const TMP_DIR          = "/tmp/familycart";

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

async function downloadMaximarktFlugblatt() {
  console.log("\n📥 Lade Maximarkt Flugblatt herunter...");
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36");
    await page.goto("https://www.maximarkt.at/angebote", { waitUntil: "networkidle2", timeout: 30000 });

    // Find first PDF link on the page
    const pdfUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const pdf = links.find(a => a.href.toLowerCase().endsWith(".pdf") || a.href.toLowerCase().includes(".pdf"));
      return pdf ? pdf.href : null;
    });

    if (!pdfUrl) {
      console.log("   ⚠️  Kein PDF-Link auf maximarkt.at/angebote gefunden.");
      return null;
    }
    console.log(`   🔗 PDF gefunden: ${pdfUrl}`);

    // Download PDF via fetch in Node
    const resp = await fetch(pdfUrl);
    if (!resp.ok) throw new Error(`PDF-Download fehlgeschlagen: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const pdfPath = path.join(TMP_DIR, "maximarkt.pdf");
    fs.writeFileSync(pdfPath, buffer);
    console.log(`   ✅ PDF gespeichert: ${pdfPath} (${Math.round(buffer.length/1024)} KB)`);
    return pdfPath;
  } finally {
    await browser.close();
  }
}

async function processMaximarktPDF(pdfPath, articles) {
  if (!GEMINI_API_KEY) {
    console.log("   ⚠️  GEMINI_API_KEY nicht gesetzt – Maximarkt PDF wird übersprungen.");
    return;
  }

  console.log("\n🤖 Analysiere Maximarkt PDF mit Gemini...");
  const pdfBuffer = fs.readFileSync(pdfPath);
  const parsed    = await pdfParse(pdfBuffer);
  const fullText  = parsed.text || "";
  console.log(`   📄 Extrahierter Text: ${fullText.length} Zeichen`);

  if (!fullText.trim()) {
    console.log("   ⚠️  PDF enthält keinen lesbaren Text (Bild-PDF).");
    return;
  }

  const itemList   = articles.map(a => a.name).slice(0, 60).join(", ");
  const chunkSize  = 3000;
  const chunks     = [];
  for (let i = 0; i < fullText.length; i += chunkSize) chunks.push(fullText.slice(i, i + chunkSize));
  console.log(`   📦 ${chunks.length} Chunk(s) à max ${chunkSize} Zeichen`);

  const allDeals  = [];
  const checkedAt = new Date().toISOString();

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    console.log(`   🔍 Chunk ${ci + 1}/${chunks.length}...`);
    const prompt = `Maximarkt Flugblatt-Text:\n${chunk}\n\nGesuchte Artikel: ${itemList}\n\nWelche Artikel sind im Flugblatt mit Preis/Rabatt? Antworte NUR mit JSON:\n{"deals":[{"articleName":"Name","price":"1,99 EUR","savings":"-20%","validUntil":"20.04.2026"}]}\nKeine Treffer: {"deals":[]}`;

    try {
      const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1000 },
        }),
      });

      if (res.status === 429) {
        console.log("   ⏳ Rate limit – warte 30 Sekunden...");
        await sleep(30000);
        ci--; continue; // retry same chunk
      }

      const data    = await res.json();
      const rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      const m       = rawText.match(/\{[\s\S]*\}/);
      if (m) {
        const result = JSON.parse(m[0]);
        const found  = result.deals || [];
        found.forEach(d => {
          if (d.articleName) {
            allDeals.push({ ...d, storeName: "Maximarkt", storeId: "maximarkt", checkedAt });
            console.log(`      ✅ ${d.articleName} – ${d.price || "?"}`);
          }
        });
      }
    } catch (e) {
      console.error(`   ⚠️  Chunk ${ci + 1} Fehler: ${e.message}`);
    }

    if (ci < chunks.length - 1) await sleep(5000);
  }

  // Deduplicate by articleName
  const seen      = new Set();
  const unique    = allDeals.filter(d => !seen.has(d.articleName) && seen.add(d.articleName));

  // Remove old Maximarkt deals and write new ones
  const dealsSnap = await db.ref("deals").get();
  const existing  = dealsSnap.val() || {};
  const oldKeys   = Object.entries(existing).filter(([, v]) => v.storeName === "Maximarkt").map(([k]) => k);
  await Promise.all(oldKeys.map(k => db.ref(`deals/${k}`).remove()));

  if (unique.length > 0) {
    await Promise.all(unique.map(d => db.ref("deals").push(d)));
    console.log(`\n💾 ${unique.length} Maximarkt-Deals gespeichert!`);
  } else {
    console.log("   📭 Keine Maximarkt-Angebote für eure Artikel gefunden.");
  }
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

  // Maximarkt PDF processing
  try {
    const pdfPath = await downloadMaximarktFlugblatt();
    if (pdfPath) await processMaximarktPDF(pdfPath, articles);
  } catch (e) {
    console.error(`⚠️  Maximarkt PDF Fehler: ${e.message}`);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${uniqueDeals.length} Deals aus marktguru.at`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch(e => { console.error("❌ Fehler:", e.message); process.exit(1); });
