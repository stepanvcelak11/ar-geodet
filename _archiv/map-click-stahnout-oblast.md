# Archiv: nabídka „Stáhnout okolí" na klik do prázdné mapy

Schováno na přání (2026-06-14). Původně: po kliknutí do PRÁZDNÉHO místa mapy
(kde není žádný bod) se otevřel Leaflet popup s jezdcem poloměru a tlačítkem
„Stáhnout okolí" (volá `fetchDistantArea(lat,lng,radius)` — ta funkce v kódu ZŮSTÁVÁ).

## Jak vrátit
V `js/grafika.js`, v handleru `map.on('click', ...)`, je za větví
`else if (nearbyPoints.length > 1) { showClusterList(...) }` komentář-placeholder.
Nahraď ten dvouřádkový komentář zpět tímto `else` blokem:

```js
            else {
                // KLIKNUTÍ DO PRÁZDNA - STAŽENÍ VZDÁLENÉ OBLASTI
                L.popup().setLatLng(clickLatLng).setContent(`<div style="text-align:center;"><div style="font-weight:bold; margin-bottom:6px; color:#000;">Vzdálená oblast</div><div style="color:#000; font-size:12px;">Poloměr: <span id="dl-radius-val">${mapRadius}</span> m</div><input type="range" id="dl-radius" min="200" max="5000" step="100" value="${mapRadius}" style="width:100%; margin:4px 0;" oninput="document.getElementById('dl-radius-val').innerText=this.value"><button class="btn btn-blue" style="padding:8px; width:100%; margin:6px 0 0 0;" onclick="fetchDistantArea(${clickLatLng.lat}, ${clickLatLng.lng}, parseInt(document.getElementById('dl-radius').value))"><svg class="icon"><use href="#i-download"/></svg> Stáhnout okolí</button><button class="btn" style="padding:8px; width:100%; margin:6px 0 0 0; background:#e5e7eb; color:#000;" onclick="map.closePopup()">Zrušit</button></div>`).openOn(map);
            }
```
