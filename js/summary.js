/* VCDInsight — summary.js (Step 7)
   Builds a small "facts" object from the findings, writes an offline summary
   locally, and asks the backend for an AI version. If the backend, the key or
   the internet fails, the offline text is used, so the page never breaks.
   Public: VCD.summary = { facts, offline, ensure, currentText, ready }          */
"use strict";

(function () {
  VCD.config = Object.assign(
    { backend: "http://127.0.0.1:5000", timeoutMs: 30000 },
    VCD.config || {},
  );

  var NEXT = {
    x_state:
      "Make sure the signal is driven with a known value whenever it is used (after reset, or while its valid is high).",
    z_state:
      "Check that something always drives the signal; a floating signal usually means a missing driver.",
    addr_unknown:
      "Make sure the address is never unknown while a request is valid.",
    data_unknown: "Make sure data is known whenever it is written or returned.",
    readback_mismatch:
      "Compare the failing read with the earlier write at the same address, and check the write path and the address decode.",
    request_dropped:
      "Keep valid high until ready is seen; dropping it early loses the request.",
    no_response:
      "Check that every accepted request produces a response and that the response path is not blocked.",
    stall:
      "Check why ready stays low for so long (a busy block or a blocked arbiter).",
    repeated_request:
      "Drop valid in the cycle after the request is accepted, so it is not accepted twice.",
    rule_failed:
      "Open Rules & Checks and use the jump link to see the exact moment each rule failed.",
    compare_mismatch:
      "Open Sim vs Second Capture and check the signals at the first mismatch cycle; reset, timing and initial values often explain simulation-versus-hardware differences.",
    compare_unknown:
      "Only unknown values differ; check the power-up and reset behaviour of the hardware capture.",
    compare_sequence:
      "Open Sim vs Second Capture and compare the first differing transaction.",
    clock: "Check how the clock is generated.",
    reset: "Check how and when reset is applied and released.",
  };

  var seq = 0,
    waiters = [];

  function cut(s, n) {
    s = String(s === null || s === undefined ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function fnv(str) {
    var h = 0x811c9dc5,
      i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
  function plural(n, w) {
    return n + " " + w + (n === 1 ? "" : "s");
  }

  function facts() {
    var s = VCD.state,
      sim = s.sim,
      an = s.analysis;
    if (!sim || !an) return null;
    var ts = sim.header.timescale,
      v = VCD.verdict.compute();
    function tm(t) {
      return t === null || t === undefined ? null : VCD.fmtTime(t, ts);
    }
    var F = {
      tool: "VCDInsight",
      sim: {
        file: sim.fileName,
        signals: sim.stats.signalCount,
        duration: VCD.fmtTime(sim.stats.endTime, ts),
        timescale: ts.text,
      },
      cmp: s.cmp ? { file: s.cmp.fileName } : null,
      verdict: v.level,
      errors: v.errors.length,
      warnings: v.warnings.length,
      findings: v.ordered.slice(0, 25).map(function (f) {
        return {
          severity: f.severity,
          type: f.type || "",
          time: tm(f.time),
          message: cut(f.message, 300),
        };
      }),
      transactions: null,
      rules: null,
      compare: null,
    };
    var sm = an.tx && an.tx.summary;
    if (sm && sm.ifaceCount) {
      F.transactions = {
        interfaces: sm.ifaceCount,
        transfersOnAllInterfaces: sm.transfers,
        requestWrites: sm.writes,
        requestReads: sm.reads,
        requestsAnswered: sm.answered,
        requestsUnanswered: sm.unanswered,
        maxWaitCycles: sm.maxWait,
        readbackCompared: sm.sbCompared,
        readbackMismatches: sm.sbMismatches,
      };
    }
    var rl = (s.rules || []).filter(function (r) {
      return r.enabled && r.result;
    });
    if (rl.length) {
      F.rules = {
        total: rl.length,
        passed: rl.filter(function (r) {
          return r.result.status === "pass";
        }).length,
        failed: rl.filter(function (r) {
          return r.result.status === "fail";
        }).length,
        skipped: rl.filter(function (r) {
          return r.result.status === "skip";
        }).length,
      };
    }
    var cr = s.compare && s.compare.result;
    if (s.cmp && cr && cr.ok) {
      F.compare = {
        signals: cr.pairs.length,
        differing: cr.differing,
        cycles: cr.N,
        matchPercent: Math.round(cr.matchPct * 100) / 100,
      };
    }
    return F;
  }

  function offline(F) {
    var p = [];
    p.push(
      "VCDInsight analysed " +
        F.sim.file +
        " (" +
        plural(F.sim.signals, "signal") +
        ", duration " +
        F.sim.duration +
        ")" +
        (F.cmp ? " and compared it with " + F.cmp.file : "") +
        ". The verdict is " +
        F.verdict +
        ": " +
        plural(F.errors, "error") +
        " and " +
        plural(F.warnings, "warning") +
        ".",
    );
    if (F.findings.length) {
      p.push(
        "Most important findings: " +
          F.findings
            .slice(0, 3)
            .map(function (f, i) {
              return (
                i + 1 + ") " + (f.time ? "at " + f.time + ": " : "") + f.message
              );
            })
            .join(" "),
      );
    } else {
      p.push("No errors or warnings were found by the checks that ran.");
    }
    var bits = [];
    if (F.transactions) {
      var t = F.transactions;
      bits.push(
        plural(t.transfersOnAllInterfaces, "transfer") +
          " on " +
          plural(t.interfaces, "interface") +
          " in total; the main requests were " +
          plural(t.requestWrites, "write") +
          " and " +
          plural(t.requestReads, "read") +
          ", " +
          t.requestsAnswered +
          " answered" +
          (t.requestsUnanswered
            ? ", " + t.requestsUnanswered + " unanswered"
            : "") +
          ", longest wait " +
          plural(t.maxWaitCycles, "cycle"),
      );
      if (t.readbackCompared)
        bits.push(
          t.readbackCompared +
            " read-backs compared, " +
            t.readbackMismatches +
            " mismatching",
        );
    }
    if (F.rules)
      bits.push(
        F.rules.total +
          " rules: " +
          F.rules.passed +
          " passed, " +
          F.rules.failed +
          " failed, " +
          F.rules.skipped +
          " skipped",
      );
    if (F.compare)
      bits.push(
        "comparison: " +
          F.compare.differing +
          " of " +
          F.compare.signals +
          " signals differ over " +
          F.compare.cycles +
          " cycles (match " +
          F.compare.matchPercent +
          " %)",
      );
    if (bits.length) p.push("What was checked: " + bits.join("; ") + ".");
    var steps = [],
      seen = {};
    F.findings.forEach(function (f) {
      if (NEXT[f.type] && !seen[f.type] && steps.length < 3) {
        seen[f.type] = 1;
        steps.push(NEXT[f.type]);
      }
    });
    if (steps.length)
      p.push(
        "Suggested next steps: " +
          steps
            .map(function (x, i) {
              return i + 1 + ") " + x;
            })
            .join(" "),
      );
    return p.join("\n\n");
  }

  function loadCache(hash) {
    try {
      var raw = localStorage.getItem("vcdinsight.summary." + hash);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveCache(hash, obj) {
    try {
      localStorage.setItem("vcdinsight.summary." + hash, JSON.stringify(obj));
    } catch (e) {
      /* storage may be off */
    }
  }

  function fetchAI(F) {
    var ctl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctl
      ? setTimeout(function () {
          ctl.abort();
        }, VCD.config.timeoutMs)
      : null;
    return fetch(String(VCD.config.backend).replace(/\/+$/, "") + "/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts: F }),
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, reason: "bad reply" };
        });
      })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        return j && j.ok && j.text
          ? j
          : { ok: false, reason: (j && j.reason) || "no summary returned" };
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        return {
          ok: false,
          reason:
            e && e.name === "AbortError"
              ? "timed out"
              : "backend not reachable",
        };
      });
  }

  /* cb(result) is called with the best text available now, and again when the final one is ready.
     result = { source: "ai"|"offline", text, model?, cached?, pending?, reason? } */
  function ensure(force, cb) {
    var F = facts();
    if (!F) return;
    var st = VCD.state,
      hash = fnv(JSON.stringify(F));
    if (!force && st.summary && st.summary.hash === hash && st.summary.result) {
      cb(st.summary.result);
      if (st.summary.result.pending) waiters.push(cb);
      return;
    }
    if (!force) {
      var c = loadCache(hash);
      if (c && c.text) {
        st.summary = {
          hash: hash,
          token: ++seq,
          result: {
            source: "ai",
            text: c.text,
            model: c.model || "",
            cached: true,
            pending: false,
          },
        };
        cb(st.summary.result);
        return;
      }
    }
    var offText = offline(F),
      token = ++seq;
    waiters = [cb];
    st.summary = {
      hash: hash,
      token: token,
      result: { source: "offline", text: offText, pending: true, reason: "" },
    };
    cb(st.summary.result);
    fetchAI(F).then(function (j) {
      if (!st.summary || st.summary.token !== token) return;
      if (j.ok) {
        saveCache(hash, { text: j.text, model: j.model || "" });
        st.summary.result = {
          source: "ai",
          text: j.text,
          model: j.model || "",
          cached: !!j.cached,
          pending: false,
        };
      } else {
        st.summary.result = {
          source: "offline",
          text: offText,
          pending: false,
          reason: j.reason,
        };
      }
      var list = waiters;
      waiters = [];
      list.forEach(function (w) {
        w(st.summary.result);
      });
    });
  }

  function currentText() {
    var st = VCD.state;
    if (st.summary && st.summary.result) return st.summary.result;
    var F = facts();
    return F
      ? { source: "offline", text: offline(F), pending: false }
      : { source: "offline", text: "", pending: false };
  }

  /* resolves with the final summary, or the best text after maxMs (used by the report) */
  function ready(maxMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(currentText());
        }
      }, maxMs || 8000);
      ensure(false, function (r) {
        if (!r.pending && !done) {
          done = true;
          clearTimeout(timer);
          resolve(r);
        }
      });
    });
  }

  VCD.summary = {
    facts: facts,
    offline: offline,
    ensure: ensure,
    currentText: currentText,
    ready: ready,
  };
})();
