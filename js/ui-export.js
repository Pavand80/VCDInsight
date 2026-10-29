/* VCDInsight — ui-export.js (Step 7)
   Module 08 (Export Report) and the summary box shown inside module 07.        */
"use strict";

(function () {
  var esc = VCD.esc;

  function paras(text) {
    return String(text)
      .split(/\n{2,}/)
      .map(function (p) {
        return '<div class="ai-row"><span>' + esc(p) + "</span></div>";
      })
      .join("");
  }

  function draw(box, r) {
    if (!box.isConnected) return;
    var tag,
      extra = "";
    if (r.source === "ai") {
      tag =
        '<span class="badge badge-info">AI SUMMARY' +
        (r.model ? " · " + esc(r.model) : "") +
        (r.cached ? " · SAVED COPY" : "") +
        "</span>";
    } else {
      tag = '<span class="badge badge-inactive">AUTO SUMMARY (OFFLINE)</span>';
      if (r.pending)
        extra =
          '<div class="text-muted" style="margin-top:8px">Asking the AI for a better version…</div>';
      else if (r.reason)
        extra =
          '<div class="text-muted" style="margin-top:8px">The AI summary is unavailable (' +
          esc(r.reason) +
          "). This text was written locally from the same findings.</div>";
    }
    box.innerHTML =
      '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name" style="font-size:1rem">SUMMARY</span>' +
      tag +
      "</div>" +
      paras(r.text) +
      extra +
      '<div class="text-muted" style="margin-top:10px;font-size:0.9rem">The summary only restates the findings above. The verdict comes from the checks, never from the AI.</div>' +
      '<div style="margin-top:10px"><button class="tool-btn" type="button" data-act="regen">REGENERATE</button></div></div>';
  }

  VCD.summaryUI = {
    html: function () {
      return '<div class="panel-title" style="margin-top:26px">// SUMMARY</div><div class="panel-sub">A short written explanation of the findings</div><div id="smBox"></div>';
    },
    mount: function (el) {
      var box = el.querySelector("#smBox");
      if (!box) return;
      function render(r) {
        draw(box, r);
      }
      box.addEventListener("click", function (ev) {
        if (ev.target.closest('[data-act="regen"]'))
          VCD.summary.ensure(true, render);
      });
      VCD.summary.ensure(false, render);
    },
  };

  function exportHtml() {
    var st = VCD.state;
    if (!st.sim || !st.analysis) {
      return '<div class="panel-placeholder"><div class="p-label">// EXPORT REPORT</div><div class="p-note">No analysis data yet. Go back and analyse a file first.</div></div>';
    }
    return (
      '<div class="panel-title">// EXPORT REPORT</div>' +
      '<div class="panel-sub">One report with the verdict, summary, reasons, health, transactions, run story, rules, comparison and signal overview. Choose "Save as PDF" in the print window.</div>' +
      '<div class="viewer-toolbar"><button class="tool-btn" type="button" data-act="open">OPEN REPORT / SAVE AS PDF</button>' +
      '<button class="tool-btn" type="button" data-act="download">DOWNLOAD HTML</button></div>' +
      '<div class="text-warn" id="exMsg" style="min-height:1.4em;margin:6px 0 16px"></div>' +
      '<div class="inspector" style="margin-top:0"><div class="inspector-title">AI summary service</div>' +
      '<div class="inspector-row" id="exBackend">Not checked yet. Press the button before a review or demo. The report works with or without it.</div>' +
      '<div style="margin-top:10px"><button class="tool-btn" type="button" data-act="check">CHECK BACKEND</button></div></div>'
    );
  }

  function exportMount(el) {
    var msg = el.querySelector("#exMsg"),
      be = el.querySelector("#exBackend");
    if (!msg) return;
    el.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "open") {
        msg.textContent = "Preparing the report…";
        VCD.report
          .open()
          .then(function (ok) {
            msg.textContent = ok
              ? ""
              : "The browser blocked the pop-up. Allow pop-ups for this site, or use DOWNLOAD HTML.";
          })
          .catch(function (err) {
            msg.textContent = "The report could not be built: " + err.message;
          });
      } else if (act === "download") {
        msg.textContent = "Preparing the file…";
        VCD.report
          .download()
          .then(function () {
            msg.textContent = "";
          })
          .catch(function (err) {
            msg.textContent = "The report could not be built: " + err.message;
          });
      } else if (act === "check") {
        be.textContent = "Checking…";
        var ctl =
          typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = ctl
          ? setTimeout(function () {
              ctl.abort();
            }, 4000)
          : null;
        fetch(String(VCD.config.backend).replace(/\/+$/, "") + "/health", {
          signal: ctl ? ctl.signal : undefined,
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            if (timer) clearTimeout(timer);
            be.textContent =
              "Backend reachable. AI key " +
              (j.ai_configured
                ? "is set"
                : "is NOT set (offline summaries only)") +
              ". Models: " +
              (j.models || []).join(", ") +
              ".";
          })
          .catch(function () {
            if (timer) clearTimeout(timer);
            be.textContent =
              "Backend not reachable. Summaries will be written offline from the findings. Everything else still works.";
          });
      }
    });
  }

  VCD.renderers[8] = { html: exportHtml, mount: exportMount };
})();
