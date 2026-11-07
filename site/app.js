/* Vancouver Indie Games Story: interactive timeline.
   Reads graph.json (built by `python3 tools/vigs.py build`) and renders a timeline,
   detail panels, an interview planner and a list of open questions. No dependencies. */
(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let G = null;                 // the graph
  let zoom = 1;
  let focus = null;             // { type, id } entity being followed
  let selected = null;          // selected event id

  const LANES = [
    { id: "community", label: "Community", color: "--lane-community" },
    { id: "games", label: "Games", color: "--lane-games" },
    { id: "studios", label: "Studios & people", color: "--lane-studios" },
    { id: "industry", label: "AAA & industry", color: "--lane-industry" },
    { id: "context", label: "Policy & press", color: "--lane-context" },
  ];
  const STATUS_LABEL = { verified: "Verified", "single-source": "Single source", disputed: "Disputed", unverified: "Unverified", "interview-only": "Interview only" };
  const TIE_LABEL = { resident: "Resident", "former-resident": "Former resident", collaborator: "Collaborator", visitor: "Visitor", unconfirmed: "Unconfirmed" };
  const TYPE_NAMES = { person: "people", game: "games", org: "orgs", place: "places" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ------------------------------------------------------------ dates

  const dval = (d) => (d == null ? null : typeof d === "object" ? d.value : d);

  function drange(d) {
    const v = dval(d);
    if (!v) return null;
    if (v.endsWith("s")) { const y = +v.slice(0, 4); return [y, y + 10]; }
    const [y, m, day] = v.split("-").map(Number);
    if (day) { const t = y + ((m - 1) + (day - 1) / 31) / 12; return [t, t]; }
    if (m) return [y + (m - 1) / 12, y + m / 12];
    return [y, y + 1];
  }

  function dlabel(d) {
    if (d == null) return "";
    if (typeof d === "object" && d.display) return d.display;
    const v = dval(d);
    let s;
    if (v.endsWith("s")) s = v;
    else {
      const [y, m, day] = v.split("-");
      s = day ? `${MONTHS[+m - 1]} ${+day}, ${y}` : m ? `${MONTHS[+m - 1]} ${y}` : y;
    }
    if (typeof d === "object") {
      if (d.qualifier) s = `${d.qualifier} ${s}`;
      if (d.approximate) s = `c. ${s}`;
    }
    return s;
  }

  const sortKey = (d) => (drange(d) || [9999])[0];

  // ------------------------------------------------------------ scale
  // Years before 2008 are compressed: most of the story happens after 2010.

  const START = 1982, END = 2027.2;
  const weight = (y) => (y < 2000 ? 0.28 : y < 2008 ? 0.55 : 1);
  let PX_PER_YEAR = 90;
  const LEFT = 120;

  function xOf(t) {
    let x = LEFT;
    for (let y = START; y < END; y++) {
      const w = weight(y) * PX_PER_YEAR * zoom;
      if (t < y + 1) return x + Math.max(0, t - y) * w;
      x += w;
    }
    return x;
  }

  // ------------------------------------------------------------ lanes

  const COMMUNITY_TYPES = new Set(["jam", "meetup", "conference", "showcase", "leadership"]);
  const GAME_TYPES = new Set(["release", "early-access", "crowdfunding", "award", "cancellation", "announcement"]);
  const INDIE_KINDS = new Set(["indie-studio", "mid-size-studio", "audio-studio", "collective"]);
  const COMMUNITY_KINDS = new Set(["community", "event-series", "industry-association", "school"]);
  const AAA_KINDS = new Set(["aaa-studio", "publisher", "platform-holder"]);

  function laneOf(e) {
    if (e.type === "policy" || e.type === "publication") return "context";
    const kinds = (e.orgs || []).map((o) => G.org[o]?.kind).filter(Boolean);
    if (COMMUNITY_TYPES.has(e.type) || kinds.some((k) => COMMUNITY_KINDS.has(k)) && !kinds.some((k) => INDIE_KINDS.has(k))) return "community";
    if (kinds.length && kinds.every((k) => AAA_KINDS.has(k)) && !(e.games || []).length) return "industry";
    if (kinds.length && kinds.every((k) => AAA_KINDS.has(k)) && e.type === "layoff") return "industry";
    if (e.type === "layoff" && !kinds.length) return "industry";
    if (GAME_TYPES.has(e.type) && (e.games || []).length) return "games";
    return "studios";
  }

  // ------------------------------------------------------------ filters

  function passes(e) {
    const statuses = [...document.querySelectorAll('[data-filter="status"]:checked')].map((i) => i.value);
    if (!statuses.includes(e.status === "interview-only" ? "unverified" : e.status)) return false;
    const region = $("#region").value;
    const island = e.region === "victoria" || e.region === "vancouver-island";
    if (region === "vancouver" && island) return false;
    if (region === "island" && !island) return false;
    if ((e.significance || 1) < +$("#significance").value) return false;
    return true;
  }

  function inFocus(eid) {
    if (!focus) return true;
    const ent = G[focus.type][focus.id];
    return (ent?._links?.events || []).includes(eid) || (focus.type === "era" && G.event[eid].era === focus.id);
  }

  // ------------------------------------------------------------ render timeline

  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function render() {
    const svg = $("#timeline");
    svg.innerHTML = "";
    const width = xOf(END) + 40;
    const events = G.timeline.map((id) => G.event[id]).filter(passes);

    // pack events into rows per lane
    const ROW = 18, AXIS = 46, LANE_GAP = 14;
    const placed = [];
    const laneRows = {};
    for (const lane of LANES) laneRows[lane.id] = [];
    for (const e of events) {
      const r = drange(e.date); if (!r) continue;
      const end = e.end_date ? drange(e.end_date)[1] : r[1];
      // Bars only for real spans and genuinely uncertain dates; plain "2014" or "2014-06" is a dot mid-range.
      const d = e.date, v = dval(d);
      const uncertain = e.end_date || v.endsWith("s") || (typeof d === "object" && (d.approximate || d.qualifier));
      const x0 = xOf(r[0]), x1 = Math.max(xOf(end), x0);
      const rad = 3 + (e.significance || 1) * 1.6;
      const fuzzy = uncertain && x1 - x0 > 6;
      const cx = fuzzy ? x0 : (x0 + x1) / 2;
      const showLabel = (e.significance || 1) >= 3 || (focus && inFocus(e.id));
      const label = showLabel ? short(e.title) : "";
      const right = Math.max(x1, cx + rad) + (label ? label.length * 6 + 10 : 4);
      const rows = laneRows[laneOf(e)];
      let row = rows.findIndex((endX) => endX < cx - rad - 2);
      if (row === -1) { rows.push(0); row = rows.length - 1; }
      rows[row] = right;
      placed.push({ e, lane: laneOf(e), row, cx, x1, rad, fuzzy, label });
    }

    // lane geometry
    let y = AXIS;
    const laneY = {};
    for (const lane of LANES) {
      const n = Math.max(1, laneRows[lane.id].length);
      laneY[lane.id] = { top: y, height: n * ROW + 16 };
      y += n * ROW + 16 + LANE_GAP;
    }
    const height = y + 10;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // eras
    Object.values(G.era).sort((a, b) => a.order - b.order).forEach((era, i) => {
      const s = xOf(drange(era.start)[0]);
      const e = xOf(era.end ? drange(era.end)[1] : END);
      el("rect", { x: s, y: 0, width: e - s, height, fill: cssVar(i % 2 ? "--era-b" : "--era-a") }, svg);
      const t = el("text", { x: s + 8, y: 18, class: "era-label" }, svg);
      t.textContent = e - s > 160 ? era.title : "";
      t.style.cursor = "pointer";
      t.addEventListener("click", () => showEra(era.id));
    });

    // year ticks
    for (let yr = START; yr <= 2027; yr++) {
      const x = xOf(yr);
      el("line", { x1: x, x2: x, y1: 26, y2: height, class: "tick" }, svg);
      const every = weight(yr) < 0.5 ? 4 : weight(yr) < 1 ? 2 : 1;
      if ((yr - START) % every === 0 || yr >= 2008) {
        const t = el("text", { x: x + 3, y: 38, "font-size": 11 }, svg);
        t.textContent = yr;
      }
    }

    // lane labels (pinned to the visible left edge by a scroll handler)
    const labels = el("g", { id: "lane-labels" }, svg);
    for (const lane of LANES) {
      const L = laneY[lane.id];
      el("line", { x1: 0, x2: width, y1: L.top - LANE_GAP / 2, y2: L.top - LANE_GAP / 2, stroke: cssVar("--rule") }, svg);
      el("rect", { x: 0, y: L.top, width: lane.label.length * 7.4 + 14, height: 17, fill: cssVar("--surface"), opacity: 0.92 }, labels);
      const t = el("text", { x: 8, y: L.top + 12, class: "lane-label", fill: cssVar(lane.color) }, labels);
      t.textContent = lane.label;
    }

    // events
    for (const p of placed) {
      const { e } = p;
      const color = cssVar(LANES.find((l) => l.id === p.lane).color);
      const cy = laneY[p.lane].top + 14 + p.row * ROW;
      const g = el("g", { class: "ev", tabindex: 0, role: "button", "aria-label": `${dlabel(e.date)}: ${e.title}` }, svg);
      if (!inFocus(e.id)) g.classList.add("dim");
      if (selected === e.id) g.classList.add("selected");
      if (p.fuzzy) el("rect", { x: p.cx, y: cy - 3, width: p.x1 - p.cx, height: 6, rx: 3, fill: color, class: "span" }, g);
      const hollow = e.status !== "verified";
      el("circle", {
        cx: p.cx, cy, r: p.rad, class: "dot",
        fill: hollow ? cssVar("--surface") : color,
        stroke: e.status === "disputed" ? cssVar("--disputed") : color,
        "stroke-width": e.status === "disputed" ? 2.5 : 1.5,
        "stroke-dasharray": e.status === "unverified" || e.status === "interview-only" ? "2 2" : "",
      }, g);
      if (p.label) { const t = el("text", { x: p.cx + p.rad + 4, y: cy + 4, class: "ev-label" }, g); t.textContent = p.label; }
      const tip = el("title", {}, g); tip.textContent = `${dlabel(e.date)} · ${e.title}`;
      const open = () => showEvent(e.id);
      g.addEventListener("click", open);
      g.addEventListener("keydown", (k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); open(); } });
    }
    svg.appendChild(labels);
    pinLaneLabels();
  }

  function short(s) { return s.length > 46 ? s.slice(0, 44) + "…" : s; }

  function pinLaneLabels() {
    const g = $("#lane-labels");
    if (g) g.setAttribute("transform", `translate(${$("#timeline-scroll").scrollLeft},0)`);
  }

  function legend() {
    const dot = (fill, stroke, dash = "", sw = 1.5) =>
      `<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="${dash}"/></svg>`;
    const ink = cssVar("--muted"), surf = cssVar("--surface");
    $("#legend").innerHTML =
      LANES.map((l) => `<span>${dot(cssVar(l.color), cssVar(l.color))}${l.label}</span>`).join("") +
      `<span>${dot(ink, ink)}Verified</span><span>${dot(surf, ink)}Single source</span>` +
      `<span>${dot(surf, cssVar("--disputed"), "", 2.5)}Disputed</span><span>${dot(surf, ink, "2 2")}Unverified</span>` +
      `<span><svg width="26" height="14"><rect x="0" y="4" width="26" height="6" rx="3" fill="${ink}" opacity=".28"/></svg>A span, or an uncertain date</span>` +
      `<span>Larger dot = bigger turning point</span>`;
  }

  // ------------------------------------------------------------ panel

  function openPanel(html, hash) {
    $("#panel-body").innerHTML = html;
    $("#panel").hidden = false;
    $("#panel").scrollTop = 0;
    if (hash && location.hash !== hash) history.replaceState(null, "", hash);
    wirePanel();
  }

  function closePanel() {
    $("#panel").hidden = true;
    selected = null;
    history.replaceState(null, "", location.pathname + location.search);
    render();
  }

  const nameOf = (type, id) => { const r = G[type]?.[id]; return r ? (r.name || r.title) : id; };
  const chip = (type, id) => G[type]?.[id] ? `<button class="chip" data-type="${type}" data-id="${esc(id)}">${esc(nameOf(type, id))}</button>` : "";
  const chips = (type, ids) => (ids || []).filter((id) => G[type]?.[id]).length ? `<div class="chips">${ids.map((id) => chip(type, id)).join("")}</div>` : "";
  const badge = (s) => s ? `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>` : "";

  function sourceList(cites) {
    if (!cites?.length) return "";
    const items = cites.map((c) => {
      const id = typeof c === "string" ? c : c.source;
      const s = G.source[id];
      if (!s) return "";
      const bits = [s.publisher, dlabel(s.published)].filter(Boolean).join(", ");
      const note = typeof c === "object" && c.note ? ` · ${esc(c.note)}` : "";
      const unopened = s.opened === false ? " · not opened when cited" : "";
      const title = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title);
      return `<li class="src">${title}<br><small>${esc(bits)}${note}${unopened}</small></li>`;
    }).join("");
    return `<h4>Sources</h4><ul>${items}</ul>`;
  }

  function eventList(ids) {
    const evs = (ids || []).map((id) => G.event[id]).filter(Boolean).sort((a, b) => sortKey(a.date) - sortKey(b.date));
    if (!evs.length) return "";
    return `<ul class="linklist">${evs.map((e) => `<li><button data-type="event" data-id="${esc(e.id)}">${esc(dlabel(e.date))}: ${esc(e.title)}</button> ${e.status !== "verified" ? badge(e.status) : ""}</li>`).join("")}</ul>`;
  }

  function linksBlock(links) {
    if (!links || !Object.keys(links).length) return "";
    return `<h4>Links</h4><p>${Object.entries(links).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(" · ")}</p>`;
  }

  function followButton(type, id) {
    const on = focus && focus.type === type && focus.id === id;
    return `<p><button class="chip" data-follow="${type}" data-id="${esc(id)}">${on ? "Stop following" : "Follow on the timeline"}</button></p>`;
  }

  function common(r) {
    let h = "";
    if (r.caveat) h += `<p class="caveat">${esc(r.caveat)}</p>`;
    if (r.sensitive_note) h += `<p class="caveat">${esc(r.sensitive_note)}</p>`;
    if (r.accounts?.length) h += `<h4>Competing accounts</h4>` + r.accounts.map((a) => `<div class="account">${esc(a.summary)}${a.sources ? `<br><small>${a.sources.map((c) => esc(G.source[typeof c === "string" ? c : c.source]?.publisher || "")).join(", ")}</small>` : ""}</div>`).join("");
    if (r.open_questions?.length) h += `<h4>Open questions</h4><ul>${r.open_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`;
    if (r.notes) h += `<h4>Notes</h4><p>${esc(r.notes)}</p>`;
    return h;
  }

  function showEvent(id) {
    const e = G.event[id]; if (!e) return;
    selected = id;
    const era = G.era[e.era];
    let h = `<p class="meta">${esc(dlabel(e.date))}${e.end_date ? " – " + esc(dlabel(e.end_date)) : ""} · ${esc(era?.title || "")}</p>`;
    h += `<h3>${esc(e.title)}</h3><p>${badge(e.status)} <span class="meta">${esc(e.type)}</span></p>`;
    if (e.summary) h += `<p>${esc(e.summary)}</p>`;
    if (e._ages) h += `<p class="meta">Ages at the time: ${Object.entries(e._ages).map(([p, a]) => `${esc(nameOf("person", p))} ${esc(a)}`).join(", ")}</p>`;
    h += common(e);
    for (const [k, t, label] of [["people", "person", "People"], ["games", "game", "Games"], ["orgs", "org", "Studios & organizations"], ["places", "place", "Places"]])
      if (e[k]?.length) h += `<h4>${label}</h4>${chips(t, e[k])}`;
    h += sourceList(e.sources);
    openPanel(h, `#event/${id}`);
    render();
  }

  function showPerson(id) {
    const p = G.person[id]; if (!p) return;
    let h = `<p class="meta">Person</p><h3>${esc(p.name)}</h3><p>${badge(p.status)}${p.pronouns ? ` <span class="meta">${esc(p.pronouns)}</span>` : ""}</p>`;
    if (p.summary) h += `<p>${esc(p.summary)}</p>`;
    const facts = [];
    if (p.born?.date) facts.push(`Born ${dlabel(p.born.date)}${p.born.place ? ", " + p.born.place : ""}`);
    if (p.died?.date) facts.push(`Died ${dlabel(p.died.date)}`);
    if (p.age_reported?.length) facts.push(p.age_reported.map((a) => `Age ${a.age} as of ${dlabel(a.as_of)}`).join("; "));
    if (p.origin) facts.push(`From ${p.origin}`);
    if (p.vancouver) facts.push(`Vancouver: ${TIE_LABEL[p.vancouver.tie] || p.vancouver.tie || ""}${p.vancouver.arrived ? ", arrived " + dlabel(p.vancouver.arrived) : ""}${p.vancouver.left ? ", left " + dlabel(p.vancouver.left) : ""}`);
    if (facts.length) h += `<p class="meta">${facts.map(esc).join("<br>")}</p>`;
    if (p.bio) h += `<p>${esc(p.bio)}</p>`;
    if (p.current) h += `<p><strong>Now:</strong> ${esc(p.current)}</p>`;
    h += followButton("person", id);
    h += askBlock(id);
    if (p.memberships?.length) h += `<h4>Studios, roles and places</h4><ul>${p.memberships.map((m) => {
      const t = m.org ? "org" : "place", target = m.org || m.place;
      const span = [m.start && dlabel(m.start), m.end && dlabel(m.end)].filter(Boolean).join(" – ");
      return `<li>${chip(t, target) || esc(target)} ${esc(m.role || "")}${span ? ` <span class="meta">(${esc(span)})</span>` : ""}</li>`;
    }).join("")}</ul>`;
    if (p._links?.games?.length) h += `<h4>Games</h4>${chips("game", p._links.games)}`;
    if (p._links?.founded?.length) h += `<h4>Founded</h4>${chips("org", p._links.founded)}`;
    if (p.sensitive_note) h += `<p class="caveat">${esc(p.sensitive_note)}</p>`;
    if (p.accounts?.length || p.notes) h += common({ accounts: p.accounts, notes: p.notes });
    if (p._links?.events?.length) h += `<h4>On the timeline</h4>${eventList(p._links.events)}`;
    h += linksBlock(p.links) + sourceList(p.sources);
    openPanel(h, `#person/${id}`);
  }

  function showGame(id) {
    const g = G.game[id]; if (!g) return;
    let h = `<p class="meta">Game${g.release_status && g.release_status !== "released" ? " · " + esc(g.release_status) : ""}</p><h3>${esc(g.title)}</h3><p>${badge(g.status)}</p>`;
    if (g.summary) h += `<p>${esc(g.summary)}</p>`;
    if (g.vancouver_connection) h += `<p class="meta">${esc(g.vancouver_connection)}</p>`;
    h += followButton("game", id);
    if (g.releases?.length) h += `<h4>Releases</h4><ul>${g.releases.map((r) => `<li>${esc(dlabel(r.date))}${r.kind ? ` · ${esc(r.kind)}` : ""}${r.platforms ? ` · ${esc(r.platforms.join(", "))}` : ""}${r.note ? ` <span class="meta">${esc(r.note)}</span>` : ""}</li>`).join("")}</ul>`;
    if (g.developers?.length) h += `<h4>Developer</h4>${chips("org", g.developers)}`;
    if (g.publishers?.length) h += `<h4>Publisher</h4>${chips("org", g.publishers)}`;
    if (g.credits?.length) h += `<h4>Credits</h4><ul>${g.credits.map((c) => `<li>${chip("person", c.person)} ${esc(c.role)}</li>`).join("")}</ul>`;
    if (g.audio_by?.length) h += `<h4>Audio</h4>${chips("org", g.audio_by)}`;
    if (g.made_at?.length) h += `<h4>Made at</h4>${chips("place", g.made_at)}`;
    if (g.awards?.length) h += `<h4>Awards</h4><ul>${g.awards.map((a) => `<li>${esc(a.name)}${a.year ? ` (${a.year})` : ""}: ${esc(a.result)}</li>`).join("")}</ul>`;
    if (g.sales?.length) h += `<h4>Sales</h4><ul>${g.sales.map((s) => `<li>${esc(s.figure)} <span class="meta">as of ${esc(dlabel(s.as_of))}</span></li>`).join("")}</ul>`;
    if (g.crowdfunding) h += `<h4>Crowdfunding</h4><p>${esc([g.crowdfunding.platform, dlabel(g.crowdfunding.date), g.crowdfunding.raised, g.crowdfunding.backers && g.crowdfunding.backers + " backers"].filter(Boolean).join(" · "))}</p>`;
    h += common(g);
    if (g._links?.events?.length) h += `<h4>On the timeline</h4>${eventList(g._links.events)}`;
    h += linksBlock(g.links) + sourceList(g.sources);
    openPanel(h, `#game/${id}`);
  }

  function showOrg(id) {
    const o = G.org[id]; if (!o) return;
    const span = [o.founded && "Founded " + dlabel(o.founded), o.closed && "closed " + dlabel(o.closed)].filter(Boolean).join(", ");
    let h = `<p class="meta">${esc(o.kind.replace(/-/g, " "))}${o.location?.city ? " · " + esc(o.location.city) : ""}</p><h3>${esc(o.name)}</h3><p>${badge(o.status)}</p>`;
    if (o.aliases?.length) h += `<p class="meta">Also: ${esc(o.aliases.join(", "))}</p>`;
    if (span) h += `<p class="meta">${esc(span)}</p>`;
    if (o.summary) h += `<p>${esc(o.summary)}</p>`;
    if (o.current) h += `<p><strong>Now:</strong> ${esc(o.current)}</p>`;
    h += followButton("org", id);
    if (o.founders?.length) h += `<h4>Founders</h4>${chips("person", o.founders)}`;
    if (o.lineage?.length) h += `<h4>Family tree</h4><ul>${o.lineage.map((l) => `<li>${esc(l.type.replace(/-/g, " "))} ${chip("org", l.org)}${l.date ? ` <span class="meta">${esc(dlabel(l.date))}</span>` : ""}</li>`).join("")}</ul>`;
    if (o._links?.lineage_from?.length) h += `<h4>Descendants and linked orgs</h4>${chips("org", o._links.lineage_from)}`;
    if (o._links?.people?.length) h += `<h4>People</h4>${chips("person", o._links.people)}`;
    for (const [k, label] of [["developed", "Developed"], ["published", "Published"], ["audio_for", "Audio for"]])
      if (o._links?.[k]?.length) h += `<h4>${label}</h4>${chips("game", o._links[k])}`;
    h += common(o);
    if (o._links?.events?.length) h += `<h4>On the timeline</h4>${eventList(o._links.events)}`;
    h += linksBlock(o.links) + sourceList(o.sources);
    openPanel(h, `#org/${id}`);
  }

  function showPlace(id) {
    const p = G.place[id]; if (!p) return;
    const span = p.active ? [p.active.start && dlabel(p.active.start), p.active.end && dlabel(p.active.end)].filter(Boolean).join(" – ") : "";
    let h = `<p class="meta">${esc(p.kind)}${p.city ? " · " + esc(p.city) : ""}</p><h3>${esc(p.name)}</h3><p>${badge(p.status)}</p>`;
    if (p.address) h += `<p class="meta">${esc(p.address)}</p>`;
    if (span) h += `<p class="meta">${esc(span)}</p>`;
    if (p.summary) h += `<p>${esc(p.summary)}</p>`;
    h += followButton("place", id);
    if (p._links?.people?.length) h += `<h4>People</h4>${chips("person", p._links.people)}`;
    if (p._links?.games?.length) h += `<h4>Games made here</h4>${chips("game", p._links.games)}`;
    h += common(p);
    if (p._links?.events?.length) h += `<h4>On the timeline</h4>${eventList(p._links.events)}`;
    h += linksBlock(p.links) + sourceList(p.sources);
    openPanel(h, `#place/${id}`);
  }

  function showEra(id) {
    const e = G.era[id]; if (!e) return;
    let h = `<p class="meta">Era · ${esc(dlabel(e.start))} – ${esc(e.end ? dlabel(e.end) : "now")}</p><h3>${esc(e.title)}</h3><p>${esc(e.summary || "")}</p>`;
    h += followButton("era", id);
    h += `<h4>Events</h4>${eventList(e._links?.events)}`;
    openPanel(h, `#era/${id}`);
  }

  const SHOW = { event: showEvent, person: showPerson, game: showGame, org: showOrg, place: showPlace, era: showEra };

  function wirePanel() {
    $("#panel-body").querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => SHOW[b.dataset.type](b.dataset.id)));
    $("#panel-body").querySelectorAll("[data-follow]").forEach((b) => b.addEventListener("click", () => {
      const same = focus && focus.type === b.dataset.follow && focus.id === b.dataset.id;
      setFocus(same ? null : { type: b.dataset.follow, id: b.dataset.id });
      SHOW[b.dataset.follow](b.dataset.id);
    }));
  }

  // ------------------------------------------------------------ focus / follow

  function setFocus(f) {
    focus = f;
    const bar = $("#focus-bar");
    if (f) {
      const n = (G[f.type][f.id]._links?.events || []).length || G.era[f.id]?._links?.events?.length || 0;
      bar.innerHTML = `<span>Following <strong>${esc(nameOf(f.type, f.id))}</strong> · ${n} events</span><button id="unfollow">Clear</button>`;
      bar.hidden = false;
      $("#unfollow").addEventListener("click", () => setFocus(null));
      // scroll to the first event
      const first = (G[f.type][f.id]._links?.events || []).map((id) => G.event[id]).filter(Boolean).sort((a, b) => sortKey(a.date) - sortKey(b.date))[0];
      if (first) $("#timeline-scroll").scrollTo({ left: Math.max(0, xOf(drange(first.date)[0]) - 200), behavior: "smooth" });
    } else {
      bar.hidden = true;
      $("#search").value = "";
    }
    render();
  }

  function setupSearch() {
    const opts = [];
    for (const [type, key] of [["person", "name"], ["game", "title"], ["org", "name"], ["place", "name"]])
      for (const r of Object.values(G[type])) if (r._links?.events?.length) opts.push({ label: `${r[key]} (${TYPE_NAMES[type].replace(/s$/, "").replace("org", "studio/org")})`, type, id: r.id });
    opts.sort((a, b) => a.label.localeCompare(b.label));
    $("#entities").innerHTML = opts.map((o) => `<option value="${esc(o.label)}"></option>`).join("");
    $("#search").addEventListener("change", () => {
      const o = opts.find((x) => x.label === $("#search").value);
      if (o) { setFocus({ type: o.type, id: o.id }); SHOW[o.type](o.id); }
    });
  }

  // ------------------------------------------------------------ planner and questions

  function personGaps(pid) {
    const evs = (G.person[pid]._links?.events || []).map((id) => G.event[id]).filter(Boolean);
    return {
      questions: evs.reduce((n, e) => n + (e.open_questions?.length || 0), 0),
      disputed: evs.filter((e) => e.status === "disputed").length,
      thin: evs.filter((e) => e.status === "single-source" || e.status === "unverified").length,
      events: evs.length,
      evs,
    };
  }

  function askBlock(pid) {
    const { evs } = personGaps(pid);
    const qs = evs.filter((e) => e.open_questions?.length).sort((a, b) => sortKey(a.date) - sortKey(b.date));
    const disputed = evs.filter((e) => e.status === "disputed");
    if (!qs.length && !disputed.length) return "";
    let h = `<h4>Things to ask</h4>`;
    if (qs.length) h += `<ul>${qs.flatMap((e) => e.open_questions.map((q) => `<li>${esc(q)} <span class="linklist"><button data-type="event" data-id="${esc(e.id)}">(${esc(dlabel(e.date))})</button></span></li>`)).join("")}</ul>`;
    if (disputed.length) h += `<p class="meta">Disputed events they were part of:</p>${eventList(disputed.map((e) => e.id))}`;
    return h;
  }

  function renderPlanner() {
    const rows = Object.values(G.person).map((p) => ({ p, ...personGaps(p.id) }))
      .filter((r) => r.events)
      .sort((a, b) => (b.questions * 3 + b.disputed * 2 + b.thin) - (a.questions * 3 + a.disputed * 2 + a.thin));
    $("#planner-rows").innerHTML = rows.map((r) => `<tr data-id="${esc(r.p.id)}" tabindex="0"><td>${esc(r.p.name)}</td><td>${esc(TIE_LABEL[r.p.vancouver?.tie] || "")}</td><td>${r.questions}</td><td>${r.disputed}</td><td>${r.thin}</td><td>${r.events}</td></tr>`).join("");
    $("#planner-rows").querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => showPerson(tr.dataset.id));
      tr.addEventListener("keydown", (k) => { if (k.key === "Enter") showPerson(tr.dataset.id); });
    });
  }

  function renderQuestions() {
    const byEra = {};
    for (const id of G.timeline) {
      const e = G.event[id];
      if (e.open_questions?.length) (byEra[e.era] ||= []).push(e);
    }
    $("#questions").innerHTML = Object.values(G.era).sort((a, b) => a.order - b.order).filter((era) => byEra[era.id]).map((era) =>
      `<div class="qgroup"><h3>${esc(era.title)}</h3>${byEra[era.id].map((e) =>
        `<div class="q">${e.open_questions.map((q) => `<p>${esc(q)}</p>`).join("")}<button data-id="${esc(e.id)}">${esc(dlabel(e.date))}: ${esc(e.title)}</button></div>`).join("")}</div>`).join("");
    $("#questions").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => showEvent(b.dataset.id)));
  }

  // ------------------------------------------------------------ tabs, routing, boot

  function setView(v) {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === v));
    document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== `view-${v}`));
  }

  function route() {
    const [type, id] = location.hash.slice(1).split("/");
    if (SHOW[type] && id) SHOW[type](decodeURIComponent(id));
  }

  function stats() {
    const c = G.counts, ev = Object.values(G.event);
    const v = ev.filter((e) => e.status === "verified").length;
    $("#stats").textContent = `${c.event} events · ${c.person} people · ${c.game} games · ${c.org} studios and organizations · ${c.source} sources · ${Math.round((v / ev.length) * 100)}% of events verified against an opened source · data as of ${G.generated}`;
  }

  async function boot() {
    try {
      G = await (await fetch("graph.json", { cache: "no-cache" })).json();
    } catch (err) {
      $("#stats").textContent = "Couldn't load graph.json. Run `python3 tools/vigs.py build` first.";
      return;
    }
    stats(); legend(); setupSearch(); renderPlanner(); renderQuestions(); render();
    $("#timeline-scroll").addEventListener("scroll", pinLaneLabels, { passive: true });
    $("#timeline-scroll").scrollLeft = xOf(2008) - LEFT;
    document.querySelectorAll("[data-filter], #region, #significance").forEach((i) => i.addEventListener("change", render));
    $("#zoom-in").addEventListener("click", () => rezoom(1.4));
    $("#zoom-out").addEventListener("click", () => rezoom(1 / 1.4));
    $("#panel-close").addEventListener("click", closePanel);
    document.addEventListener("keydown", (k) => { if (k.key === "Escape" && !$("#panel").hidden) closePanel(); });
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    window.addEventListener("hashchange", route);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { legend(); render(); });
    route();
  }

  function rezoom(f) {
    const sc = $("#timeline-scroll");
    const mid = (sc.scrollLeft + sc.clientWidth / 2 - LEFT) / zoom;
    zoom = Math.min(6, Math.max(0.4, zoom * f));
    render();
    sc.scrollLeft = mid * zoom + LEFT - sc.clientWidth / 2;
  }

  boot();
})();
