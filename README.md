# VIGS: Vancouver Indie Games Story

An oral history of the Vancouver indie game scene, built as a linked dataset so it can be explored as timelines, studio family trees, people pages and networks.

## What's here

| Path | Contents |
|---|---|
| `data/` | The dataset: one YAML file per event, person, game, organization, place, era, source, interview and claim. Start with [`data/README.md`](data/README.md). |
| `schema/` | JSON Schemas (written in YAML) for every record type |
| `tools/vigs.py` | Validate, build `dist/graph.json`, generate the name glossary |
| `research/` | The verified timeline that seeded the data (`vancouver-indie-timeline-v2.md`) |
| `research_notes/` | The detailed research notes behind it |
| `glossary/` | Name lists for transcription tools |
| `templates/` | Templates for interviews, claims and transcripts |
| `docs/interview-workflow.md` | How a recording becomes data |
| `media/` | Photos and box art (with credit and license recorded on each record) |
| `site/` | The interactive timeline (static HTML/JS, published to GitHub Pages) |

## Quick start

```sh
pip install pyyaml jsonschema
python3 tools/vigs.py validate
python3 tools/vigs.py build      # → dist/graph.json
python3 tools/vigs.py glossary   # → glossary/
python3 tools/vigs.py stats
```

To preview the site locally:

```sh
python3 tools/vigs.py build && python3 -m http.server -d site 8000   # open http://localhost:8000
```

The site deploys automatically via `.github/workflows/pages.yml` on every push.

`dist/graph.json` holds every record plus computed reverse links (a person's games, a studio's events, a place's residents), a date-sorted `timeline`, and people's ages at each event where a birth date is documented. Only public claims are included.

## Confidence

Every record carries a `status`: `verified`, `single-source`, `disputed`, `unverified` or `interview-only`. Disputed records keep each competing account with its sources. See [`data/README.md`](data/README.md).
