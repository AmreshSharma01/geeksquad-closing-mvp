// Paste your Apps Script Web App URL here:
const API_URL = "PASTE_WEB_APP_URL_HERE";

// Must match SHARED_TOKEN in Apps Script:
const TOKEN = "PASTE_SAME_TOKEN_HERE";

const el = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function getData() {
  return {
    token: TOKEN,
    date: el("date").value || todayISO(),
    closer: el("closer").value.trim(),
    units_on_bench: Number(el("units").value || 0),
    notes: el("notes").value.trim()
  };
}

function summaryText(d) {
  return `Closing ${d.date}
Closer: ${d.closer || "-"}
Units on bench: ${d.units_on_bench}
Notes: ${d.notes || "-"}`;
}

async function save() {
  const d = getData();
  if (!d.closer) return alert("Enter closer name.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(d)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return alert("Save failed.");

  alert("Saved!");
  loadHistory();
}

async function loadHistory() {
  const history = el("history");
  history.innerHTML = "Loading...";

  const res = await fetch(API_URL);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return (history.innerHTML = "Failed to load.");

  const logs = json.logs || [];
  if (!logs.length) return (history.innerHTML = "No logs yet.");

  history.innerHTML = logs.slice(0, 15).map(l => `
    <div style="margin:10px 0; padding:10px; border:1px solid #eee; border-radius:10px;">
      <b>${l.date}</b> (${l.closer}) — Units: ${l.units_on_bench}
      <pre>${l.notes || ""}</pre>
    </div>
  `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  el("date").value = todayISO();
  el("copyBtn").onclick = async () => {
    const d = getData();
    await navigator.clipboard.writeText(summaryText(d));
    alert("Copied!");
  };
  el("saveBtn").onclick = save;
  el("refreshBtn").onclick = loadHistory;
  loadHistory();
});
