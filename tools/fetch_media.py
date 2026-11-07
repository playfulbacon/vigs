#!/usr/bin/env python3
"""Find box art for games and logos for orgs, and record them as remote image references.

    python3 tools/fetch_media.py               # fill records that have no box_art / logo yet
    python3 tools/fetch_media.py --force       # look everything up again
    python3 tools/fetch_media.py --only games  # or: --only orgs
    python3 tools/fetch_media.py --dry-run     # report, write nothing
    python3 tools/fetch_media.py --ids celeste,klei-entertainment

Nothing is downloaded into the repo. Each hit is written as

    box_art:            # or logo:
      source_url: <remote image URL, checked to return 200 + image/*>
      credit: "<developer>; image via Steam"
      license: Non-free; used for identification
      permission: unknown

Games: Steam first (links.steam, else a strict store search whose name must match the title
and whose developer/publisher must match the record), then the infobox image of links.wikipedia.
Orgs: only studios, publishers, platform holders and community bodies, and only from a Wikipedia
article that is either linked from the record or titled exactly like the org with a short
description that fits. The page image must look like a logo (an SVG or a file named *logo*).

Stdlib + PyYAML only. Requests are paced per host and back off on HTTP 429.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = "vigs-oral-history/0.1 (https://github.com/playfulbacon/vigs)"
LICENSE = "Non-free; used for identification"


# --- YAML (same date-as-string loader as tools/vigs.py, without its jsonschema import) ---

class Loader(yaml.SafeLoader):
    pass


Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def read_yaml(path):
    return yaml.load(Path(path).read_text(), Loader=Loader)


# --- HTTP -------------------------------------------------------------------------------

MIN_INTERVAL = {"default": 1.0, "wikimedia": 2.0}
_last = {}


class RateLimited(Exception):
    pass


def _host_key(host):
    return "wikimedia" if host.endswith(("wikipedia.org", "wikimedia.org", "wikidata.org")) else host


def http(url, method="GET", max_wait=60, extra_headers=None):
    """Return (status, headers, body). Paces each host, backs off on 429 up to max_wait seconds."""
    host = urllib.parse.urlsplit(url).hostname or ""
    key = _host_key(host)
    interval = MIN_INTERVAL.get(key, MIN_INTERVAL["default"])
    delay = 2.0
    while True:
        wait = _last.get(key, 0) + interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last[key] = time.monotonic()
        headers = {"User-Agent": UA, "Accept-Encoding": "identity"}
        headers.update(extra_headers or {})
        req = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read() if method == "GET" else b""
                return r.status, dict(r.headers), body
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if delay > max_wait:
                    raise RateLimited(url)
                retry_after = e.headers.get("Retry-After")
                pause = delay
                if retry_after and retry_after.isdigit():
                    pause = min(max(float(retry_after), delay), max_wait)
                print(f"    429 from {host}; waiting {pause:.0f}s", file=sys.stderr)
                time.sleep(pause)
                delay *= 2
                continue
            return e.code, dict(e.headers or {}), b""
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            print(f"    network error for {url}: {e}", file=sys.stderr)
            return 0, {}, b""


def get_json(url, **kw):
    status, _, body = http(url, **kw)
    if status != 200:
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def is_image(url):
    """True only if url answers 200 with an image/* content type. Raises RateLimited."""
    status, headers, _ = http(url, method="HEAD")
    if status in (405, 403, 0):
        status, headers, _ = http(url, extra_headers={"Range": "bytes=0-1023"})
        if status == 206:
            status = 200
    ctype = {k.lower(): v for k, v in headers.items()}.get("content-type", "")
    return status == 200 and ctype.lower().startswith("image/")


# --- Names ------------------------------------------------------------------------------

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("™", "").replace("®", "").replace("©", "").replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"^the ", "", s)


COMPANY_WORDS = r"\b(games?|studios?|entertainment|interactive|software|inc|llc|ltd|co|corp|media|digital)\b"


def norm_company(s):
    return re.sub(r"\s+", " ", re.sub(COMPANY_WORDS, " ", norm(s))).strip()


# Fallback suffixes accepted only when no exact name match exists (and always flagged).
EDITION_SUFFIXES = ["remastered collection", "remastered", "definitive edition", "enhanced edition",
                    "complete edition", "game of the year edition", "goty edition", "anniversary edition"]


# --- Steam ------------------------------------------------------------------------------

STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/{}"


def steam_appid(url):
    m = re.search(r"/app/(\d+)", url or "")
    return m.group(1) if m else None


def steam_details(appid):
    j = get_json(f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=CA&l=en")
    if not j or not j.get(str(appid), {}).get("success"):
        return None
    return j[str(appid)]["data"]


def steam_year(details):
    m = re.search(r"(\d{4})", (details or {}).get("release_date", {}).get("date", "") or "")
    return int(m.group(1)) if m else None


def steam_search(rec, makers):
    """Return (appid, note) or (None, reason). Strict on name, then checks developer/publisher."""
    titles = [rec["title"]] + list(rec.get("aliases") or [])
    terms = []
    for t in titles:
        terms.append(t)
        bare = re.sub(r"\s*\([^)]*\)\s*", " ", t).strip()   # "Fantastic Contraption (VR)"
        if bare != t:
            terms.append(bare)
    wanted = {norm(t) for t in terms}
    items = []
    for term in dict.fromkeys(terms):
        q = urllib.parse.quote(term)
        j = get_json(f"https://store.steampowered.com/api/storesearch/?term={q}&cc=CA&l=en")
        items += [i for i in (j or {}).get("items", []) if i.get("type") == "app"]
    seen = set()
    items = [i for i in items if not (i["id"] in seen or seen.add(i["id"]))]
    exact = [i for i in items if norm(i["name"]) in wanted]
    loose = []
    if not exact:
        for i in items:
            n = norm(i["name"])
            for w in wanted:
                if any(n == f"{w} {suf}" for suf in EDITION_SUFFIXES):
                    loose.append(i)
    candidates = [(i, None) for i in exact] or [(i, f'loose name match "{i["name"]}"') for i in loose]
    if not candidates:
        names = ", ".join(sorted({i["name"] for i in items})[:6])
        return None, f"no exact Steam name match (search returned: {names or 'nothing'})"
    rejected = []
    for item, flag in candidates:
        d = steam_details(item["id"]) or {}
        steam_makers = d.get("developers", []) + d.get("publishers", [])
        ok, why = makers_match(makers, steam_makers)
        if ok:
            note = "; ".join(x for x in [flag, why] if x)
            return str(item["id"]), note or None
        rejected.append(f'{item["name"]} ({item["id"]}) by {", ".join(steam_makers) or "?"}')
    return None, "Steam name matched but maker did not: " + "; ".join(rejected)


def makers_match(ours, theirs):
    """ours: names of the record's developers/publishers/credited people."""
    if not ours:
        return True, "no developer on record to cross-check"
    a = [norm_company(x) for x in ours if norm_company(x)]
    b = [norm_company(x) for x in theirs if norm_company(x)]
    for x in a:
        for y in b:
            if x == y or (len(x) > 3 and x in y) or (len(y) > 3 and y in x):
                return True, None
    return False, None


def steam_art(appid):
    for name in ("library_600x900.jpg", "header.jpg"):
        url = STEAM_CDN.format(appid, name)
        if is_image(url):
            return url
    return None


# --- Wikipedia --------------------------------------------------------------------------

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
_action_api_ok = [True]   # flipped to False if the action API keeps answering 429


def wiki_title(url):
    m = re.search(r"/wiki/(.+)$", url or "")
    return urllib.parse.unquote(m.group(1)).replace("_", " ") if m else None


def thumb_to_original(url):
    """https://…/thumb/c/c3/X.svg/250px-X.svg.png?… -> https://upload.wikimedia.org/…/c/c3/X.svg"""
    url = url.split("?")[0]
    m = re.match(r"https://[^/]+/wikipedia/([^/]+)/thumb/(\w/\w\w/[^/]+)/[^/]+$", url)
    if m:
        return f"https://upload.wikimedia.org/wikipedia/{m.group(1)}/{m.group(2)}"
    return url.replace("thumb.wikimedia.org", "upload.wikimedia.org")


def wiki_page(title):
    """Return {title, description, image, redirected, disambiguation, missing} for an enwiki title."""
    if _action_api_ok[0]:
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "formatversion": 2, "redirects": 1,
            "prop": "pageimages|description|pageprops", "piprop": "original",
            "ppprop": "disambiguation", "titles": title})
        try:
            j = get_json(f"{WIKI_API}?{q}", max_wait=32)
        except RateLimited:
            print("    Wikipedia action API keeps rate-limiting; using the REST summary endpoint",
                  file=sys.stderr)
            _action_api_ok[0] = False
            j = None
        if j and j.get("query", {}).get("pages"):
            p = j["query"]["pages"][0]
            redirects = j["query"].get("redirects", []) + j["query"].get("normalized", [])
            return {
                "title": p.get("title"),
                "description": p.get("description", ""),
                "image": (p.get("original") or {}).get("source"),
                "redirected": bool(j["query"].get("redirects")),
                "disambiguation": "disambiguation" in (p.get("pageprops") or {}),
                "missing": bool(p.get("missing")),
                "via": "action",
            }
    j = get_json(WIKI_REST + urllib.parse.quote(title.replace(" ", "_"), safe=""))
    if not j or "title" not in j:
        return {"missing": True}
    img = (j.get("originalimage") or {}).get("source")
    return {
        "title": j["title"],
        "description": j.get("description", ""),
        "image": thumb_to_original(img) if img else None,
        "redirected": norm(j["title"]) != norm(title),
        "disambiguation": j.get("type") == "disambiguation",
        "missing": False,
        "via": "rest",
    }


FREE_LICENSE = re.compile(r"^(public domain|pd|cc0|cc[ -]by)", re.I)


def wiki_file_license(image_url):
    """Best effort: the file page's short license name, if the action API is reachable."""
    if not _action_api_ok[0] or "/commons/" not in image_url:
        return None
    fname = urllib.parse.unquote(image_url.rsplit("/", 1)[-1])
    q = urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": 2,
                                "prop": "imageinfo", "iiprop": "extmetadata",
                                "titles": f"File:{fname}"})
    try:
        j = get_json(f"{WIKI_API}?{q}", max_wait=16)
    except RateLimited:
        return None
    try:
        meta = j["query"]["pages"][0]["imageinfo"][0]["extmetadata"]
        return meta.get("LicenseShortName", {}).get("value")
    except (TypeError, KeyError, IndexError):
        return None


# --- Orgs: which ones, and which pages ---------------------------------------------------

ORG_KINDS = {"indie-studio", "mid-size-studio", "aaa-studio", "audio-studio", "publisher",
             "platform-holder", "community", "collective", "industry-association", "event-series"}
GAMES_RX = r"video ?games?|\bgames? (developer|development|publisher|studio|company)|\bgaming company"
DESC_OK = {
    "studio": GAMES_RX,
    "audio": GAMES_RX + r"|\baudio\b|\bsound\b",
    "publisher": GAMES_RX + r"|multinational|conglomerate|technology (company|corporation)|mass media",
    "community": GAMES_RX + r"|non-?profit|organi[sz]ation|association|conference|collective",
}
KIND_GROUP = {"indie-studio": "studio", "mid-size-studio": "studio", "aaa-studio": "studio",
              "audio-studio": "audio", "publisher": "publisher", "platform-holder": "publisher",
              "community": "community", "collective": "community",
              "industry-association": "community", "event-series": "community"}


def looks_like_logo(url):
    f = urllib.parse.unquote(url.rsplit("/", 1)[-1]).lower()
    return f.endswith(".svg") or "logo" in f or "wordmark" in f


# --- Writing ----------------------------------------------------------------------------

def insert_keys(path, rec, image_key, image, steam_url=None):
    """Insert the image block (and links.steam) into the file text, leaving everything else as is."""
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    top = {}
    for n, line in enumerate(lines):
        m = re.match(r"^([A-Za-z_][\w-]*):", line)
        if m:
            top.setdefault(m.group(1), n)

    def block_end(start):
        n = start + 1
        while n < len(lines) and (lines[n].startswith((" ", "\t")) or not lines[n].strip()):
            n += 1
        return n

    if image_key in top:   # --force: drop the old block first
        s = top[image_key]
        del lines[s:block_end(s)]
    return insert_keys_text(path, lines, rec, image_key, image, steam_url)


def insert_keys_text(path, lines, rec, image_key, image, steam_url):
    def index():
        top = {}
        for n, line in enumerate(lines):
            m = re.match(r"^([A-Za-z_][\w-]*):", line)
            if m:
                top.setdefault(m.group(1), n)
        return top

    def before_tail(top):
        for k in ("accounts", "sensitive_note", "status"):
            if k in top:
                return top[k]
        return len(lines)

    top = index()
    if steam_url:
        if "links" in top and lines[top["links"]].strip() == "links:":
            n = top["links"] + 1
            while n < len(lines) and lines[n].startswith("  "):
                n += 1
            lines.insert(n, f"  steam: {steam_url}\n")
        elif "links" not in top:
            lines[before_tail(top):before_tail(top)] = [f"links:\n  steam: {steam_url}\n"]
        else:
            raise ValueError(f"{path}: links is not a simple block; add steam by hand")
        top = index()
    at = top.get("links", before_tail(top))
    block = yaml.safe_dump({image_key: image}, sort_keys=False, allow_unicode=True, width=100)
    lines.insert(at, block)
    new = "".join(lines)

    expected = dict(rec)
    expected.pop(image_key, None)
    check = yaml.load(new, Loader=Loader)
    exp = {k: v for k, v in expected.items()}
    if steam_url:
        exp["links"] = dict(exp.get("links") or {}, steam=steam_url)
    exp[image_key] = image
    if check != exp:
        raise ValueError(f"{path}: text insertion changed more than intended")
    return new


# --- Main -------------------------------------------------------------------------------

def load(kind):
    return {p.stem: (read_yaml(p), p) for p in sorted((DATA / kind).glob("*.yaml"))}


def image_block(url, credit, license=LICENSE, permission="unknown"):
    return {"source_url": url, "credit": credit, "license": license, "permission": permission}


def do_games(games, orgs, people, args, report):
    def name_of(i):
        return (orgs.get(i, ({},))[0] or {}).get("name") or i

    found = {}
    for gid, (rec, path) in games.items():
        if args.ids and gid not in args.ids:
            continue
        if rec.get("box_art") and not args.force:
            report["skipped"].append(("game", gid))
            continue
        print(f"game {gid}")
        makers = [name_of(i) for i in (rec.get("developers") or []) + (rec.get("publishers") or [])]
        for o in (rec.get("developers") or []) + (rec.get("publishers") or []):
            makers += list((orgs.get(o, ({},))[0] or {}).get("aliases") or [])
        makers += [(people.get(c["person"], ({},))[0] or {}).get("name", "")
                   for c in rec.get("credits") or []]
        makers = [m for m in makers if m]
        dev = rec.get("developers") or rec.get("publishers")
        credit_name = name_of(dev[0]) if dev else rec["title"]
        links = rec.get("links") or {}
        url = src = note = None
        appid = steam_appid(links.get("steam"))
        steam_new = None
        try:
            if appid:
                note = "links.steam"
            else:
                appid, note = steam_search(rec, makers)
                if appid:
                    steam_new = f"https://store.steampowered.com/app/{appid}/"
            if appid:
                url = steam_art(appid)
                src = "Steam" if url else None
                if not url:
                    note = f"Steam app {appid} has no capsule/header image"
            if not url and links.get("wikipedia"):
                page = wiki_page(wiki_title(links["wikipedia"]))
                img = page.get("image")
                if img and is_image(img):
                    url, src = img, "Wikipedia"
                else:
                    note = (note or "") + "; Wikipedia page has no usable image"
        except RateLimited as e:
            note = f"rate-limited ({e})"
        if url:
            found[gid] = dict(url=url, src=src, appid=appid if src == "Steam" else None,
                              steam_new=steam_new, credit=f"{credit_name}; image via {src}",
                              note=note, rec=rec, path=path)
            print(f"  -> {src}: {url}" + (f"  [{note}]" if note else ""))
        else:
            report["miss"].append(("game", gid, rec["title"], note or "not on Steam; no Wikipedia link"))
            print(f"  -- miss: {note}")

    # Two records resolving to one Steam app (e.g. a game and its remake): keep the closest year.
    by_app = {}
    for gid, f in found.items():
        if f["appid"]:
            by_app.setdefault(f["appid"], []).append(gid)
    for appid, gids in by_app.items():
        if len(gids) < 2:
            continue
        year = steam_year(steam_details(appid))

        def first_year(g):
            rel = (found[g]["rec"].get("releases") or [{}])[0].get("date")
            v = rel.get("value") if isinstance(rel, dict) else rel
            return int(str(v)[:4]) if v and str(v)[:4].isdigit() else 0
        gids.sort(key=lambda g: (found[g]["steam_new"] is not None, abs(first_year(g) - (year or 0))))
        for g in gids[1:]:
            f = found.pop(g)
            report["miss"].append(("game", g, f["rec"]["title"],
                                   f"Steam app {appid} belongs to {gids[0]}"))
    for gid, f in found.items():
        img = image_block(f["url"], f["credit"])
        if f["note"] and ("loose" in f["note"] or "no developer" in f["note"]):
            report["doubtful"].append(("game", gid, f["note"]))
        report["found"].append(("game", gid, f["src"]))
        if not args.dry_run:
            f["path"].write_text(insert_keys(f["path"], f["rec"], "box_art", img, f["steam_new"]))


def do_orgs(orgs, args, report):
    for oid, (rec, path) in orgs.items():
        if args.ids and oid not in args.ids:
            continue
        if rec.get("logo") and not args.force:
            report["skipped"].append(("org", oid))
            continue
        if rec["kind"] not in ORG_KINDS:
            report["miss"].append(("org", oid, rec["name"], f"kind {rec['kind']} not looked up"))
            continue
        print(f"org {oid}")
        linked = wiki_title((rec.get("links") or {}).get("wikipedia"))
        note = None
        url = None
        license = LICENSE
        try:
            for title in ([linked] if linked else [rec["name"]]):
                page = wiki_page(title)
                if page.get("missing"):
                    note = f'no Wikipedia page "{title}"'
                    continue
                if not linked:
                    if page["disambiguation"]:
                        note = f'"{title}" is a disambiguation page'
                        continue
                    if page["redirected"]:
                        note = f'"{title}" redirects to "{page["title"]}"'
                        continue
                    if not re.search(DESC_OK[KIND_GROUP[rec["kind"]]], page["description"] or "", re.I):
                        note = f'"{title}" description does not fit: "{page["description"]}"'
                        continue
                img = page.get("image")
                if not img:
                    note = f'"{page["title"]}" has no page image'
                    continue
                if not looks_like_logo(img):
                    note = f'page image does not look like a logo: {img.rsplit("/", 1)[-1]}'
                    continue
                if not is_image(img):
                    note = f"image URL did not verify: {img}"
                    continue
                url = img
                lic = wiki_file_license(img)
                if lic and FREE_LICENSE.match(lic):
                    license = lic
                note = f'"{page["title"]}" — {page["description"]}'
        except RateLimited as e:
            note = f"rate-limited ({e})"
        if url:
            perm = "public-license" if license != LICENSE else "unknown"
            img = image_block(url, f"{rec['name']}; image via Wikipedia", license, perm)
            report["found"].append(("org", oid, "Wikipedia"))
            print(f"  -> {url}  [{note}]")
            if not args.dry_run:
                path.write_text(insert_keys(path, rec, "logo", img))
        else:
            report["miss"].append(("org", oid, rec["name"], note))
            print(f"  -- miss: {note}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--force", action="store_true", help="look up records that already have an image")
    ap.add_argument("--dry-run", action="store_true", help="write nothing")
    ap.add_argument("--only", choices=["games", "orgs"])
    ap.add_argument("--ids", type=lambda s: set(s.split(",")), help="comma-separated record IDs")
    ap.add_argument("--report", help="also write the run summary as JSON to this path")
    args = ap.parse_args()

    games, orgs, people = load("games"), load("orgs"), load("people")
    report = {"found": [], "miss": [], "doubtful": [], "skipped": []}
    if args.only in (None, "games"):
        do_games(games, orgs, people, args, report)
    if args.only in (None, "orgs"):
        do_orgs(orgs, args, report)

    from collections import Counter
    print("\n== Summary", dt.date.today().isoformat())
    for (kind, src), n in sorted(Counter((f[0], f[2]) for f in report["found"]).items()):
        print(f"  {kind:5} via {src:10} {n}")
    print(f"  skipped (already had an image): {len(report['skipped'])}")
    print(f"  misses: {len(report['miss'])}")
    for m in report["miss"]:
        print(f"    {m[0]:5} {m[1]:32} {m[3]}")
    if report["doubtful"]:
        print("  doubtful matches (accepted, check by hand):")
        for d in report["doubtful"]:
            print(f"    {d[0]:5} {d[1]:32} {d[2]}")
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
