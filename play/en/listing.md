# QTRIG — English store listing for Google Play

Everything needed to publish QTRIG in English on Google Play. Copy the blocks into
**Play Console → Grow users → Store presence → Main store listing → Manage translations → English**.
Character limits are checked by `python play/kontrola-textu.py` (it checks this file too).

Prepared **17 October 2026** for app version v414+ (own map, works offline, 9 languages).
The Czech listing is in `play/texty.md`; the overall procedure is in `PUBLIKACE.md`.

---

## How to add English in Play Console (step by step) — written in Czech for you

> Aplikace v Playi je **jedna** (balíček `cz.stepanvcelak.argeodet`). Angličtina se nepřidává jako
> nová appka, ale jako **překlad záznamu v obchodě**. Appka sama se přepne do angličtiny podle jazyka
> telefonu (js/jazyky.js) — nový `.aab` **nahrávat netřeba**.
>
> 1. Play Console → QTRIG → **Růst uživatelů → Prezentace v obchodě → Hlavní záznam v obchodě**.
> 2. Vpravo nahoře **Spravovat překlady → Přidat vlastní překlady** → zaškrtni **angličtina (Spojené
>    státy) – en-US** (doporučuji přidat i **angličtina (Spojené království) – en-GB**; texty jsou stejné).
>    ⚠ Nezapínej „Strojový překlad Google" — přepsal by tvé texty.
> 3. Přepni se nahoře na jazyk **English** a vlož bloky níž: *App name*, *Short description*, *Full description*.
> 4. Grafika pro angličtinu (v téže obrazovce, záložka jazyka English):
>    - **App icon** se nepřekládá (zůstává `icon-512.png`),
>    - **Feature graphic**: `play/en/feature.png` (1024 × 500),
>    - **Phone screenshots**: `play/en/screenshots/01-map.png` … `05-tools.png` (1080 × 1920, v tomhle pořadí).
>      Snímky dělá `python scripts/gen_play_en.py` ze skutečné appky v angličtině. AR pohled (kamera) headless
>      vyfotit nejde: když na telefonu přepnutém do angličtiny uděláš snímek obrazovky AR a uložíš ho do kořene
>      repa jako `EN_AR.PNG`, skript ho přidá jako první snímek a feature graphic ho použije.
> 5. **Uložit** (dole). Překlad jde do kontroly spolu s dalším odesláním změn (*Přehled publikování → Odeslat změny ke kontrole*).
> 6. **Obsah aplikace (Policy → App content)** je společný pro všechny jazyky. Česká URL tam zůstávají; anglický
>    uživatel se na nich přepne odkazem „English" vpravo nahoře. Pokud chceš, aby tam byla anglická URL, použij
>    ty níž — **obě verze říkají totéž**. Formulář **Zabezpečení dat** musíš ale **aktualizovat** (záloha do účtu
>    a statistika telefonů přibyly 25. 9. 2026, viz oddíl Data safety níž) — jinak hrozí zamítnutí.
> 7. **Země a oblasti** (*Produkční verze → Země / oblasti*): vlastní mapa má data jen pro **Evropu**
>    (všechny evropské státy včetně UK, Turecka a Ukrajiny). Úřední body bodového pole appka umí v CZ, SK, AT,
>    CH, NL, FR, ES a v části Německa (Berlín, Meklenbursko, Bádensko-Württembersko). **Doporučení: vydej jen
>    v evropských zemích.** V USA, Kanadě nebo Austrálii by appka neměla mapu ani body a sbírala by špatná hodnocení.
> 8. **Kontaktní údaje** (*Nastavení obchodu*): e-mail pro uživatele je povinný a zobrazí se v obchodě anglicky
>    i česky — vyplň ho, pokud ještě není.

---

## App name (max 30 characters)

```
QTRIG – survey points in AR
```

## Short description (max 80 characters)

```
Find survey control points in AR. Map, cadastre and setting out — even offline.
```

## Full description (max 4000 characters)

```
QTRIG is a field companion for surveyors. Raise your phone, look through the camera and see where the survey control points are and which way to walk — no paper sketches, no long searching.

FIND POINTS IN THE FIELD
• Official survey control points shown right in the camera view, with distance and direction
• Point card: distance, bearing, national grid coordinates, height and the radius to search in
• Arrow guidance all the way to the point; route around buildings on the map
• Official control points in Czechia, Slovakia, Austria, Switzerland, the Netherlands, France, Spain and parts of Germany, straight from the national mapping agencies

YOUR OWN MAP, ALSO OFFLINE
• Clean vector map of the whole of Europe built from OpenStreetMap — buildings, roads, rails, water
• Cadastral parcels and orthophoto where the country publishes them
• Save the surroundings or a whole district to the phone and keep working without signal

YOUR POINTS AND JOBS
• New point from averaged GPS, by tapping the map or by reading coordinates from a photo
• Point codes (kerb, manhole, gully…) go straight into CSV and DXF
• Export and import coordinate lists; points sorted into jobs with notes
• Automatic backup to your account, so a phone reset does not cost you a day's work

MEASURING AND SETTING OUT
• Setting out points, lines and polylines with chainage and live offset
• Offsets, areas, intersections, radial points, free station and a calculator that shows the working
• Camera ruler and spirit level for quick checks on site
• Align north from known points when the phone's compass misbehaves

ACCURACY YOU CAN SEE
• GPS status, satellite count and accuracy estimate always on screen
• Explains why a phone measures to ±4 m, plus check measurements and a field test of your phone
• Note: QTRIG is a guide, not a surveying instrument — accuracy is that of the phone's GPS and compass, not of survey-grade equipment

NATIONAL COORDINATE SYSTEMS
• Coordinates in the national grid of 45 European countries (S-JTSK, British National Grid, Lambert-93, RD, LV95, ETRS89 / UTM and more), with national heights where available

BUILT FOR THE FIELD
• Works offline — downloaded data stays in the phone
• Saves battery, readable in bright sun, one-handed use, left-hand mode
• Gestures as shortcuts to your favourite tools
• In 9 languages: English, Czech, German, Polish, Spanish, Italian, French, Dutch and Portuguese

FOR STUDENTS
• Practice tasks, point recognition and formulas — the app adapts when you say you are a student

BASICS AND PRO
• Basics are free for good: finding points, map, cadastre, your own points, offsets, setting out from a list, calculator and more
• Pro adds the axis, radial points, geo-photo, shared jobs for a company and accounts with roles
• Until the end of 2026 Pro is free on request, straight from the app

DATA AND PRIVACY
Survey points and cadastral data come from the open data of national mapping and cadastral agencies (e.g. ČÚZK in Czechia, BEV in Austria, swisstopo in Switzerland, IGN in France). The map is © OpenStreetMap contributors. You need an account to use the app (a name and a password, no e-mail). Your location and the camera image are processed only on the phone; the server receives account data, anonymous usage records, error reports and a backup of your points (can be turned off). No ads. You can delete your account at any time in the app. Details are in the privacy policy.
```

---

## Release notes — "What's new" (max 500 characters, language en-US)

Used in *Testing / Production → Create release → Release notes*. The text goes between the tags:

```
<en-US>
• No more flashing old map at start-up — the QTRIG map is drawn straight away
• The map stores the places you view in the phone and shows them without signal
• "Save for offline", "Pack up the job" and "Download an area" now save the QTRIG map (smaller and faster)
• Weather radar, tacheometry and the sketch use the QTRIG map
</en-US>
```

(Czech for the same release: `<cs-CZ> … </cs-CZ>` from `data/co-je-noveho.json`, entry v414.)

---

## Other Console fields (English)

**Privacy policy URL** (one URL for all languages — the Czech one is fine, it links to English;
use this one if you prefer English as the main language):
```
https://stepanvcelak11.github.io/ar-geodet/privacy.html
```

**Account deletion URL** (Data safety → Delete account URL):
```
https://stepanvcelak11.github.io/ar-geodet/account-deletion.html
```

**Category:** Tools · **Tags:** Maps, Navigation & GPS tools, Productivity (choose what Console offers)

**Contact e-mail:** your support e-mail (required) · **Website:** `https://stepanvcelak11.github.io/ar-geodet/`

---

## App access (instructions for the reviewer, in English)

The app requires an account at start, so the reviewer needs the demo account.
**App content → App access → All or some functionality is restricted → Add instructions:**

- **Name:** Demo account
- **Username / account code:** `SUQP2D36`
- **Password:** `Geodet-Demo-2026`
- **Any other information required to access the app:**

```
On the start screen tap "Sign in (I have an account code)", enter the account code and the password. The account is on the Basics plan — exactly what a regular user gets. The app switches to English automatically when the phone language is English. Finding official survey control points in the camera needs a location in a country that publishes them (e.g. Czechia, Austria, Switzerland, France); elsewhere in Europe the app shows the map, cadastre where available and the user's own points. Camera, location and motion permissions are requested when the AR view is opened.
```

⚠ Before submitting, check that the demo account still signs in (the password cannot be recovered).

---

## Data safety (answers — same for all languages)

⚠ **Update needed compared with 13 Sept 2026:** since 25 Sept 2026 the app sends an automatic
**backup of points to the account** (on by default, can be turned off) and optional anonymous
**phone accuracy statistics**. Passkeys store only a public key. The table below is current and
matches `privacy.html` / `soukromi.html`.

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS)
- Do you provide a way for users to request that their data is deleted? **Yes** →
  `https://stepanvcelak11.github.io/ar-geodet/account-deletion.html`

All types below are **Collected**, **not Shared**, processed **not ephemerally**.

| Category | Data type | Required / optional | Purpose | Note |
|---|---|---|---|---|
| Personal info | Name | Required | App functionality, Account management | the name chosen at sign-up (need not be real) |
| Personal info | Email address / Phone number | Optional | Developer communications | only if the user fills in a contact |
| App activity | App interactions | Required | Analytics, App functionality | which tools were opened, number of points added — no coordinates |
| App activity | Other user-generated content | Optional | App functionality | **backup of the user's points, jobs and settings** (can be turned off), messages to the author, company point sync |
| App info and performance | Crash logs | Required | Analytics | error text, app version, phone type |
| App info and performance | Other app performance data | Optional | Analytics | phone model + accuracy figures from the Field test, anonymous, can be turned off |
| Device or other IDs | Device or other IDs | Required | Analytics, Fraud prevention, security | anonymous identifier derived from the browser |
| Location | Approximate / Precise location | **Not collected** | — | processed only on the phone; sent to third parties (mapping agencies, weather) only as a query parameter, not stored by the app's server |
| Photos and videos | — | **Not collected** | — | camera used for the live view only, nothing uploaded |
| Audio | Voice or sound recordings | **Not collected by the app** | — | voice notes stay on the phone; speech-to-text uses the system's recogniser (Google/Apple), which the user can switch off |
| Financial info | — | **Not collected** | — | nothing is sold inside the Google Play app |

> Judgement call — **point coordinates in the backup**: they are positions of things the user
> measured, i.e. user-created content, not the device's location history, so they are declared as
> *Other user-generated content*. If a reviewer asks, explain exactly that.

## Content rating (IARC questionnaire)

Category **Reference, News, or Educational / Utility**. No violence, sexuality, language, controlled
substances, gambling; users cannot interact or share content with strangers (company sharing is
invite-only); no purchases in the Google Play app → expected rating **3+ / PEGI 3 / Everyone**.

## Target audience and content

- Target age group: **18 and over** (professional tool) · The app is **not** designed for children
- Ads: **No** · In-app purchases: **No** (Pro is free on request until end of 2026; selling is hidden in the Play app)
- News app: No · Government app: No · Health: No · Financial features: No
- **Foreground service / special permissions:** none beyond camera, location and motion requested by the web app

---

## Graphics checklist

| Asset | File | Size |
|---|---|---|
| App icon | `icon-512.png` | 512 × 512 (shared for all languages) |
| Feature graphic | `play/en/feature.png` | 1024 × 500 |
| Phone screenshots | `play/en/screenshots/01-map.png` … `05-tools.png` | 1080 × 1920 |
| (optional) AR screenshot | put `EN_AR.PNG` in the repo root and run `python scripts/gen_play_en.py` | 1080 × 1920 |

The screenshots show the real app in English (own points of a job in central Prague, the QTRIG map),
not drawings — Google rejects listings with misleading screenshots.
