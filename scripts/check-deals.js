/**
 * FamilyCart – Automatischer Flugblatt-Check v3
 * 
 * Ablauf:
 * 1. Puppeteer öffnet die Flugblatt-Seite jedes Marktes
 * 2. Findet ALLE aktuellen PDF-Links automatisch
 * 3. Lädt alle PDFs herunter (auch mehrere pro Markt)
 * 4. Gemini liest jede Seite als Bild
 * 5. Sucht nach euren Artikeln
 * 6. Speichert Ergebnisse in Firebase
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase }         from "firebase-admin/database";
import fetch                   from "node-fetch";
import puppeteer               from "puppeteer";
import { execSync }            from "child_process";
import fs                      from "fs";
import path                    from "path";

// ─── Konfiguration ──────────────────────────────────────────────────────────
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const FIREBASE_DB_URL  = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const TMP_DIR          = "/tmp/familycart";

// ─── Märkte & ihre Flugblatt-Seiten ─────────────────────────────────────────
// Region: Oberösterreich (Strasswalchen/Salzburg)
// Jeder Markt hat eine eigene URL zur regionalen Flugblatt-Seite.
// Puppeteer öffnet diese Seite, findet ALLE aktuellen PDF-Links
// und lädt sie alle herunter. Gemini liest dann jede Seite einzeln.
const MARKETS = [
  {
    storeId:   "spar",
    storeName: "SPAR",
    // SPAR OÖ – Hauptflugblatt + SPAR Premium + Monatssparer + Sonderfolder
    url: "https://www.spar.at/aktionen/oberoesterreich",
    note: "Mehrere Flugblätter: Hauptflugblatt, SPAR Premium, Monatssparer, Obst&Gemüse",
  },
  {
    storeId:   "eurospar",
    storeName: "EUROSPAR",
    // EUROSPAR OÖ – eigene Flugblatt-Seite
    url: "https://www.spar.at/aktionen/oberoesterreich/eurospar",
    note: "EUROSPAR OÖ Flugblatt – oft ident mit SPAR",
  },
  {
    storeId:   "maximarkt",
    storeName: "Maximarkt",
    // Maximarkt – eigene Website
    url: "https://www.maximarkt.at/angebote/aktuelles_flugblatt",
    note: "Maximarkt Angebote & Flugblätter",
  },
  {
    storeId:   "hofer",
    storeName: "Hofer",
    // Hofer – Angebote-Seite (2 aktive Flugblätter gleichzeitig)
    url: "https://www.hofer.at/de/angebote/aktuelle-flugblaetter-und-broschuren.html",
    note: "Hofer hat oft 2 Flugblätter gleichzeitig (aktuell + ab nächste Woche)",
  },
  {
    storeId:   "billa",
    storeName: "BILLA",
    // BILLA – zentrales Flugblatt (OÖ/Tirol Region)
    url: "https://www.billa.at/unsere-aktionen/flugblatt",
    note: "BILLA Flugblatt – hat regionale Versionen (OÖ/Tirol wird automatisch erkannt)",
  },
  {
    storeId:   "billaplus",
    storeName: "BILLA PLUS",
    // BILLA PLUS – eigene Flugblatt-Seite (OÖ Region)
    url: "https://www.billa.at/vorschau-billa-plus-flugblatt",
    note: "BILLA PLUS OÖ – hat eigenes regionales Flugblatt",
  },
];

// SPAR Gruppe – gleiche Aktionen
const STORE_GROUPS = [
  { ids: ["spar", "eurospar", "maximarkt"], name: "SPAR Gruppe" },
];

// ─── Firebase Init ───────────────────────────────────────────────────────────
initializeApp({ credential: cert(FIREBASE_SERVICE), databaseURL: FIREBASE_DB_URL });
const db = getDatabase();

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function getSearchStoreIds(storeId) {
  if (!storeId) return null;
  const group = STORE_GROUPS.find(g => g.ids.includes(storeId));
  return group ? group.ids : [storeId];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pdfToImages(pdfPath, outputDir) {
  const name = path.basename(pdfPath, ".pdf").replace(/[^a-zA-Z0-9]/g, "_");
  ensureDir(outputDir);
  try {
    execSync(`pdftoppm -jpeg -r 120 "${pdfPath}" "${path.join(outputDir, name)}"`, { stdio: "pipe" });
    return fs.readdirSync(outputDir)
      .filter(f => f.startsWith(name) && f.endsWith(".jpg"))
      .sort()
      .map(f => path.join(outputDir, f));
  } catch (e) {
    console.error(`    ⚠️  PDF→Bilder Fehler: ${e.message}`);
    return [];
  }
}

function fileToBase64(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

// ─── PDF-Links via Puppeteer finden ──────────────────────────────────────────
async function findPdfLinks(browser, market) {
  console.log(`\n  🌐 Öffne: ${market.url}`);
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
  
  try {
    await page.goto(market.url, { waitUntil: "networkidle2", timeout: 30000 });
    // Kurz warten damit JavaScript geladen ist
    await new Promise(r => setTimeout(r, 3000));

    // Alle Links auf der Seite suchen
    const allLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll("a").forEach(a => {
        const href = a.href || "";
        const text = a.textContent?.trim() || "";
        if (href) links.push({ href, text });
      });
      return links;
    });

    // PDF-Links filtern
    const pdfLinks = allLinks.filter(l => {
      const href = l.href.toLowerCase();
      const text = l.text.toLowerCase();
      return href.includes(".pdf") || 
             text.includes("pdf") || 
             text.includes("herunterladen") ||
             text.includes("download") ||
             href.includes("download");
    });

    // Duplikate entfernen
    const unique = [...new Map(pdfLinks.map(l => [l.href, l])).values()];
    console.log(`  📄 ${unique.length} PDF-Link(s) gefunden`);
    unique.forEach(l => console.log(`    → ${l.text.slice(0,50)} | ${l.href.slice(0,80)}`));
    
    await page.close();
    return unique.map(l => l.href);
  } catch (e) {
    console.error(`  ⚠️  Seite konnte nicht geladen werden: ${e.message}`);
    await page.close();
    return [];
  }
}

// ─── PDF herunterladen ────────────────────────────────────────────────────────
async function downloadPdf(url, destPath) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
    timeout: 30000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("pdf") && !url.toLowerCase().includes(".pdf")) {
    throw new Error("Keine PDF-Datei");
  }
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
  const kb = Math.round(buffer.byteLength / 1024);
  console.log(`    ✅ Heruntergeladen (${kb} KB)`);
  return destPath;
}

// ─── Gemini: Seite analysieren ────────────────────────────────────────────────
async function analyzePageWithGemini(imageBase64, articles, storeName) {
  const articleList = articles.map(a => `- ${a.name}`).join("\n");
  const prompt = `Das ist eine Seite aus dem aktuellen Flugblatt von ${storeName} Österreich.

Suche nach Aktionen für DIESE Artikel (nur diese, nichts anderes):
${articleList}

Antworte NUR mit JSON:
{"found":true,"deals":[{"articleName":"Name aus Liste","title":"Produktname im Flugblatt","price":"1,99 EUR","savings":"-20% oder -1,50 EUR","validUntil":"22.04."}]}
Wenn nichts gefunden: {"found":false,"deals":[]}
Nur echte Angebote die du auf dieser Seite siehst!`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
              { text: prompt }
            ]
          }],
          generationConfig: { responseMimeType: "text/plain" },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text||"").join("");
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { found: false, deals: [] };
  } catch (e) {
    console.error(`    ⚠️  Gemini Fehler: ${e.message}`);
    return { found: false, deals: [] };
  }
}

// ─── Hauptprogramm ────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("🛒 FamilyCart – Vollautomatischer Flugblatt-Check");
  console.log(`📅 ${new Date().toLocaleString("de-AT")}`);
  console.log("═══════════════════════════════════════════════════\n");

  ensureDir(TMP_DIR);

  // 1. Märkte aus Firebase laden (falls angepasst)
  const storesSnap = await db.ref("stores").get();
  const fbStores   = Object.values(storesSnap.val() || {});

  // 2. Artikel aus Firebase laden
  const articlesSnap = await db.ref("articles").get();
  const articles     = Object.entries(articlesSnap.val() || {})
    .map(([key, val]) => ({ ...val, fbKey: key }));

  if (articles.length === 0) {
    console.log("⚠️  Keine Artikel in der Datenbank – nichts zu tun.");
    process.exit(0);
  }
  console.log(`📦 ${articles.length} Artikel geladen\n`);

  // 3. Alte Deals löschen
  await db.ref("deals").remove();

  // 4. Puppeteer starten
  console.log("🚀 Browser wird gestartet...\n");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const allDeals  = [];
  const checkedAt = new Date().toISOString();
  const processedUrls = new Set(); // Duplikate vermeiden

  // 5. Für jeden Markt
  for (const market of MARKETS) {
    console.log(`\n${"═".repeat(50)}`);
    console.log(`🏪 ${market.storeName}`);
    console.log("═".repeat(50));

    // Relevante Artikel für diesen Markt
    const relevantArticles = articles.filter(a => {
      if (!a.storeId) return true;
      const searchIds = getSearchStoreIds(a.storeId);
      return searchIds ? searchIds.includes(market.storeId) : false;
    });

    if (relevantArticles.length === 0) {
      console.log("  ─ Keine Artikel für diesen Markt");
      continue;
    }
    console.log(`  📋 ${relevantArticles.length} relevante Artikel:`, relevantArticles.map(a=>a.name).join(", "));

    // PDF-Links finden
    const pdfLinks = await findPdfLinks(browser, market);
    if (pdfLinks.length === 0) {
      console.log("  📭 Keine PDFs gefunden");
      continue;
    }

    // Jeden PDF-Link verarbeiten
    for (let pi = 0; pi < pdfLinks.length; pi++) {
      const pdfUrl = pdfLinks[pi];
      if (processedUrls.has(pdfUrl)) { console.log(`  ⏭️  Bereits verarbeitet`); continue; }
      processedUrls.add(pdfUrl);

      console.log(`\n  📥 PDF ${pi+1}/${pdfLinks.length}: ${pdfUrl.slice(0,70)}...`);
      
      const pdfName = `${market.storeId}_${pi+1}_${Date.now()}.pdf`;
      const pdfPath = path.join(TMP_DIR, pdfName);
      const imgDir  = path.join(TMP_DIR, `img_${market.storeId}_${pi}`);

      try {
        await downloadPdf(pdfUrl, pdfPath);
      } catch (e) {
        console.error(`  ❌ Download fehlgeschlagen: ${e.message}`);
        continue;
      }

      // PDF zu Bilder
      const images = pdfToImages(pdfPath, imgDir);
      if (images.length === 0) { console.error("  ❌ Keine Bilder erzeugt"); continue; }
      console.log(`  🖼️  ${images.length} Seite(n) werden analysiert...`);

      // Jede Seite analysieren
      let dealsThisPdf = 0;
      for (let i = 0; i < images.length; i++) {
        process.stdout.write(`  📄 Seite ${i+1}/${images.length}... `);
        const base64 = fileToBase64(images[i]);
        const result = await analyzePageWithGemini(base64, relevantArticles, market.storeName);

        if (result.found && result.deals?.length > 0) {
          result.deals.forEach(deal => {
            allDeals.push({
              articleName: deal.articleName,
              articleId:   articles.find(a => a.name.toLowerCase()===deal.articleName?.toLowerCase())?.fbKey||"",
              storeId:     market.storeId,
              storeName:   market.storeName,
              title:       deal.title || deal.articleName,
              price:       deal.price || null,
              savings:     deal.savings || null,
              validUntil:  deal.validUntil || null,
              source:      pdfUrl,
              checkedAt,
            });
          });
          dealsThisPdf += result.deals.length;
          console.log(`✅ ${result.deals.length} Deal(s): ${result.deals.map(d=>d.articleName).join(", ")}`);
        } else {
          console.log("─");
        }

        // Pause zwischen Gemini-Anfragen
        await new Promise(r => setTimeout(r, 600));
        // Bild löschen um Speicher zu sparen
        try { fs.unlinkSync(images[i]); } catch {}
      }

      console.log(`  📊 ${dealsThisPdf} Deals in diesem PDF`);
      // PDF löschen
      try { fs.unlinkSync(pdfPath); } catch {}
      try { fs.rmdirSync(imgDir); } catch {}
    }
  }

  await browser.close();
  console.log("\n🔒 Browser geschlossen");

  // 6. Duplikate entfernen & speichern
  const seen    = new Set();
  const unique  = allDeals.filter(d => {
    const key = `${d.articleName}_${d.storeId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  if (unique.length > 0) {
    const dealsObj = {};
    unique.forEach((d, i) => { dealsObj[`deal_${Date.now()}_${i}`] = d; });
    await db.ref("deals").set(dealsObj);
    console.log(`\n💾 ${unique.length} Deals gespeichert`);
  }

  // 7. Meta + Benachrichtigung
  await db.ref("dealMeta").set({
    lastCheck:       checkedAt,
    dealsFound:      unique.length,
    articlesChecked: articles.length,
    marketsChecked:  MARKETS.length,
    status:          "OK",
    nextCheck:       new Date().getDay() < 4 ? "Donnerstag 07:00" : "Montag 07:00",
  });

  if (unique.length > 0) {
    const top = unique.slice(0,3).map(d=>`${d.articleName} bei ${d.storeName}`).join(", ");
    await db.ref("notifications").push({
      msg:  `🔥 ${unique.length} Aktionen gefunden! ${top}`,
      to:   "all", from:"system", id:Date.now(),
      time: new Date().toLocaleTimeString("de-AT",{hour:"2-digit",minute:"2-digit"}),
      type: "deals",
    });
  }

  // Aufräumen
  try { fs.rmSync(TMP_DIR, { recursive:true, force:true }); } catch {}

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅ Fertig! ${unique.length} Deals aus ${processedUrls.size} Flugblättern`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch(e => { console.error("❌ Fehler:", e); process.exit(1); });
