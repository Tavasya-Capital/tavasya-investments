// The Investor Relations section. Built on the same pattern as
// Investments: investors (like investments) each carry their own tasks,
// with sub-tasks, reminders and the team's drag-and-drop order.
import { ORG_DOMAIN, OPTIONS } from "./config.js";
import { db, requireSession, signOutWithConfirm } from "./common.js";
import {
  collection, doc, getDocs, setDoc, addDoc,
  deleteDoc, serverTimestamp, writeBatch, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ============================ setup ============================ */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  team: [],
  schemes: [],
  investors: [],
  tasks: [],
  optionLists: {},           // dropdown values added from inside the app
  schemeFilter: "",          // "" = all schemes; otherwise a scheme code
  openInvestorId: null,    // non-null when the detail view is showing
  showDoneTasks: false,
  dashStatusFilter: "",
  weekOffset: 0,
  taskSort: "custom",        // "custom" = the team's drag-and-drop order; "due" = by status and date
  expandedTasks: new Set()   // Tasks tab rows whose sub-task preview is open
};

const isAdmin = () => state.profile && state.profile.role === "admin";
const isTeamLead = () => state.profile && state.profile.role === "teamlead";
const canDeleteTask = () => isAdmin() || isTeamLead();

const SCHEME_KEY = "tavasya-inv-scheme";
const TASK_SORT_KEY = "tavasya-ir-task-sort";

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

// Amounts are held in ₹ crore. A blank stays blank — it is never
// silently treated as zero, because "not yet known" and "nil" are
// very different things on a deal sheet.
const fmtCr = (n) =>
  (n === null || n === undefined || n === "" || isNaN(n))
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(v);
const sumCr = (arr, key) => {
  const vals = arr.map((x) => x[key]).filter((v) => v !== null && v !== undefined && v !== "" && !isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
};

/* A task is either time-bound (has a due date, emails reminders) or
   open-ended (tracked, never emails). Everything downstream — badges,
   KPI counts, the reminder script — keys off this one function. */
function taskStatus(t) {
  if (t.completed) return "DONE";
  if (t.taskType !== "timed" || !t.dueDate) return "OPEN";
  const d = daysBetween(t.dueDate);
  if (d < 0) return "OVERDUE";
  if (d <= 7) return "DUE SOON";
  return "UPCOMING";
}
const STATUS_LABEL = {
  "OVERDUE": "Overdue", "DUE SOON": "Due soon", "UPCOMING": "Upcoming",
  "OPEN": "Open", "DONE": "Completed"
};
const statusClass = (s) => s.replace(/\s/g, "");
// Priorities can now be added by hand, so strip anything that wouldn't be
// valid in a CSS class name. A custom priority simply gets the neutral
// default styling; High and Critical keep their colours.
const prioClass = (p) => "prio-" + String(p ?? "").replace(/[^A-Za-z0-9]/g, "");
const badge = (s) => `<span class="badge badge-${statusClass(s)}">${STATUS_LABEL[s] || esc(s)}</span>`;

/* Task order. "By status and due date" is the fixed order the app always
   used. "Our order" is the one the team sets by dragging rows on the Tasks
   tab, saved as a `sortOrder` number on each task, so everyone sees the
   same order. Completed tasks always sink to the bottom. A task nobody has
   placed yet (no sortOrder) sits after the placed ones in the fixed order,
   which means that until someone drags something, both orders match. */
const STATUS_RANK = { "OVERDUE": 0, "DUE SOON": 1, "UPCOMING": 2, "OPEN": 3, "DONE": 4 };
function byStatusThenDue(a, b) {
  const d = STATUS_RANK[taskStatus(a)] - STATUS_RANK[taskStatus(b)];
  if (d !== 0) return d;
  return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
}
function byTeamOrder(a, b) {
  if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
  const pa = typeof a.sortOrder === "number", pb = typeof b.sortOrder === "number";
  if (pa && pb && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (pa !== pb) return pa ? -1 : 1;
  return byStatusThenDue(a, b);
}
const taskOrder = () => (state.taskSort === "due" ? byStatusThenDue : byTeamOrder);

const subtaskCount = (t) => {
  const all = t.subtasks || [];
  return { done: all.filter((st) => st.done).length, total: all.length };
};
function subtaskListHtml(t) {
  return `<ul class="subtask-list" data-task="${esc(t.id)}">${(t.subtasks || []).map((st) => `
    <li><label class="subtask-item${st.done ? " done" : ""}">
      <input type="checkbox" class="st-check" data-st="${esc(st.id)}" ${st.done ? "checked" : ""}>
      <span>${esc(st.title)}</span>
    </label></li>`).join("")}</ul>`;
}

const personName = (email) => {
  if (!email) return "Unassigned";
  const p = state.team.find((t) => t.email === email);
  return p ? (p.name || p.email) : email;
};
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "teamlead" ? "Team Lead" : "Member");

/* ============================ sign-in ============================
   Signing in happens on index.html. This page just waits for the session
   and sends anyone without one back there. */
$("btn-signout").addEventListener("click", signOutWithConfirm);

requireSession("investor-relations").then(({ user, profile }) => {
  state.user = user;
  state.profile = profile;
  boot();
});

async function boot() {
  const user = state.user;
  $("who-name").textContent = `${state.profile.name || user.email} · ${roleLabel(state.profile.role)}`;

  await Promise.all([loadTeam(), loadSchemes(), loadInvestors(), loadTasks(), loadOptionLists()]);
  await ensureDefaultSchemes();

  $("btn-add-person").hidden = !isAdmin();
  $("btn-add-scheme").hidden = !isAdmin();

  try {
    const saved = localStorage.getItem(SCHEME_KEY);
    if (saved && (saved === "" || activeSchemes().some((s) => s.code === saved))) state.schemeFilter = saved;
    if (localStorage.getItem(TASK_SORT_KEY) === "due") state.taskSort = "due";
  } catch (e) {}
  $("f-task-sort").value = state.taskSort;

  populateSelects();
  renderSchemePills();
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
  // Holds ALL schemes, archived ones included — the Schemes tab needs to
  // list them so they can be restored. Everything user-facing (the pill
  // bar, the dropdowns) goes through activeSchemes() instead.
  const snap = await getDocs(collection(db, "schemes"));
  const order = OPTIONS.schemeOrder || [];
  const rank = (s) => {
    const i = order.indexOf(s.code);
    return i === -1 ? order.length : i;   // unlisted schemes go to the end
  };
  state.schemes = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (rank(a) - rank(b)) || (a.name || "").localeCompare(b.name || ""));
}

const activeSchemes = () => state.schemes.filter((s) => s.active !== false);

async function ensureDefaultSchemes() {
  // Runs once, on the first Admin sign-in of a brand-new project, so the
  // scheme bar isn't empty on day one. A harmless no-op every time after
  // that, since the collection is no longer empty.
  if (state.schemes.length > 0 || !isAdmin()) return;
  const batch = writeBatch(db);
  (OPTIONS.defaultSchemes || []).forEach((s) =>
    batch.set(doc(db, "schemes", s.code), {
      code: s.code, name: s.name, active: true,
      createdAt: serverTimestamp(), createdBy: state.user.email
    })
  );
  await batch.commit();
  await loadSchemes();
}
async function loadInvestors() {
  const snap = await getDocs(collection(db, "investors"));
  state.investors = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function loadTasks() {
  const snap = await getDocs(collection(db, "investorTasks"));
  state.tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function loadOptionLists() {
  const snap = await getDocs(collection(db, "optionLists"));
  state.optionLists = {};
  snap.docs.forEach((d) => {
    const v = d.data().values;
    state.optionLists[d.id] = Array.isArray(v) ? v : [];
  });
}

/* ============================ custom dropdown values ============================

   Every dropdown below ends with a "+ Add new…" choice. Picking it asks for
   the new value, saves it to the `optionLists` collection, and selects it —
   so it's there for everyone, in every browser, from then on.

   What a dropdown offers is the union of three things, in this order:
     1. the starting list in config.js,
     2. anything added from inside the app since,
     3. any value already sitting on a record.
   (3) is the safety net: even if a value were removed from the stored list,
   the records still using it keep rendering their own value rather than
   silently falling back to blank.
   ============================================================================ */
const ADD_NEW = "__add_new__";

const OPTION_FIELDS = {
  investorType:   { noun: "type",     seed: () => OPTIONS.investorTypes || [],          used: () => state.investors.map((i) => i.investorType) },
  investorStatus: { noun: "status",   seed: () => OPTIONS.investorStatuses || [],       used: () => state.investors.map((i) => i.status) },
  industry:       { noun: "industry", seed: () => OPTIONS.investorIndustries || [],     used: () => state.investors.map((i) => i.industry) },
  // Kept apart from the Investments task categories (key "category"), so
  // a category added on one side doesn't appear on the other. Priorities
  // and reminder lead times are shared.
  investorCategory: { noun: "category", seed: () => OPTIONS.investorTaskCategories || [], used: () => state.tasks.map((t) => t.category) },
  priority:       { noun: "priority", seed: () => OPTIONS.priorities,                   used: () => state.tasks.map((t) => t.priority) }
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

// Reminder lead times are numbers rather than labels, so they get their own
// version of the same idea — deduplicated and sorted, not order-preserved.
function leadDayOptions() {
  const nums = new Set(OPTIONS.reminderLeadDays.map(Number));
  (state.optionLists.leadDays || []).forEach((n) => { if (Number(n) > 0) nums.add(Number(n)); });
  state.tasks.forEach((t) => { if (Number(t.reminderLeadDays) > 0) nums.add(Number(t.reminderLeadDays)); });
  return [...nums].sort((a, b) => a - b);
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

function wireAddNewLeadDays() {
  const sel = $("t-lead");
  sel.addEventListener("change", async () => {
    if (sel.value !== ADD_NEW) { sel.dataset.prev = sel.value; return; }

    const raw = (prompt("Start reminders how many days before the due date?") || "").trim();
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days < 1 || days > 730) {
      if (raw) alert("Enter a whole number of days between 1 and 730.");
      sel.value = sel.dataset.prev || "15";
      return;
    }
    if (leadDayOptions().includes(days)) {
      sel.value = String(days);
      sel.dataset.prev = sel.value;
      return;
    }
    try {
      await saveOption("leadDays", days);
      populateSelects();
      sel.value = String(days);
      sel.dataset.prev = sel.value;
      toast("Lead time added");
    } catch (e) {
      alert("Couldn't save that: " + e.message);
      sel.value = sel.dataset.prev || "15";
    }
  });
}

wireAddNew("i-type", "investorType");
wireAddNew("i-status", "investorStatus");
wireAddNew("i-industry", "industry");
wireAddNew("t-category", "investorCategory");
wireAddNew("t-priority", "priority");
wireAddNewLeadDays();

/* ============================ shared selects ============================ */
const SELECT_IDS = [
  "i-scheme", "i-type", "i-status", "i-industry", "i-owner",
  "f-inv-status", "f-inv-type",
  "t-lead", "t-category", "t-priority", "t-owner", "t-cc",
  "f-task-owner", "f-task-category"
];

function populateSelects() {
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label ?? v)}</option>`;
  const list = (key) => optionsFor(key).map((v) => opt(v)).join("");
  const addNew = `<option value="${ADD_NEW}">+ Add new…</option>`;
  const people = state.team.filter((t) => t.active).map((t) => opt(t.email, t.name || t.email)).join("");

  // Rebuilding a <select> wipes its selection, which would quietly clear a
  // half-filled form when someone adds a new dropdown value mid-edit. So
  // remember every selection first and put back the ones that still exist.
  const prev = {};
  SELECT_IDS.forEach((id) => { prev[id] = $(id).value; });

  // Scheme and Owner deliberately have no "+ Add new…": a scheme is a
  // structural thing with its own short code, created on the Schemes tab,
  // and an owner has to be a real account from the Team tab.
  $("i-scheme").innerHTML = activeSchemes().map((s) => opt(s.code, s.name)).join("");
  $("i-owner").innerHTML = '<option value="">Unassigned</option>' + people;
  $("t-owner").innerHTML = '<option value="">Unassigned</option>' + people;
  $("t-cc").innerHTML = '<option value="">None</option>' + people;

  $("i-type").innerHTML = '<option value="">—</option>' + list("investorType") + addNew;
  $("i-status").innerHTML = list("investorStatus") + addNew;
  $("i-industry").innerHTML = '<option value="">—</option>' + list("industry") + addNew;
  $("t-category").innerHTML = '<option value="">—</option>' + list("investorCategory") + addNew;
  $("t-priority").innerHTML = list("priority") + addNew;
  $("t-lead").innerHTML = leadDayOptions()
    .map((d) => `<option value="${d}">${d} day${d === 1 ? "" : "s"} before</option>`).join("") + addNew;

  // Filters list the same values but never offer to add one — you can only
  // filter by something that exists.
  $("f-inv-status").innerHTML = '<option value="">All statuses</option>' + list("investorStatus");
  $("f-inv-type").innerHTML = '<option value="">All types</option>' + list("investorType");
  $("f-task-owner").innerHTML = '<option value="">All owners</option><option value="__none__">Unassigned</option>' + people;
  $("f-task-category").innerHTML = '<option value="">All categories</option>' + list("investorCategory");

  SELECT_IDS.forEach((id) => {
    const sel = $(id);
    const want = prev[id];
    if (want && want !== ADD_NEW && [...sel.options].some((o) => o.value === want)) sel.value = want;
    sel.dataset.prev = sel.value;
  });
}

/* ============================ scheme pills ============================ */
function renderSchemePills() {
  const counts = (code) => state.investors.filter((i) => !i.archived && (!code || i.schemeCode === code)).length;
  const pill = (code, label) => `
    <button class="scheme-pill${state.schemeFilter === code ? " active" : ""}" data-code="${esc(code)}">
      ${esc(label)}<span class="pill-count">${counts(code)}</span>
    </button>`;
  $("scheme-pills").innerHTML =
    pill("", "All schemes") + activeSchemes().map((s) => pill(s.code, s.name)).join("");
}

$("scheme-pills").addEventListener("click", (e) => {
  const btn = e.target.closest(".scheme-pill");
  if (!btn) return;
  state.schemeFilter = btn.dataset.code;
  try { localStorage.setItem(SCHEME_KEY, state.schemeFilter); } catch (err) {}
  // Switching scheme while a detail view is open would be disorienting —
  // drop back to the list of that scheme's investors instead.
  if (state.openInvestorId) {
    const inv = investorById(state.openInvestorId);
    if (inv && state.schemeFilter && inv.schemeCode !== state.schemeFilter) state.openInvestorId = null;
  }
  renderSchemePills();
  renderAll();
});

const currentSchemeName = () => {
  if (!state.schemeFilter) return "All schemes";
  const s = state.schemes.find((x) => x.code === state.schemeFilter);
  return s ? s.name : state.schemeFilter;
};

/* ============================ tabs ============================ */
$("main-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  goToTab(btn.dataset.tab);
});
const goToTab = (name) => {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  renderSchemePills();
};

/* ============================ scoped data ============================ */
const investorById = (id) => state.investors.find((i) => i.id === id);

function scopedInvestors() {
  return state.schemeFilter
    ? state.investors.filter((i) => i.schemeCode === state.schemeFilter)
    : state.investors.slice();
}
function scopedTasks() {
  const ids = new Set(scopedInvestors().filter((i) => !i.archived).map((i) => i.id));
  return state.tasks.filter((t) => ids.has(t.investorId));
}
const tasksFor = (invId) => state.tasks.filter((t) => t.investorId === invId);

function renderAll() {
  renderDashboard();
  renderInvestorsTab();
  renderTasksTab();
  renderSchemes();
  renderTeam();
}

/* ============================ dashboard ============================ */
function renderDashboard() {
  const invs = scopedInvestors().filter((i) => !i.archived);
  const tasks = scopedTasks();

  $("hero-eyebrow").textContent = currentSchemeName();

  const by = (s) => tasks.filter((t) => taskStatus(t) === s).length;
  $("k-overdue").textContent = by("OVERDUE");
  $("k-duesoon").textContent = by("DUE SOON");
  $("k-upcoming").textContent = by("UPCOMING");
  $("k-open").textContent = by("OPEN");
  $("k-done").textContent = by("DONE");

  // Undrawn only counts investors where both figures are known; a blank is
  // "not known yet", not zero.
  const committed = sumCr(invs, "committedAmount");
  const drawn = sumCr(invs, "drawdownAmount");
  const both = invs.filter((i) => isNum(i.committedAmount) && isNum(i.drawdownAmount));
  $("s-investors").textContent = invs.length;
  $("s-committed").textContent = fmtCr(committed);
  $("s-drawn").textContent = fmtCr(drawn);
  $("s-undrawn").textContent = both.length
    ? fmtCr(both.reduce((n, i) => n + Number(i.committedAmount) - Number(i.drawdownAmount), 0))
    : fmtCr(null);

  const overdue = by("OVERDUE");
  const soon = by("DUE SOON");
  const across = `<strong>${invs.length}</strong> investor${invs.length === 1 ? "" : "s"}`;
  $("dm-caption").innerHTML = invs.length === 0
    ? `Nothing here yet — add the first investor under <strong>${esc(currentSchemeName())}</strong> to get started.`
    : overdue
      ? `<strong>${overdue}</strong> task${overdue === 1 ? "" : "s"} overdue across ${across}${soon ? `, and ${soon} more due this week` : ""}.`
      : soon
        ? `Nothing overdue. <strong>${soon}</strong> task${soon === 1 ? "" : "s"} due this week across ${across}.`
        : `Nothing overdue or due this week across ${across}.`;

  renderStatusBreakdown(invs);
  renderWeeklyPanel();
}

function renderStatusBreakdown(invs) {
  const statuses = optionsFor("investorStatus");
  const max = Math.max(1, ...statuses.map((s) => invs.filter((i) => i.status === s).length));
  $("stage-breakdown").innerHTML = statuses.map((s) => {
    const n = invs.filter((i) => i.status === s).length;
    return `<div class="stage-row">
      <span class="stage-name">${esc(s)}</span>
      <span class="stage-bar"><span class="stage-bar-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="stage-count">${n}</span>
    </div>`;
  }).join("");
}

function weekBounds(offset = 0) {
  const [y, m, d] = todayISO().split("-").map(Number);
  const t = new Date(y, m - 1, d);
  const dow = (t.getDay() + 6) % 7; // Monday = 0
  const start = new Date(t); start.setDate(t.getDate() - dow + offset * 7);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { start: iso(start), end: iso(end) };
}
const fmtRange = (a, b) =>
  `${fmtDay(a).replace(/ \d{4}$/, "")} – ${fmtDay(b)}`;

$("btn-week-prev").addEventListener("click", () => { state.weekOffset--; renderWeeklyPanel(); });
$("btn-week-next").addEventListener("click", () => { state.weekOffset++; renderWeeklyPanel(); });
$("btn-week-today").addEventListener("click", () => { state.weekOffset = 0; renderWeeklyPanel(); });
$("btn-clear-status-filter").addEventListener("click", () => {
  state.dashStatusFilter = "";
  document.querySelectorAll(".kpi").forEach((k) => k.classList.remove("active"));
  renderWeeklyPanel();
});
$("kpi-strip").addEventListener("click", (e) => {
  const kpi = e.target.closest(".kpi");
  if (!kpi) return;
  const s = kpi.dataset.status;
  state.dashStatusFilter = state.dashStatusFilter === s ? "" : s;
  document.querySelectorAll(".kpi").forEach((k) => k.classList.toggle("active", k.dataset.status === state.dashStatusFilter));
  renderWeeklyPanel();
});

function taskItemHtml(t) {
  const inv = investorById(t.investorId);
  const s = taskStatus(t);
  return `<div class="wk-item clickable" data-task="${esc(t.id)}" data-inv="${esc(t.investorId)}">
    <span class="wk-date">${t.dueDate ? fmtDay(t.dueDate).slice(0, 6) : "—"}</span>
    <span class="wk-name">${esc(t.title)}${t.completed ? '<span class="wk-done">✓</span>' : ""}
      <span class="wk-meta" style="display:block">${esc(inv ? inv.name : "—")}${t.ownerEmail ? " · " + esc(personName(t.ownerEmail)) : ""}</span>
    </span>
    ${badge(s)}
  </div>`;
}

function renderWeeklyPanel() {
  const filter = state.dashStatusFilter;
  $("btn-clear-status-filter").hidden = !filter;
  $("weekly-title").textContent = filter ? `Tasks — ${STATUS_LABEL[filter]}` : "Tasks due";
  $("btn-week-today").disabled = state.weekOffset === 0;

  let tasks = scopedTasks();

  // A status filter overrides the week window entirely — if you clicked
  // "Overdue", you want every overdue task, not just this week's.
  if (filter) {
    $("week-nav").hidden = true;
    $("overdue-section").hidden = true;
    $("week-section-label").textContent = `${STATUS_LABEL[filter]} — all dates`;
    const rows = tasks.filter((t) => taskStatus(t) === filter)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    $("due-this-week").innerHTML = rows.length
      ? rows.map(taskItemHtml).join("")
      : `<p class="empty-note">Nothing ${STATUS_LABEL[filter].toLowerCase()}.</p>`;
    return;
  }

  $("week-nav").hidden = false;
  const { start, end } = weekBounds(state.weekOffset);
  $("week-section-label").textContent =
    state.weekOffset === 0 ? "This week" : fmtRange(start, end);

  const overdue = tasks.filter((t) => taskStatus(t) === "OVERDUE")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $("overdue-section").hidden = overdue.length === 0;
  $("overdue-list").innerHTML = overdue.map(taskItemHtml).join("");

  const wk = tasks
    .filter((t) => t.taskType === "timed" && t.dueDate && t.dueDate >= start && t.dueDate <= end && taskStatus(t) !== "OVERDUE")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $("due-this-week").innerHTML = wk.length
    ? wk.map(taskItemHtml).join("")
    : `<p class="empty-note">Nothing due ${state.weekOffset === 0 ? "this week" : "that week"}.</p>`;
}

// Clicking any task anywhere on the dashboard opens its investor.
document.querySelectorAll("#overdue-list, #due-this-week").forEach((el) => {
  el.addEventListener("click", (e) => {
    const row = e.target.closest("[data-inv]");
    if (!row) return;
    openInvestor(row.dataset.inv);
  });
});

/* ============================ investors tab ============================ */
["f-inv-search", "f-inv-status", "f-inv-type", "f-inv-archived"]
  .forEach((id) => $(id).addEventListener(id === "f-inv-search" ? "input" : "change", renderInvestorsTab));

const statusLabel = (i) => i.status || "Prospect";
// Statuses are free text people can add to, so they're coloured by what
// they say rather than by a fixed list.
function statusBadgeClass(i) {
  const s = statusLabel(i).toLowerCase();
  if (/onboarded|active|invested/.test(s)) return "badge-DONE";
  if (/committed/.test(s)) return "badge-DUESOON";
  if (/exited|redeemed|withdrawn|dropped|lost/.test(s)) return "badge-ONGOING";
  return "badge-UPCOMING";
}

function renderInvestorsTab() {
  if (state.openInvestorId && investorById(state.openInvestorId)) {
    $("inv-list-view").hidden = true;
    $("inv-detail-view").hidden = false;
    renderInvestorDetail();
    return;
  }
  state.openInvestorId = null;
  $("inv-list-view").hidden = false;
  $("inv-detail-view").hidden = true;

  $("inv-list-title").textContent =
    state.schemeFilter ? `Investors — ${currentSchemeName()}` : "Investors — all schemes";

  const q = $("f-inv-search").value.trim().toLowerCase();
  const status = $("f-inv-status").value;
  const type = $("f-inv-type").value;
  const arch = $("f-inv-archived").value;

  let rows = scopedInvestors();
  if (arch === "live") rows = rows.filter((i) => !i.archived);
  else if (arch === "archived") rows = rows.filter((i) => i.archived);
  if (status) rows = rows.filter((i) => statusLabel(i) === status);
  if (type) rows = rows.filter((i) => i.investorType === type);
  if (q) {
    rows = rows.filter((i) =>
      [i.name, i.investorType, i.industry, i.contactName, i.contactEmail, i.contactPhone, i.notes]
        .some((v) => String(v || "").toLowerCase().includes(q)));
  }

  $("inv-empty").hidden = rows.length > 0;
  $("inv-grid").innerHTML = rows.map(cardHtml).join("");
}

function cardHtml(i) {
  const ts = tasksFor(i.id);
  const n = (s) => ts.filter((t) => taskStatus(t) === s).length;
  const overdue = n("OVERDUE"), soon = n("DUE SOON"), open = n("OPEN") + n("UPCOMING");

  let taskLine;
  if (ts.length === 0) {
    taskLine = `<span class="task-dot open">No tasks yet</span>`;
  } else {
    const parts = [];
    if (overdue) parts.push(`<span class="task-dot overdue">${overdue} overdue</span>`);
    if (soon) parts.push(`<span class="task-dot duesoon">${soon} due soon</span>`);
    if (open) parts.push(`<span class="task-dot open">${open} open</span>`);
    if (!parts.length) parts.push(`<span class="task-dot clear">All clear</span>`);
    taskLine = parts.join("");
  }

  return `<button class="inv-card${i.archived ? " archived" : ""}" data-id="${esc(i.id)}">
    <div class="inv-card-top">
      <div>
        <p class="inv-card-name">${esc(i.name)}</p>
        ${i.contactName ? `<p class="inv-card-counterparty">${esc(i.contactName)}</p>` : ""}
      </div>
      <span class="badge ${statusBadgeClass(i)}">${esc(statusLabel(i))}</span>
    </div>
    <div class="inv-card-meta">
      ${i.investorType ? `<span class="type-tag">${esc(i.investorType)}</span>` : ""}
      ${i.industry ? `<span class="type-tag">${esc(i.industry)}</span>` : ""}
      ${!state.schemeFilter ? `<span class="type-tag">${esc(i.schemeName || i.schemeCode || "")}</span>` : ""}
    </div>
    <div class="inv-card-figures">
      <span><span class="inv-fig-label">Committed</span><span class="inv-fig-value">${fmtCr(i.committedAmount)}</span></span>
      <span><span class="inv-fig-label">Drawn down</span><span class="inv-fig-value">${fmtCr(i.drawdownAmount)}</span></span>
      <span><span class="inv-fig-label">Owner</span><span class="inv-fig-value" style="font-family:inherit">${esc(personName(i.ownerEmail))}</span></span>
    </div>
    <div class="inv-card-tasks">${taskLine}</div>
  </button>`;
}

$("inv-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".inv-card");
  if (card) openInvestor(card.dataset.id);
});
$("btn-back-to-list").addEventListener("click", () => {
  state.openInvestorId = null;
  renderInvestorsTab();
});

function openInvestor(id) {
  if (!investorById(id)) return;
  state.openInvestorId = id;
  goToTab("investors");
  renderInvestorsTab();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ============================ investor detail ============================ */
$("dv-show-done").addEventListener("change", () => {
  state.showDoneTasks = $("dv-show-done").checked;
  renderInvestorDetail();
});

function renderInvestorDetail() {
  const i = investorById(state.openInvestorId);
  if (!i) { state.openInvestorId = null; renderInvestorsTab(); return; }

  $("dv-scheme").textContent = i.schemeName || i.schemeCode || "";
  $("dv-name").textContent = i.name;
  $("dv-subline").textContent = [i.investorType, i.industry].filter(Boolean).join(" · ") || "—";
  $("dv-stage").className = `badge ${statusBadgeClass(i)}`;
  $("dv-stage").textContent = statusLabel(i);

  const fact = (label, value, cls = "") =>
    `<div class="fact"><p class="fact-label">${esc(label)}</p><p class="fact-value ${cls}">${value}</p></div>`;
  const plain = (v) => v ? esc(v) : '<span class="muted">—</span>';
  const money = (v) => isNum(v) ? `₹ ${fmtCr(v)} cr` : '<span class="muted">—</span>';
  const undrawn = isNum(i.committedAmount) && isNum(i.drawdownAmount)
    ? Number(i.committedAmount) - Number(i.drawdownAmount) : null;

  $("dv-facts").innerHTML =
    fact("Committed", money(i.committedAmount), "mono") +
    fact("Drawn down", money(i.drawdownAmount), "mono") +
    fact("Undrawn", money(undrawn), "mono") +
    fact("Relationship owner", plain(i.ownerEmail ? personName(i.ownerEmail) : "")) +
    fact("Point of contact", plain(i.contactName)) +
    fact("Email", i.contactEmail ? `<a href="mailto:${esc(i.contactEmail)}">${esc(i.contactEmail)}</a>` : '<span class="muted">—</span>') +
    fact("Phone", i.contactPhone ? `<a href="tel:${esc(i.contactPhone.replace(/\s/g, ""))}">${esc(i.contactPhone)}</a>` : '<span class="muted">—</span>') +
    fact("Document link", i.docLink ? `<a href="${esc(i.docLink)}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">—</span>') +
    (i.contactOther ? `<div class="fact wide"><p class="fact-label">Other contact details</p><p class="fact-value">${esc(i.contactOther)}</p></div>` : "") +
    (i.archived ? fact("Status", '<span class="badge badge-ONGOING">Archived</span>') : "") +
    (i.notes ? `<div class="fact wide"><p class="fact-label">Notes</p><p class="fact-value">${esc(i.notes).replace(/\n/g, "<br>")}</p></div>` : "");

  renderTaskList(i);
}

function renderTaskList(i) {
  let ts = tasksFor(i.id);
  const doneCount = ts.filter((t) => t.completed).length;
  $("dv-task-count").textContent =
    `${ts.length - doneCount} open${doneCount ? ` · ${doneCount} completed` : ""}`;

  if (!state.showDoneTasks) ts = ts.filter((t) => !t.completed);
  ts.sort(taskOrder());

  $("dv-tasks-empty").hidden = ts.length > 0;
  $("dv-tasks-empty").textContent = tasksFor(i.id).length === 0
    ? "No tasks yet. Add the first one — a diligence item, a filing, a payment date, anything you want to be reminded about."
    : "Every task here is complete. Tick “Show completed” to see them.";

  $("dv-tasks").innerHTML = ts.map((t) => {
    const s = taskStatus(t);
    const days = t.dueDate && !t.completed ? daysBetween(t.dueDate) : null;
    const dayLabel = days === null ? "" :
      days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `in ${days}d`;
    const sc = subtaskCount(t);
    return `<div class="task-row" data-id="${esc(t.id)}">
      <input type="checkbox" class="task-check" ${t.completed ? "checked" : ""} title="Mark complete">
      <div class="task-main">
        <div class="task-title${t.completed ? " done" : ""}">${esc(t.title)}</div>
        <div class="task-sub">
          ${t.taskType === "timed" && t.dueDate ? `<span class="task-due">${fmtDay(t.dueDate)}${dayLabel ? ` · ${dayLabel}` : ""}</span>` : `<span>No date</span>`}
          ${t.category ? `<span class="type-tag">${esc(t.category)}</span>` : ""}
          ${t.priority && t.priority !== "Normal" ? `<span class="prio-tag ${prioClass(t.priority)}">${esc(t.priority)}</span>` : ""}
          <span>${esc(personName(t.ownerEmail))}</span>
          ${t.link ? `<a class="row-link" href="${esc(t.link)}" target="_blank" rel="noopener">Link</a>` : ""}
          ${sc.total ? `<span class="st-progress">${sc.done}/${sc.total} sub-tasks</span>` : ""}
        </div>
        ${sc.total ? subtaskListHtml(t) : ""}
      </div>
      <div class="task-side">
        ${badge(s)}
        <button class="btn-icon t-edit" title="Edit">✎</button>
      </div>
    </div>`;
  }).join("");
}

$("dv-tasks").addEventListener("click", async (e) => {
  const row = e.target.closest(".task-row");
  if (!row) return;
  const t = state.tasks.find((x) => x.id === row.dataset.id);
  if (!t) return;

  if (e.target.classList.contains("task-check")) {
    await setTaskCompleted(t, e.target.checked);
    return;
  }
  if (e.target.classList.contains("st-check")) {
    await setSubtaskDone(t, e.target.dataset.st, e.target.checked);
    return;
  }
  if (e.target.closest(".t-edit")) openTaskDrawer(t.investorId, t);
});

async function setSubtaskDone(t, subtaskId, done) {
  const subtasks = (t.subtasks || []).map((st) => st.id !== subtaskId ? st : {
    ...st, done, doneOn: done ? todayISO() : "", doneBy: done ? state.user.email : ""
  });
  try {
    await setDoc(doc(db, "investorTasks", t.id), {
      subtasks, updatedAt: serverTimestamp(), updatedBy: state.user.email
    }, { merge: true });
    t.subtasks = subtasks;
  } catch (err) {
    alert("Couldn't save that: " + err.message);
  }
  renderAll();
}

async function setTaskCompleted(t, completed) {
  try {
    await setDoc(doc(db, "investorTasks", t.id), {
      completed,
      completedOn: completed ? todayISO() : "",
      completedBy: completed ? state.user.email : "",
      updatedAt: serverTimestamp(),
      updatedBy: state.user.email
    }, { merge: true });
    Object.assign(t, { completed, completedOn: completed ? todayISO() : "", completedBy: completed ? state.user.email : "" });
    toast(completed ? "Task marked complete" : "Task reopened");
    renderAll();
  } catch (err) {
    alert("Couldn't save that: " + err.message);
  }
}

/* ============================ investor drawer ============================ */
$("btn-add-investor").addEventListener("click", () => openInvestorDrawer(null));
$("btn-edit-investor").addEventListener("click", () => openInvestorDrawer(investorById(state.openInvestorId)));
$("btn-drawer-close").addEventListener("click", closeInvestorDrawer);
$("drawer-backdrop").addEventListener("click", closeInvestorDrawer);

const numVal = (v) => (isNum(v) ? v : "");

function openInvestorDrawer(i) {
  $("drawer-error").hidden = true;
  $("drawer-title").textContent = i ? "Edit investor" : "Add investor";
  $("i-id").value = i ? i.id : "";
  $("i-name").value = i ? i.name || "" : "";
  $("i-scheme").value = i ? i.schemeCode || "" : (state.schemeFilter || (activeSchemes()[0] && activeSchemes()[0].code) || "");
  $("i-type").value = i ? i.investorType || "" : "";
  $("i-status").value = (i && i.status) || optionsFor("investorStatus")[0] || "";
  $("i-industry").value = i ? i.industry || "" : "";
  $("i-committed").value = i ? numVal(i.committedAmount) : "";
  $("i-drawdown").value = i ? numVal(i.drawdownAmount) : "";
  $("i-contact-name").value = i ? i.contactName || "" : "";
  $("i-contact-email").value = i ? i.contactEmail || "" : "";
  $("i-contact-phone").value = i ? i.contactPhone || "" : "";
  $("i-contact-other").value = i ? i.contactOther || "" : "";
  $("i-owner").value = i ? i.ownerEmail || "" : "";
  $("i-link").value = i ? i.docLink || "" : "";
  $("i-notes").value = i ? i.notes || "" : "";
  $("i-archived").checked = i ? !!i.archived : false;
  $("btn-delete-investor").hidden = !(i && isAdmin());

  $("drawer").hidden = false;
  $("drawer").setAttribute("aria-hidden", "false");
  $("drawer-backdrop").hidden = false;
  $("i-name").focus();
}
function closeInvestorDrawer() {
  $("drawer").hidden = true;
  $("drawer").setAttribute("aria-hidden", "true");
  $("drawer-backdrop").hidden = true;
}

const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

$("form-investor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("drawer-error");
  err.hidden = true;

  const name = $("i-name").value.trim();
  const schemeCode = $("i-scheme").value;
  if (!name) { err.textContent = "Give the investor a name."; err.hidden = false; return; }
  if (!schemeCode) { err.textContent = "Pick a scheme."; err.hidden = false; return; }

  const committedAmount = numOrNull($("i-committed").value);
  const drawdownAmount = numOrNull($("i-drawdown").value);
  if (committedAmount !== null && drawdownAmount !== null && drawdownAmount > committedAmount &&
      !confirm("The drawdown is more than the commitment. Save it anyway?")) return;

  const scheme = state.schemes.find((s) => s.code === schemeCode);
  const payload = {
    name,
    schemeCode,
    schemeName: scheme ? scheme.name : schemeCode,
    investorType: $("i-type").value,
    status: $("i-status").value,
    industry: $("i-industry").value,
    committedAmount,
    drawdownAmount,
    contactName: $("i-contact-name").value.trim(),
    contactEmail: $("i-contact-email").value.trim(),
    contactPhone: $("i-contact-phone").value.trim(),
    contactOther: $("i-contact-other").value.trim(),
    ownerEmail: $("i-owner").value,
    docLink: $("i-link").value.trim(),
    notes: $("i-notes").value.trim(),
    archived: $("i-archived").checked,
    updatedAt: serverTimestamp(),
    updatedBy: state.user.email
  };

  try {
    const id = $("i-id").value;
    if (id) {
      await setDoc(doc(db, "investors", id), payload, { merge: true });
      toast("Investor updated");
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = state.user.email;
      const ref = await addDoc(collection(db, "investors"), payload);
      state.openInvestorId = ref.id;
      toast("Investor added");
    }
    closeInvestorDrawer();
    await loadInvestors();
    renderSchemePills();
    renderAll();
  } catch (e2) {
    err.textContent = "Couldn't save: " + e2.message;
    err.hidden = false;
  }
});

$("btn-delete-investor").addEventListener("click", async () => {
  const id = $("i-id").value;
  const i = investorById(id);
  if (!i) return;
  const n = tasksFor(id).length;
  if (!confirm(
    `Delete "${i.name}" permanently?\n\n` +
    (n ? `Its ${n} task${n === 1 ? "" : "s"} will be deleted too. ` : "") +
    `This cannot be undone. If you only want it out of the way, cancel and tick "Archived" instead.`
  )) return;

  try {
    const batch = writeBatch(db);
    tasksFor(id).forEach((t) => batch.delete(doc(db, "investorTasks", t.id)));
    batch.delete(doc(db, "investors", id));
    await batch.commit();
    closeInvestorDrawer();
    state.openInvestorId = null;
    await Promise.all([loadInvestors(), loadTasks()]);
    renderSchemePills();
    renderAll();
    toast("Investor deleted");
  } catch (e) {
    alert("Couldn't delete: " + e.message);
  }
});

/* ============================ task drawer ============================ */
$("btn-add-task").addEventListener("click", () => openTaskDrawer(state.openInvestorId, null));
$("btn-task-close").addEventListener("click", closeTaskDrawer);
$("task-backdrop").addEventListener("click", closeTaskDrawer);

function syncTaskTypeFields() {
  const timed = $("t-type-timed").checked;
  $("t-timed-fields").hidden = !timed;
  // Deliberately NOT using the browser's own `required` here. Its default
  // bubble just says "please fill in this field", which doesn't tell you
  // that switching the task to "Open / no date" is the other way out. The
  // submit handler below catches it and says so properly.
  $("t-duedate").required = false;
}
$("t-type-timed").addEventListener("change", syncTaskTypeFields);
$("t-type-open").addEventListener("change", syncTaskTypeFields);
$("t-completed").addEventListener("change", () => {
  $("t-done-fields").hidden = !$("t-completed").checked;
  if ($("t-completed").checked && !$("t-completedon").value) $("t-completedon").value = todayISO();
});

/* Sub-tasks are held on the task itself, as a `subtasks` array of
   { id, title, done, doneOn, doneBy }. The drawer edits a working copy,
   and saving the task saves the lot. */
let draftSubtasks = [];
const newSubtaskId = () => "st" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function renderSubtaskEditor() {
  $("t-subtasks").innerHTML = draftSubtasks.length
    ? draftSubtasks.map((st, n) => `<div class="subtask-edit-row" data-n="${n}">
        <input type="checkbox" class="st-edit-check" ${st.done ? "checked" : ""} title="Done">
        <input type="text" class="st-edit-title" value="${esc(st.title)}" aria-label="Sub-task">
        <button type="button" class="btn-icon st-edit-remove" title="Remove sub-task">✕</button>
      </div>`).join("")
    : `<p class="subtask-empty">No sub-tasks yet.</p>`;
}

function addDraftSubtask() {
  const title = $("t-subtask-new").value.trim();
  if (!title) return;
  draftSubtasks.push({ id: newSubtaskId(), title, done: false, doneOn: "", doneBy: "" });
  $("t-subtask-new").value = "";
  renderSubtaskEditor();
  $("t-subtask-new").focus();
}
$("btn-subtask-add").addEventListener("click", addDraftSubtask);

// Enter in a sub-task box adds or keeps the sub-task. Without this it would
// submit the whole task form.
$("form-task").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "t-subtask-new") { e.preventDefault(); addDraftSubtask(); }
  else if (e.target.classList.contains("st-edit-title")) e.preventDefault();
});
$("t-subtasks").addEventListener("input", (e) => {
  const row = e.target.closest(".subtask-edit-row");
  if (!row || !e.target.classList.contains("st-edit-title")) return;
  draftSubtasks[Number(row.dataset.n)].title = e.target.value;
});
$("t-subtasks").addEventListener("change", (e) => {
  const row = e.target.closest(".subtask-edit-row");
  if (!row || !e.target.classList.contains("st-edit-check")) return;
  const st = draftSubtasks[Number(row.dataset.n)];
  st.done = e.target.checked;
  st.doneOn = st.done ? todayISO() : "";
  st.doneBy = st.done ? state.user.email : "";
});
$("t-subtasks").addEventListener("click", (e) => {
  const row = e.target.closest(".subtask-edit-row");
  if (!row || !e.target.closest(".st-edit-remove")) return;
  draftSubtasks.splice(Number(row.dataset.n), 1);
  renderSubtaskEditor();
});

function openTaskDrawer(investorId, t) {
  const inv = investorById(investorId);
  if (!inv) return;

  $("task-error").hidden = true;
  $("task-drawer-title").textContent = t ? "Edit task" : "Add task";
  $("t-context").textContent = `${inv.name} · ${inv.schemeName || inv.schemeCode}`;
  $("t-id").value = t ? t.id : "";
  $("t-investor-id").value = investorId;
  $("t-title").value = t ? t.title || "" : "";

  const timed = t ? t.taskType === "timed" : true;
  $("t-type-timed").checked = timed;
  $("t-type-open").checked = !timed;
  syncTaskTypeFields();

  $("t-duedate").value = t ? t.dueDate || "" : "";
  $("t-lead").value = t && t.reminderLeadDays ? String(t.reminderLeadDays) : "15";
  $("t-category").value = t ? t.category || "" : "";
  $("t-priority").value = t ? t.priority || "Normal" : "Normal";
  $("t-owner").value = t ? t.ownerEmail || "" : (inv.ownerEmail || "");
  $("t-cc").value = t ? t.ccEmail || "" : "";
  $("t-link").value = t ? t.link || "" : "";
  $("t-notes").value = t ? t.notes || "" : "";
  $("t-completed").checked = t ? !!t.completed : false;
  $("t-done-fields").hidden = !(t && t.completed);
  $("t-completedon").value = t ? t.completedOn || "" : "";
  $("t-completionnote").value = t ? t.completionNote || "" : "";
  $("btn-delete-task").hidden = !(t && canDeleteTask());
  draftSubtasks = ((t && t.subtasks) || []).map((st) => ({ ...st }));
  $("t-subtask-new").value = "";
  renderSubtaskEditor();

  $("task-drawer").hidden = false;
  $("task-drawer").setAttribute("aria-hidden", "false");
  $("task-backdrop").hidden = false;
  $("t-title").focus();
}
function closeTaskDrawer() {
  $("task-drawer").hidden = true;
  $("task-drawer").setAttribute("aria-hidden", "true");
  $("task-backdrop").hidden = true;
}

$("form-task").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("task-error");
  err.hidden = true;

  const title = $("t-title").value.trim();
  const timed = $("t-type-timed").checked;
  const dueDate = $("t-duedate").value;
  const investorId = $("t-investor-id").value;
  const inv = investorById(investorId);

  if (!title) { err.textContent = "Give the task a name."; err.hidden = false; return; }
  if (timed && !dueDate) {
    err.textContent = "A time-bound task needs a due date — that's what the reminder counts back from. Switch it to “Open / no date” if there isn't one yet.";
    err.hidden = false; return;
  }

  // Anything typed in the "add" box but not yet added still counts.
  addDraftSubtask();
  const subtasks = draftSubtasks
    .map((st) => ({ ...st, title: st.title.trim() }))
    .filter((st) => st.title);

  const payload = {
    investorId,
    investorName: inv ? inv.name : "",
    schemeCode: inv ? inv.schemeCode : "",
    schemeName: inv ? inv.schemeName : "",
    title,
    taskType: timed ? "timed" : "open",
    dueDate: timed ? dueDate : "",
    reminderLeadDays: timed ? Number($("t-lead").value) : null,
    category: $("t-category").value,
    priority: $("t-priority").value,
    ownerEmail: $("t-owner").value,
    ccEmail: $("t-cc").value,
    link: $("t-link").value.trim(),
    notes: $("t-notes").value.trim(),
    completed: $("t-completed").checked,
    completedOn: $("t-completed").checked ? ($("t-completedon").value || todayISO()) : "",
    completedBy: $("t-completed").checked ? state.user.email : "",
    completionNote: $("t-completed").checked ? $("t-completionnote").value.trim() : "",
    subtasks,
    updatedAt: serverTimestamp(),
    updatedBy: state.user.email
  };

  try {
    const id = $("t-id").value;
    if (id) {
      await setDoc(doc(db, "investorTasks", id), payload, { merge: true });
      toast("Task updated");
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = state.user.email;
      // Once the team has put the list in its own order, a new task joins
      // at the bottom of it. Before then there's no order to join.
      const orders = state.tasks.map((x) => x.sortOrder).filter((v) => typeof v === "number");
      if (orders.length) payload.sortOrder = Math.max(...orders) + 1;
      await addDoc(collection(db, "investorTasks"), payload);
      toast("Task added");
    }
    closeTaskDrawer();
    await loadTasks();
    renderAll();
  } catch (e2) {
    err.textContent = "Couldn't save: " + e2.message;
    err.hidden = false;
  }
});

$("btn-delete-task").addEventListener("click", async () => {
  const id = $("t-id").value;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`Delete the task "${t.title}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "investorTasks", id));
    closeTaskDrawer();
    await loadTasks();
    renderAll();
    toast("Task deleted");
  } catch (e) {
    alert("Couldn't delete: " + e.message);
  }
});

/* ============================ tasks tab ============================ */
["f-task-search", "f-task-status", "f-task-owner", "f-task-category"]
  .forEach((id) => $(id).addEventListener("input", renderTasksTab));
$("f-task-sort").addEventListener("change", () => {
  state.taskSort = $("f-task-sort").value === "due" ? "due" : "custom";
  try { localStorage.setItem(TASK_SORT_KEY, state.taskSort); } catch (e) {}
  renderAll();
});

function renderTasksTab() {
  $("tasks-title").textContent =
    state.schemeFilter ? `Tasks — ${currentSchemeName()}` : "All tasks — every scheme";

  const q = $("f-task-search").value.trim().toLowerCase();
  const status = $("f-task-status").value;
  const owner = $("f-task-owner").value;
  const cat = $("f-task-category").value;
  const draggable = state.taskSort === "custom";
  $("tasks-body").closest("table").classList.toggle("no-drag", !draggable);

  let rows = scopedTasks();
  if (status) rows = rows.filter((t) => taskStatus(t) === status);
  if (owner === "__none__") rows = rows.filter((t) => !t.ownerEmail);
  else if (owner) rows = rows.filter((t) => t.ownerEmail === owner);
  if (cat) rows = rows.filter((t) => t.category === cat);
  if (q) {
    rows = rows.filter((t) => {
      const inv = investorById(t.investorId);
      return [t.title, t.notes, t.category, inv && inv.name, inv && inv.contactName,
        ...(t.subtasks || []).map((st) => st.title)]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }
  rows.sort(taskOrder());

  $("tasks-empty").hidden = rows.length > 0;
  $("tasks-body").innerHTML = rows.map((t) => {
    const inv = investorById(t.investorId);
    const s = taskStatus(t);
    const days = t.dueDate && !t.completed ? daysBetween(t.dueDate) : null;
    const sc = subtaskCount(t);
    const expanded = sc.total > 0 && state.expandedTasks.has(t.id);
    return `<tr class="clickable task-tr" data-id="${esc(t.id)}" data-inv="${esc(t.investorId)}">
      <td class="col-drag">${draggable
        ? `<button type="button" class="drag-handle" title="Drag to move, or focus and press ↑ / ↓" aria-label="Move ${esc(t.title)}">⠿</button>`
        : ""}</td>
      <td><input type="checkbox" class="check-done t-row-check" ${t.completed ? "checked" : ""}></td>
      <td class="col-due">${t.dueDate ? fmtDay(t.dueDate) : "—"}</td>
      <td class="col-days">${days === null ? "—" : days}</td>
      <td>${badge(s)}</td>
      <td><span class="oblig-name">${esc(t.title)}</span>${t.priority && t.priority !== "Normal" ? ` <span class="prio-tag ${prioClass(t.priority)}">${esc(t.priority)}</span>` : ""}
        ${sc.total ? `<button type="button" class="st-toggle" aria-expanded="${expanded}">${expanded ? "▾" : "▸"} ${sc.done}/${sc.total} sub-tasks</button>` : ""}</td>
      <td>${esc(inv ? inv.name : "—")}</td>
      <td>${esc(inv ? (inv.schemeName || inv.schemeCode) : "—")}</td>
      <td>${t.category ? `<span class="type-tag">${esc(t.category)}</span>` : "—"}</td>
      <td>${esc(personName(t.ownerEmail))}</td>
      <td class="row-actions">${t.link ? `<a class="row-link" href="${esc(t.link)}" target="_blank" rel="noopener">Link</a>` : ""}</td>
    </tr>${expanded ? `<tr class="subtask-tr" data-id="${esc(t.id)}">
      <td class="col-drag"></td><td></td><td colspan="9">${subtaskListHtml(t)}</td>
    </tr>` : ""}`;
  }).join("");
}

$("tasks-body").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const t = state.tasks.find((x) => x.id === tr.dataset.id);
  if (!t) return;
  if (e.target.closest(".drag-handle")) return;
  if (e.target.classList.contains("t-row-check")) {
    await setTaskCompleted(t, e.target.checked);
    return;
  }
  if (e.target.classList.contains("st-check")) {
    await setSubtaskDone(t, e.target.dataset.st, e.target.checked);
    return;
  }
  if (e.target.closest(".st-toggle")) {
    if (state.expandedTasks.has(t.id)) state.expandedTasks.delete(t.id);
    else state.expandedTasks.add(t.id);
    renderTasksTab();
    return;
  }
  if (tr.classList.contains("subtask-tr")) return;
  if (e.target.closest("a")) return; // let links through
  openInvestor(tr.dataset.inv);
});

/* ---------- drag to reorder ----------
   Pointer events rather than the browser's own drag-and-drop, so it works
   with a finger on a tablet as well as with a mouse. The row moves live
   under the pointer; on release, the task takes its new place in the
   whole list, and every task's sortOrder is renumbered 0, 1, 2… With a
   filter on, the task lands next to the neighbours you dropped it between;
   hidden tasks keep their places relative to each other. */
const isTaskRow = (el) => el && el.classList.contains("task-tr");
function siblingTaskRow(tr, dir) {
  let el = dir < 0 ? tr.previousElementSibling : tr.nextElementSibling;
  while (el && !isTaskRow(el)) el = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
  return el;
}

async function moveTask(taskId, targetId, where) {
  if (taskId === targetId) return;
  const list = state.tasks.slice().sort(byTeamOrder);
  const from = list.findIndex((t) => t.id === taskId);
  if (from === -1) return;
  const [moved] = list.splice(from, 1);
  let to = list.findIndex((t) => t.id === targetId);
  if (to === -1) return;
  if (where === "after") to++;
  list.splice(to, 0, moved);

  const changed = [];
  list.forEach((t, n) => { if (t.sortOrder !== n) { t.sortOrder = n; changed.push(t); } });
  renderAll();
  if (!changed.length) return;

  try {
    // Firestore caps a batch at 500 writes.
    for (let k = 0; k < changed.length; k += 400) {
      const batch = writeBatch(db);
      changed.slice(k, k + 400).forEach((t) =>
        batch.set(doc(db, "investorTasks", t.id), { sortOrder: t.sortOrder }, { merge: true }));
      await batch.commit();
    }
  } catch (err) {
    alert("Couldn't save the new order: " + err.message);
    await loadTasks();
    renderAll();
  }
}

let drag = null;
$("tasks-body").addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".drag-handle");
  if (!handle || e.button !== 0) return;
  e.preventDefault();
  // Sub-task previews would get in the way of rows moving as single lines.
  $("tasks-body").querySelectorAll(".subtask-tr").forEach((row) => row.remove());
  const tr = handle.closest("tr");
  const next = siblingTaskRow(tr, 1);
  drag = { tr, pointerId: e.pointerId, startNext: next ? next.dataset.id : null };
  tr.classList.add("dragging");
  handle.setPointerCapture(e.pointerId);
});
$("tasks-body").addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const body = $("tasks-body");
  const y = e.clientY;
  const others = [...body.querySelectorAll(".task-tr")].filter((row) => row !== drag.tr);
  const before = others.find((row) => {
    const b = row.getBoundingClientRect();
    return y < b.top + b.height / 2;
  });
  if (before) { if (drag.tr.nextElementSibling !== before) body.insertBefore(drag.tr, before); }
  else if (body.lastElementChild !== drag.tr) body.appendChild(drag.tr);
  // Scroll the page when dragging near the top or bottom edge.
  if (y < 70) window.scrollBy(0, -14);
  else if (y > window.innerHeight - 70) window.scrollBy(0, 14);
});
async function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { tr, startNext } = drag;
  drag = null;
  tr.classList.remove("dragging");
  const next = siblingTaskRow(tr, 1), prev = siblingTaskRow(tr, -1);
  if (e.type === "pointercancel" || (next ? next.dataset.id : null) === startNext) {
    renderTasksTab();
    return;
  }
  if (next) await moveTask(tr.dataset.id, next.dataset.id, "before");
  else if (prev) await moveTask(tr.dataset.id, prev.dataset.id, "after");
}
$("tasks-body").addEventListener("pointerup", endDrag);
$("tasks-body").addEventListener("pointercancel", endDrag);

// Keyboard: focus a handle and press ↑ / ↓ to move that task one place.
$("tasks-body").addEventListener("keydown", async (e) => {
  const handle = e.target.closest(".drag-handle");
  if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  e.preventDefault();
  const tr = handle.closest("tr");
  const up = e.key === "ArrowUp";
  const target = siblingTaskRow(tr, up ? -1 : 1);
  if (!target) return;
  await moveTask(tr.dataset.id, target.dataset.id, up ? "before" : "after");
  const again = $("tasks-body").querySelector(`.task-tr[data-id="${CSS.escape(tr.dataset.id)}"] .drag-handle`);
  if (again) again.focus();
});

/* ============================ schemes tab ============================ */
function renderSchemes() {
  $("schemes-body").innerHTML = state.schemes.map((s) => {
    const count = state.investors.filter((i) => i.schemeCode === s.code).length;
    return `<tr data-code="${esc(s.code)}">
      <td>${esc(s.name)}</td>
      <td><span class="type-tag">${esc(s.code)}</span></td>
      <td class="col-days">${count}</td>
      <td>${s.active !== false ? "Active" : "Archived"}</td>
      <td class="row-actions">${isAdmin()
        ? `<button class="btn-icon s-toggle" data-code="${esc(s.code)}">${s.active !== false ? "Archive" : "Restore"}</button>`
        : ""}</td>
    </tr>`;
  }).join("");
}

$("schemes-body").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("s-toggle")) return;
  const code = e.target.dataset.code;
  const scheme = state.schemes.find((s) => s.code === code);
  if (!scheme) return;
  const isActive = scheme.active !== false;
  const count = state.investors.filter((i) => i.schemeCode === code).length;

  if (isActive && !confirm(
    `Archive "${scheme.name}"?\n\n` +
    (count ? `Its ${count} investor${count === 1 ? "" : "s"} and their tasks stay exactly as they are — nothing is deleted. ` : "") +
    `The scheme just disappears from the button bar and the dropdowns. You can restore it any time.`
  )) return;

  try {
    await setDoc(doc(db, "schemes", code), { active: !isActive }, { merge: true });
    // If the scheme we just archived was the one being filtered on, fall
    // back to "All schemes" — otherwise the bar shows nothing selected.
    if (isActive && state.schemeFilter === code) {
      state.schemeFilter = "";
      try { localStorage.setItem(SCHEME_KEY, ""); } catch (e2) {}
    }
    await loadSchemes();
    populateSelects();
    renderSchemePills();
    renderAll();
    toast(isActive ? "Scheme archived" : "Scheme restored");
  } catch (err) {
    alert("Couldn't save that: " + err.message);
  }
});

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
    renderSchemePills();
    renderAll();
    toast("Scheme added");
  } catch (err) {
    alert("Couldn't add that: " + err.message);
  }
});

/* ============================ team tab ============================ */
function renderTeam() {
  $("team-body").innerHTML = state.team.map((p) => {
    const owned = state.investors.filter((i) => i.ownerEmail === p.email && !i.archived).length;
    const open = state.tasks.filter((t) => t.ownerEmail === p.email && !t.completed).length;
    const isMe = state.user && p.email === state.user.email.toLowerCase();
    return `<tr data-email="${esc(p.email)}">
      <td>${esc(p.name || "—")}${isMe ? ' <span class="type-tag">you</span>' : ""}</td>
      <td>${esc(p.email)}</td>
      <td>${esc(roleLabel(p.role))}</td>
      <td class="col-days">${owned}</td>
      <td class="col-days">${open}</td>
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
  if (!$("task-drawer").hidden) closeTaskDrawer();
  else if (!$("person-drawer").hidden) closePersonDrawer();
  else if (!$("drawer").hidden) closeInvestorDrawer();
});
