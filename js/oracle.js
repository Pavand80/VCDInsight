/* VCDInsight — oracle.js
   Uses the testbench's own self-check counter (errors, error_count, fail_count ...)
   as the functional-correctness oracle.
   - counter rose above 0  -> one ERROR finding at the time of the first increase
   - counter stayed at 0   -> heuristic warnings (and the "request dropped" family of errors)
                              are waived to info, because the testbench's checker passed
   Public: VCD.oracle.run(sim, roles, health, tx) -> null | result object          */
"use strict";

(function () {
  var NAMES = [
    "errors",
    "error",
    "errcount",
    "errorcount",
    "errcnt",
    "errorcnt",
    "numerrors",
    "numerr",
    "nerrors",
    "nerr",
    "totalerrors",
    "errs",
    "failcount",
    "failcnt",
    "failures",
    "fails",
    "mismatches",
    "mismatchcount",
  ];
  var TESTS = [
    "tests",
    "testcount",
    "numtests",
    "totaltests",
    "testsrun",
    "checks",
    "checkcount",
    "numchecks",
  ];
  var INT_KINDS = { integer: 1, int: 1, longint: 1, shortint: 1 };
  var WAIVE_ERRORS = {
    request_dropped: 1,
    no_response: 1,
    stall: 1,
    unmatched_response: 1,
    repeated_request: 1,
  };
  var NOTE = "testbench self-check passed";

  function norm(name) {
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  function depth(sig) {
    return sig.scopePath ? sig.scopePath.split(".").length : 0;
  }
  function isCounter(sig) {
    return sig.width >= 8 || INT_KINDS[sig.kind] === 1;
  }

  function toNum(bits) {
    if (/[xz]/.test(bits)) return null;
    if (bits.length > 52) {
      try {
        return Number(BigInt("0b" + bits));
      } catch (e) {
        return null;
      }
    }
    return parseInt(bits, 2);
  }

  /* first known value, highest value, last value, time of the first value above 0 */
  function readNet(net) {
    var init = null,
      peak = 0,
      last = 0,
      firstRise = null,
      i,
      n;
    for (i = 0; i < net.v.length; i++) {
      n = toNum(net.v[i]);
      if (n === null) continue;
      if (init === null) init = n;
      if (n > peak) peak = n;
      if (n > 0 && firstRise === null) firstRise = net.t[i];
      last = n;
    }
    return init === null
      ? null
      : { init: init, peak: peak, final: last, firstRise: firstRise };
  }

  function findCounter(sim) {
    var best = null,
      i,
      s;
    for (i = 0; i < sim.signals.length; i++) {
      s = sim.signals[i];
      if (
        s.aliasOf !== null ||
        depth(s) > 2 ||
        !isCounter(s) ||
        sim.nets[s.net].isReal
      )
        continue;
      if (NAMES.indexOf(norm(s.name)) === -1) continue;
      if (!best || depth(s) < depth(best)) best = s;
    }
    return best;
  }

  function findTests(sim, sig) {
    var i, s, info;
    for (i = 0; i < sim.signals.length; i++) {
      s = sim.signals[i];
      if (
        s.scopePath !== sig.scopePath ||
        !isCounter(s) ||
        sim.nets[s.net].isReal
      )
        continue;
      if (TESTS.indexOf(norm(s.name)) === -1) continue;
      info = readNet(sim.nets[s.net]);
      if (info) return { name: s.name, value: info.final };
    }
    return null;
  }

  /* downgrade heuristic findings after a passing self-check; returns how many were waived */
  function waiveAll(hl, tx) {
    var msgMap = {},
      count = 0;

    function waiveList(list) {
      (list || []).forEach(function (f) {
        var warn = f.severity === "warning";
        var err = f.severity === "error" && WAIVE_ERRORS[f.type] === 1;
        if (!warn && !err) return;
        var old = f.message;
        f.originalSeverity = f.severity;
        f.severity = "info";
        f.message = old + " (waived: " + NOTE + ")";
        msgMap[old] = f.message;
        count++;
      });
    }
    waiveList(hl && hl.findings);
    waiveList(tx && tx.findings);

    if (tx && tx.story) {
      tx.story.forEach(function (r) {
        if (r.kind === "problem" && msgMap[r.what]) {
          r.what = msgMap[r.what];
          r.result = "INFO";
          r.note = "waived";
        } else if (r.kind === "txn" && r.result === "WARN") {
          r.result = "OK";
          r.note = (r.note ? r.note + " · " : "") + "waived: " + NOTE;
        }
      });
    }
    if (tx && tx.interfaces) {
      tx.interfaces.forEach(function (f) {
        f.transfers.forEach(function (tr) {
          if (tr.result === "WARN") {
            tr.result = "OK";
            tr.note = (tr.note ? tr.note + " · " : "") + "waived: " + NOTE;
          }
        });
      });
    }

    /* recount the health summary and per-signal statuses */
    if (hl && hl.findings) {
      var sm = hl.summary;
      sm.errors = 0;
      sm.warnings = 0;
      sm.infos = 0;
      sm.firstError = null;
      hl.findings.forEach(function (f) {
        if (f.severity === "error") {
          sm.errors++;
          if (
            f.time !== null &&
            f.time !== undefined &&
            (!sm.firstError || f.time < sm.firstError.time)
          )
            sm.firstError = f;
        } else if (f.severity === "warning") sm.warnings++;
        else sm.infos++;
      });
      (hl.recs || []).forEach(function (rc) {
        if (rc.status !== "error" && rc.status !== "warning") return;
        var st = "info";
        hl.findings.forEach(function (f) {
          if (f.netIds && f.netIds.indexOf(rc.netId) !== -1) {
            if (f.severity === "error") st = "error";
            else if (f.severity === "warning" && st !== "error") st = "warning";
          }
        });
        rc.status = st;
      });
    }
    return count;
  }

  function run(sim, rd, hl, tx) {
    var sig = findCounter(sim);
    if (!sig) return null;
    var info = readNet(sim.nets[sig.net]);
    if (!info) return null;
    var ts = sim.header.timescale;
    var tests = findTests(sim, sig);
    var passed = info.peak === 0;
    var findings = [],
      waived = 0;

    if (!passed) {
      findings.push({
        severity: "error",
        type: "testbench_check_failed",
        signal: sig.name,
        time: info.firstRise,
        netIds: [sig.net],
        message:
          "The testbench self-check counter " +
          sig.name +
          " reached " +
          info.peak +
          (tests ? " (of " + tests.value + " tests)" : "") +
          "; it first increased at " +
          VCD.fmtTime(info.firstRise, ts) +
          ". The testbench's own checker reported wrong behaviour.",
      });
    } else {
      waived = waiveAll(hl, tx);
      findings.push({
        severity: "info",
        type: "testbench_check_passed",
        signal: sig.name,
        time: null,
        netIds: [sig.net],
        message:
          "The testbench self-check counter " +
          sig.name +
          " stayed at 0" +
          (tests ? " over " + tests.value + " tests" : "") +
          ", so the testbench's own checker found no wrong behaviour." +
          (waived ? " " + waived + " heuristic finding(s) were waived." : ""),
      });
    }

    return {
      name: sig.name,
      scope: sig.scopePath,
      init: info.init,
      peak: info.peak,
      final: info.final,
      firstRise: info.firstRise,
      passed: passed,
      tests: tests,
      waived: waived,
      findings: findings,
    };
  }

  VCD.oracle = { run: run };
})();
