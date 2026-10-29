/* VCDInsight — roles.js (Step 2)
   Guesses what each signal does (clock, reset, valid, ready, address, data,
   state ...) from its name and its behaviour. Works for any design.
   Public: VCD.roles.detect(parsedData), VCD.roles.tokenize(name),
           VCD.roles.classify(signal)                                        */
"use strict";

(function () {
  /* words that mark the start of a "field" in a name like reqA_addr */
  var FIELD = {};
  [
    "v",
    "valid",
    "vld",
    "rdy",
    "ready",
    "ack",
    "gnt",
    "grant",
    "addr",
    "address",
    "adr",
    "idx",
    "index",
    "data",
    "wdata",
    "rdata",
    "din",
    "dout",
    "is",
    "write",
    "wr",
    "rd",
    "read",
    "owner",
    "status",
    "err",
    "error",
    "resp",
    "we",
    "re",
    "en",
    "enable",
    "last",
    "strb",
    "sel",
  ].forEach(function (w) {
    FIELD[w] = true;
  });

  var RESET_RE = /^(a|n|sys|s)?(rst|reset)(n|b|l|low)?$/;
  var DATA_RE = /^(w|r)?data$|^d(in|out)$|^dat$|^payload$|^tdata$/;
  var ADDR_RE = /^(addr|address|adr|idx|index)$/;
  var STATE_RE = /^(c|n|cur|nxt|next)?(state|fsm)$/;
  var ARB_RE = /^(rr|arb|arbiter|prio|priority|turn)$/;
  var CNT_RE = /^(cnt|count|counter|ctr)$/;
  var EN_LAST = ["en", "enable", "ce", "oe", "cke", "wen", "ren", "we", "re"];
  var STATUS_WORDS = [
    "status",
    "stat",
    "err",
    "error",
    "busy",
    "full",
    "empty",
    "overflow",
    "underflow",
    "irq",
    "intr",
    "interrupt",
    "done",
    "fault",
  ];
  var FLAG_WORDS = ["conflict", "stall", "hazard", "collision"];

  /* reqA_wdata -> [req, a, wdata]   bank0_req_rdy -> [bank, 0, req, rdy] */
  function tokenize(name) {
    return String(name)
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/([A-Za-z])(\d)/g, "$1_$2")
      .replace(/(\d)([A-Za-z])/g, "$1_$2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  /* role from the NAME only */
  function classify(sig) {
    var tk = tokenize(sig.name);
    var n = tk.length;
    var last = tk[n - 1] || "";
    var w = sig.width;
    var enLast = EN_LAST.indexOf(last) !== -1;
    var i, m;

    function has(x) {
      return tk.indexOf(x) !== -1;
    }
    function R(role, sub, reason, conf) {
      return { role: role, sub: sub || "", reason: reason, conf: conf || 0.85 };
    }
    function anyIn(list) {
      for (var k = 0; k < n; k++) if (list.indexOf(tk[k]) !== -1) return tk[k];
      return null;
    }

    if (w === 1) {
      for (i = 0; i < n; i++) {
        m = RESET_RE.exec(tk[i]);
        if (m) {
          var low =
            !!m[3] ||
            m[1] === "n" ||
            ["n", "b", "l", "low"].indexOf(tk[i + 1]) !== -1;
          var r = R(
            "reset",
            low ? "active low" : "active high",
            'name contains "' + tk[i] + '"',
            0.9,
          );
          r.activeLow = low;
          return r;
        }
      }
      if (!enLast && !has("gate")) {
        for (i = 0; i < n; i++) {
          if (tk[i] === "clock" || /clk$/.test(tk[i])) {
            return R("clock", "", 'name contains "' + tk[i] + '"', 0.9);
          }
        }
      }
      if (last === "valid" || last === "vld" || (n >= 2 && last === "v")) {
        return R("valid", "", 'name ends with "' + last + '"');
      }
      if (last === "rdy" || last === "ready")
        return R("ready", "", 'name ends with "' + last + '"');
      if (last === "ack") return R("ack", "", 'name ends with "ack"');
      if (last === "gnt" || last === "grant")
        return R("grant", "", 'name ends with "' + last + '"');
      if (last === "req" || last === "request")
        return R("request", "", 'name ends with "' + last + '"');
    }

    for (i = 0; i < n; i++) {
      if (DATA_RE.test(tk[i])) {
        var sub = "data";
        if (/^w/.test(tk[i]) || has("wr") || has("write")) sub = "write data";
        else if (/^r/.test(tk[i]) || has("rd") || has("read"))
          sub = "read data";
        else if (tk[i] === "din") sub = "data in";
        else if (tk[i] === "dout") sub = "data out";
        return R("data", sub, 'name contains "' + tk[i] + '"');
      }
    }

    for (i = 0; i < n; i++) {
      if (ADDR_RE.test(tk[i])) {
        var isIdx = tk[i] === "idx" || tk[i] === "index";
        return R(
          "address",
          isIdx ? "index" : "",
          'name contains "' + tk[i] + '"',
        );
      }
    }

    if (w === 1 && !enLast && (has("write") || has("wr")))
      return R("write", "write select", "name contains write");
    if (w === 1 && !enLast && (has("read") || has("rd")))
      return R("read", "read select", "name contains read");
    if (enLast) return R("enable", "", 'name ends with "' + last + '"');

    for (i = 0; i < n; i++) {
      m = STATE_RE.exec(tk[i]);
      if (m) {
        var nxt =
          /^(n|nxt|next)/.test(tk[i]) || last === "n" || last === "next";
        return R(
          "state",
          nxt ? "next state" : "",
          'name contains "' + tk[i] + '"',
        );
      }
    }

    var st = anyIn(STATUS_WORDS);
    if (st) return R("status", "", 'name contains "' + st + '"');
    for (i = 0; i < n; i++)
      if (ARB_RE.test(tk[i]))
        return R("arbiter", "", 'name contains "' + tk[i] + '"');
    if (has("owner")) return R("owner", "", "name contains owner");
    for (i = 0; i < n; i++)
      if (CNT_RE.test(tk[i]))
        return R("counter", "", 'name contains "' + tk[i] + '"');
    var fl = anyIn(FLAG_WORDS);
    if (fl) return R("flag", "", 'name contains "' + fl + '"');

    return R(
      "other",
      w > 1 ? "bus" : "1-bit signal",
      "no known name pattern",
      0.3,
    );
  }

  /* ───────── behaviour helpers ───────── */
  function median(arr) {
    var a = arr.slice().sort(function (x, y) {
      return x - y;
    });
    var n = a.length;
    if (!n) return 0;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  /* is a 1-bit net toggling at a regular period? (works for any duty cycle) */
  function periodicInfo(net) {
    if (net.isReal || net.width !== 1) return null;
    var t = net.t,
      v = net.v,
      n = t.length;
    if (net.toggles < 6 || n < 7) return null;
    var periods = [],
      highs = [],
      i;
    for (i = 1; i + 2 < n; i++) periods.push(t[i + 2] - t[i]);
    var med = median(periods);
    if (!(med > 0)) return null;
    var tol = Math.max(1, med * 0.02),
      ok = 0;
    for (i = 0; i < periods.length; i++)
      if (Math.abs(periods[i] - med) <= tol) ok++;
    for (i = 1; i + 1 < n; i++) if (v[i] === "1") highs.push(t[i + 1] - t[i]);
    return {
      period: med,
      regularity: ok / periods.length,
      duty: highs.length ? (median(highs) / med) * 100 : 0,
    };
  }

  /* when was reset asserted / released? */
  function resetInfo(net, activeLow) {
    var aVal = activeLow ? "0" : "1";
    var iVal = activeLow ? "1" : "0";
    var t = net.t,
      v = net.v;
    var assertedAt = null,
      releasedAt = null,
      reasserts = [];
    var prev = null,
      k,
      s;
    for (k = 0; k < t.length; k++) {
      s = v[k] === aVal ? "a" : v[k] === iVal ? "i" : "u";
      if (s === "u") continue; // X / Z: wait for the next real level
      if (s === "a" && assertedAt === null) assertedAt = t[k];
      if (prev === "a" && s === "i" && releasedAt === null) releasedAt = t[k];
      else if (prev === "i" && s === "a" && releasedAt !== null)
        reasserts.push(t[k]);
      prev = s;
    }
    return {
      assertedAt: assertedAt,
      releasedAt: releasedAt,
      reasserts: reasserts,
    };
  }

  function depth(sig) {
    return sig.scopePath ? sig.scopePath.split(".").length : 0;
  }

  /* ───────── main entry ───────── */
  function detect(data) {
    var sigs = data.signals,
      nets = data.nets,
      N = sigs.length,
      i;
    var roles = new Array(N);
    var perCache = {};

    function per(netId) {
      if (!(netId in perCache)) perCache[netId] = periodicInfo(nets[netId]);
      return perCache[netId];
    }
    function regular(id) {
      var p = per(sigs[id].net);
      return !!(p && p.regularity >= 0.9);
    }
    function toggles(id) {
      return nets[sigs[id].net].toggles;
    }

    for (i = 0; i < N; i++) {
      var c = classify(sigs[i]);
      roles[i] = {
        role: c.role,
        sub: c.sub,
        conf: c.conf,
        reason: c.reason,
        activeLow: !!c.activeLow,
      };
    }

    /* ---- clock ---- */
    var clockSigs = [];
    for (i = 0; i < N; i++) if (roles[i].role === "clock") clockSigs.push(i);

    clockSigs.forEach(function (id) {
      var r = roles[id];
      if (regular(id)) {
        r.conf = 0.97;
        r.reason = "named like a clock and toggles at a regular period";
      } else {
        r.conf = 0.6;
        r.reason =
          toggles(id) === 0
            ? "named like a clock but never toggles"
            : "named like a clock but does not toggle regularly";
      }
    });

    if (clockSigs.length === 0) {
      var best = -1;
      for (i = 0; i < N; i++) {
        if (sigs[i].width === 1 && toggles(i) >= 8 && regular(i)) {
          if (best === -1 || toggles(i) > toggles(best)) best = i;
        }
      }
      if (best !== -1) {
        for (i = 0; i < N; i++) {
          if (sigs[i].net === sigs[best].net) {
            roles[i] = {
              role: "clock",
              sub: "",
              conf: 0.7,
              reason: "no clock name found, but it toggles at a regular period",
              activeLow: false,
            };
            clockSigs.push(i);
          }
        }
      }
    }

    function betterClock(a, b) {
      var ra = regular(a) ? 1 : 0,
        rb = regular(b) ? 1 : 0;
      if (ra !== rb) return ra > rb;
      if (toggles(a) !== toggles(b)) return toggles(a) > toggles(b);
      var da = depth(sigs[a]),
        db = depth(sigs[b]);
      if (da !== db) return da < db;
      return a < b;
    }

    var clockId = -1;
    clockSigs.forEach(function (id) {
      if (clockId === -1 || betterClock(id, clockId)) clockId = id;
    });

    var clock = null;
    if (clockId !== -1) {
      var p = per(sigs[clockId].net);
      var cnet = nets[sigs[clockId].net];
      var tickPs = data.header.timescale.tickPs;
      clock = {
        signalId: clockId,
        name: sigs[clockId].fullName,
        periodic: !!(p && p.regularity >= 0.9),
        regularity: p ? p.regularity : 0,
        period: p ? p.period : 0,
        duty: p ? p.duty : 0,
        toggles: cnet.toggles,
        firstEdge: cnet.t.length > 1 ? cnet.t[1] : 0,
      };
      clock.periodPs = clock.period * tickPs;
      clock.freqHz = clock.periodPs > 0 ? 1e12 / clock.periodPs : 0;
      clock.cycles =
        clock.period > 0 ? Math.floor(data.stats.endTime / clock.period) : 0;
    }

    /* ---- reset ---- */
    var resetId = -1;
    for (i = 0; i < N; i++) {
      if (roles[i].role === "reset") {
        if (resetId === -1 || depth(sigs[i]) < depth(sigs[resetId]))
          resetId = i;
      }
    }
    var reset = null;
    var settle = 0;
    if (resetId !== -1) {
      var info = resetInfo(nets[sigs[resetId].net], roles[resetId].activeLow);
      reset = {
        signalId: resetId,
        name: sigs[resetId].fullName,
        activeLow: roles[resetId].activeLow,
        assertedAt: info.assertedAt,
        releasedAt: info.releasedAt,
        reasserts: info.reasserts,
        neverAsserted: info.assertedAt === null,
        neverReleased: info.assertedAt !== null && info.releasedAt === null,
      };
      if (reset.neverReleased) settle = data.stats.endTime + 1;
      else if (reset.releasedAt !== null) settle = reset.releasedAt;
    }

    /* ---- groups: reqA_v + reqA_rdy + reqA_addr ... belong together ---- */
    var groups = {};
    var groupOf = new Array(N);
    for (i = 0; i < N; i++) {
      groupOf[i] = null;
      var tk = tokenize(sigs[i].name);
      var k = -1,
        j;
      for (j = 0; j < tk.length; j++) {
        if (FIELD[tk[j]]) {
          k = j;
          break;
        }
      }
      if (k > 0) {
        var prefix = tk.slice(0, k).join("_");
        var key = sigs[i].scopePath + "|" + prefix;
        if (!groups[key]) {
          groups[key] = {
            key: key,
            scope: sigs[i].scopePath,
            prefix: prefix,
            valid: -1,
            ready: -1,
            ack: -1,
            members: [],
          };
        }
        groups[key].members.push(i);
        if (roles[i].role === "valid" && groups[key].valid === -1)
          groups[key].valid = i;
        if (roles[i].role === "ready" && groups[key].ready === -1)
          groups[key].ready = i;
        if (roles[i].role === "ack" && groups[key].ack === -1)
          groups[key].ack = i;
        groupOf[i] = key;
      }
    }

    return {
      roles: roles,
      clock: clock,
      reset: reset,
      groups: groups,
      groupOf: groupOf,
      settleTime: settle,
      hasReset: !!reset,
    };
  }

  VCD.roles = { detect: detect, tokenize: tokenize, classify: classify };
})();
