/* Vancouver Indie Games Story: 3D view.
   A road through time drawn with CSS 3D transforms. Event cards stand on the road in one
   column per category, sized by significance. Scroll, drag, use the arrow keys, or scrub
   the overview strip at the bottom. Clicking a card flies to it and opens its details.
   Reads the shared data and helpers that app.js exposes on window.VIGS. */
(() => {
  "use strict";
  const V = () => window.VIGS;
  const $ = (s, el = document) => el.querySelector(s);

  // Time is compressed before 2008 (most of the story happens later), same idea as the classic timeline.
  const START = 1982, END = 2027.5;
  const weight = (y) => (y < 2000 ? 0.22 : y < 2008 ? 0.5 : 1);
  function S(t) { let s = 0; for (let y = START; y < END; y++) { const w = weight(y); if (t < y + 1) return s + Math.max(0, t - y) * w; s += w; } return s; }
  function T(s) { let acc = 0; for (let y = START; y < END; y++) { const w = weight(y); if (s < acc + w) return y + (s - acc) / w; acc += w; } return END; }
  const S_MAX = S(END);

  const SZ = 1300;          // px of depth per (weighted) year
  const Z0 = -120;          // push the scene back so the nearest card isn't in your face
  const LANE_W = 360;       // px between category columns
  const FLOOR_Y = 520;      // floor, px below the stage centre
  const AHEAD = 4.2, BEHIND = 0.1, FADE = 1.6;   // visible window, in weighted years

  const flight = {
    active: false, camS: S(2010), target: S(2010), camX: 0, targetX: 0, cards: [], ticks: [], eras: [], raf: 0, el: null,
  };

  // ---------------------------------------------------------------- data helpers

  // position by the middle of a date's range, so "2018" sits mid-year rather than piling up on January 1st
  const tOf = (d) => { const r = V().drange(d) || [2000, 2000]; return (r[0] + r[1]) / 2; };
  function eventImage(e) {
    const G = V().G;
    for (const id of e.games || []) { const u = G.game[id]?.box_art?.source_url; if (u) return { url: u, kind: "art" }; }
    for (const id of e.orgs || []) { const u = G.org[id]?.logo?.source_url; if (u) return { url: u, kind: "logo" }; }
    return null;
  }
  function firstRelease(g) { return (g.releases || []).map((r) => tOf(r.date)).sort((a, b) => a - b)[0]; }
  const STUDIO = new Set(["indie-studio", "mid-size-studio", "audio-studio"]);

  // ---------------------------------------------------------------- build

  function build() {
    const { G, LANES, laneOf, passes, esc, dlabel, cssVar } = V();
    const root = flight.el;
    const world = $(".fl-world", root);
    world.innerHTML = `<div class="fl-floor"></div>`;
    flight.cards = []; flight.ticks = []; flight.eras = [];

    // event cards
    const shown = LANES.filter((l) => !V().hiddenLanes.has(l.id));
    const col = Object.fromEntries(shown.map((l, i) => [l.id, i - (shown.length - 1) / 2]));
    const laneIndex = Object.fromEntries(LANES.map((l, i) => [l.id, i]));
    const lastInLane = {};
    const events = G.timeline.map((id) => G.event[id]).filter(passes);
    for (const e of events) {
      const lane = laneOf(e), li = laneIndex[lane], s = S(tOf(e.date));
      // nudge cards that would sit right behind one another in the same column
      const prev = lastInLane[lane];
      // two sub-columns per category: consecutive close events alternate left and right
      let nudge = 0;
      if (prev && s - prev.s < 0.6) nudge = prev.nudge <= 0 ? 0.36 : -0.36;
      lastInLane[lane] = { s, nudge };
      const img = eventImage(e);
      const color = `var(${LANES[li].color})`;
      const card = document.createElement("button");
      card.className = `fl-card sig-${e.significance || 1}${img ? " has-img" : ""}`;
      card.style.setProperty("--lane", color);
      card.dataset.id = e.id;
      card.innerHTML =
        `<span class="fl-cat">${esc(LANES[li].label)}</span>` +
        (img ? `<span class="fl-img ${img.kind}"><img src="${esc(img.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
             : `<span class="fl-img none"><span>${esc(String(Math.floor(tOf(e.date))))}</span></span>`) +
        `<span class="fl-body"><span class="fl-title">${esc(e.title)}</span><span class="fl-date">${esc(dlabel(e.date))}</span>` +
        (e.summary ? `<span class="fl-sum">${esc(e.summary)}</span>` : "") + `</span>`;
      card.querySelector("img")?.addEventListener("error", (ev) => ev.target.closest(".fl-img").classList.add("broken"));
      card.addEventListener("click", (ev) => { if (flight.dragged) return; flight.clicked = e.id; V().showEvent(e.id); });
      world.appendChild(card);
      flight.cards.push({ el: card, e, s, nudge, x: (col[lane] + nudge) * LANE_W, h: 0 });
    }

    // year rulers on both edges
    const edge = Math.max(1, (shown.length - 1) / 2) * LANE_W + 230;
    for (let y = START; y <= 2027; y++) {
      for (let q = 0; q < 4; q++) {
        const t = y + q / 4; if (t > END) break;
        for (const side of [-1, 1]) {
          const tick = document.createElement("div");
          tick.className = `fl-tick${q === 0 ? " major" : ""}`;
          world.appendChild(tick);
          flight.ticks.push({ el: tick, s: S(t), x: side * edge, side });
        }
      }
      const label = document.createElement("div");
      label.className = "fl-year"; label.textContent = y;
      world.appendChild(label);
      flight.ticks.push({ el: label, s: S(y), x: edge + 40, label: true });
    }

    // era gates
    for (const era of Object.values(G.era)) {
      const gate = document.createElement("div");
      gate.className = "fl-era"; gate.innerHTML = `<span>${esc(era.title)}</span>`;
      world.appendChild(gate);
      flight.eras.push({ el: gate, s: S(tOf(era.start)) });
    }

    buildScrubber();
    markSelected();
  }

  // ---------------------------------------------------------------- frame

  function frame(now) {
    flight.raf = requestAnimationFrame(frame);
    const dt = Math.min(250, now - (flight.lastT || now)); flight.lastT = now;
    const d = flight.target - flight.camS, dx = flight.targetX - flight.camX;
    if (Math.abs(d) < 0.0005 && Math.abs(dx) < 0.5 && !flight.force) return;
    flight.force = false;
    // ease toward the target at the same speed whatever the frame rate (about 0.12 per frame at 60fps)
    const k = 1 - Math.pow(0.88, dt / 16.7);
    flight.camS += d * k;
    flight.camX += dx * k;
    $(".fl-world", flight.el).style.transform = `scale(var(--k, 1)) translateX(${(-flight.camX).toFixed(1)}px)`;
    place();
  }

  function place() {
    const cam = flight.camS;
    const { inFocus } = V();
    for (const c of flight.cards) {
      const dz = c.s - cam;
      if (dz < -BEHIND || dz > AHEAD + FADE) { c.el.style.display = "none"; continue; }
      c.el.style.display = "";
      const z = -dz * SZ + Z0 - (c.nudge > 0 ? 40 : 0);   // stagger side-by-side cards so they never z-fight
      const fade = dz < 0 ? Math.max(0, 1 + dz / BEHIND) : dz > AHEAD ? Math.max(0, 1 - (dz - AHEAD) / FADE) : 1;
      const dim = inFocus(c.e.id) ? 1 : 0.18;
      c.el.style.opacity = (fade * dim).toFixed(3);
      c.el.style.transform = `translate3d(${c.x}px, ${FLOOR_Y - 2}px, ${z}px) translateX(-50%)`;
      c.el.style.pointerEvents = fade > 0.3 ? "" : "none";
    }
    for (const k of flight.ticks) {
      const dz = k.s - cam;
      if (dz < -BEHIND || dz > AHEAD + FADE) { k.el.style.display = "none"; continue; }
      k.el.style.display = "";
      const fade = dz < 0 ? Math.max(0, 1 + dz / BEHIND) : dz > AHEAD ? Math.max(0, 1 - (dz - AHEAD) / FADE) : 1;
      k.el.style.opacity = fade.toFixed(3);
      k.el.style.transform = `translate3d(${k.x}px, ${FLOOR_Y}px, ${-dz * SZ + Z0}px)${k.label ? " translateY(-100%)" : k.side < 0 ? " translateX(-100%)" : ""}`;
    }
    for (const g of flight.eras) {
      const dz = g.s - cam;
      if (dz < -0.15 || dz > AHEAD + FADE) { g.el.style.display = "none"; continue; }
      g.el.style.display = "";
      g.el.style.opacity = (dz < 0.4 ? Math.max(0, dz / 0.4) : dz > AHEAD ? Math.max(0, 1 - (dz - AHEAD) / FADE) : 1).toFixed(3);
      g.el.style.transform = `translate3d(0, ${FLOOR_Y - 720}px, ${-dz * SZ + Z0}px) translateX(-50%)`;
    }
    updateHud();
  }

  // ---------------------------------------------------------------- HUD: running totals + scrubber

  function updateHud() {
    const { G, esc } = V();
    const year = Math.floor(T(flight.camS + 0.2));
    if (year === flight.lastYear) return updateWindow();
    flight.lastYear = year;
    const end = year + 1;
    const games = Object.values(G.game).filter((g) => firstRelease(g) < end).length;
    const studios = Object.values(G.org).filter((o) => STUDIO.has(o.kind) && o.founded && tOf(o.founded) < end).length;
    const community = G.timeline.filter((id) => tOf(G.event[id].date) < end && V().laneOf(G.event[id]) === "community").length;
    const events = G.timeline.filter((id) => tOf(G.event[id].date) < end).length;
    const era = Object.values(G.era).sort((a, b) => a.order - b.order).filter((x) => tOf(x.start) < end).pop();
    $(".fl-stats", flight.el).innerHTML =
      `<div class="fl-stats-head">The story so far</div>` +
      `<div class="fl-stats-era">${esc(era?.title || "")}</div>` +
      `<dl><div><dt>Events</dt><dd>${events}</dd></div><div><dt>Games released</dt><dd>${games}</dd></div>` +
      `<div><dt>Indie studios founded</dt><dd>${studios}</dd></div><div><dt>Community moments</dt><dd>${community}</dd></div></dl>` +
      `<div class="fl-stats-year">Year: ${year}</div>`;
    updateWindow();
  }

  function sx(s) { return (s / S_MAX) * 100; }

  function buildScrubber() {
    const { G, LANES, laneOf, esc, cssVar } = V();
    const eras = Object.values(G.era).sort((a, b) => a.order - b.order);
    let h = `<svg class="fl-scrub-svg" viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true">`;
    const laneColor = Object.fromEntries(LANES.map((l) => [l.id, cssVar(l.color)]));
    for (const id of G.timeline) {
      const e = G.event[id];
      if (!V().passes(e)) continue;
      const x = sx(S(tOf(e.date))) * 10, len = 8 + (e.significance || 1) * 7;
      h += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${40 - len}" y2="40" stroke="${laneColor[laneOf(e)]}" stroke-width="${e.significance === 3 ? 2.4 : 1.4}" opacity="${e.significance === 3 ? 1 : 0.65}"/>`;
    }
    h += `</svg>`;
    h += eras.map((era) => {
      const a = sx(S(tOf(era.start))), b = sx(era.end ? S(tOf(era.end) + 1) : S_MAX);
      return `<button class="fl-scrub-era" style="left:${a}%;width:${b - a}%" data-s="${S(tOf(era.start))}"><span>${esc(era.title)}</span></button>`;
    }).join("");
    const years = [1990, 2000, 2005, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026];
    h += years.map((y, i) => `<span class="fl-scrub-year${i % 2 ? " minor" : ""}" style="left:${sx(S(y))}%">${y}</span>`).join("");
    h += `<div class="fl-scrub-window"></div>`;
    const bar = $(".fl-scrub", flight.el);
    bar.innerHTML = h;
    const jump = (ev) => {
      const r = bar.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const s = Math.min(S_MAX - 1, Math.max(-0.3, f * S_MAX - AHEAD / 2));
      flight.target = flight.camS = s;            // immediate: no easing while scrubbing
      flight.targetX = flight.camX = 0;
      $(".fl-world", flight.el).style.transform = "scale(var(--k, 1))";
      place();
    };
    const stop = () => (flight.scrubbing = false);
    bar.addEventListener("pointerdown", (ev) => { ev.preventDefault(); bar.setPointerCapture(ev.pointerId); flight.scrubbing = true; jump(ev); });
    bar.addEventListener("pointermove", (ev) => { if (flight.scrubbing) jump(ev); });
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
    bar.addEventListener("lostpointercapture", stop);
    updateWindow();
  }

  function updateWindow() {
    const w = $(".fl-scrub-window", flight.el);
    if (!w) return;
    const a = sx(Math.max(0, flight.camS)), b = sx(Math.min(S_MAX, flight.camS + AHEAD));   // the visible stretch of road
    w.style.left = a + "%"; w.style.width = Math.max(0.6, b - a) + "%";
  }

  // ---------------------------------------------------------------- input

  function wire() {
    const stage = $(".fl-stage", flight.el);
    const clamp = (s) => Math.min(S_MAX - 1, Math.max(-0.3, s));
    flight.onWheel = (ev) => { ev.preventDefault(); flight.targetX = 0; flight.target = clamp(flight.target + (ev.deltaY + ev.deltaX) * 0.0022); };
    stage.addEventListener("wheel", flight.onWheel, { passive: false });
    let drag = null;
    stage.addEventListener("dragstart", (ev) => ev.preventDefault());
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();   // stops text selection and native image dragging; clicks still fire
      drag = { y: ev.clientY, t: flight.target, moved: 0, id: ev.pointerId };
      flight.dragged = false;
    });
    window.addEventListener("pointermove", flight.onMove = (ev) => {
      if (!drag) return;
      if (!ev.buttons) { drag = null; return; }   // the button was released somewhere we didn't hear about
      const dy = ev.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.abs(dy));
      if (drag.moved > 6) {
        if (!flight.dragged) { flight.dragged = true; try { stage.setPointerCapture(drag.id); } catch {} }
        flight.targetX = 0; flight.target = clamp(drag.t + dy * 0.012);
      }
    });
    const endDrag = () => { drag = null; setTimeout(() => (flight.dragged = false), 0); };
    window.addEventListener("pointerup", flight.onUp = endDrag);
    window.addEventListener("pointercancel", flight.onCancel = endDrag);
    stage.addEventListener("lostpointercapture", endDrag);
    window.addEventListener("keydown", flight.onKey = (ev) => {
      if (!flight.active || ev.target.closest("input, textarea, select")) return;
      const step = { ArrowUp: 0.5, ArrowDown: -0.5, PageUp: 2, PageDown: -2, ArrowRight: 0.5, ArrowLeft: -0.5 }[ev.key];
      if (step) { ev.preventDefault(); flight.targetX = 0; flight.target = clamp(flight.target + step); }
      if (ev.key === "Home") flight.target = 0;
      if (ev.key === "End") flight.target = S_MAX - 1.5;
    });
    window.addEventListener("resize", flight.onResize = () => fit());
  }

  function fit() {
    const w = window.innerWidth;
    const k = Math.min(1, Math.max(0.42, w / 1500));
    $(".fl-world", flight.el).style.setProperty("--k", k);
  }

  function markSelected() {
    const sel = V().selected;
    for (const c of flight.cards) { c.sel = c.e.id === sel; c.el.classList.toggle("selected", c.sel); }
    flight.force = true;
  }

  // ---------------------------------------------------------------- public

  flight.enter = function () {
    if (flight.active || !V()) return;
    flight.active = true;
    document.body.classList.add("flight-on");
    flight.el = document.createElement("div");
    flight.el.className = "flight";
    flight.el.innerHTML = `<div class="fl-stage"><div class="fl-world"></div></div>
      <aside class="fl-stats card"></aside>
      <div class="fl-toggles"></div>
      <p class="fl-hint">Scroll, drag or use the arrow keys to travel through time. Click a card for its story.</p>
      <div class="fl-scrub card"></div>`;
    document.body.appendChild(flight.el);
    // category toggles mirror the classic ones (clicking them drives the same state)
    const tg = $(".fl-toggles", flight.el);
    tg.innerHTML = document.querySelector("#lane-toggles .toggle-group")?.outerHTML || "";
    tg.querySelectorAll(".toggle").forEach((b) => b.addEventListener("click", () => {
      document.querySelector(`#lane-toggles .toggle[data-lane="${b.dataset.lane}"]`)?.click();
      b.setAttribute("aria-pressed", document.querySelector(`#lane-toggles .toggle[data-lane="${b.dataset.lane}"]`)?.getAttribute("aria-pressed"));
    }));
    fit(); build(); wire(); flight.sig = null;
    const sel = V().selected && V().G.event[V().selected];
    if (sel) flight.target = flight.camS = Math.max(0, S(tOf(sel.date)) - 0.12);
    flight.force = true; flight.lastYear = null; place();
    flight.raf = requestAnimationFrame(frame);
  };

  flight.exit = function () {
    if (!flight.active) return;
    flight.active = false;
    cancelAnimationFrame(flight.raf);
    window.removeEventListener("pointermove", flight.onMove);
    window.removeEventListener("pointerup", flight.onUp);
    window.removeEventListener("pointercancel", flight.onCancel);
    window.removeEventListener("keydown", flight.onKey);
    window.removeEventListener("resize", flight.onResize);
    flight.el?.remove(); flight.el = null;
    document.body.classList.remove("flight-on");
  };

  // Rebuild after the category toggles, search or style change.
  flight.refresh = function () {
    if (!flight.active) return;
    clearTimeout(flight.refreshT);
    flight.refreshT = setTimeout(() => {
      const { G, passes, inFocus } = V();
      const sig = G.timeline.filter((id) => passes(G.event[id])).map((id) => id + (inFocus(id) ? "" : "~")).join("|") + document.documentElement.dataset.style + (document.documentElement.dataset.theme || "");
      if (sig !== flight.sig) { flight.sig = sig; build(); }
      markSelected();
      flight.force = true; flight.lastYear = null; place();
    }, 30);
  };

  flight.flyTo = function (id) {
    const e = V().G.event[id];
    if (!e || !flight.active) return;
    // a card clicked in the 3D view stays where it is; anything chosen elsewhere glides into view (in time only)
    if (flight.clicked === id) flight.clicked = null;
    else {
      const c = flight.cards.find((x) => x.e.id === id);
      const dz = c ? c.s - flight.camS : 99;
      if (dz < 0 || dz > AHEAD * 0.6) flight.target = Math.max(0, S(tOf(e.date)) - 0.12);
    }
    markSelected();
  };

  window.Flight = flight;
})();
