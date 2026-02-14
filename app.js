/*************************************************
 * CONFIG
 *************************************************/

// Paste your Apps Script Web App URL (must end with /exec)
const API_URL = "https://script.google.com/macros/s/AKfycbwBy8XpmAhIlyWGXLmjUV7HjNKJ8xtGsPNXV4VXzXXzpFPfwtGG1lus5s3G5WjKmvBTHA/exec";

// Workstations Alpha → K
const STATIONS = [
  "Alpha", "Beta", "Gamma", "Delta", "Echo",
  "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo"
];

// History defaults
const HISTORY_LIMIT = 5;

// Image compression defaults (client-side)
const COMPRESS_MAX_DIM = 1600;        // max width/height in px
const COMPRESS_QUALITY = 0.75;        // jpeg quality 0..1
const COMPRESS_OUTPUT_MIME = "image/jpeg";

// Safety cap after compression (Apps Script + base64 payloads can choke on large images)
const MAX_PHOTO_BYTES = 900 * 1024;   // ~900KB

/*************************************************
 * HELPERS
 *************************************************/

const el = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeParseJSON(v, fallback) {
  try {
    const parsed = JSON.parse(v);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function setStatus(text) {
  const st = el("statusText");
  if (st) st.textContent = text || "";
}

function formatTimestamp(ts) {
  if (!ts) return "";
  // ts is ISO like 2026-02-14T...
  return String(ts).replace("T", " ").slice(0, 16);
}

function priorityClass(p) {
  const v = String(p || "").toLowerCase();
  if (v === "high") return "pillHigh";
  if (v === "low") return "pillLow";
  return "pillMedium";
}

/*************************************************
 * IMAGE COMPRESSION
 *************************************************/

function fileToImage_(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToBlob_(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

/**
 * Compress an image file using a canvas resize + jpeg encode.
 * Returns { base64, mimeType, name, bytes, width, height }.
 */
async function compressImage(file) {
  const img = await fileToImage_(file);

  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;

  const scale = Math.min(1, COMPRESS_MAX_DIM / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  // First pass
  let blob = await canvasToBlob_(canvas, COMPRESS_OUTPUT_MIME, COMPRESS_QUALITY);

  // If still too big, try progressively lower quality (fast + simple)
  let q = COMPRESS_QUALITY;
  while (blob && blob.size > MAX_PHOTO_BYTES && q > 0.45) {
    q = Math.max(0.45, q - 0.10);
    blob = await canvasToBlob_(canvas, COMPRESS_OUTPUT_MIME, q);
  }

  if (!blob) throw new Error("Image compression failed");

  // Convert blob to base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve(String(dataUrl).split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // Preserve original filename stem, but change extension for jpeg
  const stem = (file.name || "photo").replace(/\.[^/.]+$/, "");
  const name = `${stem}.jpg`;

  return {
    base64,
    mimeType: COMPRESS_OUTPUT_MIME,
    name,
    bytes: blob.size,
    width: w,
    height: h
  };
}

/*************************************************
 * UI RENDERING
 *************************************************/

function renderStations() {
  const wrap = el("stations");
  if (!wrap) return;

  wrap.innerHTML = STATIONS.map((s) => `
    <div class="stationCard">
      <div class="stationTop">
        <div class="stationKey">${escapeHtml(s)}</div>
        <small id="photoHint_${escapeHtml(s)}" class="hint"></small>
      </div>

      <div style="margin-top:10px;">
        <input id="notes_${escapeHtml(s)}" placeholder="Notes for ${escapeHtml(s)}" />
      </div>

      <div style="margin-top:10px;">
        <input id="photo_${escapeHtml(s)}" type="file" accept="image/*" />
      </div>
    </div>
  `).join("");

  // Show compression hint when a file is selected
  for (const s of STATIONS) {
    const input = el(`photo_${s}`);
    const hint = el(`photoHint_${s}`);
    if (!input || !hint) continue;

    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) {
        hint.textContent = "";
        return;
      }
      const mb = (f.size / (1024 * 1024)).toFixed(2);
      hint.textContent = `Original: ${mb} MB (auto-compress on Save)`;
    });
  }
}

function renderHistory(logs) {
  const history = el("history");
  if (!history) return;

  if (!logs.length) {
    history.innerHTML = "No logs yet.";
    return;
  }

  history.innerHTML = logs.map((l) => {
    const stations = safeParseJSON(l.stations_json, []);
    const stationsText = Array.isArray(stations) && stations.length
      ? stations.map(st => {
          const key = st.key || "";
          const notes = st.notes || "";
          const photoUrl = st.photoUrl || "";
          const photoLine = photoUrl ? `\nPhoto: ${photoUrl}` : "";
          return `${key}: ${notes || "(no notes)"}${photoLine}`;
        }).join("\n\n")
      : "(no workstation updates)";

    const body =
`Priority: ${l.priority || "Medium"}
Units on bench: ${l.units_on_bench || "-"}
Handoff: ${l.handoff_notes || "-"}

Workstations:
${stationsText}`;

    return `
      <div style="margin:10px 0; padding:12px; border:1px solid #e5e7eb; border-radius:14px; background:#fff;">
        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div><b>${escapeHtml(l.date || "")}</b> (${escapeHtml(l.closer || "")})</div>
            <span class="pill ${priorityClass(l.priority)}">${escapeHtml(l.priority || "Medium")}</span>
          </div>
          <div style="opacity:.7; font-size:12px;">${escapeHtml(formatTimestamp(l.timestamp))}</div>
        </div>
        <pre style="white-space:pre-wrap; background:#f1f5f9; padding:12px; border-radius:12px; margin-top:10px;">${escapeHtml(body)}</pre>
      </div>
    `;
  }).join("");
}

/*************************************************
 * DATA COLLECTION
 *************************************************/

function getBasicData() {
  return {
    date: el("date")?.value || todayISO(),
    closer: (el("closer")?.value || "").trim(),
    priority: el("priority")?.value || "Medium",
    units_on_bench: Number(el("units")?.value || 0),
    handoff_notes: (el("handoff")?.value || "").trim()
  };
}

async function buildStationsPayload() {
  // Build tasks first so compression runs in parallel (faster)
  const tasks = [];

  for (const s of STATIONS) {
    const notes = (el(`notes_${s}`)?.value || "").trim();
    const fileInput = el(`photo_${s}`);
    const file = fileInput?.files?.[0];

    if (!notes && !file) continue;

    tasks.push((async () => {
      const st = { key: s, notes };

      if (file) {
        // compress on the client to speed up upload + reduce Apps Script failures
        const compressed = await compressImage(file);
        st.photo = { base64: compressed.base64, mimeType: compressed.mimeType, name: compressed.name };

        const hint = el(`photoHint_${s}`);
        if (hint) {
          const kb = Math.round(compressed.bytes / 1024);
          hint.textContent = `Compressed: ~${kb} KB (${compressed.width}×${compressed.height})`;
        }
      }

      return st;
    })());
  }

  return Promise.all(tasks);
}

function buildCopySummary(basic, stations) {
  const lines = [];
  lines.push(`Closing ${basic.date}`);
  lines.push(`Closer: ${basic.closer || "-"}`);
  lines.push(`Priority: ${basic.priority || "Medium"}`);
  lines.push(`Units on bench: ${basic.units_on_bench}`);

  if (stations.length) {
    lines.push(``);
    lines.push(`Workstations:`);
    for (const st of stations) {
      const note = st.notes ? st.notes : "(no notes)";
      lines.push(`${st.key}: ${note}`);
    }
  }

  if (basic.handoff_notes) {
    lines.push(``);
    lines.push(`Handoff: ${basic.handoff_notes}`);
  }

  return lines.join("\n");
}

/*************************************************
 * API CALLS
 *************************************************/

let historyMode = "latest"; // "latest" | "all"

async function saveLog() {
  const basic = getBasicData();
  if (!basic.closer) {
    alert("Enter closer name.");
    return;
  }

  const saveBtn = el("saveBtn");
  const refreshBtn = el("refreshBtn");
  if (saveBtn) saveBtn.disabled = true;
  if (refreshBtn) refreshBtn.disabled = true;
  setStatus("Saving... compressing photos if needed.");

  try {
    const stations = await buildStationsPayload();

    const payload = { ...basic, stations };

    setStatus("Uploading...");
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      alert("Save failed: " + (json.error || res.statusText));
      return;
    }

    setStatus("Saved. Refreshing history...");
    await loadHistory();
    alert("Saved!");
  } catch (err) {
    alert("Save failed: " + String(err));
  } finally {
    setStatus("");
    if (saveBtn) saveBtn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function loadHistory() {
  const history = el("history");
  if (history) history.innerHTML = "Loading...";

  const url = historyMode === "latest"
    ? `${API_URL}?limit=${encodeURIComponent(HISTORY_LIMIT)}`
    : API_URL;

  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.ok) {
    if (history) history.innerHTML = "Failed to load history.";
    return;
  }

  const logs = Array.isArray(json.logs) ? json.logs : [];
  renderHistory(historyMode === "latest" ? logs.slice(0, HISTORY_LIMIT) : logs);
}

/*************************************************
 * INIT
 *************************************************/

function setHistoryMode(mode) {
  historyMode = mode;

  const latestBtn = el("histLatestBtn");
  const allBtn = el("histAllBtn");

  latestBtn?.classList.toggle("active", mode === "latest");
  allBtn?.classList.toggle("active", mode === "all");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (el("date")) el("date").value = todayISO();

  renderStations();

  el("saveBtn")?.addEventListener("click", saveLog);
  el("refreshBtn")?.addEventListener("click", loadHistory);

  el("histLatestBtn")?.addEventListener("click", async () => {
    setHistoryMode("latest");
    await loadHistory();
  });

  el("histAllBtn")?.addEventListener("click", async () => {
    setHistoryMode("all");
    await loadHistory();
  });

  el("copyBtn")?.addEventListener("click", async () => {
    const basic = getBasicData();
    if (!basic.closer) {
      alert("Enter closer name before copying.");
      return;
    }
    setStatus("Preparing summary...");
    try {
      const stations = await buildStationsPayload();
      const text = buildCopySummary(basic, stations);
      await navigator.clipboard.writeText(text);
      alert("Copied!");
    } finally {
      setStatus("");
    }
  });

  setHistoryMode("latest");
  await loadHistory();
});
