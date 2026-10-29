/* VCDInsight — ui-compare.js (Step 6)
   Module 06: Sim vs FPGA (second capture).                                  */
"use strict";

(function () {
  var esc = VCD.esc;
  var ui = { C: null, selected: -1, filter: "diff", c0: 0, c1: 1 };
  var BADGE = {
    match: "badge-pass",
    differ: "badge-fail",
    unknown: "badge-warning",
  };
  var LABEL = { match: "MATCH", differ: "DIFFERENT", unknown: "X / Z ONLY" };
  var COL = {
    bg: "#0b0b11",
    label: "#101019",
    grid: "rgba(255,255,255,0.045)",
    line: "rgba(255,255,255,0.06)",
    green: "#00cc66",
    blue: "#4f8eff",
    red: "#ff3344",
    yellow: "#ffaa00",
    redFill: "rgba(255,51,68,0.2)",
    text: "#e8e8f0",
    muted: "#7a7a92",
    bright: "#a0a0bc",
    dense: "rgba(160,160,188,0.55)",
    ruler: "#12121c",
    border: "#2a2a3a",
  };
  var FONT = "'Times New Roman', Times, serif";

  function ft(t) {
    return VCD.fmtTime(t, VCD.state.sim.header.timescale);
  }
  function ftc(t) {
    return VCD.fmtTime(t, VCD.state.cmp.header.timescale);
  }
  function sh(v) {
    return VCD.transactions.show(v);
  }
  function f1(x) {
    return x === null || x === undefined
      ? "—"
      : (Math.round(x * 10) / 10).toString();
  }
  function plural(n, w) {
    return n + " " + w + (n === 1 ? "" : "s");
  }

  function msgHtml(title, text) {
    return (
      '<div class="panel-placeholder"><div class="p-label">// ' +
      title +
      '</div><div class="p-note">' +
      text +
      "</div></div>"
    );
  }

  function modeText(cap) {
    var ts = cap.data.header.timescale;
    return cap.mode === "clock"
      ? "clock found, period " +
          VCD.fmtTime(cap.period, ts) +
          ", sampled just before each rising edge"
      : "no clock found, every sample point is one cycle (" +
          VCD.fmtTime(cap.period, ts) +
          " apart)";
  }

  /* ───────── sections ───────── */
  function headHtml(C) {
    var st = VCD.state,
      r = C.result;
    var ce = st.findings.filter(function (f) {
      return f.source === "compare";
    });
    var errs = ce.filter(function (f) {
      return f.severity === "error";
    }).length;
    var warns = ce.filter(function (f) {
      return f.severity === "warning";
    }).length;
    var level,
      cls,
      sub = "";
    if (!r || !r.ok) {
      level = "NOT COMPARED";
      cls = "warning";
    } else if (errs) {
      level = "DIFFERENT";
      cls = "fail";
    } else if (warns) {
      level = "REVIEW";
      cls = "warning";
    } else {
      level = "IDENTICAL";
      cls = "pass";
    }
    if (r && r.ok) {
      sub =
        r.identical +
        " of " +
        r.pairs.length +
        " compared signals are identical · " +
        plural(r.N, "cycle") +
        " compared · cycle match " +
        r.matchPct.toFixed(2) +
        " %";
    }
    return (
      '<div class="panel-title">// SIM VS FPGA</div>' +
      '<div class="panel-sub">Simulation (' +
      esc(st.sim.fileName) +
      ") against the second capture (" +
      esc(st.cmp.fileName) +
      "), aligned cycle by cycle. A different clock speed does not matter, because cycles are compared and not times.</div>" +
      '<div class="verdict-box" style="padding:18px 20px"><div class="verdict-badge badge-' +
      cls +
      '" style="font-size:2rem;padding:10px 36px">' +
      level +
      "</div>" +
      (sub ? '<div class="verdict-reason">' + sub + "</div>" : "") +
      (r && !r.ok
        ? '<div class="verdict-reason">' + esc(r.message) + "</div>"
        : "") +
      (!r
        ? '<div class="verdict-reason">' +
          esc(C.error || C.prepError || "The comparison could not run.") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function settingsHtml(C) {
    var S = C.settings,
      r = C.result;
    function o(v, l) {
      return (
        '<option value="' +
        v +
        '"' +
        (S.anchor === v ? " selected" : "") +
        ">" +
        l +
        "</option>"
      );
    }
    var info = "";
    if (r && r.ok) {
      info =
        '<div class="inspector-row"><b>ALIGNED AT</b>cycle 0 = simulation edge at ' +
        ft(C.capS.edges[r.sa]) +
        " and capture edge at " +
        ftc(C.capC.edges[r.ca]) +
        " (" +
        esc(r.baseHow) +
        (r.delta
          ? "; shifted by " +
            r.delta +
            " cycle(s)" +
            (r.anchor === "auto" ? " by the auto-search" : "")
          : "") +
        ")</div>";
    }
    info +=
      '<div class="inspector-row"><b>SIMULATION</b>' +
      esc(modeText(C.capS || { mode: "", period: 0, data: VCD.state.sim })) +
      "</div>";
    if (C.capC)
      info +=
        '<div class="inspector-row"><b>SECOND CAPTURE</b>' +
        esc(modeText(C.capC)) +
        "</div>";
    if (r && r.ok && r.simCycles !== r.cmpCycles) {
      info +=
        '<div class="inspector-row"><b>LENGTH</b>simulation ' +
        plural(r.simCycles, "cycle") +
        ", capture " +
        plural(r.cmpCycles, "cycle") +
        " after alignment; the first " +
        r.N +
        " were compared</div>";
    }
    return (
      '<div class="inspector" style="margin-top:14px"><div class="inspector-title">Alignment</div>' +
      info +
      '<div class="viewer-toolbar" style="margin:12px 0 0">' +
      '<select class="tool-input" id="cpAnchor">' +
      o("reset", "Align at reset release") +
      o("start", "Align at first cycle") +
      o("auto", "Auto-search the best shift") +
      "</select>" +
      '<input class="tool-input" id="cpOffset" type="number" step="1" value="' +
      (parseInt(S.offset, 10) || 0) +
      '" style="width:90px" title="Shift the capture by N cycles">' +
      '<label class="text-muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="cpIgnore"' +
      (S.ignoreUnknown ? " checked" : "") +
      "> Ignore X / Z differences</label>" +
      '<button class="tool-btn" type="button" data-act="apply">APPLY</button></div>' +
      '<div class="text-muted" style="font-size:0.9rem;margin-top:6px">The shift applies to the first two modes. Auto-search tries ±64 cycles on the busiest signals and ignores the shift box.</div></div>'
    );
  }

  function firstHtml(C) {
    var r = C.result;
    if (!r || !r.ok) return "";
    if (!r.first) {
      return '<div class="panel-title" style="margin-top:22px">// FIRST MISMATCH</div><div class="ai-card"><div class="ai-row"><span class="text-muted">No difference was found between the compared signals.</span></div></div>';
    }
    var f = r.first;
    var list = f.pairs
      .slice(0, 12)
      .map(function (i) {
        var p = r.pairs[i],
          v = f.kind === "value" ? p.firstV : p.firstU;
        return (
          '<div class="ai-row"><button class="link-btn" type="button" data-act="pick" data-pi="' +
          i +
          '">' +
          esc(p.sSig.name) +
          "</button>" +
          "<span>simulation " +
          esc(sh(v.a)) +
          " · second capture " +
          esc(sh(v.b)) +
          "</span></div>"
        );
      })
      .join("");
    return (
      '<div class="panel-title" style="margin-top:22px">// FIRST MISMATCH</div>' +
      '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name" style="font-size:1rem">CYCLE ' +
      f.c +
      "</span>" +
      '<span><span class="badge ' +
      (f.kind === "value" ? "badge-fail" : "badge-warning") +
      '">' +
      (f.kind === "value" ? "VALUE DIFFERS" : "X / Z ONLY") +
      "</span></span></div>" +
      '<div class="ai-row"><span>Simulation edge at ' +
      ft(f.simTime) +
      " · second capture edge at " +
      ftc(f.cmpTime) +
      "</span></div>" +
      list +
      (f.pairs.length > 12
        ? '<div class="text-muted">…and ' +
          (f.pairs.length - 12) +
          " more signals at the same cycle</div>"
        : "") +
      '<div style="margin-top:10px"><button class="tool-btn" type="button" data-act="viewer" data-t="' +
      f.simTime +
      '">OPEN IN WAVEFORM VIEWER</button></div></div>'
    );
  }

  function sigRowsHtml(C, filter) {
    var r = C.result,
      rank = { differ: 0, unknown: 1, match: 2 };
    var list = r.pairs.map(function (p, i) {
      return { p: p, i: i };
    });
    if (filter === "diff")
      list = list.filter(function (x) {
        return x.p.status !== "match";
      });
    else if (filter === "match")
      list = list.filter(function (x) {
        return x.p.status === "match";
      });
    list.sort(function (a, b) {
      return (
        rank[a.p.status] - rank[b.p.status] ||
        (a.p.first ? a.p.first.c : 1e12) - (b.p.first ? b.p.first.c : 1e12) ||
        a.p.sSig.name.localeCompare(b.p.sSig.name)
      );
    });
    var capped = list.length > 1500;
    if (capped) list = list.slice(0, 1500);
    if (!list.length)
      return '<tr><td colspan="6" class="text-muted">No signals in this view.</td></tr>';
    return list
      .map(function (x) {
        var p = x.p,
          f = p.first;
        var firstTxt = f
          ? "cycle " +
            f.c +
            " · " +
            esc(ft(VCD.compare.cycleTime("sim", f.c))) +
            "<br>" +
            esc(sh(f.a)) +
            " vs " +
            esc(sh(f.b))
          : "—";
        return (
          '<tr data-pi="' +
          x.i +
          '" style="cursor:pointer"><td><b>' +
          esc(p.sSig.name) +
          "</b>" +
          (p.width > 1
            ? ' <span class="text-muted">[' + p.width + "]</span>"
            : "") +
          '<div class="text-muted" style="font-size:0.85rem">' +
          esc(p.sSig.scopePath || "(root)") +
          "</div></td>" +
          "<td>" +
          esc(p.cSig.name) +
          '<div class="text-muted" style="font-size:0.85rem">' +
          esc(p.how) +
          "</div></td>" +
          "<td>" +
          p.bad +
          " of " +
          r.N +
          '</td><td style="font-size:0.95rem">' +
          firstTxt +
          "</td>" +
          '<td><span class="badge ' +
          BADGE[p.status] +
          '">' +
          LABEL[p.status] +
          "</span></td></tr>"
        );
      })
      .join("");
  }

  function signalsHtml(C) {
    var r = C.result;
    if (!r || !r.ok) return "";
    return (
      '<div class="panel-title" style="margin-top:26px">// SIGNALS</div>' +
      '<div class="panel-sub">Click a row to see both waveforms side by side. Clock signals are not compared.</div>' +
      '<div class="viewer-toolbar"><select class="tool-input" id="cpFilter">' +
      '<option value="diff"' +
      (ui.filter === "diff" ? " selected" : "") +
      ">Differing only</option>" +
      '<option value="all"' +
      (ui.filter === "all" ? " selected" : "") +
      ">All signals</option>" +
      '<option value="match"' +
      (ui.filter === "match" ? " selected" : "") +
      ">Matching only</option></select></div>" +
      '<div class="table-scroll" style="max-height:420px;overflow-y:auto"><table class="data-table"><thead><tr>' +
      "<th>Simulation signal</th><th>Capture signal</th><th>Mismatch cycles</th><th>First mismatch</th><th>Status</th></tr></thead>" +
      '<tbody id="cpRows">' +
      sigRowsHtml(C, ui.filter) +
      "</tbody></table></div>" +
      '<div id="cpOv" style="margin-top:16px"></div>'
    );
  }

  function txHtml(C) {
    var r = C.result;
    if (!r || !r.ok) return "";
    var body;
    if (!r.tx.length)
      body =
        '<div class="ai-card"><div class="ai-row"><span class="text-muted">' +
        esc(r.txNote || "No interfaces to compare.") +
        "</span></div></div>";
    else {
      body =
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Interface</th><th>Transfers sim / capture</th>' +
        "<th>Latency avg sim / capture</th><th>Wait avg sim / capture</th><th>Result</th></tr></thead><tbody>" +
        r.tx
          .map(function (row) {
            var res;
            if (!row.found)
              res =
                '<span class="text-muted">not found in the second capture</span>';
            else if (row.diff)
              res =
                '<span class="tx-fail">DIFFERS</span> <span class="text-muted" style="font-size:0.9rem">' +
                esc(row.diff.text) +
                "</span>";
            else if (row.nS !== row.nC)
              res = '<span class="tx-warn">COUNT DIFFERS</span>';
            else res = '<span class="tx-ok">SAME SEQUENCE</span>';
            return (
              "<tr><td><b>" +
              esc(row.name) +
              '</b><div class="text-muted" style="font-size:0.85rem">' +
              esc(row.scope || "(root)") +
              "</div></td>" +
              "<td>" +
              row.nS +
              " / " +
              (row.found ? row.nC : "—") +
              "</td><td>" +
              f1(row.latS) +
              " / " +
              f1(row.latC) +
              " cyc</td>" +
              "<td>" +
              f1(row.waitS) +
              " / " +
              f1(row.waitC) +
              " cyc</td><td>" +
              res +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    }
    return (
      '<div class="panel-title" style="margin-top:26px">// TRANSACTIONS</div>' +
      '<div class="panel-sub">Interfaces are matched by name. Each transfer (operation, address, data) is compared in order.</div>' +
      body
    );
  }

  function unmatchedHtml(C) {
    var r = C.result;
    if (!r || !r.m) return "";
    var st = VCD.state,
      m = r.m;
    function opts(ids, sigs, ph) {
      return (
        '<option value="">' +
        ph +
        "</option>" +
        ids
          .map(function (id) {
            var s = sigs[id];
            return (
              '<option value="' +
              esc(s.fullName) +
              '">' +
              esc(s.fullName + " (" + s.width + " bit)") +
              "</option>"
            );
          })
          .join("")
      );
    }
    function names(ids, sigs) {
      var h = ids
        .slice(0, 60)
        .map(function (id) {
          return esc(sigs[id].fullName);
        })
        .join(", ");
      return (
        h + (ids.length > 60 ? " … and " + (ids.length - 60) + " more" : "")
      );
    }
    var manual = C.manual.length
      ? C.manual
          .map(function (x, i) {
            return (
              '<div class="ai-row"><span>' +
              esc(x.sim) +
              " ↔ " +
              esc(x.cmp) +
              '</span><button class="link-btn" type="button" data-act="unpair" data-i="' +
              i +
              '">remove</button></div>'
            );
          })
          .join("")
      : '<div class="text-muted">No manual pairs yet.</div>';
    return (
      '<div class="panel-title" style="margin-top:26px">// UNMATCHED SIGNALS</div>' +
      '<div class="panel-sub">Signals are matched by name. If your FPGA capture uses different names, pair them by hand here (same width only).</div>' +
      '<div class="text-muted" style="margin-bottom:10px">' +
      m.unmatchedSim.length +
      " simulation signal(s) and " +
      m.unmatchedCmp.length +
      " capture signal(s) are unmatched" +
      (m.widthSkipped.length
        ? "; " +
          m.widthSkipped.length +
          " were skipped because the widths differ"
        : "") +
      ".</div>" +
      '<div class="viewer-toolbar"><select class="tool-input" id="cpManSim" style="max-width:320px">' +
      opts(m.unmatchedSim, st.sim.signals, "Simulation signal…") +
      "</select>" +
      '<select class="tool-input" id="cpManCmp" style="max-width:320px">' +
      opts(m.unmatchedCmp, st.cmp.signals, "Capture signal…") +
      "</select>" +
      '<button class="tool-btn" type="button" data-act="pair">PAIR</button></div>' +
      '<div class="text-warn" id="cpMsg" style="min-height:1.3em;margin-bottom:8px"></div>' +
      manual +
      '<details style="margin-top:12px"><summary class="text-muted" style="cursor:pointer">Show unmatched simulation signals</summary><div class="text-muted" style="margin:8px 0">' +
      (names(m.unmatchedSim, st.sim.signals) || "none") +
      "</div></details>" +
      '<details style="margin-top:6px"><summary class="text-muted" style="cursor:pointer">Show unmatched capture signals</summary><div class="text-muted" style="margin:8px 0">' +
      (names(m.unmatchedCmp, st.cmp.signals) || "none") +
      "</div></details>"
    );
  }

  /* ───────── panel ───────── */
  function html() {
    var st = VCD.state;
    if (!st.sim || !st.analysis)
      return msgHtml(
        "SIM VS FPGA",
        "No analysis data yet. Go back and analyse a file first.",
      );
    if (!st.cmp)
      return msgHtml(
        "SIM VS FPGA",
        "This module is locked. Go back to the first page and add a second capture (for example an FPGA VCD) to unlock the comparison.",
      );
    var C = st.compare;
    if (!C)
      return msgHtml(
        "SIM VS FPGA",
        "The comparison did not run. Go back and analyse the files again.",
      );
    if (ui.C !== C) {
      ui.C = C;
      ui.c0 = 0;
      ui.c1 = 1;
      ui.filter = "diff";
      ui.selected = -1;
      var r = C.result;
      if (r && r.ok) {
        var firstDiff = -1;
        r.pairs.forEach(function (p, i) {
          if (firstDiff < 0 && p.status === "differ") firstDiff = i;
        });
        if (firstDiff < 0)
          r.pairs.forEach(function (p, i) {
            if (firstDiff < 0 && p.status === "unknown") firstDiff = i;
          });
        ui.selected = firstDiff >= 0 ? firstDiff : 0;
        if (firstDiff < 0) ui.filter = "all";
      }
    }
    return (
      '<div id="cpRoot">' +
      headHtml(C) +
      settingsHtml(C) +
      firstHtml(C) +
      signalsHtml(C) +
      txHtml(C) +
      unmatchedHtml(C) +
      "</div>"
    );
  }

  function mount(el) {
    var C = VCD.state.compare;
    if (!VCD.state.cmp || !C) return;
    wire(el);
  }

  function rerender(el) {
    el.innerHTML = html();
    wire(el);
  }

  function wire(el) {
    var root = el.querySelector("#cpRoot");
    if (!root) return;
    var C = VCD.state.compare;

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      var row = e.target.closest("tr[data-pi]");
      if (!b && row) {
        selectPair(root, Number(row.getAttribute("data-pi")));
        return;
      }
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "apply") {
        VCD.compare.setSettings({
          anchor: root.querySelector("#cpAnchor").value,
          offset: parseInt(root.querySelector("#cpOffset").value, 10) || 0,
          ignoreUnknown: root.querySelector("#cpIgnore").checked,
        });
        ui.C = null;
        rerender(el);
      } else if (act === "pick") {
        ui.filter = "all";
        var sel = root.querySelector("#cpFilter");
        if (sel) {
          sel.value = "all";
          root.querySelector("#cpRows").innerHTML = sigRowsHtml(C, "all");
        }
        selectPair(root, Number(b.getAttribute("data-pi")));
        var ov = root.querySelector("#cpOv");
        if (ov) ov.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (act === "viewer") {
        VCD.viewerJump = Number(b.getAttribute("data-t"));
        window.openPanel("1");
      } else if (act === "pair") {
        var err = VCD.compare.addManual(
          root.querySelector("#cpManSim").value,
          root.querySelector("#cpManCmp").value,
        );
        if (err) {
          root.querySelector("#cpMsg").textContent = err;
          return;
        }
        ui.C = null;
        rerender(el);
      } else if (act === "unpair") {
        VCD.compare.removeManual(Number(b.getAttribute("data-i")));
        ui.C = null;
        rerender(el);
      }
    });

    var filter = root.querySelector("#cpFilter");
    if (filter) {
      filter.addEventListener("change", function () {
        ui.filter = filter.value;
        root.querySelector("#cpRows").innerHTML = sigRowsHtml(C, ui.filter);
        highlight(root);
      });
    }
    var an = root.querySelector("#cpAnchor");
    var off = root.querySelector("#cpOffset");
    function syncOff() {
      if (an && off) off.disabled = an.value === "auto";
    }
    if (an) {
      an.addEventListener("change", syncOff);
      syncOff();
    }

    if (C.result && C.result.ok) {
      highlight(root);
      setupOverlay(root);
    }
  }

  function highlight(root) {
    Array.prototype.forEach.call(
      root.querySelectorAll("#cpRows tr[data-pi]"),
      function (tr) {
        tr.style.background =
          Number(tr.getAttribute("data-pi")) === ui.selected
            ? "rgba(79,142,255,0.14)"
            : "";
      },
    );
  }

  function selectPair(root, pi) {
    ui.selected = pi;
    ui.c0 = 0;
    ui.c1 = 1;
    highlight(root);
    setupOverlay(root);
  }

  /* ───────── side-by-side overlay canvas ───────── */
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)),
      f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function lastLE(arr, x) {
    var lo = 0,
      hi = arr.length - 1,
      r = -1,
      mid;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (arr[mid] <= x) {
        r = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return r;
  }

  function setupOverlay(root) {
    var box = root.querySelector("#cpOv");
    if (!box) return;
    var C = VCD.state.compare,
      r = C.result;
    var ser = ui.selected >= 0 ? VCD.compare.series(ui.selected) : null;
    if (!ser) {
      box.innerHTML =
        '<div class="text-muted">Select a signal in the table to see both waveforms.</div>';
      return;
    }
    var p = ser.p,
      N = ser.N,
      bus = ser.width > 1;
    var LEFT = 90,
      RULER = 26,
      ROW = 46,
      H = RULER + ROW * 3 + 8;

    box.innerHTML =
      '<div class="inspector" style="margin-top:0"><div class="inspector-title">' +
      esc(p.sSig.name) +
      (p.width > 1 ? " [" + p.width + " bit]" : "") +
      ' <span class="badge ' +
      BADGE[p.status] +
      '">' +
      LABEL[p.status] +
      "</span></div>" +
      '<div class="inspector-row"><b>SIMULATION</b>' +
      esc(p.sSig.fullName) +
      '</div><div class="inspector-row"><b>CAPTURE</b>' +
      esc(p.cSig.fullName) +
      " (" +
      esc(p.how) +
      ")</div>" +
      '<div class="viewer-toolbar" style="margin:12px 0 10px"><button class="tool-btn" type="button" data-ov="in">ZOOM +</button><button class="tool-btn" type="button" data-ov="out">ZOOM −</button>' +
      '<button class="tool-btn" type="button" data-ov="fit">FIT</button>' +
      (p.first
        ? '<button class="tool-btn" type="button" data-ov="first">GO TO FIRST MISMATCH</button>'
        : "") +
      "</div>" +
      '<div class="viewer-wrap" id="cpWrap" style="position:relative"><canvas id="cpCanvas"></canvas></div>' +
      '<div class="text-muted" id="cpStatus" style="margin-top:8px;min-height:1.4em">Wheel = zoom · drag = pan · the third row marks cycles where the two differ (red = values differ, yellow = X / Z only).</div></div>';

    var wrap = box.querySelector("#cpWrap"),
      canvas = box.querySelector("#cpCanvas"),
      status = box.querySelector("#cpStatus");
    var ctx = canvas.getContext("2d");
    var W = 0,
      dpr = 1,
      raf = 0,
      hoverC = null,
      drag = null;
    if (!(ui.c1 > ui.c0)) {
      ui.c0 = 0;
      ui.c1 = Math.max(1, N);
    }
    if (ui.c1 - ui.c0 === 1 && N > 1) {
      ui.c0 = 0;
      ui.c1 = N;
    }

    function req() {
      if (!raf) raf = requestAnimationFrame(draw);
    }
    function xOf(c) {
      return LEFT + ((c - ui.c0) * (W - LEFT)) / (ui.c1 - ui.c0);
    }
    function cOf(x) {
      return ui.c0 + ((x - LEFT) * (ui.c1 - ui.c0)) / (W - LEFT);
    }
    function clampView() {
      var span = ui.c1 - ui.c0,
        minSpan = Math.min(4, N),
        maxSpan = Math.max(1, N);
      if (span < minSpan) span = minSpan;
      if (span > maxSpan) span = maxSpan;
      if (ui.c0 < 0) ui.c0 = 0;
      if (ui.c0 + span > N) ui.c0 = Math.max(0, N - span);
      ui.c1 = ui.c0 + span;
    }
    function zoomAt(f, c) {
      var span = ui.c1 - ui.c0,
        ns = span * f,
        ratio = (c - ui.c0) / span;
      ui.c0 = c - ratio * ns;
      ui.c1 = ui.c0 + ns;
      clampView();
      req();
    }

    function drawSeries(S, y0) {
      var top = y0 + 9,
        bot = y0 + ROW - 9,
        mid = (top + bot) / 2,
        i,
        c0,
        c1,
        xa,
        xb,
        v,
        xaD,
        xbD,
        pv,
        color;
      ctx.save();
      ctx.beginPath();
      ctx.rect(LEFT, y0, W - LEFT, ROW);
      ctx.clip();
      ctx.font = "13px " + FONT;
      for (i = Math.max(0, lastLE(S.cs, ui.c0)); i < S.cs.length; i++) {
        c0 = S.cs[i];
        c1 = i + 1 < S.cs.length ? S.cs[i + 1] : N;
        if (c0 > ui.c1) break;
        xa = xOf(c0);
        xb = xOf(c1);
        v = S.vs[i];
        xaD = Math.max(xa, LEFT);
        xbD = Math.min(xb, W);
        if (xbD <= xaD) continue;
        if (xb - xa < 1) {
          ctx.fillStyle = COL.dense;
          ctx.fillRect(xaD, top, 1, bot - top);
          continue;
        }
        if (bus) {
          var isX = v.indexOf("x") !== -1,
            isZ = !isX && v.indexOf("z") !== -1,
            sl = Math.min(4, (xbD - xaD) / 2);
          color = isX ? COL.red : isZ ? COL.yellow : COL.blue;
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
          if (xbD - xaD > 28) {
            var label = sh(v),
              tw = ctx.measureText(label).width;
            if (tw + 10 < xbD - xaD) {
              ctx.fillStyle = isX ? COL.red : isZ ? COL.yellow : COL.text;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(label, (xaD + xbD) / 2, mid);
              ctx.textAlign = "left";
            }
          }
        } else {
          var yc = v === "1" ? top : v === "0" ? bot : mid;
          if (i > 0 && xa >= LEFT) {
            pv = S.vs[i - 1];
            ctx.strokeStyle =
              pv === "x" || v === "x"
                ? COL.red
                : pv === "z" || v === "z"
                  ? COL.yellow
                  : COL.green;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xa, pv === "1" ? top : pv === "0" ? bot : mid);
            ctx.lineTo(xa, yc);
            ctx.stroke();
          }
          if (v === "x") {
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
            ctx.strokeStyle = v === "z" ? COL.yellow : COL.green;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(xaD, yc);
            ctx.lineTo(xbD, yc);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    function draw() {
      raf = 0;
      if (!canvas.isConnected || !W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, W, H);

      var span = ui.c1 - ui.c0,
        step = Math.max(1, niceStep(span / Math.max(1, (W - LEFT) / 70)));
      var t = Math.ceil(ui.c0 / step) * step,
        g = 0,
        x;
      while (t <= ui.c1 && g++ < 400) {
        x = Math.round(xOf(t));
        ctx.fillStyle = COL.grid;
        ctx.fillRect(x, RULER, 1, H - RULER);
        t += step;
      }

      var names = ["SIMULATION", "CAPTURE", "DIFFERENCE"],
        k;
      for (k = 0; k < 3; k++) {
        var y0 = RULER + k * ROW;
        ctx.fillStyle = COL.line;
        ctx.fillRect(0, y0 + ROW - 1, W, 1);
        if (k === 0) drawSeries(ser.A, y0);
        else if (k === 1) drawSeries(ser.B, y0);
        else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(LEFT, y0, W - LEFT, ROW);
          ctx.clip();
          ser.diff.forEach(function (d) {
            var xa = xOf(d.c),
              xb = xOf(d.c + d.len);
            if (xb < LEFT || xa > W) return;
            ctx.fillStyle = d.kind === "value" ? COL.red : COL.yellow;
            ctx.fillRect(
              Math.max(LEFT, xa),
              y0 + 10,
              Math.max(2, Math.min(W, xb) - Math.max(LEFT, xa)),
              ROW - 20,
            );
          });
          ctx.restore();
          if (!ser.diff.length) {
            ctx.fillStyle = COL.muted;
            ctx.font = "13px " + FONT;
            ctx.fillText("no differences", LEFT + 10, y0 + ROW / 2);
          }
        }
      }

      ctx.fillStyle = COL.label;
      ctx.fillRect(0, RULER, LEFT - 1, ROW * 3);
      ctx.font = "bold 12px " + FONT;
      ctx.fillStyle = COL.bright;
      for (k = 0; k < 3; k++)
        ctx.fillText(names[k], 8, RULER + k * ROW + ROW / 2);
      ctx.fillStyle = COL.border;
      ctx.fillRect(LEFT - 1, RULER, 1, ROW * 3);

      ctx.fillStyle = COL.ruler;
      ctx.fillRect(0, 0, W, RULER);
      ctx.fillStyle = COL.border;
      ctx.fillRect(0, RULER - 1, W, 1);
      ctx.font = "13px " + FONT;
      ctx.fillStyle = COL.muted;
      ctx.fillText("cycle", 10, RULER / 2);
      t = Math.ceil(ui.c0 / step) * step;
      g = 0;
      while (t <= ui.c1 && g++ < 400) {
        x = Math.round(xOf(t));
        ctx.fillStyle = COL.bright;
        ctx.fillRect(x, RULER - 8, 1, 7);
        ctx.fillStyle = COL.muted;
        ctx.fillText(String(Math.round(t)), x + 4, RULER / 2);
        t += step;
      }
      if (hoverC !== null) {
        x = Math.round(xOf(hoverC)) + 0.5;
        if (x >= LEFT && x <= W) {
          ctx.strokeStyle = "rgba(255,255,255,0.28)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, RULER);
          ctx.lineTo(x, H);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    function size() {
      var w = wrap.clientWidth;
      if (w < 100) return;
      dpr = window.devicePixelRatio || 1;
      var cw = Math.round(w * dpr),
        ch = Math.round(H * dpr);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      canvas.style.height = H + "px";
      W = w;
      clampView();
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

    function pos(e) {
      var b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }
    function say(c) {
      if (c === null || c < 0 || c >= N) {
        status.textContent =
          "Wheel = zoom · drag = pan · the third row marks cycles where the two differ (red = values differ, yellow = X / Z only).";
        return;
      }
      var ia = lastLE(ser.A.cs, c),
        ib = lastLE(ser.B.cs, c);
      status.textContent =
        "cycle " +
        c +
        " · simulation " +
        sh(ser.A.vs[ia]) +
        " (" +
        ft(VCD.compare.cycleTime("sim", c)) +
        ") · capture " +
        sh(ser.B.vs[ib]) +
        " (" +
        ftc(VCD.compare.cycleTime("cmp", c)) +
        ")";
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var q = pos(e);
      drag = { x0: q.x, c0: ui.c0, span: ui.c1 - ui.c0 };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      var q = pos(e);
      if (drag) {
        ui.c0 = drag.c0 - ((q.x - drag.x0) / (W - LEFT)) * drag.span;
        ui.c1 = ui.c0 + drag.span;
        clampView();
        req();
        return;
      }
      hoverC = q.x >= LEFT ? Math.floor(cOf(q.x)) : null;
      say(hoverC);
      req();
    });
    canvas.addEventListener("pointerup", function (e) {
      drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
    });
    canvas.addEventListener("pointerleave", function () {
      if (!drag) {
        hoverC = null;
        say(null);
        req();
      }
    });
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var q = pos(e),
          dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(
          Math.exp(Math.max(-300, Math.min(300, dy)) * 0.002),
          q.x >= LEFT ? cOf(q.x) : (ui.c0 + ui.c1) / 2,
        );
      },
      { passive: false },
    );
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ov]");
      if (!b) return;
      var a = b.getAttribute("data-ov"),
        mid = (ui.c0 + ui.c1) / 2;
      if (a === "in") zoomAt(0.5, mid);
      else if (a === "out") zoomAt(2, mid);
      else if (a === "fit") {
        ui.c0 = 0;
        ui.c1 = Math.max(1, N);
        clampView();
        req();
      } else if (a === "first" && p.first) {
        var span = Math.min(Math.max(1, N), 40);
        ui.c0 = p.first.c - span / 2;
        ui.c1 = ui.c0 + span;
        clampView();
        req();
      }
    });
    size();
  }

  VCD.renderers[6] = { html: html, mount: mount };
})();
