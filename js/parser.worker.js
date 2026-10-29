/* VCDInsight — parser.worker.js
   Parses any VCD file in the background so the page never freezes.
   Input : { cmd:'parse', id, file:Blob, name }
   Output: { type:'progress'|'done'|'error', id, ... }                   */
"use strict";

const MAX_BYTES = 200 * 1024 * 1024; // hard limit: 200 MB

const TICK_PS = { fs: 0.001, ps: 1, ns: 1e3, us: 1e6, ms: 1e9, s: 1e12 };

self.onmessage = async function (e) {
  const msg = e.data || {};
  if (msg.cmd !== "parse") return;
  try {
    const result = await parseVCD(msg.file, msg.name || "file.vcd", msg.id);
    const transfer = [];
    for (const n of result.nets) transfer.push(n.t.buffer);
    self.postMessage({ type: "done", id: msg.id, result }, transfer);
  } catch (err) {
    self.postMessage({
      type: "error",
      id: msg.id,
      message: err && err.message ? err.message : String(err),
    });
  }
};

function progress(id, pct, label) {
  self.postMessage({ type: "progress", id, pct, label });
}

/* ───────── value helpers ───────── */
function normScalar(ch) {
  switch (ch) {
    case "0":
    case "1":
    case "x":
    case "z":
      return ch;
    case "X":
      return "x";
    case "Z":
      return "z";
    case "l":
    case "L":
      return "0";
    case "h":
    case "H":
      return "1";
    default:
      return "x"; // u, w, - and anything unknown
  }
}

function normVec(raw, width) {
  let v = raw.toLowerCase();
  const len = v.length;
  if (len === width) return v;
  if (len > width) return v.slice(len - width);
  const first = v.charAt(0);
  const pad = first === "x" ? "x" : first === "z" ? "z" : "0";
  return pad.repeat(width - len) + v;
}

/* ───────── main parser ───────── */
async function parseVCD(file, fileName, id) {
  if (!file || !file.size) throw new Error("The file is empty.");
  if (file.size > MAX_BYTES)
    throw new Error(
      "The file is larger than 200 MB and cannot be analysed in the browser.",
    );

  progress(id, 2, "READING FILE...");
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  progress(id, 10, "READING HEADER...");
  const defIdx = text.indexOf("$enddefinitions");
  if (defIdx === -1)
    throw new Error(
      "This does not look like a VCD file ($enddefinitions was not found).",
    );
  const defEnd = text.indexOf("$end", defIdx);
  if (defEnd === -1)
    throw new Error(
      "The VCD header is corrupt (missing $end after $enddefinitions).",
    );
  const dataStart = defEnd + 4;

  /* ---- header ---- */
  const header = {
    date: "",
    version: "",
    timescale: { text: "1 ps", mag: 1, unit: "ps", tickPs: 1 },
  };
  const scopes = [
    {
      id: 0,
      name: "(root)",
      type: "root",
      parent: -1,
      path: "",
      children: [],
      signals: [],
    },
  ];
  const signals = [];
  const nets = [];
  const paramDefs = [];
  const symToNet = new Map();
  const skipSyms = new Set();
  const scopeStack = [0];
  const taskStack = [];
  let taskDepth = 0;

  const tokens = text.slice(0, defIdx).split(/\s+/).filter(Boolean);
  const nTok = tokens.length;

  for (let i = 0; i < nTok; i++) {
    const tok = tokens[i];
    if (tok.charAt(0) !== "$") continue;

    // collect arguments up to $end
    const args = [];
    let j = i + 1;
    while (j < nTok && tokens[j] !== "$end") {
      args.push(tokens[j]);
      j++;
    }
    i = j; // jump past $end

    if (tok === "$date") {
      header.date = args.join(" ");
    } else if (tok === "$version") {
      header.version = args.join(" ");
    } else if (tok === "$timescale") {
      const m = args.join("").match(/^(\d+)(fs|ps|ns|us|ms|s)$/i);
      if (m) {
        const unit = m[2].toLowerCase();
        const mag = parseInt(m[1], 10);
        header.timescale = {
          text: mag + " " + unit,
          mag,
          unit,
          tickPs: mag * TICK_PS[unit],
        };
      }
    } else if (tok === "$scope") {
      const type = (args[0] || "module").toLowerCase();
      const name = args[1] || "unnamed";
      const parent = scopeStack[scopeStack.length - 1];
      const sid = scopes.length;
      const parentPath = scopes[parent].path;
      scopes.push({
        id: sid,
        name,
        type,
        parent,
        path: parentPath ? parentPath + "." + name : name,
        children: [],
        signals: [],
      });
      scopes[parent].children.push(sid);
      scopeStack.push(sid);
      const isTask = type === "task" || type === "function";
      taskStack.push(isTask);
      if (isTask) taskDepth++;
    } else if (tok === "$upscope") {
      if (scopeStack.length > 1) {
        scopeStack.pop();
        if (taskStack.pop()) taskDepth--;
      }
    } else if (tok === "$var") {
      if (args.length < 4) continue;
      const type = args[0].toLowerCase();
      const size = parseInt(args[1], 10) || 1;
      const sym = args[2];
      let name = args[3];
      let range = args[4] && args[4].charAt(0) === "[" ? args[4] : "";
      if (!range) {
        const rm = name.match(/^(.*?)(\[\d+(?::\d+)?\])$/);
        if (rm && rm[1]) {
          name = rm[1];
          range = rm[2];
        }
      }

      if (taskDepth > 0) {
        skipSyms.add(sym);
        continue;
      } // task / function locals

      let nid = symToNet.get(sym);
      if (nid === undefined) {
        nid = nets.length;
        nets.push({
          id: nid,
          symbol: sym,
          width: size,
          isReal: type === "real" || type === "realtime",
          t: [],
          v: [],
          firstSignal: undefined,
        });
        symToNet.set(sym, nid);
      }

      const sid = scopeStack[scopeStack.length - 1];
      const scopePath = scopes[sid].path;

      if (type === "parameter") {
        paramDefs.push({ name, scopePath, net: nid, width: size });
        continue;
      }

      const first = nets[nid].firstSignal;
      const sigId = signals.length;
      signals.push({
        id: sigId,
        name,
        scopeId: sid,
        scopePath,
        fullName: scopePath ? scopePath + "." + name : name,
        width: size,
        kind: type,
        range,
        net: nid,
        aliasOf: first === undefined ? null : first,
      });
      if (first === undefined) nets[nid].firstSignal = sigId;
      scopes[sid].signals.push(sigId);
    }
  }

  if (signals.length === 0)
    throw new Error("No signals were found in the VCD header.");

  /* ---- value changes ---- */
  progress(id, 12, "READING VALUES...");
  const len = text.length;
  let pos = dataStart;
  let curTime = 0;
  let endTime = 0;
  let totalChanges = 0;
  let unknownRefs = 0;
  let dumpOffBlocks = 0;
  let tokCount = 0;

  function nextToken() {
    while (pos < len && text.charCodeAt(pos) <= 32) pos++;
    if (pos >= len) return null;
    const s = pos;
    while (pos < len && text.charCodeAt(pos) > 32) pos++;
    return text.slice(s, pos);
  }

  function skipToEnd() {
    let t;
    while ((t = nextToken()) !== null && t !== "$end") {
      /* skip */
    }
  }

  function record(sym, raw, isVector) {
    const nid = symToNet.get(sym);
    if (nid === undefined) {
      if (!skipSyms.has(sym)) unknownRefs++;
      return;
    }
    const net = nets[nid];
    let v;
    if (net.isReal) v = raw;
    else if (isVector || net.width > 1) v = normVec(raw, net.width);
    else v = normScalar(raw);

    const n = net.t.length;
    if (n > 0 && net.t[n - 1] === curTime) {
      net.v[n - 1] = v; // last value in a time step wins
    } else {
      net.t.push(curTime);
      net.v.push(v);
    }
    totalChanges++;
  }

  let tok;
  while ((tok = nextToken()) !== null) {
    if ((++tokCount & 0x3ffff) === 0) {
      progress(
        id,
        12 +
          Math.round(83 * ((pos - dataStart) / Math.max(1, len - dataStart))),
        "READING VALUES...",
      );
    }
    const c = tok.charCodeAt(0);

    if (c === 35) {
      // '#' time stamp
      const tv = Number(tok.slice(1));
      if (!isNaN(tv)) {
        curTime = tv;
        if (tv > endTime) endTime = tv;
      }
      continue;
    }
    if (c === 36) {
      // '$' command
      if (tok === "$comment") skipToEnd();
      else if (tok === "$dumpoff") {
        dumpOffBlocks++;
        skipToEnd();
      }
      continue; // $dumpvars $dumpon $dumpall $end need no action
    }
    if (c === 98 || c === 66) {
      // b / B vector
      const id2 = nextToken();
      if (id2 !== null) record(id2, tok.slice(1), true);
      continue;
    }
    if (c === 114 || c === 82) {
      // r / R real
      const id2 = nextToken();
      if (id2 !== null) record(id2, tok.slice(1), false);
      continue;
    }
    if (c === 115) {
      // s string (ignored, keep tokenizer in sync)
      nextToken();
      continue;
    }
    if (tok.length >= 2) record(tok.slice(1), tok.charAt(0), false); // scalar
  }

  /* ---- finalise ---- */
  progress(id, 96, "FINALISING...");
  let changeCount = 0;
  for (const net of nets) {
    const t = net.t,
      v = net.v;
    const nt = [],
      nv = [];
    let hasX = false,
      hasZ = false,
      firstX = -1,
      firstZ = -1;
    for (let k = 0; k < t.length; k++) {
      const val = v[k];
      if (nv.length > 0 && nv[nv.length - 1] === val) continue; // drop repeats
      nt.push(t[k]);
      nv.push(val);
      if (!net.isReal) {
        if (!hasX && val.indexOf("x") !== -1) {
          hasX = true;
          firstX = t[k];
        }
        if (!hasZ && val.indexOf("z") !== -1) {
          hasZ = true;
          firstZ = t[k];
        }
      }
    }
    net.t = Float64Array.from(nt);
    net.v = nv;
    net.toggles = nv.length > 0 ? nv.length - 1 : 0;
    net.hasX = hasX;
    net.hasZ = hasZ;
    net.firstX = firstX;
    net.firstZ = firstZ;
    changeCount += net.toggles;
    delete net.firstSignal;
  }

  const parameters = paramDefs.map((p) => {
    const n = nets[p.net];
    const last = n.v.length ? n.v[n.v.length - 1] : "";
    let value = null;
    if (last && /^[01]+$/.test(last) && last.length <= 52)
      value = parseInt(last, 2);
    return {
      name: p.name,
      scopePath: p.scopePath,
      width: p.width,
      bits: last,
      value,
    };
  });

  const warnings = [];
  if (unknownRefs > 0)
    warnings.push(
      unknownRefs +
        " value changes referred to undeclared symbols and were ignored.",
    );
  if (dumpOffBlocks > 0)
    warnings.push(
      "The file contains $dumpoff blocks; values inside them were ignored.",
    );
  if (endTime === 0)
    warnings.push(
      "No time stamps were found, so the waveform has zero length.",
    );

  progress(id, 100, "DONE");

  return {
    fileName,
    fileSize: file.size,
    header,
    scopes,
    signals,
    nets,
    parameters,
    stats: {
      endTime,
      startTime: 0,
      signalCount: signals.length,
      primarySignalCount: signals.filter((s) => s.aliasOf === null).length,
      netCount: nets.length,
      changeCount,
      scopeCount: scopes.length - 1,
    },
    warnings,
  };
}
