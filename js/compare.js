/* VCDInsight — compare.js (Step 6)
   Compares the simulation with a second capture (for example an FPGA VCD).
   - Signals are matched by name (exact, scope suffix, name only, or manual pairs).
   - Both captures are aligned by clock cycle (reset release, first cycle, or auto-search).
   - Each signal is compared cycle by cycle, using only the change events (fast).
   - Transactions (from transactions.js) are compared per interface.
   Public: VCD.compare = { init, run, sync, setSettings, addManual, removeManual,
                           series, cycleTime, diffSegments }                       */
"use strict";

(function () {
  var MAX_EDGES = 2000000;
  var MAX_INT = 40;
  var AUTO_RANGE = 64;
  var AUTO_CYCLES = 2000;
  var AUTO_PAIRS = 12;
  var MAX_TX_FIND = 10;
  var DEFAULTS = { anchor: "reset", offset: 0, ignoreUnknown: false };

  function norm(v) {
    return String(v).replace(/^0+(?=.)/, "");
  }
  function unknown(v) {
    return /[xz]/.test(v);
  }
  function show(v) {
    return VCD.transactions.show(v);
  }
  function gcd(a, b) {
    var t;
    while (b) {
      t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  /* "value" = both known but different, "unknown" = X/Z involved, null = same */
  function classify(a, b, ign) {
    if (a === b) return null;
    var ua = unknown(a),
      ub = unknown(b);
    if (ua || ub) return ign ? null : "unknown";
    return norm(a) === norm(b) ? null : "value";
  }

  /* ───────── capture: the list of sampling points (cycles) ───────── */
  function visibleFrom(cap, t) {
    var E = cap.edges,
      lo = 0,
      hi = E.length,
      gt = cap.mode === "clock",
      mid;
    while (lo < hi) {
      mid = (lo + hi) >> 1;
      if (gt ? E[mid] <= t : E[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function buildCapture(data, rd) {
    var clk = rd.clock,
      edges = [],
      mode = "",
      period = 0,
      i;
    if (clk && clk.periodic && clk.period > 0) {
      var cn = data.nets[data.signals[clk.signalId].net];
      for (i = 1; i < cn.t.length; i++)
        if (cn.v[i] === "1" && cn.v[i - 1] === "0") edges.push(cn.t[i]);
      if (edges.length >= 2) {
        mode = "clock";
        period = clk.period;
      }
    }
    if (!mode) {
      var g = 0,
        n,
        q,
        tt;
      for (n = 0; n < data.nets.length && g !== 1; n++) {
        tt = data.nets[n].t;
        for (q = 0; q < tt.length; q++) {
          if (tt[q] > 0) {
            g = g ? gcd(g, tt[q]) : tt[q];
            if (g === 1) break;
          }
        }
      }
      if (!g) throw new Error("this file has no value changes after time zero");
      var cnt = Math.floor(data.stats.endTime / g);
      if (cnt > MAX_EDGES)
        throw new Error(
          "it would need " +
            cnt +
            " sample points (the limit is " +
            MAX_EDGES +
            ")",
        );
      edges = new Array(cnt + 1);
      for (i = 0; i <= cnt; i++) edges[i] = i * g;
      mode = "sample";
      period = g;
    }
    var cap = {
      data: data,
      roles: rd,
      mode: mode,
      period: period,
      edges: edges,
      anchorReset: -1,
    };
    var rs = rd.reset;
    if (rs && rs.releasedAt !== null) {
      var a = visibleFrom(cap, rs.releasedAt);
      if (a < edges.length) cap.anchorReset = a;
    }
    return cap;
  }

  /* value changes of one net as (cycle, value) pairs, relative to cycle `start` */
  function seq(net, cap, start, N) {
    var cs = [0],
      vs = ["x"],
      t = net.t,
      v = net.v,
      E = cap.edges,
      gt = cap.mode === "clock",
      j = 0,
      i,
      c;
    for (i = 0; i < t.length; i++) {
      while (j < E.length && (gt ? E[j] <= t[i] : E[j] < t[i])) j++;
      c = j - start;
      if (c >= N) break;
      if (c <= 0) vs[0] = v[i];
      else if (cs[cs.length - 1] === c) vs[vs.length - 1] = v[i];
      else {
        cs.push(c);
        vs.push(v[i]);
      }
    }
    return { cs: cs, vs: vs };
  }

  function walk(A, B, N, fn) {
    var i = 0,
      j = 0,
      c = 0,
      nextA,
      nextB,
      nxt;
    while (c < N) {
      nextA = i + 1 < A.cs.length ? A.cs[i + 1] : N;
      nextB = j + 1 < B.cs.length ? B.cs[j + 1] : N;
      nxt = Math.min(nextA, nextB, N);
      fn(c, nxt - c, A.vs[i], B.vs[j]);
      c = nxt;
      if (i + 1 < A.cs.length && A.cs[i + 1] === nxt) i++;
      if (j + 1 < B.cs.length && B.cs[j + 1] === nxt) j++;
    }
  }

  function cmpSeq(A, B, N, ign) {
    var r = { bad: 0, kv: 0, ku: 0, firstV: null, firstU: null, intervals: [] };
    walk(A, B, N, function (c, len, a, b) {
      var k = classify(a, b, ign);
      if (!k) return;
      r.bad += len;
      if (k === "value") {
        r.kv += len;
        if (!r.firstV) r.firstV = { c: c, a: a, b: b };
      } else {
        r.ku += len;
        if (!r.firstU) r.firstU = { c: c, a: a, b: b };
      }
      if (r.intervals.length < MAX_INT)
        r.intervals.push({ c: c, len: len, a: a, b: b, kind: k });
    });
    return r;
  }

  function diffSegments(A, B, N, ign) {
    var out = [];
    walk(A, B, N, function (c, len, a, b) {
      var k = classify(a, b, ign);
      if (k) out.push({ c: c, len: len, kind: k });
    });
    return out;
  }

  /* ───────── signal matching ───────── */
  function commonSuffix(a, b) {
    var x = a.toLowerCase().split("."),
      y = b.toLowerCase().split("."),
      n = 0;
    while (
      n < x.length &&
      n < y.length &&
      x[x.length - 1 - n] === y[y.length - 1 - n]
    )
      n++;
    return n;
  }

  function matchSignals(sim, cmp, manual, simClkNet, cmpClkNet) {
    var byName = {},
      simBy = {},
      cmpBy = {},
      netSigs = {};
    cmp.signals.forEach(function (s) {
      var k = s.name.toLowerCase();
      (byName[k] = byName[k] || []).push(s);
      cmpBy[s.fullName] = s;
    });
    sim.signals.forEach(function (s) {
      simBy[s.fullName] = s;
      (netSigs[s.net] = netSigs[s.net] || []).push(s);
    });
    var usedS = {},
      usedC = {},
      pairs = [],
      widthSkipped = [];

    manual.forEach(function (m) {
      var a = simBy[m.sim],
        b = cmpBy[m.cmp];
      if (!a || !b || usedS[a.net] || usedC[b.net] || a.width !== b.width)
        return;
      usedS[a.net] = 1;
      usedC[b.net] = 1;
      pairs.push({ sSig: a, cSig: b, how: "manual" });
    });

    sim.signals.forEach(function (s) {
      if (s.aliasOf !== null || usedS[s.net] || s.net === simClkNet) return;
      var best = null,
        bestScore = -1,
        otherWidth = null;
      (netSigs[s.net] || [s]).forEach(function (a) {
        (byName[a.name.toLowerCase()] || []).forEach(function (c) {
          if (usedC[c.net] || c.net === cmpClkNet) return;
          if (c.width !== a.width) {
            otherWidth = c;
            return;
          }
          var score = commonSuffix(a.fullName, c.fullName);
          var exact = a.fullName.toLowerCase() === c.fullName.toLowerCase();
          if (exact) score += 100;
          if (score > bestScore) {
            bestScore = score;
            best = { c: c, exact: exact, score: score };
          }
        });
      });
      if (best) {
        usedS[s.net] = 1;
        usedC[best.c.net] = 1;
        pairs.push({
          sSig: s,
          cSig: best.c,
          how: best.exact
            ? "exact"
            : best.score >= 2
              ? "scope suffix"
              : "name only",
        });
      } else if (otherWidth) {
        widthSkipped.push({ sim: s.id, cmp: otherWidth.id });
      }
    });

    var unmatchedSim = [],
      unmatchedCmp = [];
    sim.signals.forEach(function (s) {
      if (s.aliasOf === null && !usedS[s.net] && s.net !== simClkNet)
        unmatchedSim.push(s.id);
    });
    cmp.signals.forEach(function (s) {
      if (s.aliasOf === null && !usedC[s.net] && s.net !== cmpClkNet)
        unmatchedCmp.push(s.id);
    });
    return {
      pairs: pairs,
      unmatchedSim: unmatchedSim,
      unmatchedCmp: unmatchedCmp,
      widthSkipped: widthSkipped,
    };
  }

  /* ───────── alignment ───────── */
  function baseAnchors(capS, capC, S) {
    if (S.anchor === "start")
      return { sa: 0, ca: 0, how: "first clock cycle of each capture" };
    if (capS.anchorReset >= 0 && capC.anchorReset >= 0)
      return {
        sa: capS.anchorReset,
        ca: capC.anchorReset,
        how: "reset release in both captures",
      };
    return {
      sa: 0,
      ca: 0,
      how: "first cycle of each capture (reset release was not found in both)",
    };
  }

  function autoSearch(sim, cmp, capS, capC, pairs, base, ign) {
    var cand = pairs
      .filter(function (p) {
        return sim.nets[p.sSig.net].toggles >= 2;
      })
      .sort(function (a, b) {
        return sim.nets[b.sSig.net].toggles - sim.nets[a.sSig.net].toggles;
      })
      .slice(0, AUTO_PAIRS);
    if (!cand.length) return 0;
    var best = 0,
      bestScore = Infinity,
      d,
      sa,
      ca,
      N,
      bad,
      q,
      score;
    for (d = -AUTO_RANGE; d <= AUTO_RANGE; d++) {
      sa = base.sa;
      ca = base.ca;
      if (d >= 0) ca += d;
      else sa -= d;
      N = Math.min(capS.edges.length - sa, capC.edges.length - ca, AUTO_CYCLES);
      if (N < 8) continue;
      bad = 0;
      for (q = 0; q < cand.length; q++) {
        bad += cmpSeq(
          seq(sim.nets[cand[q].sSig.net], capS, sa, N),
          seq(cmp.nets[cand[q].cSig.net], capC, ca, N),
          N,
          ign,
        ).bad;
      }
      score = bad / (N * cand.length);
      if (
        score < bestScore - 1e-12 ||
        (Math.abs(score - bestScore) <= 1e-12 && Math.abs(d) < Math.abs(best))
      ) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  /* ───────── transaction comparison ───────── */
  function fieldsOf(f, tr) {
    var o = { op: tr.op, addr: tr.addr, data: null };
    if (tr.op === "WRITE") o.data = tr.wdata;
    else if (tr.op === "READ")
      o.data = tr.rsp && tr.rsp.rdata !== null ? tr.rsp.rdata : null;
    else if (f.dir === "response") o.data = tr.rdata;
    else o.data = tr.wdata;
    return o;
  }
  function vdiff(a, b, ign) {
    if (a === null && b === null) return false;
    if (a === null || b === null) return true;
    return classify(a, b, ign) !== null;
  }
  function descr(o) {
    return (
      o.op +
      (o.addr !== null ? " address " + show(o.addr) : "") +
      (o.data !== null ? " data " + show(o.data) : "")
    );
  }
  function avg(sum, n) {
    return n ? sum / n : null;
  }

  function compareTx(simTx, cmpTx, ign) {
    if (
      !simTx ||
      !cmpTx ||
      !simTx.interfaces ||
      !cmpTx.interfaces ||
      !simTx.interfaces.length ||
      !cmpTx.interfaces.length
    ) {
      return {
        rows: [],
        note: "Transactions could not be compared because no valid/ready style interface was found in both captures.",
      };
    }
    var cm = {},
      seen = {},
      rows = [];
    cmpTx.interfaces.forEach(function (f) {
      var k = f.name.toLowerCase();
      (cm[k] = cm[k] || []).push(f);
    });
    simTx.interfaces.forEach(function (f) {
      var k = f.name.toLowerCase(),
        n = seen[k] || 0;
      seen[k] = n + 1;
      var g = cm[k] ? cm[k][n] : null;
      var row = {
        name: f.name,
        scope: f.scope,
        found: !!g,
        nS: f.transfers.length,
        nC: g ? g.transfers.length : 0,
        latS: avg(f.stats.latSum, f.stats.latN),
        latC: g ? avg(g.stats.latSum, g.stats.latN) : null,
        waitS: avg(f.stats.waitSum, f.stats.waitN),
        waitC: g ? avg(g.stats.waitSum, g.stats.waitN) : null,
        diff: null,
      };
      if (g) {
        var m = Math.min(f.transfers.length, g.transfers.length),
          i,
          a,
          b,
          bad;
        for (i = 0; i < m; i++) {
          a = fieldsOf(f, f.transfers[i]);
          b = fieldsOf(g, g.transfers[i]);
          bad =
            a.op !== b.op ||
            vdiff(a.addr, b.addr, ign) ||
            vdiff(a.data, b.data, ign);
          if (bad) {
            row.diff = {
              index: i + 1,
              simTime: f.transfers[i].time,
              text:
                "transfer #" +
                (i + 1) +
                ": simulation " +
                descr(a) +
                " vs capture " +
                descr(b),
            };
            break;
          }
        }
      }
      rows.push(row);
    });
    return { rows: rows, note: "" };
  }

  /* ───────── main run ───────── */
  function fail(C, m, message) {
    C.result = { ok: false, message: message, m: m };
    sync();
  }

  function run() {
    var st = VCD.state,
      C = st.compare;
    if (!C) return;
    C.result = null;
    C.cache = {};
    C.error = "";
    var sim = st.sim,
      cmp = st.cmp,
      capS = C.capS,
      capC = C.capC,
      S = C.settings;
    if (!capS || !capC) {
      C.error = C.prepError || "the captures could not be prepared";
      sync();
      return;
    }

    var rdS = st.analysis.roles;
    var simClkNet = rdS.clock ? sim.signals[rdS.clock.signalId].net : -1;
    var cmpClkNet = capC.roles.clock
      ? cmp.signals[capC.roles.clock.signalId].net
      : -1;
    var m = matchSignals(sim, cmp, C.manual, simClkNet, cmpClkNet);
    if (!m.pairs.length) {
      fail(
        C,
        m,
        "No signals could be matched by name between the two captures. Use the manual pairing below to match signals with different names.",
      );
      return;
    }

    var ign = !!S.ignoreUnknown;
    var base = baseAnchors(capS, capC, S);
    var dAuto =
      S.anchor === "auto"
        ? autoSearch(sim, cmp, capS, capC, m.pairs, base, ign)
        : 0;
    var delta = S.anchor === "auto" ? dAuto : parseInt(S.offset, 10) || 0;
    var sa = base.sa,
      ca = base.ca;
    if (delta >= 0) ca += delta;
    else sa -= delta;
    var N = Math.min(capS.edges.length - sa, capC.edges.length - ca);
    if (N <= 0) {
      fail(
        C,
        m,
        "No cycles are left to compare after alignment. Try another alignment mode or a smaller offset.",
      );
      return;
    }

    var out = [],
      sumBad = 0,
      minV = Infinity,
      minU = Infinity;
    m.pairs.forEach(function (p, idx) {
      var A = seq(sim.nets[p.sSig.net], capS, sa, N),
        B = seq(cmp.nets[p.cSig.net], capC, ca, N);
      var r = cmpSeq(A, B, N, ign);
      var first =
        r.firstV && r.firstU
          ? r.firstV.c <= r.firstU.c
            ? r.firstV
            : r.firstU
          : r.firstV || r.firstU;
      if (first)
        first = {
          c: first.c,
          a: first.a,
          b: first.b,
          kind: first === r.firstV ? "value" : "unknown",
        };
      if (r.firstV && r.firstV.c < minV) minV = r.firstV.c;
      if (r.firstU && r.firstU.c < minU) minU = r.firstU.c;
      sumBad += r.bad;
      out.push({
        idx: idx,
        sSig: p.sSig,
        cSig: p.cSig,
        how: p.how,
        width: p.sSig.width,
        bad: r.bad,
        kv: r.kv,
        ku: r.ku,
        first: first,
        firstV: r.firstV,
        firstU: r.firstU,
        intervals: r.intervals,
        status: r.bad === 0 ? "match" : r.kv > 0 ? "differ" : "unknown",
      });
    });

    var total = out.length * N;
    var identical = out.filter(function (p) {
      return p.bad === 0;
    }).length;
    var firstAll = null;
    if (minV < Infinity) firstAll = { kind: "value", c: minV };
    else if (minU < Infinity) firstAll = { kind: "unknown", c: minU };
    if (firstAll) {
      firstAll.pairs = out
        .filter(function (p) {
          var f = firstAll.kind === "value" ? p.firstV : p.firstU;
          return f && f.c === firstAll.c;
        })
        .map(function (p) {
          return p.idx;
        });
      firstAll.simTime = capS.edges[sa + firstAll.c];
      firstAll.cmpTime = capC.edges[ca + firstAll.c];
    }

    var txr = { rows: [], note: "" };
    try {
      txr = compareTx(st.analysis.tx, C.txC, ign);
    } catch (e) {
      txr = {
        rows: [],
        note: "The transaction comparison failed: " + e.message,
      };
    }

    C.result = {
      ok: true,
      N: N,
      sa: sa,
      ca: ca,
      baseHow: base.how,
      delta: delta,
      dAuto: dAuto,
      anchor: S.anchor,
      pairs: out,
      m: m,
      identical: identical,
      differing: out.length - identical,
      matchPct: total ? (100 * (total - sumBad)) / total : 100,
      first: firstAll,
      simCycles: capS.edges.length - sa,
      cmpCycles: capC.edges.length - ca,
      tx: txr.rows,
      txNote: txr.note,
    };
    sync();
  }

  /* ───────── findings ───────── */
  function sync() {
    var st = VCD.state;
    st.findings = st.findings.filter(function (f) {
      return f.source !== "compare";
    });
    var C = st.compare;

    function add(sev, type, time, msg, nets, sig) {
      st.findings.push({
        id: 0,
        severity: sev,
        type: type,
        signal: sig || "",
        time: time,
        message: msg,
        source: "compare",
        netIds: nets || [],
      });
    }

    if (C) {
      var r = C.result;
      var ft = function (t) {
        return VCD.fmtTime(t, st.sim.header.timescale);
      };
      if (!r) {
        add(
          "warning",
          "compare_failed",
          null,
          "The comparison could not run: " +
            (C.error || C.prepError || "unknown reason") +
            ".",
        );
      } else if (!r.ok) {
        add(
          "warning",
          "compare_failed",
          null,
          "The comparison could not run: " + r.message,
        );
      } else {
        if (r.first) {
          var ps = r.first.pairs.map(function (i) {
            return r.pairs[i];
          });
          var names = ps.slice(0, 4).map(function (p) {
            return p.sSig.name;
          });
          var more = ps.length > 4 ? " and " + (ps.length - 4) + " more" : "";
          var fv = ps[0]
            ? r.first.kind === "value"
              ? ps[0].firstV
              : ps[0].firstU
            : null;
          var vtxt = fv
            ? " (" +
              names[0] +
              ": simulation " +
              show(fv.a) +
              ", second capture " +
              show(fv.b) +
              ")"
            : "";
          var msg =
            "Simulation and second capture first differ at cycle " +
            r.first.c +
            " (simulation time " +
            ft(r.first.simTime) +
            "): " +
            names.join(", ") +
            more +
            vtxt +
            ".";
          if (r.first.kind === "unknown")
            msg +=
              " Only unknown (X/Z) values differ, so this may be a power-up or initialisation difference.";
          add(
            r.first.kind === "value" ? "error" : "warning",
            r.first.kind === "value" ? "compare_mismatch" : "compare_unknown",
            r.first.simTime,
            msg,
            ps.slice(0, 4).map(function (p) {
              return p.sSig.net;
            }),
            names[0],
          );
        }
        if (r.differing > 0) {
          add(
            "info",
            "compare_summary",
            null,
            r.differing +
              " of " +
              r.pairs.length +
              " compared signals differ at some point (cycle match " +
              r.matchPct.toFixed(2) +
              " %).",
          );
        }
        var txBad = 0;
        r.tx.forEach(function (row) {
          if (row.diff && txBad < MAX_TX_FIND) {
            txBad++;
            add(
              "error",
              "compare_sequence",
              row.diff.simTime,
              "Interface " +
                row.name +
                ": the transactions differ at " +
                row.diff.text +
                ".",
              [],
              row.name,
            );
          }
          if (row.found && row.nS !== row.nC) {
            add(
              "warning",
              "compare_count",
              null,
              "Interface " +
                row.name +
                ": the simulation has " +
                row.nS +
                " transfers but the second capture has " +
                row.nC +
                ".",
              [],
              row.name,
            );
          }
          if (
            row.latS !== null &&
            row.latC !== null &&
            Math.abs(row.latC - row.latS) >= 1
          ) {
            add(
              "warning",
              "compare_latency",
              null,
              "Interface " +
                row.name +
                ": average response latency is " +
                row.latS.toFixed(1) +
                " cycles in simulation and " +
                row.latC.toFixed(1) +
                " cycles in the second capture.",
              [],
              row.name,
            );
          }
        });
        if (r.simCycles !== r.cmpCycles) {
          var big =
            Math.abs(r.simCycles - r.cmpCycles) >
            0.1 * Math.max(r.simCycles, r.cmpCycles);
          add(
            big ? "warning" : "info",
            "compare_length",
            null,
            "After alignment the simulation has " +
              r.simCycles +
              " cycles and the second capture has " +
              r.cmpCycles +
              "; only the first " +
              r.N +
              " were compared.",
          );
        }
        var un = r.m.unmatchedSim.length;
        if (un)
          add(
            "info",
            "compare_unmatched",
            null,
            un +
              " simulation signal(s) have no match in the second capture and were not compared (see the Sim vs FPGA module).",
          );
      }
    }
    st.findings.forEach(function (f, i) {
      f.id = i + 1;
    });
  }

  /* ───────── public API ───────── */
  function init() {
    var st = VCD.state;
    var C = {
      settings: Object.assign({}, DEFAULTS),
      manual: [],
      result: null,
      error: "",
      cache: {},
      capS: null,
      capC: null,
      txC: null,
      prepError: "",
    };
    st.compare = C;
    var rdC = VCD.roles.detect(st.cmp);
    try {
      C.capS = buildCapture(st.sim, st.analysis.roles);
    } catch (e) {
      C.prepError = "simulation: " + e.message + ". ";
    }
    try {
      C.capC = buildCapture(st.cmp, rdC);
    } catch (e) {
      C.prepError += "second capture: " + e.message + ".";
    }
    try {
      C.txC = VCD.transactions.analyze(st.cmp, rdC, null);
    } catch (e) {
      C.txC = null;
    }
    run();
  }

  function setSettings(o) {
    var C = VCD.state.compare;
    if (!C) return;
    Object.keys(o).forEach(function (k) {
      C.settings[k] = o[k];
    });
    run();
  }

  function addManual(simFull, cmpFull) {
    var st = VCD.state,
      C = st.compare;
    if (!C) return "The comparison is not available.";
    var a = null,
      b = null;
    st.sim.signals.forEach(function (s) {
      if (s.fullName === simFull) a = s;
    });
    st.cmp.signals.forEach(function (s) {
      if (s.fullName === cmpFull) b = s;
    });
    if (!a || !b) return "Choose a signal on both sides.";
    if (a.width !== b.width)
      return (
        "The two signals have different widths (" +
        a.width +
        " and " +
        b.width +
        " bit)."
      );
    C.manual.push({ sim: simFull, cmp: cmpFull });
    run();
    return "";
  }

  function removeManual(i) {
    var C = VCD.state.compare;
    if (!C) return;
    C.manual.splice(i, 1);
    run();
  }

  function series(pi) {
    var st = VCD.state,
      C = st.compare;
    if (!C || !C.result || !C.result.ok) return null;
    if (C.cache[pi]) return C.cache[pi];
    var r = C.result,
      p = r.pairs[pi];
    if (!p) return null;
    var A = seq(st.sim.nets[p.sSig.net], C.capS, r.sa, r.N);
    var B = seq(st.cmp.nets[p.cSig.net], C.capC, r.ca, r.N);
    var o = {
      A: A,
      B: B,
      N: r.N,
      width: p.width,
      p: p,
      diff: diffSegments(A, B, r.N, !!C.settings.ignoreUnknown),
    };
    C.cache[pi] = o;
    return o;
  }

  function cycleTime(which, k) {
    var C = VCD.state.compare,
      r = C && C.result;
    if (!r || !r.ok) return 0;
    return which === "sim" ? C.capS.edges[r.sa + k] : C.capC.edges[r.ca + k];
  }

  VCD.compare = {
    init: init,
    run: run,
    sync: sync,
    setSettings: setSettings,
    addManual: addManual,
    removeManual: removeManual,
    series: series,
    cycleTime: cycleTime,
    diffSegments: diffSegments,
  };
})();
