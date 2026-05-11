# Task: Deal-Details mit Snapshot

## Ziel

Klick auf eine Deal-Card öffnet ein Detail-Modal mit:
- **Snapshot/Produktbild** der Aktion
- vollständigem Produktnamen
- Preis-Details (Preis, Originalpreis, Rabatt, Gültigkeit)
- Direktlink zum Marktguru-Angebot

Zusätzlich: **server-seitige Wort-Boundary-Validierung** im Scraper, damit irrelevante Treffer (z.B. „Knoblauchbutter" beim Suchbegriff „Butter") gar nicht erst in Firebase landen.

---

## Datenmodell — neue Felder pro Deal in `/deals/{key}`

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `productName` | string | ja | voller Produktname inkl. Marke und Variante (z.B. „SPAR Österreichische Tee Butter 250 g") — getrennt von `articleName` (= Such-Begriff aus der Liste) |
| `imageUrl` | string\|null | nein | nur Marktguru-Pfad: CDN-URL des Produktbilds |
| `offerUrl` | string\|null | nein | nur Marktguru-Pfad: Direktlink zur Offer-Detailseite |
| `boundingBox` | `[ymin, xmin, ymax, xmax]` \| null | nein | nur Maximarkt-Pfad: normalisierte Koordinaten 0–1000 für Crop |

**Trennung `articleName` ↔ `productName`:**
- `articleName` = Such-Begriff aus der Einkaufsliste (z.B. „Butter") → für UI-Verknüpfung mit Listen-Items
- `productName` = vollständiger Produktname → für Anzeige im Modal

Aktuell ist `articleName` im Marktguru-Pfad gleich Such-Begriff, im Maximarkt-Pfad aber gleich vollständiger Produktname (Inkonsistenz). Diese Spec bereinigt das.

**Migration:** keine. Beim nächsten nächtlichen Lauf werden alle Deals frisch geschrieben (`db.ref("deals").set(...)`).

---

## Schritt 0 — Diagnose der Marktguru-Felder (vor Implementation)

In `scripts/check-deals.js` einmalig direkt nach dem `search()`-Call das erste Offer komplett loggen:

```js
const results = await search(article.name, { limit: 10, zipCode: ZIP_CODE });
if (results?.[0]) console.log("[OFFER-DEBUG]", JSON.stringify(results[0], null, 2));
```

Lokal einmal laufen lassen, Felder verifizieren, dann das Mapping in der Spec unten anpassen falls nötig. Vermutete Felder (zu prüfen):
- `offer.images?.[0]?.url` oder `offer.image` → für `imageUrl`
- `offer.url` oder konstruierbar via `offer.id` → für `offerUrl`
- `offer.brand`, `offer.title`, `offer.product?.name` → für `productName`

Den Diagnose-`console.log` nach Verifikation wieder entfernen.

---

## Scraper (`scripts/check-deals.js`)

### 1. Helper: Wort-Boundary-Match

Neue Funktion am Anfang des Files (nach `normalizeStore`):

```js
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Prüft, ob mindestens ein Token aus articleName als ganzes Wort
 * (umgeben von Wortgrenzen) im fullText vorkommt.
 * Tokens unter 4 Zeichen werden ignoriert (zu unspezifisch).
 */
function matchesArticleName(articleName, fullText) {
  const tokens = (articleName || "").toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(t => t.length >= 4);
  if (!tokens.length) return false;
  const hay = (fullText || "").toLowerCase();
  return tokens.some(t => new RegExp(`\\b${escapeRegex(t)}\\b`, 'u').test(hay));
}
```

### 2. Marktguru-Pfad — Validierung + neue Felder

In der `for (const offer of results)`-Schleife (Zeile ~346):

```js
for (const offer of results) {
  const storeName = offer.advertisers?.[0]?.name || "Unbekannt";
  const storeId   = normalizeStore(storeName);
  if (!activeMarkets.includes(storeId)) continue;

  // NEU: voller Produktname (Felder gemäß Diagnose-Schritt 0 anpassen)
  const productName = [offer.brand, offer.title || offer.product?.name, offer.description]
    .filter(Boolean).join(" ").trim() || article.name;

  // NEU: Wort-Boundary-Validierung gegen vollen Produkttext
  if (!matchesArticleName(article.name, productName)) {
    console.log(`      ⏭️  verworfen (kein Wort-Boundary-Match): "${productName}"`);
    continue;
  }

  const price      = offer.price    ? `${offer.price} EUR`    : null;
  const oldPrice   = offer.oldPrice ? `${offer.oldPrice} EUR` : null;
  const savings    = (offer.price && offer.oldPrice)
    ? `-${(offer.oldPrice - offer.price).toFixed(2)} EUR` : null;
  const validUntil = offer.validityDates?.[0]?.to?.slice(0, 10) || null;

  // NEU: imageUrl + offerUrl (Felder gemäß Diagnose anpassen)
  const imageUrl = offer.images?.[0]?.url || offer.image?.url || null;
  const offerUrl = offer.url || (offer.id ? `https://www.marktguru.at/produkt/${offer.id}` : null);

  console.log(`      🏪 ${storeName}: ${productName} – ${price || "?"}`);
  allDeals.push({
    articleName: article.name,
    productName,
    storeId, storeName,
    title: offer.description || article.name,  // legacy, kann mittelfristig weg
    price, oldPrice, savings, validUntil,
    imageUrl, offerUrl,
    source: "marktguru.at",
    checkedAt,
  });
}
```

### 3. Maximarkt-Pfad — Gemini-Prompt erweitern

In `scanMaximarktLeaflet`, der `prompt`-String (Zeile ~195) wird ergänzt um:
- neue Regel für `boundingBox`
- neue Regel für `productName` (eigentlich schon Regel #5, aber explizit)
- neue JSON-Struktur

Neuer Prompt (relevante Teile geändert):

```
Antworte NUR mit JSON – keine weiteren Texte:
{"deals":[{
  "productName":"Vollständiger Produktname inkl. Marke und Variante",
  "price":"1,99 EUR",
  "savings":"-20%",
  "oldPrice":"2,49 EUR",
  "boundingBox":[ymin, xmin, ymax, xmax]
}]}

ZUSÄTZLICHE REGELN:
6. boundingBox: [ymin, xmin, ymax, xmax] mit normalisierten Koordinaten 0–1000.
   Die Box muss den kompletten Aktions-Bereich umschließen: Produktbild + Preis-Block + Aktions-Hinweis.
   Format ist EXAKT so: [ymin, xmin, ymax, xmax] (Reihenfolge beachten!).
7. productName: vollständiger Produktname inkl. Marke (z.B. "SPAR Österreichische Tee Butter 250 g").

Keine Treffer: {"deals":[]}
```

Hinweis: Das Feld heißt jetzt `productName` (nicht mehr `articleName`) — das vereinheitlicht die Struktur mit dem Marktguru-Pfad.

### 4. Maximarkt-Pfad — Mapping auf Listen-Artikel + Validierung

In `scanMaximarktLeaflet`, in der Schleife wo `found.forEach` über die Gemini-Ergebnisse iteriert (Zeile ~242):

```js
found.forEach(d => {
  const productName = d.productName || d.articleName; // Backward-compat falls Gemini noch alten Key liefert
  if (!productName) return;

  // NEU: Mapping auf Listen-Artikel via Wort-Boundary
  const matchedArticle = articles.find(a => matchesArticleName(a.name, productName));
  if (!matchedArticle) {
    console.log(`      ⏭️  "${productName}" konnte keinem Listen-Artikel zugeordnet werden`);
    return;
  }

  console.log(`      ✅ ${productName} → "${matchedArticle.name}" – ${d.price || "?"}`);

  // NEU: boundingBox validieren
  let boundingBox = null;
  if (Array.isArray(d.boundingBox) && d.boundingBox.length === 4
      && d.boundingBox.every(n => typeof n === "number" && n >= 0 && n <= 1000)) {
    const [ymin, xmin, ymax, xmax] = d.boundingBox;
    if (ymin < ymax && xmin < xmax) boundingBox = d.boundingBox;
  }

  deals.push({
    articleName: matchedArticle.name,
    productName,
    storeId:   "maximarkt",
    storeName: "Maximarkt",
    title:     productName, // legacy
    price:     d.price    || null,
    oldPrice:  d.oldPrice || null,
    savings:   d.savings  || null,
    validUntil:   leaflet.validTo,
    source:       "marktguru.at leaflet scan",
    leafletId:    leaflet.id,
    leafletTitle: leaflet.name,
    pageIndex:    page,
    boundingBox,
    checkedAt,
  });
});
```

---

## Frontend (`index.html`)

### 1. Cards klickbar machen

`renderDealCards` (Zeile ~591) anpassen:
- Outer-`<div>` bekommt `onclick="openDealDetail('${esc(d.fbKey)}')"` und `cursor:pointer`
- Inline-Links („auf marktguru suchen" / „auf marktguru ansehen") **entfernen** — sind im Modal
- Hover-Indikator: `transition: transform 0.15s; ` und subtle hover-Effekt optional

```js
function renderDealCards(itemName, allDeals){
  const matched = findDeals(itemName, allDeals);
  if (!matched.length) return `<div style="padding:10px 0;text-align:center;color:#9CA3AF;font-size:12px;">Keine Aktionen in aktiven Märkten gefunden.</div>`;
  return [...matched].sort((a,b)=>parsePrice(a.price)-parsePrice(b.price)).map(d => {
    const store = storeById(d.storeId);
    const sc = store ? store.color : "#374151";
    const savingsHtml  = d.savings  ? `<span style="font-size:11px;padding:2px 7px;border-radius:6px;background:#DCFCE7;color:#166534;font-weight:700;">${esc(d.savings)}</span>` : "";
    const oldPriceHtml = (d.oldPrice && d.oldPrice !== d.price) ? `<span style="font-size:12px;text-decoration:line-through;color:#9CA3AF;">${esc(d.oldPrice)}</span>` : "";
    const validHtml    = d.validUntil ? `<span style="font-size:11px;color:#9CA3AF;">⏳ bis ${esc(d.validUntil.split("T")[0])}</span>` : "";
    return `<div onclick="openDealDetail('${esc(d.fbKey)}')" style="background:#F9FAFB;border-radius:12px;padding:12px 13px;border:1px solid #E5E7EB;margin-bottom:8px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:11px;padding:2px 9px;border-radius:8px;background:${sc}18;color:${sc};font-weight:700;">${store?store.emoji+" ":""}${esc(d.storeName||(d.storeId||"").toUpperCase()||"?")}</span>
        <span style="font-size:18px;font-weight:700;color:#111827;">${esc(d.price||"?")}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:5px;">${esc(d.productName||d.title||d.articleName||"")}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${oldPriceHtml}${savingsHtml}${validHtml}</div>
    </div>`;
  }).join("");
}
```

### 2. Neue Funktion: `openDealDetail(fbKey)`

```js
function openDealDetail(fbKey){
  const d = state.deals?.[fbKey];
  if (!d) return;

  let modal = document.getElementById("dealDetailFullModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "dealDetailFullModal";
    modal.className = "modal-bg";
    modal.onclick = e => { if (e.target === modal) modal.style.display = "none"; };
    document.body.appendChild(modal);
  }

  const store = storeById(d.storeId);
  const sc = store ? store.color : "#374151";
  const imgHtml = renderDealImage(d, fbKey);

  const linkHtml = d.offerUrl
    ? `<a href="${esc(d.offerUrl)}" target="_blank" rel="noopener" style="display:block;text-align:center;font-size:13px;color:#6D28D9;font-weight:600;padding:10px;background:#F9FAFB;border-radius:10px;text-decoration:none;">→ Auf marktguru ansehen</a>`
    : `<a href="https://www.marktguru.at/search/${encodeURIComponent(d.productName||d.articleName||"")}" target="_blank" rel="noopener" style="display:block;text-align:center;font-size:13px;color:#6B7280;padding:10px;background:#F9FAFB;border-radius:10px;text-decoration:none;">🔍 Auf marktguru suchen</a>`;

  modal.innerHTML = `<div class="modal-box">
    <div class="modal-handle"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-size:12px;padding:3px 10px;border-radius:8px;background:${sc}18;color:${sc};font-weight:700;">${store?store.emoji+" ":""}${esc(d.storeName||"")}</span>
      <button onclick="document.getElementById('dealDetailFullModal').style.display='none'" style="background:none;border:none;font-size:20px;color:#9CA3AF;cursor:pointer;padding:0;line-height:1;">✕</button>
    </div>
    ${imgHtml}
    <div style="font-size:15px;font-weight:600;color:#111827;margin:14px 0 10px;line-height:1.35;">${esc(d.productName||d.title||d.articleName||"")}</div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
      <span style="font-size:24px;font-weight:700;color:#111827;">${esc(d.price||"?")}</span>
      ${(d.oldPrice && d.oldPrice !== d.price) ? `<span style="font-size:14px;text-decoration:line-through;color:#9CA3AF;">${esc(d.oldPrice)}</span>` : ""}
      ${d.savings ? `<span style="font-size:12px;padding:3px 9px;border-radius:6px;background:#DCFCE7;color:#166534;font-weight:700;">${esc(d.savings)}</span>` : ""}
    </div>
    ${d.validUntil ? `<div style="font-size:12px;color:#6B7280;margin-bottom:14px;">⏳ Gültig bis ${esc(d.validUntil.split("T")[0])}</div>` : ""}
    ${linkHtml}
  </div>`;
  modal.style.display = "flex";
}
```

### 3. Bild-Render-Logik

Drei Fälle, in dieser Priorität:
1. **`imageUrl` vorhanden** (Marktguru-Pfad): direkt als `<img>`
2. **`leafletId` + `pageIndex` + `boundingBox` vorhanden** (Maximarkt mit Crop): Canvas-Crop
3. **`leafletId` + `pageIndex` ohne `boundingBox`** (Fallback): ganze Leaflet-Seite
4. **Sonst**: Platzhalter

```js
function renderDealImage(d, fbKey){
  // Fall 1: Marktguru-Bild
  if (d.imageUrl) {
    return `<img src="${esc(d.imageUrl)}" style="width:100%;max-height:300px;object-fit:contain;background:#F9FAFB;border-radius:10px;display:block;" onerror="this.outerHTML='<div style=&quot;padding:30px;text-align:center;background:#F9FAFB;border-radius:10px;color:#9CA3AF;font-size:13px;&quot;>Bild nicht ladbar</div>'"/>`;
  }

  // Fall 2 + 3: Maximarkt
  if (d.leafletId !== undefined && d.pageIndex !== undefined) {
    const fullUrl = `https://mgat.b-cdn.net/api/v1/leaflets/${d.leafletId}/images/pages/${d.pageIndex}/xlarge.webp`;

    if (d.boundingBox && Array.isArray(d.boundingBox) && d.boundingBox.length === 4) {
      const canvasId = `dealCrop_${fbKey}`;
      // Canvas im DOM platzieren, dann asynchron befüllen (setTimeout damit DOM gerendert ist)
      setTimeout(() => cropImageToCanvas(fullUrl, d.boundingBox, canvasId), 0);
      return `<canvas id="${canvasId}" style="width:100%;max-height:400px;background:#F9FAFB;border-radius:10px;display:block;"></canvas>`;
    }

    // Fallback: ganze Seite
    return `<img src="${fullUrl}" style="width:100%;max-height:400px;object-fit:contain;background:#F9FAFB;border-radius:10px;display:block;"/>`;
  }

  // Fall 4: Platzhalter
  return `<div style="padding:40px;text-align:center;background:#F9FAFB;border-radius:10px;color:#9CA3AF;font-size:13px;">Kein Snapshot verfügbar</div>`;
}

/**
 * Lädt ein Bild und zeichnet einen Crop in das gegebene Canvas-Element.
 * KEIN crossOrigin nötig — drawImage funktioniert auch mit "tainted" canvases,
 * solange wir das Canvas nicht via toDataURL/getImageData auslesen.
 */
function cropImageToCanvas(imageUrl, bbox, canvasId, paddingNorm = 0.03){
  const img = new Image();
  img.onload = () => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const [ymin, xmin, ymax, xmax] = bbox;
    const pad = paddingNorm * 1000;
    const yMinP = Math.max(0, ymin - pad);
    const xMinP = Math.max(0, xmin - pad);
    const yMaxP = Math.min(1000, ymax + pad);
    const xMaxP = Math.min(1000, xmax + pad);
    const sx = (xMinP / 1000) * img.naturalWidth;
    const sy = (yMinP / 1000) * img.naturalHeight;
    const sw = ((xMaxP - xMinP) / 1000) * img.naturalWidth;
    const sh = ((yMaxP - yMinP) / 1000) * img.naturalHeight;
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  };
  img.onerror = () => {
    const c = document.getElementById(canvasId);
    if (c) c.outerHTML = `<img src="${imageUrl}" style="width:100%;max-height:400px;object-fit:contain;background:#F9FAFB;border-radius:10px;"/>`;
  };
  img.src = imageUrl;
}
```

### 4. Altes `openDealModal` entfernen

Die existierende Funktion `openDealModal(itemName)` (Zeile ~641) ist die Listen-Übersicht aller Deals zu einem Listen-Item — die bleibt bestehen und nutzt weiterhin `renderDealCards`. Die neue `openDealDetail(fbKey)` ist ein zusätzliches Modal für eine **einzelne** Deal-Card.

---

## Verifikation

Nach Implementation:

1. **Diagnose-Lauf** mit dem `console.log` aus Schritt 0 lokal ausführen, Marktguru-Felder verifizieren, Spec-Code anpassen falls Felder anders heißen.
2. **Voller Scraper-Lauf** lokal: prüfen ob Deals mit den neuen Feldern korrekt in Firebase landen.
3. **Im Frontend**:
   - „Butter" als Listen-Item — vorher: 5+ irrelevante Treffer („Knoblauchbutter", „Trio Riegel"). Nachher: nur echte Butter-Treffer.
   - Klick auf eine Marktguru-Card → Modal mit Produktbild + Daten.
   - Klick auf eine Maximarkt-Card → Modal mit gecropptem Aktions-Bereich aus dem Leaflet.
   - Maximarkt-Card ohne `boundingBox` (falls Gemini sie nicht liefert) → ganze Leaflet-Seite als Fallback.
4. **Hard-Edge-Cases**:
   - `productName` leer → Modal zeigt `articleName` als Fallback (kein Crash).
   - `boundingBox` fehlerhaft (NaN, falsche Reihenfolge) → Validierung im Scraper greift, `boundingBox: null` wird gespeichert.
   - Crop-Bild-Load schlägt fehl → Fallback auf ganze Seite.

---

## Out-of-Scope

- Server-seitiger Crop / Snapshot-Storage (kosten-frei aktuell nicht möglich, Cloudflare Workers Free haben keine Image-Manipulation, Storage kostet)
- Suchen-Tab im Modal (Cross-Tab-Search bleibt wie aktuell)
- Andere Retailer mit Leaflet-Scan (nur Maximarkt aktuell)
- Bounding-Box-Highlight als Overlay auf voller Seite (nur Crop, keine Highlight-Anzeige)
