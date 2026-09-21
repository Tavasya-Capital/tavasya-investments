# Tavasya Capital — Investments

Every investment held by every Tavasya Scheme, and every task attached to
it, in one place. Pick a Scheme at the top, see its positions, open one,
and track the work it still needs. Time-bound tasks email their owner
daily from a lead time you choose; open-ended ones sit in the list without
ever sending mail.

No build step, no framework. Plain HTML/CSS/JS, Firebase for data and
login, GitHub Pages for hosting, GitHub Actions for the daily email —
the same shape as the Compliance Register, deliberately.

**This app runs on its own Firebase project**, completely separate from
the Compliance Register's. Its own database, its own sign-ins, its own
team list. Nothing you do here can affect the compliance app, and nothing
there can affect this one. The trade-off is that everyone sets a password
here once, separately, the first time they sign in — and the team list is
maintained here, in this app's own Team tab.

---

## What's in this app

- **Scheme bar** — a button per active scheme across the top (TAVASYA SSF,
  Mudrikaran Scheme II, Mudrikaran Scheme III to start with) plus "All
  schemes". Whichever is selected filters every tab underneath it, and the
  choice is remembered between visits.
- **Dashboard** — task counts by status (each clickable to filter), total
  acquisition cost and face value for the selected scheme, a week-by-week
  "tasks due" panel you can page through, and a stage breakdown.
- **Investments** — a card per investment showing stage, instrument,
  figures, owner and an at-a-glance task summary. Click through to a full
  detail view with every field and the complete task list.
- **Tasks** — every task across every investment in one table, filterable
  by status, owner and category. Tick to complete, click to jump to the
  investment.
- **Schemes** — add a scheme any time, or archive one without losing its
  investments.
- **Team** — add people, set roles, remove access.
- **Light/dark toggle**, remembered across visits.
- **Daily reminder emails** for time-bound tasks.

---

## What one investment holds

| Field | Notes |
|---|---|
| Name | Required |
| Scheme | Required |
| Counterparty / corporate debtor | |
| Instrument | Security Receipt, assigned debt, resolution plan, equity, NCD, structured credit, other |
| Stage | Screening → IC Review → Approved → Executed → Monitoring → Exited / Dropped |
| Sector | |
| Investment date | |
| Acquisition cost (₹ cr) | Left blank stays blank — never counted as zero |
| Claim value (₹ cr) | Same |
| NCLT / CIRP reference | |
| Owner | From the team list |
| Document link | IM, IC note, VDR folder — wherever it actually lives |
| Notes | |
| Archived | Hides it from the default list without deleting anything |

Adding a field later is a small change to `config.js` and two spots in
`index.html` — it does not require touching existing records.

**Every dropdown can be extended from inside the app.** Instrument, stage,
sector, task category, priority and reminder lead time each end with a
**+ Add new…** choice: pick it, type the value, and it's saved for
everyone from then on. The lists in `config.js` are only the starting set.

## What one task holds

Every task belongs to exactly one investment, and is one of two kinds:

- **Time-bound** — has a due date and a reminder lead time (1, 3, 5, 7,
  15, 30, 45, 60 or 90 days). The daily script starts emailing the owner
  that many days out and keeps going, escalating once overdue, until
  someone ticks it complete.
- **Open / no date** — tracked on the investment and counted as open work,
  but never emails anyone.

Plus: category, priority, owner, CC, link, notes, and completion details.

---

## Roles

| Role | Can do |
|---|---|
| **Member** | See everything. Add and edit any investment or task, tick things complete. |
| **Team Lead** | Everything a Member can, plus delete a task. |
| **Admin** | Everything above, plus manage the Team tab, add and archive Schemes, and delete an investment outright (along with its tasks). |

The app won't let the last active Admin demote or remove themselves —
otherwise nobody could manage the team, and the only fix would be editing
the database by hand.

---

## Setup

Six steps. Budget about half an hour the first time.

### Step 1 — Create the Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project**. Name it something obvious like `Tavasya Investments`.
   Turn Analytics off.
2. **Build → Firestore Database → Create database.** Standard edition,
   region `asia-south1` (Mumbai), **Production mode**.
3. **Build → Authentication → Get started → Sign-in method →
   Email/Password** → turn on the **first** toggle only (leave "Email
   link" off).

### Step 2 — Register the web app and fill in `config.js`

1. Gear icon (top-left, next to "Project Overview") → **Project settings**
   → scroll to **Your apps** → click the `</>` (web) icon.
2. Nickname it anything. **Register app** — do **not** tick "Also set up
   Firebase Hosting".
3. Firebase shows a `firebaseConfig = { ... }` block. Copy it.
4. Open **`config.js`** from this codebase in any text editor and paste it
   over the placeholder block (the one full of `PASTE_YOUR_...`). Keep the
   `export const` at the front of the line. `ORG_DOMAIN` is already right.
5. Save the file.

If you skip this, the app loads its sign-in screen and then fails — that's
the symptom of an unfilled `config.js`, not a bug.

### Step 3 — Publish the security rules

1. Firebase → **Firestore Database → Rules**.
2. **Check the project name at the top of the console is the new
   investments project**, not the compliance one.
3. Select everything in the editor, delete it, paste in the entire contents
   of **`firestore.rules`** from this codebase → **Publish**.

The domain is already set correctly (`tavasyacapital.in`) — no edit needed.

### Step 4 — Put it on GitHub Pages

1. New GitHub repository, e.g. `tavasya-investments` under the
   Tavasya-Capital organisation. Public is fine (see "On repo visibility").
2. Upload every file, **keeping the folder structure**:
   ```
   index.html, styles.css, app.js, config.js, firestore.rules, README.md, .gitignore
   scripts/send-reminders.js
   .github/workflows/reminders.yml
   ```
   Upload the `config.js` you edited in Step 2, not the original.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch**, branch
   `main`, folder `/ (root)` → **Save**.
4. Wait ~30 seconds. Live at
   `https://tavasya-capital.github.io/tavasya-investments/`.

### Step 5 — Let Firebase trust the live address

Firebase → **Authentication → Settings → Authorised domains → Add domain**
→ `tavasya-capital.github.io`.

This is a **new project**, so it does not inherit the compliance app's
authorised domains. You have to add it here even if the address looks
familiar.

### Step 6 — Make yourself the first Admin

There's a chicken-and-egg problem: only an Admin can add people to the team
list, and the list starts empty. So the first Admin is created by hand,
once.

1. Firebase → **Firestore Database → Data → Start collection**.
2. Collection ID: `users`. Document ID: `aryan@tavasyacapital.in` (exact,
   all lowercase).
3. Add these four fields:

   | Field | Type | Value |
   |---|---|---|
   | `email` | string | `aryan@tavasyacapital.in` |
   | `name` | string | `Aryan` |
   | `role` | string | `admin` |
   | `active` | **boolean** | `true` |

   Make sure `active` is really the **boolean** type, not the text
   `"true"` — if it's a string the app won't recognise the account.
4. Save. Open the live address, sign in with that email and **any password
   you choose** — that first sign-in creates the account and sends a
   confirmation email. Open the link in it, come back, reload.
5. You're in. The three schemes seed themselves automatically. Add everyone
   else from the **Team** tab.

---

## Turning on the reminder emails

### Enable SMTP AUTH on the sending mailbox

If you already did this for the Compliance Register, it's done — the
mailbox setting isn't per-project. Skip to "Add the secrets".

Otherwise:

1. [admin.microsoft.com](https://admin.microsoft.com) → **Users → Active
   users** → click the mailbox you want reminders sent from.
2. **Mail** tab → **Manage email apps** → turn on **Authenticated SMTP**.
3. If that mailbox has MFA on (likely and recommended), generate an **App
   Password** at
   [mysignins.microsoft.com/security-info](https://mysignins.microsoft.com/security-info)
   → **Add sign-in method** → **App password**.

### Add the secrets

Repo → **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | A service-account key **for the investments project** — Firebase → Project settings → **Service accounts** → **Generate new private key**. Paste the whole downloaded JSON as one block. **Never commit this file to the repo.** |
| `MS365_EMAIL` | The sending mailbox's address |
| `MS365_APP_PASSWORD` | That mailbox's App Password |

The mailbox values can be identical to the compliance repo's. The Firebase
key cannot — it has to come from the new project, or the script will read
an empty database.

Optionally, on the **Variables** tab of the same page, add `APP_URL` set to
the live address, and the emails will link straight back into the app.

### Test it

**Actions tab → Daily investment task reminders → Run workflow.** Check the
run's log — it prints who it mailed and how many tasks each got. "Nothing
due — no mail sent" on a quiet day is expected, not a failure. To force a
real email, create a task due in two days with a 7-day lead, then run it
again.

Once confirmed, it runs itself daily at 9:00 IST.

---

### On repo visibility

The `firebaseConfig` values in `config.js` are meant to be public — they
identify which Firebase project to talk to, not who may access it. Real
access is enforced entirely by `firestore.rules` and the domain check.
Someone who finds the live URL still hits a sign-in wall and gets nowhere
without an `@tavasyacapital.in` account that's also on the team list. A
public repo is fine. (GitHub's free tier doesn't allow Pages on private
repos at all, so a public repo is usually the only option anyway.)

The service-account key is a different matter entirely — that one is a real
password to the whole database. It lives in GitHub Secrets and never in the
repo. `.gitignore` is set up to help you avoid committing it by accident.

---

## First run

1. Open the live address and sign in.
2. Pick a Scheme at the top — or leave it on "All schemes".
3. **+ Add investment**, fill in what you know, save. Fields you leave
   blank stay blank rather than showing as zero.
4. Open the card you just made, then **+ Add task**. Choose **Time-bound**
   if it has a deadline you want chased, or **Open / no date** if it's just
   something to keep on the list.
5. **Team** tab → add your colleagues. They set their own passwords when
   they first sign in — you're not creating passwords for them.

---

## What each Firestore collection is for

| Collection | Contents |
|---|---|
| `users` | The team roster and roles. Managed from the Team tab |
| `schemes` | The scheme list. Managed from the Schemes tab |
| `optionLists` | Dropdown values added from inside the app via "+ Add new…" |
| `investments` | One document per position |
| `investmentTasks` | One document per task, linked by `investmentId` |
| `investmentReminderLog` | What the daily mail last sent (written by the script only) |

Nothing else exists in this project, and the rules block everything else
outright.

---

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Sign-in screen appears, then nothing works | `config.js` still has the `PASTE_YOUR_...` placeholders — Step 2 |
| "Missing or insufficient permissions" | Rules not published (Step 3), or the `users` document ID isn't the exact lowercase email, or `active` was saved as text `"true"` instead of boolean `true` |
| Confirmation email never arrives | Check spam; confirm the GitHub Pages domain is in Authorised domains (Step 5) |
| Signed in fine but told "Not set up yet" | That email isn't on the team list. Add it from the Team tab — or, for the very first account, Step 6 |
| Scheme bar shows only "All schemes" | The seed only runs for an Admin. Confirm your `users` document says `role: admin`, then reload |
| Reminder emails don't arrive | Check the Actions tab log first. Usually a missing or misspelled secret on this repo, a service-account key from the wrong project, or every task genuinely outside its window |
| A task never emails anyone | It's probably saved as "Open / no date". Only time-bound tasks email |

## What this costs

Nothing at this scale. Firebase's free tier covers far more reads and
writes than a small team browsing a few hundred records generates, and a
second project doesn't change that — the free tier is per project, so this
one starts with its own fresh allowance. GitHub Pages and Actions are free
for a repository this size.
