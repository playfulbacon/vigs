#!/usr/bin/env python3
"""VIGS data tool.

Usage:
  python3 tools/vigs.py validate        Check every record against its schema and all cross-references.
  python3 tools/vigs.py build           Validate, then write dist/graph.json (records + reverse links + ages).
  python3 tools/vigs.py glossary        Write glossary/ (name list for transcription tools).
  python3 tools/vigs.py stats           Count records by type and status.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHEMA = ROOT / "schema"
DIST = ROOT / "dist"
GLOSSARY = ROOT / "glossary"

# directory -> (schema file, type name)
TYPES = {
    "eras": ("era.yaml", "era"),
    "sources": ("source.yaml", "source"),
    "people": ("person.yaml", "person"),
    "orgs": ("org.yaml", "org"),
    "places": ("place.yaml", "place"),
    "games": ("game.yaml", "game"),
    "events": ("event.yaml", "event"),
    "interviews": ("interview.yaml", "interview"),
    "claims": ("claim.yaml", "claim"),
}

# Which record type each reference field points at.
# Key: (record type, dotted path where "[]" means each list item). Value: target type.
REFS = {
    "person": {
        "accounts[].sources[]": "source", "accounts[].claims[]": "claim",
        "born.sources[]": "source", "died.sources[]": "source", "age_reported[].sources[]": "source",
        "vancouver.sources[]": "source", "memberships[].org": "org", "memberships[].place": "place",
        "memberships[].sources[]": "source", "sources[]": "source",
    },
    "org": {
        "accounts[].sources[]": "source", "accounts[].claims[]": "claim",
        "founders[]": "person", "lineage[].org": "org", "lineage[].sources[]": "source", "sources[]": "source",
    },
    "place": {"sources[]": "source"},
    "game": {
        "accounts[].sources[]": "source", "accounts[].claims[]": "claim",
        "releases[].sources[]": "source", "developers[]": "org", "publishers[]": "org",
        "credits[].person": "person", "credits[].org": "org", "credits[].sources[]": "source",
        "audio_by[]": "org", "origin_event": "event", "made_at[]": "place",
        "awards[].sources[]": "source", "sales[].sources[]": "source", "crowdfunding.sources[]": "source",
        "sources[]": "source",
    },
    "event": {
        "era": "era", "people[]": "person", "games[]": "game", "orgs[]": "org", "places[]": "place",
        "sources[]": "source", "accounts[].sources[]": "source", "accounts[].claims[]": "claim",
        "claims[]": "claim",
    },
    "source": {"interview": "interview"},
    "interview": {"interviewees[]": "person"},
    "claim": {
        "speaker": "person", "interview": "interview", "source": "source",
        "about.events[]": "event", "about.people[]": "person", "about.games[]": "game",
        "about.orgs[]": "org", "about.places[]": "place", "about.eras[]": "era",
    },
}


# ---------------------------------------------------------------- loading

class Loader(yaml.SafeLoader):
    """SafeLoader that keeps dates as strings, so `date: 2012-06-17` and `date: "2012-06-17"` mean the same."""


Loader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def read_yaml(path):
    return yaml.load(Path(path).read_text(), Loader=Loader)


def load_schemas():
    registry = Registry()
    raw = {}
    for f in SCHEMA.glob("*.yaml"):
        doc = read_yaml(f)
        raw[f.name] = doc
        registry = registry.with_resource(f.name, Resource.from_contents(doc))
    return {name: Draft202012Validator(doc, registry=registry) for name, doc in raw.items()}


def load_records():
    """Return {type: {id: (record, path)}}."""
    out = {t: {} for _, t in TYPES.values()}
    for d, (_, t) in TYPES.items():
        for f in sorted((DATA / d).glob("*.yaml")):
            rec = read_yaml(f)
            out[t][f.stem] = (rec, f)
    return out


# ---------------------------------------------------------------- dates

DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$")


def date_value(d):
    if d is None:
        return None
    return d["value"] if isinstance(d, dict) else d


def date_range(d):
    """Earliest and latest possible calendar date for a fuzzy date."""
    v = date_value(d)
    if v is None:
        return None
    if v.endswith("s"):
        y = int(v[:4])
        return dt.date(y, 1, 1), dt.date(y + 9, 12, 31)
    m = DATE_RE.match(v)
    y, mo, da = int(m[1]), m[2], m[3]
    if da:
        x = dt.date(y, int(mo), int(da))
        return x, x
    if mo:
        mo = int(mo)
        nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
        return dt.date(y, mo, 1), nxt - dt.timedelta(days=1)
    return dt.date(y, 1, 1), dt.date(y, 12, 31)


def sort_key(d):
    r = date_range(d)
    return r[0].isoformat() if r else "9999"


def age_at(born, when):
    """Age (or 'a–b' range) of someone born on fuzzy date `born` at fuzzy date `when`."""
    b, w = date_range(born), date_range(when)
    if not b or not w:
        return None

    def years(birth, at):
        return at.year - birth.year - ((at.month, at.day) < (birth.month, birth.day))

    lo, hi = years(b[1], w[0]), years(b[0], w[1])
    return lo if lo == hi else f"{lo}–{hi}"


# ---------------------------------------------------------------- validation

def walk(obj, path):
    """Yield values at a dotted path with [] list expansion."""
    if obj is None:
        return
    if not path:
        yield obj
        return
    head, _, rest = path.partition(".")
    is_list = head.endswith("[]")
    key = head[:-2] if is_list else head
    val = obj.get(key) if isinstance(obj, dict) else None
    if val is None:
        return
    if is_list:
        for item in val:
            yield from walk(item, rest)
    else:
        yield from walk(val, rest)


def ref_id(v):
    return v["source"] if isinstance(v, dict) and "source" in v else v


def validate(records=None, quiet=False):
    schemas = load_schemas()
    records = records or load_records()
    errors, warnings = [], []
    dir_for = {t: d for d, (_, t) in TYPES.items()}

    for d, (schema_file, t) in TYPES.items():
        v = schemas[schema_file]
        for rid, (rec, path) in records[t].items():
            rel = path.relative_to(ROOT)
            if not isinstance(rec, dict):
                errors.append(f"{rel}: not a mapping")
                continue
            for e in v.iter_errors(rec):
                loc = "/".join(str(p) for p in e.absolute_path) or "(root)"
                errors.append(f"{rel}: {loc}: {e.message[:200]}")
            if rec.get("id") != rid:
                errors.append(f"{rel}: id '{rec.get('id')}' does not match file name")
            for field, target in REFS.get(t, {}).items():
                for val in walk(rec, field):
                    tid = ref_id(val)
                    if tid not in records[target]:
                        errors.append(f"{rel}: {field} -> unknown {target} '{tid}' (expected data/{dir_for[target]}/{tid}.yaml)")

    # events: date inside era bounds
    for rid, (rec, path) in records["event"].items():
        era = records["era"].get(rec.get("era"))
        if not era or "date" not in rec:
            continue
        e, ev = era[0], date_range(rec["date"])
        es, ee = date_range(e.get("start")), date_range(e.get("end"))
        if ev and es and ev[1] < es[0] or ev and ee and ev[0] > ee[1]:
            warnings.append(f"{path.relative_to(ROOT)}: date {date_value(rec['date'])} is outside era '{e['id']}'")
        if rec.get("status") == "disputed" and not rec.get("accounts"):
            warnings.append(f"{path.relative_to(ROOT)}: disputed but has no accounts")
        if not rec.get("sources") and rec.get("status") != "interview-only":
            warnings.append(f"{path.relative_to(ROOT)}: no sources")

    # sources: duplicate URLs
    seen = {}
    for rid, (rec, path) in records["source"].items():
        u = (rec.get("url") or "").rstrip("/").lower()
        if u and u in seen:
            errors.append(f"{path.relative_to(ROOT)}: duplicate url of source '{seen[u]}'")
        seen[u] = rid

    # claims: restricted interviews can't be public
    for rid, (rec, path) in records["claim"].items():
        iv = records["interview"].get(rec.get("interview"))
        if iv and rec.get("review") == "public":
            consent = iv[0].get("consent", {})
            if consent.get("status") not in ("granted", "partial") or "quotes" not in consent.get("scope", []):
                errors.append(f"{path.relative_to(ROOT)}: public claim but interview consent does not cover quotes")

    # unused sources
    used = set()
    for t, recs in records.items():
        for field, target in REFS.get(t, {}).items():
            if target != "source":
                continue
            for rec, _ in recs.values():
                used.update(ref_id(v) for v in walk(rec, field))
    for rid, (rec, _) in records["source"].items():
        if rid not in used and not rec.get("reading_list"):
            warnings.append(f"data/sources/{rid}.yaml: not cited by any record")

    if not quiet:
        for w in warnings:
            print(f"warn  {w}")
        for e in errors:
            print(f"ERROR {e}")
        n = sum(len(r) for r in records.values())
        print(f"\n{n} records, {len(errors)} errors, {len(warnings)} warnings")
    return records, errors, warnings


# ---------------------------------------------------------------- build

def build():
    records, errors, _ = validate(quiet=True)
    if errors:
        for e in errors:
            print(f"ERROR {e}")
        sys.exit(f"{len(errors)} errors; not building")

    g = {t: {rid: dict(rec) for rid, (rec, _) in recs.items()} for t, recs in records.items()}
    for t in g:
        for rec in g[t].values():
            rec["_links"] = {}

    def link(t, rid, key, val):
        if rid in g[t]:
            lst = g[t][rid]["_links"].setdefault(key, [])
            if val not in lst:
                lst.append(val)

    for gid, game in g["game"].items():
        for c in game.get("credits", []):
            link("person", c["person"], "games", gid)
        for o in game.get("developers", []):
            link("org", o, "developed", gid)
        for o in game.get("publishers", []):
            link("org", o, "published", gid)
        for o in game.get("audio_by", []):
            link("org", o, "audio_for", gid)
        for p in game.get("made_at", []):
            link("place", p, "games", gid)

    for eid, ev in g["event"].items():
        for kind, t in (("people", "person"), ("games", "game"), ("orgs", "org"), ("places", "place")):
            for x in ev.get(kind, []):
                link(t, x, "events", eid)
        link("era", ev["era"], "events", eid)
        # ages of people at the time of the event
        ages = {}
        for pid in ev.get("people", []):
            p = g["person"].get(pid, {})
            if p.get("born", {}).get("date"):
                ages[pid] = age_at(p["born"]["date"], ev["date"])
        if ages:
            ev["_ages"] = ages

    for pid, p in g["person"].items():
        for m in p.get("memberships", []):
            if "org" in m:
                link("org", m["org"], "people", pid)
            if "place" in m:
                link("place", m["place"], "people", pid)

    for oid, o in g["org"].items():
        for f in o.get("founders", []):
            link("person", f, "founded", oid)
        for l in o.get("lineage", []):
            link("org", l["org"], "lineage_from", oid)

    for cid, c in g["claim"].items():
        for kind, t in (("events", "event"), ("people", "person"), ("games", "game"), ("orgs", "org"), ("places", "place")):
            for x in c.get("about", {}).get(kind, []):
                link(t, x, "claims", cid)

    # strip non-public claims and private interview details from the public build
    g["claim"] = {k: v for k, v in g["claim"].items() if v.get("review") == "public"}
    for iv in g["interview"].values():
        iv.pop("archive", None)
        iv.pop("restrictions", None)

    timeline = sorted(g["event"], key=lambda k: (sort_key(g["event"][k]["date"]), k))
    out = {
        "generated": dt.date.today().isoformat(),
        "counts": {t: len(v) for t, v in g.items()},
        "timeline": timeline,
        **{t: v for t, v in g.items()},
    }
    DIST.mkdir(exist_ok=True)
    (DIST / "graph.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, default=str))
    print(f"wrote dist/graph.json ({sum(out['counts'].values())} records)")


# ---------------------------------------------------------------- glossary

def glossary():
    records = load_records()
    groups = {"People": [], "Games": [], "Studios & organizations": [], "Places": []}
    for t, label, key in (("person", "People", "name"), ("game", "Games", "title"),
                          ("org", "Studios & organizations", "name"), ("place", "Places", "name")):
        for rec, _ in records[t].values():
            groups[label].append(rec[key])
            groups[label].extend(rec.get("aliases", []))
    extra_file = GLOSSARY / "extra.yaml"
    extra = read_yaml(extra_file) if extra_file.exists() else {}
    for label, terms in (extra or {}).items():
        groups.setdefault(label, []).extend(terms)
    for k in groups:
        groups[k] = sorted(set(groups[k]), key=str.lower)

    GLOSSARY.mkdir(exist_ok=True)
    all_terms = sorted({t for v in groups.values() for t in v}, key=str.lower)
    (GLOSSARY / "glossary.txt").write_text("\n".join(all_terms) + "\n")
    # Whisper only uses the last ~224 tokens of its prompt, so keep the most-mentioned names.
    mentions = {}
    for rec, _ in records["event"].values():
        for kind, t, key in (("people", "person", "name"), ("games", "game", "title"), ("orgs", "org", "name")):
            for x in rec.get(kind, []):
                if x in records[t]:
                    name = records[t][x][0][key]
                    mentions[name] = mentions.get(name, 0) + 1
    prompt, used = "Interview about the Vancouver indie game scene. Names: ", []
    for name in sorted(mentions, key=lambda n: -mentions[n]):
        if len(prompt) + len(", ".join(used + [name])) > 750:
            break
        used.append(name)
    (GLOSSARY / "prompt.txt").write_text(prompt + ", ".join(used) + ".\n")
    md = ["# Name glossary", "",
          "Generated by `python3 tools/vigs.py glossary` from the dataset plus `glossary/extra.yaml`.",
          "Paste `glossary.txt` into a transcription tool's custom vocabulary, or `prompt.txt` (the most-mentioned names, short enough for Whisper's ~224-token initial prompt).", ""]
    for label, terms in groups.items():
        md += [f"## {label}", "", ", ".join(terms), ""]
    (GLOSSARY / "glossary.md").write_text("\n".join(md))
    print(f"wrote glossary/ ({len(all_terms)} terms)")


def stats():
    records = load_records()
    for t, recs in records.items():
        by = {}
        for rec, _ in recs.values():
            s = rec.get("status") or rec.get("review") or rec.get("process_status") or "-"
            by[s] = by.get(s, 0) + 1
        print(f"{t:10} {len(recs):4}  " + "  ".join(f"{k}={v}" for k, v in sorted(by.items())))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "validate"
    if cmd == "validate":
        _, errs, _ = validate()
        sys.exit(1 if errs else 0)
    elif cmd == "build":
        build()
    elif cmd == "glossary":
        glossary()
    elif cmd == "stats":
        stats()
    else:
        sys.exit(__doc__)
