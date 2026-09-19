// Runs once a day (see .github/workflows/reminders.yml).
//
// For every investment task that is time-bound, not completed, and inside
// its reminder window (or already overdue), sends one digest email to the
// task's owner. Tasks with no owner go to every admin instead, so nothing
// falls through silently.
//
// Open / no-date tasks are deliberately never emailed — that's the whole
// point of marking a task "open" rather than "time-bound" in the app.
//
// Stops on its own: once `completed` is set to true, the task no longer
// matches. Nothing to switch off separately.
//
// ============================================================
// Sends via Microsoft 365's SMTP server directly (SMTP AUTH), NOT via
// Microsoft Graph — Graph needs an Azure app registration with an
// admin-consented Mail.Send permission, which Tavasya wanted to avoid.
// This path needs only a per-mailbox setting and a password.
//
// The Firebase key must be for the INVESTMENTS project, which is separate
// from the compliance register's. The mailbox and App Password, on the
// other hand, can be exactly the same ones — sending mail has nothing to
// do with which database the data came from.
// ============================================================
//
// Required environment variables (set as GitHub Actions secrets):
//   FIREBASE_SERVICE_ACCOUNT_JSON   — full JSON key for the INVESTMENTS
//                                     project, as a single-line string
//   MS365_EMAIL                     — the mailbox sending the mail (also the FROM address)
//   MS365_APP_PASSWORD              — that mailbox's App Password
//
// Optional:
//   APP_URL                         — the live GitHub Pages address, so the
//                                     email can link straight back to the app

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

const svcJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(svcJson) });
const db = getFirestore();

const APP_URL = process.env.APP_URL || "";

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false, // STARTTLS on port 587, not implicit TLS
  auth: { user: process.env.MS365_EMAIL, pass: process.env.MS365_APP_PASSWORD }
});

async function sendMail(to, subject, html) {
  await transporter.sendMail({
    from: `"Tavasya Investments" <${process.env.MS365_EMAIL}>`,
    to, subject, html
  });
}

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function daysBetween(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = todayISO().split("-").map(Number);
  const t = new Date(Date.UTC(ty, tm - 1, td));
  return Math.round((due - t) / 86400000);
}
function fmtDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function rowHtml(t) {
  const d = daysBetween(t.dueDate);
  const overdue = d < 0;
  const color = overdue ? "#C1543F" : d <= 3 ? "#C9A24B" : "#7C8B82";
  const label = overdue
    ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue`
    : d === 0 ? "due today" : `due in ${d} day${d === 1 ? "" : "s"}`;
  const prio = t.priority && t.priority !== "Normal"
    ? ` <span style="color:#C1543F;font-size:11px;font-weight:600">${escapeHtml(t.priority)}</span>` : "";

  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B;font-family:monospace;color:#9CA39A;white-space:nowrap">${fmtDay(t.dueDate)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B;color:${color};font-weight:600;white-space:nowrap">${label}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B">
      <div style="font-weight:600;color:#ECE7DC">${escapeHtml(t.title)}${prio}</div>
      <div style="font-size:12px;color:#9CA39A">${escapeHtml(t.investmentName || "")}${t.schemeName ? " · " + escapeHtml(t.schemeName) : ""}${t.category ? " · " + escapeHtml(t.category) : ""}</div>
    </td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B">${t.link ? `<a href="${escapeHtml(t.link)}" style="color:#C9A24B">Open link</a>` : "—"}</td>
  </tr>`;
}

function digestHtml(items, heading) {
  return `
  <div style="font-family:sans-serif;background:#0F1210;padding:24px;color:#ECE7DC">
    <h2 style="font-family:Georgia,serif;font-style:italic;color:#C9A24B;margin:0 0 4px">Tavasya Capital Investments</h2>
    <p style="color:#9CA39A;margin:0 0 20px;font-size:14px">${heading}</p>
    <table style="width:100%;border-collapse:collapse;background:#171B18;border:1px solid #2A2F2B;border-radius:4px;overflow:hidden">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Due</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Status</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Task</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Link</th>
      </tr></thead>
      <tbody>${items.map(rowHtml).join("")}</tbody>
    </table>
    ${APP_URL ? `<p style="margin-top:18px"><a href="${escapeHtml(APP_URL)}" style="color:#C9A24B;font-size:13px">Open the Investments app →</a></p>` : ""}
    <p style="color:#6B7169;font-size:12px;margin-top:20px">
      Tick a task complete in the app and it stops appearing here. This mail runs daily until then.
      Tasks marked "open / no date" never appear in this email at all.
    </p>
  </div>`;
}

async function run() {
  const snap = await db.collection("investmentTasks").where("completed", "==", false).get();

  const due = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    // Only time-bound tasks are ever emailed.
    .filter((t) => t.taskType === "timed" && t.dueDate)
    .filter((t) => daysBetween(t.dueDate) <= (t.reminderLeadDays || 15))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  if (due.length === 0) {
    console.log("Nothing due — no mail sent.");
    return;
  }

  const usersSnap = await db.collection("users").where("active", "==", true).get();
  const users = usersSnap.docs.map((d) => d.data());
  const admins = users.filter((u) => u.role === "admin").map((u) => u.email);

  const byOwner = new Map();
  const unassigned = [];
  const push = (email, task) => {
    if (!byOwner.has(email)) byOwner.set(email, []);
    byOwner.get(email).push(task);
  };

  for (const t of due) {
    if (t.ownerEmail) push(t.ownerEmail, t);
    else unassigned.push(t);
    if (t.ccEmail) push(t.ccEmail, t);
  }
  if (unassigned.length) {
    for (const a of admins) unassigned.forEach((t) => push(a, t));
  }

  const today = fmtDay(todayISO());

  for (const [email, items] of byOwner.entries()) {
    // de-dup, in case someone is both an owner and an admin catching
    // unassigned tasks
    const seen = new Set();
    const unique = items.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const overdueCount = unique.filter((t) => daysBetween(t.dueDate) < 0).length;
    const heading = `${unique.length} task${unique.length === 1 ? "" : "s"} due or overdue as of ${today}` +
      (overdueCount ? ` — ${overdueCount} overdue` : "");
    try {
      await sendMail(email, `Investment tasks — ${today}`, digestHtml(unique, heading));
      console.log(`Sent to ${email}: ${unique.length} task(s)`);
    } catch (e) {
      console.error(`Failed sending to ${email}:`, e.message);
    }
  }

  const log = db.batch();
  for (const t of due) {
    log.set(db.collection("investmentReminderLog").doc(t.id), {
      lastReminderSent: todayISO(),
      reminderCount: (t.reminderCount || 0) + 1,
      title: t.title || "",
      investmentId: t.investmentId || ""
    }, { merge: true });
    log.set(db.collection("investmentTasks").doc(t.id), {
      lastReminderSent: todayISO(),
      reminderCount: (t.reminderCount || 0) + 1
    }, { merge: true });
  }
  await log.commit();
}

run().catch((e) => { console.error(e); process.exit(1); });
