# Z OSM (Overpass "out geom") udela kompaktni dlazdici podkladu pro hodinky.
#
# Pouziti:
#   python dlazdice.py <lat> <lon> <vystup.json>
# Ocekava vedle sebe osm.json stazeny pro tutez polohu:
#   sed "s/LAT/50.08/;s/LON/14.42/" overpass-dotaz.txt > q.txt
#   curl -s -X POST --data-binary @q.txt https://overpass-api.de/api/interpreter -o osm.json
#
# Vystup:
#   {"a":[lat,lon], "r":dosah_m,
#    "p":[[trida, minx,miny,maxx,maxy, x,y, ...], ...],   plochy (vyplnene)
#    "l":[[trida, minx,miny,maxx,maxy, x,y, ...], ...]}   cary
#
# Souradnice jsou CELA CISLA v DECIMETRECH od kotvy (x k vychodu, y k severu) -
# na displeji, kde 450 m odpovida ~100 px, je decimetr hluboko pod rozlisenim
# a cela cisla se v pameti hodinek drzi mnohem lip nez desetinna.
#
# Obalka kazde cary a poradi podle dulezitosti se pocitaji TADY. Monkey C je
# na to moc pomaly: pouhe seskupeni 550 car podle tridy shodilo aplikaci na
# "Watchdog Tripped - Code Executed Too Long".
#
# Budovy se ukladaji JEN jako obalka (peti cisly), protoze se stejne kresli
# jako srafovany obdelnik - presny pudorys by na 260px displeji nikdo nepoznal
# a stal by desetkrat vic.
#
# Tohle je zatim rucni krok pro ukazkove dlazdice do simulatoru. V ostrem
# provozu tutez praci udela Cloudflare Worker a hodinky si dlazdice stahnou
# pres makeWebRequest.
#
# Zdroj dat: OpenStreetMap, licence ODbL.
import json, math, sys, os

DOSAH = 450.0

# tridy (musi sedet s Podklad.mc)
SILNICE, CESTA, PESINA, VODNI_TOK, PREKAZKA = 1, 2, 3, 4, 6
ZELEN, POLE, VODA, BUDOVA = 10, 11, 12, 13

PLOCHY = (ZELEN, POLE, VODA, BUDOVA)

# Co prezije rozpocet driv. Prekazky uplne napred - kvuli nim podklad hlavne je.
PORADI_CAR = [PREKAZKA, SILNICE, VODNI_TOK, CESTA, PESINA]
PORADI_PLOCH = [VODA, ZELEN, POLE, BUDOVA]

STROP_CAR = 700          # vrcholu v carach
STROP_PLOCH = 420        # vrcholu v plochach
STROP_BUDOV = 120        # kusu

A = 6378137.0
E2 = 0.00669437999014


def polomery(lat_rad):
    s = math.sin(lat_rad)
    w = 1.0 - E2 * s * s
    return A * (1.0 - E2) / (w * math.sqrt(w)), A / math.sqrt(w)


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

    # prekazky: sraz, nasep, zed, plot - to, kudy se neprojde
    if (tags.get("natural") in ("cliff", "earth_bank")
            or tags.get("man_made") == "embankment"
            or tags.get("barrier") in ("wall", "fence", "hedge", "retaining_wall", "guard_rail", "city_wall")):
        return PREKAZKA

    lu = tags.get("landuse")
    nat = tags.get("natural")
    lei = tags.get("leisure")

    if nat == "water" or lu in ("reservoir", "basin"):
        return VODA
    if "waterway" in tags:
        return VODNI_TOK

    if lu in ("forest", "grass", "village_green", "flowerbed", "cemetery", "recreation_ground") \
            or nat in ("wood", "scrub", "heath") \
            or lei in ("park", "garden", "pitch", "golf_course"):
        return ZELEN
    if lu in ("meadow", "farmland", "orchard", "vineyard", "allotments", "greenfield") \
            or nat == "grassland":
        return POLE

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


def obalka(zj):
    xs = [p[0] for p in zj]
    ys = [p[1] for p in zj]
    return [int(round(min(xs) * 10)), int(round(min(ys) * 10)),
            int(round(max(xs) * 10)), int(round(max(ys) * 10))]


def zpracuj(data, na_metry, tol):
    cary, plochy = [], []
    for prvek in data.get("elements", []):
        if prvek.get("type") != "way" or "geometry" not in prvek:
            continue
        t = trida(prvek.get("tags", {}))
        if t is None:
            continue

        body = [na_metry(g["lat"], g["lon"]) for g in prvek["geometry"]]
        if not any(math.hypot(x, y) <= DOSAH for x, y in body):
            continue

        zj = dp(body, tol)
        if len(zj) < 2:
            continue
        zaznam = [t] + obalka(zj)

        if t == BUDOVA:
            # jen obalka, zadne vrcholy - kresli se jako srafovany obdelnik
            plochy.append(zaznam)
            continue

        for x, y in zj:
            zaznam.append(int(round(x * 10)))
            zaznam.append(int(round(y * 10)))
        (plochy if t in PLOCHY else cary).append(zaznam)
    return cary, plochy


def vrcholu(z):
    return max(0, (len(z) - 5) // 2)


def orez(seznam, strop, poradi):
    """Serad podle dulezitosti a usekni na strop vrcholu. Co padlo, vypis."""
    seznam.sort(key=lambda z: (poradi.index(z[0]) if z[0] in poradi else 99, -vrcholu(z)))
    ven, v, budov = [], 0, 0
    for z in seznam:
        if z[0] == BUDOVA:
            if budov >= STROP_BUDOV:
                continue
            budov += 1
            ven.append(z)
            continue
        if v + vrcholu(z) > strop:
            continue
        ven.append(z)
        v += vrcholu(z)
    if len(ven) < len(seznam):
        print(f"  strop: zahozeno {len(seznam) - len(ven)} z {len(seznam)}")
    return ven


def main():
    if len(sys.argv) < 4:
        print(__doc__ or "pouziti: python dlazdice.py <lat> <lon> <vystup.json>")
        return 1
    lat0, lon0, vystup = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]

    M, N = polomery(math.radians(lat0))
    kos = math.cos(math.radians(lat0))

    def na_metry(lat, lon):
        return (N * math.radians(lon - lon0) * kos, M * math.radians(lat - lat0))

    sys.setrecursionlimit(10000)
    data = json.load(open("osm.json", encoding="utf-8"))

    cary, plochy = zpracuj(data, na_metry, 5.0)
    print(f"{lat0}, {lon0}: {len(cary)} car / {sum(vrcholu(c) for c in cary)} vrcholu, "
          f"{len(plochy)} ploch / {sum(vrcholu(p) for p in plochy)} vrcholu")

    cary = orez(cary, STROP_CAR, PORADI_CAR)
    plochy = orez(plochy, STROP_PLOCH, PORADI_PLOCH)

    os.makedirs(os.path.dirname(vystup) or ".", exist_ok=True)
    with open(vystup, "w", encoding="utf-8") as f:
        json.dump({"a": [lat0, lon0], "r": int(DOSAH), "p": plochy, "l": cary},
                  f, separators=(",", ":"))

    poc = {}
    for z in cary + plochy:
        poc[z[0]] = poc.get(z[0], 0) + 1
    print(f"  hotovo: {os.path.getsize(vystup)} B, po tridach {poc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
