/* VCDInsight — rules.js (Step 5)
   Rule engine: 8 templates that run on any parsed VCD.
   Rules are checked after reset release (except "reset value").
   Public: VCD.rules = { TYPES, list, add, addSuggested, remove, toggle, clear, runAll,
                         exportJSON, importJSON, describe, suggest }                   */
"use strict";

(function () {
  var MAX_VIOL = 50;
  var MAX_RULES = 200;
  var nextId = 1;

  var HL = [
    { v: "high", l: "high (1)" },
    { v: "low", l: "low (0)" },
  ];

  /* ───────── rule templates ───────── */
  var TYPES = {
    never_x: {
      label: "Never X / Z",
      hint: "A signal must never be unknown (X) or floating (Z) after reset release, optionally only while another signal is high.",
      fields: [
        { k: "sig", l: "Signal", kind: "sig" },
        {
          k: "qual",
          l: "Only while this signal is high (optional)",
          kind: "bitopt",
        },
        {
          k: "z",
          l: "Also flag Z",
          kind: "choice",
          opts: [
            { v: "yes", l: "Yes" },
            { v: "no", l: "No, only X" },
          ],
        },
      ],
      defaults: { sig: "", qual: "", z: "yes" },
      describe: function (f) {
        return (
          f.sig +
          " must never be X" +
          (f.z === "no" ? "" : " or Z") +
          " after reset release" +
          (f.qual ? " while " + f.qual + " is high" : "")
        );
      },
    },
    reset_value: {
      label: "Reset value",
      hint: "A signal must hold a given value at the end of every reset period (checked just before reset is released).",
      fields: [
        { k: "sig", l: "Signal", kind: "sig" },
        { k: "value", l: "Expected value (0, 5, 0x1F or 0b101)", kind: "text" },
      ],
      defaults: { sig: "", value: "0" },
      describe: function (f) {
        return (
          f.sig + " must equal " + f.value + " at the end of every reset period"
        );
      },
    },
    stable: {
      label: "Stable while",
      hint: "A signal must not change while a condition holds, for example data must hold while valid is high and ready is low.",
      fields: [
        { k: "sig", l: "Signal that must hold its value", kind: "sig" },
        { k: "w1", l: "While this signal is high", kind: "bit" },
        { k: "w2", l: "and this signal (optional)", kind: "bitopt" },
        { k: "w2Level", l: "…is", kind: "choice", opts: HL.slice().reverse() },
      ],
      defaults: { sig: "", w1: "", w2: "", w2Level: "low" },
      describe: function (f) {
        return (
          f.sig +
          " must not change while " +
          f.w1 +
          " is high" +
          (f.w2
            ? " and " + f.w2 + " is " + (f.w2Level === "high" ? "high" : "low")
            : "")
        );
      },
    },
    response_within: {
      label: "Response within N cycles",
      hint: "After a signal rises, another signal must be high within N clock cycles (the first time it is high at or after the trigger counts).",
      fields: [
        { k: "trig", l: "When this signal rises", kind: "bit" },
        { k: "resp", l: "this signal must be high", kind: "bit" },
        { k: "n", l: "within N cycles", kind: "num" },
      ],
      defaults: { trig: "", resp: "", n: "8" },
      describe: function (f) {
        return (
          "After " +
          f.trig +
          " rises, " +
          f.resp +
          " must be high within " +
          f.n +
          " cycle(s)"
        );
      },
    },
    mutual_exclusion: {
      label: "Mutual exclusion",
      hint: "Two signals must never be high at the same time (for example two grants).",
      fields: [
        { k: "a", l: "Signal A", kind: "bit" },
        { k: "b", l: "Signal B", kind: "bit" },
      ],
      defaults: { a: "", b: "" },
      describe: function (f) {
        return f.a + " and " + f.b + " must never be high at the same time";
      },
    },
    implication: {
      label: "If … then …",
      hint: "If signal A is at a level, then signal B must be at a level in the same cycle or within N cycles (cycle-based, needs a clock when N > 0).",
      fields: [
        { k: "a", l: "If this signal", kind: "bit" },
        { k: "aLevel", l: "is", kind: "choice", opts: HL },
        { k: "b", l: "then this signal", kind: "bit" },
        { k: "bLevel", l: "must be", kind: "choice", opts: HL },
        { k: "n", l: "within N cycles (0 = same cycle)", kind: "num" },
      ],
      defaults: { a: "", aLevel: "high", b: "", bLevel: "high", n: "0" },
      describe: function (f) {
        return (
          "If " +
          f.a +
          " is " +
          f.aLevel +
          ", then " +
          f.b +
          " must be " +
          f.bLevel +
          (parseInt(f.n, 10) > 0
            ? " within " + f.n + " cycle(s)"
            : " in the same cycle")
        );
      },
    },
    value_equals: {
      label: "Value must equal",
      hint: "A signal must equal a constant or another signal, optionally only while a qualifier signal is high.",
      fields: [
        { k: "sig", l: "Signal", kind: "sig" },
        {
          k: "mode",
          l: "must equal",
          kind: "choice",
          opts: [
            { v: "const", l: "a constant" },
            { v: "signal", l: "another signal" },
          ],
        },
        { k: "val", l: "Constant (0, 5, 0x1F or 0b101)", kind: "text" },
        { k: "other", l: "Other signal (if 'another signal')", kind: "sigopt" },
        {
          k: "qual",
          l: "Only while this signal is high (optional)",
          kind: "bitopt",
        },
      ],
      defaults: { sig: "", mode: "const", val: "0", other: "", qual: "" },
      describe: function (f) {
        return (
          f.sig +
          " must equal " +
          (f.mode === "signal" ? f.other : f.val) +
          (f.qual ? " while " + f.qual + " is high" : "")
        );
      },
    },
    never_stuck: {
      label: "Never stuck",
      hint: "A signal must change at least once in every window of N cycles. N = 0 means at least once during the whole run after reset.",
      fields: [
        { k: "sig", l: "Signal", kind: "sig" },
        { k: "n", l: "Window in cycles (0 = whole run)", kind: "num" },
      ],
      defaults: { sig: "", n: "0" },
      describe: function (f) {
        return (
          f.sig +
          " must change " +
          (parseInt(f.n, 10) > 0
            ? "at least once every " + f.n + " cycles"
            : "at least once after reset release")
        );
      },
    },
  };

  /* ───────── small helpers ───────── */
  function list() {
    if (!VCD.state.rules) VCD.state.rules = [];
    return VCD.state.rules;
  }
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
  function idxBefore(t, time) {
    var lo = 0,
      hi = t.length - 1,
      r = -1,
      mid;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (t[mid] < time) {
        r = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return r;
  }
  function valAt(net, time) {
    var i = idxAt(net.t, time);
    return i < 0 ? "x" : net.v[i];
  }
  function valBefore(net, time) {
    var i = idxBefore(net.t, time);
    return i < 0 ? "x" : net.v[i];
  }
  function norm(v) {
    return String(v).replace(/^0+(?=.)/, "");
  }
  function unknown(v) {
    return /[xz]/.test(v);
  }
  function show(v) {
    return VCD.transactions.show(v);
  }

  function parseConst(text, width) {
    var s = String(text === undefined ? "" : text)
      .trim()
      .replace(/_/g, "");
    if (!/^(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(s)) return null;
    var big;
    try {
      big = BigInt(s.toLowerCase());
    } catch (e) {
      return null;
    }
    var bits = big.toString(2);
    if (bits.length > width) return null;
    return new Array(width - bits.length + 1).join("0") + bits;
  }

  /* walks the union of change times of several nets; pred(vals) marks bad segments */
  function scan(nets, from, to, pred, merge) {
    var out = [];
    if (!(from < to)) return out;
    var set = {},
      times = [from];
    nets.forEach(function (n) {
      for (var q = 0; q < n.t.length; q++)
        if (n.t[q] > from && n.t[q] < to) set[n.t[q]] = 1;
    });
    Object.keys(set).forEach(function (k) {
      times.push(Number(k));
    });
    times.sort(function (a, b) {
      return a - b;
    });
    var ptr = nets.map(function (n) {
      return idxAt(n.t, from);
    });
    var cur = null;
    for (var k = 0; k < times.length; k++) {
      var ti = times[k],
        te = k + 1 < times.length ? times[k + 1] : to;
      var vals = nets.map(function (n, j) {
        while (ptr[j] + 1 < n.t.length && n.t[ptr[j] + 1] <= ti) ptr[j]++;
        return ptr[j] < 0 ? "x" : n.v[ptr[j]];
      });
      var r = pred(vals);
      if (r) {
        if (cur && merge !== false) cur.end = te;
        else {
          cur = {
            start: ti,
            end: te,
            vals: vals,
            info: typeof r === "object" ? r : null,
          };
          out.push(cur);
        }
      } else cur = null;
    }
    return out;
  }

  function makeCtx() {
    var sim = VCD.state.sim,
      an = VCD.state.analysis,
      clk = an.roles.clock;
    var ctx = {
      sim: sim,
      an: an,
      ts: sim.header.timescale,
      from: an.roles.settleTime || 0,
      end: sim.stats.endTime,
      period: clk && clk.periodic && clk.period > 0 ? clk.period : 0,
      reset: an.roles.reset,
      edges: null,
    };
    ctx.ft = function (t) {
      return VCD.fmtTime(t, ctx.ts);
    };
    ctx.edgeList = function () {
      if (ctx.edges) return ctx.edges;
      var out = [];
      if (ctx.period > 0) {
        var cn = sim.nets[sim.signals[an.roles.clock.signalId].net];
        for (var i = 1; i < cn.t.length; i++) {
          if (cn.v[i] === "1" && cn.v[i - 1] === "0" && cn.t[i] > ctx.from)
            out.push(cn.t[i]);
        }
      }
      ctx.edges = out;
      return out;
    };
    return ctx;
  }

  function need(ctx, ref, bitOnly) {
    if (!ref) return { err: "A signal is missing in this rule." };
    var sim = ctx.sim,
      s = null,
      i;
    for (i = 0; i < sim.signals.length; i++)
      if (sim.signals[i].fullName === ref) {
        s = sim.signals[i];
        break;
      }
    if (!s) {
      var c = sim.signals.filter(function (x) {
        return (
          x.name === ref || x.fullName.slice(-(ref.length + 1)) === "." + ref
        );
      });
      if (
        c.length &&
        c.every(function (x) {
          return x.net === c[0].net;
        })
      )
        s = c[0];
    }
    if (!s)
      return {
        err:
          'Signal "' +
          ref +
          '" was not found in this file (or the name matches several different signals).',
      };
    var net = sim.nets[s.net];
    if (bitOnly && net.width !== 1)
      return { err: 'Signal "' + ref + '" must be 1 bit wide for this rule.' };
    return { sig: s, net: net, name: s.fullName };
  }

  function skip(msg) {
    return {
      status: "skip",
      fails: 0,
      first: null,
      message: msg,
      violations: [],
      signal: "",
    };
  }
  function nowin() {
    return skip(
      "There is no time left after reset release to check (reset is never released, or the run ends at reset).",
    );
  }
  function done(ctx, viols, okMsg, name) {
    if (!viols.length)
      return {
        status: "pass",
        fails: 0,
        first: null,
        message: okMsg,
        violations: [],
        signal: name || "",
      };
    return {
      status: "fail",
      fails: viols.length,
      first: viols[0].time,
      signal: name || "",
      message:
        viols.length +
        " violation" +
        (viols.length === 1 ? "" : "s") +
        "; first at " +
        ctx.ft(viols[0].time) +
        " — " +
        viols[0].text,
      violations: viols.slice(0, MAX_VIOL),
    };
  }

  /* ───────── the 8 checkers ───────── */
  var RUN = {};

  RUN.never_x = function (ctx, f) {
    var s = need(ctx, f.sig),
      q = f.qual ? need(ctx, f.qual, true) : null;
    if (s.err) return skip(s.err);
    if (q && q.err) return skip(q.err);
    if (ctx.from >= ctx.end) return nowin();
    var checkZ = f.z !== "no";
    var segs = scan(
      [s.net].concat(q ? [q.net] : []),
      ctx.from,
      ctx.end,
      function (v) {
        if (!(checkZ ? /[xz]/.test(v[0]) : /x/.test(v[0]))) return false;
        return q ? v[1] !== "0" : true;
      },
    );
    var viols = segs.map(function (g) {
      return {
        time: g.start,
        text:
          s.name +
          " was " +
          show(g.vals[0]) +
          " from " +
          ctx.ft(g.start) +
          " to " +
          ctx.ft(g.end) +
          (q ? " while " + q.name + " was high" : ""),
      };
    });
    return done(
      ctx,
      viols,
      "No " +
        (checkZ ? "X or Z" : "X") +
        " from " +
        ctx.ft(ctx.from) +
        " to " +
        ctx.ft(ctx.end) +
        (q ? " while " + q.name + " was high" : "") +
        ".",
      s.name,
    );
  };

  RUN.reset_value = function (ctx, f) {
    var s = need(ctx, f.sig);
    if (s.err) return skip(s.err);
    var rd = ctx.reset;
    if (!rd) return skip("No reset signal was detected in this file.");
    var exp = parseConst(f.value, s.net.width);
    if (exp === null)
      return skip(
        'The expected value "' +
          f.value +
          '" is not valid or does not fit in ' +
          s.net.width +
          " bit(s).",
      );
    var rn = ctx.sim.nets[ctx.sim.signals[rd.signalId].net];
    var aVal = rd.activeLow ? "0" : "1",
      iVal = rd.activeLow ? "1" : "0";
    var wins = [],
      start = null,
      i;
    for (i = 0; i < rn.t.length; i++) {
      if (rn.v[i] === aVal) {
        if (start === null) start = rn.t[i];
      } else if (rn.v[i] === iVal && start !== null) {
        wins.push([start, rn.t[i]]);
        start = null;
      }
    }
    if (start !== null) wins.push([start, ctx.end]);
    if (!wins.length) return skip("Reset is never asserted in this file.");
    var viols = [];
    wins.forEach(function (w) {
      var at = w[1] > w[0] ? w[1] - 1 : w[0];
      var v = valAt(s.net, at);
      if (unknown(v) || norm(v) !== norm(exp)) {
        viols.push({
          time: at,
          text:
            s.name +
            " was " +
            show(v) +
            " just before reset was released at " +
            ctx.ft(w[1]) +
            ", expected " +
            show(exp),
        });
      }
    });
    return done(
      ctx,
      viols,
      s.name +
        " held " +
        show(exp) +
        " at the end of " +
        wins.length +
        " reset period(s).",
      s.name,
    );
  };

  RUN.stable = function (ctx, f) {
    var s = need(ctx, f.sig),
      w1 = need(ctx, f.w1, true),
      w2 = f.w2 ? need(ctx, f.w2, true) : null;
    if (s.err) return skip(s.err);
    if (w1.err) return skip(w1.err);
    if (w2 && w2.err) return skip(w2.err);
    if (ctx.from >= ctx.end) return nowin();
    var lvl = f.w2Level === "high" ? "1" : "0",
      prevCond = false,
      prevVal = null;
    var segs = scan(
      [s.net, w1.net].concat(w2 ? [w2.net] : []),
      ctx.from,
      ctx.end,
      function (v) {
        var cond = v[1] === "1" && (w2 ? v[2] === lvl : true);
        var bad = prevCond && cond && v[0] !== prevVal;
        var info = bad ? { prev: prevVal, now: v[0] } : false;
        prevCond = cond;
        prevVal = v[0];
        return info;
      },
      false,
    );
    var cond =
      w1.name +
      " was high" +
      (w2
        ? " and " + w2.name + " was " + (f.w2Level === "high" ? "high" : "low")
        : "");
    var viols = segs.map(function (g) {
      return {
        time: g.start,
        text:
          s.name +
          " changed from " +
          show(g.info.prev) +
          " to " +
          show(g.info.now) +
          " at " +
          ctx.ft(g.start) +
          " while " +
          cond,
      };
    });
    return done(
      ctx,
      viols,
      s.name + " never changed while " + cond + ".",
      s.name,
    );
  };

  RUN.response_within = function (ctx, f) {
    var tr = need(ctx, f.trig, true),
      rs = need(ctx, f.resp, true);
    if (tr.err) return skip(tr.err);
    if (rs.err) return skip(rs.err);
    var n = parseInt(f.n, 10);
    if (isNaN(n) || n < 0)
      return skip("N must be a whole number of cycles (0 or more).");
    var limit = ctx.period > 0 ? n * ctx.period : n;
    var viols = [],
      ok = 0,
      unresolved = 0,
      trigs = 0,
      maxLat = 0;
    var tn = tr.net,
      rn = rs.net,
      unit = ctx.period > 0 ? "cycle(s)" : "tick(s)";
    for (var i = 1; i < tn.t.length; i++) {
      if (tn.v[i] !== "1" || tn.v[i - 1] !== "0") continue;
      var t0 = tn.t[i];
      if (t0 < ctx.from) continue;
      trigs++;
      var j = idxAt(rn.t, t0),
        rt = null,
        k;
      if (j >= 0 && rn.v[j] === "1") rt = t0;
      else
        for (k = j + 1; k < rn.t.length; k++)
          if (rn.v[k] === "1") {
            rt = rn.t[k];
            break;
          }
      if (rt !== null && rt - t0 <= limit) {
        ok++;
        if (rt - t0 > maxLat) maxLat = rt - t0;
      } else if (rt !== null) {
        viols.push({
          time: t0,
          text:
            rs.name +
            " went high " +
            ctx.ft(rt - t0) +
            " after " +
            tr.name +
            " rose at " +
            ctx.ft(t0) +
            " (limit " +
            n +
            " " +
            unit +
            ")",
        });
      } else if (t0 + limit > ctx.end) unresolved++;
      else
        viols.push({
          time: t0,
          text:
            rs.name +
            " did not go high within " +
            n +
            " " +
            unit +
            " after " +
            tr.name +
            " rose at " +
            ctx.ft(t0),
        });
    }
    if (trigs === 0)
      return skip(
        tr.name +
          " never rises after reset release, so there was nothing to check.",
      );
    var lat =
      ctx.period > 0
        ? (maxLat / ctx.period).toFixed(1) + " cycles"
        : ctx.ft(maxLat);
    return done(
      ctx,
      viols,
      trigs +
        " trigger(s) checked, " +
        ok +
        " answered in time (slowest " +
        lat +
        ")" +
        (unresolved
          ? ", " + unresolved + " too close to the end of the run to judge"
          : "") +
        ".",
      rs.name,
    );
  };

  RUN.mutual_exclusion = function (ctx, f) {
    var a = need(ctx, f.a, true),
      b = need(ctx, f.b, true);
    if (a.err) return skip(a.err);
    if (b.err) return skip(b.err);
    if (a.net === b.net)
      return skip("Signal A and signal B are the same signal.");
    if (ctx.from >= ctx.end) return nowin();
    var segs = scan([a.net, b.net], ctx.from, ctx.end, function (v) {
      return v[0] === "1" && v[1] === "1";
    });
    var viols = segs.map(function (g) {
      return {
        time: g.start,
        text:
          a.name +
          " and " +
          b.name +
          " were both high from " +
          ctx.ft(g.start) +
          " to " +
          ctx.ft(g.end),
      };
    });
    return done(
      ctx,
      viols,
      a.name + " and " + b.name + " were never high together.",
      a.name,
    );
  };

  RUN.implication = function (ctx, f) {
    var a = need(ctx, f.a, true),
      b = need(ctx, f.b, true);
    if (a.err) return skip(a.err);
    if (b.err) return skip(b.err);
    var n = parseInt(f.n, 10);
    if (isNaN(n) || n < 0)
      return skip("N must be a whole number of cycles (0 or more).");
    var av = f.aLevel === "low" ? "0" : "1",
      bv = f.bLevel === "low" ? "0" : "1";
    var aw = f.aLevel === "low" ? "low" : "high",
      bw = f.bLevel === "low" ? "low" : "high";
    var viols = [],
      trig = 0,
      unresolved = 0,
      k,
      j;
    if (ctx.period > 0) {
      var E = ctx.edgeList();
      if (!E.length) return nowin();
      for (k = 0; k < E.length; k++) {
        if (valBefore(a.net, E[k]) !== av) continue;
        trig++;
        var found = false;
        for (j = k; j <= k + n && j < E.length; j++)
          if (valBefore(b.net, E[j]) === bv) {
            found = true;
            break;
          }
        if (!found) {
          if (k + n >= E.length) unresolved++;
          else
            viols.push({
              time: E[k],
              text:
                a.name +
                " was " +
                aw +
                " at " +
                ctx.ft(E[k]) +
                " but " +
                b.name +
                " was not " +
                bw +
                (n > 0 ? " within " + n + " cycle(s)" : " in that cycle"),
            });
        }
      }
    } else {
      if (n > 0)
        return skip(
          "No clock was detected, so only N = 0 (same time) can be checked.",
        );
      if (ctx.from >= ctx.end) return nowin();
      var segs = scan([a.net, b.net], ctx.from, ctx.end, function (v) {
        return v[0] === av && v[1] !== bv;
      });
      trig = segs.length;
      segs.forEach(function (g) {
        viols.push({
          time: g.start,
          text:
            a.name +
            " was " +
            aw +
            " from " +
            ctx.ft(g.start) +
            " to " +
            ctx.ft(g.end) +
            " while " +
            b.name +
            " was not " +
            bw,
        });
      });
    }
    if (trig === 0 && !viols.length)
      return skip(
        a.name +
          " was never " +
          aw +
          " after reset release, so the condition never applied.",
      );
    return done(
      ctx,
      viols,
      trig +
        " case(s) checked" +
        (unresolved
          ? ", " + unresolved + " too close to the end of the run to judge"
          : "") +
        ", all satisfied.",
      b.name,
    );
  };

  RUN.value_equals = function (ctx, f) {
    var s = need(ctx, f.sig),
      q = f.qual ? need(ctx, f.qual, true) : null;
    if (s.err) return skip(s.err);
    if (q && q.err) return skip(q.err);
    if (ctx.from >= ctx.end) return nowin();
    var nets = [s.net],
      other = null,
      exp = null;
    if (f.mode === "signal") {
      other = need(ctx, f.other);
      if (other.err) return skip(other.err);
      nets.push(other.net);
    } else {
      exp = parseConst(f.val, s.net.width);
      if (exp === null)
        return skip(
          'The value "' +
            f.val +
            '" is not valid or does not fit in ' +
            s.net.width +
            " bit(s).",
        );
    }
    var qi = q ? nets.length : -1;
    if (q) nets.push(q.net);
    var segs = scan(nets, ctx.from, ctx.end, function (v) {
      if (q && v[qi] === "0") return false;
      var want = other ? v[1] : exp;
      return unknown(v[0]) || unknown(want) || norm(v[0]) !== norm(want);
    });
    var tgt = other ? other.name : show(exp);
    var viols = segs.map(function (g) {
      var want = other ? show(g.vals[1]) : show(exp);
      return {
        time: g.start,
        text:
          s.name +
          " was " +
          show(g.vals[0]) +
          " (expected " +
          want +
          ") from " +
          ctx.ft(g.start) +
          " to " +
          ctx.ft(g.end) +
          (q ? " while " + q.name + " was high" : ""),
      };
    });
    return done(
      ctx,
      viols,
      s.name +
        " always equalled " +
        tgt +
        (q ? " while " + q.name + " was high" : "") +
        ".",
      s.name,
    );
  };

  RUN.never_stuck = function (ctx, f) {
    var s = need(ctx, f.sig);
    if (s.err) return skip(s.err);
    var n = parseInt(f.n, 10);
    if (isNaN(n) || n < 0)
      return skip("The window must be a whole number of cycles (0 or more).");
    if (ctx.from >= ctx.end) return nowin();
    var from = ctx.from,
      end = ctx.end,
      net = s.net,
      viols = [];
    var L = n > 0 ? (ctx.period > 0 ? n * ctx.period : n) : end - from;
    if (end - from < L)
      return skip(
        "The run after reset is shorter than one window of " + n + " cycle(s).",
      );
    var guard = 0;
    for (var c = from; c + L <= end && guard < 100000; c += L, guard++) {
      if (idxAt(net.t, c + L) - idxAt(net.t, c) === 0) {
        viols.push({
          time: c,
          text:
            s.name +
            " did not change between " +
            ctx.ft(c) +
            " and " +
            ctx.ft(c + L) +
            " (held " +
            show(valAt(net, c)) +
            ")",
        });
      }
    }
    return done(
      ctx,
      viols,
      s.name + " changed in every window checked.",
      s.name,
    );
  };

  /* ───────── rule management ───────── */
  function describe(r) {
    return TYPES[r.type] ? TYPES[r.type].describe(r.f) : r.type;
  }

  function validate(type, f) {
    var T = TYPES[type];
    if (!T) return "Unknown rule type.";
    var i, fd;
    for (i = 0; i < T.fields.length; i++) {
      fd = T.fields[i];
      if ((fd.kind === "sig" || fd.kind === "bit") && !f[fd.k])
        return 'Choose a value for "' + fd.l + '".';
      if (fd.kind === "num" && !/^\d{1,6}$/.test(String(f[fd.k]).trim()))
        return '"' + fd.l + '" must be a whole number (0 or more).';
    }
    if (type === "value_equals") {
      if (f.mode === "signal" && !f.other)
        return "Choose the other signal to compare with.";
      if (f.mode !== "signal" && !String(f.val).trim())
        return "Enter the constant to compare with.";
    }
    if (type === "reset_value" && !String(f.value).trim())
      return "Enter the expected value.";
    if (type === "mutual_exclusion" && f.a === f.b)
      return "Choose two different signals.";
    return "";
  }

  function key(type, f) {
    return type + "|" + JSON.stringify(f);
  }

  function push(type, f, enabled) {
    var all = list();
    var rule = {
      id: nextId++,
      type: type,
      f: Object.assign({}, TYPES[type].defaults, f),
      enabled: enabled !== false,
      result: null,
    };
    all.push(rule);
    return rule;
  }

  function add(type, f) {
    var err = validate(type, f);
    if (err) return err;
    if (list().length >= MAX_RULES)
      return "The limit of " + MAX_RULES + " rules was reached.";
    push(type, f, true);
    runAll();
    return "";
  }

  function remove(id) {
    var all = list();
    for (var i = 0; i < all.length; i++)
      if (all[i].id === id) {
        all.splice(i, 1);
        break;
      }
    runAll();
  }
  function toggle(id) {
    list().forEach(function (r) {
      if (r.id === id) r.enabled = !r.enabled;
    });
    runAll();
  }
  function clear() {
    VCD.state.rules = [];
    runAll();
  }

  function runAll() {
    var st = VCD.state;
    if (!st.sim || !st.analysis) return;
    var ctx = makeCtx();
    list().forEach(function (r) {
      if (!r.enabled) {
        r.result = {
          status: "off",
          fails: 0,
          first: null,
          message: "Turned off.",
          violations: [],
          signal: "",
        };
        return;
      }
      try {
        r.result = RUN[r.type](ctx, r.f);
      } catch (e) {
        r.result = skip("The rule could not run: " + e.message);
      }
    });
    sync();
  }

  /* failed rules become findings, so the verdict, run story and viewer markers see them */
  function sync() {
    var st = VCD.state;
    st.findings = st.findings.filter(function (f) {
      return f.source !== "rules";
    });
    list().forEach(function (r) {
      if (r.enabled && r.result && r.result.status === "fail") {
        st.findings.push({
          id: 0,
          severity: "error",
          type: "rule_failed",
          signal: r.result.signal,
          time: r.result.first,
          message: "Rule failed: " + describe(r) + " — " + r.result.message,
          source: "rules",
        });
      }
    });
    st.findings.forEach(function (f, i) {
      f.id = i + 1;
    });
  }

  /* ───────── save / load ───────── */
  function exportJSON() {
    return JSON.stringify(
      {
        format: "vcdinsight-rules",
        version: 1,
        rules: list().map(function (r) {
          return { type: r.type, enabled: r.enabled, f: r.f };
        }),
      },
      null,
      2,
    );
  }

  function importJSON(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { added: 0, rejected: ["The file is not valid JSON."] };
    }
    var arr = Array.isArray(data)
      ? data
      : data && Array.isArray(data.rules)
        ? data.rules
        : null;
    if (!arr)
      return { added: 0, rejected: ['No "rules" list was found in the file.'] };
    var have = {};
    list().forEach(function (r) {
      have[key(r.type, r.f)] = 1;
    });
    var added = 0,
      rejected = [];
    arr.forEach(function (x, i) {
      if (!x || !TYPES[x.type]) {
        rejected.push("Rule " + (i + 1) + ": unknown type.");
        return;
      }
      var f = {};
      Object.keys(TYPES[x.type].defaults).forEach(function (k) {
        f[k] =
          x.f && x.f[k] !== undefined
            ? String(x.f[k])
            : TYPES[x.type].defaults[k];
      });
      var err = validate(x.type, f);
      if (err) {
        rejected.push("Rule " + (i + 1) + ": " + err);
        return;
      }
      if (have[key(x.type, f)]) return;
      if (list().length >= MAX_RULES) {
        rejected.push("The limit of " + MAX_RULES + " rules was reached.");
        return;
      }
      have[key(x.type, f)] = 1;
      push(x.type, f, x.enabled !== false);
      added++;
    });
    runAll();
    return { added: added, rejected: rejected };
  }

  /* ───────── suggestions from the detected interfaces ───────── */
  function suggest() {
    var st = VCD.state,
      an = st.analysis,
      sim = st.sim;
    var tx = an && an.tx,
      out = [],
      seen = {};
    function nm(id) {
      return sim.signals[id].fullName;
    }
    function addS(type, f) {
      var full = Object.assign({}, TYPES[type].defaults, f);
      var k = key(type, full);
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ type: type, f: full });
    }
    if (tx && tx.interfaces) {
      tx.interfaces.forEach(function (f) {
        addS("never_x", { sig: nm(f.valid) });
        if (f.ready >= 0) addS("never_x", { sig: nm(f.ready) });
        [f.addr, f.write, f.read, f.wdata, f.rdata].forEach(function (id) {
          if (id < 0) return;
          addS("never_x", { sig: nm(id), qual: nm(f.valid) });
          if (f.ready >= 0 && id !== f.rdata)
            addS("stable", {
              sig: nm(id),
              w1: nm(f.valid),
              w2: nm(f.ready),
              w2Level: "low",
            });
        });
        if (f.dir === "request" && f.link >= 0) {
          addS("response_within", {
            trig: nm(f.valid),
            resp: nm(tx.interfaces[f.link].valid),
            n: "8",
          });
        }
      });
    }
    var grants = [];
    sim.signals.forEach(function (s) {
      if (
        st.analysis.roles.roles[s.id].role === "grant" &&
        s.width === 1 &&
        s.aliasOf === null
      )
        grants.push(s);
    });
    for (var i = 0; i < grants.length && out.length < 40; i++) {
      for (var j = i + 1; j < grants.length; j++) {
        if (grants[i].scopeId === grants[j].scopeId)
          addS("mutual_exclusion", {
            a: grants[i].fullName,
            b: grants[j].fullName,
          });
      }
    }
    return out.slice(0, 30);
  }

  function addSuggested() {
    var have = {};
    list().forEach(function (r) {
      have[key(r.type, r.f)] = 1;
    });
    var added = 0;
    suggest().forEach(function (x) {
      if (have[key(x.type, x.f)] || list().length >= MAX_RULES) return;
      push(x.type, x.f, true);
      added++;
    });
    runAll();
    return added;
  }

  VCD.rules = {
    TYPES: TYPES,
    list: list,
    add: add,
    addSuggested: addSuggested,
    remove: remove,
    toggle: toggle,
    clear: clear,
    runAll: runAll,
    exportJSON: exportJSON,
    importJSON: importJSON,
    describe: describe,
    suggest: suggest,
  };
})();
