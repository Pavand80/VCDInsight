/* VCDInsight — transactions.js (Step 4)
   Finds handshake interfaces in any VCD (valid/ready, req/ack), samples them
   just BEFORE each clock edge (what the flip-flops see), links requests to
   responses, checks stalls / repeats / unanswered requests, runs an optional
   read-back check, and builds the Run Story rows.
   Public: VCD.transactions.analyze(sim, rolesResult, health), .empty(msg), .show(bits) */
"use strict";

(function () {
  var STALL_LIMIT = 8;
  var MAX_STORY = 4000;
  var MAX_PER_TYPE = 40;
  var REQ_W = { req: 1, request: 1, cmd: 1, command: 1 };
  var RSP_W = { rsp: 1, resp: 1, response: 1 };

  function tok(n) {
    return VCD.roles.tokenize(n);
  }

  /* walks a net's changes in time order (call with rising times only) */
  function Sampler(net) {
    this.t = net.t;
    this.v = net.v;
    this.i = -1;
  }
  Sampler.prototype.before = function (time) {
    var t = this.t;
    while (this.i + 1 < t.length && t[this.i + 1] < time) this.i++;
    return this.i < 0 ? "x" : this.v[this.i];
  };
  Sampler.prototype.at = function (time) {
    var t = this.t;
    while (this.i + 1 < t.length && t[this.i + 1] <= time) this.i++;
    return this.i < 0 ? "x" : this.v[this.i];
  };

  function hasXZ(b) {
    return b !== null && b !== undefined && /[xz]/.test(b);
  }
  function strip(b) {
    var s = b.replace(/^0+/, "");
    return s === "" ? "0" : s;
  }
  function sameBits(a, b) {
    return strip(a) === strip(b);
  }

  function show(b) {
    if (b === null || b === undefined) return "—";
    if (/^x+$/.test(b)) return "X";
    if (/^z+$/.test(b)) return "Z";
    if (b.length === 1) return b;
    var c = b.charAt(0);
    var pad = c === "x" ? "x" : c === "z" ? "z" : "0";
    var m = (4 - (b.length % 4)) % 4;
    var v = new Array(m + 1).join(pad) + b;
    var out = "",
      i,
      g;
    for (i = 0; i < v.length; i += 4) {
      g = v.substr(i, 4);
      if (/^x+$/.test(g)) out += "x";
      else if (/^z+$/.test(g)) out += "z";
      else if (/[xz]/.test(g)) out += "X";
      else out += parseInt(g, 2).toString(16).toUpperCase();
    }
    out = out.replace(/^0+(?=.)/, "");
    return "0x" + out;
  }

  function sameWave(a, b) {
    if (a === b) return true;
    if (a.t.length !== b.t.length) return false;
    for (var i = 0; i < a.t.length; i++) {
      if (a.t[i] !== b.t[i] || a.v[i] !== b.v[i]) return false;
    }
    return true;
  }

  function empty(msg) {
    return {
      mode: "none",
      edges: 0,
      interfaces: [],
      story: [],
      findings: [],
      failed: !!msg,
      error: msg || "",
      summary: {
        ifaceCount: 0,
        transfers: 0,
        writes: 0,
        reads: 0,
        answered: 0,
        unanswered: 0,
        maxWait: 0,
        sbEnabled: false,
        sbNames: [],
        sbReads: 0,
        sbCompared: 0,
        sbMismatches: 0,
        flagEvents: 0,
      },
    };
  }

  function analyze(sim, rd, health) {
    var sigs = sim.signals,
      nets = sim.nets,
      roles = rd.roles,
      ts = sim.header.timescale;
    var settle = rd.settleTime || 0,
      end = sim.stats.endTime;
    var clk = rd.clock,
      period = clk && clk.periodic && clk.period > 0 ? clk.period : 0;
    var findings = [];
    var i;

    function ft(t) {
      return VCD.fmtTime(t, ts);
    }
    function cyc(ticks) {
      return period > 0 ? Math.round((ticks / period) * 10) / 10 : null;
    }
    function plural(n, w) {
      return n + " " + w + (n === 1 ? "" : "s");
    }
    function addF(sev, type, ifc, time, msg) {
      findings.push({
        severity: sev,
        type: type,
        signal: ifc ? ifc.name : "",
        time: time,
        message: msg,
        netIds: ifc && ifc.validNet >= 0 ? [ifc.validNet] : [],
        source: "transactions",
      });
    }

    function newIface(name, scope, dir, valid, ready, kind) {
      return {
        id: -1,
        name: name,
        scope: scope,
        depth: scope ? scope.split(".").length : 0,
        dir: dir,
        kind: kind,
        valid: valid,
        ready: ready,
        validNet: sigs[valid].net,
        readyNet: ready >= 0 ? sigs[ready].net : -1,
        addr: -1,
        write: -1,
        read: -1,
        wdata: -1,
        rdata: -1,
        status: -1,
        link: -1,
        alsoIn: [],
        members: 1,
        transfers: [],
        stalls: [],
        stats: null,
      };
    }

    /* ───── 1. find interfaces ───── */
    var ifaces = [];
    var used = {};

    Object.keys(rd.groups).forEach(function (key) {
      var g = rd.groups[key];
      if (g.valid === -1) return;
      var vs = sigs[g.valid];
      var name = vs.name.replace(/[_.]?(valid|vld|v)$/i, "");
      if (!name) name = g.prefix || vs.name;
      var dir = "channel";
      tok(g.prefix).forEach(function (w) {
        if (REQ_W[w]) dir = "request";
        else if (RSP_W[w]) dir = "response";
      });
      var readyId = g.ready !== -1 ? g.ready : g.ack !== -1 ? g.ack : -1;
      var f = newIface(
        name,
        vs.scopePath,
        dir,
        g.valid,
        readyId,
        "valid/ready",
      );
      f.members = g.members.length;
      var anyData = [];
      g.members.forEach(function (id) {
        var r = roles[id],
          s = sigs[id];
        if (r.role === "address") {
          if (f.addr === -1 || s.width > sigs[f.addr].width) f.addr = id;
        } else if (r.role === "write") {
          if (f.write === -1) f.write = id;
        } else if (r.role === "read") {
          if (f.read === -1) f.read = id;
        } else if (r.role === "status") {
          if (f.status === -1) f.status = id;
        } else if (r.role === "data") {
          if (r.sub === "write data") {
            if (f.wdata === -1) f.wdata = id;
          } else if (r.sub === "read data") {
            if (f.rdata === -1) f.rdata = id;
          } else anyData.push(id);
        }
      });
      if (anyData.length) {
        if (dir === "response" && f.rdata === -1) f.rdata = anyData[0];
        else if (f.wdata === -1) f.wdata = anyData[0];
      }
      used[g.valid] = true;
      if (readyId >= 0) used[readyId] = true;
      ifaces.push(f);
    });

    /* plain req / ack pairs in the same scope */
    sim.scopes.forEach(function (sc) {
      var reqs = [],
        acks = [];
      sc.signals.forEach(function (id) {
        if (sigs[id].width !== 1 || used[id]) return;
        var r = roles[id].role;
        if (r === "request") reqs.push(id);
        else if (r === "ack" || r === "grant") acks.push(id);
      });
      reqs.forEach(function (rid) {
        var rt = tok(sigs[rid].name);
        rt.pop();
        var pre = rt.join("_");
        for (var j = 0; j < acks.length; j++) {
          var at = tok(sigs[acks[j]].name);
          at.pop();
          if (at.join("_") === pre) {
            var f = newIface(
              pre || "req/ack",
              sc.path,
              "channel",
              rid,
              acks[j],
              "req/ack",
            );
            used[rid] = true;
            used[acks[j]] = true;
            ifaces.push(f);
            break;
          }
        }
      });
    });

    /* merge copies of the same interface seen in several scopes */
    ifaces.sort(function (a, b) {
      return a.depth - b.depth || b.members - a.members || a.valid - b.valid;
    });
    var kept = [];
    ifaces.forEach(function (f) {
      var dup = null,
        k,
        j,
        readyOk;
      for (j = 0; j < kept.length; j++) {
        k = kept[j];
        if (!sameWave(nets[f.validNet], nets[k.validNet])) continue;
        if (nets[f.validNet].toggles === 0 && f.name !== k.name) continue;
        readyOk =
          f.readyNet < 0 ||
          k.readyNet < 0 ||
          sameWave(nets[f.readyNet], nets[k.readyNet]) ||
          (nets[f.readyNet].toggles === 0 && nets[k.readyNet].toggles === 0);
        if (readyOk) {
          dup = k;
          break;
        }
      }
      if (dup) {
        if (f.scope !== dup.scope && dup.alsoIn.indexOf(f.scope) === -1)
          dup.alsoIn.push(f.scope);
      } else kept.push(f);
    });
    ifaces = kept;
    ifaces.forEach(function (f, n) {
      f.id = n;
    });

    if (ifaces.length === 0) {
      var none = empty("");
      none.findings.push({
        severity: "info",
        type: "no_interfaces",
        signal: "",
        time: null,
        netIds: [],
        source: "transactions",
        message:
          "No valid/ready style interface was detected, so only signal health was checked. Transaction checks look for pairs such as x_v + x_rdy, valid + ready, or req + ack.",
      });
      return none;
    }

    /* link request <-> response (reqA <-> rspA, bank0_req <-> bank0_rsp) */
    function remainder(f) {
      return tok(f.name)
        .filter(function (w) {
          return !REQ_W[w] && !RSP_W[w];
        })
        .join("_");
    }
    var requests = ifaces.filter(function (f) {
      return f.dir === "request";
    });
    var responses = ifaces.filter(function (f) {
      return f.dir === "response";
    });
    var linked = {};
    requests.forEach(function (rq) {
      for (var j = 0; j < responses.length; j++) {
        var rs = responses[j];
        if (!linked[rs.id] && remainder(rs) === remainder(rq)) {
          rq.link = rs.id;
          rs.link = rq.id;
          linked[rs.id] = true;
          linked[rq.id] = true;
          return;
        }
      }
    });
    var freeReq = requests.filter(function (f) {
      return f.link < 0;
    });
    var freeRsp = responses.filter(function (f) {
      return f.link < 0;
    });
    if (freeReq.length === 1 && freeRsp.length === 1) {
      freeReq[0].link = freeRsp[0].id;
      freeRsp[0].link = freeReq[0].id;
    }

    /* ───── 2. sample at every clock edge ───── */
    var edges = [],
      mode = "event";
    if (clk && period > 0) {
      var cn = nets[sigs[clk.signalId].net];
      for (i = 1; i < cn.t.length; i++) {
        if (cn.v[i] === "1" && cn.v[i - 1] === "0" && cn.t[i] > settle)
          edges.push(cn.t[i]);
      }
      if (edges.length >= 2) mode = "clock";
    }
    if (mode === "event") {
      var set = {};
      edges = [];
      ifaces.forEach(function (f) {
        [f.validNet, f.readyNet].forEach(function (n) {
          if (n < 0) return;
          var t = nets[n].t,
            q;
          for (q = 0; q < t.length; q++) if (t[q] > settle) set[t[q]] = 1;
        });
      });
      edges = Object.keys(set)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        });
      findings.push({
        severity: "info",
        type: "no_clock",
        signal: "",
        time: null,
        netIds: [],
        source: "transactions",
        message:
          "No regular clock was found, so transfers were detected from signal changes. Wait cycles and cycle-based latency are not available.",
      });
    }

    function mk(id) {
      return id >= 0 ? new Sampler(nets[sigs[id].net]) : null;
    }
    function get(s, E) {
      return s ? (mode === "clock" ? s.before(E) : s.at(E)) : null;
    }

    ifaces.forEach(function (f) {
      f.s = {
        v: mk(f.valid),
        r: mk(f.ready),
        a: mk(f.addr),
        w: mk(f.write),
        rd: mk(f.read),
        wd: mk(f.wdata),
        rdt: mk(f.rdata),
        st: mk(f.status),
      };
      f.run = 0;
      f.runStart = 0;
      f.held = false;
      f.lastKey = null;
      f.prevBoth = false;
    });

    function doTransfer(f, E, wait) {
      var addr = get(f.s.a, E),
        wr = get(f.s.w, E),
        rf = get(f.s.rd, E);
      var wd = get(f.s.wd, E),
        rdt = get(f.s.rdt, E),
        st = get(f.s.st, E);
      var op =
        f.dir === "response"
          ? "RESPONSE"
          : f.dir === "channel"
            ? "TRANSFER"
            : "REQUEST";
      if (wr !== null) op = wr === "1" ? "WRITE" : wr === "0" ? "READ" : "?";
      else if (rf !== null)
        op = rf === "1" ? "READ" : rf === "0" ? "WRITE" : "?";
      var key = [addr, op, op === "WRITE" ? wd : ""].join("|");
      var repeated = !!(
        f.s.r &&
        f.lastKey !== null &&
        f.held &&
        key === f.lastKey
      );
      f.lastKey = key;
      f.held = true;
      f.transfers.push({
        time: E,
        op: op,
        addr: addr,
        wdata: wd,
        rdata: rdt,
        status: st,
        wait: wait,
        repeated: repeated,
        rsp: null,
        latTicks: null,
        latCycles: null,
        result: "OK",
        extra: "",
        note: "",
      });
    }

    for (var e = 0; e < edges.length; e++) {
      var E = edges[e];
      for (var m = 0; m < ifaces.length; m++) {
        var f = ifaces[m];
        var v = get(f.s.v, E);
        var r = f.s.r ? get(f.s.r, E) : "1";
        if (mode === "clock") {
          if (v === "1" && r === "1") {
            if (f.run > 0)
              f.stalls.push({
                start: f.runStart,
                cycles: f.run,
                resolved: true,
                dropped: false,
                open: false,
              });
            doTransfer(f, E, f.run);
            f.run = 0;
          } else if (v === "1") {
            if (f.s.r) {
              if (f.run === 0) f.runStart = E;
              f.run++;
            }
          } else {
            if (f.run > 0)
              f.stalls.push({
                start: f.runStart,
                cycles: f.run,
                resolved: false,
                dropped: true,
                open: false,
              });
            f.run = 0;
            f.held = false;
          }
        } else {
          var both = v === "1" && r === "1";
          if (both && !f.prevBoth) doTransfer(f, E, null);
          f.prevBoth = both;
        }
      }
    }
    ifaces.forEach(function (f) {
      if (f.run > 0)
        f.stalls.push({
          start: f.runStart,
          cycles: f.run,
          resolved: false,
          dropped: false,
          open: true,
        });
    });

    /* ───── 3. interface level findings ───── */
    ifaces.forEach(function (f) {
      var longOnes = f.stalls.filter(function (s) {
        return s.resolved && s.cycles > STALL_LIMIT;
      });
      if (longOnes.length) {
        var mx = Math.max.apply(
          null,
          longOnes.map(function (s) {
            return s.cycles;
          }),
        );
        addF(
          "warning",
          "stall",
          f,
          longOnes[0].start,
          f.name +
            " waited more than " +
            STALL_LIMIT +
            " cycles for ready " +
            plural(longOnes.length, "time") +
            " (longest " +
            plural(mx, "cycle") +
            ", first at " +
            ft(longOnes[0].start) +
            ").",
        );
      }
      var dropped = f.stalls.filter(function (s) {
        return s.dropped;
      });
      if (dropped.length) {
        var md = Math.max.apply(
          null,
          dropped.map(function (s) {
            return s.cycles;
          }),
        );
        addF(
          "error",
          "request_dropped",
          f,
          dropped[0].start,
          f.name +
            ": valid was dropped " +
            plural(dropped.length, "time") +
            " while waiting for ready, so the request was never accepted" +
            " (longest wait " +
            plural(md, "cycle") +
            ", first at " +
            ft(dropped[0].start) +
            ").",
        );
      }
      f.stalls
        .filter(function (s) {
          return s.open;
        })
        .forEach(function (s) {
          addF(
            s.cycles > STALL_LIMIT ? "error" : "warning",
            "stall",
            f,
            s.start,
            f.name +
              " was still waiting for ready at the end of the run (" +
              plural(s.cycles, "cycle") +
              ", since " +
              ft(s.start) +
              ").",
          );
        });
      var reps = f.transfers.filter(function (t) {
        return t.repeated;
      });
      if (reps.length) {
        addF(
          "warning",
          "repeated_request",
          f,
          reps[0].time,
          f.name +
            ": the same request was accepted again " +
            plural(reps.length, "time") +
            " because valid stayed high after it was accepted (first at " +
            ft(reps[0].time) +
            "). The data is identical, so memory is unaffected, but the testbench or design should drop valid after an accept.",
        );
      }
    });

    /* ───── 4. pair requests with responses ───── */
    var pairs = [];
    ifaces.forEach(function (f) {
      if (f.dir !== "request" || f.link < 0) return;
      var rsp = ifaces[f.link];
      var rq = f.transfers,
        rs = rsp.transfers,
        n;
      for (n = 0; n < rq.length; n++) {
        var tr = rq[n];
        var rp = n < rs.length ? rs[n] : null;
        tr.rsp = rp;
        if (rp) {
          tr.latTicks = rp.time - tr.time;
          tr.latCycles = cyc(tr.latTicks);
        }
        pairs.push({ ifId: f.id, req: tr, rsp: rp });
      }
      if (rs.length > rq.length) {
        addF(
          "warning",
          "unmatched_response",
          rsp,
          rs[rq.length].time,
          rsp.name +
            " produced " +
            plural(rs.length - rq.length, "response") +
            " with no matching request on " +
            f.name +
            " (first at " +
            ft(rs[rq.length].time) +
            ").",
        );
      }
      var un = rq.filter(function (t) {
        return !t.rsp;
      });
      if (un.length) {
        var severe = un.filter(function (t) {
          return period > 0 && end - t.time >= STALL_LIMIT * period;
        });
        if (severe.length) {
          addF(
            "error",
            "no_response",
            f,
            severe[0].time,
            plural(severe.length, "request") +
              " on " +
              f.name +
              " were accepted but never answered on " +
              rsp.name +
              " (first at " +
              ft(severe[0].time) +
              ").",
          );
        } else {
          addF(
            "warning",
            "no_response",
            f,
            un[0].time,
            f.name +
              ": a request accepted at " +
              ft(un[0].time) +
              " got no response before the end of the run.",
          );
        }
      }
    });

    /* ───── 5. optional read-back check (address + write flag + data + read data) ───── */
    var sbSet = ifaces.filter(function (f) {
      return (
        f.dir === "request" &&
        f.link >= 0 &&
        f.addr >= 0 &&
        (f.write >= 0 || f.read >= 0) &&
        f.wdata >= 0 &&
        ifaces[f.link].rdata >= 0
      );
    });
    var maxW = 0;
    sbSet.forEach(function (f) {
      if (sigs[f.addr].width > maxW) maxW = sigs[f.addr].width;
    });
    sbSet = sbSet.filter(function (f) {
      return sigs[f.addr].width === maxW;
    });
    var sbIds = {};
    sbSet.forEach(function (f) {
      sbIds[f.id] = true;
    });

    var sb = { reads: 0, writes: 0, compared: 0, mismatches: 0 };
    var cnt = { mismatch: 0, addr: 0, xdata: 0 };
    var mem = {};
    var sbPairs = pairs
      .filter(function (p) {
        return sbIds[p.ifId];
      })
      .sort(function (a, b) {
        return a.req.time - b.req.time || a.ifId - b.ifId;
      });

    function limited(kind, sev, type, ifc, time, msg) {
      cnt[kind]++;
      if (cnt[kind] <= MAX_PER_TYPE) addF(sev, type, ifc, time, msg);
    }

    sbPairs.forEach(function (p) {
      var tr = p.req,
        ifc = ifaces[p.ifId];
      if (tr.op !== "WRITE" && tr.op !== "READ") return;
      if (tr.addr === null || hasXZ(tr.addr)) {
        tr.result = "ADDR_ERROR";
        tr.extra = "address is unknown (" + show(tr.addr) + ")";
        limited(
          "addr",
          "error",
          "addr_unknown",
          ifc,
          tr.time,
          ifc.name +
            ": a transfer was accepted with an unknown address at " +
            ft(tr.time) +
            ".",
        );
        return;
      }
      var key = strip(tr.addr);
      if (tr.op === "WRITE") {
        sb.writes++;
        if (hasXZ(tr.wdata)) {
          tr.result = "X_STATE";
          tr.extra = "write data is unknown";
          mem[key] = { data: null, time: tr.time };
          limited(
            "xdata",
            "error",
            "data_unknown",
            ifc,
            tr.time,
            ifc.name +
              ": a write to address " +
              show(tr.addr) +
              " carried unknown data at " +
              ft(tr.time) +
              ".",
          );
        } else {
          mem[key] = { data: tr.wdata, time: tr.time };
        }
      } else {
        sb.reads++;
        if (!p.rsp) return;
        var rv = p.rsp.rdata;
        if (rv === null) return;
        if (hasXZ(rv)) {
          tr.result = "X_STATE";
          tr.extra = "returned unknown data";
          limited(
            "xdata",
            "error",
            "data_unknown",
            ifc,
            tr.time,
            ifc.name +
              ": the read of address " +
              show(tr.addr) +
              " returned unknown data (" +
              ft(p.rsp.time) +
              ").",
          );
          return;
        }
        var ex = mem[key];
        if (!ex) {
          if (strip(rv) !== "0") {
            tr.result = "WARN";
            tr.extra =
              "returned " +
              show(rv) +
              " but nothing was written to this address in this run";
          } else {
            tr.extra =
              "returned 0 (this address was never written in this run)";
          }
        } else if (ex.data === null) {
          tr.extra =
            "returned " + show(rv) + " (the earlier write had unknown data)";
        } else {
          sb.compared++;
          if (sameBits(ex.data, rv)) {
            tr.extra =
              "returned " + show(rv) + ", matches the write at " + ft(ex.time);
          } else {
            tr.result = "MISMATCH";
            sb.mismatches++;
            tr.extra =
              "returned " +
              show(rv) +
              " but " +
              show(ex.data) +
              " was written at " +
              ft(ex.time);
            limited(
              "mismatch",
              "error",
              "readback_mismatch",
              ifc,
              tr.time,
              ifc.name +
                ": read of address " +
                show(tr.addr) +
                " returned " +
                show(rv) +
                " but " +
                show(ex.data) +
                " was written at " +
                ft(ex.time) +
                ".",
            );
          }
        }
      }
    });
    ["mismatch", "addr", "xdata"].forEach(function (k) {
      if (cnt[k] > MAX_PER_TYPE) {
        findings.push({
          severity: "error",
          type:
            k === "mismatch"
              ? "readback_mismatch"
              : k === "addr"
                ? "addr_unknown"
                : "data_unknown",
          signal: "",
          time: null,
          netIds: [],
          source: "transactions",
          message:
            "…and " +
            (cnt[k] - MAX_PER_TYPE) +
            " more of the same kind (only the first " +
            MAX_PER_TYPE +
            " are listed).",
        });
      }
    });

    /* result + note for every transfer */
    ifaces.forEach(function (f) {
      f.transfers.forEach(function (tr) {
        if (f.dir === "request" && f.link >= 0) {
          if (!tr.rsp && tr.result === "OK") tr.result = "NO_RESPONSE";
          if (
            tr.op === "READ" &&
            tr.rsp &&
            tr.rsp.rdata !== null &&
            !sbIds[f.id] &&
            !tr.extra
          ) {
            tr.extra = "returned " + show(tr.rsp.rdata);
          }
        }
        if (tr.repeated && tr.result === "OK") tr.result = "WARN";
        var p = [];
        if (tr.extra) p.push(tr.extra);
        if (tr.wait > 0)
          p.push("waited " + plural(tr.wait, "cycle") + " for ready");
        if (tr.rsp)
          p.push(
            tr.latCycles !== null
              ? "response " + plural(tr.latCycles, "cycle") + " after accept"
              : "response at " + ft(tr.rsp.time),
          );
        if (tr.repeated)
          p.push(
            "valid was not dropped after the previous accept, so the same request was accepted again",
          );
        tr.note = p.join(" · ");
      });
    });

    /* per-interface statistics */
    ifaces.forEach(function (f) {
      var st = {
        transfers: f.transfers.length,
        waitSum: 0,
        waitN: 0,
        waitMax: 0,
        repeats: 0,
        latSum: 0,
        latN: 0,
        latMax: 0,
        unanswered: 0,
      };
      f.transfers.forEach(function (tr) {
        if (tr.wait !== null) {
          st.waitSum += tr.wait;
          st.waitN++;
          if (tr.wait > st.waitMax) st.waitMax = tr.wait;
        }
        if (tr.repeated) st.repeats++;
        if (f.dir === "request" && f.link >= 0) {
          if (!tr.rsp) st.unanswered++;
          else if (tr.latCycles !== null) {
            st.latSum += tr.latCycles;
            st.latN++;
            if (tr.latCycles > st.latMax) st.latMax = tr.latCycles;
          }
        }
      });
      f.stats = st;
    });

    /* ───── 6. Run Story rows ───── */
    var storyIfaces = sbSet.length
      ? sbSet
      : ifaces.filter(function (f) {
          return f.dir === "request" && f.link >= 0;
        });
    if (storyIfaces.length === 0) storyIfaces = ifaces.slice();

    var rows = [],
      seq = 0;
    function addRow(time, what, result, note, kind) {
      if (rows.length < MAX_STORY)
        rows.push({
          time: time,
          what: what,
          result: result,
          note: note || "",
          kind: kind,
          seq: seq++,
        });
    }
    function describe(f, tr) {
      if (tr.op === "WRITE")
        return (
          f.name +
          " wrote " +
          show(tr.wdata) +
          (tr.addr !== null ? " to address " + show(tr.addr) : "")
        );
      if (tr.op === "READ")
        return (
          f.name +
          " read" +
          (tr.addr !== null ? " address " + show(tr.addr) : "")
        );
      var t = f.name + (f.dir === "response" ? " response" : " transfer");
      if (f.dir === "response" && tr.rdata !== null)
        t += " carrying " + show(tr.rdata);
      else if (tr.wdata !== null) t += " carrying " + show(tr.wdata);
      return t;
    }

    storyIfaces.forEach(function (f) {
      f.transfers.forEach(function (tr) {
        addRow(tr.time, describe(f, tr), tr.result, tr.note, "txn");
      });
    });

    var storyTransfers = [];
    storyIfaces.forEach(function (f) {
      f.transfers.forEach(function (tr) {
        storyTransfers.push({ f: f, tr: tr });
      });
    });
    storyTransfers.sort(function (a, b) {
      return a.tr.time - b.tr.time;
    });

    var seenNet = {},
      flagEvents = 0,
      flagRows = 0,
      arbRows = 0;
    sigs.forEach(function (s) {
      var role = roles[s.id].role;
      if (role !== "flag" && role !== "arbiter") return;
      if (seenNet[s.net]) return;
      seenNet[s.net] = true;
      var net = nets[s.net],
        n = net.t.length,
        q;
      if (role === "flag" && net.width === 1) {
        for (q = 1; q < n && flagRows < 150; q++) {
          if (net.v[q] === "1" && net.v[q - 1] === "0" && net.t[q] > settle) {
            var start = net.t[q],
              stop = q + 1 < n ? net.t[q + 1] : end;
            var cy = cyc(stop - start);
            var note =
              cy !== null
                ? "lasted " + plural(cy, "cycle")
                : "lasted " + ft(stop - start);
            var lim = stop + (period || 0),
              first = null,
              z;
            for (z = 0; z < storyTransfers.length; z++) {
              if (
                storyTransfers[z].tr.time >= start &&
                storyTransfers[z].tr.time <= lim
              ) {
                first = storyTransfers[z];
                break;
              }
              if (storyTransfers[z].tr.time > lim) break;
            }
            if (first)
              note +=
                " · first accepted: " +
                first.f.name +
                " at " +
                ft(first.tr.time);
            addRow(start, s.name + " asserted", "INFO", note, "event");
            flagEvents++;
            flagRows++;
          }
        }
      } else if (role === "arbiter") {
        for (q = 1; q < n && arbRows < 150; q++) {
          if (net.t[q] <= settle || hasXZ(net.v[q]) || hasXZ(net.v[q - 1]))
            continue;
          addRow(
            net.t[q],
            s.name + " changed " + show(net.v[q - 1]) + " → " + show(net.v[q]),
            "INFO",
            "arbitration pointer: priority moves to the other requester",
            "event",
          );
          arbRows++;
        }
      }
    });

    findings.forEach(function (fd) {
      if (
        fd.time !== null &&
        (fd.severity === "error" || fd.severity === "warning")
      ) {
        addRow(
          fd.time,
          fd.message,
          fd.severity === "error" ? "ERROR" : "WARN",
          fd.type.replace(/_/g, " "),
          "problem",
        );
      }
    });
    (health && health.findings ? health.findings : []).forEach(function (fd) {
      if (
        fd.time !== null &&
        (fd.severity === "error" || fd.severity === "warning")
      ) {
        addRow(
          fd.time,
          fd.message,
          fd.severity === "error" ? "ERROR" : "WARN",
          fd.type.replace(/_/g, " "),
          "problem",
        );
      }
    });
    rows.sort(function (a, b) {
      return a.time - b.time || a.seq - b.seq;
    });

    /* ───── 7. summary ───── */
    var sum = {
      ifaceCount: ifaces.length,
      transfers: 0,
      writes: 0,
      reads: 0,
      answered: 0,
      unanswered: 0,
      maxWait: 0,
      sbEnabled: sbSet.length > 0,
      sbNames: sbSet.map(function (f) {
        return f.name;
      }),
      sbReads: sb.reads,
      sbCompared: sb.compared,
      sbMismatches: sb.mismatches,
      flagEvents: flagEvents,
    };
    ifaces.forEach(function (f) {
      sum.transfers += f.transfers.length;
    });
    storyIfaces.forEach(function (f) {
      f.transfers.forEach(function (tr) {
        if (tr.op === "WRITE") sum.writes++;
        else if (tr.op === "READ") sum.reads++;
        if (f.dir === "request" && f.link >= 0) {
          if (tr.rsp) sum.answered++;
          else sum.unanswered++;
        }
        if (tr.wait !== null && tr.wait > sum.maxWait) sum.maxWait = tr.wait;
      });
    });

    ifaces.forEach(function (f) {
      delete f.s;
      delete f.run;
      delete f.runStart;
      delete f.held;
      delete f.lastKey;
      delete f.prevBoth;
    });

    return {
      mode: mode,
      edges: edges.length,
      interfaces: ifaces,
      story: rows,
      findings: findings,
      summary: sum,
      failed: false,
      error: "",
    };
  }

  VCD.transactions = { analyze: analyze, empty: empty, show: show };
})();
