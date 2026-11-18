// The Schemes section: each scheme's key documents — the PPM, approval
// notes and the like — with where they live and what they are. Built on
// the same pattern as Investments: schemes (like investments) each carry a
// list of documents (like tasks).
//
// The app stores each document's details and link, not the file itself:
// files stay in SharePoint / OneDrive.
import { ORG_DOMAIN, OPTIONS } from "./config.js";
import { db, requireSession, signOutWithConfirm } from "./common.js";
import {
  collection, doc, getDocs, setDoc, addDoc,
  deleteDoc, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ============================ setup ============================ */
const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  team: [],
  schemes: [],
  documents: [],
  optionLists: {},          // dropdown values added from inside the app
  openSchemeCode: null,     // non-null when one scheme's page is showing
  showArchivedSchemes: false,
  showSuperseded: false
};

const isAdmin = () => state.profile && state.profile.role === "admin";
const isTeamLead = () => state.profile && state.profile.role === "teamlead";
const canDeleteDocument = () => isAdmin() || isTeamLead();

/* ============================ theme ============================ */
const THEME_KEY = "tavasya-theme";
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("btn-theme");
  if (btn) {
    btn.textContent = theme === "light" ? "🌙" : "☀️";
    btn.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  }
}
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
$("btn-theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
});

/* ============================ helpers ============================ */
const pad = (n) => String(n).padStart(2, "0");
const fmtDay = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const personName = (email) => {
  if (!email) return "—";
  const p = state.team.find((t) => t.email === email);
  return p ? (p.name || p.email) : email;
};
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "teamlead" ? "Team Lead" : "Member");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A document is Current, Draft or Superseded. Older records with no status
// count as Current.
const docStatus = (d) => d.status || "Current";
const STATUS_BADGE = { Current: "badge-DONE", Draft: "badge-DUESOON", Superseded: "badge-ONGOING" };

/* ============================ sign-in ============================
   Signing in happens on index.html. This page just waits for the session
   and sends anyone without one back there. */
$("btn-signout").addEventListener("click", signOutWithConfirm);

requireSession("schemes").then(({ user, profile }) => {
  state.user = user;
  state.profile = profile;
  boot();
});

async function boot() {
  $("who-name").textContent = `${state.profile.name || state.user.email} · ${roleLabel(state.profile.role)}`;
  await Promise.all([loadTeam(), loadSchemes(), loadDocuments(), loadOptionLists()]);

  $("btn-add-person").hidden = !isAdmin();
  $("btn-add-scheme").hidden = !isAdmin();

  populateSelects();
  renderAll();
  $("boot-splash").hidden = true;
  $("view-app").hidden = false;
}

/* ============================ data loading ============================ */
async function loadTeam() {
  const snap = await getDocs(collection(db, "users"));
  state.team = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function loadSchemes() {
  // The same scheme list every section shares, in the order config.js
  // gives (anything unlisted goes to the end, alphabetically).
  const snap = await getDocs(collection(db, "schemes"));
  const order = OPTIONS.schemeOrder || [];
  const rank = (s) => {
    const i = order.indexOf(s.code);
    return i === -1 ? order.length : i;
  };
  state.schemes = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (rank(a) - rank(b)) || (a.name || "").localeCompare(b.name || ""));
}
const activeSchemes = () => state.schemes.filter((s) => s.active !== false);
const schemeByCode = (code) => state.schemes.find((s) => s.code === code);

async function loadDocuments() {
  const snap = await getDocs(collection(db, "schemeDocuments"));
  state.documents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function loadOptionLists() {
  const snap = await getDocs(collection(db, "optionLists"));
  state.optionLists = {};
  snap.docs.forEach((d) => {
    const v = d.data().values;
    state.optionLists[d.id] = Array.isArray(v) ? v : [];
  });
}

const documentsFor = (code) => state.documents.filter((d) => d.schemeCode === code);

/* ============================ custom dropdown values ============================
   Document type ends with "+ Add new…", like the dropdowns in Investments.
   What it offers: the starting list in config.js, then anything added from
   inside the app, then any type already on a document. */
const ADD_NEW = "__add_new__";

const OPTION_FIELDS = {
  documentType: { noun: "document type", seed: () => OPTIONS.schemeDocumentTypes || [], used: () => state.documents.map((d) => d.docType) }
};

function optionsFor(key) {
  const f = OPTION_FIELDS[key];
  const seen = new Set();
  const out = [];
  const push = (v) => {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    out.push(s);
  };
  f.seed().forEach(push);
  (state.optionLists[key] || []).forEach(push);
  f.used().forEach(push);
  return out;
}

async function saveOption(key, value) {
  await setDoc(doc(db, "optionLists", key), {
    values: arrayUnion(value),
    updatedAt: serverTimestamp(),
    updatedBy: state.user.email
  }, { merge: true });
  state.optionLists[key] = [...(state.optionLists[key] || []), value];
}

function wireAddNew(id, key) {
  const sel = $(id);
  const noun = OPTION_FIELDS[key].noun;
  sel.addEventListener("change", async () => {
    if (sel.value !== ADD_NEW) { sel.dataset.prev = sel.value; return; }

    const value = (prompt(`New ${noun} — type it exactly as it should appear everywhere:`) || "").trim();
    if (!value) { sel.value = sel.dataset.prev || ""; return; }

    const existing = optionsFor(key).find((v) => v.toLowerCase() === value.toLowerCase());
    if (existing) {
      alert(`"${existing}" is already on the list.`);
      sel.value = existing;
      sel.dataset.prev = existing;
      return;
    }

    try {
      await saveOption(key, value);
      populateSelects();
      sel.value = value;
      sel.dataset.prev = value;
      toast(`${noun[0].toUpperCase()}${noun.slice(1)} added`);
    } catch (e) {
      alert("Couldn't save that: " + e.message);
      sel.value = sel.dataset.prev || "";
    }
  });
}

wireAddNew("d-type", "documentType");

/* ============================ shared selects ============================ */
const SELECT_IDS = ["d-scheme", "d-type", "f-doc-scheme", "f-doc-type"];

function populateSelects() {
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label ?? v)}</option>`;
  const prev = {};
  SELECT_IDS.forEach((id) => { prev[id] = $(id).value; });

  // The drawer offers active schemes, plus the scheme of the document being
  // edited even if that scheme has since been archived.
  $("d-scheme").innerHTML = activeSchemes().map((s) => opt(s.code, s.name)).join("");
  $("d-type").innerHTML = '<option value="">—</option>' +
    optionsFor("documentType").map((v) => opt(v)).join("") +
    `<option value="${ADD_NEW}">+ Add new…</option>`;
  $("f-doc-scheme").innerHTML = '<option value="">All schemes</option>' + state.schemes.map((s) => opt(s.code, s.name)).join("");
  $("f-doc-type").innerHTML = '<option value="">All types</option>' + optionsFor("documentType").map((v) => opt(v)).join("");

  SELECT_IDS.forEach((id) => {
    const sel = $(id);
    const want = prev[id];
    if (want && want !== ADD_NEW && [...sel.options].some((o) => o.value === want)) sel.value = want;
    sel.dataset.prev = sel.value;
  });
}

/* ============================ tabs ============================ */
$("main-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  goToTab(btn.dataset.tab);
});
const goToTab = (name) => {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
};

function renderAll() {
  renderSchemesTab();
  renderDocumentsTab();
  renderTeam();
}

/* ============================ schemes tab: the cards ============================ */
$("f-show-archived-schemes").addEventListener("change", () => {
  state.showArchivedSchemes = $("f-show-archived-schemes").checked;
  renderSchemesTab();
});

function renderSchemesTab() {
  if (state.openSchemeCode && schemeByCode(state.openSchemeCode)) {
    $("scheme-list-view").hidden = true;
    $("scheme-detail-view").hidden = false;
    renderSchemeDetail();
    return;
  }
  state.openSchemeCode = null;
  $("scheme-list-view").hidden = false;
  $("scheme-detail-view").hidden = true;

  const schemes = state.showArchivedSchemes ? state.schemes : activeSchemes();
  const live = state.documents.filter((d) => docStatus(d) !== "Superseded");
  $("dm-caption").innerHTML = state.documents.length
    ? `<strong>${plural(live.length, "document")}</strong> on record across <strong>${plural(activeSchemes().length, "scheme")}</strong>.`
    : `No documents yet. Open a scheme, or use <strong>+ Add document</strong>, to record the first one.`;

  $("scheme-empty").hidden = schemes.length > 0;
  $("scheme-grid").innerHTML = schemes.map(schemeCardHtml).join("");
}

function schemeCardHtml(s) {
  const docs = documentsFor(s.code).filter((d) => docStatus(d) !== "Superseded");
  const types = [...new Set(docs.map((d) => d.docType).filter(Boolean))];
  const latest = docs.slice().sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""))[0];
  const drafts = docs.filter((d) => docStatus(d) === "Draft").length;
  const archived = s.active === false;

  return `<button class="inv-card${archived ? " archived" : ""}" data-code="${esc(s.code)}">
    <div class="inv-card-top">
      <div>
        <p class="inv-card-name">${esc(s.name)}</p>
        <p class="inv-card-counterparty">${esc(s.code)}</p>
      </div>
      <span class="badge ${archived ? "badge-ONGOING" : "badge-DONE"}">${archived ? "Archived" : "Active"}</span>
    </div>
    <div class="inv-card-meta">
      ${types.slice(0, 5).map((t) => `<span class="type-tag">${esc(t)}</span>`).join("")}
      ${types.length > 5 ? `<span class="type-tag">+${types.length - 5} more</span>` : ""}
    </div>
    <div class="inv-card-figures">
      <span><span class="inv-fig-label">Documents</span><span class="inv-fig-value">${docs.length}</span></span>
      <span><span class="inv-fig-label">Latest</span><span class="inv-fig-value" style="font-family:inherit">${latest ? esc(latest.title) : "—"}</span></span>
    </div>
    <div class="inv-card-tasks">${docs.length === 0
      ? `<span class="task-dot open">No documents yet</span>`
      : drafts
        ? `<span class="task-dot duesoon">${plural(drafts, "draft")}</span>`
        : `<span class="task-dot clear">All final</span>`}</div>
  </button>`;
}

$("scheme-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".inv-card");
  if (card) openScheme(card.dataset.code);
});
$("btn-back-to-schemes").addEventListener("click", () => {
  state.openSchemeCode = null;
  renderSchemesTab();
});

function openScheme(code) {
  if (!schemeByCode(code)) return;
  state.openSchemeCode = code;
  goToTab("schemes");
  renderSchemesTab();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ============================ one scheme's page ============================ */
$("sv-show-superseded").addEventListener("change", () => {
  state.showSuperseded = $("sv-show-superseded").checked;
  renderSchemeDetail();
});

function renderSchemeDetail() {
  const s = schemeByCode(state.openSchemeCode);
  if (!s) { state.openSchemeCode = null; renderSchemesTab(); return; }
  const archived = s.active === false;
  const all = documentsFor(s.code);
  const superseded = all.filter((d) => docStatus(d) === "Superseded").length;

  $("sv-eyebrow").textContent = `Scheme · ${s.code}`;
  $("sv-name").textContent = s.name;
  const types = [...new Set(all.filter((d) => docStatus(d) !== "Superseded").map((d) => d.docType).filter(Boolean))];
  $("sv-subline").textContent = types.length ? types.join(" · ") : "No documents yet";
  $("sv-status").className = `badge ${archived ? "badge-ONGOING" : "badge-DONE"}`;
  $("sv-status").textContent = archived ? "Archived" : "Active";
  $("btn-toggle-scheme").hidden = !isAdmin();
  $("btn-toggle-scheme").textContent = archived ? "Restore scheme" : "Archive scheme";
  $("btn-add-scheme-document").hidden = archived;

  const fact = (label, value, cls = "") =>
    `<div class="fact"><p class="fact-label">${esc(label)}</p><p class="fact-value ${cls}">${value}</p></div>`;
  const lastAdded = all.slice().sort((a, b) => String(b.createdOn || "").localeCompare(String(a.createdOn || "")))[0];
  $("sv-facts").innerHTML =
    fact("Code", esc(s.code), "mono") +
    fact("Status", archived ? "Archived" : "Active") +
    fact("Documents", String(all.length - superseded), "mono") +
    fact("Drafts", String(all.filter((d) => docStatus(d) === "Draft").length), "mono") +
    fact("Superseded", String(superseded), "mono") +
    fact("Last added", lastAdded ? `${esc(lastAdded.title)}${lastAdded.createdOn ? ` <span class="muted">· ${fmtDay(lastAdded.createdOn)}</span>` : ""}` : '<span class="muted">—</span>');

  $("sv-doc-count").textContent = `${all.length - superseded} current or draft${superseded ? ` · ${superseded} superseded` : ""}`;

  const shown = state.showSuperseded ? all : all.filter((d) => docStatus(d) !== "Superseded");
  $("sv-documents-empty").hidden = shown.length > 0;
  $("sv-documents-empty").textContent = all.length === 0
    ? "No documents yet. Add the first one — the PPM, an approval note, anything this scheme's records should hold."
    : "Every document here is superseded. Tick “Show superseded” to see them.";

  // Grouped by type, in the order of the type list; untyped ones last.
  const order = optionsFor("documentType");
  const groups = new Map();
  shown.slice()
    .sort((a, b) => {
      const ta = a.docType ? order.indexOf(a.docType) : 1e6, tb = b.docType ? order.indexOf(b.docType) : 1e6;
      return (ta - tb) || (b.docDate || "").localeCompare(a.docDate || "") || (a.title || "").localeCompare(b.title || "");
    })
    .forEach((d) => {
      const key = d.docType || "Other documents";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });

  $("sv-documents").innerHTML = [...groups.entries()].map(([type, docs]) => `
    <p class="section-label">${esc(type)}</p>
    <div class="task-list doc-list">${docs.map(documentRowHtml).join("")}</div>`).join("");
}

function documentRowHtml(d) {
  const st = docStatus(d);
  return `<div class="task-row doc-row${st === "Superseded" ? " superseded" : ""}" data-id="${esc(d.id)}">
    <div class="task-main">
      <div class="task-title">${d.link
        ? `<a class="doc-title-link" href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.title)}</a>`
        : esc(d.title)}</div>
      <div class="task-sub">
        ${d.docDate ? `<span class="task-due">${fmtDay(d.docDate)}</span>` : ""}
        ${d.version ? `<span class="type-tag">${esc(d.version)}</span>` : ""}
        <span>Added by ${esc(personName(d.createdBy))}</span>
        ${d.link ? "" : `<span class="muted">No link yet</span>`}
      </div>
      ${d.notes ? `<p class="doc-notes">${esc(d.notes).replace(/\n/g, "<br>")}</p>` : ""}
    </div>
    <div class="task-side">
      <span class="badge ${STATUS_BADGE[st] || "badge-UPCOMING"}">${esc(st)}</span>
      ${d.link ? `<a class="row-link" href="${esc(d.link)}" target="_blank" rel="noopener">Open ↗</a>` : ""}
      <button class="btn-icon d-edit" title="Edit">✎</button>
    </div>
  </div>`;
}

$("sv-documents").addEventListener("click", (e) => {
  if (!e.target.closest(".d-edit")) return;
  const row = e.target.closest(".doc-row");
  const d = row && state.documents.find((x) => x.id === row.dataset.id);
  if (d) openDocumentDrawer(d);
});

$("btn-toggle-scheme").addEventListener("click", () => toggleScheme(state.openSchemeCode));

/* ============================ all documents tab ============================ */
["f-doc-search", "f-doc-scheme", "f-doc-type", "f-doc-status"]
  .forEach((id) => $(id).addEventListener("input", renderDocumentsTab));

function renderDocumentsTab() {
  const q = $("f-doc-search").value.trim().toLowerCase();
  const scheme = $("f-doc-scheme").value;
  const type = $("f-doc-type").value;
  const status = $("f-doc-status").value;

  let rows = state.documents.slice();
  if (scheme) rows = rows.filter((d) => d.schemeCode === scheme);
  if (type) rows = rows.filter((d) => d.docType === type);
  if (status === "") rows = rows.filter((d) => docStatus(d) !== "Superseded");
  else if (status !== "all") rows = rows.filter((d) => docStatus(d) === status);
  if (q) {
    rows = rows.filter((d) => [d.title, d.docType, d.version, d.notes, d.schemeName]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }

  const rank = (code) => { const i = state.schemes.findIndex((s) => s.code === code); return i === -1 ? 1e6 : i; };
  rows.sort((a, b) => (rank(a.schemeCode) - rank(b.schemeCode)) ||
    (b.docDate || "").localeCompare(a.docDate || "") || (a.title || "").localeCompare(b.title || ""));

  $("documents-empty").hidden = rows.length > 0;
  $("documents-body").innerHTML = rows.map((d) => {
    const s = schemeByCode(d.schemeCode);
    const st = docStatus(d);
    return `<tr class="clickable" data-id="${esc(d.id)}" data-code="${esc(d.schemeCode)}">
      <td class="col-due">${d.docDate ? fmtDay(d.docDate) : "—"}</td>
      <td><span class="oblig-name">${esc(d.title)}</span></td>
      <td>${d.docType ? `<span class="type-tag">${esc(d.docType)}</span>` : "—"}</td>
      <td>${esc(s ? s.name : (d.schemeName || d.schemeCode))}</td>
      <td>${esc(d.version || "—")}</td>
      <td><span class="badge ${STATUS_BADGE[st] || "badge-UPCOMING"}">${esc(st)}</span></td>
      <td>${d.link ? `<a class="row-link" href="${esc(d.link)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
      <td class="row-actions"><button class="btn-icon d-edit" title="Edit">✎</button></td>
    </tr>`;
  }).join("");
}

$("documents-body").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  if (e.target.closest("a")) return; // let links through
  const d = state.documents.find((x) => x.id === tr.dataset.id);
  if (e.target.closest(".d-edit")) { if (d) openDocumentDrawer(d); return; }
  openScheme(tr.dataset.code);
});

/* ============================ document drawer ============================ */
$("btn-add-document").addEventListener("click", () => openDocumentDrawer(null));
$("btn-add-scheme-document").addEventListener("click", () => openDocumentDrawer(null, state.openSchemeCode));
$("btn-drawer-close").addEventListener("click", closeDocumentDrawer);
$("drawer-backdrop").addEventListener("click", closeDocumentDrawer);

function openDocumentDrawer(d, schemeCode) {
  // An archived scheme isn't in the dropdown, so put it back for a document
  // that already belongs to one.
  populateSelects();
  const code = d ? d.schemeCode : (schemeCode || (activeSchemes()[0] && activeSchemes()[0].code) || "");
  if (code && ![...$("d-scheme").options].some((o) => o.value === code)) {
    const s = schemeByCode(code);
    $("d-scheme").insertAdjacentHTML("beforeend", `<option value="${esc(code)}">${esc(s ? s.name : code)} (archived)</option>`);
  }

  $("drawer-error").hidden = true;
  $("drawer-title").textContent = d ? "Edit document" : "Add document";
  $("d-id").value = d ? d.id : "";
  $("d-title").value = d ? d.title || "" : "";
  $("d-scheme").value = code;
  $("d-type").value = d ? d.docType || "" : "";
  $("d-type").dataset.prev = $("d-type").value;
  $("d-link").value = d ? d.link || "" : "";
  $("d-date").value = d ? d.docDate || "" : "";
  $("d-version").value = d ? d.version || "" : "";
  $("d-status").value = d ? docStatus(d) : "Current";
  $("d-notes").value = d ? d.notes || "" : "";
  $("btn-delete-document").hidden = !(d && canDeleteDocument());

  $("drawer").hidden = false;
  $("drawer").setAttribute("aria-hidden", "false");
  $("drawer-backdrop").hidden = false;
  $("d-title").focus();
}
function closeDocumentDrawer() {
  $("drawer").hidden = true;
  $("drawer").setAttribute("aria-hidden", "true");
  $("drawer-backdrop").hidden = true;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

$("form-document").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("drawer-error");
  err.hidden = true;

  const title = $("d-title").value.trim();
  const schemeCode = $("d-scheme").value;
  const link = $("d-link").value.trim();
  if (!title) { err.textContent = "Give the document a name."; err.hidden = false; return; }
  if (!schemeCode) { err.textContent = "Pick a scheme."; err.hidden = false; return; }
  if (link && !/^https?:\/\//i.test(link)) {
    err.textContent = "The link has to start with http:// or https://.";
    err.hidden = false; return;
  }

  const s = schemeByCode(schemeCode);
  const payload = {
    title,
    schemeCode,
    schemeName: s ? s.name : schemeCode,
    docType: $("d-type").value === ADD_NEW ? "" : $("d-type").value,
    link,
    docDate: $("d-date").value || "",
    version: $("d-version").value.trim(),
    status: $("d-status").value,
    notes: $("d-notes").value.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: state.user.email
  };

  try {
    const id = $("d-id").value;
    if (id) {
      await setDoc(doc(db, "schemeDocuments", id), payload, { merge: true });
      toast("Document updated");
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = state.user.email;
      payload.createdOn = todayISO();
      await addDoc(collection(db, "schemeDocuments"), payload);
      toast("Document added");
    }
    closeDocumentDrawer();
    await loadDocuments();
    populateSelects();
    renderAll();
  } catch (e2) {
    err.textContent = "Couldn't save: " + e2.message;
    err.hidden = false;
  }
});

$("btn-delete-document").addEventListener("click", async () => {
  const id = $("d-id").value;
  const d = state.documents.find((x) => x.id === id);
  if (!d) return;
  if (!confirm(`Delete "${d.title}" from the records?\n\nThis removes the entry and its link here. The file itself, wherever it's stored, isn't touched. This cannot be undone — to keep it on record, cancel and set its status to "Superseded" instead.`)) return;
  try {
    await deleteDoc(doc(db, "schemeDocuments", id));
    closeDocumentDrawer();
    await loadDocuments();
    renderAll();
    toast("Document deleted");
  } catch (e) {
    alert("Couldn't delete: " + e.message);
  }
});

/* ============================ adding and archiving schemes ============================
   The same shared scheme list as every other section's Schemes tab. */
async function toggleScheme(code) {
  const scheme = schemeByCode(code);
  if (!scheme || !isAdmin()) return;
  const isActive = scheme.active !== false;
  if (isActive && !confirm(
    `Archive "${scheme.name}"?\n\n` +
    `Its documents, investments, investors and compliance rows all stay exactly as they are — nothing is deleted. ` +
    `It just disappears from the scheme buttons and dropdowns in every section. You can restore it any time.`
  )) return;
  try {
    await setDoc(doc(db, "schemes", code), { active: !isActive }, { merge: true });
    await loadSchemes();
    populateSelects();
    renderAll();
    toast(isActive ? "Scheme archived" : "Scheme restored");
  } catch (err) {
    alert("Couldn't save that: " + err.message);
  }
}

$("btn-add-scheme").addEventListener("click", async () => {
  const name = (prompt("New scheme's full name, exactly as it should appear everywhere:") || "").trim();
  if (!name) return;
  if (state.schemes.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    alert("A scheme with that name already exists.");
    return;
  }
  const code = (prompt("Short code for it (2–6 letters, used internally — not shown to investors):") || "")
    .trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) { alert("A short code is required."); return; }
  if (state.schemes.some((s) => s.code === code)) {
    alert(`Code "${code}" is already in use by another scheme. Pick a different one.`);
    return;
  }
  try {
    await setDoc(doc(db, "schemes", code), {
      code, name, active: true,
      createdAt: serverTimestamp(), createdBy: state.user.email
    });
    await loadSchemes();
    populateSelects();
    renderAll();
    toast("Scheme added — it appears in every section");
  } catch (err) {
    alert("Couldn't add that: " + err.message);
  }
});

/* ============================ team tab ============================ */
function renderTeam() {
  $("team-body").innerHTML = state.team.map((p) => {
    const added = state.documents.filter((d) => d.createdBy === p.email).length;
    const isMe = state.user && p.email === state.user.email.toLowerCase();
    return `<tr data-email="${esc(p.email)}">
      <td>${esc(p.name || "—")}${isMe ? ' <span class="type-tag">you</span>' : ""}</td>
      <td>${esc(p.email)}</td>
      <td>${esc(roleLabel(p.role))}</td>
      <td class="col-days">${added}</td>
      <td>${p.active ? "Active" : "Removed"}</td>
      <td class="row-actions">${isAdmin() ? `<button class="btn-icon p-edit">Edit</button>` : ""}</td>
    </tr>`;
  }).join("");
}

$("team-body").addEventListener("click", (e) => {
  if (!e.target.classList.contains("p-edit")) return;
  const email = e.target.closest("tr").dataset.email;
  openPersonDrawer(state.team.find((p) => p.email === email) || null);
});

$("btn-add-person").addEventListener("click", () => openPersonDrawer(null));
$("btn-person-close").addEventListener("click", closePersonDrawer);
$("person-backdrop").addEventListener("click", closePersonDrawer);

function openPersonDrawer(p) {
  $("person-error").hidden = true;
  $("person-drawer-title").textContent = p ? "Edit person" : "Add person";
  $("p-original-email").value = p ? p.email : "";
  $("p-name").value = p ? p.name || "" : "";
  $("p-email").value = p ? p.email : "";
  $("p-email").readOnly = !!p;   // the email IS the record's key — never editable
  $("p-email-hint").textContent = p
    ? "The email is the account's key and can't be changed. To correct one, remove this person and add them again."
    : `Must be an @${ORG_DOMAIN} address. This is also their username — it can't be changed later, so check the spelling.`;
  $("p-role").value = p ? p.role || "member" : "member";
  $("p-active").checked = p ? p.active !== false : true;

  $("person-drawer").hidden = false;
  $("person-drawer").setAttribute("aria-hidden", "false");
  $("person-backdrop").hidden = false;
  (p ? $("p-name") : $("p-name")).focus();
}
function closePersonDrawer() {
  $("person-drawer").hidden = true;
  $("person-drawer").setAttribute("aria-hidden", "true");
  $("person-backdrop").hidden = true;
}

$("form-person").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("person-error");
  err.hidden = true;

  const existing = $("p-original-email").value;
  const name = $("p-name").value.trim();
  const email = (existing || $("p-email").value).trim().toLowerCase();
  const role = $("p-role").value;
  const active = $("p-active").checked;

  if (!name) { err.textContent = "Enter their name."; err.hidden = false; return; }
  if (!email.endsWith("@" + ORG_DOMAIN)) {
    err.textContent = `That has to be an @${ORG_DOMAIN} address — nothing else can sign in.`;
    err.hidden = false; return;
  }
  if (!existing && state.team.some((p) => p.email === email)) {
    err.textContent = "Somebody with that email is already on the list.";
    err.hidden = false; return;
  }
  // Locking yourself out, or removing the last admin, leaves nobody able to
  // manage the team — and the only fix is editing the database by hand.
  const me = state.user.email.toLowerCase();
  if (existing === me && (role !== "admin" || !active)) {
    err.textContent = "You can't remove your own admin access — ask another Admin to do it, so the app is never left without one.";
    err.hidden = false; return;
  }
  const otherAdmins = state.team.filter((p) => p.active && p.role === "admin" && p.email !== email);
  if (existing && !otherAdmins.length && (role !== "admin" || !active)) {
    err.textContent = "This is the only active Admin. Promote someone else first.";
    err.hidden = false; return;
  }

  try {
    await setDoc(doc(db, "users", email), {
      email, name, role, active,
      updatedAt: serverTimestamp(), updatedBy: state.user.email
    }, { merge: true });
    closePersonDrawer();
    await loadTeam();
    populateSelects();
    renderAll();
    toast(existing ? "Person updated" : "Person added — they set their own password on first sign-in");
  } catch (e2) {
    err.textContent = "Couldn't save: " + e2.message;
    err.hidden = false;
  }
});

/* ============================ toast ============================ */
let toastTimer = null;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

/* Escape closes whichever drawer is open. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("person-drawer").hidden) closePersonDrawer();
  else if (!$("drawer").hidden) closeDocumentDrawer();
});
