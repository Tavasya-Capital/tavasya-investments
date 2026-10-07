// The front door: sign-in, then a choice of Compliance, Investments or
// Investor Relations. Each of those is its own page; they share this
// sign-in through common.js.
import { ORG_DOMAIN } from "./config.js";
import { auth, db, FUNCTIONS } from "./common.js";
import {
  signOut, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, reload
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "teamlead" ? "Team Lead" : "Member");

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

/* ============================ view switching ============================ */
function showView(id) {
  ["view-auth", "view-verify", "view-notsetup", "view-app"].forEach((v) => { $(v).hidden = v !== id; });
}

/* ============================ auth ============================ */
function authMessage(e) {
  const map = {
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/wrong-password": "That password doesn't match. Use 'Set or reset my password' if you've forgotten it.",
    "auth/invalid-credential": "That email and password don't match. Use 'Set or reset my password' if you've forgotten it.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/weak-password": "Passwords need at least six characters.",
    "auth/email-already-in-use": "That password doesn't match. Use 'Set or reset my password' if you've forgotten it.",
    "auth/operation-not-allowed": "Password sign-in isn't switched on for this project yet.",
    "auth/network-request-failed": "Couldn't reach the server. Check your connection."
  };
  return map[e.code] || e.message || "Something went wrong. Try again.";
}

$("form-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim().toLowerCase();
  const password = $("auth-password").value;
  const err = $("auth-error");
  err.hidden = true;

  if (!email.endsWith("@" + ORG_DOMAIN)) {
    err.textContent = `Use your @${ORG_DOMAIN} account.`;
    err.hidden = false;
    return;
  }
  if (!password) {
    err.textContent = "Enter your password.";
    err.hidden = false;
    return;
  }

  $("btn-auth").disabled = true;
  try {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e1) {
      // Firebase's email-enumeration protection means a wrong password on
      // an EXISTING account throws the same code as a brand-new email
      // would. The only way to tell them apart is to attempt creation and
      // see which way it fails.
      if (["auth/user-not-found", "auth/invalid-credential"].includes(e1.code)) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await sendEmailVerification(cred.user);
        } catch (e3) {
          if (e3.code === "auth/email-already-in-use") {
            err.textContent = "That password doesn't match. Use 'Set or reset my password' if you've forgotten it.";
          } else {
            err.textContent = authMessage(e3);
          }
          err.hidden = false;
        }
      } else {
        throw e1;
      }
    }
  } catch (e2) {
    err.textContent = authMessage(e2);
    err.hidden = false;
  } finally {
    $("btn-auth").disabled = false;
  }
});

$("btn-reset").addEventListener("click", async () => {
  const email = $("auth-email").value.trim().toLowerCase();
  const err = $("auth-error");
  if (!email) { err.textContent = "Enter your email first, then tap this again."; err.hidden = false; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    err.textContent = "Reset link sent — check your inbox.";
  } catch (e) {
    err.textContent = e.message || "Couldn't send that.";
  }
  err.hidden = false;
});

const doSignOut = () => { if (confirm("Sign out of Tavasya Capital?")) signOut(auth); };
$("btn-reload").addEventListener("click", async () => { await reload(auth.currentUser); boot(); });
$("btn-signout-verify").addEventListener("click", doSignOut);
$("btn-signout-notsetup").addEventListener("click", doSignOut);
$("btn-signout").addEventListener("click", doSignOut);

onAuthStateChanged(auth, () => boot());

// ?next=investments (etc.) is set when a section page sent someone here to
// sign in. Once they're in, they go straight back to it.
const nextKey = new URLSearchParams(location.search).get("next");

async function boot() {
  $("boot-splash").hidden = true;

  const user = auth.currentUser;
  if (!user) { showView("view-auth"); return; }

  const email = (user.email || "").toLowerCase();
  if (!email.endsWith("@" + ORG_DOMAIN)) {
    await signOut(auth);
    const err = $("auth-error");
    err.textContent = `Use your @${ORG_DOMAIN} account. ${email} isn't on that domain.`;
    err.hidden = false;
    showView("view-auth");
    return;
  }

  if (!user.emailVerified) {
    $("verify-email").textContent = user.email;
    showView("view-verify");
    return;
  }

  const snap = await getDoc(doc(db, "users", email));
  if (!snap.exists() || snap.data().active !== true) {
    $("notsetup-email").textContent = user.email;
    showView("view-notsetup");
    return;
  }
  const profile = snap.data();

  if (nextKey && FUNCTIONS[nextKey]) {
    location.replace(FUNCTIONS[nextKey].page);
    return;
  }

  $("who-name").textContent = `${profile.name || user.email} · ${roleLabel(profile.role)}`;
  $("hub-greeting").textContent = `Welcome, ${(profile.name || "").split(" ")[0] || "back"}`;
  showView("view-app");
  renderHubStatus();
}

/* ============================ hub cards ============================
   A one-line pulse on each card: how much is overdue or due within a week.
   Each section is read separately, so one that can't be read (say, before
   its security rules are published) just shows nothing rather than
   breaking the page. */
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const daysBetween = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
};

const HUB_SOURCES = {
  compliance: { collection: "compliances", noun: "item", due: (c) => !c.completed && c.dueDate ? c.dueDate : "" },
  investments: { collection: "investmentTasks", noun: "task", due: (t) => !t.completed && t.taskType === "timed" && t.dueDate ? t.dueDate : "" },
  "investor-relations": { collection: "investorTasks", noun: "task", due: (t) => !t.completed && t.taskType === "timed" && t.dueDate ? t.dueDate : "" }
};

function renderHubStatus() {
  Object.entries(HUB_SOURCES).forEach(async ([key, src]) => {
    const el = $(`hub-status-${key}`);
    try {
      const snap = await getDocs(collection(db, src.collection));
      const dates = snap.docs.map((d) => src.due(d.data())).filter(Boolean);
      const overdue = dates.filter((d) => daysBetween(d) < 0).length;
      const soon = dates.filter((d) => { const n = daysBetween(d); return n >= 0 && n <= 7; }).length;
      const parts = [];
      if (overdue) parts.push(`<span class="task-dot overdue">${overdue} overdue</span>`);
      if (soon) parts.push(`<span class="task-dot duesoon">${soon} due this week</span>`);
      el.innerHTML = parts.join("") || `<span class="task-dot clear">Nothing overdue or due this week</span>`;
    } catch (e) {
      el.innerHTML = "";
    }
  });
}
