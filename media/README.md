# Media

Box art for games and logos for orgs are **referenced, not stored**. Each record carries an
`image` object (see `schema/common.yaml`) pointing at the picture on its original host:

```yaml
box_art:
  source_url: https://cdn.cloudflare.steamstatic.com/steam/apps/504230/library_600x900.jpg
  credit: Extremely OK Games; image via Steam
  license: Non-free; used for identification
  permission: unknown
```

The folders here (`games/`, `orgs/`, ...) stay empty unless someone is granted permission to host a
file, in which case it goes in `file:` and `permission` changes to `granted` or `press-kit`.

## Licensing stance

Covers, capsules and most logos are copyrighted and/or trademarked by their owners. The project
does not redistribute them: it links to them where the rights holder (Steam store pages) or
Wikipedia (under its non-free-content rules) already publishes them, at low resolution, to identify
the game or company being discussed. That is recorded as `license: Non-free; used for
identification`, `permission: unknown`. Where the Wikimedia file page tags a logo as public domain
(e.g. `{{PD-textlogo}}`, too simple for copyright) the license says so and `permission` is
`public-license`; trademark rights still apply. Anything we want to host or print needs a press kit or
explicit permission first. Photos of people are never fetched.

## `tools/fetch_media.py`

```sh
python3 tools/fetch_media.py               # fill records without box_art / logo
python3 tools/fetch_media.py --force       # redo everything
python3 tools/fetch_media.py --only orgs --ids klei-entertainment,relic-entertainment
python3 tools/fetch_media.py --dry-run --report /tmp/media.json
```

Stdlib + PyYAML. Sends `User-Agent: vigs-oral-history/0.1 (https://github.com/playfulbacon/vigs)`,
waits at least 1 s between requests to a host (3 s for Wikimedia), and on HTTP 429 backs off
2 s, 4 s, ... up to 60 s, eight times, before giving up on that record (a re-run picks it up).
Every URL it records answered 200 with an `image/*` content type. It edits the YAML text in place
(new keys go before `links`/`status`), re-parses the file and refuses to write if anything else
changed.

**Games.** Steam first. `links.steam` if present; otherwise the store search
(`/api/storesearch/?term=<title>&cc=CA&l=en`), accepting a result only if its name equals the title
or an alias after normalising case, punctuation, ™/® and a leading "The" (so *Celeste Classic*
never matches *Celeste*; a name that is another record's title is never accepted), **and** its
Steam developer/publisher matches the record's developer/publisher (or a credited person, or a
studio that person founded). "Remastered"/"Definitive Edition"-style names are only a fallback and
are reported. If two records land on one Steam app, the one already holding it (or with the closest
release year) keeps it. Image: `library_600x900.jpg` (portrait), else `header.jpg`, else the hashed
header URL from `appdetails`. The match is also written to `links.steam`. Otherwise the infobox
`image` of the record's `links.wikipedia` article.

**Orgs.** Only studios, publishers, platform holders, and community/association/event bodies
(schools and the tax credit are skipped). Uses `links.wikipedia`, or else the article titled exactly
like the org, accepted only if it is not a redirect to a different title, not a disambiguation page,
and its short description fits the kind (e.g. "video game developer"). The image is the infobox
`logo` field (an `image` field only if the file is an SVG or named *logo*).

*Why wikitext rather than PageImages:* the `prop=pageimages` API never returns non-free files, which
is what almost every cover and logo is, and the action API answered 429 for most of the run. The
script reads section 0 of the article with `action=raw`, takes the infobox file name, derives the
`upload.wikimedia.org` URL (MD5 path, `en` for local non-free files, `commons` otherwise), verifies
it, and reads the file page for its license template.

## Status (2026-11-07)

- Games: 55 of 63 have box art: 50 from Steam, 5 from Wikipedia (Bully, Cadence of Hyrule,
  Enviro-Bear 2000, Fantastic Contraption (2008), Retro City Rampage). `links.steam` is now set on 50 games (47 added by the script).
- Orgs: 30 of 90 have a logo, all from Wikipedia (16 tagged public domain on the file page, 14 non-free).

Worth a human look: *Rogue Legacy* (no developer on record, so the Steam match was name-only),
*Desert Golfing* (record says Blinkbat Games; Steam says Captain Games, Justin Smith's later studio),
*City of None*, *Horsey Game* and *Don't Starve Elsewhere* (landscape `header.jpg` only).

## Gaps

Fill these by hand (press kit, itch.io page, the studio's site) or with a correct `links.wikipedia`
/ `links.steam`, then re-run the script. A redirect usually means the org has no article of its own;
the target's logo would be someone else's.

### Games without box art (8)

| ID | Title | Why not found |
|---|---|---|
| `celeste-64` | Celeste 64: Fragments of the Mountain | no exact Steam name match (search returned: nothing) |
| `celeste-classic-2` | Celeste Classic 2: Lani's Trek | no exact Steam name match (search returned: nothing) |
| `celeste-classic` | Celeste Classic | no exact Steam name match (search returned: nothing) |
| `dauntless` | Dauntless | no exact Steam name match (search returned: Defense of the Dauntless) |
| `homeworld` | Homeworld | only Steam app is Homeworld Remastered Collection (244160), by Gearbox, not Relic |
| `masterpiece` | Masterpiece | no exact Steam name match (only differently named games came back) |
| `rebuild` | Rebuild | no exact Steam name match (only differently named games came back) |
| `skytorn` | Skytorn | no exact Steam name match (search returned: nothing) |

### Orgs without a logo (60)

| ID | Name | Kind | Why not found |
|---|---|---|---|
| `a-shell-in-the-pit` | A Shell in the Pit | audio-studio | no Wikipedia article "A Shell in the Pit" |
| `action-pants` | Action Pants | mid-size-studio | no Wikipedia article "Action Pants" |
| `bc-idmtc` | BC Interactive Digital Media Tax Credit | government-program | kind government-program not looked up |
| `black-box-games` | Black Box Games | aaa-studio | "Black Box Games" redirects to "EA Black Box" |
| `blinkbat-games` | Blinkbat Games | indie-studio | no Wikipedia article "Blinkbat Games" |
| `buffalo-buffalo` | Buffalo Buffalo | indie-studio | no Wikipedia article "Buffalo Buffalo" |
| `canadian-games-conference` | Canadian Games Conference | event-series | no Wikipedia article "Canadian Games Conference" |
| `captain-games` | Captain Games | indie-studio | no Wikipedia article "Captain Games" |
| `centre-for-digital-media` | Centre for Digital Media | school | kind school not looked up |
| `coldblood-inc` | Coldblood Inc. | indie-studio | no Wikipedia article "Coldblood Inc." |
| `daniel-mullins-games` | Daniel Mullins Games | indie-studio | no Wikipedia article "Daniel Mullins Games" |
| `digibc` | DigiBC | industry-association | no Wikipedia article "DigiBC" |
| `disney` | Disney Interactive | publisher | "Disney Interactive" redirects to "Disney Games Group" |
| `distinctive-software` | Distinctive Software Inc. | aaa-studio | "Distinctive Software Inc." redirects to "EA Vancouver" |
| `east-side-games` | East Side Games | mid-size-studio | no Wikipedia article "East Side Games" |
| `emily-carr-university` | Emily Carr University of Art + Design | school | kind school not looked up |
| `extremely-ok-games` | Extremely OK Games | indie-studio | "Extremely OK Games" redirects to "Maddy Thorson" |
| `fellow-traveller` | Fellow Traveller | publisher | no Wikipedia article "Fellow Traveller" |
| `finji` | Finji | publisher | "Finji" redirects to "Adam Saltsman" |
| `forte` | Forte | publisher | "Forte" description does not fit: "" |
| `full-indie-game-jam` | Full Indie Game Jam | event-series | no Wikipedia article "Full Indie Game Jam" |
| `full-indie-summit` | Full Indie Summit | event-series | no Wikipedia article "Full Indie Summit" |
| `full-indie` | Full Indie | community | "Full Indie" has no infobox logo |
| `garena` | Garena | publisher | "Garena" description does not fit: "Singaporean digital entertainment platform" |
| `gdc-canada` | GDC Canada | event-series | no Wikipedia article "GDC Canada" |
| `gearbox-publishing` | Gearbox Publishing | publisher | "Gearbox Publishing" redirects to "Gearbox Software" |
| `global-game-jam-vancouver` | Global Game Jam Vancouver | event-series | no Wikipedia article "Global Game Jam Vancouver" |
| `happy-ray-games` | Happy Ray Games | indie-studio | no Wikipedia article "Happy Ray Games" |
| `humble-games` | Humble Games | publisher | "Humble Games" redirects to "Balor Games" |
| `igda-vancouver` | IGDA Vancouver | industry-association | no Wikipedia article "IGDA Vancouver" |
| `igda-victoria` | IGDA Victoria | industry-association | no Wikipedia article "IGDA Victoria" |
| `infinite-fall` | Infinite Fall | indie-studio | no Wikipedia article "Infinite Fall" |
| `ivy-road` | Ivy Road | indie-studio | "Ivy Road" redirects to "Wanderstop" |
| `lasalle-college-vancouver` | LaSalle College Vancouver | school | kind school not looked up |
| `metanet-software` | Metanet Software | indie-studio | no Wikipedia article "Metanet Software" |
| `microsoft` | Microsoft | platform-holder | Wikimedia kept rate-limiting the file check (https://upload.wikimedia.org/wikipedia/commons/f/f5/Microsoft_logo_and_wordmark.svg) |
| `miniboss` | MiniBoss | indie-studio | no Wikipedia article "MiniBoss" |
| `northway-games` | Northway Games | indie-studio | "Northway Games" has no infobox logo |
| `orca-jam` | Orca Jam | event-series | no Wikipedia article "Orca Jam" |
| `ouya` | Ouya | platform-holder | "Ouya" description does not fit: "Android-based microconsole by Ouya Inc." |
| `power-up-audio` | Power Up Audio | audio-studio | no Wikipedia article "Power Up Audio" |
| `radical-entertainment` | Radical Entertainment | aaa-studio | Wikimedia kept rate-limiting the file check (https://upload.wikimedia.org/wikipedia/commons/3/3b/Radical_Entertainment_logo.svg) |
| `red-hook-studios` | Red Hook Studios | indie-studio | no Wikipedia article "Red Hook Studios" |
| `red-nexus-games` | Red Nexus Games | indie-studio | no Wikipedia article "Red Nexus Games" |
| `rocket-bear-games` | Rocket Bear Games | indie-studio | no Wikipedia article "Rocket Bear Games" |
| `rockstar-toronto` | Rockstar Toronto | aaa-studio | Wikimedia kept rate-limiting the file check (https://upload.wikimedia.org/wikipedia/commons/4/42/Rockstar_Toronto_Logo.svg) |
| `secret-lab` | Secret Lab | indie-studio | "Secret Lab" has no infobox logo |
| `simon-fraser-university` | Simon Fraser University | school | kind school not looked up |
| `sunset-visitor` | Sunset Visitor | indie-studio | no Wikipedia article "Sunset Visitor" |
| `tetragon-works` | Tetragon Works | indie-studio | no Wikipedia article "Tetragon Works" |
| `university-of-british-columbia` | University of British Columbia | school | kind school not looked up |
| `university-of-victoria` | University of Victoria | school | kind school not looked up |
| `vancouver-comic-arts-festival` | Vancouver Comic Arts Festival | event-series | no Wikipedia article "Vancouver Comic Arts Festival" |
| `vancouver-film-school` | Vancouver Film School | school | kind school not looked up |
| `vancouver-game-garden` | Vancouver Game Garden | event-series | no Wikipedia article "Vancouver Game Garden" |
| `vancouver-international-game-summit` | Vancouver International Game Summit | event-series | no Wikipedia article "Vancouver International Game Summit" |
| `vblank-entertainment` | Vblank Entertainment | indie-studio | no Wikipedia article "Vblank Entertainment" |
| `victoria-indie-meetup` | Victoria indie developer meetup | community | no Wikipedia article "Victoria indie developer meetup" |
| `vivendi` | Vivendi Universal Games | publisher | "Vivendi Universal Games" redirects to "Vivendi Games" |
| `wishes-unlimited` | Wishes Unlimited | indie-studio | "Wishes Unlimited" redirects to "Greg Lobanov" |
