/* VCDInsight — health.js (Step 2)
   Reset-aware health analysis for any design:
   X / Z states, stuck signals, glitches, clock and reset findings.
   Public: VCD.health.analyze(data, rolesResult) -> { recs, byNet, findings, summary, ... }
   Pure function: it does not touch VCD.state. The caller stores the result.       */
"use strict";

(function () {
  /* roles that are always "control": an X here is a real problem after reset */
  var CONTROL = {
    valid: 1,
    ready: 1,
    ack: 1,
    grant: 1,
    request: 1,
    reset: 1,
    clock: 1,
    enable: 1,
    state: 1,
    arbiter: 1,
    counter: 1,
    flag: 1,
  };
  var SEV = { error: 0, warning: 1, info: 2 };

  /* index of the last change at or before `time` (-1 if none) */
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

  function uniq(arr) {
    var seen = {},
      out = [];
    arr.forEach(function (x) {
      if (!seen[x]) {
        seen[x] = 1;
        out.push(x);
      }
    });
    return out;
  }

  function sample(names, max) {
    var u = uniq(names);
    var head = u.slice(0, max).join(", ");
    return u.length > max ? head + " and " + (u.length - max) + " more" : head;
  }

  function analyze(data, rd) {
    var sigs = data.signals,
      nets = data.nets;
    var end = data.stats.endTime;
    var ts = data.header.timescale;
    var settle = rd.settleTime || 0;
    function fmt(t) {
      return VCD.fmtTime(t, ts);
    }

    /* nets -> the signals (names) that live on them */
    var netSigs = nets.map(function () {
      return [];
    });
    sigs.forEach(function (s) {
      netSigs[s.net].push(s.id);
    });

    var clockNetId = rd.clock ? sigs[rd.clock.signalId].net : -1;
    var clockOk = !!(rd.clock && rd.clock.periodic && rd.clock.period > 0);
    var glitchThr = clockOk ? rd.clock.period * 0.25 : 0;

    var raw = [];
    function add(sev, type, netId, time, msg, name, scope) {
      raw.push({
        severity: sev,
        type: type,
        netId: netId,
        time: time,
        message: msg,
        signal: name || "",
        scope: scope || "",
      });
    }

    function pickRole(ids) {
      var best = ids[0],
        i,
        a,
        b;
      for (i = 1; i < ids.length; i++) {
        a = rd.roles[ids[i]];
        b = rd.roles[best];
        if (b.role === "other" && a.role !== "other") best = ids[i];
        else if (a.role !== "other" && b.role !== "other" && a.conf > b.conf)
          best = ids[i];
      }
      return best;
    }

    /* valid signal that guards this net's payload (same interface group) */
    function findValid(ids, netId) {
      var i, gk, g, vn;
      for (i = 0; i < ids.length; i++) {
        gk = rd.groupOf[ids[i]];
        if (gk) {
          g = rd.groups[gk];
          if (g.valid !== -1) {
            vn = sigs[g.valid].net;
            if (vn !== netId)
              return { net: nets[vn], name: sigs[g.valid].name };
          }
        }
      }
      return null;
    }

    /* find stretches where the net holds X (or Z), and classify them */
    function scanUnknown(net, ch, vInfo) {
      var t = net.t,
        v = net.v,
        n = t.length;
      var r = {
        pre: { count: 0, first: -1 },
        idle: { count: 0, first: -1 },
        bad: { count: 0, first: -1, dur: 0 },
      };
      var k, a, b, a2;
      for (k = 0; k < n; k++) {
        if (v[k].indexOf(ch) === -1) continue;
        a = t[k];
        b = k + 1 < n ? t[k + 1] : end;

        if (settle > 0 && b <= settle) {
          // entirely before reset release
          r.pre.count++;
          if (r.pre.first < 0) r.pre.first = a;
          continue;
        }
        a2 = Math.max(a, settle);

        if (vInfo) {
          var vt = vInfo.net.t,
            vv = vInfo.net.v;
          var cuts = [a2],
            q;
          for (q = idxAt(vt, a2) + 1; q < vt.length && vt[q] < b; q++)
            cuts.push(vt[q]);
          cuts.push(b);
          var anyBad = false,
            firstBad = -1,
            dur = 0,
            c,
            s0,
            e0,
            vi,
            val;
          for (c = 0; c < cuts.length - 1; c++) {
            s0 = cuts[c];
            e0 = cuts[c + 1];
            vi = idxAt(vt, s0);
            val = vi < 0 ? "x" : vv[vi];
            if (val !== "0") {
              // valid high (or unknown) -> the payload matters
              anyBad = true;
              if (firstBad < 0) firstBad = s0;
              dur += e0 - s0;
            }
          }
          if (anyBad) {
            r.bad.count++;
            if (r.bad.first < 0) r.bad.first = firstBad;
            r.bad.dur += dur;
          } else {
            r.idle.count++;
            if (r.idle.first < 0) r.idle.first = a2;
          }
        } else {
          r.bad.count++;
          if (r.bad.first < 0) r.bad.first = a2;
          r.bad.dur += b - a2;
        }
      }
      return r;
    }

    /* very short 0-1-0 or 1-0-1 pulses (shorter than a quarter clock period) */
    function scanGlitches(net) {
      var t = net.t,
        v = net.v,
        n = t.length,
        k,
        count = 0,
        first = -1,
        cur,
        prev,
        next;
      for (k = 1; k + 1 < n; k++) {
        if (t[k] < settle) continue;
        cur = v[k];
        prev = v[k - 1];
        next = v[k + 1];
        if ((cur !== "0" && cur !== "1") || (prev !== "0" && prev !== "1"))
          continue;
        if (prev !== next || prev === cur) continue;
        if (t[k + 1] - t[k] < glitchThr) {
          count++;
          if (first < 0) first = t[k];
        }
      }
      return { count: count, first: first };
    }

    var recs = [];
    var byNet = {};
    var preList = [],
      idleList = [],
      constList = [];
    var maxToggle = 1;
    var n;

    for (n = 0; n < nets.length; n++) {
      if (netSigs[n].length && n !== clockNetId && nets[n].toggles > maxToggle)
        maxToggle = nets[n].toggles;
    }

    for (n = 0; n < nets.length; n++) {
      var ids = netSigs[n];
      if (!ids.length) continue;
      var net = nets[n];
      var prim = ids[0];
      var rid = pickRole(ids);
      var rl = rd.roles[rid];
      var role = rl.role;
      var isCtl = !!CONTROL[role];
      var vInfo = isCtl ? null : findValid(ids, n);
      var name = sigs[prim].name;
      var scope = sigs[prim].scopePath;
      var notes = [];

      var X = scanUnknown(net, "x", vInfo);
      var Z = scanUnknown(net, "z", vInfo);

      /* ---- X ---- */
      if (X.pre.count) {
        preList.push(name);
        notes.push("X before reset release (normal)");
      }
      if (X.idle.count) {
        idleList.push(name);
        notes.push("X while " + vInfo.name + " is low (idle, normal)");
      }
      if (X.bad.count) {
        var sevX = isCtl || vInfo ? "error" : "warning";
        var msgX;
        if (vInfo) {
          msgX =
            name +
            " is X while " +
            vInfo.name +
            " is high — first at " +
            fmt(X.bad.first) +
            ", for " +
            fmt(X.bad.dur) +
            ".";
        } else {
          msgX =
            name +
            (isCtl ? " (" + role + ")" : "") +
            " is X after reset release — first at " +
            fmt(X.bad.first) +
            ", for " +
            fmt(X.bad.dur) +
            ".";
        }
        add(sevX, "x_state", n, X.bad.first, msgX, name, scope);
        notes.push("X after reset at " + fmt(X.bad.first));
      }

      /* ---- Z ---- */
      if (Z.pre.count) {
        preList.push(name);
        notes.push("Z before reset release (normal)");
      }
      if (Z.idle.count) {
        idleList.push(name);
        notes.push("Z while " + vInfo.name + " is low (idle, normal)");
      }
      if (Z.bad.count) {
        var sevZ = role === "clock" || role === "reset" ? "error" : "warning";
        var msgZ =
          name +
          " is high-impedance (Z) " +
          (vInfo ? "while " + vInfo.name + " is high" : "after reset release") +
          " — first at " +
          fmt(Z.bad.first) +
          ", for " +
          fmt(Z.bad.dur) +
          ".";
        add(sevZ, "z_state", n, Z.bad.first, msgZ, name, scope);
        notes.push("Z after reset at " + fmt(Z.bad.first));
      }

      /* ---- constant (never changes) ---- */
      var constant = net.v.length > 0 && net.toggles === 0;
      var cval = constant ? net.v[0] : null;
      if (constant && cval.indexOf("x") === -1 && cval.indexOf("z") === -1) {
        if (role === "clock") {
          add(
            "error",
            "clock",
            n,
            0,
            name + " never toggles — the clock is dead.",
            name,
            scope,
          );
          notes.push("clock never toggles");
        } else if (role === "valid" && /^0+$/.test(cval)) {
          add(
            "warning",
            "stuck",
            n,
            0,
            name +
              " never goes high — no request was ever made on this interface.",
            name,
            scope,
          );
          notes.push("valid never asserted");
        } else if (
          (role === "ready" || role === "ack" || role === "grant") &&
          /^0+$/.test(cval)
        ) {
          add(
            "warning",
            "stuck",
            n,
            0,
            name + " never goes high — requests would stall forever.",
            name,
            scope,
          );
          notes.push(role + " never asserted");
        } else if (role !== "reset") {
          constList.push(name);
          notes.push(
            "constant " +
              (net.width > 1
                ? "0x" + parseInt(cval, 2).toString(16).toUpperCase()
                : cval),
          );
        }
      }

      /* ---- glitches ---- */
      var gl = { count: 0, first: -1 };
      if (
        clockOk &&
        net.width === 1 &&
        !net.isReal &&
        role !== "clock" &&
        role !== "reset" &&
        net.toggles >= 2
      ) {
        gl = scanGlitches(net);
        if (gl.count) {
          add(
            "warning",
            "glitch",
            n,
            gl.first,
            name +
              " has " +
              gl.count +
              " very short pulse(s) (under a quarter clock period) — first at " +
              fmt(gl.first) +
              ".",
            name,
            scope,
          );
          notes.push(gl.count + " glitch(es)");
        }
      }

      var rec = {
        netId: n,
        signalId: prim,
        name: name,
        fullName: sigs[prim].fullName,
        scopePath: scope,
        width: net.width,
        role: role,
        roleSub: rl.sub,
        roleConf: rl.conf,
        aliases: ids.length - 1,
        toggles: net.toggles,
        activityPct:
          net.toggles === 0
            ? 0
            : Math.min(
                100,
                Math.max(
                  3,
                  Math.round(
                    (100 * Math.log(1 + net.toggles)) / Math.log(1 + maxToggle),
                  ),
                ),
              ),
        hasX: net.hasX,
        hasZ: net.hasZ,
        firstX: net.firstX,
        firstZ: net.firstZ,
        x: X,
        z: Z,
        glitches: gl,
        constant: constant,
        constantValue: cval,
        guardedBy: vInfo ? vInfo.name : "",
        notes: notes,
        status: "healthy",
      };
      recs.push(rec);
      byNet[n] = rec;
    }

    /* ---- clock ---- */
    if (!rd.clock) {
      add(
        "info",
        "no_clock",
        -1,
        null,
        "No clock signal was detected, so cycle-based analysis is limited.",
        "",
        "",
      );
    } else if (!rd.clock.periodic && rd.clock.toggles > 0) {
      add(
        "warning",
        "clock",
        clockNetId,
        rd.clock.firstEdge,
        sigs[rd.clock.signalId].name + " does not toggle at a regular period.",
        sigs[rd.clock.signalId].name,
        sigs[rd.clock.signalId].scopePath,
      );
    }

    /* ---- reset ---- */
    if (!rd.reset) {
      add(
        "info",
        "no_reset",
        -1,
        null,
        "No reset signal was detected.",
        "",
        "",
      );
    } else {
      var rs = rd.reset;
      var rname = sigs[rs.signalId].name;
      var rscope = sigs[rs.signalId].scopePath;
      var rnet = sigs[rs.signalId].net;
      if (rs.neverAsserted) {
        add(
          "warning",
          "reset",
          rnet,
          0,
          rname +
            " is never asserted in this run — the design relies on its power-up values.",
          rname,
          rscope,
        );
      } else if (rs.neverReleased) {
        add(
          "error",
          "reset",
          rnet,
          rs.assertedAt,
          rname +
            " is asserted at " +
            fmt(rs.assertedAt) +
            " and never released — the design stays in reset.",
          rname,
          rscope,
        );
      }
      rs.reasserts.forEach(function (tt) {
        add(
          "info",
          "reset",
          rnet,
          tt,
          rname + " is asserted again at " + fmt(tt) + ".",
          rname,
          rscope,
        );
      });
    }

    /* ---- merge duplicates seen in several scopes ---- */
    var merged = [],
      index = {};
    raw.forEach(function (f) {
      var key = f.type + "|" + f.signal + "|" + f.severity + "|" + f.time;
      if (index[key] !== undefined) {
        var m = merged[index[key]];
        if (f.scope && m.scopes.indexOf(f.scope) === -1) m.scopes.push(f.scope);
        m.netIds.push(f.netId);
      } else {
        index[key] = merged.length;
        merged.push({
          severity: f.severity,
          type: f.type,
          signal: f.signal,
          time: f.time,
          message: f.message,
          scopes: f.scope ? [f.scope] : [],
          netIds: [f.netId],
        });
      }
    });
    merged.forEach(function (m) {
      if (m.scopes.length > 1)
        m.message += " (seen in " + m.scopes.length + " scopes)";
    });

    /* ---- aggregated information findings ---- */
    var pre = uniq(preList),
      idle = uniq(idleList),
      cons = uniq(constList);
    if (pre.length) {
      merged.push({
        severity: "info",
        type: "x_pre",
        signal: "",
        time: null,
        scopes: [],
        netIds: [],
        message:
          pre.length +
          " signal(s) are X or Z before reset release — normal power-up behaviour (" +
          sample(pre, 6) +
          ").",
      });
    }
    if (idle.length) {
      merged.push({
        severity: "info",
        type: "x_idle",
        signal: "",
        time: null,
        scopes: [],
        netIds: [],
        message:
          idle.length +
          " payload signal(s) are X while their valid is low — idle, never used by the design (" +
          sample(idle, 6) +
          ").",
      });
    }
    if (cons.length) {
      merged.push({
        severity: "info",
        type: "constant",
        signal: "",
        time: null,
        scopes: [],
        netIds: [],
        message:
          cons.length +
          " signal(s) never change during the run (" +
          sample(cons, 6) +
          ").",
      });
    }

    merged.sort(function (a, b) {
      if (SEV[a.severity] !== SEV[b.severity])
        return SEV[a.severity] - SEV[b.severity];
      var ta = a.time === null ? Infinity : a.time;
      var tb = b.time === null ? Infinity : b.time;
      return ta - tb;
    });

    /* ---- per-signal status ---- */
    merged.forEach(function (f) {
      f.netIds.forEach(function (id) {
        var rc = byNet[id];
        if (!rc) return;
        if (f.severity === "error") rc.status = "error";
        else if (f.severity === "warning" && rc.status !== "error")
          rc.status = "warning";
      });
    });
    recs.forEach(function (rc) {
      if (rc.status !== "healthy") return;
      if (rc.constant && rc.role !== "reset") rc.status = "inactive";
      else if (
        rc.x.pre.count ||
        rc.x.idle.count ||
        rc.z.pre.count ||
        rc.z.idle.count
      )
        rc.status = "info";
    });

    var summary = {
      errors: 0,
      warnings: 0,
      infos: 0,
      nets: recs.length,
      signals: sigs.length,
      constants: cons.length,
    };
    var firstError = null;
    merged.forEach(function (f, i) {
      f.id = i + 1;
      if (f.severity === "error") {
        summary.errors++;
        if (f.time !== null && (!firstError || f.time < firstError.time))
          firstError = f;
      } else if (f.severity === "warning") summary.warnings++;
      else summary.infos++;
    });
    summary.firstError = firstError;

    return {
      recs: recs,
      byNet: byNet,
      findings: merged,
      summary: summary,
      clock: rd.clock,
      reset: rd.reset,
    };
  }

  VCD.health = { analyze: analyze };
})();
