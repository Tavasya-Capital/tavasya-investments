// The Compliance section. Carried over from the standalone Compliance
// Register (github.com/Tavasya-Capital/tavasya-compliance-) unchanged,
// except that signing in now happens once on index.html (see common.js)
// and the data lives in the same Firebase project as Investments.
import { ORG_DOMAIN, OPTIONS } from "./config.js";
import { db, requireSession, signOutWithConfirm } from "./common.js";
import {
  collection, doc, getDocs, setDoc, updateDoc,
  deleteDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ============================ setup ============================ */

const $ = (id) => document.getElementById(id);
const state = { user: null, profile: null, compliances: [], team: [], schemes: [], complianceTypes: [], complianceTypeDocs: [], editingId: null, dashboardScheme: "", dashboardType: "", dashboardStatusFilter: "", dashboardWeekOffset: 0, typesModal: { mode: null, target: null, remaining: [], staged: [] }, excelImport: null };
const isAdmin = () => state.profile && state.profile.role === "admin";
const isTeamLead = () => state.profile && state.profile.role === "teamlead";
const canManageTypes = () => isAdmin() || isTeamLead();
const canImportExcel = canManageTypes; // same role set — Admin + Team Lead

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
applyTheme(localStorage.getItem(THEME_KEY) || "dark"); // the <head> script already set the attribute; this just syncs the button icon
$("btn-theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
});

/* ============================ date helpers ============================ */
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const daysBetween = (isoDate) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  const t = new Date(ty, tm - 1, td);
  return Math.round((due - t) / 86400000);
};
const fmtDay = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function statusOf(c) {
  if (c.completed) return "DONE";
  if (!c.dueDate) return "ONGOING";
  const d = daysBetween(c.dueDate);
  if (d < 0) return "OVERDUE";
  if (d <= (c.reminderLeadDays || 15)) return "DUE SOON";
  return "UPCOMING";
}
const statusClass = (s) => s.replace(" ", "");

/* ============================ sign-in ============================
   Signing in happens on index.html. This page just waits for the session
   and sends anyone without one back there. */
$("btn-signout").addEventListener("click", signOutWithConfirm);

requireSession("compliance").then(({ user, profile }) => {
  state.user = user;
  state.profile = profile;
  boot();
});

async function boot() {
  const user = state.user;
  $("who-name").textContent = `${state.profile.name || user.email} · ${roleLabel(state.profile.role)}`;
  $("btn-add-person").hidden = !isAdmin();
  $("btn-add-scheme").hidden = !isAdmin();
  $("btn-import-excel").hidden = !canImportExcel();
  // Note: btn-manage-types is always visible now — Reassign is open to any
  // Member; only Delete (inside the modal, per-row) is gated to canManageTypes().

  await Promise.all([loadCompliances(), loadTeam()]);
  await loadSchemes();
  await ensureDefaultSchemes(); // one-time, harmless if it's already populated
  await loadComplianceTypes();
  await ensureDefaultComplianceTypes(); // same idea, for the type list
  populateSchemeOptions();
  renderDashboard();
  renderRegister();
  renderTeam();
  renderSchemes();
  $("boot-splash").hidden = true;
  $("view-app").hidden = false;
}

/* ============================ tabs ============================ */
$("main-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
});

/* ============================ data loading ============================ */
async function loadCompliances() {
  const snap = await getDocs(collection(db, "compliances"));
  state.compliances = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function loadTeam() {
  const snap = await getDocs(collection(db, "users"));
  state.team = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function loadSchemes() {
  const snap = await getDocs(collection(db, "schemes"));
  state.schemes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function loadComplianceTypes() {
  const snap = await getDocs(collection(db, "complianceTypes"));
  state.complianceTypeDocs = snap.docs.map((d) => ({ id: d.id, name: d.data().name }));
  state.complianceTypes = state.complianceTypeDocs.map((d) => d.name).sort();
}
async function ensureDefaultComplianceTypes() {
  // Seeds the 4 starting types exactly once. After this, the list only
  // grows through the drawer's own "+ Add new type" option — any member
  // can do that, not just Admin, so no isAdmin() gate here.
  if (state.complianceTypes.length > 0) return;
  const batch = writeBatch(db);
  OPTIONS.defaultComplianceTypes.forEach((name) =>
    batch.set(doc(db, "complianceTypes", slugCode(name)), { name, createdAt: serverTimestamp(), createdBy: state.user.email })
  );
  await batch.commit();
  await loadComplianceTypes();
}
async function ensureDefaultSchemes() {
  // First-ever load of a fresh project: seed the 3 schemes that the
  // existing 105 compliance rows already reference by name, so the
  // dropdowns immediately match reality instead of showing empty.
  // Harmless no-op on every later boot once these exist.
  if (state.schemes.length > 0 || !isAdmin()) return;
  const defaults = [
    { code: "SSF", name: "TAVASYA SSF" },
    { code: "MS2", name: "TAVASYA Mudrikaran Scheme II" },
    { code: "MS3", name: "TAVASYA Mudrikaran Scheme III" }
  ];
  const batch = writeBatch(db);
  defaults.forEach((s) => batch.set(doc(db, "schemes", s.code), { ...s, active: true, createdAt: serverTimestamp(), createdBy: state.user.email }));
  await batch.commit();
  await loadSchemes();
}

function populateSchemeOptions() {
  const activeSchemes = state.schemes.filter((s) => s.active);
  for (const sel of [$("f-scheme"), $("c-scheme"), $("d-scheme")]) {
    const keepFirst = sel.id !== "c-scheme";
    sel.innerHTML = (keepFirst ? '<option value="">All schemes</option>' : "") +
      activeSchemes.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
  }
  for (const sel of [$("f-type"), $("c-type"), $("d-type")]) {
    const keepFirst = sel.id !== "c-type";
    const addNewOpt = sel.id === "c-type" ? '<option value="__add_new__">+ Add new type…</option>' : "";
    sel.innerHTML = (keepFirst ? '<option value="">All types</option>' : "") +
      state.complianceTypes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("") +
      addNewOpt;
  }
  $("c-frequency").innerHTML = OPTIONS.frequencies.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
  const ownerOpts = state.team.filter((t) => t.active).map((t) => `<option value="${esc(t.email)}">${esc(t.name || t.email)}</option>`).join("");
  $("c-owner").innerHTML = '<option value="">Unassigned</option>' + ownerOpts;
  $("c-cc").innerHTML = '<option value="">None</option>' + ownerOpts;
}

/* ============================ dashboard ============================ */
$("d-scheme").addEventListener("change", () => {
  state.dashboardScheme = $("d-scheme").value;
  renderDashboard();
});
$("d-type").addEventListener("change", () => {
  state.dashboardType = $("d-type").value;
  renderDashboard();
});

function dashboardRows() {
  let rows = state.compliances.map((c) => ({ ...c, _status: statusOf(c) }));
  if (state.dashboardScheme) rows = rows.filter((c) => c.scheme === state.dashboardScheme);
  if (state.dashboardType) rows = rows.filter((c) => (c.complianceType || "SEBI/AIF Regulatory") === state.dashboardType);
  return rows;
}

// Single source of truth for which of the 5 dashboard buckets a row falls
// into — used both for the KPI counts AND for the click-to-filter list
// below, so the two are always guaranteed to agree with each other.
function dashboardBucket(c) {
  if (c._status === "OVERDUE") return "OVERDUE";
  if (c.completed) return "DONE";
  if (!c.dueDate) return "ONGOING";
  return daysBetween(c.dueDate) <= 7 ? "DUE SOON" : "UPCOMING";
}
const FILTER_LABELS = { "OVERDUE": "Overdue", "DUE SOON": "Due in 1 Week", "UPCOMING": "Upcoming", "DONE": "Completed", "ONGOING": "Ongoing" };

function renderDashboard() {
  const withStatus = dashboardRows();

  // Overdue / Done / Ongoing mean the same thing regardless of lead time.
  // "Due in 1 Week" / "Upcoming" use a FIXED 7-day boundary here, deliberately
  // different from statusOf()'s per-row reminder window (which still governs
  // the Register's badges and the email reminder logic). dashboardBucket()
  // above guarantees every row lands in exactly one of the 5 buckets.
  const counts = { OVERDUE: 0, DONE: 0, ONGOING: 0, "DUE SOON": 0, UPCOMING: 0 };
  withStatus.forEach((c) => counts[dashboardBucket(c)]++);

  $("k-overdue").textContent = counts.OVERDUE;
  $("k-duesoon").textContent = counts["DUE SOON"];
  $("k-upcoming").textContent = counts.UPCOMING;
  $("k-done").textContent = counts.DONE;
  $("k-ongoing").textContent = counts.ONGOING;

  document.querySelectorAll(".kpi").forEach((el) =>
    el.classList.toggle("active", el.dataset.status === state.dashboardStatusFilter)
  );

  // nearest outstanding deadline (within the current scheme/type filter) drives the distance meter
  const outstanding = withStatus.filter((c) => c.dueDate && !c.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nearest = outstanding[0];
  if (nearest) {
    const d = daysBetween(nearest.dueDate);
    const lead = nearest.reminderLeadDays || 15;
    const pct = d < 0 ? 100 : Math.max(0, Math.min(100, 100 - (d / lead) * 66.6));
    $("dm-marker").style.left = pct + "%";
    $("dm-caption").innerHTML = d < 0
      ? `<strong>${esc(nearest.obligation)}</strong> (${esc(nearest.scheme)}) was due ${fmtDay(nearest.dueDate)} — ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue.`
      : `<strong>${esc(nearest.obligation)}</strong> (${esc(nearest.scheme)}) is due ${fmtDay(nearest.dueDate)} — ${d} day${d === 1 ? "" : "s"} away.`;
  } else {
    $("dm-marker").style.left = "0%";
    $("dm-caption").textContent = state.dashboardScheme ? "Nothing outstanding for this scheme." : "Nothing outstanding with a due date.";
  }

  renderWeeklyPanel();
}

$("kpi-strip").addEventListener("click", (e) => {
  const tile = e.target.closest(".kpi");
  if (!tile) return;
  const clicked = tile.dataset.status;
  state.dashboardStatusFilter = state.dashboardStatusFilter === clicked ? "" : clicked;
  renderDashboard();
});
$("btn-clear-status-filter").addEventListener("click", () => {
  state.dashboardStatusFilter = "";
  renderDashboard();
});

/* ---------- weekly panel: overdue always pinned, week browsable both ways ---------- */
function weekBounds(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: iso(monday), end: iso(sunday), monday, sunday };
}
function fmtRange(a, b) {
  const opts1 = { day: "2-digit", month: "short" };
  const opts2 = { day: "2-digit", month: "short", year: "numeric" };
  return `${a.toLocaleDateString("en-GB", opts1)} – ${b.toLocaleDateString("en-GB", opts2)}`;
}
function weekItemHtml(c) {
  const done = c.completed
    ? `<span class="wk-done">✓ done</span>${c.proofPending ? '<span class="proof-pending-tag">Proof pending</span>' : ""}`
    : "";
  return `
    <div class="wk-item${isAdmin() ? " clickable" : ""}" data-id="${esc(c.id)}">
      <span class="wk-date">${esc(fmtDay(c.dueDate) || "No due date")}</span>
      <span class="wk-name">${esc(c.obligation)}${done}</span>
      <span class="wk-meta">${esc(c.scheme)}</span>
    </div>`;
}

function renderWeeklyPanel() {
  const rows = dashboardRows();
  const filter = state.dashboardStatusFilter;

  $("week-nav").hidden = !!filter;
  $("btn-clear-status-filter").hidden = !filter;
  $("overdue-section").hidden = true; // only shown in the unfiltered, current-week view below

  if (filter) {
    // Clicked a KPI tile: show every matching row, ignoring week bounds
    // entirely — "show me all Overdue" shouldn't be limited to this week.
    $("weekly-title").textContent = FILTER_LABELS[filter];
    let matching = rows.filter((c) => dashboardBucket(c) === filter);
    matching = filter === "DONE"
      ? matching.sort((a, b) => (b.completedOn || "").localeCompare(a.completedOn || ""))
      : filter === "ONGOING"
        ? matching.sort((a, b) => (a.obligation || "").localeCompare(b.obligation || ""))
        : matching.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

    const capped = matching.slice(0, 50);
    $("week-section-label").textContent = matching.length > 50
      ? `Showing 50 of ${matching.length}`
      : `${matching.length} item${matching.length === 1 ? "" : "s"}`;
    $("due-this-week").innerHTML = capped.length
      ? capped.map(weekItemHtml).join("")
      : `<p class="empty-note">Nothing in this bucket${state.dashboardScheme ? " for this scheme" : ""}.</p>`;
    return;
  }

  const offset = state.dashboardWeekOffset;
  const { start, end, monday, sunday } = weekBounds(offset);
  const isCurrent = offset === 0;

  $("weekly-title").textContent = "Tasks Due";
  $("btn-week-today").disabled = isCurrent;

  // Overdue is pinned only when looking at the current week — it's a "right now"
  // concept, not tied to whichever week you happen to be browsing.
  const overdueSection = $("overdue-section");
  if (isCurrent) {
    const overdue = rows.filter((c) => c._status === "OVERDUE").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    overdueSection.hidden = overdue.length === 0;
    $("overdue-list").innerHTML = overdue.map(weekItemHtml).join("");
  }

  const weekItems = rows
    .filter((c) => c.dueDate && c.dueDate >= start && c.dueDate <= end)
    .filter((c) => !(isCurrent && c._status === "OVERDUE")) // already shown above, don't duplicate
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  $("week-section-label").textContent = isCurrent ? "This week" : fmtRange(monday, sunday);
  $("due-this-week").innerHTML = weekItems.length
    ? weekItems.map(weekItemHtml).join("")
    : `<p class="empty-note">Nothing due ${isCurrent ? "this week" : "that week"}${state.dashboardScheme ? " for this scheme" : ""}.</p>`;
}

$("btn-week-prev").addEventListener("click", () => { state.dashboardWeekOffset--; renderWeeklyPanel(); });
$("btn-week-next").addEventListener("click", () => { state.dashboardWeekOffset++; renderWeeklyPanel(); });
$("btn-week-today").addEventListener("click", () => { state.dashboardWeekOffset = 0; renderWeeklyPanel(); });

function weekListClick(e) {
  if (!isAdmin()) return;
  const item = e.target.closest(".wk-item");
  if (!item) return;
  const c = state.compliances.find((x) => x.id === item.dataset.id);
  if (c) openDetail(c);
}
$("overdue-list").addEventListener("click", weekListClick);
$("due-this-week").addEventListener("click", weekListClick);

/* ============================ register ============================ */
function currentFilters() {
  return { search: $("f-search").value.trim().toLowerCase(), scheme: $("f-scheme").value, type: $("f-type").value, status: $("f-status").value };
}
[$("f-search"), $("f-scheme"), $("f-type"), $("f-status")].forEach((el) => el.addEventListener("input", renderRegister));

function renderRegister() {
  const { search, scheme, type, status } = currentFilters();
  let rows = state.compliances.map((c) => ({ ...c, _status: statusOf(c) }));
  if (scheme) rows = rows.filter((c) => c.scheme === scheme);
  if (type) rows = rows.filter((c) => (c.complianceType || "SEBI/AIF Regulatory") === type);
  if (status) rows = rows.filter((c) => c._status === status);
  if (search) rows = rows.filter((c) => (c.obligation || "").toLowerCase().includes(search));

  const order = { OVERDUE: 0, "DUE SOON": 1, UPCOMING: 2, ONGOING: 3, DONE: 4 };
  rows.sort((a, b) => (order[a._status] - order[b._status]) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  const ownerName = (email) => (state.team.find((t) => t.email === email) || {}).name || email || "—";

  $("register-empty").hidden = rows.length > 0;
  $("register-body").innerHTML = rows.map((c) => {
    const d = c.dueDate ? daysBetween(c.dueDate) : null;
    const daysLabel = c.completed ? "—" : c.dueDate ? (d < 0 ? `${Math.abs(d)}d over` : `${d}d`) : "—";
    return `
    <tr data-id="${esc(c.id)}" class="${isAdmin() ? "clickable" : ""}">
      <td class="col-due">${esc(fmtDay(c.dueDate) || "—")}</td>
      <td class="col-days">${esc(daysLabel)}</td>
      <td><span class="badge badge-${statusClass(c._status)}">${esc(c._status)}</span>${c.completed && c.proofPending ? '<span class="proof-pending-tag">Proof pending</span>' : ""}</td>
      <td>
        <span class="oblig-name">${esc(c.obligation)}</span>
        ${c.period ? `<span class="oblig-period">${esc(c.period)}</span>` : ""}
      </td>
      <td>${esc(c.scheme)}</td>
      <td><span class="type-tag">${esc(c.complianceType || "SEBI/AIF Regulatory")}</span></td>
      <td>${esc(ownerName(c.ownerEmail))}</td>
      <td>${c.link ? `<a class="row-link" href="${esc(c.link)}" target="_blank" rel="noopener">Open ↗</a>` : "—"}</td>
      <td>
        <div class="row-actions">
          ${c.dueDate ? `<input type="checkbox" class="check-done" title="Mark complete" ${c.completed ? "checked" : ""} data-action="toggle">` : ""}
          <button class="btn-icon" data-action="edit" title="Edit">✎</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

$("register-body").addEventListener("click", async (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  const c = state.compliances.find((x) => x.id === id);
  if (e.target.dataset.action === "edit") { openDrawer(c); return; }
  if (e.target.dataset.action === "toggle") { await toggleComplete(c, e.target.checked, e.target); return; }
  // Any other click on the row itself (not an action control) opens the
  // read-only detail view — admins only, matching the Dashboard behaviour.
  if (isAdmin() && c) openDetail(c);
});

async function toggleComplete(c, completed, checkboxEl) {
  if (completed) {
    // Mandatory at every level — Member, Team Lead, and Admin all hit this
    // same prompt. No link, no completion. Cancelling reverts the checkbox
    // rather than silently leaving it half-checked.
    const link = (prompt(
      "Paste the OneDrive link to the filed document.\n\nThis is required to mark the compliance complete."
    ) || "").trim();
    if (!link || !/^https?:\/\//i.test(link)) {
      if (checkboxEl) checkboxEl.checked = false;
      if (link) alert("That doesn't look like a link (must start with http:// or https://). Not marked complete.");
      return;
    }
    const patch = {
      completed: true, completedOn: todayISO(), filedBy: state.profile.name || state.user.email,
      completionProofLink: link, updatedAt: serverTimestamp()
    };
    await updateDoc(doc(db, "compliances", c.id), patch);
    Object.assign(c, patch);
  } else {
    const patch = { completed: false, completedOn: "", filedBy: "", completionProofLink: "", updatedAt: serverTimestamp() };
    await updateDoc(doc(db, "compliances", c.id), patch);
    Object.assign(c, patch);
  }
  renderDashboard();
  renderRegister();
  toast(completed ? "Marked complete — reminders stop" : "Marked incomplete");
}

/* ============================ detail modal (admin-only) ============================ */
function openDetail(c) {
  const status = statusOf(c);
  $("dt-obligation").textContent = c.obligation;
  $("dt-scheme-period").textContent = [c.scheme, c.period, c.fy].filter(Boolean).join(" · ");
  $("dt-status").textContent = status;
  $("dt-status").className = "badge badge-" + statusClass(status);
  $("dt-due").textContent = c.dueDate ? `Due ${fmtDay(c.dueDate)}` : "No fixed due date";

  const owner = state.team.find((t) => t.email === c.ownerEmail);
  if (owner) {
    $("dt-owner-name").textContent = owner.name || owner.email;
    $("dt-owner-email").textContent = owner.email;
  } else {
    $("dt-owner-name").textContent = "Unassigned";
    $("dt-owner-email").textContent = "";
  }

  // Hierarchy lookup: owner -> owner.reportsTo -> that person's record.
  // Team Leads and Admins have no reportsTo of their own — Admin is the
  // implicit top of the chain, so there's nothing further to show for them.
  let leadName = "—", leadEmail = "";
  if (owner && owner.role === "member" && owner.reportsTo) {
    const lead = state.team.find((t) => t.email === owner.reportsTo);
    if (lead) { leadName = lead.name || lead.email; leadEmail = lead.email; }
    else { leadName = "Assigned lead not found"; }
  } else if (owner && owner.role !== "member") {
    leadName = owner.role === "admin" ? "— (Admin is top of hierarchy)" : "Reports to Admin";
  } else if (owner) {
    leadName = "Not assigned yet";
  }
  $("dt-lead-name").textContent = leadName;
  $("dt-lead-email").textContent = leadEmail;

  $("dt-regulator").textContent = c.regulator || "—";
  $("dt-link").innerHTML = c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.link)}</a>` : "—";
  $("dt-notes").textContent = c.notes || "—";

  if (c.completed && c.completionProofLink) {
    $("dt-proof-row").hidden = false;
    $("dt-prooflink").innerHTML = `<a href="${esc(c.completionProofLink)}" target="_blank" rel="noopener">${esc(c.completionProofLink)}</a>`;
  } else if (c.completed && c.proofPending) {
    $("dt-proof-row").hidden = false;
    $("dt-prooflink").innerHTML = `<span class="proof-pending-tag">Proof pending</span> — imported from Excel without a stored link. Edit this compliance to add one.`;
  } else {
    $("dt-proof-row").hidden = true;
  }

  $("btn-detail-edit").onclick = () => { closeDetail(); openDrawer(c); };

  $("detail-backdrop").hidden = false;
  $("detail-modal").hidden = false;
}
function closeDetail() {
  $("detail-backdrop").hidden = true;
  $("detail-modal").hidden = true;
}
$("btn-detail-close").addEventListener("click", closeDetail);
$("detail-backdrop").addEventListener("click", closeDetail);

/* ============================ drawer: add/edit compliance ============================ */
$("btn-add").addEventListener("click", () => openDrawer(null));

$("btn-drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
$("c-completed").addEventListener("change", (e) => { $("done-fields").hidden = !e.target.checked; });

let lastCTypeValue = "SEBI/AIF Regulatory";
$("c-type").addEventListener("change", async (e) => {
  if (e.target.value !== "__add_new__") { lastCTypeValue = e.target.value; return; }

  const name = (prompt('New compliance type name (e.g. "SEBI/AIF — Reporting", "SEBI/AIF — Governance"):') || "").trim();
  if (!name) { e.target.value = lastCTypeValue; return; }
  if (state.complianceTypes.some((t) => t.toLowerCase() === name.toLowerCase())) {
    alert("That type already exists.");
    e.target.value = lastCTypeValue;
    return;
  }

  try {
    const ref = doc(collection(db, "complianceTypes")); // auto-generated ID — avoids
    await setDoc(ref, { name, createdAt: serverTimestamp(), createdBy: state.user.email });
    await loadComplianceTypes();
    populateSchemeOptions();
    $("c-type").value = name;
    lastCTypeValue = name;
    toast("Type added — available everywhere from now on");
  } catch (err) {
    alert(err.message || "Couldn't add that type.");
    e.target.value = lastCTypeValue;
  }
});

/* ============================ manage types modal ============================ */
function usageCountFor(typeName) {
  return state.compliances.filter((c) => (c.complianceType || "SEBI/AIF Regulatory") === typeName).length;
}

function openTypesModal() {
  state.typesModal = { mode: null, target: null, remaining: [], staged: [] };
  $("types-view-list").hidden = false;
  $("types-view-checklist").hidden = true;
  $("types-modal-title").textContent = "Manage types";
  renderTypesList();
  $("types-backdrop").hidden = false;
  $("types-modal").hidden = false;
}
function closeTypesModal() {
  $("types-backdrop").hidden = true;
  $("types-modal").hidden = true;
  state.typesModal = { mode: null, target: null, remaining: [], staged: [] };
}
$("btn-manage-types").addEventListener("click", openTypesModal);
$("btn-manage-types-register").addEventListener("click", openTypesModal);
$("btn-types-close").addEventListener("click", closeTypesModal);
$("types-backdrop").addEventListener("click", closeTypesModal);
$("btn-types-back").addEventListener("click", () => {
  $("types-view-list").hidden = false;
  $("types-view-checklist").hidden = true;
  $("types-modal-title").textContent = "Manage types";
  renderTypesList();
});

function renderTypesList() {
  $("types-list-body").innerHTML = state.complianceTypes.map((t) => {
    const count = usageCountFor(t);
    return `
    <tr>
      <td>${esc(t)}</td>
      <td>${count}</td>
      <td class="row-actions">
        <button type="button" class="btn-icon t-reassign" data-type="${esc(t)}">Reassign</button>
        ${canManageTypes() ? `<button type="button" class="btn-icon t-delete" data-type="${esc(t)}">Delete</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}
$("types-list-body").addEventListener("click", (e) => {
  const type = e.target.dataset.type;
  if (!type) return;
  if (e.target.classList.contains("t-reassign")) startTypesChecklist(type, "reassign");
  if (e.target.classList.contains("t-delete")) startTypesChecklist(type, "delete");
});

function startTypesChecklist(type, mode) {
  state.typesModal = {
    mode, target: type,
    remaining: state.compliances.filter((c) => (c.complianceType || "SEBI/AIF Regulatory") === type).slice(),
    staged: []
  };
  $("types-view-list").hidden = true;
  $("types-view-checklist").hidden = false;
  $("types-modal-title").textContent = mode === "delete" ? "Delete a type" : "Reassign compliances";
  $("types-checklist-mode-label").textContent = mode === "delete" ? "Deleting:" : "Reassigning from:";
  $("types-checklist-target").textContent = type;
  $("types-checklist-help").textContent = mode === "delete"
    ? "Every compliance below must be moved elsewhere before this type can be deleted."
    : "Select any compliances you'd like to move to a different type. Anything left unselected stays as it is.";
  $("types-checklist-error").hidden = true;
  populateTypesDestination();
  renderTypesChecklist();
}

function populateTypesDestination() {
  const target = state.typesModal.target;
  const others = state.complianceTypes.filter((t) => t !== target);
  $("types-destination").innerHTML =
    others.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("") +
    `<option value="__add_new__">+ Create new type…</option>`;
}

function renderTypesChecklist() {
  const { remaining, staged, mode } = state.typesModal;

  $("types-staged-wrap").hidden = staged.length === 0;
  $("types-staged-list").innerHTML = staged.map((g, i) => `
    <div class="staged-item">
      <span>${g.ids.length} item${g.ids.length === 1 ? "" : "s"} → <strong>${esc(g.newType)}</strong></span>
      <button type="button" class="btn-link t-undo" data-idx="${i}">Undo</button>
    </div>`).join("");

  $("types-remaining-label").textContent = `Remaining (${remaining.length})`;
  $("types-select-all").checked = false;
  $("types-checklist-items").innerHTML = remaining.length
    ? remaining.map((c) => `
      <label class="checklist-row">
        <input type="checkbox" class="cr-check" data-id="${esc(c.id)}">
        <span class="cr-name">${esc(c.obligation)}</span>
        <span class="cr-meta">${esc(c.scheme)}</span>
      </label>`).join("")
    : `<p class="empty-note">Nothing left${mode === "reassign" ? "" : " — ready to delete"}.</p>`;

  const commitBtn = $("btn-types-commit");
  if (mode === "delete") {
    commitBtn.textContent = "Confirm & Delete Type";
    commitBtn.disabled = remaining.length > 0;
  } else {
    commitBtn.textContent = staged.length ? "Finish — apply changes" : "Finish (nothing to apply)";
    commitBtn.disabled = false;
  }
}

$("types-select-all").addEventListener("change", (e) => {
  document.querySelectorAll("#types-checklist-items .cr-check").forEach((cb) => { cb.checked = e.target.checked; });
});

$("types-staged-list").addEventListener("click", (e) => {
  if (!e.target.classList.contains("t-undo")) return;
  const idx = Number(e.target.dataset.idx);
  const [group] = state.typesModal.staged.splice(idx, 1);
  state.typesModal.remaining.push(...group.items);
  renderTypesChecklist();
});

$("btn-types-assign").addEventListener("click", async () => {
  const err = $("types-checklist-error");
  err.hidden = true;
  const checked = Array.from(document.querySelectorAll("#types-checklist-items .cr-check:checked")).map((cb) => cb.dataset.id);
  if (checked.length === 0) { err.textContent = "Select at least one compliance first."; err.hidden = false; return; }

  let destination = $("types-destination").value;
  if (destination === "__add_new__") {
    const name = (prompt("New type name:") || "").trim();
    if (!name) return;
    if (state.complianceTypes.some((t) => t.toLowerCase() === name.toLowerCase())) {
      err.textContent = "That type already exists — pick it from the dropdown instead.";
      err.hidden = false;
      return;
    }
    try {
      const ref = doc(collection(db, "complianceTypes"));
      await setDoc(ref, { name, createdAt: serverTimestamp(), createdBy: state.user.email });
      await loadComplianceTypes();
      populateSchemeOptions(); // keeps c-type/f-type/d-type dropdowns in sync too
      populateTypesDestination();
      destination = name;
      $("types-destination").value = name;
    } catch (e2) {
      err.textContent = e2.message || "Couldn't create that type.";
      err.hidden = false;
      return;
    }
  }

  const movedItems = state.typesModal.remaining.filter((c) => checked.includes(c.id));
  state.typesModal.remaining = state.typesModal.remaining.filter((c) => !checked.includes(c.id));
  state.typesModal.staged.push({ ids: checked, items: movedItems, newType: destination });
  renderTypesChecklist();
});

$("btn-types-commit").addEventListener("click", async () => {
  const { mode, target, staged, remaining } = state.typesModal;
  if (mode === "delete" && remaining.length > 0) return; // button is disabled in this state anyway

  const totalMoved = staged.reduce((n, g) => n + g.ids.length, 0);
  if (staged.length === 0 && mode !== "delete") { closeTypesModal(); return; }

  const confirmMsg = mode === "delete"
    ? `This will ${totalMoved ? `reassign ${totalMoved} compliance(s) and ` : ""}permanently delete "${target}". Continue?`
    : `Apply ${totalMoved} reassignment(s)? Anything left unselected stays under "${target}".`;
  if (!confirm(confirmMsg)) return;

  try {
    const batch = writeBatch(db);
    staged.forEach((g) => g.ids.forEach((id) =>
      batch.update(doc(db, "compliances", id), { complianceType: g.newType, updatedAt: serverTimestamp() })
    ));
    if (mode === "delete") {
      const typeDoc = state.complianceTypeDocs.find((d) => d.name === target);
      if (typeDoc) batch.delete(doc(db, "complianceTypes", typeDoc.id));
    }
    await batch.commit();

    await Promise.all([loadComplianceTypes(), loadCompliances()]);
    populateSchemeOptions();
    renderRegister();
    renderDashboard();
    toast(mode === "delete" ? `Deleted "${target}"` : `Reassigned ${totalMoved} compliance(s)`);
    closeTypesModal();
  } catch (e) {
    alert(e.message || "Couldn't save those changes.");
    console.error(e);
  }
});

function openDrawer(c) {
  state.editingId = c ? c.id : null;
  $("drawer-title").textContent = c ? "Edit compliance" : "Add compliance";
  $("btn-delete").hidden = !(c && isAdmin());
  $("drawer-error").hidden = true;

  $("c-id").value = c ? c.id : "";
  $("c-obligation").value = c ? c.obligation : "";
  $("c-scheme").value = c ? c.scheme : (state.schemes.find((s) => s.active) || {}).name || "";
  $("c-type").value = c ? (c.complianceType || "SEBI/AIF Regulatory") : "SEBI/AIF Regulatory";
  lastCTypeValue = $("c-type").value;
  $("c-frequency").value = c ? c.frequency || "" : "";
  $("c-period").value = c ? c.period || "" : "";
  $("c-fy").value = c ? c.fy || "" : "";
  $("c-duedate").value = c ? c.dueDate || "" : "";
  $("c-lead").value = c ? c.reminderLeadDays || 15 : 15;
  $("c-regulator").value = c ? c.regulator || "" : "";
  $("c-link").value = c ? c.link || "" : "";
  $("c-owner").value = c ? c.ownerEmail || "" : "";
  $("c-cc").value = c ? c.ccEmail || "" : "";
  $("c-notes").value = c ? c.notes || "" : "";
  $("c-completed").checked = !!(c && c.completed);
  $("done-fields").hidden = !(c && c.completed);
  $("c-prooflink").value = c ? c.completionProofLink || "" : "";
  $("c-completedon").value = c ? c.completedOn || "" : "";
  $("c-filedby").value = c ? c.filedBy || "" : "";
  $("c-ackref").value = c ? c.ackRefNo || "" : "";

  $("drawer-backdrop").hidden = false;
  $("drawer").hidden = false;
  $("drawer").setAttribute("aria-hidden", "false");
  $("c-obligation").focus();
}
function closeDrawer() {
  $("drawer-backdrop").hidden = true;
  $("drawer").hidden = true;
  $("drawer").setAttribute("aria-hidden", "true");
  state.editingId = null;
}

function slugCode(text) {
  return (text || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "OBLIG";
}
function schemeCodeFor(name) {
  const found = state.schemes.find((s) => s.name === name);
  return found ? found.code : slugCode(name);
}

$("form-compliance").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("drawer-error");
  err.hidden = true;

  const dueDate = $("c-duedate").value;
  const obligation = $("c-obligation").value.trim();
  const scheme = $("c-scheme").value;
  if (!obligation || !scheme) { err.textContent = "Obligation and scheme are required."; err.hidden = false; return; }

  const completed = $("c-completed").checked;
  const proofLink = $("c-prooflink").value.trim();
  if (completed && (!proofLink || !/^https?:\/\//i.test(proofLink))) {
    err.textContent = "A OneDrive link to the filed document is required to mark this complete.";
    err.hidden = false;
    return;
  }

  const payload = {
    obligation, scheme,
    complianceType: $("c-type").value || "SEBI/AIF Regulatory",
    frequency: $("c-frequency").value,
    period: $("c-period").value.trim(),
    fy: $("c-fy").value.trim(),
    dueDate,
    reminderLeadDays: Number($("c-lead").value) || 15,
    regulator: $("c-regulator").value.trim(),
    link: $("c-link").value.trim(),
    ownerEmail: $("c-owner").value,
    ccEmail: $("c-cc").value,
    notes: $("c-notes").value.trim(),
    completed,
    completionProofLink: completed ? proofLink : "",
    completedOn: completed ? ($("c-completedon").value || todayISO()) : "",
    filedBy: completed ? ($("c-filedby").value.trim() || state.profile.name || state.user.email) : "",
    ackRefNo: completed ? $("c-ackref").value.trim() : "",
    updatedAt: serverTimestamp()
  };

  const existingId = $("c-id").value;
  const id = existingId || `${schemeCodeFor(scheme)}-${slugCode(obligation)}-${dueDate ? dueDate.replace(/-/g, "") : "ONG"}`;

  try {
    await setDoc(doc(db, "compliances", id), {
      ...payload,
      ...(existingId ? {} : { createdAt: serverTimestamp(), createdBy: state.user.email })
    }, { merge: true });
    toast(existingId ? "Compliance updated" : "Compliance added");
    closeDrawer();
    await loadCompliances();
    renderDashboard();
    renderRegister();
  } catch (e2) {
    err.textContent = e2.message || "Couldn't save that.";
    err.hidden = false;
  }
});

$("btn-delete").addEventListener("click", async () => {
  const id = $("c-id").value;
  if (!id) return;
  if (!confirm("Delete this compliance permanently?")) return;
  await deleteDoc(doc(db, "compliances", id));
  toast("Deleted");
  closeDrawer();
  await loadCompliances();
  renderDashboard();
  renderRegister();
});

/* ============================ schemes ============================ */
function renderSchemes() {
  $("schemes-body").innerHTML = state.schemes.map((s) => {
    const count = state.compliances.filter((c) => c.scheme === s.name).length;
    return `
    <tr data-code="${esc(s.code)}">
      <td>${esc(s.name)}</td>
      <td><span class="type-tag">${esc(s.code)}</span></td>
      <td>${count}</td>
      <td>${s.active ? "Active" : "Archived"}</td>
      <td>${isAdmin() ? `<button class="btn-icon s-toggle" data-code="${esc(s.code)}">${s.active ? "Archive" : "Restore"}</button>` : ""}</td>
    </tr>`;
  }).join("");
}

$("schemes-body").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("s-toggle")) return;
  const code = e.target.dataset.code;
  const scheme = state.schemes.find((s) => s.code === code);
  if (!scheme) return;
  if (scheme.active && !confirm(
    `Archive "${scheme.name}"?\n\nIts existing compliance rows stay exactly as they are — nothing is deleted. ` +
    `It just disappears from the scheme dropdown when adding new compliances, and from the filter lists ` +
    `used to pick a scheme going forward.`
  )) return;
  await updateDoc(doc(db, "schemes", code), { active: !scheme.active });
  await loadSchemes();
  renderSchemes();
  populateSchemeOptions();
  toast(scheme.active ? "Scheme archived" : "Scheme restored");
});

$("btn-add-scheme").addEventListener("click", async () => {
  const name = (prompt("New scheme's full name (as it should appear everywhere):") || "").trim();
  if (!name) return;
  if (state.schemes.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    alert("A scheme with that name already exists.");
    return;
  }

  let code = (prompt("Short code for this scheme (2\u20136 letters, used in internal IDs — not shown to investors):") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) { alert("A short code is required."); return; }
  if (state.schemes.some((s) => s.code === code)) {
    alert(`Code "${code}" is already used by another scheme. Pick a different one.`);
    return;
  }

  const activeSchemes = state.schemes.filter((s) => s.active);
  let templateScheme = null;
  if (activeSchemes.length) {
    const list = activeSchemes.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
    const pick = prompt(
      `Clone every obligation from an existing scheme? This copies obligations, ` +
      `frequencies, regulators, and CURRENT due dates \u2014 correct for calendar-based filings, ` +
      `since a new scheme owes the same upcoming filing as everyone else.\n\n` +
      `Type a number to clone from that scheme, or leave blank to start empty:\n${list}`
    );
    const idx = parseInt(pick, 10) - 1;
    if (activeSchemes[idx]) templateScheme = activeSchemes[idx];
  }

  const btn = $("btn-add-scheme");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "schemes", code), { code, name, active: true, createdAt: serverTimestamp(), createdBy: state.user.email });

    if (templateScheme) {
      const sourceRows = state.compliances.filter((c) => c.scheme === templateScheme.name);
      const batch = writeBatch(db);
      let n = 0;
      for (const src of sourceRows) {
        const {
          id, scheme, ownerEmail, ccEmail, link, completed, completedOn, filedBy, ackRefNo,
          createdAt, createdBy, updatedAt, lastReminderSent, reminderCount, ...rest
        } = src;
        const newId = `${code}-${slugCode(rest.obligation)}-${rest.dueDate ? rest.dueDate.replace(/-/g, "") : "ONG"}`;
        batch.set(doc(db, "compliances", newId), {
          ...rest, scheme: name,
          ownerEmail: "", ccEmail: "", link: "",
          completed: false, completedOn: "", filedBy: "", ackRefNo: "",
          createdAt: serverTimestamp(), createdBy: state.user.email
        }, { merge: true });
        n++;
      }
      await batch.commit();
      toast(`Scheme added \u2014 cloned ${n} obligations from ${templateScheme.name}`);
    } else {
      toast("Scheme added \u2014 no obligations cloned, starting empty");
    }

    await Promise.all([loadSchemes(), loadCompliances()]);
    populateSchemeOptions();
    renderSchemes();
    renderRegister();
    renderDashboard();
  } catch (e2) {
    alert(e2.message || "Couldn't add that scheme.");
    console.error(e2);
  } finally {
    btn.disabled = false;
  }
});

/* ============================ excel import ============================ */
const EXCEL_EXPECTED_HEADERS = [
  "compliance obligation", "financial year of period", "frequency", "period / milestone",
  "format status", "due date", "regulator / authority", "owner", "completion status", "document link"
];
const normalizeHeader = (h) => String(h || "").trim().toLowerCase();

$("btn-import-excel").addEventListener("click", () => $("excel-file-input").click());
$("excel-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // lets the same file be re-picked later without a no-op
  if (!file) return;
  openExcelModal();
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    processWorkbook(wb);
  } catch (err) {
    alert("Couldn't read that file: " + (err.message || err));
    closeExcelModal();
  }
});

function openExcelModal() {
  $("excel-view-loading").hidden = false;
  $("excel-view-resolve").hidden = true;
  $("excel-view-review").hidden = true;
  $("excel-view-empty").hidden = true;
  $("excel-backdrop").hidden = false;
  $("excel-modal").hidden = false;
}
function closeExcelModal() {
  $("excel-backdrop").hidden = true;
  $("excel-modal").hidden = true;
  state.excelImport = null;
}
$("btn-excel-close").addEventListener("click", closeExcelModal);
$("btn-excel-cancel").addEventListener("click", closeExcelModal);
$("excel-backdrop").addEventListener("click", closeExcelModal);

function excelDateToISO(cell) {
  if (cell instanceof Date && !isNaN(cell)) return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
  return null;
}

function processWorkbook(wb) {
  const sheetResults = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    if (rows.length < 3) continue;
    const headerRow = (rows[1] || []).map(normalizeHeader);
    const isSchemeSheet = EXCEL_EXPECTED_HEADERS.every((h, i) => headerRow[i] === h);
    if (!isSchemeSheet) continue; // Summary/reference/Dashboard sheets don't match this shape — skipped, not an error

    const schemeNameRaw = String(rows[0][0] || "").split(/[—–-]/)[0].trim();
    const dataRows = [];
    let inOngoingSection = false;
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r] || [];
      const col0 = String(row[0] || "").trim();
      if (!col0) continue;
      if (/ONGOING.*EVENT-BASED/i.test(col0)) { inOngoingSection = true; continue; }
      dataRows.push({ rowNum: r + 1, cells: row, ongoing: inOngoingSection });
    }
    sheetResults.push({ sheetName, schemeNameRaw, dataRows });
  }

  if (sheetResults.length === 0) {
    $("excel-view-loading").hidden = true;
    $("excel-view-empty").hidden = false;
    return;
  }

  const resolved = {};
  const unresolvedSet = new Set();
  for (const sr of sheetResults) {
    const exact = state.schemes.find((s) => s.name.toLowerCase() === sr.schemeNameRaw.toLowerCase());
    const partial = exact || state.schemes.find((s) =>
      sr.schemeNameRaw.toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(sr.schemeNameRaw.toLowerCase())
    );
    if (partial) resolved[sr.schemeNameRaw] = partial.name;
    else unresolvedSet.add(sr.schemeNameRaw);
  }

  state.excelImport = { sheetResults, resolved, unresolved: [...unresolvedSet] };
  $("excel-view-loading").hidden = true;

  if (state.excelImport.unresolved.length > 0) {
    renderExcelResolveView();
    $("excel-view-resolve").hidden = false;
  } else {
    buildExcelReview();
  }
}

function renderExcelResolveView() {
  $("excel-resolve-list").innerHTML = state.excelImport.unresolved.map((name) => `
    <div class="resolve-row">
      <span class="rr-label">"${esc(name)}"</span>
      <select class="resolve-select" data-name="${esc(name)}">
        ${state.schemes.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("")}
        <option value="__create_new__" selected>+ Create new scheme "${esc(name)}"</option>
      </select>
    </div>`).join("");
}

$("btn-excel-resolve-continue").addEventListener("click", async () => {
  const btn = $("btn-excel-resolve-continue");
  btn.disabled = true;
  try {
    for (const sel of document.querySelectorAll(".resolve-select")) {
      const rawName = sel.dataset.name;
      let choice = sel.value;
      if (choice === "__create_new__") {
        let code = slugCode(rawName), n = 1;
        while (state.schemes.some((s) => s.code === code)) { code = slugCode(rawName + n); n++; }
        await setDoc(doc(db, "schemes", code), { code, name: rawName, active: true, createdAt: serverTimestamp(), createdBy: state.user.email });
        choice = rawName;
      }
      state.excelImport.resolved[rawName] = choice;
    }
    await loadSchemes();
    populateSchemeOptions();
    $("excel-view-resolve").hidden = true;
    buildExcelReview();
  } catch (e) {
    alert(e.message || "Couldn't create that scheme.");
  } finally {
    btn.disabled = false;
  }
});

function buildExcelReview() {
  const { sheetResults, resolved } = state.excelImport;
  const changes = [];
  const errors = [];

  for (const sr of sheetResults) {
    const schemeName = resolved[sr.schemeNameRaw];
    for (const row of sr.dataRows) {
      const c = row.cells;
      const obligation = String(c[0] || "").trim();
      if (!obligation) { errors.push(`${sr.sheetName} row ${row.rowNum}: missing obligation name — skipped`); continue; }

      const fy = String(c[1] || "").trim();
      const frequency = String(c[2] || "").trim();
      const period = String(c[3] || "").trim();
      const formatStatus = String(c[4] || "").trim();
      const dueCell = c[5];
      const regulator = String(c[6] || "").trim();
      const ownerRoleText = String(c[7] || "").trim();
      const completed = String(c[8] || "").trim().toLowerCase() === "yes";
      const documentLink = String(c[9] || "").trim();

      let dueDate = excelDateToISO(dueCell);
      let dueRuleNote = "";
      if (!dueDate && !row.ongoing && dueCell) {
        errors.push(`${sr.sheetName} row ${row.rowNum} ("${obligation}"): due date isn't a recognizable date ("${dueCell}") — skipped`);
        continue;
      }
      if (!dueDate && dueCell) dueRuleNote = `Due rule: ${dueCell}.`;

      const proofPending = completed && !documentLink;
      const notes = [dueRuleNote, formatStatus && `Filing mode: ${formatStatus}.`, ownerRoleText && `Suggested owner role: ${ownerRoleText}.`]
        .filter(Boolean).join(" ");

      const id = `${schemeCodeFor(schemeName)}-${slugCode(obligation)}-${dueDate ? dueDate.replace(/-/g, "") : "ONG"}`;
      const existing = state.compliances.find((x) => x.id === id);
      const basePayload = { obligation, scheme: schemeName, frequency, period, fy, dueDate: dueDate || "", regulator, notes, updatedAt: serverTimestamp() };

      if (!existing) {
        changes.push({
          id, isNew: true,
          payload: {
            ...basePayload, complianceType: "SEBI/AIF Regulatory", reminderLeadDays: 15,
            ownerEmail: "", ccEmail: "", link: "", completed, proofPending,
            completionProofLink: documentLink || "", completedOn: completed ? todayISO() : "",
            filedBy: completed ? "Imported from Excel" : "", ackRefNo: "",
            createdAt: serverTimestamp(), createdBy: state.user.email
          }
        });
      } else {
        const payload = { ...basePayload };
        // Never revert a completion the app already treats as genuinely confirmed
        // (a real proof link, not proofPending) back to incomplete — a stale sheet
        // can only move a row forward, never undo confirmed work.
        const alreadyConfirmed = existing.completed && !existing.proofPending;
        if (!alreadyConfirmed) {
          if (completed && !existing.completed) {
            payload.completed = true;
            payload.proofPending = proofPending;
            payload.completionProofLink = documentLink || existing.completionProofLink || "";
            payload.completedOn = existing.completedOn || todayISO();
            payload.filedBy = existing.filedBy || "Imported from Excel";
          } else if (completed && existing.completed && existing.proofPending && documentLink) {
            payload.completionProofLink = documentLink;
            payload.proofPending = false;
          }
        }
        changes.push({ id, isNew: false, payload });
      }
    }
  }

  state.excelImport.changes = changes;
  state.excelImport.errors = errors;
  renderExcelReview();
}

function renderExcelReview() {
  const { changes, errors } = state.excelImport;
  $("ex-new").textContent = changes.filter((c) => c.isNew).length;
  $("ex-updated").textContent = changes.filter((c) => !c.isNew).length;
  $("ex-proofpending").textContent = changes.filter((c) => c.payload.proofPending).length;
  $("ex-errors").textContent = errors.length;

  $("excel-errors-wrap").hidden = errors.length === 0;
  $("excel-errors-list").innerHTML = errors.map((e) => `<div class="checklist-row"><span class="cr-name">${esc(e)}</span></div>`).join("");

  $("btn-excel-commit").disabled = changes.length === 0;
  $("excel-view-review").hidden = false;
}

$("btn-excel-commit").addEventListener("click", async () => {
  const { changes } = state.excelImport || {};
  if (!changes || changes.length === 0) { closeExcelModal(); return; }
  const btn = $("btn-excel-commit");
  btn.disabled = true;
  try {
    let batch = writeBatch(db);
    let n = 0;
    for (const ch of changes) {
      batch.set(doc(db, "compliances", ch.id), ch.payload, { merge: true });
      n++;
      if (n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
    await loadCompliances();
    renderRegister();
    renderDashboard();
    toast(`Imported: ${changes.filter((c) => c.isNew).length} new, ${changes.filter((c) => !c.isNew).length} updated`);
    closeExcelModal();
  } catch (e) {
    alert(e.message || "Import failed partway through — check the browser console.");
    console.error(e);
    btn.disabled = false;
  }
});

/* ============================ team ============================ */
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "teamlead" ? "Team Lead" : "Member");

function renderTeam() {
  const leads = state.team.filter((t) => t.role === "teamlead" && t.active);

  $("team-body").innerHTML = state.team.map((t) => {
    const roleCell = isAdmin() ? `
        <select class="t-role" data-email="${esc(t.email)}">
          <option value="member" ${t.role === "member" ? "selected" : ""}>Member</option>
          <option value="teamlead" ${t.role === "teamlead" ? "selected" : ""}>Team Lead</option>
          <option value="admin" ${t.role === "admin" ? "selected" : ""}>Admin</option>
        </select>` : esc(roleLabel(t.role));

    const reportsCell = t.role !== "member"
      ? `<span class="detail-sub">${t.role === "admin" ? "— top of hierarchy —" : "Reports to Admin"}</span>`
      : isAdmin()
        ? `<select class="t-reports" data-email="${esc(t.email)}">
             <option value="">Unassigned</option>
             ${leads.map((l) => `<option value="${esc(l.email)}" ${t.reportsTo === l.email ? "selected" : ""}>${esc(l.name || l.email)}</option>`).join("")}
           </select>`
        : esc((leads.find((l) => l.email === t.reportsTo) || {}).name || "Unassigned");

    return `
    <tr data-email="${esc(t.email)}">
      <td>${esc(t.name || "—")}</td>
      <td>${esc(t.email)}</td>
      <td>${roleCell}</td>
      <td>${reportsCell}</td>
      <td>${t.active ? "Active" : "Removed"}</td>
      <td>${isAdmin() ? `<button class="btn-icon t-toggle" data-email="${esc(t.email)}">${t.active ? "Remove" : "Restore"}</button>` : ""}</td>
    </tr>`;
  }).join("");
}

$("team-body").addEventListener("change", async (e) => {
  const email = e.target.dataset.email;
  if (!email) return;
  if (e.target.classList.contains("t-role")) {
    const newRole = e.target.value;
    // Reports-to only means something for a Member — clear it the moment
    // someone becomes a Team Lead or Admin, so stale hierarchy data doesn't
    // linger and show up wrong in the compliance detail view later.
    const patch = { role: newRole };
    if (newRole !== "member") patch.reportsTo = "";
    await updateDoc(doc(db, "users", email), patch);
    await loadTeam(); renderTeam(); populateSchemeOptions();
    toast("Role updated");
  } else if (e.target.classList.contains("t-reports")) {
    await updateDoc(doc(db, "users", email), { reportsTo: e.target.value });
    await loadTeam(); renderTeam();
    toast("Reporting line updated");
  }
});
$("team-body").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("t-toggle")) return;
  const email = e.target.dataset.email;
  const person = state.team.find((t) => t.email === email);
  await updateDoc(doc(db, "users", email), { active: !person.active });
  await loadTeam(); renderTeam(); populateSchemeOptions();
  toast(person.active ? "Access removed" : "Access restored");
});

$("btn-add-person").addEventListener("click", async () => {
  const name = prompt("Full name:");
  if (!name) return;
  const email = (prompt(`Work email (must end @${ORG_DOMAIN}):`) || "").trim().toLowerCase();
  if (!email.endsWith("@" + ORG_DOMAIN)) { alert(`Must be an @${ORG_DOMAIN} address.`); return; }

  const roleInput = (prompt("Role — type one of: member, teamlead, admin", "member") || "").trim().toLowerCase();
  const role = ["member", "teamlead", "admin"].includes(roleInput) ? roleInput : "member";

  let reportsTo = "";
  if (role === "member") {
    const leads = state.team.filter((t) => t.role === "teamlead" && t.active);
    if (leads.length) {
      const list = leads.map((l, i) => `${i + 1}. ${l.name || l.email}`).join("\n");
      const pick = prompt(`Reports to which Team Lead? Type a number, or leave blank to assign later:\n${list}`);
      const idx = parseInt(pick, 10) - 1;
      if (leads[idx]) reportsTo = leads[idx].email;
    } else {
      alert("No Team Leads exist yet — this person will show as Unassigned until you add one and set it from the Team tab.");
    }
  }

  await setDoc(doc(db, "users", email), { email, name, role, active: true, reportsTo });
  await loadTeam(); renderTeam(); populateSchemeOptions();
  toast("Person added");
});

/* ============================ toast ============================ */
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
