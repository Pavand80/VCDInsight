/* VCDInsight — main.js (Step 1: foundation)
   Page flow, upload slots, zip chooser, parser worker control,
   shared state + findings list, and the 8 module cards.             */
"use strict";

/* ════════════════ SHARED STATE (used by every later step) ════════════════ */
const VCD = {
  state: { sim: null, cmp: null, rtl: [], findings: [] },
  renderers: {}, // later steps register: VCD.renderers[n] = { html(), mount(el) }
  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  },
  addFinding: function (f) {
    const item = Object.assign(
      {
        id: VCD.state.findings.length + 1,
        severity: "info",
        type: "",
        signal: "",
        time: null,
        message: "",
        source: "",
      },
      f,
    );
    VCD.state.findings.push(item);
    return item;
  },
  fmtTime: function (ticks, ts) {
    const tickPs = ts && ts.tickPs ? ts.tickPs : 1;
    const ps = ticks * tickPs;
    let v, u;
    if (ps >= 1e9) {
      v = ps / 1e9;
      u = "ms";
    } else if (ps >= 1e6) {
      v = ps / 1e6;
      u = "µs";
    } else if (ps >= 1e3) {
      v = ps / 1e3;
      u = "ns";
    } else if (ps >= 1 || ps === 0) {
      v = ps;
      u = "ps";
    } else {
      v = ps * 1e3;
      u = "fs";
    }
    return String(Number(v.toFixed(3))) + " " + u;
  },
  fmtBytes: function (n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  },
};
window.VCD = VCD;

/* ════════════════ BACKGROUND CANVAS ════════════════ */
const canvas = document.getElementById("bgCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
resizeCanvas();

const rings = [
  {
    r: 0,
    maxR: Math.max(innerWidth, innerHeight) * 0.55,
    speed: 0.12,
    opacity: 0,
  },
  {
    r: 0,
    maxR: Math.max(innerWidth, innerHeight) * 0.38,
    speed: 0.09,
    opacity: 0,
  },
];

let pts = [];
function initPts() {
  pts = Array.from({ length: 95 }, function () {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 2.4 + 0.8,
    };
  });
}
initPts();
window.addEventListener("resize", function () {
  resizeCanvas();
  initPts();
});

function drawBg() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  rings.forEach(function (ring) {
    ring.r += ring.speed;
    ring.opacity = (1 - ring.r / ring.maxR) * 0.07;
    if (ring.r > ring.maxR) ring.r = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(80,80,100," + ring.opacity + ")";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 155) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(130,130,160," + (1 - d / 155) * 0.85 + ")";
        ctx.lineWidth = 0.5;
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  }

  pts.forEach(function (p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(170,170,200,0.9)";
    ctx.fill();
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
  });

  requestAnimationFrame(drawBg);
}
drawBg();

/* ════════════════ HEX STRIP ════════════════ */
const hexEl = document.getElementById("hexStrip");
const hexPool = "0123456789ABCDEF";
function randHex(n) {
  return Array.from({ length: n }, function () {
    return hexPool[Math.floor(Math.random() * 16)];
  }).join("");
}
function updateHex() {
  hexEl.textContent =
    "0x" +
    randHex(4) +
    " " +
    randHex(8) +
    " // SIG:" +
    randHex(3) +
    " CLK:" +
    randHex(2);
}
updateHex();
setInterval(updateHex, 2200);

/* ════════════════ TYPING ════════════════ */
function typeText(el, text, speed, onDone) {
  let i = 0;
  el.textContent = "";
  const iv = setInterval(function () {
    el.textContent += text.charAt(i++);
    if (i >= text.length) {
      clearInterval(iv);
      if (onDone) onDone();
    }
  }, speed);
}

const logoEl = document.getElementById("logoText");
const logoSub = document.getElementById("logoSub");
const cursorEl = document.querySelector(".cursor");

function typeLogo(onDone) {
  const full = "VCDInsight";
  const splitAt = 3; // "VCD" white, "Insight" blue
  let i = 0;
  const iv = setInterval(function () {
    const typed = full.slice(0, i + 1);
    const a = typed.slice(0, Math.min(typed.length, splitAt));
    const b = typed.length > splitAt ? typed.slice(splitAt) : "";
    logoEl.innerHTML =
      '<span class="sigma">' +
      a +
      "</span>" +
      (b ? '<span class="wave">' + b + "</span>" : "");
    i++;
    if (i >= full.length) {
      clearInterval(iv);
      if (onDone) onDone();
    }
  }, 80);
}

typeLogo(function () {
  cursorEl.style.display = "none";
  typeText(logoSub, "WAVEFORM ANALYSIS PLATFORM", 30, function () {
    const p1 = document.getElementById("pt1");
    const p2 = document.getElementById("pt2");
    const p3 = document.getElementById("pt3");
    p1.classList.add("typing");
    typeText(
      p1,
      "Instant Analysis — Upload a VCD and read the results in seconds.",
      20,
      function () {
        p1.classList.remove("typing");
        p2.classList.add("typing");
        typeText(
          p2,
          "Rule-Based Engine — every verdict traces back to a finding in your waveform.",
          20,
          function () {
            p2.classList.remove("typing");
            p3.classList.add("typing");
            typeText(
              p3,
              "Clear Verdict — PASS, WARNING or FAIL with reasons and exact timestamps.",
              20,
              function () {
                p3.classList.remove("typing");
              },
            );
          },
        );
      },
    );
  });
});

/* ════════════════ UPLOAD SLOTS ════════════════ */
const slots = {
  sim: {
    box: document.getElementById("slotSim"),
    icon: document.getElementById("slotSimIcon"),
    text: document.getElementById("slotSimText"),
    sub: document.getElementById("slotSimSub"),
    clear: document.getElementById("slotSimClear"),
    input: document.getElementById("fileSim"),
    defText: "Drop .vcd or .zip, or click to upload",
    defSub: "Value Change Dump from any simulator",
    file: null,
  },
  cmp: {
    box: document.getElementById("slotCmp"),
    icon: document.getElementById("slotCmpIcon"),
    text: document.getElementById("slotCmpText"),
    sub: document.getElementById("slotCmpSub"),
    clear: document.getElementById("slotCmpClear"),
    input: document.getElementById("fileCmp"),
    defText: "Drop .vcd to compare against simulation",
    defSub: "Unlocks the comparison module",
    file: null,
  },
};

const analyzeBtn = document.getElementById("analyzeBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const errorMsg = document.getElementById("errorMsg");

let busy = false;

function setSlotState(key, cls, icon, text, sub) {
  const s = slots[key];
  s.box.classList.remove("loaded", "error", "busy");
  if (cls) s.box.classList.add(cls);
  s.icon.textContent = icon;
  s.text.textContent = text;
  s.sub.textContent = sub;
  s.clear.classList.toggle("hidden", cls !== "loaded");
}

function showLoaded(key) {
  const f = slots[key].file;
  setSlotState(
    key,
    "loaded",
    "✓",
    f.name,
    VCD.fmtBytes(f.size) + (f.fromZip ? " · from zip" : ""),
  );
}

function resetSlot(key) {
  const s = slots[key];
  s.file = null;
  s.input.value = "";
  setSlotState(key, "", "↑", s.defText, s.defSub);
  updateAnalyzeBtn();
}

function flashSlotError(key, message) {
  setSlotState(key, "error", "!", message, "Try another file");
  setTimeout(function () {
    const s = slots[key];
    if (!s.box.classList.contains("error")) return;
    if (s.file) showLoaded(key);
    else setSlotState(key, "", "↑", s.defText, s.defSub);
  }, 3000);
}

function updateAnalyzeBtn() {
  analyzeBtn.disabled = !slots.sim.file || busy;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}
function clearError() {
  errorMsg.classList.add("hidden");
  errorMsg.textContent = "";
}

function setProgress(pct, label) {
  progressWrap.classList.remove("hidden");
  progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  progressText.textContent = label || "";
}
function hideProgress() {
  progressWrap.classList.add("hidden");
  progressBar.style.width = "0%";
}

function isVcdName(name) {
  return name.toLowerCase().endsWith(".vcd");
}

function makeFileObj(file, fromZip) {
  return { name: file.name, blob: file, size: file.size, fromZip: !!fromZip };
}

/* ---- slot wiring ---- */
["sim", "cmp"].forEach(function (key) {
  const s = slots[key];

  s.box.addEventListener("click", function () {
    if (busy) return;
    s.input.click();
  });
  s.clear.addEventListener("click", function (e) {
    e.stopPropagation();
    if (busy) return;
    if (key === "sim") VCD.state.rtl = [];
    resetSlot(key);
    clearError();
  });
  s.box.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (!busy) s.box.classList.add("dragover");
  });
  s.box.addEventListener("dragleave", function () {
    s.box.classList.remove("dragover");
  });
  s.box.addEventListener("drop", function (e) {
    e.preventDefault();
    s.box.classList.remove("dragover");
    if (busy) return;
    const f = e.dataTransfer.files[0];
    if (f) handleSlotFile(key, f);
  });
  s.input.addEventListener("change", function (e) {
    const f = e.target.files[0];
    if (f) handleSlotFile(key, f);
    s.input.value = ""; // lets the same file be chosen again
  });
});

function handleSlotFile(key, file) {
  clearError();
  if (!file.size) {
    flashSlotError(key, "That file is empty");
    return;
  }
  if (VCDZip.isZip(file)) {
    if (key === "cmp") {
      flashSlotError(key, "Second capture accepts a .vcd file only");
      return;
    }
    loadZipIntoSlots(file);
    return;
  }
  if (!isVcdName(file.name)) {
    flashSlotError(
      key,
      key === "sim"
        ? "Please use a .vcd or .zip file"
        : "Please use a .vcd file",
    );
    return;
  }
  if (key === "sim") VCD.state.rtl = [];
  slots[key].file = makeFileObj(file, false);
  showLoaded(key);
  updateAnalyzeBtn();
}

/* ---- zip handling ---- */
let pendingZip = null;

async function loadZipIntoSlots(file) {
  busy = true;
  updateAnalyzeBtn();
  setSlotState(
    "sim",
    "busy",
    "↻",
    "OPENING " + file.name.toUpperCase() + "...",
    "Reading the zip",
  );
  try {
    const zip = await VCDZip.load(file, function (pct, label) {
      slots.sim.sub.textContent = label;
    });
    busy = false;
    if (zip.vcds.length === 1) {
      VCD.state.rtl = zip.rtl;
      slots.sim.file = {
        name: zip.vcds[0].name,
        blob: zip.vcds[0].blob,
        size: zip.vcds[0].size,
        fromZip: true,
      };
      showLoaded("sim");
      updateAnalyzeBtn();
    } else {
      pendingZip = zip;
      openChooser(zip);
      if (slots.sim.file) showLoaded("sim");
      else resetSlot("sim");
    }
  } catch (err) {
    busy = false;
    flashSlotError("sim", err.message);
    showError(err.message);
  }
  updateAnalyzeBtn();
}

const chooserOverlay = document.getElementById("chooserOverlay");
const chooserSim = document.getElementById("chooserSim");
const chooserCmp = document.getElementById("chooserCmp");
const chooserError = document.getElementById("chooserError");

function openChooser(zip) {
  const guess = VCDZip.guessRoles(zip.vcds);
  chooserSim.innerHTML = "";
  chooserCmp.innerHTML = '<option value="-1">(none)</option>';
  zip.vcds.forEach(function (v, i) {
    const label = VCD.esc(v.name) + " (" + VCD.fmtBytes(v.size) + ")";
    chooserSim.insertAdjacentHTML(
      "beforeend",
      '<option value="' + i + '">' + label + "</option>",
    );
    chooserCmp.insertAdjacentHTML(
      "beforeend",
      '<option value="' + i + '">' + label + "</option>",
    );
  });
  chooserSim.value = String(guess.simIndex);
  chooserCmp.value = String(guess.cmpIndex);
  chooserError.classList.add("hidden");
  chooserOverlay.classList.remove("hidden");
}

function closeChooser() {
  chooserOverlay.classList.add("hidden");
  pendingZip = null;
}

document
  .getElementById("chooserCancel")
  .addEventListener("click", closeChooser);
document.getElementById("chooserOk").addEventListener("click", function () {
  if (!pendingZip) return closeChooser();
  const si = parseInt(chooserSim.value, 10);
  const ci = parseInt(chooserCmp.value, 10);
  if (ci === si) {
    chooserError.textContent =
      "Simulation and second capture must be different files.";
    chooserError.classList.remove("hidden");
    return;
  }
  const sv = pendingZip.vcds[si];
  slots.sim.file = {
    name: sv.name,
    blob: sv.blob,
    size: sv.size,
    fromZip: true,
  };
  showLoaded("sim");
  if (ci >= 0) {
    const cv = pendingZip.vcds[ci];
    slots.cmp.file = {
      name: cv.name,
      blob: cv.blob,
      size: cv.size,
      fromZip: true,
    };
    showLoaded("cmp");
  }
  VCD.state.rtl = pendingZip.rtl;
  closeChooser();
  updateAnalyzeBtn();
});

/* ════════════════ PARSER WORKER ════════════════ */
function parseFile(fileObj, onProgress) {
  return new Promise(function (resolve, reject) {
    let worker;
    try {
      worker = new Worker("js/parser.worker.js");
    } catch (err) {
      reject(
        new Error(
          "Could not start the parser. Open the page through Live Server (http://127.0.0.1:5500), not by double-clicking the file.",
        ),
      );
      return;
    }
    const jobId = Date.now() + Math.random();
    worker.onmessage = function (e) {
      const m = e.data;
      if (m.id !== jobId) return;
      if (m.type === "progress") {
        onProgress(m.pct, m.label);
      } else if (m.type === "done") {
        worker.terminate();
        resolve(m.result);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = function () {
      worker.terminate();
      reject(
        new Error(
          "The parser could not run. Make sure js/parser.worker.js exists and the page is opened through Live Server.",
        ),
      );
    };
    worker.postMessage({
      cmd: "parse",
      id: jobId,
      file: fileObj.blob,
      name: fileObj.name,
    });
  });
}

/* ════════════════ ANALYZE ════════════════ */
analyzeBtn.addEventListener("click", async function () {
  if (busy || !slots.sim.file) return;
  busy = true;
  clearError();
  updateAnalyzeBtn();
  slots.sim.box.classList.add("busy");
  slots.cmp.box.classList.add("busy");

  const hasCmp = !!slots.cmp.file;
  let stage = "simulation file";

  try {
    setProgress(1, "STARTING...");
    const sim = await parseFile(slots.sim.file, function (p, l) {
      setProgress(hasCmp ? p * 0.5 : p, "SIMULATION: " + l);
    });

    let cmp = null;
    if (hasCmp) {
      stage = "second capture";
      cmp = await parseFile(slots.cmp.file, function (p, l) {
        setProgress(50 + p * 0.5, "SECOND CAPTURE: " + l);
      });
    }

    VCD.state.sim = sim;
    VCD.state.cmp = cmp;
    VCD.state.findings = [];
    sim.warnings.forEach(function (w) {
      VCD.addFinding({
        severity: "info",
        type: "parser",
        message: "Simulation: " + w,
        source: "parser",
      });
    });
    if (cmp) {
      cmp.warnings.forEach(function (w) {
        VCD.addFinding({
          severity: "info",
          type: "parser",
          message: "Second capture: " + w,
          source: "parser",
        });
      });
    }

    stage = "signal analysis";
    setProgress(97, "ANALYSING SIGNALS...");
    const rd = VCD.roles.detect(sim);
    const hl = VCD.health.analyze(sim, rd);
    let tx;
    try {
      tx = VCD.transactions.analyze(sim, rd, hl);
    } catch (txErr) {
      console.error(txErr);
      tx = VCD.transactions.empty(txErr.message);
      VCD.addFinding({
        severity: "info",
        type: "transactions_failed",
        message: "Transaction analysis could not run: " + txErr.message,
        source: "transactions",
      });
    }
    VCD.state.analysis = { roles: rd, health: hl, tx: tx };
    hl.findings.forEach(function (f) {
      VCD.addFinding({
        severity: f.severity,
        type: f.type,
        signal: f.signal,
        time: f.time,
        message: f.message,
        source: "health",
      });
    });
    tx.findings.forEach(function (f) {
      VCD.addFinding({
        severity: f.severity,
        type: f.type,
        signal: f.signal,
        time: f.time,
        message: f.message,
        source: "transactions",
      });
    });
    if (cmp) {
      stage = "comparison";
      try {
        VCD.compare.init();
      } catch (cpErr) {
        console.error(cpErr);
        VCD.addFinding({
          severity: "info",
          type: "compare_failed",
          message: "The comparison could not run: " + cpErr.message,
          source: "compare",
        });
      }
    }
    setProgress(100, "DONE");
    setTimeout(function () {
      switchToPage2();
    }, 350);
  } catch (err) {
    hideProgress();
    showError("Could not read the " + stage + ": " + err.message);
    slots.sim.box.classList.remove("busy");
    slots.cmp.box.classList.remove("busy");
    busy = false;
    updateAnalyzeBtn();
  }
});

/* ════════════════ PAGE TRANSITIONS ════════════════ */
const overlay = document.getElementById("transOverlay");

function wipeTo(origin) {
  overlay.style.transition = "transform 0.42s cubic-bezier(0.77,0,0.18,1)";
  overlay.style.transformOrigin = origin;
  overlay.style.transform = "scaleX(1)";
}
function wipeOut(origin) {
  overlay.style.transformOrigin = origin;
  overlay.style.transform = "scaleX(0)";
}

function describeFile() {
  const s = VCD.state;
  let txt = "// " + s.sim.fileName.toUpperCase();
  if (s.cmp) txt += "  VS  " + s.cmp.fileName.toUpperCase();
  return txt;
}

function summaryLine() {
  const s = VCD.state;
  const st = s.sim.stats;
  let line =
    st.signalCount +
    " signals · " +
    st.scopeCount +
    " scopes · timescale " +
    s.sim.header.timescale.text +
    " · duration " +
    VCD.fmtTime(st.endTime, s.sim.header.timescale);
  if (s.cmp) line += " · compared with " + s.cmp.fileName;
  return line;
}

function switchToPage2() {
  wipeTo("left");
  setTimeout(function () {
    document.getElementById("page1").classList.add("hidden");
    document.getElementById("page2").classList.remove("hidden");
    document.getElementById("tbFile").textContent = describeFile();
    document.getElementById("tbStatusText").textContent = "FILE LOADED";
    document.querySelector("#p2Header .p2-subtitle").textContent =
      summaryLine();

    const cmpCard = document.querySelector('.block-item[data-block="6"]');
    cmpCard.classList.toggle("locked", !VCD.state.cmp);

    hideProgress();
    slots.sim.box.classList.remove("busy");
    slots.cmp.box.classList.remove("busy");
    busy = false;

    wipeOut("right");
    setTimeout(animateBlocks, 260);
  }, 440);
}

function resetAll() {
  VCD.state.analysis = null;
  VCD.state.rules = [];
  VCD.state.compare = null;
  VCD.state.summary = null;
  VCD.state.sim = null;
  VCD.state.cmp = null;
  VCD.state.rtl = [];
  VCD.state.findings = [];
  resetSlot("sim");
  resetSlot("cmp");
  clearError();
  hideProgress();
  closeChooser();
  busy = false;
  updateAnalyzeBtn();

  document.querySelectorAll(".block-item").forEach(function (b) {
    b.classList.remove("visible");
  });
  const panel = document.getElementById("blockPanel");
  panel.classList.add("hidden");
  panel.classList.remove("visible");
  document.getElementById("panelContent").innerHTML = "";
  document.getElementById("blocksList").style.display = "flex";
  document.getElementById("p2Header").style.display = "block";
}

function switchToPage1() {
  wipeTo("right");
  setTimeout(function () {
    document.getElementById("page2").classList.add("hidden");
    document.getElementById("page1").classList.remove("hidden");
    resetAll();
    wipeOut("left");
  }, 440);
}
document
  .getElementById("topbarBackBtn")
  .addEventListener("click", switchToPage1);

/* ════════════════ MODULE CARDS + PANELS ════════════════ */
function animateBlocks() {
  document.querySelectorAll(".block-item").forEach(function (b, i) {
    setTimeout(function () {
      b.classList.add("visible");
    }, i * 160);
  });
}

const MODULE_INFO = {
  1: {
    title: "WAVEFORM VIEWER",
    step: 3,
    note: "Interactive waveforms with zoom, cursors and the signal inspector.",
  },
  2: {
    title: "SIGNAL OVERVIEW",
    step: 2,
    note: "Every signal with its scope, width and detected role.",
  },
  3: {
    title: "SIGNAL HEALTH",
    step: 2,
    note: "Reset-aware activity, X / Z, stuck-signal and glitch analysis.",
  },
  4: {
    title: "TRANSACTIONS",
    step: 4,
    note: "Handshake detection with latency and wait cycles.",
  },
  5: {
    title: "RULES & CHECKS",
    step: 5,
    note: "Rule builder with PASS / FAIL and exact timestamps.",
  },
  6: {
    title: "SIM VS SECOND CAPTURE",
    step: 6,
    note: "Cycle-aligned comparison of two captures.",
  },
  7: {
    title: "FINAL VERDICT",
    step: 4,
    note: "Verdict with reasons and the full run story table.",
  },
  8: {
    title: "EXPORT REPORT",
    step: 7,
    note: "Formatted report with every module.",
  },
};

function loadReportHTML() {
  const s = VCD.state;
  if (!s.sim) return "";
  const cols = [{ label: "SIMULATION", d: s.sim }];
  if (s.cmp) cols.push({ label: "SECOND CAPTURE", d: s.cmp });

  const rows = [
    [
      "File",
      function (d) {
        return VCD.esc(d.fileName);
      },
    ],
    [
      "Size",
      function (d) {
        return VCD.fmtBytes(d.fileSize);
      },
    ],
    [
      "Signals",
      function (d) {
        return d.stats.signalCount;
      },
    ],
    [
      "Scopes",
      function (d) {
        return d.stats.scopeCount;
      },
    ],
    [
      "Parameters",
      function (d) {
        return d.parameters.length;
      },
    ],
    [
      "Timescale",
      function (d) {
        return VCD.esc(d.header.timescale.text);
      },
    ],
    [
      "Duration",
      function (d) {
        return VCD.fmtTime(d.stats.endTime, d.header.timescale);
      },
    ],
    [
      "Value changes",
      function (d) {
        return d.stats.changeCount;
      },
    ],
  ];

  const head =
    "<tr><th></th>" +
    cols
      .map(function (c) {
        return "<th>" + c.label + "</th>";
      })
      .join("") +
    "</tr>";
  const body = rows
    .map(function (r) {
      return (
        "<tr><td>" +
        r[0] +
        "</td>" +
        cols
          .map(function (c) {
            return "<td>" + r[1](c.d) + "</td>";
          })
          .join("") +
        "</tr>"
      );
    })
    .join("");

  const notes = s.findings
    .filter(function (f) {
      return f.type === "parser";
    })
    .map(function (f) {
      return (
        '<div class="ai-row"><span class="ai-label">NOTE</span><span class="text-warn">' +
        VCD.esc(f.message) +
        "</span></div>"
      );
    })
    .join("");

  return (
    '<div class="panel-title" style="margin-top:26px">// FILE LOADED</div>' +
    '<div class="panel-sub">What the parser read from your file(s)</div>' +
    '<div class="table-scroll"><table class="data-table"><thead>' +
    head +
    "</thead><tbody>" +
    body +
    "</tbody></table></div>" +
    (notes ? '<div style="margin-top:14px">' + notes + "</div>" : "")
  );
}

function placeholderHTML(num) {
  const m = MODULE_INFO[num];
  if (num === "6" && !VCD.state.cmp) {
    return (
      '<div class="panel-placeholder"><div class="p-label">// ' +
      m.title +
      "</div>" +
      '<div class="p-note">This module is locked. Go back to the first page and add a second capture (for example an FPGA VCD) to unlock the comparison.</div></div>'
    );
  }
  return (
    '<div class="panel-placeholder"><div class="p-label">// ' +
    m.title +
    "</div>" +
    '<div class="p-note">' +
    m.note +
    '</div><div class="p-coming">COMING IN STEP ' +
    m.step +
    "</div></div>" +
    loadReportHTML()
  );
}

document.querySelectorAll(".block-item").forEach(function (b) {
  b.addEventListener("click", function () {
    openPanel(b.dataset.block);
  });
});

function openPanel(num) {
  if (!VCD.state.sim) return;
  document.getElementById("blocksList").style.display = "none";
  document.getElementById("p2Header").style.display = "none";
  const panel = document.getElementById("blockPanel");
  const content = document.getElementById("panelContent");

  const r = VCD.renderers[num];
  content.innerHTML =
    r && typeof r.html === "function" ? r.html() : placeholderHTML(num);
  if (r && typeof r.mount === "function") r.mount(content);

  panel.classList.remove("hidden");
  document.getElementById("p2Content").scrollTop = 0;
  setTimeout(function () {
    panel.classList.add("visible");
  }, 10);
}

document.getElementById("backBtn").addEventListener("click", function () {
  const panel = document.getElementById("blockPanel");
  panel.classList.remove("visible");
  setTimeout(function () {
    panel.classList.add("hidden");
    document.getElementById("blocksList").style.display = "flex";
    document.getElementById("p2Header").style.display = "block";
  }, 380);
});

/* start state */
resetSlot("sim");
resetSlot("cmp");
