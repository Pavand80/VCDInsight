/* VCDInsight — ui-signals.js (Step 2)
   Module 02 (Signal Overview) and Module 03 (Signal Health).            */
"use strict";

(function () {
  var BADGE = {
    healthy: "badge-healthy",
    warning: "badge-warning",
    error: "badge-critical",
    info: "badge-info",
    inactive: "badge-inactive",
  };
  var LABEL = {
    healthy: "HEALTHY",
    warning: "WARNING",
    error: "ERROR",
    info: "INFO",
    inactive: "CONSTANT",
  };
  var ROLE_NAME = {
    clock: "clock",
    reset: "reset",
    valid: "valid",
    ready: "ready",
    ack: "ack",
    grant: "grant",
    request: "request",
    data: "data",
    address: "address",
    write: "write select",
    read: "read select",
    enable: "enable",
    state: "state",
    status: "status",
    arbiter: "arbiter",
    owner: "owner",
    counter: "counter",
    flag: "flag",
    other: "other",
  };

  function esc(s) {
    return VCD.esc(s);
  }
  function badge(st) {
    return '<span class="badge ' + BADGE[st] + '">' + LABEL[st] + "</span>";
  }
  function noData(title) {
    return (
      '<div class="panel-placeholder"><div class="p-label">// ' +
      title +
      '</div><div class="p-note">No analysis data yet. Go back and analyse a file first.</div></div>'
    );
  }
  function fmtFreq(hz) {
    if (!hz) return "—";
    if (hz >= 1e9) return (hz / 1e9).toFixed(3) + " GHz";
    if (hz >= 1e6) return (hz / 1e6).toFixed(3) + " MHz";
    if (hz >= 1e3) return (hz / 1e3).toFixed(3) + " kHz";
    return hz.toFixed(1) + " Hz";
  }
  function roleText(r) {
    var t = ROLE_NAME[r.role] || r.role;
    if (r.sub && r.sub !== t) t += " · " + r.sub;
    return t;
  }

  /* ═════════ MODULE 02 : SIGNAL OVERVIEW ═════════ */
  function overviewHtml() {
    var s = VCD.state,
      d = s.sim,
      a = s.analysis;
    if (!d || !a) return noData("SIGNAL OVERVIEW");
    var rd = a.roles,
      h = a.health,
      ts = d.header.timescale;

    var roleSet = {};
    rd.roles.forEach(function (r) {
      roleSet[r.role] = true;
    });
    var roleOpts =
      '<option value="">All roles</option>' +
      Object.keys(roleSet)
        .sort()
        .map(function (k) {
          return (
            '<option value="' +
            esc(k) +
            '">' +
            esc(ROLE_NAME[k] || k) +
            "</option>"
          );
        })
        .join("");

    var rows = d.signals
      .map(function (sig) {
        var r = rd.roles[sig.id];
        var rc = h.byNet[sig.net];
        var st = rc ? rc.status : "healthy";
        var alias =
          sig.aliasOf !== null
            ? '<div class="text-muted" style="font-size:0.85rem">same net as ' +
              esc(d.signals[sig.aliasOf].fullName) +
              "</div>"
            : "";
        var conf = Math.round(r.conf * 100);
        return (
          '<tr data-name="' +
          esc(sig.fullName.toLowerCase()) +
          '" data-role="' +
          esc(r.role) +
          '">' +
          "<td><b>" +
          esc(sig.name) +
          "</b>" +
          (sig.range ? " " + esc(sig.range) : "") +
          alias +
          "</td>" +
          '<td class="text-muted">' +
          esc(sig.scopePath || "(root)") +
          "</td>" +
          "<td>" +
          sig.width +
          " bit</td>" +
          "<td>" +
          esc(roleText(r)) +
          ' <span class="text-muted" style="font-size:0.8rem" title="' +
          esc(r.reason) +
          '">' +
          conf +
          "%</span></td>" +
          "<td>" +
          badge(st) +
          "</td></tr>"
        );
      })
      .join("");

    var params = d.parameters.length
      ? '<div class="panel-title" style="margin-top:26px">// PARAMETERS</div>' +
        '<div class="panel-sub">Constants declared in the design (not signals)</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Name</th><th>Scope</th><th>Value</th></tr></thead><tbody>' +
        d.parameters
          .map(function (p) {
            var val =
              p.value !== null
                ? p.value + " (0x" + p.value.toString(16).toUpperCase() + ")"
                : p.bits || "—";
            return (
              "<tr><td>" +
              esc(p.name) +
              '</td><td class="text-muted">' +
              esc(p.scopePath || "(root)") +
              "</td><td>" +
              esc(val) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>"
      : "";

    return (
      '<div class="panel-title">// SIGNAL OVERVIEW</div>' +
      '<div class="panel-sub">' +
      d.signals.length +
      " signals on " +
      d.nets.length +
      " unique nets · " +
      d.stats.scopeCount +
      " scopes · roles are guesses from names and behaviour (hover the % for the reason)</div>" +
      '<div class="viewer-toolbar">' +
      '<input class="tool-input" id="ovSearch" type="text" placeholder="Search signal or scope..." style="min-width:260px">' +
      '<select class="tool-input" id="ovRole">' +
      roleOpts +
      "</select>" +
      '<span class="text-muted" id="ovCount"></span></div>' +
      '<div class="table-scroll" style="max-height:560px;overflow-y:auto"><table class="data-table"><thead><tr>' +
      "<th>Signal</th><th>Scope</th><th>Width</th><th>Detected role</th><th>Status</th></tr></thead>" +
      '<tbody id="ovBody">' +
      rows +
      "</tbody></table></div>" +
      params
    );
  }

  function overviewMount(el) {
    var search = el.querySelector("#ovSearch");
    var role = el.querySelector("#ovRole");
    var body = el.querySelector("#ovBody");
    var count = el.querySelector("#ovCount");
    if (!search || !role || !body) return;
    function apply() {
      var q = search.value.trim().toLowerCase();
      var rv = role.value;
      var shown = 0,
        total = 0;
      Array.prototype.forEach.call(body.rows, function (tr) {
        total++;
        var ok =
          (!q || tr.getAttribute("data-name").indexOf(q) !== -1) &&
          (!rv || tr.getAttribute("data-role") === rv);
        tr.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      count.textContent = "Showing " + shown + " of " + total;
    }
    search.addEventListener("input", apply);
    role.addEventListener("change", apply);
    apply();
  }

  /* ═════════ MODULE 03 : SIGNAL HEALTH ═════════ */
  function healthHtml() {
    var s = VCD.state,
      d = s.sim,
      a = s.analysis;
    if (!d || !a) return noData("SIGNAL HEALTH");
    var h = a.health,
      rd = a.roles,
      sm = h.summary,
      ts = d.header.timescale;
    function ft(t) {
      return VCD.fmtTime(t, ts);
    }

    var head =
      '<div class="panel-title">// SIGNAL HEALTH</div>' +
      '<div class="panel-sub">Reset-aware analysis. X before reset release, and X on idle payload signals, is reported as information only.</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">' +
      '<span class="badge badge-critical">' +
      sm.errors +
      " ERRORS</span>" +
      '<span class="badge badge-warning">' +
      sm.warnings +
      " WARNINGS</span>" +
      '<span class="badge badge-info">' +
      sm.infos +
      " INFO</span></div>";

    /* clock + reset */
    var ck = rd.clock,
      rs = rd.reset;
    var clockCard = ck
      ? '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name">Clock</span>' +
        badge(ck.periodic ? "healthy" : "warning") +
        "</div>" +
        '<div class="ai-row"><span class="ai-label">SIGNAL</span><span>' +
        esc(ck.name) +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">PERIOD</span><span>' +
        (ck.periodic ? ft(ck.period) : "not regular") +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">FREQUENCY</span><span>' +
        (ck.periodic ? fmtFreq(ck.freqHz) + " (as simulated)" : "—") +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">DUTY</span><span>' +
        (ck.periodic ? ck.duty.toFixed(0) + " %" : "—") +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">CYCLES</span><span>about ' +
        ck.cycles +
        "</span></div></div>"
      : '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name">Clock</span>' +
        badge("info") +
        '</div><div class="ai-row"><span class="text-muted">No clock signal was detected.</span></div></div>';

    var resetCard;
    if (rs) {
      var rstat = rs.neverReleased
        ? "error"
        : rs.neverAsserted
          ? "warning"
          : "healthy";
      resetCard =
        '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name">Reset</span>' +
        badge(rstat) +
        "</div>" +
        '<div class="ai-row"><span class="ai-label">SIGNAL</span><span>' +
        esc(rs.name) +
        (rs.activeLow ? " (active low)" : " (active high)") +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">ASSERTED</span><span>' +
        (rs.assertedAt === null ? "never" : ft(rs.assertedAt)) +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">RELEASED</span><span>' +
        (rs.releasedAt === null ? "never" : ft(rs.releasedAt)) +
        "</span></div>" +
        '<div class="ai-row"><span class="ai-label">RE-ASSERTS</span><span>' +
        rs.reasserts.length +
        "</span></div></div>";
    } else {
      resetCard =
        '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name">Reset</span>' +
        badge("info") +
        '</div><div class="ai-row"><span class="text-muted">No reset signal was detected.</span></div></div>';
    }

    /* findings */
    var fHtml = h.findings.length
      ? h.findings
          .map(function (f) {
            var st =
              f.severity === "error"
                ? "error"
                : f.severity === "warning"
                  ? "warning"
                  : "info";
            return (
              '<div class="ai-card"><div class="ai-card-header"><span class="ai-sig-name" style="font-size:1rem">' +
              esc(f.type.replace(/_/g, " ").toUpperCase()) +
              "</span>" +
              "<span>" +
              (f.time !== null
                ? '<span class="text-muted" style="margin-right:10px">' +
                  ft(f.time) +
                  "</span>"
                : "") +
              badge(st) +
              "</span></div>" +
              '<div class="ai-row"><span>' +
              esc(f.message) +
              "</span></div></div>"
            );
          })
          .join("")
      : '<div class="ai-card"><div class="ai-row"><span class="text-muted">No findings. Nothing suspicious was detected.</span></div></div>';

    /* activity table */
    var recs = h.recs.slice().sort(function (x, y) {
      return y.toggles - x.toggles || x.name.localeCompare(y.name);
    });
    var rows = recs
      .map(function (r) {
        var note = r.notes.length ? r.notes.join("; ") : "—";
        return (
          "<tr><td><b>" +
          esc(r.name) +
          "</b>" +
          (r.width > 1
            ? ' <span class="text-muted">[' + r.width + "]</span>"
            : "") +
          '<div class="text-muted" style="font-size:0.85rem">' +
          esc(r.scopePath || "(root)") +
          "</div></td>" +
          "<td>" +
          esc(ROLE_NAME[r.role] || r.role) +
          "</td>" +
          "<td>" +
          r.toggles +
          "</td>" +
          '<td><div class="bar-wrap"><div class="bar-fill" style="width:' +
          r.activityPct +
          '%"></div></div></td>' +
          '<td class="text-muted" style="font-size:0.9rem">' +
          esc(note) +
          "</td>" +
          "<td>" +
          badge(r.status) +
          "</td></tr>"
        );
      })
      .join("");

    return (
      head +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      clockCard +
      resetCard +
      "</div>" +
      '<div class="panel-title" style="margin-top:22px">// FINDINGS</div>' +
      '<div class="panel-sub">Every item below is traceable to a value in the waveform</div>' +
      fHtml +
      '<div class="panel-title" style="margin-top:26px">// ACTIVITY</div>' +
      '<div class="panel-sub">Toggles per net (bars use a log scale so quiet signals stay visible). Shared nets are listed once.</div>' +
      '<div class="table-scroll" style="max-height:560px;overflow-y:auto"><table class="data-table"><thead><tr>' +
      "<th>Signal</th><th>Role</th><th>Toggles</th><th>Activity</th><th>Notes</th><th>Status</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>"
    );
  }

  VCD.renderers[2] = { html: overviewHtml, mount: overviewMount };
  VCD.renderers[3] = { html: healthHtml };
})();
