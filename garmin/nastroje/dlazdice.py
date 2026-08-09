# Z OSM (Overpass "out geom") udela kompaktni dlazdici podkladu pro hodinky.
#
# Pouziti:
#   curl -s -X POST --data-binary @overpass-dotaz.txt \
#        https://overpass-api.de/api/interpreter -o osm.json
#   python dlazdice.py
#
# Vystup: {"a":[lat,lon], "r":dosah_m,
#          "l":[[trida, minx,miny,maxx,maxy, x,y, x,y, ...], ...]}
#
# Souradnice jsou CELA CISLA v DECIMETRECH od kotvy (x k vychodu, y k severu) -
# na displeji, kde 450 m odpovida ~100 px, je decimetr hluboko pod rozlisenim
# a cela cisla se v pameti hodinek drzi mnohem lip nez desetinna.
#
# Obalka kazde cary a poradi car podle dulezitosti se pocitaji TADY. Monkey C
# je na to moc pomaly - viz komentar u PORADI nize.
#
# Tohle je zatim rucni krok pro ukazkovou dlazdici do simulatoru. V ostrem
# provozu tutez praci udela Cloudflare Worker a hodinky si dlazdice stahnou
# pres makeWebRequest.
#
# Zdroj dat: OpenStreetMap, licence ODbL.
import json, math, sys, os

VSTUP = "osm.json"
VYSTUP = r"C:\Users\stepa\Desktop\ar_geodet\garmin\hodinky\resources\data\podklad.json"
LAT0, LON0, DOSAH = 50.08, 14.42, 450.0
STROP_VRCHOLU = 900

# tridy car (musi sedet s Podklad.mc)
SILNICE, CESTA, PESINA, VODA, BUDOVA, PREKAZKA = 1, 2, 3, 4, 5, 6

A = 6378137.0
E2 = 0.00669437999014


def polomery(lat_rad):
    s = math.sin(lat_rad)
    w = 1.0 - E2 * s * s
    return A * (1.0 - E2) / (w * math.sqrt(w)), A / math.sqrt(w)


M, N = polomery(math.radians(LAT0))
KOS = math.cos(math.radians(LAT0))


def na_metry(lat, lon):
    return (N * math.radians(lon - LON0) * KOS, M * math.radians(lat - LAT0))


def trida(tags):
    # Chodniky a prechody jsou v mestech mapovane jako samostatne cary a je
    # jich nasobne vic nez vseho ostatniho. Pro otazku "kudy se tam dostanu"
    # nerikaji nic a displej by z toho byl sedy - ven s nimi.
    if tags.get("footway") in ("sidewalk", "crossing") or tags.get("path") == "sidewalk":
        return None
    if tags.get("highway") == "service" and tags.get("service") in ("parking_aisle", "driveway"):
        return None
    if "building" in tags:
        return BUDOVA
    if tags.get("natural") == "cliff" or "barrier" in tags or tags.get("man_made") == "embankment":
        return PREKAZKA
    if "waterway" in tags or tags.get("natural") in ("water", "coastline"):
        return VODA
    h = tags.get("highway")
    if h:
        if h in ("footway", "path", "cycleway", "steps", "pedestrian"):
            return PESINA
        if h in ("track", "bridleway"):
            return CESTA
        return SILNICE
    return None


def dp(body, tol):
    """Douglas-Peucker."""
    if len(body) < 3:
        return body
    dmax, idx = 0.0, 0
    x1, y1 = body[0]
    x2, y2 = body[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    for i in range(1, len(body) - 1):
        px, py = body[i]
        if norm == 0:
            d = math.hypot(px - x1, py - y1)
        else:
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [body[0], body[-1]]
    return dp(body[: idx + 1], tol)[:-1] + dp(body[idx:], tol)


def zpracuj(data, tol, tridy_ven):
    cary = []
    for prvek in data.get("elements", []):
        if prvek.get("type") != "way" or "geometry" not in prvek:
            continue
        t = trida(prvek.get("tags", {}))
        if t is None or t in tridy_ven:
            continue
        body = [na_metry(g["lat"], g["lon"]) for g in prvek["geometry"]]
        # nechame jen cary, ktere aspon castecne zasahuji do dosahu
        if not any(math.hypot(x, y) <= DOSAH for x, y in body):
            continue
        zj = dp(body, tol)
        if len(zj) < 2:
            continue
        cara = [t]
        for x, y in zj:
            cara.append(int(round(x * 10)))
            cara.append(int(round(y * 10)))
        cary.append(cara)
    return cary


sys.setrecursionlimit(10000)
data = json.load(open(VSTUP, encoding="utf-8"))

# Postupne pritvrzujeme, dokud se to nevejde pod strop: nejdriv hrubsi
# zjednoduseni, pak lete pryc budovy (v mestě jich jsou stovky a na
# orientaci "kudy vede cesta" nejsou potreba).
for tol, ven in ((3.0, set()), (5.0, set()), (8.0, set()), (5.0, {BUDOVA}), (8.0, {BUDOVA})):
    cary = zpracuj(data, tol, ven)
    vrcholu = sum((len(c) - 1) // 2 for c in cary)
    print(f"tolerance {tol} m, bez {ven or 'niceho'}: {len(cary)} car, {vrcholu} vrcholu")
    if vrcholu <= STROP_VRCHOLU:
        break

# Kdyz ani to nestacilo, jdou pryc nejkratsi cary - ty na orientaci prispivaji
# nejmin a je jich nejvic. Kolik jich padlo, se vypise, aby to nebylo potichu.
def delka(c):
    d = 0.0
    for i in range(1, (len(c) - 1) // 2):
        d += math.hypot(c[2 * i + 1] - c[2 * i - 1], c[2 * i + 2] - c[2 * i])
    return d


if sum((len(c) - 1) // 2 for c in cary) > STROP_VRCHOLU:
    cary.sort(key=delka, reverse=True)
    puvodne = len(cary)
    ven, vrcholu = [], 0
    for c in cary:
        v = (len(c) - 1) // 2
        if vrcholu + v > STROP_VRCHOLU:
            continue
        ven.append(c)
        vrcholu += v
    print(f"strop {STROP_VRCHOLU} vrcholu: zahozeno {puvodne - len(ven)} nejkratsich car")
    cary = ven

# Obalka a poradi podle dulezitosti se pocitaji TADY, ne na hodinkach.
# Monkey C je pomaly: pouhe seskupeni 550 car podle tridy tam shodilo
# aplikaci na "Watchdog Tripped - Code Executed Too Long".
# Vysledny tvar cary: [trida, minx, miny, maxx, maxy, x,y, x,y, ...]
PORADI = [PREKAZKA, SILNICE, VODA, CESTA, PESINA, BUDOVA]

s_obalkou = []
for c in cary:
    xs = c[1::2]
    ys = c[2::2]
    s_obalkou.append([c[0], min(xs), min(ys), max(xs), max(ys)] + c[1:])
s_obalkou.sort(key=lambda c: PORADI.index(c[0]) if c[0] in PORADI else 99)
cary = s_obalkou

os.makedirs(os.path.dirname(VYSTUP), exist_ok=True)
out = {"a": [LAT0, LON0], "r": int(DOSAH), "l": cary}
with open(VYSTUP, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))

print("VYSLEDEK:", len(cary), "car,", sum((len(c) - 1) // 2 for c in cary), "vrcholu")
print("velikost:", os.path.getsize(VYSTUP), "B ->", VYSTUP)
poc = {}
for c in cary:
    poc[c[0]] = poc.get(c[0], 0) + 1
print("po tridach:", poc)
