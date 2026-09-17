# Data vlastní vektorové mapy (PMTiles v R2)

Appka (Nastavení → Vzhled → Nová mapa) čte jeden soubor **`evropa.pmtiles`** přes worker
`https://ar-geodet-api.ar-geodet.workers.dev/mapa/evropa.pmtiles` (HTTP Range, po kouskách).
Dokud soubor v R2 není, worker vrací 503 s tímhle návodem a appka řekne „data mapy nejsou k dispozici“.

## 1. Výřez z OpenStreetMap (Protomaps)
```
python scripts/mapa-vyrez.py test      # Praha ~2 MB (fixture pro testy)
python scripts/mapa-vyrez.py praha     # ~200 MB
python scripts/mapa-vyrez.py cr        # Česko ~1,7 GB, cca 8 min
python scripts/mapa-vyrez.py stred     # ČR+SK+PL+AT+DE ~6–8 GB
python scripts/mapa-vyrez.py 16.5,49.1,16.8,49.3   # vlastní bbox lon0,lat0,lon1,lat1
```
Výstup: `%TEMP%\qtrig-mapa\<název>.pmtiles`. Skript si sám stáhne `pmtiles.exe` (go-pmtiles).

## 2. Bucket v Cloudflare R2 (jednou)
dash.cloudflare.com → **R2 Object Storage** → *Create bucket* → název **`qtrig-mapa`** (10 GB/měsíc zdarma).

## 3. Nahrání
- **do 300 MB**: dashboard → bucket → *Upload* → soubor pojmenovat `evropa.pmtiles`.
- **větší** (Česko 1,7 GB): buď `wrangler r2 object put qtrig-mapa/evropa.pmtiles --file=cr.pmtiles`
  (potřebuje Node + `npx wrangler login`), nebo **rclone**:
  ```
  winget install Rclone.Rclone
  rclone config      # new remote "r2", typ s3, provider Cloudflare, access key + secret z
                     # R2 → Manage R2 API Tokens (Object Read & Write), endpoint
                     # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  rclone copyto %TEMP%\qtrig-mapa\cr.pmtiles r2:qtrig-mapa/evropa.pmtiles --s3-chunk-size 64M --progress
  ```

## 4. Zapojit worker
V `cloud/wrangler.toml` odkomentovat
```
[[r2_buckets]]
binding = "MAPA"
bucket_name = "qtrig-mapa"
```
a pushnout (nasazení jde přes GitHub Actions). Kontrola: `/health` hlásí `"mapa":true`,
`curl -I .../mapa/evropa.pmtiles` vrací 200 s `Accept-Ranges: bytes`.

## Obnova dat
Protomaps staví planetu denně. Nový výřez = kroky 1 a 3 znovu (přepsat soubor). Appka nic
necachuje přes service worker (Range), takže nová data jsou vidět hned.
