# VIGS data

Every record is one YAML file. The file name is the record's ID (`data/people/maddy-thorson.yaml` has `id: maddy-thorson`). Records point at each other by ID, which is what lets the same data drive timelines, family trees, people pages and network views.

Schemas live in `schema/`. Check everything with:

```sh
python3 tools/vigs.py validate   # schemas + every cross-reference
python3 tools/vigs.py build      # writes dist/graph.json with reverse links and ages
python3 tools/vigs.py glossary   # writes glossary/ for transcription tools
python3 tools/vigs.py stats
```

## Types

| Folder | Type | What it is |
|---|---|---|
| `eras/` | Era | Chapters of the story |
| `events/` | Event | Plot points: foundings, releases, jams, closures, moves |
| `people/` | Person | The characters |
| `games/` | Game | Games, with releases, credits, awards, sales, box art |
| `orgs/` | Organization | Studios, publishers, Full Indie, events series, schools, programs |
| `places/` | Place | Indie House, venues, offices, campuses |
| `sources/` | Source | Everything cited |
| `interviews/` | Interview | One per recording: metadata and consent only |
| `claims/` | Claim | One statement from an interview or source, tagged to what it's about |

## Conventions

**IDs** are lowercase kebab-case slugs of the canonical name: `greg-lobanov`, `crypt-of-the-necrodancer`, `extremely-ok-games`. Events are `YYYY-MM-slug` (or `YYYY-slug` when the month is unknown): `2012-06-towerfall-prototyped`. Interviews are `YYYY-MM-DD-person`, and their claims `YYYY-MM-DD-person-001`. IDs never change once published; a rename becomes an alias.

**Dates** are fuzzy. Write `"1982"`, `"2012-06"`, `"2012-06-17"` or `"1990s"`. For more detail use an object:

```yaml
date: { value: "2016", qualifier: late, display: "late 2016" }
date: { value: "2012-10", approximate: true, note: "Month rests on Wikipedia only" }
```

**Status** on every record says how much to trust it:

| status | meaning |
|---|---|
| `verified` | Checked against an opened primary source or press article |
| `single-source` | One secondary source (usually Wikipedia alone) or a search snippet |
| `disputed` | Sources disagree. Fill in `accounts` with each version |
| `unverified` | Not checked yet |
| `interview-only` | Rests only on oral testimony |

**Significance** (events only) is a 1–3 editorial weight. It sets the dot size on the timeline and decides which events get a label:

| significance | meaning |
|---|---|
| `3` | Turning point: the story changes direction (Klei founded, first meetup, TowerFall prototyped, Indie House opens, Celeste released) |
| `2` | Notable: a meaningful step or milestone |
| `1` | Context: background that helps explain the rest |

It is a judgement call, set when the event is entered. Revisit it as interviews change what mattered.

**Display titles.** Game launches (release and early-access events) are shown under the game's name. When a game launches more than once, give the event a `display_title` with the difference in parentheses, e.g. `"Fantastic Contraption (iOS)"` or `"TowerFall Ascension: Dark World (expansion)"`. Early-access launches get "(Early Access)" automatically.

**Citations** are a source ID, or an object with detail:

```yaml
sources:
  - straight-2024-indie-hub
  - { source: wikipedia-towerfall, note: "Month of the house move" }
  - { source: 2026-12-01-sarah-northway, locator: "00:14:32" }
```

**People.** Only publicly documented personal facts. Birth dates only with a source; if a source gives only an age ("22-year-old" in May 2015), use `age_reported` rather than inventing a birth year. Pronouns only when the person has stated them. Use current names; aliases are public handles, never deadnames. `vancouver.tie` records how someone relates to the city (`resident`, `former-resident`, `collaborator`, `visitor`, `unconfirmed`). `consent` tracks what the person has agreed to once interviewed.

**Places.** Never record a private home address. Indie House is located only to "near Steveston, Richmond".

**Credits** live on the game (`credits: [{person, role}]`). Ties to studios, Full Indie roles and Indie House residency live on the person (`memberships`). The build step computes the reverse links.

**Sensitive history** (e.g. the 2019 allegations against Alec Holowka) is recorded neutrally, attributed to named sources, with a `sensitive_note` on the record.

## Interviews and claims

The public repo holds interview *metadata* and approved claims. Transcripts and audio live in the private archive; an interview record points to them under `archive`, and the build strips that field.

A claim moves `draft` → `approved` (by the interviewee, if they asked to review) → `public`. `restricted` never publishes. The validator refuses a `public` claim whose interview consent doesn't cover quotes, and the build drops every non-public claim.
