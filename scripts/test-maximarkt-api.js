/**
 * Maximarkt API Diagnostic — Phase 2
 * Tests 14 endpoint candidates to find which one returns ALL active Maximarkt leaflets.
 * Run via GitHub Actions workflow "Test Maximarkt API" (test-maximarkt.yml).
 * Does NOT touch Firebase. Exits 0 regardless of results.
 */

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const BASE   = "https://api.marktguru.at/api/v1";
const RID    = 12776;   // Maximarkt retailer ID
const LAT    = 48.2094;
const LNG    = 13.4889;
const ZIP    = 4910;
const LOC    = `zipCode=${ZIP}&latitude=${LAT}&longitude=${LNG}`;

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getApiKeys() {
  console.log("🔑 Hole API-Keys von marktguru.at...");
  const res = await fetch("https://marktguru.at", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  const html = await res.text();
  const regex = /<script\s+type="application\/json">([\s\S]*?)<\/script>/gm;
  let configStr = "";
  let m;
  while ((m = regex.exec(html)) !== null) configStr = m[1];
  if (!configStr) throw new Error("Kein <script type=application/json> auf marktguru.at gefunden");
  const parsed = JSON.parse(configStr);
  if (!parsed?.config?.apiKey) throw new Error("config.apiKey fehlt");
  console.log(`   ✅ apiKey=${parsed.config.apiKey.slice(0,8)}… clientKey=${parsed.config.clientKey?.slice(0,8)}…\n`);
  return { apiKey: parsed.config.apiKey, clientKey: parsed.config.clientKey };
}

// ── Generic GET helper ────────────────────────────────────────────────────────
async function apiGet(headers, url, label) {
  process.stdout.write(`[${label}] GET ${url}\n`);
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
    const preview = text.slice(0, 500).replace(/\n/g, " ");
    console.log(`   → ${res.status}  preview: ${preview}`);
    return { status: res.status, data, text };
  } catch (e) {
    console.log(`   → ERROR: ${e.message}`);
    return { status: 0, data: null, text: "" };
  }
}

// ── Count array-like results ──────────────────────────────────────────────────
function countResults(data) {
  if (!data) return 0;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.results)) return data.results.length;
  if (Array.isArray(data?.leaflets)) return data.leaflets.length;
  if (Array.isArray(data?.offers)) return data.offers.length;
  if (Array.isArray(data?.data)) return data.data.length;
  if (typeof data === "object") {
    // single object that IS a leaflet?
    if (data.id && (data.validFrom || data.pageCount)) return 1;
  }
  return "?";
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🔬 Maximarkt API Diagnostic — Phase 2 (14 Kandidaten + HTML)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const { apiKey, clientKey } = await getApiKeys();
  const h = { "x-apikey": apiKey, "x-clientkey": clientKey,
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

  const summary = []; // { label, url, status, count }

  const test = async (label, url) => {
    const r = await apiGet(h, url, label);
    const count = countResults(r.data);
    summary.push({ label, url, status: r.status, count });
    await sleep(400);
    return r;
  };

  // ── Candidates 1–3: /offers/{retailerId}/... ─────────────────────────────
  await test("01", `${BASE}/offers/${RID}/leaflets?${LOC}&as=mobiledetailed`);
  await test("02", `${BASE}/offers/${RID}/bestleaflets?${LOC}&as=mobiledetailed`);
  await test("03", `${BASE}/offers/${RID}/allleaflets?${LOC}&as=mobiledetailed`);

  // ── Candidates 4–5: /retailers/{id}/leaflets ─────────────────────────────
  await test("04", `${BASE}/retailers/${RID}/leaflets?${LOC}&as=mobiledetailed`);
  await test("05", `${BASE}/retailers/${RID}/leaflets/current?${LOC}&as=mobiledetailed`);

  // ── Candidate 6: /retailers/{id}/locations → extract locationId ──────────
  const r6 = await test("06", `${BASE}/retailers/${RID}/locations?latitude=${LAT}&longitude=${LNG}&as=mobiledetailed`);
  let locationId = null;
  if (r6.data) {
    const arr = Array.isArray(r6.data) ? r6.data
              : Array.isArray(r6.data?.results) ? r6.data.results
              : Array.isArray(r6.data?.locations) ? r6.data.locations
              : r6.data?.id ? [r6.data] : [];
    if (arr.length > 0) {
      locationId = arr[0]?.id ?? arr[0]?.retailerLocationId ?? null;
      console.log(`   📍 Erste Location: id=${locationId}  raw=${JSON.stringify(arr[0]).slice(0,200)}`);
    } else {
      console.log("   ⚠️  Keine Location-Einträge in Response");
    }
  }

  // ── Candidates 7–9: /retailerLocations/{id}/... (only if id found) ───────
  if (locationId) {
    await test("07", `${BASE}/retailerLocations/${locationId}/leaflets?as=mobiledetailed`);
    await test("08", `${BASE}/retailerLocations/${locationId}/offers?as=mobiledetailed`);
    await test("09", `${BASE}/retailerLocationOffers?retailerLocationId=${locationId}&as=mobiledetailed`);
  } else {
    console.log("[07–09] Übersprungen – keine locationId aus Kandidat 6\n");
    summary.push({ label:"07", url:"(skipped – no locationId)", status:"-", count:"-" });
    summary.push({ label:"08", url:"(skipped – no locationId)", status:"-", count:"-" });
    summary.push({ label:"09", url:"(skipped – no locationId)", status:"-", count:"-" });
  }

  // ── Candidates 10–11: /leaflets?retailerId=... ───────────────────────────
  await test("10", `${BASE}/leaflets?retailerId=${RID}&${LOC}&as=mobiledetailed`);
  await test("11", `${BASE}/leaflets/current?retailerId=${RID}&${LOC}`);

  // ── Candidates 12–13: /publishers/retailer/... ───────────────────────────
  await test("12", `${BASE}/publishers/retailer/maximarkt/city/ried-im-innkreis/leaflets?as=mobile`);
  await test("13", `${BASE}/publishers/retailer/maximarkt/city/ried-im-innkreis/prospekte?as=mobile`);

  // ── Candidate 14: HTML scraping of /rp/maximarkt-prospekte ───────────────
  console.log("\n[14] HTML-Scraping https://www.marktguru.at/rp/maximarkt-prospekte");
  const leafletIdsFromHTML = new Set();
  try {
    const res = await fetch("https://www.marktguru.at/rp/maximarkt-prospekte", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                 "Accept-Language": "de-AT,de;q=0.9" }
    });
    const html = await res.text();
    console.log(`   → HTTP ${res.status}, HTML length: ${html.length}`);

    // Pattern: /leaflets/123456 or leaflet-id="123456" or data-id="123456" or "leafletId":123456
    const patterns = [
      /\/leaflets\/(\d+)/g,
      /leaflet[-_]?id[=":]+\s*"?(\d+)/gi,
      /"leafletId"\s*:\s*(\d+)/g,
      /data-leaflet[=-]id="(\d+)"/gi,
      /"id"\s*:\s*(\d+).*?maximarkt/gi,
    ];
    for (const pat of patterns) {
      let m2;
      const re = new RegExp(pat.source, pat.flags);
      while ((m2 = re.exec(html)) !== null) leafletIdsFromHTML.add(m2[1]);
    }

    // Also look for Next.js __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      console.log("   📦 __NEXT_DATA__ gefunden – suche nach leaflet IDs...");
      const nd = nextDataMatch[1];
      const idRe = /"id"\s*:\s*(\d{5,8})/g;
      let nm;
      while ((nm = idRe.exec(nd)) !== null) leafletIdsFromHTML.add(nm[1]);
      // Show first 1000 chars of Next data for context
      console.log(`   __NEXT_DATA__ (first 1000): ${nd.slice(0, 1000)}`);
    }

    if (leafletIdsFromHTML.size > 0) {
      console.log(`   ✅ Gefundene Leaflet-IDs: ${[...leafletIdsFromHTML].join(", ")}`);
    } else {
      console.log("   ⚠️  Keine Leaflet-IDs im HTML gefunden");
      // Dump first 2000 chars to help debug
      console.log(`   HTML preview (first 2000): ${html.slice(0, 2000)}`);
    }
    summary.push({ label:"14", url:"HTML /rp/maximarkt-prospekte", status: res.status,
                   count: leafletIdsFromHTML.size > 0 ? `${leafletIdsFromHTML.size} IDs` : 0 });
  } catch (e) {
    console.log(`   ❌ Fehler: ${e.message}`);
    summary.push({ label:"14", url:"HTML /rp/maximarkt-prospekte", status:"ERR", count:0 });
  }

  // ── If we have leaflet IDs from HTML: try fetching their offers ──────────
  if (leafletIdsFromHTML.size > 0) {
    console.log("\n[14b] Leaflet-Angebote via API für erste 3 gefundene IDs:");
    const ids = [...leafletIdsFromHTML].slice(0, 3);
    for (const lid of ids) {
      const r = await apiGet(h, `${BASE}/leaflets/${lid}/offers?as=mobiledetailed`, `14b-${lid}`);
      const cnt = countResults(r.data);
      summary.push({ label:`14b-${lid}`, url:`/leaflets/${lid}/offers`, status: r.status, count: cnt });
      await sleep(300);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("📊 ZUSAMMENFASSUNG");
  console.log("═══════════════════════════════════════════════════════════════");
  const hits = summary.filter(s => s.status === 200 && s.count !== 0 && s.count !== "?");
  const multiHits = hits.filter(s => typeof s.count === "number" && s.count > 1);

  console.log("\n✅ Endpoints mit 200 OK + nicht-leerer Response:");
  hits.length > 0
    ? hits.forEach(s => console.log(`   [${s.label}] count=${s.count}  ${s.url}`))
    : console.log("   (keine)");

  console.log("\n🎯 Endpoints mit ARRAY > 1 Leaflet:");
  multiHits.length > 0
    ? multiHits.forEach(s => console.log(`   [${s.label}] count=${s.count}  ${s.url}`))
    : console.log("   (keine)");

  console.log("\n📋 Alle Ergebnisse:");
  summary.forEach(s => console.log(`   [${s.label}] ${s.status}  count=${s.count}  ${s.url.slice(0,80)}`));

  if (leafletIdsFromHTML.size > 0) {
    console.log(`\n🗂️  HTML-Scraping Leaflet-IDs: ${[...leafletIdsFromHTML].join(", ")}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fatal:", e.message, e.stack); process.exit(0); });
