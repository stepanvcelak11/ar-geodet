# AR Geodet

Webový nástroj (PWA) pro geodety k vyhledávání bodů v rozšířené realitě (AR). Aplikace zobrazuje geodetické body přímo v obraze z kamery a naviguje uživatele k nim pomocí směrové šipky, kompasu a mapy.

## Funkce

- **AR navigace** — body se zobrazují přes obraz z kamery se směrovou šipkou k cíli
- **Mapa** — zobrazení bodů v mapě (Leaflet + esri-leaflet) s podkladem ČÚZK
- **Souřadnicové systémy** — převod souřadnic přes proj4 (např. S-JTSK / Křovák ↔ WGS84)
- **Offline režim** — díky service workeru funguje aplikace i bez připojení
- **Instalovatelná PWA** — lze přidat na plochu telefonu jako nativní aplikaci

## Technologie

Aplikace je čistě klientská (statický web), bez build kroku:

- HTML / CSS / JavaScript (vanilla)
- [Leaflet](https://leafletjs.com/) 1.9.4 + [esri-leaflet](https://github.com/Esri/esri-leaflet) 3.0.12 — mapa
- [proj4js](http://proj4js.org/) 2.9.0 — převody souřadnic
- Service Worker + Web App Manifest — PWA / offline

## Spuštění

Protože jde o statický web, stačí ho servírovat přes libovolný HTTP server (kvůli service workeru a kameře je potřeba `https` nebo `localhost`).

```bash
# Python
python -m http.server 8000

# nebo Node.js
npx serve
```

Poté otevři `http://localhost:8000` v prohlížeči.

> **Pozn.:** Přístup ke kameře a geolokaci vyžaduje zabezpečený kontext (HTTPS nebo localhost). Při nasazení na GitHub Pages je HTTPS automaticky.

## Nasazení na GitHub Pages

V nastavení repozitáře (**Settings → Pages**) vyber zdroj `Deploy from a branch`, větev `main` a složku `/ (root)`. Aplikace pak poběží na adrese `https://<uzivatel>.github.io/<nazev-repo>/`.

## Struktura

```
.
├── index.html      # celá aplikace (UI + logika)
├── manifest.json   # PWA manifest
├── sw.js           # service worker (offline cache)
└── README.md
```
