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

Games: Steam first (links.steam, else a strict store search whose name must match the title and
whose developer/publisher must match the record), then the infobox image of links.wikipedia.
Orgs: only studios, publishers, platform holders and community bodies, and only from a Wikipedia
article that is either linked from the record or titled exactly like the org (no redirect, no
disambiguation page) with a short description that fits. The logo is the infobox `logo` field.

Wikipedia images are read from the article's infobox wikitext (action=raw, section 0), not from
the PageImages API: PageImages never returns non-free files, and almost all logos and covers are
non-free. File URLs on upload.wikimedia.org are derived from the file name (MD5 path) and
verified. The file page is then read for its license template.

Stdlib + PyYAML only. Requests are paced per host and back off on HTTP 429.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
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

MIN_INTERVAL = {"default": 1.0, "wikimedia": 3.0}
_last = {}


class RateLimited(Exception):
    pass


def _host_key(host):
    return "wikimedia" if host.endswith(("wikipedia.org", "wikimedia.org", "wikidata.org")) else host


def http(url, method="GET", max_wait=60, max_tries=8, extra_headers=None):
    """Return (status, headers, body). Paces each host; on 429 backs off 2, 4, ... 60 s, max_tries times.

    Wikimedia rate-limits shared egress IPs hard and intermittently, so patience beats giving up.
    """
    host = urllib.parse.urlsplit(url).hostname or ""
    key = _host_key(host)
    interval = MIN_INTERVAL.get(key, MIN_INTERVAL["default"])
    delay, tries = 2.0, 0
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
                tries += 1
                if tries > max_tries:
                    raise RateLimited(url)
                retry_after = e.headers.get("Retry-After")
                pause = min(delay, max_wait)
                if retry_after and retry_after.isdigit():
                    pause = min(max(float(retry_after), pause), max_wait)
                pause += random.uniform(0, 1)
                print(f"    429 from {host}; waiting {pause:.0f}s", file=sys.stderr, flush=True)
                time.sleep(pause)
                delay *= 2
                continue
            return e.code, dict(e.headers or {}), b""
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            print(f"    network error for {url}: {e}", file=sys.stderr, flush=True)
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


# Accepted only when no exact name match exists, and always reported as doubtful.
EDITION_SUFFIXES = ["remastered collection", "remastered", "definitive edition", "enhanced edition",
                    "complete edition", "game of the year edition", "goty edition", "anniversary edition"]


# --- Steam ------------------------------------------------------------------------------

STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/{}"


def steam_appid(url):
    m = re.search(r"/app/(\d+)", url or "")
    return m.group(1) if m else None


_details = {}


def steam_details(appid):
    if appid not in _details:
        j = get_json(f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=CA&l=en")
        ok = j and j.get(str(appid), {}).get("success")
        _details[appid] = j[str(appid)]["data"] if ok else None
    return _details[appid]


def steam_year(details):
    m = re.search(r"(\d{4})", (details or {}).get("release_date", {}).get("date", "") or "")
    return int(m.group(1)) if m else None


def makers_match(orgs_names, people_orgs, theirs):
    """orgs_names: the record's developer/publisher names. people_orgs: orgs founded by credited people."""
    b = [norm_company(x) for x in theirs if norm_company(x)]

    def hit(names):
        for x in (norm_company(n) for n in names):
            if not x:
                continue
            for y in b:
                if x == y or (len(x) > 3 and x in y) or (len(y) > 3 and y in x):
                    return True
        return False
    if hit(orgs_names):
        return True, None
    if hit(people_orgs):
        return True, "Steam maker is another studio founded by a credited person"
    if not orgs_names:
        return True, "no developer on record to cross-check"
    return False, None


def steam_search(rec, makers, people_orgs, other_titles):
    """Return (appid, note) or (None, reason). Strict on name, then checks developer/publisher."""
    terms = [rec["title"]] + list(rec.get("aliases") or [])
    bare = re.sub(r"\s*\([^)]*\)\s*", " ", rec["title"]).strip()   # "Fantastic Contraption (VR)"
    if bare != rec["title"]:
        terms.append(bare)
    wanted = {norm(t) for t in terms} - other_titles
    items = []
    for term in dict.fromkeys(terms):
        q = urllib.parse.quote(term)
        j = get_json(f"https://store.steampowered.com/api/storesearch/?term={q}&cc=CA&l=en")
        items += [i for i in (j or {}).get("items", []) if i.get("type") == "app"]
    seen = set()
    items = [i for i in items if not (i["id"] in seen or seen.add(i["id"]))]
    exact = [(i, None) for i in items if norm(i["name"]) in wanted]
    loose = [(i, f'loose name match "{i["name"]}"') for i in items
             if any(norm(i["name"]) == f"{w} {s}" for w in wanted for s in EDITION_SUFFIXES)]
    candidates = exact or loose
    if not candidates:
        names = ", ".join(sorted({i["name"] for i in items})[:6])
        return None, f"no exact Steam name match (search returned: {names or 'nothing'})"
    rejected = []
    for item, flag in candidates:
        d = steam_details(str(item["id"])) or {}
        theirs = d.get("developers", []) + d.get("publishers", [])
        ok, why = makers_match(makers, people_orgs, theirs)
        if ok:
            return str(item["id"]), "; ".join(x for x in [flag, why] if x) or None
        rejected.append(f'{item["name"]} ({item["id"]}) by {", ".join(dict.fromkeys(theirs)) or "?"}')
    return None, "Steam name matched but maker did not: " + "; ".join(rejected)


def steam_art(appid):
    for name in ("library_600x900.jpg", "header.jpg"):
        url = STEAM_CDN.format(appid, name)
        if is_image(url):
            return url
    # Newer apps keep assets under a hashed path; appdetails knows the header.
    header = ((steam_details(appid) or {}).get("header_image") or "").split("?")[0]
    if header and is_image(header):
        return header
    return None


# --- Wikipedia --------------------------------------------------------------------------

def wiki_title(url):
    m = re.search(r"/wiki/(.+)$", url or "")
    return urllib.parse.unquote(m.group(1)).replace("_", " ") if m else None


_raw = {}


def wiki_raw(title, host="en.wikipedia.org", section0=True):
    key = (title, host, section0)
    if key not in _raw:
        _raw[key] = _wiki_raw(title, host, section0)
    return _raw[key]


def _wiki_raw(title, host, section0):
    q = {"title": title.replace(" ", "_"), "action": "raw"}
    if section0:
        q["section"] = 0
    status, _, body = http(f"https://{host}/w/index.php?" + urllib.parse.urlencode(q))
    if status == 404:
        return None
    if status != 200:
        raise RuntimeError(f"HTTP {status} reading {title}")
    return body.decode("utf-8", "replace")


DISAMBIG = re.compile(r"\{\{\s*(disambiguation|disambig|dab|hndis|geodis|set index)", re.I)


def infobox_field(text, names):
    for name in names:
        m = re.search(r"^\s*\|\s*" + name + r"\s*=\s*(.*)$", text, re.M | re.I)
        if not m:
            continue
        v = m.group(1)
        v = re.sub(r"<!--.*?-->", "", v).strip()
        f = re.search(r"\[\[\s*(?:File|Image)\s*:\s*([^|\]]+)", v, re.I)
        if f:
            v = f.group(1)
        else:
            v = re.sub(r"^(File|Image)\s*:", "", v, flags=re.I).split("|")[0]
            if v.startswith("{{"):
                inner = re.search(r"\|\s*(?:1\s*=\s*)?([^|=}]+\.(?:svg|png|jpe?g|gif|webp))", v, re.I)
                v = inner.group(1) if inner else ""
        v = v.strip()
        if re.search(r"\.(svg|png|jpe?g|gif|webp|tiff?)$", v, re.I):
            return name, v
    return None, None


def wiki_page(title, image_fields):
    """{title, description, file, field, redirected, disambiguation, missing} for an enwiki title."""
    text = wiki_raw(title)
    redirected = False
    if text is not None:
        m = re.match(r"\s*#REDIRECT\s*\[\[([^\]|#]+)", text, re.I)
        if m:
            redirected, title = True, m.group(1).strip()
            text = wiki_raw(title)
    if text is None:
        return {"missing": True, "title": title}
    d = re.search(r"\{\{\s*short description\s*\|([^}]*)\}\}", text, re.I)
    field, fname = infobox_field(text, image_fields)
    return {
        "title": title,
        "description": d.group(1).strip() if d else "",
        "file": fname,
        "field": field,
        "redirected": redirected,
        "disambiguation": bool(DISAMBIG.search(text)),
        "missing": False,
    }


def file_urls(fname):
    name = fname.strip().replace(" ", "_")
    name = name[0].upper() + name[1:]
    h = hashlib.md5(name.encode("utf-8")).hexdigest()
    path = f"{h[0]}/{h[:2]}/{urllib.parse.quote(name)}"
    return [("en", f"https://upload.wikimedia.org/wikipedia/en/{path}"),
            ("commons", f"https://upload.wikimedia.org/wikipedia/commons/{path}")]


LICENSE_TEMPLATES = [
    (r"\{\{\s*(pd-textlogo|pd-logo|pd-simple|pd-shape)", "Public domain (simple logo / text, per Wikimedia file page)"),
    (r"\{\{\s*pd-", "Public domain (per Wikimedia file page)"),
    (r"\{\{\s*cc-zero", "CC0 1.0"),
    (r"\{\{\s*cc-by-sa-([\d.]+)", "CC BY-SA {}"),
    (r"\{\{\s*cc-by-([\d.]+)", "CC BY {}"),
]
NON_FREE = re.compile(r"\{\{\s*(non-free|logo fur|non-free use rationale|album cover fur)", re.I)


def wiki_license(where, fname):
    """Return (license, permission) from the file page's templates; non-free if unclear."""
    host = "commons.wikimedia.org" if where == "commons" else "en.wikipedia.org"
    try:
        text = wiki_raw("File:" + fname, host=host, section0=False) or ""
    except (RuntimeError, RateLimited):
        return LICENSE, "unknown"
    if NON_FREE.search(text):
        return LICENSE, "unknown"
    for rx, label in LICENSE_TEMPLATES:
        m = re.search(rx, text, re.I)
        if m:
            return label.format(*m.groups()), "public-license"
    return LICENSE, "unknown"


def wiki_image(page):
    """Verified upload.wikimedia.org URL for the page's infobox file, or None."""
    if not page.get("file"):
        return None, None
    urls = file_urls(page["file"])
    try:   # a local en file page means the file lives on en (usually non-free); else Commons
        local = wiki_raw("File:" + page["file"], section0=False) is not None
    except RuntimeError:
        local = None
    if local is not None:
        urls = [u for u in urls if (u[0] == "en") == local]
    for where, url in urls:
        if is_image(url):
            return url, where
    return None, None


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


def looks_like_logo(fname):
    f = fname.lower()
    return f.endswith(".svg") or "logo" in f or "wordmark" in f


# --- Writing ----------------------------------------------------------------------------

def insert_keys(path, rec, image_key, image, steam_url=None):
    """Insert the image block (and links.steam) into the file text, leaving everything else as is.

    Equivalent to setting the keys and yaml.safe_dump-ing the record, but without reflowing the
    hand-written file; the result is re-parsed and compared to make sure nothing else changed.
    """
    lines = path.read_text().splitlines(keepends=True)

    def index():
        top = {}
        for n, line in enumerate(lines):
            m = re.match(r"^([A-Za-z_][\w-]*):", line)
            if m:
                top.setdefault(m.group(1), n)
        return top

    def block_end(start):
        n = start + 1
        while n < len(lines) and (lines[n].startswith((" ", "\t")) or not lines[n].strip()):
            n += 1
        return n

    def before_tail(top):
        for k in ("accounts", "sensitive_note", "status"):
            if k in top:
                return top[k]
        return len(lines)

    top = index()
    if image_key in top:   # --force: replace the old block
        del lines[top[image_key]:block_end(top[image_key])]
        top = index()
    if steam_url and steam_url != (rec.get("links") or {}).get("steam"):
        if "links" in top and lines[top["links"]].strip() == "links:":
            lines.insert(block_end(top["links"]), f"  steam: {steam_url}\n")
        elif "links" not in top:
            at = before_tail(top)
            lines[at:at] = [f"links:\n  steam: {steam_url}\n"]
        else:
            raise ValueError(f"{path}: links is not a simple block; add steam by hand")
        top = index()
    at = top.get("links", before_tail(top))
    lines.insert(at, yaml.safe_dump({image_key: image}, sort_keys=False, allow_unicode=True, width=100))
    new = "".join(lines)

    exp = dict(rec)
    if steam_url:
        exp["links"] = dict(exp.get("links") or {}, steam=steam_url)
    exp[image_key] = image
    if yaml.load(new, Loader=Loader) != exp:
        raise ValueError(f"{path}: text insertion changed more than intended")
    return new


# --- Main -------------------------------------------------------------------------------

def load(kind):
    return {p.stem: (read_yaml(p), p) for p in sorted((DATA / kind).glob("*.yaml"))}


def image_block(url, credit, license=LICENSE, permission="unknown"):
    return {"source_url": url, "credit": credit, "license": license, "permission": permission}


def first_year(rec):
    rel = ((rec.get("releases") or [{}])[0] or {}).get("date")
    v = rel.get("value") if isinstance(rel, dict) else rel
    return int(str(v)[:4]) if v and str(v)[:4].isdigit() else 0


def do_games(games, orgs, people, args, report):
    def org(i):
        return (orgs.get(i) or ({},))[0] or {}

    titles = {gid: norm(rec["title"]) for gid, (rec, _) in games.items()}
    found = {}
    for gid, (rec, path) in games.items():
        if args.ids and gid not in args.ids:
            continue
        if rec.get("box_art") and not args.force:
            report["skipped"].append(("game", gid))
            continue
        print(f"game {gid}", flush=True)
        oids = (rec.get("developers") or []) + (rec.get("publishers") or [])
        makers = [org(i).get("name") or i for i in oids]
        for i in oids:
            makers += list(org(i).get("aliases") or [])
        credited = {c["person"] for c in rec.get("credits") or []}
        people_orgs = [o.get("name") for o, _ in orgs.values() if credited & set(o.get("founders") or [])]
        other_titles = {t for g, t in titles.items() if g != gid}
        credit_name = makers[0] if makers else rec["title"]
        links = rec.get("links") or {}
        url = src = note = flag = None
        appid = steam_appid(links.get("steam"))
        try:
            if not appid:
                appid, note = steam_search(rec, makers, people_orgs, other_titles)
                if appid:
                    flag, note = note, None
            if appid:
                url = steam_art(appid)
                src = "Steam" if url else None
                if not url:
                    note, flag = f"Steam app {appid} has no capsule/header image", None
            if not url and links.get("wikipedia"):
                page = wiki_page(wiki_title(links["wikipedia"]), ["image", "cover"])
                url, _ = wiki_image(page)
                if url:
                    src = "Wikipedia"
                else:
                    why = "no infobox image" if not page.get("file") else f'{page["file"]} did not verify'
                    note = f"{note}; Wikipedia: {why}" if note else f"Wikipedia: {why}"
        except (RateLimited, RuntimeError) as e:
            note = f"lookup failed ({e})"
        if url:
            found[gid] = dict(url=url, src=src, appid=appid if src == "Steam" else None,
                              credit=f"{credit_name}; image via {src}", note=flag, rec=rec, path=path)
            print(f"  -> {src}: {url}" + (f"  [{flag}]" if flag else ""), flush=True)
        else:
            report["miss"].append(("game", gid, rec["title"], note or "not on Steam; no Wikipedia link"))
            print(f"  -- miss: {note}", flush=True)

    # Two records on one Steam app (a game and its remake): keep links.steam, else the closest year.
    by_app = {}
    for gid, f in found.items():
        if f["appid"]:
            by_app.setdefault(f["appid"], []).append(gid)
    for appid, gids in by_app.items():
        if len(gids) < 2:
            continue
        year = steam_year(steam_details(appid)) or 0
        gids.sort(key=lambda g: (not (found[g]["rec"].get("links") or {}).get("steam"),
                                 abs(first_year(found[g]["rec"]) - year)))
        for g in gids[1:]:
            f = found.pop(g)
            report["miss"].append(("game", g, f["rec"]["title"], f"Steam app {appid} belongs to {gids[0]}"))

    for gid, f in found.items():
        steam_url = f"https://store.steampowered.com/app/{f['appid']}/" if f["appid"] else None
        if f["note"]:
            report["doubtful"].append(("game", gid, f["note"]))
        report["found"].append(("game", gid, f["src"]))
        if not args.dry_run:
            f["path"].write_text(insert_keys(f["path"], f["rec"], "box_art",
                                             image_block(f["url"], f["credit"]), steam_url))


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
        print(f"org {oid}", flush=True)
        linked = wiki_title((rec.get("links") or {}).get("wikipedia"))
        title = linked or rec["name"]
        url = note = None
        try:
            page = wiki_page(title, ["logo", "image"])
            if page["missing"]:
                note = f'no Wikipedia article "{title}"'
            elif not linked and page["disambiguation"]:
                note = f'"{title}" is a disambiguation page'
            elif not linked and page["redirected"] and norm(page["title"]) != norm(title):
                note = f'"{title}" redirects to "{page["title"]}"'
            elif not linked and not re.search(DESC_OK[KIND_GROUP[rec["kind"]]], page["description"], re.I):
                note = f'"{title}" description does not fit: "{page["description"]}"'
            elif not page["file"]:
                note = f'"{page["title"]}" has no infobox logo'
            elif page["field"] != "logo" and not looks_like_logo(page["file"]):
                note = f'infobox image is not a logo: {page["file"]}'
            else:
                url, where = wiki_image(page)
                if not url:
                    note = f'{page["file"]} did not verify'
        except (RateLimited, RuntimeError) as e:
            note = f"lookup failed ({e})"
        if url:
            lic, perm = wiki_license(where, page["file"])
            img = image_block(url, f"{rec['name']}; image via Wikipedia", lic, perm)
            report["found"].append(("org", oid, "Wikipedia"))
            print(f'  -> {url}  ["{page["title"]}" - {page["description"]}; {lic}]', flush=True)
            if not args.dry_run:
                path.write_text(insert_keys(path, rec, "logo", img))
        else:
            report["miss"].append(("org", oid, rec["name"], note))
            print(f"  -- miss: {note}", flush=True)


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

    print("\n== Summary", dt.date.today().isoformat())
    for (kind, src), n in sorted(Counter((f[0], f[2]) for f in report["found"]).items()):
        print(f"  {kind:5} via {src:10} {n}")
    print(f"  skipped (already had an image): {len(report['skipped'])}")
    print(f"  misses: {len(report['miss'])}")
    for m in report["miss"]:
        print(f"    {m[0]:5} {m[1]:32} {m[3]}")
    if report["doubtful"]:
        print("  accepted with a note (check by hand):")
        for d in report["doubtful"]:
            print(f"    {d[0]:5} {d[1]:32} {d[2]}")
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
