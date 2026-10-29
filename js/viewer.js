/* VCDInsight — viewer.js (Step 3)
   Module 01: Waveform Viewer + Signal Inspector. Canvas based, any VCD. */
"use strict";

(function () {
  var RULER = 34,
    ROWH = 26,
    GROUPH = 24,
    SBW = 10;
  var COL = {
    bg: "#0b0b11",
    nameBg: "#101019",
    group: "#171726",
    line: "rgba(255,255,255,0.05)",
    grid: "rgba(255,255,255,0.045)",
    sel: "rgba(79,142,255,0.14)",
    border: "#2a2a3a",
    green: "#00cc66",
    blue: "#4f8eff",
    red: "#ff3344",
    yellow: "#ffaa00",
    redFill: "rgba(255,51,68,0.18)",
    text: "#e8e8f0",
    muted: "#7a7a92",
    bright: "#a0a0bc",
    dense: "rgba(160,160,188,0.55)",
    ruler: "#12121c",
  };
  var FONT = "'Times New Roman', Times, serif";

  var ROLE_ORDER = [
    "clock",
    "reset",
    "valid",
    "ready",
    "request",
    "ack",
    "grant",
    "address",
    "data",
    "write",
    "read",
    "enable",
    "state",
    "arbiter",
    "owner",
    "counter",
    "status",
    "flag",
    "other",
  ];
  var ROLE_LABEL = {
    clock: "Clock",
    reset: "Reset",
    valid: "Valid",
    ready: "Ready",
    request: "Request",
    ack: "Ack",
    grant: "Grant",
    address: "Address",
    data: "Data",
    write: "Write select",
    read: "Read select",
    enable: "Enable",
    state: "State",
    arbiter: "Arbiter",
    owner: "Owner",
    counter: "Counter",
    status: "Status",
    flag: "Flag",
    other: "Other",
  };
  var TIPS = {
    clock:
      "Check it toggles at a steady period for the whole run. Other signals should change only just after a clock edge.",
    reset:
      "Check when it is released. Outputs should hold known values after release, and nothing should start before it.",
    valid:
      "A transfer happens only when valid and ready are both high at a clock edge. Check valid does not drop before ready.",
    ready:
      "Long low stretches mean the receiver is stalling. Compare with valid to find wait cycles.",
    request:
      "Check every request gets a response or grant, and how long it takes.",
    ack: "Check it follows its request within a sensible number of cycles.",
    grant:
      "Check only one grant is active at a time, and that every request is eventually granted.",
    address:
      "Check it holds a known value (never X) whenever its valid is high, and changes only between requests.",
    data: "Compare values with what was driven earlier. X on data while its valid is high is a bug; X while idle is normal.",
    write: "Check it is stable while the transfer is accepted.",
    read: "Check it is stable while the transfer is accepted.",
    enable: "Check it is asserted only when intended and never X after reset.",
    state:
      "Check the states visited follow the expected order and that the design never gets stuck in one state.",
    arbiter:
      "Tracks whose turn it is. It should change after a conflict is served, so every requester gets a turn.",
    owner:
      "Remembers which requester a transfer belongs to, so the response is routed back correctly.",
    counter: "Check it counts as expected and resets properly.",
    status:
      "Check the value is meaningful. A status that never changes may carry no information.",
    flag: "Check it rises only in the situations it is meant to flag.",
    other:
      "No known pattern. Use the waveform and the values at your cursor to judge it.",
  };

  var V = null; // view state kept while the same file stays loaded

  /* ───────── helpers ───────── */
  function idxAt(t, time) {
    var lo = 0,
      hi = t.length - 1,
      r = -1,
      mid;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (t[mid] <= time) {
        r = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return r;
  }

  function nib(g) {
    if (/^x+$/.test(g)) return "x";
    if (/^z+$/.test(g)) return "z";
    if (/[xz]/.test(g)) return "X";
    return parseInt(g, 2).toString(16).toUpperCase();
  }

  function fmtVal(v, width, radix, isReal) {
    if (isReal) return v;
    if (width === 1) return v;
    if (radix === "bin") return v.replace(/^0+(?=.)/, "");
    if (radix === "dec") {
      if (/[xz]/.test(v))
        return /^x+$/.test(v) ? "x" : /^z+$/.test(v) ? "z" : "X";
      try {
        return BigInt("0b" + v).toString();
      } catch (e) {
        return v;
      }
    }
    var out = "",
      i = v.length,
      s;
    while (i > 0) {
      s = Math.max(0, i - 4);
      out = nib(v.slice(s, i)) + out;
      i = s;
    }
    return out.replace(/^0+(?=[0-9A-F])/, "");
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function roleLabel(r) {
    var t = ROLE_LABEL[r.role] || r.role;
    return r.sub && r.sub !== t ? t + " · " + r.sub : t;
  }

  function valueStats(net) {
    if (net.isReal) return null;
    var seen = {},
      uniq = 0,
      min = null,
      max = null,
      i,
      v;
    for (i = 0; i < net.v.length; i++) {
      v = net.v[i];
      if (!seen[v]) {
        seen[v] = 1;
        uniq++;
      }
      if (/[xz]/.test(v)) continue;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
    return { unique: uniq, seen: Object.keys(seen).sort(), min: min, max: max };
  }

  function defaultCollapsed(sim) {
    var c = {};
    sim.scopes.forEach(function (sc) {
      if (sc.path && sc.path.split(".").length >= 3) c["s:" + sc.path] = true;
    });
    return c;
  }

  function initState(sim) {
    var end = Math.max(1, sim.stats.endTime);
    return {
      sim: sim,
      end: end,
      t0: 0,
      t1: end * 1.01,
      radix: "hex",
      group: "scope",
      search: "",
      collapsed: defaultCollapsed(sim),
      selected: -1,
      cA: null,
      cB: null,
      hoverT: null,
      scrollY: 0,
      rows: [],
      totalH: 0,
      groupKeys: [],
      msg: "",
      raf: 0,
      w: 0,
      h: 0,
      dpr: 1,
      drag: null,
      sb: null,
    };
  }

  function ensure() {
    var sim = VCD.state.sim;
    if (!sim) return null;
    if (!V || V.sim !== sim) V = initState(sim);
    return V;
  }

  function opt(v, label, cur) {
    return (
      '<option value="' +
      v +
      '"' +
      (v === cur ? " selected" : "") +
      ">" +
      label +
      "</option>"
    );
  }
  function btn(act, label) {
    return (
      '<button class="tool-btn" type="button" data-act="' +
      act +
      '">' +
      label +
      "</button>"
    );
  }

  /* ───────── panel html ───────── */
  function html() {
    var S = ensure();
    if (!S || !VCD.state.analysis) {
      return '<div class="panel-placeholder"><div class="p-label">// WAVEFORM VIEWER</div><div class="p-note">No analysis data yet. Go back and analyse a file first.</div></div>';
    }
    return (
      '<div class="panel-title">// WAVEFORM VIEWER</div>' +
      '<div class="panel-sub">Wheel = zoom · drag = pan · click = cursor A · Shift+click = cursor B · Shift+wheel or drag the name column = scroll rows · click a name to inspect it</div>' +
      '<div class="viewer-toolbar" id="vwBar">' +
      btn("in", "ZOOM +") +
      btn("out", "ZOOM −") +
      btn("fit", "FIT") +
      btn("cur", "ZOOM TO CURSORS") +
      btn("clear", "CLEAR CURSORS") +
      btn("err", "FIRST ERROR") +
      btn("expand", "EXPAND ALL") +
      btn("collapse", "COLLAPSE ALL") +
      '<select class="tool-input" id="vwRadix">' +
      opt("hex", "HEX", S.radix) +
      opt("bin", "BIN", S.radix) +
      opt("dec", "DEC", S.radix) +
      "</select>" +
      '<select class="tool-input" id="vwGroup">' +
      opt("scope", "Group by scope", S.group) +
      opt("role", "Group by role", S.group) +
      "</select>" +
      '<input class="tool-input" id="vwSearch" type="text" placeholder="Search signals..." value="' +
      VCD.esc(S.search) +
      '" style="min-width:180px">' +
      "</div>" +
      '<div class="viewer-wrap" id="vwWrap" style="position:relative"><canvas id="vwCanvas"></canvas>' +
      '<div id="vwTip" style="display:none;position:absolute;z-index:5;pointer-events:none;background:#1c1c2a;border:1px solid #363650;border-radius:4px;padding:6px 10px;font-size:0.9rem;max-width:380px;color:#e8e8f0"></div></div>' +
      '<div class="text-muted" id="vwStatus" style="margin-top:8px;font-size:0.95rem;min-height:1.4em"></div>' +
      '<div id="vwInspector"></div>'
    );
  }

  /* ───────── mount ───────── */
  function mount(el) {
    var S = ensure(),
      sim = VCD.state.sim,
      an = VCD.state.analysis;
    if (!S || !an) return;
    var wrap = el.querySelector("#vwWrap"),
      canvas = el.querySelector("#vwCanvas");
    if (!wrap || !canvas) return;
    var tip = el.querySelector("#vwTip"),
      statusEl = el.querySelector("#vwStatus");
    var insp = el.querySelector("#vwInspector"),
      bar = el.querySelector("#vwBar");
    var ctx = canvas.getContext("2d");
    var ts = sim.header.timescale,
      clock = an.roles.clock,
      rd = an.roles.roles;
    var NW = 270;
    S.raf = 0;
    S.w = 0;
    S.h = 0;
    S.drag = null;
    S.sb = null;

    var netFirstSig = {};
    sim.signals.forEach(function (s) {
      if (!(s.net in netFirstSig)) netFirstSig[s.net] = s.id;
    });
    var markers = VCD.state.findings
      .filter(function (f) {
        return f.time !== null && f.time !== undefined;
      })
      .slice(0, 400);

    function ft(t) {
      return VCD.fmtTime(t, ts);
    }
    function req() {
      if (!S.raf) S.raf = requestAnimationFrame(draw);
    }
    function tOf(x) {
      return S.t0 + ((x - NW) / (S.w - NW)) * (S.t1 - S.t0);
    }
    function xOf(t) {
      return NW + ((t - S.t0) / (S.t1 - S.t0)) * (S.w - NW);
    }

    /* ---- rows ---- */
    function groupsList() {
      var groups = [];
      if (S.group === "role") {
        var map = {};
        sim.signals.forEach(function (sig) {
          var r = rd[sig.id].role;
          (map[r] = map[r] || []).push(sig.id);
        });
        ROLE_ORDER.concat(
          Object.keys(map).filter(function (k) {
            return ROLE_ORDER.indexOf(k) === -1;
          }),
        ).forEach(function (r) {
          if (map[r])
            groups.push({
              key: "r:" + r,
              label: ROLE_LABEL[r] || r,
              depth: 0,
              ids: map[r],
            });
        });
      } else {
        (function walk(id) {
          var sc = sim.scopes[id];
          if (sc.signals.length) {
            groups.push({
              key: "s:" + sc.path,
              label: sc.path || "(root)",
              depth: sc.path ? sc.path.split(".").length - 1 : 0,
              ids: sc.signals,
            });
          }
          sc.children.forEach(walk);
        })(0);
      }
      return groups;
    }

    function clampScroll() {
      var viewH = Math.max(0, S.h - RULER);
      var max = Math.max(0, S.totalH - viewH);
      if (S.scrollY > max) S.scrollY = max;
      if (S.scrollY < 0) S.scrollY = 0;
    }

    function rebuild() {
      var groups = groupsList();
      S.groupKeys = groups.map(function (g) {
        return g.key;
      });
      var q = S.search.trim().toLowerCase();
      var rows = [],
        y = 0;
      groups.forEach(function (g) {
        var ids = q
          ? g.ids.filter(function (id) {
              return sim.signals[id].fullName.toLowerCase().indexOf(q) !== -1;
            })
          : g.ids;
        if (!ids.length) return;
        var coll = q ? false : !!S.collapsed[g.key];
        rows.push({
          type: "g",
          key: g.key,
          label: g.label,
          depth: g.depth,
          count: ids.length,
          collapsed: coll,
          y: y,
          h: GROUPH,
        });
        y += GROUPH;
        if (!coll) {
          ids.forEach(function (id) {
            rows.push({ type: "s", id: id, depth: g.depth, y: y, h: ROWH });
            y += ROWH;
          });
        }
      });
      S.rows = rows;
      S.totalH = y;
      clampScroll();
    }

    function rowAtY(y) {
      var yy = y - RULER + S.scrollY;
      for (var i = 0; i < S.rows.length; i++) {
        var r = S.rows[i];
        if (yy >= r.y && yy < r.y + r.h) return r;
      }
      return null;
    }

    function scrollToSig(id) {
      var viewH = S.h - RULER;
      for (var i = 0; i < S.rows.length; i++) {
        var r = S.rows[i];
        if (r.type === "s" && r.id === id) {
          if (r.y < S.scrollY) S.scrollY = r.y;
          else if (r.y + r.h > S.scrollY + viewH) S.scrollY = r.y + r.h - viewH;
          clampScroll();
          return;
        }
      }
    }

    /* ---- view ---- */
    function clampView() {
      var span = S.t1 - S.t0;
      var maxSpan = S.end * 1.1 + 10,
        minSpan = Math.min(10, S.end);
      if (span > maxSpan) span = maxSpan;
      if (span < minSpan) span = minSpan;
      var lo = -span * 0.03,
        hi = S.end + span * 0.03;
      if (span >= hi - lo) S.t0 = lo;
      else {
        if (S.t0 < lo) S.t0 = lo;
        if (S.t0 + span > hi) S.t0 = hi - span;
      }
      S.t1 = S.t0 + span;
    }
    function fit() {
      S.t0 = 0;
      S.t1 = S.end * 1.01;
      req();
    }
    function zoomAt(f, tf) {
      var span = S.t1 - S.t0,
        ns = span * f;
      var ratio = (tf - S.t0) / span;
      S.t0 = tf - ratio * ns;
      S.t1 = S.t0 + ns;
      clampView();
      req();
    }
    function zoomBy(f) {
      zoomAt(f, (S.t0 + S.t1) / 2);
    }
    function zoomCursors() {
      if (S.cA === null || S.cB === null) {
        S.msg = "Place cursor A (click) and cursor B (Shift+click) first.";
        updateStatus();
        return;
      }
      var a = Math.min(S.cA, S.cB),
        b = Math.max(S.cA, S.cB),
        m = (b - a) * 0.08 || 5;
      S.t0 = a - m;
      S.t1 = b + m;
      clampView();
      req();
    }
    function jumpTo(t) {
      var span = S.t1 - S.t0;
      if (span > S.end / 4) span = Math.max(S.end / 6, Math.min(10, S.end));
      S.t0 = t - span / 2;
      S.t1 = S.t0 + span;
      clampView();
      req();
    }
    function jumpToFinding(f) {
      S.cA = f.time;
      S.msg = f.message;
      if (
        f.netIds &&
        f.netIds[0] >= 0 &&
        netFirstSig[f.netIds[0]] !== undefined
      )
        select(netFirstSig[f.netIds[0]], true);
      jumpTo(f.time);
      updateStatus();
    }
    function firstError() {
      var f = an.health.findings
        .filter(function (x) {
          return x.severity === "error" && x.time !== null;
        })
        .sort(function (a, b) {
          return a.time - b.time;
        })[0];
      if (!f) {
        S.msg = "No error with a timestamp was found.";
        updateStatus();
        return;
      }
      jumpToFinding(f);
    }

    /* ---- selection + inspector ---- */
    function select(id, scroll) {
      S.selected = id;
      if (id >= 0) {
        var key =
          S.group === "role"
            ? "r:" + rd[id].role
            : "s:" + sim.signals[id].scopePath;
        if (S.collapsed[key]) {
          S.collapsed[key] = false;
          rebuild();
        }
        if (scroll) scrollToSig(id);
      }
      renderInspector();
      req();
    }

    function renderInspector() {
      if (S.selected < 0) {
        insp.innerHTML =
          '<div class="inspector"><div class="inspector-row text-muted">Click a signal name to see what it is, what to look for, and what it did in this run. Colours: green line = 1-bit signal, blue = bus, red = X (unknown), yellow = Z (floating).</div></div>';
        return;
      }
      var esc = VCD.esc;
      var sig = sim.signals[S.selected],
        net = sim.nets[sig.net],
        r = rd[sig.id],
        rec = an.health.byNet[sig.net];
      var h = [];
      function row(label, text) {
        h.push(
          '<div class="inspector-row"><b>' + label + "</b>" + text + "</div>",
        );
      }
      function val(v) {
        return esc(fmtVal(v, net.width, S.radix, net.isReal));
      }

      h.push(
        '<div class="inspector"><div class="inspector-title">' +
          esc(sig.name) +
          (sig.range ? " " + esc(sig.range) : "") +
          "</div>",
      );
      row("SCOPE", esc(sig.scopePath || "(root)") + " · " + sig.width + " bit");
      row(
        "ROLE",
        esc(roleLabel(r)) +
          " (" +
          Math.round(r.conf * 100) +
          "% sure) — " +
          esc(r.reason),
      );
      var others = sim.signals
        .filter(function (s) {
          return s.net === sig.net && s.id !== sig.id;
        })
        .map(function (s) {
          return s.fullName;
        });
      if (others.length)
        row(
          "SAME NET AS",
          esc(others.slice(0, 5).join(", ")) +
            (others.length > 5 ? " and " + (others.length - 5) + " more" : ""),
        );
      row("WHAT TO LOOK FOR", esc(TIPS[r.role] || TIPS.other));

      var firstCh = net.t.length > 1 ? ft(net.t[1]) : "never";
      var lastCh = net.t.length > 1 ? ft(net.t[net.t.length - 1]) : "never";
      row(
        "ACTIVITY",
        net.toggles +
          " changes · initial value " +
          val(net.v[0]) +
          " · first change " +
          firstCh +
          " · last change " +
          lastCh,
      );

      var st = valueStats(net);
      if (st) {
        if (net.width === 1) row("VALUES SEEN", esc(st.seen.join(", ")));
        else {
          var mm =
            st.min === null
              ? "none (all values contain X or Z)"
              : "min " +
                esc(fmtVal(st.min, net.width, "hex")) +
                " · max " +
                esc(fmtVal(st.max, net.width, "hex"));
          row("VALUES", st.unique + " different values · " + mm);
        }
      }

      if (rec) {
        var xz = [];
        xz.push(
          rec.x.bad.count
            ? '<span class="text-warn">X after reset release — first at ' +
                ft(rec.x.bad.first) +
                "</span>"
            : "no X after reset release",
        );
        if (rec.x.pre.count) xz.push("X before reset release: normal");
        if (rec.x.idle.count) xz.push("X while its valid is low: idle, normal");
        xz.push(
          rec.z.bad.count
            ? '<span class="text-warn">Z after reset release — first at ' +
                ft(rec.z.bad.first) +
                "</span>"
            : "no Z after reset release",
        );
        row("X / Z", xz.join(" · "));
        row(
          "STATUS",
          rec.status.toUpperCase() +
            (rec.notes.length ? " — " + esc(rec.notes.join("; ")) : ""),
        );
      }

      if (S.cA !== null) {
        var i = idxAt(net.t, S.cA);
        row(
          "AT CURSOR A (" + ft(S.cA) + ")",
          i < 0 ? "no value yet" : val(net.v[i]),
        );
      }

      var fl = VCD.state.findings.filter(function (x) {
        return (
          x.severity === "error" && x.time !== null && x.time !== undefined
        );
      });
      if (fl.length) {
        row(
          "FINDINGS",
          fl
            .slice(0, 12)
            .map(function (f) {
              return (
                '<div><button class="link-btn" type="button" data-jump="' +
                f.time +
                '">' +
                esc(ft(f.time)) +
                "</button> " +
                '<span class="badge badge-' +
                (f.severity === "error"
                  ? "critical"
                  : f.severity === "warning"
                    ? "warning"
                    : "info") +
                '">' +
                f.severity.toUpperCase() +
                "</span> " +
                esc(f.message) +
                "</div>"
              );
            })
            .join(""),
        );
      }
      h.push("</div>");
      insp.innerHTML = h.join("");
    }

    function updateStatus() {
      var parts = [];
      if (S.cA !== null) parts.push("A: " + ft(S.cA));
      if (S.cB !== null) parts.push("B: " + ft(S.cB));
      if (S.cA !== null && S.cB !== null) {
        var d = Math.abs(S.cB - S.cA),
          s = "Δ " + ft(d);
        if (clock && clock.periodic && clock.period > 0)
          s += " (" + (d / clock.period).toFixed(1) + " cycles)";
        parts.push(s);
      }
      if (S.hoverT !== null) parts.push("pointer: " + ft(Math.round(S.hoverT)));
      var txt = parts.join("   ·   ");
      statusEl.textContent =
        (S.msg ? S.msg + "   |   " : "") +
        (txt ||
          "Click the waveform to place cursor A, Shift+click for cursor B.");
    }

    /* ---- drawing ---- */
    function ticks() {
      var span = S.t1 - S.t0,
        ww = S.w - NW;
      var step = Math.max(1, niceStep(span / Math.max(1, ww / 110)));
      var out = [],
        t = Math.ceil(S.t0 / step) * step,
        g = 0;
      while (t <= S.t1 && g++ < 400) {
        out.push(t);
        t += step;
      }
      return { step: step, list: out };
    }

    function drawWave(net, y, h) {
      var t = net.t,
        v = net.v,
        n = t.length;
      if (!n) return;
      var top = y + 6,
        bot = y + h - 7,
        mid = (top + bot) / 2;
      var bus = net.width > 1 || net.isReal;
      var k = (S.w - NW) / (S.t1 - S.t0);
      var i0 = idxAt(t, S.t0);
      if (i0 < 0) i0 = 0;
      var dx0 = -1,
        dx1 = 0;
      function flush() {
        if (dx0 >= 0) {
          ctx.fillStyle = COL.dense;
          ctx.fillRect(dx0, top, Math.max(1, dx1 - dx0), bot - top);
          dx0 = -1;
        }
      }
      ctx.font = "13px " + FONT;
      for (var i = i0; i < n; i++) {
        var ta = t[i];
        if (ta > S.t1) break;
        var tb = i + 1 < n ? t[i + 1] : S.end;
        if (i + 1 === n && tb <= ta) continue;
        var xa = NW + (ta - S.t0) * k,
          xb = NW + (tb - S.t0) * k;
        if (xb < NW) continue;
        if (xb - xa < 1.2) {
          if (dx0 < 0) dx0 = Math.max(NW, xa);
          dx1 = xb;
          continue;
        }
        flush();
        var c = v[i];
        var xaD = Math.max(xa, NW - 20),
          xbD = Math.min(xb, S.w + 20);

        if (bus) {
          var isX = c.indexOf("x") !== -1,
            isZ = !isX && c.indexOf("z") !== -1;
          var color = isX ? COL.red : isZ ? COL.yellow : COL.blue;
          var sl = Math.min(4, (xbD - xaD) / 2);
          ctx.beginPath();
          ctx.moveTo(xaD, mid);
          ctx.lineTo(xaD + sl, top);
          ctx.lineTo(xbD - sl, top);
          ctx.lineTo(xbD, mid);
          ctx.lineTo(xbD - sl, bot);
          ctx.lineTo(xaD + sl, bot);
          ctx.closePath();
          if (isX) {
            ctx.fillStyle = COL.redFill;
            ctx.fill();
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          var vis0 = Math.max(xa, NW),
            vis1 = Math.min(xb, S.w);
          if (vis1 - vis0 > 22) {
            var label = fmtVal(c, net.width, S.radix, net.isReal);
            var tw = ctx.measureText(label).width;
            if (tw + 10 < vis1 - vis0) {
              ctx.fillStyle = isX ? COL.red : isZ ? COL.yellow : COL.text;
              ctx.textAlign = "center";
              ctx.fillText(label, (vis0 + vis1) / 2, mid);
              ctx.textAlign = "left";
            }
          }
        } else {
          var yc = c === "1" ? top : c === "0" ? bot : mid;
          if (i > 0 && xa >= NW) {
            var pc = v[i - 1],
              py = pc === "1" ? top : pc === "0" ? bot : mid;
            ctx.strokeStyle =
              c === "x" || pc === "x"
                ? COL.red
                : c === "z" || pc === "z"
                  ? COL.yellow
                  : COL.green;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xa, py);
            ctx.lineTo(xa, yc);
            ctx.stroke();
          }
          if (c === "x") {
            ctx.fillStyle = COL.redFill;
            ctx.fillRect(xaD, top, xbD - xaD, bot - top);
            ctx.strokeStyle = COL.red;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xaD, top);
            ctx.lineTo(xbD, top);
            ctx.moveTo(xaD, bot);
            ctx.lineTo(xbD, bot);
            ctx.stroke();
          } else {
            ctx.strokeStyle = c === "z" ? COL.yellow : COL.green;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(xaD, yc);
            ctx.lineTo(xbD, yc);
            ctx.stroke();
          }
        }
      }
      flush();
    }

    function vline(t, color, dash) {
      var x = Math.round(xOf(t)) + 0.5;
      if (x < NW || x > S.w) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, S.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function draw() {
      S.raf = 0;
      if (!canvas.isConnected || !S.w) return;
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, S.w, S.h);
      var tk = ticks(),
        viewH = S.h - RULER;

      ctx.fillStyle = COL.grid;
      tk.list.forEach(function (t) {
        var x = Math.round(xOf(t));
        if (x >= NW) ctx.fillRect(x, RULER, 1, viewH);
      });

      /* waveforms */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER, S.w, viewH);
      ctx.clip();
      S.rows.forEach(function (row) {
        var y = RULER + row.y - S.scrollY;
        if (y + row.h < RULER || y > S.h) return;
        if (row.type === "g") {
          ctx.fillStyle = COL.group;
          ctx.fillRect(0, y, S.w, row.h);
          return;
        }
        if (row.id === S.selected) {
          ctx.fillStyle = COL.sel;
          ctx.fillRect(0, y, S.w, row.h);
        }
        ctx.fillStyle = COL.line;
        ctx.fillRect(0, y + row.h - 1, S.w, 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(NW, y, S.w - NW, row.h);
        ctx.clip();
        drawWave(sim.nets[sim.signals[row.id].net], y, row.h);
        ctx.restore();
      });
      if (S.cB !== null) vline(S.cB, COL.yellow);
      if (S.cA !== null) vline(S.cA, COL.blue);
      if (S.hoverT !== null) vline(S.hoverT, "rgba(255,255,255,0.28)", [4, 4]);
      ctx.restore();

      /* name column */
      var tq = S.cA !== null ? S.cA : S.hoverT;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER, NW, viewH);
      ctx.clip();
      ctx.fillStyle = COL.nameBg;
      ctx.fillRect(0, RULER, NW, viewH);
      S.rows.forEach(function (row) {
        var y = RULER + row.y - S.scrollY;
        if (y + row.h < RULER || y > S.h) return;
        var cy = y + row.h / 2;
        if (row.type === "g") {
          ctx.fillStyle = COL.group;
          ctx.fillRect(0, y, NW, row.h);
          ctx.fillStyle = COL.bright;
          ctx.font = "bold 14px " + FONT;
          ctx.textAlign = "left";
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y, NW - 6, row.h);
          ctx.clip();
          ctx.fillText(
            (row.collapsed ? "▸ " : "▾ ") + row.label + "  (" + row.count + ")",
            8 + row.depth * 10,
            cy,
          );
          ctx.restore();
          return;
        }
        var sig = sim.signals[row.id],
          net = sim.nets[sig.net],
          rec = an.health.byNet[sig.net];
        if (row.id === S.selected) {
          ctx.fillStyle = COL.sel;
          ctx.fillRect(0, y, NW, row.h);
        }
        ctx.fillStyle = COL.line;
        ctx.fillRect(0, y + row.h - 1, NW, 1);
        var vtxt = "",
          vcol = COL.bright;
        if (tq !== null) {
          var ii = idxAt(net.t, tq);
          if (ii >= 0) {
            var vv = net.v[ii];
            vtxt = fmtVal(vv, net.width, S.radix, net.isReal);
            vcol =
              vv.indexOf("x") !== -1
                ? COL.red
                : vv.indexOf("z") !== -1
                  ? COL.yellow
                  : COL.bright;
          }
        }
        ctx.font = "13px " + FONT;
        var vw = vtxt ? ctx.measureText(vtxt).width : 0;
        if (rec && (rec.status === "error" || rec.status === "warning")) {
          ctx.fillStyle = rec.status === "error" ? COL.red : COL.yellow;
          ctx.beginPath();
          ctx.arc(10, cy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = "15px " + FONT;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, NW - vw - 14, row.h);
        ctx.clip();
        ctx.fillStyle = COL.text;
        ctx.textAlign = "left";
        ctx.fillText(
          sig.name + (sig.width > 1 ? " [" + (sig.width - 1) + ":0]" : ""),
          20 + row.depth * 10,
          cy,
        );
        ctx.restore();
        if (vtxt) {
          ctx.font = "13px " + FONT;
          ctx.fillStyle = vcol;
          ctx.textAlign = "right";
          ctx.fillText(vtxt, NW - 8, cy);
          ctx.textAlign = "left";
        }
      });
      ctx.fillStyle = COL.border;
      ctx.fillRect(NW - 1, RULER, 1, viewH);
      ctx.restore();

      /* ruler */
      ctx.fillStyle = COL.ruler;
      ctx.fillRect(0, 0, S.w, RULER);
      ctx.fillStyle = COL.border;
      ctx.fillRect(0, RULER - 1, S.w, 1);
      ctx.font = "13px " + FONT;
      ctx.fillStyle = COL.muted;
      ctx.textAlign = "left";
      ctx.fillText("time (" + ts.text + " / tick)", 10, RULER / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(NW, 0, S.w - NW, RULER);
      ctx.clip();
      var minor = tk.step / 5;
      if (minor >= 1 && minor * ((S.w - NW) / (S.t1 - S.t0)) >= 6) {
        ctx.fillStyle = COL.border;
        var mt = Math.ceil(S.t0 / minor) * minor,
          g = 0;
        while (mt <= S.t1 && g++ < 800) {
          ctx.fillRect(Math.round(xOf(mt)), RULER - 5, 1, 4);
          mt += minor;
        }
      }
      tk.list.forEach(function (t) {
        var x = Math.round(xOf(t));
        ctx.fillStyle = COL.bright;
        ctx.fillRect(x, RULER - 9, 1, 8);
        ctx.fillStyle = COL.muted;
        ctx.textAlign = "left";
        ctx.fillText(ft(t), x + 4, RULER - 15);
      });
      markers.forEach(function (f) {
        var x = xOf(f.time);
        if (x < NW || x > S.w) return;
        ctx.fillStyle =
          f.severity === "error"
            ? COL.red
            : f.severity === "warning"
              ? COL.yellow
              : COL.blue;
        ctx.beginPath();
        ctx.moveTo(x - 4, 2);
        ctx.lineTo(x + 4, 2);
        ctx.lineTo(x, 10);
        ctx.closePath();
        ctx.fill();
      });
      [
        ["A", S.cA, COL.blue],
        ["B", S.cB, COL.yellow],
      ].forEach(function (c) {
        if (c[1] === null) return;
        var x = xOf(c[1]);
        if (x < NW || x > S.w) return;
        ctx.fillStyle = c[2];
        ctx.fillRect(x - 7, 12, 14, 14);
        ctx.fillStyle = "#0b0b11";
        ctx.font = "bold 12px " + FONT;
        ctx.textAlign = "center";
        ctx.fillText(c[0], x, 19);
      });
      ctx.restore();
      ctx.textAlign = "left";

      /* vertical scrollbar */
      S.sb = null;
      if (S.totalH > viewH) {
        var th = Math.max(24, (viewH * viewH) / S.totalH);
        var ty = RULER + (S.scrollY / (S.totalH - viewH)) * (viewH - th);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(S.w - SBW, RULER, SBW, viewH);
        ctx.fillStyle = "rgba(160,160,188,0.45)";
        ctx.fillRect(S.w - SBW + 2, ty, SBW - 4, th);
        S.sb = { y: ty, h: th };
      }
    }

    /* ---- sizing ---- */
    function size() {
      var W = wrap.clientWidth;
      if (W < 50) return;
      NW = W < 700 ? 170 : 270;
      var H = Math.max(380, Math.min(640, window.innerHeight - 300));
      var dpr = window.devicePixelRatio || 1;
      var cw = Math.round(W * dpr),
        ch = Math.round(H * dpr);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      canvas.style.height = H + "px";
      S.w = W;
      S.h = H;
      S.dpr = dpr;
      clampScroll();
      req();
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (!wrap.isConnected) {
          ro.disconnect();
          return;
        }
        size();
      });
      ro.observe(wrap);
    }
    window.addEventListener("resize", function onr() {
      if (!wrap.isConnected) {
        window.removeEventListener("resize", onr);
        return;
      }
      size();
    });

    /* ---- pointer / wheel ---- */
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function markerAt(x, y) {
      if (y >= RULER || x < NW) return null;
      var best = null,
        bd = 8;
      markers.forEach(function (f) {
        var d = Math.abs(xOf(f.time) - x);
        if (d < bd || (d === bd && best && f.severity === "error")) {
          bd = d;
          best = f;
        }
      });
      return best;
    }
    function dragSb(y) {
      var viewH = S.h - RULER,
        travel = Math.max(1, viewH - S.sb.h);
      var ratio = Math.max(0, Math.min(1, (y - RULER - S.drag.grab) / travel));
      S.scrollY = ratio * (S.totalH - viewH);
    }
    function hover(x, y) {
      S.hoverT = x >= NW ? tOf(x) : null;
      var f = markerAt(x, y);
      if (f) {
        tip.style.display = "block";
        tip.textContent = ft(f.time) + " — " + f.message;
        tip.style.left = Math.max(4, Math.min(x + 12, S.w - 300)) + "px";
        tip.style.top = y + 14 + "px";
        canvas.style.cursor = "pointer";
      } else {
        tip.style.display = "none";
        canvas.style.cursor = x < NW ? "default" : "crosshair";
      }
      updateStatus();
      req();
    }
    function click(x, y, shift) {
      var f = markerAt(x, y);
      if (f) {
        jumpToFinding(f);
        return;
      }
      if (y < RULER) return;
      var row = rowAtY(y);
      if (x < NW) {
        if (!row) return;
        if (row.type === "g") {
          S.collapsed[row.key] = !S.collapsed[row.key];
          rebuild();
          req();
        } else select(row.id, false);
        return;
      }
      var t = Math.max(0, Math.min(S.end, Math.round(tOf(x))));
      if (shift) S.cB = t;
      else S.cA = t;
      S.msg = "";
      if (row && row.type === "s") select(row.id, false);
      else renderInspector();
      updateStatus();
      req();
    }

    canvas.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var p = pos(e);
      if (S.sb && p.x >= S.w - SBW - 2 && p.y >= RULER) {
        S.drag = {
          type: "sb",
          grab:
            p.y >= S.sb.y && p.y <= S.sb.y + S.sb.h ? p.y - S.sb.y : S.sb.h / 2,
        };
        dragSb(p.y);
        req();
      } else {
        S.drag = {
          type: "pan",
          x0: p.x,
          y0: p.y,
          t0: S.t0,
          span: S.t1 - S.t0,
          sy: S.scrollY,
          moved: false,
          axis: "",
          inNames: p.x < NW,
        };
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = pos(e),
        d = S.drag;
      if (d && d.type === "sb") {
        dragSb(p.y);
        req();
        return;
      }
      if (d && d.type === "pan") {
        var dx = p.x - d.x0,
          dy = p.y - d.y0;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
          d.moved = true;
          d.axis = d.inNames ? "v" : Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
        }
        if (d.moved) {
          if (d.axis === "h") {
            S.t0 = d.t0 - (dx / (S.w - NW)) * d.span;
            S.t1 = S.t0 + d.span;
            clampView();
          } else {
            S.scrollY = d.sy - dy;
            clampScroll();
          }
          req();
        }
        return;
      }
      hover(p.x, p.y);
    });
    canvas.addEventListener("pointerup", function (e) {
      var d = S.drag;
      S.drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (!d || d.type !== "pan" || d.moved) return;
      var p = pos(e);
      click(p.x, p.y, e.shiftKey);
    });
    canvas.addEventListener("pointercancel", function () {
      S.drag = null;
    });
    canvas.addEventListener("pointerleave", function () {
      if (S.drag) return;
      S.hoverT = null;
      tip.style.display = "none";
      updateStatus();
      req();
    });
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var p = pos(e),
          dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (p.x < NW || e.shiftKey) {
          S.scrollY += dy;
          clampScroll();
          req();
          return;
        }
        zoomAt(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.002), tOf(p.x));
      },
      { passive: false },
    );

    /* ---- toolbar ---- */
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "in") zoomBy(0.5);
      else if (a === "out") zoomBy(2);
      else if (a === "fit") fit();
      else if (a === "cur") zoomCursors();
      else if (a === "clear") {
        S.cA = null;
        S.cB = null;
        S.msg = "";
        updateStatus();
        renderInspector();
        req();
      } else if (a === "err") firstError();
      else if (a === "expand") {
        S.collapsed = {};
        rebuild();
        req();
      } else if (a === "collapse") {
        S.groupKeys.forEach(function (k) {
          S.collapsed[k] = true;
        });
        S.scrollY = 0;
        rebuild();
        req();
      }
    });
    el.querySelector("#vwRadix").addEventListener("change", function (e) {
      S.radix = e.target.value;
      renderInspector();
      req();
    });
    el.querySelector("#vwGroup").addEventListener("change", function (e) {
      S.group = e.target.value;
      S.collapsed = S.group === "scope" ? defaultCollapsed(sim) : {};
      S.scrollY = 0;
      rebuild();
      req();
    });
    el.querySelector("#vwSearch").addEventListener("input", function (e) {
      S.search = e.target.value;
      S.scrollY = 0;
      rebuild();
      req();
    });
    insp.addEventListener("click", function (e) {
      var b = e.target.closest("[data-jump]");
      if (!b) return;
      var t = Number(b.getAttribute("data-jump"));
      S.cA = t;
      jumpTo(t);
      updateStatus();
      renderInspector();
    });

    /* ---- start ---- */
    rebuild();
    renderInspector();
    updateStatus();
    if (VCD.viewerJump !== null && VCD.viewerJump !== undefined) {
      S.cA = VCD.viewerJump;
      VCD.viewerJump = null;
      jumpTo(S.cA);
      updateStatus();
    }
    size();
  }

  VCD.renderers[1] = { html: html, mount: mount };
})();
