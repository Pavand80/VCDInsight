/* VCDInsight — report.js (Step 7)
   Builds the printable report (save as PDF from the print dialog) or an HTML download.
   Public: VCD.report = { open, download, build }                                        */
"use strict";

(function () {
  var e = VCD.esc;
  var MAXROWS = { overview: 400, story: 500, compare: 100, findings: 100 };

  function ft(t) {
    return VCD.fmtTime(t, VCD.state.sim.header.timescale);
  }
  function tm(t) {
    return t === null || t === undefined ? "—" : e(ft(t));
  }
  function plural(n, w, p) {
    return n + " " + (n === 1 ? w : p || w + "s");
  }
  function tr(cells) {
    return (
      "<tr>" +
      cells
        .map(function (c) {
          return "<td>" + c + "</td>";
        })
        .join("") +
      "</tr>"
    );
  }
  function table(heads, rows) {
    return (
      "<table><thead><tr>" +
      heads
        .map(function (h) {
          return "<th>" + e(h) + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      rows.join("") +
      "</tbody></table>"
    );
  }
  function section(title, inner) {
    return "<h2>" + e(title) + "</h2>" + inner;
  }
  function note(t) {
    return '<p class="note">' + e(t) + "</p>";
  }
  function paras(text) {
    return String(text)
      .split(/\n{2,}/)
      .map(function (p) {
        return "<p>" + e(p) + "</p>";
      })
      .join("");
  }
  function avg(sum, n) {
    return n ? (Math.round((sum / n) * 10) / 10).toString() : "—";
  }

  function checks() {
    var s = VCD.state,
      a = s.analysis,
      tx = a.tx,
      sm = tx && tx.summary,
      out = [];
    out.push(
      "Signal health: reset-aware X / Z, stuck-signal, glitch, clock and reset checks on " +
        a.health.summary.nets +
        " nets.",
    );
    if (sm && sm.ifaceCount) {
      out.push(
        "Transactions: " +
          plural(sm.ifaceCount, "interface") +
          ", " +
          plural(sm.transfers, "transfer") +
          " (" +
          (tx.mode === "clock" ? "clock-sampled" : "event-based") +
          ").",
      );
      out.push(
        sm.sbEnabled
          ? "Read-back check on " +
              sm.sbNames.join(", ") +
              ": " +
              plural(sm.sbReads, "read") +
              ", " +
              sm.sbCompared +
              " compared with an earlier write, " +
              plural(sm.sbMismatches, "mismatch", "mismatches") +
              "."
          : "Read-back check: not applicable (no interface with address, write flag, write data and a read-data response was found).",
      );
    } else
      out.push("Transactions: no valid/ready style interface was detected.");
    var rl = (s.rules || []).filter(function (r) {
      return r.enabled && r.result;
    });
    out.push(
      rl.length
        ? "Custom rules: " +
            rl.length +
            " run — " +
            rl.filter(function (r) {
              return r.result.status === "pass";
            }).length +
            " passed, " +
            rl.filter(function (r) {
              return r.result.status === "fail";
            }).length +
            " failed, " +
            rl.filter(function (r) {
              return r.result.status === "skip";
            }).length +
            " skipped."
        : "Custom rules: none defined.",
    );
    if (s.cmp) {
      var cr = s.compare && s.compare.result;
      out.push(
        cr && cr.ok
          ? "Sim vs second capture (" +
              s.cmp.fileName +
              "): " +
              cr.pairs.length +
              " signals compared over " +
              cr.N +
              " cycles, " +
              cr.differing +
              " differ, cycle match " +
              cr.matchPct.toFixed(2) +
              " %."
          : "Second capture loaded (" +
              s.cmp.fileName +
              ") but the comparison could not run.",
      );
    }
    return out;
  }

  function storyRows() {
    var s = VCD.state,
      rows = (s.analysis.tx ? s.analysis.tx.story : []).map(function (r) {
        return { time: r.time, what: r.what, result: r.result, note: r.note };
      });
    (s.rules || []).forEach(function (r) {
      if (
        r.enabled &&
        r.result &&
        r.result.status === "fail" &&
        r.result.first !== null
      ) {
        rows.push({
          time: r.result.first,
          what: "Rule failed: " + VCD.rules.describe(r),
          result: "ERROR",
          note: r.result.message,
        });
      }
    });
    s.findings.forEach(function (f) {
      if (
        f.source === "compare" &&
        f.time !== null &&
        f.time !== undefined &&
        (f.severity === "error" || f.severity === "warning")
      ) {
        rows.push({
          time: f.time,
          what: f.message,
          result: f.severity === "error" ? "ERROR" : "WARN",
          note: "comparison",
        });
      }
    });
    rows.sort(function (x, y) {
      return x.time - y.time;
    });
    return rows;
  }

  function build(summaryResult) {
    var s = VCD.state,
      sim = s.sim,
      a = s.analysis,
      rd = a.roles,
      hl = a.health,
      tx = a.tx;
    var v = VCD.verdict.compute();
    var sr = summaryResult || VCD.summary.currentText();
    var h = [];

    h.push("<h1>VCDInsight — Analysis Report</h1>");
    h.push(
      '<p class="note">Simulation: ' +
        e(sim.fileName) +
        (s.cmp ? " · Second capture: " + e(s.cmp.fileName) : "") +
        " · " +
        plural(sim.stats.signalCount, "signal") +
        " · timescale " +
        e(sim.header.timescale.text) +
        " · duration " +
        e(ft(sim.stats.endTime)) +
        " · generated " +
        e(new Date().toLocaleString()) +
        "</p>",
    );

    h.push(
      section(
        "Final verdict",
        '<div class="v ' +
          v.level +
          '">' +
          v.level +
          "</div><p>" +
          e(v.reason) +
          "</p>",
      ),
    );

    var label =
      sr.source === "ai"
        ? "AI summary" + (sr.model ? " (" + sr.model + ")" : "")
        : "Automatic summary (written locally, no AI)";
    h.push(
      section(
        "Summary",
        '<p class="note">' +
          e(label) +
          "</p>" +
          paras(sr.text) +
          note(
            "The summary only restates the findings below. The verdict comes from the checks, never from the AI.",
          ),
      ),
    );

    var reasons = v.ordered.slice(0, MAXROWS.findings).map(function (f) {
      return tr([
        e(f.severity.toUpperCase()),
        e((f.type || "").replace(/_/g, " ")),
        tm(f.time),
        e(f.message),
      ]);
    });
    h.push(
      section(
        "Reasons",
        reasons.length
          ? table(["Severity", "Type", "Time", "Message"], reasons)
          : "<p>No errors or warnings.</p>",
      ),
    );
    h.push(
      section(
        "What was checked",
        "<ul>" +
          checks()
            .map(function (c) {
              return "<li>" + e(c) + "</li>";
            })
            .join("") +
          "</ul>",
      ),
    );

    var ck = rd.clock,
      rs = rd.reset,
      hs = hl.summary;
    var line = [];
    if (ck)
      line.push(
        "Clock: " +
          e(ck.name) +
          (ck.periodic
            ? ", period " +
              e(ft(ck.period)) +
              ", about " +
              ck.cycles +
              " cycles"
            : ", not regular"),
      );
    if (rs)
      line.push(
        "Reset: " +
          e(rs.name) +
          (rs.activeLow ? " (active low)" : " (active high)") +
          ", asserted " +
          (rs.assertedAt === null ? "never" : e(ft(rs.assertedAt))) +
          ", released " +
          (rs.releasedAt === null ? "never" : e(ft(rs.releasedAt))),
      );
    var hrows = hl.findings.slice(0, MAXROWS.findings).map(function (f) {
      return tr([
        e(f.severity.toUpperCase()),
        e((f.type || "").replace(/_/g, " ")),
        tm(f.time),
        e(f.message),
      ]);
    });
    h.push(
      section(
        "Signal health",
        "<p>" +
          line.join("<br>") +
          "</p><p>" +
          hs.errors +
          " errors, " +
          hs.warnings +
          " warnings, " +
          hs.infos +
          " info.</p>" +
          (hrows.length
            ? table(["Severity", "Type", "Time", "Message"], hrows)
            : ""),
      ),
    );

    if (tx && tx.interfaces.length) {
      var irows = tx.interfaces.map(function (f) {
        var st = f.stats,
          issues = [];
        if (st.repeats) issues.push(st.repeats + " repeated");
        if (st.unanswered) issues.push(st.unanswered + " unanswered");
        return tr([
          e(f.name),
          e(f.scope || "(root)"),
          e(f.dir === "channel" ? f.kind : f.dir),
          String(st.transfers),
          avg(st.waitSum, st.waitN),
          avg(st.latSum, st.latN),
          e(issues.join(", ") || "none"),
        ]);
      });
      h.push(
        section(
          "Transactions",
          note("Wait and latency are averages in clock cycles.") +
            table(
              [
                "Interface",
                "Scope",
                "Type",
                "Transfers",
                "Wait avg",
                "Latency avg",
                "Issues",
              ],
              irows,
            ),
        ),
      );
    }

    var story = storyRows(),
      cap = story.length > MAXROWS.story;
    if (story.length) {
      h.push(
        section(
          "Run story",
          (cap
            ? note(
                "Showing the first " +
                  MAXROWS.story +
                  " of " +
                  story.length +
                  " events.",
              )
            : "") +
            table(
              ["Time", "What happened", "Result", "Note"],
              story.slice(0, MAXROWS.story).map(function (r) {
                return tr([tm(r.time), e(r.what), e(r.result), e(r.note)]);
              }),
            ),
        ),
      );
    }

    var rls = s.rules || [];
    if (rls.length) {
      h.push(
        section(
          "Rules",
          table(
            ["Rule", "Result", "Details"],
            rls.map(function (r) {
              var res =
                r.enabled && r.result ? r.result.status.toUpperCase() : "OFF";
              return tr([
                e(VCD.rules.describe(r)),
                e(res),
                e(r.result ? r.result.message : ""),
              ]);
            }),
          ),
        ),
      );
    }

    var cr = s.compare && s.compare.result;
    if (s.cmp && cr && cr.ok) {
      var diff = cr.pairs
        .filter(function (p) {
          return p.status !== "match";
        })
        .slice(0, MAXROWS.compare);
      var drows = diff.map(function (p) {
        var f = p.first;
        return tr([
          e(p.sSig.name),
          e(p.cSig.name),
          String(p.bad),
          f
            ? "cycle " +
              f.c +
              ": " +
              e(VCD.transactions.show(f.a)) +
              " vs " +
              e(VCD.transactions.show(f.b))
            : "—",
          p.status === "differ" ? "DIFFERENT" : "X / Z ONLY",
        ]);
      });
      var trows = (cr.tx || []).map(function (r) {
        return tr([
          e(r.name),
          r.nS + " / " + (r.found ? r.nC : "—"),
          r.diff
            ? e(r.diff.text)
            : r.found
              ? r.nS !== r.nC
                ? "count differs"
                : "same sequence"
              : "not found",
        ]);
      });
      h.push(
        section(
          "Sim vs second capture",
          "<p>" +
            cr.identical +
            " of " +
            cr.pairs.length +
            " compared signals are identical over " +
            cr.N +
            " cycles (cycle match " +
            cr.matchPct.toFixed(2) +
            " %). " +
            "Aligned by " +
            e(cr.baseHow) +
            (cr.delta ? ", shifted by " + cr.delta + " cycle(s)" : "") +
            ".</p>" +
            (drows.length
              ? table(
                  [
                    "Simulation signal",
                    "Capture signal",
                    "Mismatch cycles",
                    "First mismatch",
                    "Status",
                  ],
                  drows,
                )
              : "<p>No signal differs.</p>") +
            (trows.length
              ? table(["Interface", "Transfers sim / capture", "Result"], trows)
              : ""),
        ),
      );
    }

    var orows = sim.signals.slice(0, MAXROWS.overview).map(function (sig) {
      var r = rd.roles[sig.id],
        rec = hl.byNet[sig.net];
      return tr([
        e(sig.name),
        e(sig.scopePath || "(root)"),
        sig.width + " bit",
        e(r.role + (r.sub ? " · " + r.sub : "")),
        e(rec ? rec.status : "healthy"),
      ]);
    });
    h.push(
      section(
        "Signal overview",
        (sim.signals.length > MAXROWS.overview
          ? note(
              "Showing the first " +
                MAXROWS.overview +
                " of " +
                sim.signals.length +
                " signals.",
            )
          : "") +
          note("Roles are guesses from names and behaviour.") +
          table(["Signal", "Scope", "Width", "Role", "Status"], orows),
      ),
    );

    var css =
      '@page{margin:16mm}body{font-family:"Times New Roman",Times,serif;color:#111;margin:0;padding:24px;font-size:12pt;line-height:1.4}' +
      "h1{font-size:22pt;margin:0 0 6px}h2{font-size:13pt;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid #999;padding-bottom:4px;margin:26px 0 10px;page-break-after:avoid}" +
      "table{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:10px}th{background:#eee;text-align:left;padding:5px 7px;border:1px solid #bbb}" +
      "td{padding:4px 7px;border:1px solid #ddd;vertical-align:top}tr{page-break-inside:avoid}" +
      ".v{display:inline-block;border:2px solid #111;padding:6px 26px;font-size:22pt;letter-spacing:6px;font-weight:bold}" +
      ".PASS{color:#087f3f;border-color:#087f3f}.FAIL{color:#b00020;border-color:#b00020}.WARNING{color:#b36b00;border-color:#b36b00}" +
      ".note{color:#555;font-size:10pt}.pb{margin:0 0 16px;padding:8px 18px;font-size:11pt;cursor:pointer}@media print{.pb{display:none}}";

    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VCDInsight report — ' +
      e(sim.fileName) +
      "</title><style>" +
      css +
      "</style></head><body>" +
      '<button class="pb" onclick="window.print()">Print / Save as PDF</button>' +
      h.join("") +
      '<p class="note" style="margin-top:30px">Generated by VCDInsight.</p></body></html>'
    );
  }

  function open() {
    var win = window.open("", "_blank");
    if (!win) return Promise.resolve(false);
    win.document.open();
    win.document.write(
      "<p style=\"font-family:'Times New Roman',serif\">Preparing the report…</p>",
    );
    win.document.close();
    return VCD.summary.ready(8000).then(function (sr) {
      win.document.open();
      win.document.write(build(sr));
      win.document.close();
      setTimeout(function () {
        try {
          win.focus();
          win.print();
        } catch (err) {
          /* the page has its own print button */
        }
      }, 500);
      return true;
    });
  }

  function download() {
    return VCD.summary.ready(8000).then(function (sr) {
      var blob = new Blob([build(sr)], { type: "text/html" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download =
        "VCDInsight-report-" +
        VCD.state.sim.fileName.replace(/[^\w.-]+/g, "_") +
        ".html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 1000);
    });
  }

  VCD.report = { open: open, download: download, build: build };
})();
