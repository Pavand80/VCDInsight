/* VCDInsight — zipload.js
   Opens a .zip in the browser and picks out the useful files.
   Public API (global VCDZip):
     VCDZip.isZip(file)                 -> true / false
     VCDZip.load(file, onProgress)      -> Promise<{ vcds, rtl, skipped, total }>
     VCDZip.guessRoles(vcds)            -> { simIndex, cmpIndex }              */
"use strict";

(function () {
  const MAX_ENTRIES = 5000; // refuse zips with absurd file counts
  const MAX_VCD_BYTES = 200 * 1024 * 1024; // same limit as the parser
  const MAX_RTL_BYTES = 1024 * 1024; // 1 MB per source file
  const MAX_RTL_FILES = 40;

  // folders and files that simulators leave behind, never useful
  const JUNK_FOLDERS = [
    "__macosx",
    "work",
    ".aldec",
    "accellera_ovl_vhdl_lib",
    "xcelium.d",
    "csrc",
    "simv.daidir",
    "obj_dir",
    "transcript",
  ];
  const RTL_EXT = [".sv", ".v", ".vhd", ".vhdl", ".svh", ".vh"];

  function lowerExt(name) {
    const i = name.lastIndexOf(".");
    return i === -1 ? "" : name.slice(i).toLowerCase();
  }

  function baseName(path) {
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  function isJunk(path) {
    const parts = path.toLowerCase().split("/");
    const base = parts[parts.length - 1];
    if (base.charAt(0) === ".") return true; // hidden files such as .bashrc
    for (let i = 0; i < parts.length - 1; i++) {
      if (JUNK_FOLDERS.indexOf(parts[i]) !== -1) return true;
    }
    return false;
  }

  function isZip(file) {
    if (!file || !file.name) return false;
    return file.name.toLowerCase().endsWith(".zip");
  }

  async function load(file, onProgress) {
    if (typeof JSZip === "undefined") {
      throw new Error(
        "The zip library did not load. Check that lib/jszip.min.js exists.",
      );
    }
    if (!file || !file.size) throw new Error("The zip file is empty.");

    const report = (pct, label) => {
      if (onProgress) onProgress(pct, label);
    };

    report(5, "OPENING ZIP...");
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err).toLowerCase();
      if (msg.indexOf("encrypt") !== -1 || msg.indexOf("password") !== -1) {
        throw new Error(
          "This zip is password protected. Remove the password and try again.",
        );
      }
      throw new Error("The zip file is corrupt or not a valid zip.");
    }

    const entries = [];
    zip.forEach(function (path, entry) {
      if (!entry.dir) entries.push({ path: path, entry: entry });
    });

    if (entries.length === 0)
      throw new Error("The zip file contains no files.");
    if (entries.length > MAX_ENTRIES) {
      throw new Error(
        "The zip contains " +
          entries.length +
          " files, which is too many. Zip only the VCD file(s).",
      );
    }

    const vcdEntries = [];
    const rtlEntries = [];
    let skipped = 0;

    for (const item of entries) {
      if (isJunk(item.path)) {
        skipped++;
        continue;
      }
      const ext = lowerExt(item.path);
      if (ext === ".vcd") vcdEntries.push(item);
      else if (RTL_EXT.indexOf(ext) !== -1) rtlEntries.push(item);
      else skipped++;
    }

    if (vcdEntries.length === 0) {
      throw new Error("No .vcd file was found inside the zip.");
    }

    // read the VCD files
    const vcds = [];
    for (let i = 0; i < vcdEntries.length; i++) {
      const item = vcdEntries[i];
      report(
        10 + Math.round((70 * i) / vcdEntries.length),
        "EXTRACTING " + baseName(item.path).toUpperCase() + "...",
      );
      let blob;
      try {
        blob = await item.entry.async("blob");
      } catch (err) {
        throw new Error(
          "Could not extract " + baseName(item.path) + " from the zip.",
        );
      }
      if (blob.size === 0) {
        skipped++;
        continue;
      }
      if (blob.size > MAX_VCD_BYTES) {
        throw new Error(
          baseName(item.path) +
            " is larger than 200 MB and cannot be analysed in the browser.",
        );
      }
      vcds.push({
        name: baseName(item.path),
        path: item.path,
        size: blob.size,
        blob: blob,
      });
    }

    if (vcds.length === 0)
      throw new Error("The VCD files inside the zip are empty.");

    // read the RTL sources as text (optional, used later for better descriptions)
    const rtl = [];
    const rtlList = rtlEntries.slice(0, MAX_RTL_FILES);
    for (let i = 0; i < rtlList.length; i++) {
      const item = rtlList[i];
      report(
        80 + Math.round((15 * i) / Math.max(1, rtlList.length)),
        "READING SOURCES...",
      );
      try {
        const text = await item.entry.async("string");
        if (text.length <= MAX_RTL_BYTES) {
          rtl.push({ name: baseName(item.path), path: item.path, text: text });
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
      }
    }
    if (rtlEntries.length > MAX_RTL_FILES)
      skipped += rtlEntries.length - MAX_RTL_FILES;

    vcds.sort(function (a, b) {
      return a.path.localeCompare(b.path);
    });
    report(100, "ZIP READY");

    return { vcds: vcds, rtl: rtl, skipped: skipped, total: entries.length };
  }

  // Suggest which VCD is simulation and which is the second capture.
  // Only a suggestion, the user always confirms in the chooser.
  function guessRoles(vcds) {
    const HW_WORDS = [
      "fpga",
      "ila",
      "chipscope",
      "hardware",
      "hw",
      "board",
      "capture",
      "silicon",
    ];
    let simIndex = 0;
    let cmpIndex = -1;

    for (let i = 0; i < vcds.length; i++) {
      const n = vcds[i].name.toLowerCase();
      if (
        HW_WORDS.some(function (w) {
          return n.indexOf(w) !== -1;
        })
      ) {
        cmpIndex = i;
        break;
      }
    }
    if (cmpIndex !== -1) {
      simIndex = cmpIndex === 0 ? (vcds.length > 1 ? 1 : 0) : 0;
      for (let i = 0; i < vcds.length; i++) {
        if (i !== cmpIndex) {
          simIndex = i;
          break;
        }
      }
    }
    return { simIndex: simIndex, cmpIndex: cmpIndex };
  }

  window.VCDZip = { isZip: isZip, load: load, guessRoles: guessRoles };
})();
