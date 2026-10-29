/* VCDInsight — ui-rules.js (Step 5)
   Module 05: Rules & Checks (rule builder, results, save / load).          */
"use strict";

(function () {
  var esc = VCD.esc;
  var draft = { sim: null, type: "never_x", f: {} };
  var BADGE = {
    pass: "badge-pass",
    fail: "badge-fail",
    skip: "badge-warning",
    off: "badge-inactive",
  };
  var LABEL = { pass: "PASS", fail: "FAIL", skip: "SKIPPED", off: "OFF" };

  function noData() {
    return '<div class="panel-placeholder"><div class="p-label">// RULES &amp; CHECKS</div><div class="p-note">No analysis data yet. Go back and analyse a file first.</div></div>';
  }

  function sigOptions(sim, bitOnly, optional, selected) {
    var h = optional
      ? '<option value="">(none)</option>'
      : '<option value="">— choose —</option>';
    sim.scopes.forEach(function (sc) {
      var opts = sc.signals
        .filter(function (id) {
          return !bitOnly || sim.signals[id].width === 1;
        })
        .map(function (id) {
          var s = sim.signals[id];
          return (
            '<option value="' +
            esc(s.fullName) +
            '"' +
            (s.fullName === selected ? " selected" : "") +
            ">" +
            esc(s.name + (s.width > 1 ? " [" + (s.width - 1) + ":0]" : "")) +
            "</option>"
          );
        });
      if (opts.length)
        h +=
          '<optgroup label="' +
          esc(sc.path || "(root)") +
          '">' +
          opts.join("") +
          "</optgroup>";
    });
    return h;
  }

  function fieldsHtml(sim, type, vals) {
    var T = VCD.rules.TYPES[type];
    return T.fields
      .map(function (fd) {
        var val = vals[fd.k] === undefined ? "" : vals[fd.k],
          ctl;
        if (
          fd.kind === "sig" ||
          fd.kind === "bit" ||
          fd.kind === "sigopt" ||
          fd.kind === "bitopt"
        ) {
          ctl =
            '<select class="tool-input" data-field="' +
            fd.k +
            '">' +
            sigOptions(
              sim,
              fd.kind.indexOf("bit") === 0,
              fd.kind.slice(-3) === "opt",
              val,
            ) +
            "</select>";
        } else if (fd.kind === "choice") {
          ctl =
            '<select class="tool-input" data-field="' +
            fd.k +
            '">' +
            fd.opts
              .map(function (o) {
                return (
                  '<option value="' +
                  o.v +
                  '"' +
                  (o.v === val ? " selected" : "") +
                  ">" +
                  esc(o.l) +
                  "</option>"
                );
              })
              .join("") +
            "</select>";
        } else {
          ctl =
            '<input class="tool-input" type="text" data-field="' +
            fd.k +
            '" value="' +
            esc(val) +
            '">';
        }
        return (
          '<div class="chooser-row" style="margin:0"><label class="chooser-label">' +
          esc(fd.l.toUpperCase()) +
          "</label>" +
          ctl +
          "</div>"
        );
      })
      .join("");
  }

  function summaryHtml() {
    var rs = VCD.rules.list();
    var on = rs.filter(function (r) {
      return r.enabled && r.result;
    });
    var p = on.filter(function (r) {
      return r.result.status === "pass";
    }).length;
    var f = on.filter(function (r) {
      return r.result.status === "fail";
    }).length;
    var s = on.filter(function (r) {
      return r.result.status === "skip";
    }).length;
    return (
      '<span class="badge badge-info">' +
      rs.length +
      " RULES</span> " +
      '<span class="badge badge-pass">' +
      p +
      " PASSED</span> " +
      '<span class="badge badge-fail">' +
      f +
      " FAILED</span> " +
      '<span class="badge badge-warning">' +
      s +
      " SKIPPED</span>"
    );
  }

  function listHtml() {
    var sim = VCD.state.sim,
      ts = sim.header.timescale;
    var rs = VCD.rules.list();
    if (!rs.length) {
      return '<div class="ai-card"><div class="ai-row"><span class="text-muted">No rules yet. Press SUGGEST RULES for starting points from the detected interfaces, add one with the builder above, or load a saved rules file.</span></div></div>';
    }
    return rs
      .map(function (r) {
        var res = r.result || {
          status: "off",
          message: "Not run yet.",
          violations: [],
          fails: 0,
        };
        var st = r.enabled ? res.status : "off";
        var viols = "";
        if (res.violations && res.violations.length) {
          viols =
            '<details style="margin:8px 0 4px"><summary class="text-warn" style="cursor:pointer">' +
            res.fails +
            " violation" +
            (res.fails === 1 ? "" : "s") +
            (res.fails > res.violations.length
              ? " (showing the first " + res.violations.length + ")"
              : "") +
            "</summary>" +
            res.violations
              .map(function (v) {
                return (
                  '<div class="ai-row" style="margin:6px 0"><button class="link-btn" type="button" data-act="jump" data-t="' +
                  v.time +
                  '">' +
                  esc(VCD.fmtTime(v.time, ts)) +
                  "</button><span>" +
                  esc(v.text) +
                  "</span></div>"
                );
              })
              .join("") +
            "</details>";
        }
        return (
          '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name" style="font-size:1rem">' +
          esc(VCD.rules.TYPES[r.type].label.toUpperCase()) +
          '</span><span class="badge ' +
          BADGE[st] +
          '">' +
          LABEL[st] +
          "</span></div>" +
          '<div class="ai-row"><span>' +
          esc(VCD.rules.describe(r)) +
          "</span></div>" +
          '<div class="ai-row"><span class="' +
          (st === "fail" ? "text-warn" : "text-muted") +
          '">' +
          esc(res.message) +
          "</span></div>" +
          viols +
          '<div style="margin-top:10px;display:flex;gap:8px"><button class="tool-btn" type="button" data-act="toggle" data-id="' +
          r.id +
          '">' +
          (r.enabled ? "TURN OFF" : "TURN ON") +
          '</button><button class="tool-btn" type="button" data-act="del" data-id="' +
          r.id +
          '">DELETE</button></div></div>'
        );
      })
      .join("");
  }

  function html() {
    var st = VCD.state;
    if (!st.sim || !st.analysis) return noData();
    var T = VCD.rules.TYPES;
    if (draft.sim !== st.sim) {
      draft.sim = st.sim;
      draft.type = "never_x";
      draft.f = Object.assign({}, T.never_x.defaults);
    }
    var typeOpts = Object.keys(T)
      .map(function (k) {
        return (
          '<option value="' +
          k +
          '"' +
          (k === draft.type ? " selected" : "") +
          ">" +
          esc(T[k].label) +
          "</option>"
        );
      })
      .join("");

    return (
      '<div class="panel-title">// RULES &amp; CHECKS</div>' +
      '<div class="panel-sub">Define what correct behaviour looks like. Each rule is checked on the waveform after reset release and gives PASS or FAIL with exact times. Failed rules feed the Final Verdict.</div>' +
      '<div class="viewer-toolbar" id="rlBar">' +
      '<button class="tool-btn" type="button" data-act="suggest">SUGGEST RULES</button>' +
      '<button class="tool-btn" type="button" data-act="rerun">RE-RUN ALL</button>' +
      '<button class="tool-btn" type="button" data-act="save">SAVE RULES (JSON)</button>' +
      '<button class="tool-btn" type="button" data-act="load">LOAD RULES (JSON)</button>' +
      '<button class="tool-btn" type="button" data-act="clear">CLEAR ALL</button>' +
      '<input type="file" id="rlFile" accept=".json,application/json" hidden></div>' +
      '<div class="text-warn" id="rlMsg" style="min-height:1.4em;margin-bottom:10px"></div>' +
      '<div class="inspector" style="margin-top:0"><div class="inspector-title">Add a rule</div>' +
      '<div class="viewer-toolbar" style="margin-bottom:4px"><select class="tool-input" id="rlType">' +
      typeOpts +
      "</select></div>" +
      '<div class="text-muted" id="rlHint" style="margin-bottom:10px">' +
      esc(T[draft.type].hint) +
      "</div>" +
      '<div id="rlFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">' +
      fieldsHtml(st.sim, draft.type, draft.f) +
      "</div>" +
      '<div style="margin-top:14px"><button class="tool-btn" type="button" data-act="add">ADD RULE</button></div></div>' +
      '<div class="panel-title" style="margin-top:26px">// YOUR RULES</div>' +
      '<div style="margin-bottom:14px" id="rlSummary">' +
      summaryHtml() +
      "</div>" +
      '<div id="rlList">' +
      listHtml() +
      "</div>"
    );
  }

  function mount(el) {
    var sim = VCD.state.sim;
    if (!sim || !VCD.state.analysis) return;
    var T = VCD.rules.TYPES;
    var typeSel = el.querySelector("#rlType"),
      fieldsEl = el.querySelector("#rlFields"),
      hintEl = el.querySelector("#rlHint");
    var msgEl = el.querySelector("#rlMsg"),
      fileEl = el.querySelector("#rlFile");

    function say(t) {
      msgEl.textContent = t || "";
    }
    function refresh() {
      el.querySelector("#rlSummary").innerHTML = summaryHtml();
      el.querySelector("#rlList").innerHTML = listHtml();
    }
    function readForm() {
      var f = {};
      Array.prototype.forEach.call(
        fieldsEl.querySelectorAll("[data-field]"),
        function (c) {
          f[c.getAttribute("data-field")] = c.value;
        },
      );
      return f;
    }

    typeSel.addEventListener("change", function () {
      draft.type = typeSel.value;
      draft.f = Object.assign({}, T[draft.type].defaults);
      fieldsEl.innerHTML = fieldsHtml(sim, draft.type, draft.f);
      hintEl.textContent = T[draft.type].hint;
      say("");
    });

    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act"),
        id = Number(b.getAttribute("data-id"));
      if (act === "add") {
        var err = VCD.rules.add(draft.type, readForm());
        if (err) {
          say(err);
          return;
        }
        say("Rule added and checked.");
        refresh();
      } else if (act === "suggest") {
        var n = VCD.rules.addSuggested();
        say(
          n
            ? "Added " +
                n +
                " suggested rule(s). They are generic starting points from the detected interfaces; review them and delete any that do not apply to your design."
            : "Nothing new to suggest (no interface was detected, or all suggestions are already in the list).",
        );
        refresh();
      } else if (act === "rerun") {
        VCD.rules.runAll();
        say("All rules were checked again.");
        refresh();
      } else if (act === "save") {
        if (!VCD.rules.list().length) {
          say("There are no rules to save.");
          return;
        }
        var blob = new Blob([VCD.rules.exportJSON()], {
          type: "application/json",
        });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vcdinsight-rules.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 1000);
        say("Rules saved.");
      } else if (act === "load") {
        fileEl.click();
      } else if (act === "clear") {
        if (!VCD.rules.list().length) return;
        if (!window.confirm("Remove all rules?")) return;
        VCD.rules.clear();
        say("All rules removed.");
        refresh();
      } else if (act === "toggle") {
        VCD.rules.toggle(id);
        refresh();
      } else if (act === "del") {
        VCD.rules.remove(id);
        refresh();
      } else if (act === "jump") {
        VCD.viewerJump = Number(b.getAttribute("data-t"));
        window.openPanel("1");
      }
    });

    fileEl.addEventListener("change", function () {
      var f = fileEl.files[0];
      fileEl.value = "";
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = VCD.rules.importJSON(String(rd.result));
        say(
          "Loaded " +
            r.added +
            " rule(s)." +
            (r.rejected.length
              ? " Skipped: " + r.rejected.slice(0, 3).join(" ")
              : ""),
        );
        refresh();
      };
      rd.onerror = function () {
        say("The file could not be read.");
      };
      rd.readAsText(f);
    });
  }

  VCD.renderers[5] = { html: html, mount: mount };
})();
