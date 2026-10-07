// Runs once a day (see .github/workflows/reminders.yml).
// The Compliance section's reminders, carried over unchanged from the
// standalone Compliance Register. It now reads the tavasya-investments
// Firebase project, which all three sections share.
//
// For every compliance that is NOT completed, has a due date, and is
// within its Reminder_Lead_Days window (or already overdue), sends one
// digest email to its owner. Anything with no owner goes to every admin
// instead, so nothing silently falls through.
//
// Stops on its own: once `completed` is set to true in the app, this
// query no longer matches that row. Nothing to "turn off" separately.
//
// ============================================================
// Sends via Microsoft 365's SMTP server directly (SMTP AUTH), NOT via
// Microsoft Graph — deliberately, since Graph needs an Azure app
// registration with admin-consented Mail.Send permission, and Tavasya
// wanted to avoid that entirely. This is the lighter-weight path: a
// single mailbox setting plus a password, nothing registered in Azure AD.
//
// Before this works, two things need to be true on the sending mailbox
// (see README "Reminder emails" section for exact steps):
//   1. SMTP AUTH enabled for that one mailbox (Exchange admin center —
//      a checkbox, not an app registration).
//   2. If that mailbox has MFA on (likely), an App Password generated
//      for it, used below instead of the normal sign-in password.
// ============================================================
//
// Required environment variables (set as GitHub Actions secrets):
//   FIREBASE_SERVICE_ACCOUNT_JSON   — full JSON key, as a single-line string
//   MS365_EMAIL                     — the mailbox sending the mail (also the FROM address)
//   MS365_APP_PASSWORD              — that mailbox's App Password (or its real
//                                      password, only if MFA is off — an App
//                                      Password is strongly preferred)

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

const svcJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(svcJson) });
const db = getFirestore();

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false, // STARTTLS on port 587, not implicit TLS
  auth: { user: process.env.MS365_EMAIL, pass: process.env.MS365_APP_PASSWORD }
});

async function sendMail(to, subject, html) {
  await transporter.sendMail({
    from: `"Tavasya Compliance" <${process.env.MS365_EMAIL}>`,
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
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function rowHtml(c) {
  const d = daysBetween(c.dueDate);
  const overdue = d < 0;
  const color = overdue ? "#C1543F" : d <= 3 ? "#C9A24B" : "#7C8B82";
  const label = overdue ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue` : `due in ${d} day${d === 1 ? "" : "s"}`;
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B;font-family:monospace;color:#9CA39A;white-space:nowrap">${fmtDay(c.dueDate)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B;color:${color};font-weight:600;white-space:nowrap">${label}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B">
      <div style="font-weight:600;color:#ECE7DC">${escapeHtml(c.obligation)}</div>
      <div style="font-size:12px;color:#9CA39A">${escapeHtml(c.scheme)}${c.period ? " · " + escapeHtml(c.period) : ""}</div>
    </td>
    <td style="padding:8px 12px;border-bottom:1px solid #2A2F2B">${c.link ? `<a href="${escapeHtml(c.link)}" style="color:#C9A24B">Open filing link</a>` : "—"}</td>
  </tr>`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function digestHtml(items, heading) {
  return `
  <div style="font-family:sans-serif;background:#0F1210;padding:24px;color:#ECE7DC">
    <h2 style="font-family:Georgia,serif;font-style:italic;color:#C9A24B;margin:0 0 4px">Tavasya Compliance</h2>
    <p style="color:#9CA39A;margin:0 0 20px;font-size:14px">${heading}</p>
    <table style="width:100%;border-collapse:collapse;background:#171B18;border:1px solid #2A2F2B;border-radius:4px;overflow:hidden">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Due</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Status</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Obligation</th>
        <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7169">Link</th>
      </tr></thead>
      <tbody>${items.map(rowHtml).join("")}</tbody>
    </table>
    <p style="color:#6B7169;font-size:12px;margin-top:20px">
      Mark an item complete on the register and it stops appearing here. This mail runs daily until then.
    </p>
  </div>`;
}

// Emails that couldn't be sent. Counted so the run ends in failure (a red
// cross in the Actions tab) instead of looking fine while nobody gets anything.
let failedSends = 0;

async function run() {
  const complianceSnap = await db.collection("compliances").where("completed", "==", false).get();
  const due = complianceSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.dueDate)
    .filter((c) => daysBetween(c.dueDate) <= (c.reminderLeadDays || 15))
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
  for (const c of due) {
    if (c.ownerEmail) {
      if (!byOwner.has(c.ownerEmail)) byOwner.set(c.ownerEmail, []);
      byOwner.get(c.ownerEmail).push(c);
    } else {
      unassigned.push(c);
    }
    if (c.ccEmail) {
      if (!byOwner.has(c.ccEmail)) byOwner.set(c.ccEmail, []);
      byOwner.get(c.ccEmail).push(c);
    }
  }
  if (unassigned.length) {
    for (const a of admins) {
      if (!byOwner.has(a)) byOwner.set(a, []);
      byOwner.set(a, [...byOwner.get(a), ...unassigned]);
    }
  }

  const today = fmtDay(todayISO());
  const log = db.batch();

  for (const [email, items] of byOwner.entries()) {
    // de-dup in case an owner is also an admin catching unassigned rows
    const seen = new Set();
    const unique = items.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    const overdueCount = unique.filter((c) => daysBetween(c.dueDate) < 0).length;
    const heading = `${unique.length} item${unique.length === 1 ? "" : "s"} due or overdue as of ${today}` +
      (overdueCount ? ` — ${overdueCount} overdue` : "");
    try {
      await sendMail(email, `Compliance reminders — ${today}`, digestHtml(unique, heading));
      console.log(`Sent to ${email}: ${unique.length} item(s)`);
    } catch (e) {
      console.error(`Failed sending to ${email}:`, e.message);
      failedSends++;
    }
  }

  for (const c of due) {
    log.set(db.collection("reminderLog").doc(c.id), {
      lastReminderSent: todayISO(),
      reminderCount: (c.reminderCount || 0) + 1
    }, { merge: true });
    log.set(db.collection("compliances").doc(c.id), {
      lastReminderSent: todayISO(),
      reminderCount: (c.reminderCount || 0) + 1
    }, { merge: true });
  }
  await log.commit();

  if (failedSends) {
    console.error(`${failedSends} email(s) failed to send — see the errors above.`);
    process.exitCode = 1;
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
