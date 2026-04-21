/**
 * One-shot diagnostic: probes the marktguru.at API for Maximarkt data.
 * Run via GitHub Actions workflow "Test Maximarkt API" (test-maximarkt.yml).
 *
 * Does NOT touch Firebase. Exits 0 regardless of results.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getApiKeys() {
  console.log("🔑 Hole API-Keys von marktguru.at...");
  const res = await fetch("https://marktguru.at", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; mywagerl-test/1.0)" }
  });
  const html = await res.text();

  // Package extracts the LAST matching <script type="application/json"> tag
  const regex = /<script\s+type="application\/json">([\s\S]*?)<\/script>/gm;
  let configStr = "";
  let m;
  while ((m = regex.exec(html)) !== null) configStr = m[1];

  if (!configStr) throw new Error("Kein <script type=application/json> gefunden");

  let parsed;
  try { parsed = JSON.parse(configStr); } catch (e) {
    throw new Error(`JSON-Parse-Fehler: ${e.message}. Raw (first 500): ${configStr.slice(0, 500)}`);
  }

  if (!parsed?.config?.apiKey) throw new Error("config.apiKey fehlt im gescrapten JSON");
  console.log(`   ✅ apiKey: ${parsed.config.apiKey.slice(0, 8)}… clientKey: ${parsed.config.clientKey?.slice(0, 8)}…`);
  return { apiKey: parsed.config.apiKey, clientKey: parsed.config.clientKey };
}

async function apiGet(headers, path) {
  const url = `https://api.marktguru.at/api/v1${path}`;
  console.log(`\n📡 GET ${url}`);
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    console.log(`   Status: ${res.status}`);
    if (!res.ok) { console.log(`   Body (first 500): ${body.slice(0, 500)}`); return null; }
    const data = JSON.parse(body);
    return data;
  } catch (e) {
    console.log(`   ❌ Fehler: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔬 Maximarkt API Diagnostic");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Get API keys ─────────────────────────────────────────────────────
  const { apiKey, clientKey } = await getApiKeys();
  const headers = {
    "x-apikey":    apiKey,
    "x-clientkey": clientKey,
    "User-Agent":  "Mozilla/5.0 (compatible; mywagerl-test/1.0)",
  };

  // ── 2. Find Maximarkt retailer via search endpoint ──────────────────────
  console.log("\n══ STEP 1: Maximarkt via /retailers search ══");
  const retailersSearch = await apiGet(headers, "/retailers?as=web&q=maximarkt&limit=10");
  if (retailersSearch) {
    console.log("   Results:", JSON.stringify(retailersSearch, null, 2).slice(0, 3000));
  }
  await sleep(500);

  // ── 3. List retailers near PLZ 4910 ─────────────────────────────────────
  console.log("\n══ STEP 2: /retailers list near PLZ 4910 ══");
  const retailersZip = await apiGet(headers, "/retailers?as=web&zipCode=4910&limit=50");
  if (retailersZip) {
    // Look for Maximarkt specifically
    const results = retailersZip?.results || retailersZip;
    const arr = Array.isArray(results) ? results : (Array.isArray(retailersZip?.results) ? retailersZip.results : []);
    const maxi = arr.filter(r => JSON.stringify(r).toLowerCase().includes("maximarkt"));
    console.log(`   Total retailers: ${arr.length}, Maximarkt entries: ${maxi.length}`);
    if (maxi.length) console.log("   Maximarkt:", JSON.stringify(maxi, null, 2));
    else console.log("   First 3 retailers:", JSON.stringify(arr.slice(0, 3), null, 2).slice(0, 1000));
  }
  await sleep(500);

  // ── 4. Try known Maximarkt retailer ID 12776 ────────────────────────────
  console.log("\n══ STEP 3: /retailers/12776 direct ══");
  const maxi12776 = await apiGet(headers, "/retailers/12776?as=web");
  if (maxi12776) console.log("   Result:", JSON.stringify(maxi12776, null, 2).slice(0, 2000));
  await sleep(500);

  // ── 5. Leaflets for PLZ 4910 ─────────────────────────────────────────────
  console.log("\n══ STEP 4: /leaflets near PLZ 4910 (all) ══");
  const leaflets4910 = await apiGet(headers, "/leaflets?as=web&zipCode=4910&limit=50");
  if (leaflets4910) {
    const arr = Array.isArray(leaflets4910?.results) ? leaflets4910.results : (Array.isArray(leaflets4910) ? leaflets4910 : []);
    const maxi = arr.filter(r => JSON.stringify(r).toLowerCase().includes("maximarkt"));
    console.log(`   Total leaflets: ${arr.length}, Maximarkt leaflets: ${maxi.length}`);
    if (maxi.length) console.log("   Maximarkt leaflets:", JSON.stringify(maxi, null, 2).slice(0, 3000));
    else console.log("   First 3 leaflets:", JSON.stringify(arr.slice(0, 3), null, 2).slice(0, 1500));
  }
  await sleep(500);

  // ── 6. Leaflets directly for retailer 12776 ─────────────────────────────
  console.log("\n══ STEP 5: /retailers/12776/leaflets?zipCode=4910 ══");
  const maxiLeaflets = await apiGet(headers, "/retailers/12776/leaflets?as=web&zipCode=4910&limit=10");
  if (maxiLeaflets) console.log("   Result:", JSON.stringify(maxiLeaflets, null, 2).slice(0, 3000));
  await sleep(500);

  // ── 7. Offers directly for retailer 12776 ───────────────────────────────
  console.log("\n══ STEP 6: /retailers/12776/offers?zipCode=4910 ══");
  const maxiOffers = await apiGet(headers, "/retailers/12776/offers?as=web&zipCode=4910&limit=10");
  if (maxiOffers) console.log("   Result:", JSON.stringify(maxiOffers, null, 2).slice(0, 3000));
  await sleep(500);

  // ── 8. Try offers/search with allowedRetailers=maximarkt ────────────────
  console.log("\n══ STEP 7: /offers/search?q=Bier&zipCode=4910&allowedRetailers=maximarkt ══");
  const searchMaxi = await apiGet(headers, "/offers/search?as=web&q=Bier&zipCode=4910&limit=10&allowedRetailers=maximarkt");
  if (searchMaxi) {
    const arr = Array.isArray(searchMaxi?.results) ? searchMaxi.results : [];
    console.log(`   Treffer: ${arr.length}`);
    if (arr.length) console.log("   First result:", JSON.stringify(arr[0], null, 2).slice(0, 1000));
  }
  await sleep(500);

  // ── 9. Alternate retailer IDs (chainId=88 per user hint) ────────────────
  console.log("\n══ STEP 8: /retailers?chainId=88 (Maximarkt chain?) ══");
  const chain88 = await apiGet(headers, "/retailers?as=web&chainId=88&limit=10");
  if (chain88) console.log("   Result:", JSON.stringify(chain88, null, 2).slice(0, 2000));

  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("✅ Diagnostic abgeschlossen");
  console.log("═══════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fatal:", e.message); process.exit(0); }); // exit 0 even on error
