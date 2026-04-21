/**
 * Maximarkt API Diagnostic — Phase 4
 *
 * PART A: Test /api/v1/leaflets/{id} metadata endpoint with all `as=` variants.
 * PART B: Structured HTML scraping of /rp/maximarkt-prospekte with per-leaflet metadata.
 * PART C: HTML content analysis — are active leaflets server-rendered or JS-loaded?
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE  = "https://api.marktguru.at/api/v1";

const PROBE_ID = 73885; // Real ID from Phase 2 scraping — used for Part A

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getApiKeys() {
  const res = await fetch("https://marktguru.at", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  const html = await res.text();
  const regex = /<script\s+type="application\/json">([\s\S]*?)<\/script>/gm;
  let configStr = "";
  let m;
  while ((m = regex.exec(html)) !== null) configStr = m[1];
  if (!configStr) throw new Error("Kein config JSON auf marktguru.at");
  const parsed = JSON.parse(configStr);
  if (!parsed?.config?.apiKey) throw new Error("config.apiKey fehlt");
  console.log(`🔑 Keys: apiKey=${parsed.config.apiKey.slice(0,8)}… clientKey=${parsed.config.clientKey?.slice(0,8)}…\n`);
  return { apiKey: parsed.config.apiKey, clientKey: parsed.config.clientKey };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function assignYear(dayMonth) {
  // dayMonth = "DD.MM." → pick current or next year so the date is not in the past
  const [d, mo] = dayMonth.replace(/\./g, "").split("").reduce((a, c, i) =>
    i < 2 ? [a[0] + c, a[1]] : [a[0], a[1] + c], ["", ""]);
  const day = parseInt(dayMonth.slice(0,2), 10);
  const mon = parseInt(dayMonth.slice(3,5), 10);
  const now = new Date();
  const guess = new Date(now.getFullYear(), mon - 1, day);
  if (guess < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)) {
    guess.setFullYear(now.getFullYear() + 1);
  }
  return guess.toISOString().slice(0, 10);
}

function parseDateRange(text) {
  // Matches: "17.04.–22.04." or "17.04. – 22.04." or "17.04.-22.04."
  const m = text.match(/(\d{2}\.\d{2}\.)\s*[–-]\s*(\d{2}\.\d{2}\.)/);
  if (!m) return { validFrom: null, validTo: null };
  return { validFrom: assignYear(m[1]), validTo: assignYear(m[2]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A — Leaflet metadata endpoint
// ─────────────────────────────────────────────────────────────────────────────
async function partA(h) {
  console.log("═══════════════════════════════════════════════════════");
  console.log(`TEIL A — /api/v1/leaflets/${PROBE_ID} Metadata-Endpoints`);
  console.log("═══════════════════════════════════════════════════════\n");

  const variants = [
    ["A1", `${BASE}/leaflets/${PROBE_ID}`],
    ["A2", `${BASE}/leaflets/${PROBE_ID}?as=mobile`],
    ["A3", `${BASE}/leaflets/${PROBE_ID}?as=mobiledetailed`],
    ["A4", `${BASE}/leaflets/${PROBE_ID}?as=web`],
  ];

  const usableFields = ["pageCount", "validFrom", "validTo", "title",
                        "retailerId", "retailerName", "pages"];
  let bestVariant = null;

  for (const [label, url] of variants) {
    console.log(`[${label}] GET ${url}`);
    try {
      const res = await fetch(url, { headers: h });
      const text = await res.text();
      console.log(`   Status: ${res.status}`);
      if (res.ok) {
        const data = JSON.parse(text);
        console.log(`   FULL RESPONSE:\n${JSON.stringify(data, null, 2)}`);
        const found = usableFields.filter(f => f in data || f in (data?.leaflet ?? {}));
        if (found.length > 0) {
          console.log(`   ✅ Nützliche Felder: ${found.join(", ")}`);
          if (!bestVariant) bestVariant = { label, url, fields: found, data };
        }
      } else {
        console.log(`   Body: ${text.slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
    }
    console.log("");
    await sleep(400);
  }

  if (bestVariant) {
    console.log(`✅ Bester Metadata-Endpoint: [${bestVariant.label}]`);
    console.log(`   Nutzbare Felder: ${bestVariant.fields.join(", ")}`);
  } else {
    console.log("⚠️  Kein Metadata-Endpoint lieferte nützliche Felder.");
  }
  return bestVariant;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART B — Structured HTML scraping
// ─────────────────────────────────────────────────────────────────────────────
async function partB() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("TEIL B — Structured HTML scraping /rp/maximarkt-prospekte");
  console.log("═══════════════════════════════════════════════════════\n");

  const res = await fetch("https://www.marktguru.at/rp/maximarkt-prospekte", {
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "de-AT,de;q=0.9",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
  });
  const html = await res.text();
  console.log(`HTTP ${res.status}  HTML-Länge: ${html.length} Zeichen\n`);

  // ── Strategy 1: __NEXT_DATA__ structured JSON ────────────────────────────
  const leaflets = [];
  const nextDataMatch = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );

  if (nextDataMatch) {
    console.log("📦 __NEXT_DATA__ gefunden – versuche strukturierte Extraktion...");
    const nd = JSON.parse(nextDataMatch[1]);
    // Dump top-level keys to understand structure
    const topKeys = Object.keys(nd?.props?.pageProps ?? {});
    console.log(`   pageProps keys: ${topKeys.join(", ")}`);

    // Walk the tree looking for arrays that look like leaflets
    const findLeaflets = (obj, depth = 0) => {
      if (depth > 6 || !obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        if (obj.length > 0 && obj[0]?.id && (obj[0]?.pageCount !== undefined || obj[0]?.validFrom)) {
          obj.forEach(l => {
            if (l.id && String(l.id).length >= 5) {
              leaflets.push({
                leafletId:  String(l.id),
                title:      l.title ?? l.name ?? l.description ?? null,
                pageCount:  l.pageCount ?? l.pages ?? null,
                validFrom:  l.validFrom?.slice(0,10) ?? null,
                validTo:    l.validTo?.slice(0,10) ?? null,
                retailerId: l.retailer?.id ?? l.retailerId ?? null,
                retailerName: l.retailer?.name ?? l.retailerName ?? null,
              });
            }
          });
          return;
        }
        obj.forEach(item => findLeaflets(item, depth + 1));
      } else {
        Object.values(obj).forEach(v => findLeaflets(v, depth + 1));
      }
    };
    findLeaflets(nd?.props?.pageProps);

    if (leaflets.length > 0) {
      console.log(`   ✅ ${leaflets.length} Leaflets aus __NEXT_DATA__ extrahiert`);
    } else {
      // Dump full pageProps (truncated) to understand structure
      console.log("   ℹ️  Keine Leaflets auto-erkannt. pageProps (first 3000):");
      console.log(JSON.stringify(nd?.props?.pageProps, null, 2).slice(0, 3000));
    }
  } else {
    console.log("⚠️  Kein __NEXT_DATA__ gefunden – falle auf HTML-Regex zurück\n");
  }

  // ── Strategy 2: HTML regex fallback ─────────────────────────────────────
  if (leaflets.length === 0) {
    console.log("🔍 HTML-Regex-Fallback...");

    // Find all leaflet IDs from links like /leaflets/{id}/page/ or /leaflets/{id}/index or /leaflets/{id}"
    const idRe = /\/leaflets\/(\d{5,8})(?:\/|")/g;
    const idSet = new Set();
    let idm;
    while ((idm = idRe.exec(html)) !== null) {
      const id = idm[1];
      if (id !== "12776") idSet.add(id); // exclude retailer ID
    }
    console.log(`   Gefundene Leaflet-IDs (${idSet.size}): ${[...idSet].join(", ")}`);

    // For each ID, try to find its surrounding card in the HTML
    for (const lid of idSet) {
      // Find position of this ID in HTML, look ±1500 chars around it for metadata
      const pos = html.indexOf(`/leaflets/${lid}/`);
      if (pos === -1) continue;
      const chunk = html.slice(Math.max(0, pos - 800), pos + 800);

      // Title: look for common heading/alt patterns nearby
      const titleM = chunk.match(/alt="([^"]{3,80})"|title="([^"]{3,80})"/) ??
                     chunk.match(/<h[23][^>]*>([^<]{3,60})<\/h[23]>/i);
      const title = titleM ? (titleM[1] ?? titleM[2] ?? titleM[3] ?? null)?.trim() : null;

      // Page count
      const pageM = chunk.match(/(\d+)\s+Seite(?:n)?/i);
      const pageCount = pageM ? parseInt(pageM[1], 10) : null;

      // Validity dates
      const { validFrom, validTo } = parseDateRange(chunk);

      // Retailer context
      const isMaximarkt = /maximarkt/i.test(chunk);

      if (isMaximarkt) {
        leaflets.push({
          leafletId:   lid,
          title:       title ?? null,
          pageCount:   pageCount ?? null,
          validFrom:   validFrom ?? null,
          validTo:     validTo ?? null,
          retailerId:  12776,
          retailerName:"Maximarkt",
          isOutdoor:   /outdoor/i.test(title ?? chunk),
        });
      }
    }
  }

  // ── Add isOutdoor / isMaximarkt flags and filter ─────────────────────────
  const clean = leaflets
    .filter(l => l.retailerName == null || /maximarkt/i.test(String(l.retailerName)))
    .map(l => ({
      ...l,
      isOutdoor:   l.isOutdoor ?? /outdoor/i.test(String(l.title ?? "")),
      isMaximarkt: true,
    }));

  // ── Output ────────────────────────────────────────────────────────────────
  console.log(`\n📋 ${clean.length} aktive Maximarkt-Leaflets:\n`);
  clean.forEach((l, i) => {
    console.log(`  [${i+1}] ID=${l.leafletId}`);
    console.log(`       Titel:     ${l.title ?? "(unbekannt)"}`);
    console.log(`       Seiten:    ${l.pageCount ?? "?"}`);
    console.log(`       Gültig:    ${l.validFrom ?? "?"} → ${l.validTo ?? "?"}`);
    console.log(`       Outdoor:   ${l.isOutdoor ? "JA (skip)" : "nein"}`);
    console.log(`       RetailerId:${l.retailerId ?? "?"}`);
    console.log("");
  });

  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART C — HTML content analysis: are active leaflets server-rendered?
// ─────────────────────────────────────────────────────────────────────────────
async function partC() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("TEIL C — HTML-Inhaltsanalyse /rp/maximarkt-prospekte");
  console.log("═══════════════════════════════════════════════════════\n");

  const res = await fetch("https://www.marktguru.at/rp/maximarkt-prospekte", {
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "de-AT,de;q=0.9",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
  });
  const html = await res.text();
  console.log(`HTTP ${res.status}  Länge: ${html.length} Zeichen\n`);

  // ── Erste und letzte 2000 Zeichen ────────────────────────────────────────
  console.log("── ANFANG (erste 2000 Zeichen) ──────────────────────────");
  console.log(html.slice(0, 2000));
  console.log("\n── ENDE (letzte 2000 Zeichen) ───────────────────────────");
  console.log(html.slice(-2000));

  // ── Datumssuche ──────────────────────────────────────────────────────────
  const datesToFind = ["23.03", "20.04", "16.04", "29.04", "25.04", "22.04"];
  console.log("\n── DATUMSSUCHE ──────────────────────────────────────────");
  for (const date of datesToFind) {
    const pos = html.indexOf(date);
    if (pos === -1) {
      console.log(`\n"${date}" → NICHT GEFUNDEN`);
    } else {
      let count = 0;
      let p = 0;
      while ((p = html.indexOf(date, p)) !== -1) { count++; p++; }
      console.log(`\n"${date}" → ${count} Treffer, erster bei Pos ${pos}:`);
      console.log("  KONTEXT:\n" + html.slice(Math.max(0, pos - 300), pos + 300));
    }
  }

  // ── Keyword-Suche ─────────────────────────────────────────────────────────
  const keywords = ["Outdoor", "maxi.wochenende", "maxi.mal", "Outdoor Träume"];
  console.log("\n── KEYWORD-SUCHE ────────────────────────────────────────");
  for (const kw of keywords) {
    const pos = html.indexOf(kw);
    if (pos === -1) {
      console.log(`\n"${kw}" → NICHT GEFUNDEN`);
    } else {
      console.log(`\n"${kw}" → gefunden bei Pos ${pos}:`);
      console.log("  KONTEXT:\n" + html.slice(Math.max(0, pos - 300), pos + 300));
    }
  }

  // ── __NEXT_DATA__ vorhanden? ──────────────────────────────────────────────
  console.log("\n── __NEXT_DATA__ CHECK ──────────────────────────────────");
  const ndMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]{1,200})/);
  if (ndMatch) {
    console.log("__NEXT_DATA__ gefunden. Erste 200 Zeichen des JSON:");
    console.log(ndMatch[1]);
  } else {
    console.log("__NEXT_DATA__ NICHT GEFUNDEN — Seite ist vermutlich clientseitig gerendert.");
  }

  // ── Leaflet-ID-Regex ─────────────────────────────────────────────────────
  const idRe  = /\/leaflets\/(\d{5,8})\//g;
  const idSet = new Set();
  let m;
  while ((m = idRe.exec(html)) !== null) idSet.add(m[1]);
  console.log(`\n── LEAFLET-IDs aus Regex (${idSet.size}): ${[...idSet].join(", ")}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔬 Maximarkt API Diagnostic — Phase 4");
  console.log("═══════════════════════════════════════════════════════\n");

  await partC();

  console.log("\n═══════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fatal:", e.message, "\n", e.stack); process.exit(0); });
