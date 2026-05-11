# Task: Deal-Badges in „Zu besorgen"-Tab

## Ziel

In der „Zu besorgen"-Tab (Tab `template`, gerendert von `renderTmplItem`)
sollen die gleichen Deal-Badges erscheinen wie in der „Liste"-Tab
(`renderListItem`).

Klick auf das Badge öffnet — wie in der Liste-Tab — das `openDealModal`
mit allen Deals zu diesem Artikel-Namen, in dem dann einzelne Cards das
Detail-Modal öffnen können.

## Implementation

In `index.html`, Funktion `renderTmplItem` (ab ca. Zeile 922).

### Bestehende Deal-Match-Logik aus renderListItem übernehmen

Direkt nach der Funktions-Signatur die gleiche Match-Berechnung wie in
`renderListItem`:

```js
const renderTmplItem=item=>{
  const matched=findDeals(item.name,deals);
  const deal=matched.length?matched.slice().sort((a,b)=>parsePrice(a.price)-parsePrice(b.price))[0]:null;
  const extra=matched.length>1?matched.length-1:0;
  const dealTag=deal?`<button onclick="event.stopPropagation();openDealModal('${item.name.replace(/'/g,"\\'")}')" class="deal-badge tap" style="border:none;cursor:pointer;">🏷️ ${esc(deal.savings||deal.price||"Aktion")}${extra?` (+${extra})`:""}</button>`:"";
  // ... bestehender Code ...
}
```

**Wichtig:** `event.stopPropagation()` im onclick — sonst triggert der
äußere `onclick="openEditModal(...)"` mit (das gibt's hier auf dem
Inneren-`<div>`, nicht auf der ganzen Card).

### Badge in das Layout einbauen

Das aktuelle Layout sieht so aus:

```html
<div style="flex:1;min-width:0;cursor:pointer;" onclick="openEditModal(...)">
  <div style="font-weight:600;...">${esc(item.name)}</div>
  ${item.qty?`<span ...>${esc(item.qty)}${esc(item.unit||"")}</span>`:""}
  ${item.note?`<div ...>💬 ${esc(item.note)}</div>`:""}
</div>
```

Wird zu (Item-Name und Badge in einem Flex-Container, analog zur
List-Tab):

```html
<div style="flex:1;min-width:0;cursor:pointer;" onclick="openEditModal(...)">
  <div style="display:flex;gap:5px;align-items:baseline;flex-wrap:wrap;">
    <span style="font-weight:600;font-size:14px;color:${item.bought?"#9CA3AF":"#111827"};text-decoration:${item.bought?"line-through":"none"};">${esc(item.name)}</span>
    ${item.qty?`<span style="font-size:11px;color:#9CA3AF;">${esc(item.qty)}${esc(item.unit||"")}</span>`:""}
    ${dealTag}
  </div>
  ${item.note?`<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:3px;">💬 ${esc(item.note)}</div>`:""}
</div>
```

Hinweis: Die alte Implementation hatte `item.qty` und `item.note` als
Geschwister-Elemente außerhalb des Namens-Containers. Hier wird `item.qty`
in den Flex-Container mit Name + Badge gezogen — wie in `renderListItem`.

## Verifikation

1. Tab „Zu besorgen" öffnen
2. Stammartikel mit aktiven Aktionen sollten Deal-Badges zeigen (z.B.
   „Butter", „Tomaten", wenn auf der Liste)
3. Klick auf Badge öffnet Modal mit allen Aktionen für den Artikel
4. Klick auf eine Card im Modal öffnet das Detail-Modal mit
   Snapshot/Bild — wie in der Liste-Tab
5. Erledigte Stammartikel (`item.bought=true`) zeigen das Badge in
   gedimmter Form (durch das `opacity:.6` auf der äußeren Card)

## Out-of-Scope

- Filterung nach `activeMarkets` — die wirkt schon, weil `deals`
  bereits gefiltert ist (Zeile 815)
- Sortierung nach Aktion — bleibt bei normaler Sortierung
- Andere Tabs (`list` hat es bereits, `deals`-Tab ist eigener Workflow)
