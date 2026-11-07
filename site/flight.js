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

  const SZ = 1300;          // px of depth per (weighted) year
  const Z0 = -120;          // push the scene back so the nearest card isn't in your face
  const LANE_W = 360;       // px between category columns
  const FLOOR_Y = 520;      // floor, px below the stage centre
  const AHEAD = 4.2, BEHIND = 0.1, FADE = 1.6;   // visible window, in weighted years
  const ROAD_W = 1800;      // usable road width, px: fewer categories get more sub-columns
  const SUB_W = 300;        // minimum width of a sub-column, px
  const GAP = 0.24;         // minimum depth between cards in the same sub-column (weighted years)
  const MAX_STEP = 0.7;     // quiet stretches shrink: at most this much road between one card and the next

  // Crowded stretches are spread out by a gentle time warp: raw position R -> display position P.
  // The year rulers and scrubber use the same warp, so everything stays consistent.
  const warp = { R: [0], P: [0] };
  function W(r) {
    const { R, P } = warp; const n = R.length;
    if (r <= R[0]) return P[0] + (r - R[0]);
    if (r >= R[n - 1]) return P[n - 1] + (r - R[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] <= r) lo = m; else hi = m; }
    const span = R[hi] - R[lo];
    return span ? P[lo] + (P[hi] - P[lo]) * (r - R[lo]) / span : P[hi];
  }
  function Winv(p) {
    const { R, P } = warp; const n = P.length;
    if (p <= P[0]) return R[0] + (p - P[0]);
    if (p >= P[n - 1]) return R[n - 1] + (p - P[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] <= p) lo = m; else hi = m; }
    const span = P[hi] - P[lo];
    return span ? R[lo] + (R[hi] - R[lo]) * (p - P[lo]) / span : R[hi];
  }
  const clampCam = (p) => Math.min(flight.p1 - 0.6, Math.max(flight.p0 - 0.3, p));

  const flight = {
    active: false, camS: 0, target: 0, p0: 0, p1: 1, camX: 0, targetX: 0, cards: [], ticks: [], eras: [], raf: 0, el: null,
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

  // ---------------------------------------------------------------- build

  function build() {
    const { G, LANES, laneOf, passes, esc, dlabel, cssVar } = V();
    const root = flight.el;
    const world = $(".fl-world", root);
    world.innerHTML = `<div class="fl-floor"></div>`;
    flight.cards = []; flight.ticks = []; flight.eras = [];

    // event cards: one column per visible category, split into sub-columns when there's room
    const shown = LANES.filter((l) => !V().hiddenLanes.has(l.id));
    const n = Math.max(1, shown.length), laneW = ROAD_W / n;
    const subs = Math.max(1, Math.min(5, Math.floor(laneW / SUB_W)));
    const subW = laneW / subs;
    const col = Object.fromEntries(shown.map((l, i) => [l.id, i]));
    const laneIndex = Object.fromEntries(LANES.map((l, i) => [l.id, i]));
    const events = G.timeline.map((id) => G.event[id]).filter(passes)
      .map((e) => ({ e, r: S(tOf(e.date)) })).sort((x, y) => x.r - y.r);

    // Walk forward in time. Each card takes the sub-column in its category that has been free longest;
    // if even that one was used too recently, the card (and everything after it) is pushed a little later.
    const lastP = {};
    warp.R = []; warp.P = [];
    let prevP = -Infinity, prevR = null;
    const placed = [];
    for (const { e, r } of events) {
      const lane = laneOf(e);
      const slots = lastP[lane] ||= Array(subs).fill(-Infinity);
      // prefer the outer sub-columns' neighbours evenly: pick the freest slot, ties go to the one nearest the centre
      let best = 0;
      for (let j = 1; j < subs; j++) if (slots[j] < slots[best] - 1e-9) best = j;
      // step forward by the real gap in time, but never more than MAX_STEP, and never less than the column needs
      const step = prevR === null ? 0 : Math.min(r - prevR, MAX_STEP);
      let p = prevR === null ? r : Math.max(prevP + step, prevP + 0.02, slots[best] + GAP);
      slots[best] = p; prevP = p; prevR = r;
      warp.R.push(r); warp.P.push(p);
      // a single sub-column alternates slightly left/right so close cards don't stack exactly
      const alt = subs === 1 ? (placed.filter((x) => x.lane === lane).length % 2 ? 0.17 : -0.17) : 0;
      const x = (col[lane] - (n - 1) / 2) * laneW + (best - (subs - 1) / 2) * subW + alt * subW;
      placed.push({ e, p, x, lane, nudge: best % 2 });
    }
    if (!warp.R.length) { warp.R = [S(2010)]; warp.P = [S(2010)]; }
    flight.p0 = warp.P[0] - 0.15;
    flight.p1 = warp.P[warp.P.length - 1] + 0.9;
    flight.t0 = Math.floor(T(warp.R[0])); flight.t1 = Math.ceil(T(warp.R[warp.R.length - 1]) + 0.01);

    for (const { e, p, x, nudge } of placed) {
      const li = laneIndex[laneOf(e)];
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
      card.addEventListener("click", () => { if (flight.dragged) return; flight.clicked = e.id; V().showEvent(e.id); });
      world.appendChild(card);
      flight.cards.push({ el: card, e, s: p, nudge, x });
    }

    // year rulers on both edges
    const edge = ROAD_W / 2 + 150;
    let lastLabel = -Infinity, lastTick = -Infinity;
    for (let y = flight.t0; y <= flight.t1; y++) {
      for (let q = 0; q < 4; q++) {
        const t = y + q / 4; if (t > END) break;
        const tp = W(S(t));
        if (tp - lastTick < 0.07 && q !== 0) continue;
        lastTick = tp;
        for (const side of [-1, 1]) {
          const tick = document.createElement("div");
          tick.className = `fl-tick${q === 0 ? " major" : ""}`;
          world.appendChild(tick);
          flight.ticks.push({ el: tick, s: W(S(t)), x: side * edge, side });
        }
      }
      const yp = W(S(y));
      if (yp - lastLabel < 0.3) continue;
      lastLabel = yp;
      const label = document.createElement("div");
      label.className = "fl-year"; label.textContent = y;
      world.appendChild(label);
      flight.ticks.push({ el: label, s: W(S(y)), x: edge + 40, label: true });
    }

    // era gates
    let lastGate = -Infinity;
    for (const era of Object.values(G.era).sort((a, b) => a.order - b.order)) {
      const es = W(S(V().drange(era.start)[0]));
      if (es < flight.p0 - 0.5 || es > flight.p1 || es - lastGate < 1.2) continue;
      lastGate = es;
      const gate = document.createElement("div");
      gate.className = "fl-era"; gate.innerHTML = `<span>${esc(era.title)}</span>`;
      world.appendChild(gate);
      flight.eras.push({ el: gate, s: es });
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

  // ---------------------------------------------------------------- scrubber

  function updateHud() { updateWindow(); }

  function sx(p) { return ((p - flight.p0) / (flight.p1 - flight.p0)) * 100; }

  function buildScrubber() {
    const { G, LANES, laneOf, esc, cssVar } = V();
    const eras = Object.values(G.era).sort((a, b) => a.order - b.order);
    let h = `<svg class="fl-scrub-svg" viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true">`;
    const laneColor = Object.fromEntries(LANES.map((l) => [l.id, cssVar(l.color)]));
    for (const id of G.timeline) {
      const e = G.event[id];
      if (!V().passes(e)) continue;
      const c = flight.cards.find((k) => k.e.id === id); if (!c) continue;
      const x = sx(c.s) * 10, len = 8 + (e.significance || 1) * 7;
      h += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${40 - len}" y2="40" stroke="${laneColor[laneOf(e)]}" stroke-width="${e.significance === 3 ? 2.4 : 1.4}" opacity="${e.significance === 3 ? 1 : 0.65}"/>`;
    }
    h += `</svg>`;
    h += eras.map((era) => {
      const a = Math.max(0, sx(W(S(V().drange(era.start)[0])))), b = Math.min(100, era.end ? sx(W(S(V().drange(era.end)[1]))) : 100);
      if (b <= 0 || a >= 100 || b - a < 0.5) return "";
      return `<button class="fl-scrub-era" style="left:${a}%;width:${b - a}%"><span>${esc(era.title)}</span></button>`;
    }).join("");
    // about a dozen year labels across whatever range is shown
    const span = flight.t1 - flight.t0, step = span > 30 ? 4 : span > 16 ? 2 : 1;
    const years = []; for (let y = Math.ceil(flight.t0 / step) * step; y <= flight.t1; y += step) years.push(y);
    let lastX = -99;
    h += years.map((y, i) => { const x = sx(W(S(y))); if (x - lastX < Math.max(3.2, 4600 / window.innerWidth)) return ""; lastX = x; return `<span class="fl-scrub-year${i % 2 ? " minor" : ""}" style="left:${x}%">${y}</span>`; }).join("");
    h += `<div class="fl-scrub-window"></div>`;
    const bar = $(".fl-scrub", flight.el);
    bar.innerHTML = h;
    const jump = (ev) => {
      const r = bar.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const s = clampCam(flight.p0 + f * (flight.p1 - flight.p0) - AHEAD / 2);
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
    const a = Math.max(0, sx(flight.camS)), b = Math.min(100, sx(flight.camS + AHEAD));   // the visible stretch of road
    w.style.left = a + "%"; w.style.width = Math.max(0.6, b - a) + "%";
  }

  // ---------------------------------------------------------------- input

  function wire() {
    const stage = $(".fl-stage", flight.el);
    const clamp = clampCam;
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
      if (ev.key === "Home") flight.target = clampCam(flight.p0);
      if (ev.key === "End") flight.target = clampCam(flight.p1);
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
      <div class="fl-toggles"></div>
      <p class="fl-hint">Scroll, drag or use the arrow keys to travel through time. Click a card for its story.</p>
      <div class="fl-scrub card"></div>`;
    document.body.appendChild(flight.el);
    // category toggles mirror the classic ones (clicking them drives the same state)
    const tg = $(".fl-toggles", flight.el);
    tg.innerHTML = document.querySelector("#lane-toggles .toggle-group")?.outerHTML || "";
    tg.querySelector(".toggle-label")?.remove();
    tg.querySelectorAll(".toggle").forEach((b) => b.addEventListener("click", () => {
      document.querySelector(`#lane-toggles .toggle[data-lane="${b.dataset.lane}"]`)?.click();
      b.setAttribute("aria-pressed", document.querySelector(`#lane-toggles .toggle[data-lane="${b.dataset.lane}"]`)?.getAttribute("aria-pressed"));
    }));
    fit(); build(); wire(); flight.sig = null;
    const sel = V().selected && V().G.event[V().selected];
    const sc = sel && flight.cards.find((c) => c.e.id === sel.id);
    flight.target = flight.camS = sc ? clampCam(sc.s - 0.12) : clampCam(flight.p0);
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
      if (sig !== flight.sig) {
        const year = T(Winv(flight.camS));
        flight.sig = sig; build();
        flight.target = flight.camS = clampCam(W(S(year)));
      }
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
      if (c && (dz < 0 || dz > AHEAD * 0.6)) flight.target = clampCam(c.s - 0.12);
    }
    markSelected();
  };

  window.Flight = flight;
})();
