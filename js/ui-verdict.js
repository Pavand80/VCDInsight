/* VCDInsight — ui-verdict.js (Step 4)
   Module 04 (Transactions) and Module 07 (Final Verdict + Run Story).
   Public: VCD.verdict.compute()  (the report and later steps reuse it)       */
"use strict";

(function () {
  var RES = {
    OK: { cls: "tx-ok", label: "OK" },
    MISMATCH: { cls: "tx-fail", label: "MISMATCH" },
    ERROR: { cls: "tx-fail", label: "ERROR" },
    X_STATE: { cls: "tx-fail", label: "X STATE" },
    ADDR_ERROR: { cls: "tx-fail", label: "ADDRESS ERROR" },
    NO_RESPONSE: { cls: "tx-fail", label: "NO RESPONSE" },
    WARN: { cls: "tx-warn", label: "WARNING" },
    INFO: { cls: "text-muted", label: "INFO" },
  };
  var PROBLEM = {
    MISMATCH: 1,
    ERROR: 1,
    X_STATE: 1,
    ADDR_ERROR: 1,
    NO_RESPONSE: 1,
    WARN: 1,
  };
  var SEV_BADGE = {
    error: "badge-critical",
    warning: "badge-warning",
    info: "badge-info",
  };

  function esc(s) {
    return VCD.esc(s);
  }
  function resHtml(r) {
    var x = RES[r] || RES.INFO;
    return '<span class="' + x.cls + '">' + x.label + "</span>";
  }
  function plural(n, w, p) {
    return n + " " + (n === 1 ? w : p || w + "s");
  }
  function noData(title) {
    return (
      '<div class="panel-placeholder"><div class="p-label">// ' +
      title +
      '</div><div class="p-note">No analysis data yet. Go back and analyse a file first.</div></div>'
    );
  }
  function num1(x) {
    return String(Math.round(x * 10) / 10);
  }

  /* ═════════ verdict logic (reads every finding, so later steps feed it too) ═════════ */
  function compute() {
    var F = VCD.state.findings || [];
    var errs = F.filter(function (f) {
      return f.severity === "error";
    });
    var warns = F.filter(function (f) {
      return f.severity === "warning";
    });
    var level = errs.length ? "FAIL" : warns.length ? "WARNING" : "PASS";
    var reason;
    if (level === "FAIL")
      reason =
        plural(errs.length, "error") +
        " and " +
        plural(warns.length, "warning") +
        " found. The errors are listed below with their times.";
    else if (level === "WARNING")
      reason =
        "No errors, but " + plural(warns.length, "warning") + " need review.";
    else
      reason =
        "No errors or warnings were found by the checks that ran (see what was checked below).";
    var ordered = errs.concat(warns).sort(function (a, b) {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      var ta = a.time === null ? Infinity : a.time,
        tb = b.time === null ? Infinity : b.time;
      return ta - tb;
    });
    return {
      level: level,
      cls: level === "FAIL" ? "fail" : level === "WARNING" ? "warning" : "pass",
      errors: errs,
      warnings: warns,
      reason: reason,
      ordered: ordered,
    };
  }

  /* ═════════ MODULE 04 : TRANSACTIONS ═════════ */
  function txHtml() {
    var s = VCD.state,
      a = s.analysis;
    if (!s.sim || !a) return noData("TRANSACTIONS");
    var tx = a.tx,
      sim = s.sim,
      ts = sim.header.timescale;
    function ft(t) {
      return VCD.fmtTime(t, ts);
    }

    if (!tx || !tx.interfaces.length) {
      var why =
        tx && tx.failed
          ? "The transaction analysis failed: " + esc(tx.error)
          : "No valid/ready style interface was detected in this file. Transaction checks look for pairs such as x_v + x_rdy, valid + ready, or req + ack.";
      return (
        '<div class="panel-title">// TRANSACTIONS</div><div class="panel-sub">Handshakes detected from the waveform</div>' +
        '<div class="panel-placeholder"><div class="p-note">' +
        why +
        "</div></div>"
      );
    }

    var sm = tx.summary;
    var modeTxt =
      tx.mode === "clock"
        ? "sampled just before every rising clock edge (what the flip-flops see)"
        : "detected from signal changes (no regular clock found)";

    var ifRows = tx.interfaces
      .map(function (f) {
        var st = f.stats;
        var sigTxt =
          "valid: " +
          esc(sim.signals[f.valid].name) +
          (f.ready >= 0
            ? " · ready: " + esc(sim.signals[f.ready].name)
            : " · no ready (every valid cycle counts)");
        var type = f.dir === "channel" ? f.kind : f.dir;
        var latTxt = st.latN
          ? num1(st.latSum / st.latN) + " / " + num1(st.latMax) + " cyc"
          : "—";
        var waitTxt =
          st.waitN && f.ready >= 0
            ? num1(st.waitSum / st.waitN) + " / " + st.waitMax + " cyc"
            : "—";
        var issues = [];
        if (st.repeats) issues.push(st.repeats + " repeated");
        if (st.unanswered) issues.push(st.unanswered + " unanswered");
        var also = f.alsoIn.length
          ? '<div class="text-muted" style="font-size:0.85rem">also seen in ' +
            f.alsoIn.length +
            " other scope(s)</div>"
          : "";
        return (
          "<tr><td><b>" +
          esc(f.name) +
          "</b>" +
          also +
          '<div class="text-muted" style="font-size:0.85rem">' +
          esc(f.scope || "(root)") +
          "</div></td>" +
          "<td>" +
          esc(type) +
          '</td><td class="text-muted" style="font-size:0.9rem">' +
          sigTxt +
          "</td>" +
          "<td>" +
          st.transfers +
          "</td><td>" +
          waitTxt +
          "</td><td>" +
          latTxt +
          "</td>" +
          "<td>" +
          (issues.length
            ? '<span class="text-warn">' + esc(issues.join(", ")) + "</span>"
            : '<span class="text-muted">none</span>') +
          "</td></tr>"
        );
      })
      .join("");

    var all = [];
    tx.interfaces.forEach(function (f) {
      f.transfers.forEach(function (tr) {
        all.push({ f: f, tr: tr });
      });
    });
    all.sort(function (x, y) {
      return x.tr.time - y.tr.time || x.f.id - y.f.id;
    });
    var capped = all.length > 3000;
    if (capped) all = all.slice(0, 3000);

    var opts =
      '<option value="">All interfaces</option>' +
      tx.interfaces
        .map(function (f) {
          return (
            '<option value="' +
            f.id +
            '">' +
            esc(f.name) +
            " (" +
            f.stats.transfers +
            ")</option>"
          );
        })
        .join("");

    var trRows = all
      .map(function (x) {
        var tr = x.tr,
          f = x.f,
          data = "—";
        if (tr.op === "WRITE") data = VCD.transactions.show(tr.wdata);
        else if (tr.op === "READ")
          data =
            tr.rsp && tr.rsp.rdata !== null
              ? VCD.transactions.show(tr.rsp.rdata)
              : "—";
        else if (tr.rdata !== null) data = VCD.transactions.show(tr.rdata);
        else if (tr.wdata !== null) data = VCD.transactions.show(tr.wdata);
        var rsp = "—";
        if (f.dir === "request" && f.link >= 0)
          rsp = tr.rsp
            ? ft(tr.rsp.time) +
              (tr.latCycles !== null ? " (" + tr.latCycles + " cyc)" : "")
            : "none";
        return (
          '<tr data-if="' +
          f.id +
          '"><td class="tx-time">' +
          ft(tr.time) +
          "</td><td>" +
          esc(f.name) +
          '</td><td class="tx-op">' +
          esc(tr.op) +
          "</td>" +
          "<td>" +
          (tr.addr !== null ? esc(VCD.transactions.show(tr.addr)) : "—") +
          "</td><td>" +
          esc(data) +
          "</td>" +
          "<td>" +
          (tr.wait !== null ? tr.wait : "—") +
          "</td><td>" +
          esc(rsp) +
          "</td><td>" +
          resHtml(tr.result) +
          '</td><td class="tx-note">' +
          esc(tr.note) +
          "</td></tr>"
        );
      })
      .join("");

    return (
      '<div class="panel-title">// TRANSACTIONS</div>' +
      '<div class="panel-sub">' +
      plural(sm.ifaceCount, "interface") +
      " · " +
      plural(sm.transfers, "transfer") +
      " · " +
      modeTxt +
      ". Requests and responses are paired in order.</div>" +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th>Interface</th><th>Type</th><th>Signals</th><th>Transfers</th>' +
      "<th>Wait avg / max</th><th>Latency avg / max</th><th>Issues</th></tr></thead><tbody>" +
      ifRows +
      "</tbody></table></div>" +
      '<div class="panel-title" style="margin-top:26px">// ALL TRANSFERS</div>' +
      '<div class="panel-sub">Wait = cycles valid was high before ready. Response = time of the matching response (cycles after the accept).' +
      (capped ? " Showing the first 3000." : "") +
      "</div>" +
      '<div class="viewer-toolbar"><select class="tool-input" id="txFilter">' +
      opts +
      '</select><span class="text-muted" id="txCount"></span></div>' +
      '<div class="table-scroll" style="max-height:560px;overflow-y:auto"><table class="data-table tx-table"><thead><tr>' +
      "<th>Time</th><th>Interface</th><th>Operation</th><th>Address</th><th>Data</th><th>Wait</th><th>Response</th><th>Result</th><th>Note</th></tr></thead>" +
      '<tbody id="txBody">' +
      trRows +
      "</tbody></table></div>"
    );
  }

  function txMount(el) {
    var sel = el.querySelector("#txFilter"),
      body = el.querySelector("#txBody"),
      cnt = el.querySelector("#txCount");
    if (!sel || !body) return;
    function apply() {
      var v = sel.value,
        shown = 0;
      Array.prototype.forEach.call(body.rows, function (tr) {
        var ok = !v || tr.getAttribute("data-if") === v;
        tr.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      cnt.textContent = "Showing " + shown + " of " + body.rows.length;
    }
    sel.addEventListener("change", apply);
    apply();
  }

  /* ═════════ MODULE 07 : FINAL VERDICT + RUN STORY ═════════ */
  function verdictHtml() {
    var s = VCD.state,
      a = s.analysis;
    if (!s.sim || !a) return noData("FINAL VERDICT");
    var tx = a.tx,
      sim = s.sim,
      ts = sim.header.timescale;
    function ft(t) {
      return VCD.fmtTime(t, ts);
    }
    var v = compute();
    var sm = tx ? tx.summary : null;

    /* reasons */
    var shown = v.ordered.slice(0, 12);
    var reasons = shown.length
      ? shown
          .map(function (f) {
            return (
              '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name" style="font-size:1rem">' +
              esc((f.type || "finding").replace(/_/g, " ").toUpperCase()) +
              "</span><span>" +
              (f.time !== null
                ? '<span class="text-muted" style="margin-right:10px">' +
                  ft(f.time) +
                  "</span>"
                : "") +
              '<span class="badge ' +
              SEV_BADGE[f.severity] +
              '">' +
              f.severity.toUpperCase() +
              "</span></span></div>" +
              '<div class="ai-row"><span>' +
              esc(f.message) +
              "</span></div></div>"
            );
          })
          .join("") +
        (v.ordered.length > shown.length
          ? '<div class="text-muted" style="margin:6px 0 0">…and ' +
            (v.ordered.length - shown.length) +
            " more (see the Signal Health and Transactions modules).</div>"
          : "")
      : '<div class="ai-card"><div class="ai-row"><span class="text-muted">Nothing to report.</span></div></div>';

    /* what was checked */
    var checks = [];
    var hl = a.health;
    checks.push(
      "Signal health: reset-aware X / Z, stuck-signal, glitch, clock and reset checks on " +
        hl.summary.nets +
        " nets.",
    );
    if (sm && sm.ifaceCount) {
      checks.push(
        "Transactions: " +
          plural(sm.ifaceCount, "interface") +
          ", " +
          plural(sm.transfers, "transfer") +
          " (" +
          (tx.mode === "clock" ? "clock-sampled" : "event-based") +
          ").",
      );
      if (sm.sbEnabled) {
        checks.push(
          "Read-back check on " +
            esc(sm.sbNames.join(", ")) +
            ": " +
            plural(sm.sbReads, "read") +
            ", " +
            sm.sbCompared +
            " compared with an earlier write, " +
            plural(sm.sbMismatches, "mismatch", "mismatches") +
            ".",
        );
      } else {
        checks.push(
          "Read-back check: not applicable (no interface with address, write flag, write data and a read-data response was found).",
        );
      }
    } else {
      checks.push(
        "Transactions: no valid/ready style interface was detected, so only signal health was checked.",
      );
    }
    var rl = (s.rules || []).filter(function (r) {
      return r.enabled && r.result;
    });
    if (rl.length) {
      var rp = rl.filter(function (r) {
        return r.result.status === "pass";
      }).length;
      var rf = rl.filter(function (r) {
        return r.result.status === "fail";
      }).length;
      checks.push(
        "Custom rules: " +
          rl.length +
          " run — " +
          rp +
          " passed, " +
          rf +
          " failed, " +
          (rl.length - rp - rf) +
          " skipped.",
      );
    } else checks.push("Custom rules: none defined.");
    if (s.cmp) {
      var cr = s.compare && s.compare.result;
      if (cr && cr.ok) {
        checks.push(
          "Sim vs second capture (" +
            esc(s.cmp.fileName) +
            "): " +
            cr.pairs.length +
            " signals compared over " +
            cr.N +
            " cycles, " +
            cr.differing +
            " differ, cycle match " +
            cr.matchPct.toFixed(2) +
            " %.",
        );
      } else {
        checks.push(
          "Second capture loaded (" +
            esc(s.cmp.fileName) +
            ") but the comparison could not run.",
        );
      }
    }

    /* summary line */
    var runLine = "";
    if (sm && sm.ifaceCount) {
      runLine =
        '<div class="verdict-summary">' +
        plural(sm.writes, "write") +
        " and " +
        plural(sm.reads, "read") +
        " were issued; " +
        sm.answered +
        " answered" +
        (sm.unanswered ? ", " + sm.unanswered + " unanswered" : "") +
        "; the longest wait for ready was " +
        plural(sm.maxWait, "cycle") +
        (sm.flagEvents
          ? "; " + plural(sm.flagEvents, "conflict-style flag event")
          : "") +
        ".</div>";
    }

    /* run story */
    var story = tx ? tx.story.slice() : [];
    (s.rules || []).forEach(function (r) {
      if (
        r.enabled &&
        r.result &&
        r.result.status === "fail" &&
        r.result.first !== null
      ) {
        story.push({
          time: r.result.first,
          what: "Rule failed: " + VCD.rules.describe(r),
          result: "ERROR",
          note: r.result.message,
          kind: "problem",
          seq: 0,
        });
      }
    });
    (s.findings || []).forEach(function (f) {
      if (
        f.source === "compare" &&
        f.time !== null &&
        f.time !== undefined &&
        (f.severity === "error" || f.severity === "warning")
      ) {
        story.push({
          time: f.time,
          what: f.message,
          result: f.severity === "error" ? "ERROR" : "WARN",
          note: "comparison",
          kind: "problem",
          seq: 0,
        });
      }
    });
    story.sort(function (x, y) {
      return x.time - y.time;
    });
    var storyRows = story
      .map(function (r) {
        var prob = PROBLEM[r.result] ? "1" : "0";
        return (
          '<tr data-kind="' +
          r.kind +
          '" data-problem="' +
          prob +
          '"><td class="tx-time">' +
          ft(r.time) +
          '</td><td class="tx-op" style="font-weight:400;color:var(--text)">' +
          esc(r.what) +
          "</td><td>" +
          resHtml(r.result) +
          '</td><td class="tx-note">' +
          esc(r.note) +
          "</td></tr>"
        );
      })
      .join("");
    var storyBlock = story.length
      ? '<div class="viewer-toolbar"><select class="tool-input" id="stFilter"><option value="all">All events</option>' +
        '<option value="txn">Transactions only</option><option value="problem">Problems only</option></select>' +
        '<span class="text-muted" id="stCount"></span></div>' +
        '<div class="table-scroll" style="max-height:620px;overflow-y:auto"><table class="data-table tx-table"><thead><tr>' +
        '<th>Time</th><th>What happened</th><th>Result</th><th>Note</th></tr></thead><tbody id="stBody">' +
        storyRows +
        "</tbody></table></div>"
      : '<div class="ai-card"><div class="ai-row"><span class="text-muted">No transactions or events were detected, so there is no run story for this file.</span></div></div>';

    return (
      '<div class="panel-title">// FINAL HEALTH VERDICT</div>' +
      '<div class="panel-sub">Every item below comes from a check that ran on your waveform</div>' +
      '<div class="verdict-box"><div class="verdict-badge badge-' +
      v.cls +
      '">' +
      v.level +
      "</div>" +
      '<div class="verdict-reason">' +
      esc(v.reason) +
      "</div>" +
      runLine +
      VCD.summaryUI.html() +
      "</div>" +
      '<div class="panel-title" style="margin-top:8px">// REASONS</div>' +
      '<div class="panel-sub">Errors first, then warnings, in time order</div>' +
      reasons +
      '<div class="panel-title" style="margin-top:26px">// WHAT WAS CHECKED</div>' +
      '<div class="panel-sub">So the verdict is never read as more than it is</div>' +
      '<div class="ai-card">' +
      checks
        .map(function (c) {
          return (
            '<div class="ai-row"><span>• ' +
            (c.indexOf("&") !== -1 ? c : esc(c)) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="panel-title" style="margin-top:26px">// RUN STORY</div>' +
      '<div class="panel-sub">What happened during the run, in time order. Transfers are shown at the clock edge where they were accepted.</div>' +
      storyBlock
    );
  }

  function verdictMount(el) {
    VCD.summaryUI.mount(el);
    var sel = el.querySelector("#stFilter"),
      body = el.querySelector("#stBody"),
      cnt = el.querySelector("#stCount");
    if (!sel || !body) return;
    function apply() {
      var mode = sel.value,
        shown = 0;
      Array.prototype.forEach.call(body.rows, function (tr) {
        var ok =
          mode === "all" ||
          (mode === "txn" && tr.getAttribute("data-kind") === "txn") ||
          (mode === "problem" && tr.getAttribute("data-problem") === "1");
        tr.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      cnt.textContent = "Showing " + shown + " of " + body.rows.length;
    }
    sel.addEventListener("change", apply);
    apply();
  }

  VCD.verdict = { compute: compute };
  VCD.renderers[4] = { html: txHtml, mount: txMount };
  VCD.renderers[7] = { html: verdictHtml, mount: verdictMount };
})();
