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

// Only show latest N logs to keep UI fast
const HISTORY_LIMIT = 5;

// Photo size limit (base64 + Apps Script are happier with small images)
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB

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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // data:image/png;base64,XXXX
      const base64 = String(dataUrl).split(",")[1];
      resolve({
        base64,
        mimeType: file.type,
        name: file.name
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatTimestamp(ts) {
  if (!ts) return "";
  // ts is ISO like 2026-02-14T...
  return String(ts).replace("T", " ").slice(0, 16);
}

/*************************************************
 * UI RENDERING
 *************************************************/

function renderStations() {
  const wrap = el("stations");
  if (!wrap) return;

  wrap.innerHTML = STATIONS.map((s) => `
    <div class="stationCard" style="border:1px solid #eee; padding:10px; border-radius:10px; margin:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <b>${escapeHtml(s)}</b>
        <small id="photoHint_${escapeHtml(s)}" style="opacity:.7;"></small>
      </div>

      <div style="margin-top:8px;">
        <input id="notes_${escapeHtml(s)}" placeholder="Notes for ${escapeHtml(s)}"
               style="width:100%; padding:10px; font-size:14px;" />
      </div>

      <div style="margin-top:8px;">
        <input id="photo_${escapeHtml(s)}" type="file" accept="image/*" />
      </div>
    </div>
  `).join("");

  // show size hint when a file is selected
  for (const s of STATIONS) {
    const input = el(`photo_${s}`);
    const hint = el(`photoHint_${s}`);
    if (!input || !hint) continue;

    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) {
        hint.textContent = "";
        return;
      }
      const mb = (f.size / (1024 * 1024)).toFixed(2);
      hint.textContent = `${mb} MB`;
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
`Units on bench: ${l.units_on_bench || "-"}
Handoff: ${l.handoff_notes || "-"}

Workstations:
${stationsText}`;

    return `
      <div style="margin:10px 0; padding:10px; border:1px solid #eee; border-radius:10px;">
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <div><b>${escapeHtml(l.date || "")}</b> (${escapeHtml(l.closer || "")})</div>
          <div style="opacity:.7; font-size:12px;">${escapeHtml(formatTimestamp(l.timestamp))}</div>
        </div>
        <pre style="white-space:pre-wrap; background:#f6f6f6; padding:10px; border-radius:10px; margin-top:8px;">${escapeHtml(body)}</pre>
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
    units_on_bench: Number(el("units")?.value || 0),
    handoff_notes: (el("handoff")?.value || "").trim()
  };
}

async function buildStationsPayload() {
  const stations = [];

  for (const s of STATIONS) {
    const notes = (el(`notes_${s}`)?.value || "").trim();
    const fileInput = el(`photo_${s}`);
    const file = fileInput?.files?.[0];

    // Only include station if it has notes or photo
    if (!notes && !file) continue;

    const st = { key: s, notes };

    if (file) {
      if (file.size > MAX_PHOTO_BYTES) {
        alert(`${s} photo is too large. Please upload <= 2MB.`);
        throw new Error("Photo too large");
      }
      st.photo = await fileToBase64(file);
    }

    stations.push(st);
  }

  return stations;
}

function buildCopySummary(basic, stations) {
  const lines = [];
  lines.push(`Closing ${basic.date}`);
  lines.push(`Closer: ${basic.closer || "-"}`);
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

async function saveLog() {
  const basic = getBasicData();
  if (!basic.closer) {
    alert("Enter closer name.");
    return;
  }

  const saveBtn = el("saveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const stations = await buildStationsPayload();

    const payload = {
      ...basic,
      stations
    };

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

    alert("Saved!");
    await loadHistory();
  } catch (err) {
    // If we throw for photo size etc.
    if (String(err).includes("Photo too large")) return;
    alert("Save failed: " + String(err));
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function loadHistory() {
  const history = el("history");
  if (history) history.innerHTML = "Loading...";

  const res = await fetch(API_URL);
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.ok) {
    if (history) history.innerHTML = "Failed to load history.";
    return;
  }

  const logs = Array.isArray(json.logs) ? json.logs : [];

  // Show only latest 5
  renderHistory(logs.slice(0, HISTORY_LIMIT));
}

/*************************************************
 * INIT
 *************************************************/

document.addEventListener("DOMContentLoaded", async () => {
  if (el("date")) el("date").value = todayISO();

  renderStations();

  el("saveBtn")?.addEventListener("click", saveLog);
  el("refreshBtn")?.addEventListener("click", loadHistory);

  el("copyBtn")?.addEventListener("click", async () => {
    const basic = getBasicData();
    if (!basic.closer) {
      alert("Enter closer name before copying.");
      return;
    }
    const stations = await buildStationsPayload();
    const text = buildCopySummary(basic, stations);
    await navigator.clipboard.writeText(text);
    alert("Copied!");
  });

  await loadHistory();
});
