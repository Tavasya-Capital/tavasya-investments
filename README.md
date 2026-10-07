# Tavasya Capital — Compliance, Investments and Investor Relations

Three of Tavasya's functions in one web app, behind one sign-in. Sign in,
pick **Compliance**, **Investments** or **Investor Relations**, and work
there. Switch between them at any time from the top of each page.

No build step, no framework. Plain HTML/CSS/JS, Firebase for data and
login, GitHub Pages for hosting, GitHub Actions for the daily emails.

The repository is still called `tavasya-investments`, from when it held
only the Investments app. The live address is unchanged:
`https://tavasya-capital.github.io/tavasya-investments/`.

---

## How it fits together

- **`index.html` — sign-in and the hub.** After signing in you see three
  cards, one per function, each with a one-line count of what's overdue
  or due this week. Open a section's page directly (a bookmark, a link in
  a reminder email) without being signed in, and you're sent to sign in
  first, then straight back to that page.
- **One page per function:** `compliance.html`, `investments.html` and
  `investor-relations.html`, each with its own script. `common.js` holds
  the shared Firebase connection and sign-in check; `config.js` holds the
  settings; `styles.css` is shared, so all three look the same.
- **One Firebase project, `tavasya-investments`,** holds everything: the
  sign-ins, the team list, the schemes and every section's records.
- **One sign-in and one team list.** Everyone signs in with their existing
  Tavasya Investments account. The Team tab in each section edits the
  same list, and whoever is on it can open all three sections.
- **Schemes are shared.** Adding or archiving a scheme on any section's
  Schemes tab changes it everywhere.

---

## Switching over from the separate Compliance Register

The Compliance section is the Compliance Register
([tavasya-compliance-](https://github.com/Tavasya-Capital/tavasya-compliance-)),
moved in here. Its records still sit in that app's own Firebase project
(`tavasya-compliance-a2295`) until they're copied across, once. Do this
right after this version goes live; until then the Compliance section is
empty.

1. **Publish the new security rules.** Firebase → **Firestore Database →
   Rules** on the `tavasya-investments` project → replace everything with
   the contents of `firestore.rules` → **Publish**. Without this, the
   Compliance and Investor Relations sections can't read or save anything.
2. **Give GitHub a key to the old compliance project.** In the Firebase
   console, switch to the old compliance project → Project settings →
   **Service accounts** → **Generate new private key**. Then in this
   repository → **Settings → Secrets and variables → Actions → New
   repository secret**: name `COMPLIANCE_SERVICE_ACCOUNT_JSON`, value the
   whole downloaded file. (The existing `FIREBASE_SERVICE_ACCOUNT_JSON`
   secret is the key to the new project; leave it as it is.)
3. **Dry run.** **Actions → Copy compliance data across (one-off) → Run
   workflow**, mode `dry-run`. The log says what it would copy and writes
   nothing.
4. **Copy.** Run it again with mode `copy`. It copies every compliance row
   (owners, links, completion proofs, reminder history), the compliance
   types, and any scheme the new project doesn't have yet, keeping every
   record's ID. It doesn't copy the old team list or sign-ins. Instead the
   log names anyone who was on the old compliance team list but isn't on
   this one, so you can add them from the Team tab if they should have
   access.
5. **Check** the Compliance section: the register, a few completion proofs,
   the types list.
6. **Switch off the old Compliance Register's daily email.** In the
   `tavasya-compliance-` repository → **Actions → Daily compliance
   reminders → ⋯ → Disable workflow**. Its emails now come from this
   repository. Left on, it would keep emailing about items you've since
   completed here, because its database no longer changes.
7. **Retire the old site.** Its data stops being current the moment you
   start using this one. Turn off GitHub Pages in that repository (or
   archive the repository) so nobody uses it by mistake.
8. **Delete the `COMPLIANCE_SERVICE_ACCOUNT_JSON` secret** once you're
   happy. It's only needed for the copy.

The copy is safe to run again: anything already in the new project is
left alone, so it never overwrites changes made here. Nothing in the old
project is changed or deleted.

---

## Compliance

Every Tavasya compliance obligation — due date, status, who owns it, a
link to the filed proof — in one place. Carried over from the standalone
Compliance Register unchanged; only the sign-in moved.

- **Dashboard** — status counts (Overdue / Due in 1 Week / Upcoming /
  Completed / Ongoing), each one clickable to filter the list below it; a
  distance-to-deadline meter; a "Tasks Due" panel you can page backward
  and forward by week; filters by scheme and by compliance type.
- **Register** — every compliance, searchable and filterable (scheme, type,
  status), with inline mark-complete and a full edit drawer.
- **Schemes tab** — adding a scheme here offers to clone every obligation
  from an existing scheme, same due dates, since these are calendar-based
  filings. Archive a scheme without losing its history.
- **Compliance types** — add one inline while filling out a compliance
  form; "Manage types" lets anyone reassign compliances between types, and
  lets Admin/Team Lead delete a type (with a checklist-based reassignment
  first, if anything's still using it).
- **Team tab** — the shared team list, plus a "Reports to" line from each
  Member to a Team Lead.
- **Compliance detail popup** — Admin-only: click any row to see who owns
  it and who their Team Lead is.
- **Import from Excel** (Admin/Team Lead) — upload the compliance calendar
  spreadsheet (one sheet per scheme, the usual 10 columns). It shows a
  review screen before writing anything, never overwrites an Owner, Link
  or Compliance Type already set in the app, and never reverts a confirmed
  completion. Safe to run more than once.
- **Daily reminder emails**, from each item's reminder lead time (15 days
  by default) until it's marked complete.

**Completion needs proof.** Marking anything complete requires a link to
the filed document (OneDrive, SharePoint, wherever it's stored), at every
role level. Rows imported from Excel as already done, but with no link,
come in with a **Proof pending** tag until someone adds one.

(The standalone app's older "Import from register" button, which loaded a
`data/tavasya-seed.json` file, was left out: that file isn't in its
repository, so the button could only fail. Import from Excel replaces it.)

---

## Investments

Every investment held by every Tavasya Scheme, and every task attached to
it. Pick a Scheme at the top, see its positions, open one, and track the
work it still needs. Time-bound tasks email their owner daily from a lead
time you choose; open-ended ones sit in the list without ever sending mail.

### What's in it

- **Scheme bar** — a button per active scheme across the top (TAVASYA SSF,
  Mudrikaran Scheme II, Mudrikaran Scheme III to start with) plus "All
  schemes". Whichever is selected filters every tab underneath it, and the
  choice is remembered between visits. The number on each button counts
  CIRP cases on the CIRP tab and investments everywhere else.
- **Dashboard** — task counts by status (overdue, due this week, upcoming,
  open, completed — each clickable to filter), the number of investments,
  their total acquisition cost, how many are still live (not exited or
  dropped) and how many CIRP cases are in progress for the selected
  scheme, a week-by-week "tasks due" panel you can page through, and a
  stage breakdown. CIRP cases aren't counted in the investment figures,
  but their tasks are counted in the task figures.
- **CIRP** — resolution-plan cases the team is pursuing, laid out like the
  Investments tab: a card per case showing its CIRP stage (Evaluating →
  EOI submitted → Shortlisted → Resolution plan submitted → Plan approved
  by CoC → Plan approved by NCLT, or Withdrawn), with the same detail view
  and task list. CIRP-related investments start here. Once the plan is
  approved, **Move to Investments** on the case moves it to the
  Investments tab with its tasks. It starts there at the "Approved"
  stage and records the date it moved. Moved one by mistake? **Back to
  CIRP** on the investment sends it back. Everything else starts on the
  Investments tab.
- **Investments** — a card per investment showing stage, instrument,
  tranche, figures, owner and an at-a-glance task summary. Click through
  to a full detail view with every field and the complete task list,
  including each task's sub-tasks with tick boxes.
- **Tasks** — every task across every investment and CIRP case in one
  table, filterable by status, owner and category. Tick to complete, click
  to jump to the investment. **Drag the ⠿ handle** to put the tasks in
  whatever order the team wants. This works with a mouse or a finger, or
  you can focus the handle and press ↑ / ↓. The order is saved for
  everyone, completed tasks always sit at the bottom, and new tasks join
  at the end. The same order is used in each investment's task list.
  Switch the order dropdown to "By status and due date" to see the fixed
  order instead. A task with sub-tasks shows a "2/5 sub-tasks" link that
  opens them with tick boxes.
- **Schemes** — add a scheme any time, or archive one without losing its
  investments.
- **Team** — add people, set roles, remove access.
- **Light/dark toggle**, remembered across visits.
- **Daily reminder emails** for time-bound tasks.

### What one investment holds

| Field | Notes |
|---|---|
| Name | Required |
| Scheme | Required |
| Counterparty / corporate debtor | |
| Instrument | Security Receipt, assigned debt, resolution plan, equity, NCD, structured credit, other |
| Stage | Screening → IC Review → Approved → Executed → Monitoring → Exit / Dropped. (Records saved when the stage was called "Exited" show as "Exit", and are saved that way the next time someone edits them.) |
| CIRP stage | CIRP cases only — see the CIRP tab above |
| Sector | |
| Investment tranche | Optional. Tranche 1, 2, 3 to start with |
| Investment date | |
| Acquisition cost (₹ cr) | Left blank stays blank — never counted as zero |
| Claim value (₹ cr) | Same |
| NCLT / CIRP reference | |
| Owner | From the team list |
| Document link | IM, IC note, VDR folder — wherever it actually lives |
| Notes | |
| Archived | Hides it from the default list without deleting anything |

CIRP cases are stored in the same place as investments, with `track` set
to `"cirp"`. Moving one to Investments changes `track` to `"investment"`
and sets `movedFromCirpOn` / `movedFromCirpBy`.

Adding a field later means adding its input to the investment form in
`investments.html` and reading and saving it in `investments.js` (`openInvestmentDrawer`
and the save handler just below it). Existing records don't need touching.

**Every dropdown can be extended from inside the app.** Instrument, stage,
CIRP stage, sector, tranche, task category, priority and reminder lead
time each end with a
**+ Add new…** choice: pick it, type the value, and it's saved for
everyone from then on. The lists in `config.js` are only the starting set.

### What one task holds

Every task belongs to exactly one investment, and is one of two kinds:

- **Time-bound** — has a due date and a reminder lead time (1, 3, 5, 7,
  15, 30, 45, 60 or 90 days to start with, default 15; add any other
  whole number of days up to 730 with **+ Add new…**). The daily script
  starts emailing the owner that many days out and keeps going every day,
  marking it overdue once the date passes, until someone ticks it
  complete. If the task has a CC, that person gets it in their email too.
  If it has no owner, every Admin gets it instead.
- **Open / no date** — tracked on the investment and counted as open work,
  but never emails anyone.

Plus: category, priority (Normal, High, Critical, or one you add — only
High and Critical get a coloured tag; a custom one gets a plain tag),
owner, CC, link, notes, and completion details.

**Sub-tasks.** A task can hold any number of sub-tasks, the granular
steps such as executing individual documents. Add, rename, tick or remove
them in the task's edit panel. Once added, they show under the task with
tick boxes, both in the investment's task list and in the Tasks tab. They
don't send reminders of their own, and ticking them all doesn't
complete the task. Tick the task itself when it's done.

Each person gets **one email a day** listing every task of theirs that's
due or overdue, not one email per task.


---

## Investor Relations

A first version, built on the same pattern as Investments: add investors,
then the tasks for each of them. More will follow.

- **Scheme bar** — the same scheme buttons as Investments, filtering every
  tab. (The selected scheme is shared between the two sections.)
- **Dashboard** — task counts by status (each clickable), number of
  investors, total committed, total drawn down, and undrawn, for the
  selected scheme; the week-by-week "tasks due" panel; and a breakdown by
  investor status.
- **Investors** — a card per investor showing status, type, industry,
  committed and drawn-down amounts, relationship owner and a task summary.
  Filter by status, type or archived. Click through to every field, the
  point of contact (email and phone are clickable), and the task list.
- **Tasks** — every investor task in one table, with the same drag-to-
  reorder, sub-tasks, filters and tick-to-complete as Investments. The
  order here is separate from the Investments one.
- **Schemes** and **Team** — the shared lists.

### What one investor holds

| Field | Notes |
|---|---|
| Investor name | Required |
| Scheme | Required |
| Type | Individual, Company, Partnership, Trust |
| Status | Prospect → In discussion → Committed → Onboarded → Exited |
| Business / industry | |
| Committed amount (₹ cr) | Blank stays blank, never counted as zero |
| Drawdown amount (₹ cr) | Total called so far. Undrawn = committed − drawdown, shown when both are filled in |
| Point of contact | Name, email, phone, and other contact details |
| Relationship owner | The person at Tavasya who looks after them, from the team list |
| Document link | KYC, contribution agreement, folder |
| Notes | |
| Archived | Hides it from the default list without deleting anything |

Type, status, industry and task category each end with **+ Add new…**.
The starting lists are in `config.js`. Investor tasks work exactly like
investment tasks (time-bound or open, priority, owner, CC, sub-tasks,
daily reminders), with their own category list.

---

## Roles

One set of roles across all three sections.

| Role | Can do |
|---|---|
| **Member** | See everything. Add and edit any record or task, tick things complete (with proof, for compliance). Add a compliance type. |
| **Team Lead** | Everything a Member can, plus delete a task and a compliance type, and import compliance from Excel. |
| **Admin** | Everything above, plus manage the team list, add and archive Schemes, delete an investment, investor or compliance row outright, and see the compliance detail popup. |

The Investments and Investor Relations Team tabs won't let the last active
Admin demote or remove themselves — otherwise nobody could manage the
team, and the only fix would be editing the database by hand.

---

## Reminder emails

One GitHub Actions workflow, **Daily task reminders**, runs at 9:00 IST
(03:30 UTC; GitHub's schedule can run a few minutes late) and sends:

- **Compliance** — `scripts/send-compliance-reminders.js`, unchanged from
  the Compliance Register: each owner gets one email listing their items
  inside the reminder window or overdue.
- **Investments** and **Investor Relations** — `scripts/send-reminders.js`:
  each person gets one email per section listing their time-bound tasks
  that are due or overdue. If a task has a CC, that person gets it too;
  tasks with no owner go to every Admin.

Each section runs on its own, so a problem with one never stops the
others' emails. Open / no-date tasks never email anyone.

### Enable SMTP AUTH on the sending mailbox

Already done for this repository and for the Compliance Register; the
setting is per mailbox, not per app. For a different mailbox:

1. [admin.microsoft.com](https://admin.microsoft.com) → **Users → Active
   users** → click the mailbox you want reminders sent from.
2. **Mail** tab → **Manage email apps** → turn on **Authenticated SMTP**.
3. If that mailbox has MFA on (likely and recommended), generate an **App
   Password** at
   [mysignins.microsoft.com/security-info](https://mysignins.microsoft.com/security-info)
   → **Add sign-in method** → **App password**.

### The secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | A service-account key for the `tavasya-investments` project — Firebase → Project settings → **Service accounts** → **Generate new private key**. Paste the whole downloaded JSON as one block. **Never commit this file to the repo.** |
| `MS365_EMAIL` | The sending mailbox's address |
| `MS365_APP_PASSWORD` | That mailbox's App Password |
| `COMPLIANCE_SERVICE_ACCOUNT_JSON` | Only for the one-off compliance copy — see "Switching over". Delete it afterwards. |

Optionally, on the **Variables** tab of the same page, set `APP_URL` to
the live address, and each email links straight to its section.

### Test it

**Actions tab → Daily task reminders → Run workflow.** The log prints who
each section mailed and how many items each got. "Nothing due — no mail
sent" on a quiet day is expected, not a failure.

---

## Setting it up from scratch

**This repository is already set up.** The Firebase project exists
(`tavasya-investments`) and its web config is already in `config.js`. The
steps below are for setting it up again on a fresh Firebase project, or
for checking how something was configured.

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
   over the existing `firebaseConfig = { ... }` block (it currently holds
   the `tavasya-investments` project's values). Keep the `export const` at
   the front of the line. `ORG_DOMAIN` is already right.
5. Save the file.

If `config.js` points at the wrong project, or at one that isn't set up,
the app loads its sign-in screen and then fails. That's a config problem,
not a bug.

### Step 3 — Publish the security rules

1. Firebase → **Firestore Database → Rules**.
2. **Check the project name at the top of the console is
   `tavasya-investments`**, not the old compliance project
   (`tavasya-compliance-a2295`).
3. Select everything in the editor, delete it, paste in the entire contents
   of **`firestore.rules`** from this codebase → **Publish**.

The domain is already set correctly (`tavasyacapital.in`) — no edit needed.

### Step 4 — Put it on GitHub Pages

1. New GitHub repository, e.g. `tavasya-investments` under the
   Tavasya-Capital organisation. Public is fine (see "On repo visibility").
2. Upload every file, **keeping the folder structure**:
   ```
   index.html, hub.js, common.js, config.js, styles.css, firestore.rules, README.md, .gitignore
   compliance.html, compliance.js
   investments.html, investments.js
   investor-relations.html, investor-relations.js
   scripts/send-reminders.js, scripts/send-compliance-reminders.js, scripts/migrate-compliance.js
   .github/workflows/reminders.yml, .github/workflows/migrate-compliance.yml
   ```
   If you're on a new Firebase project, upload the `config.js` you edited
   in Step 2, not the original.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch**, branch
   `main`, folder `/ (root)` → **Save**.
4. Wait ~30 seconds. Live at
   `https://tavasya-capital.github.io/tavasya-investments/`.

### Step 5 — Let Firebase trust the live address

Firebase → **Authentication → Settings → Authorised domains → Add domain**
→ `tavasya-capital.github.io`.

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
   else from the **Team** tab of any section; it's the same list.

### On repo visibility

The `firebaseConfig` values in `config.js` are meant to be public — they
identify which Firebase project to talk to, not who may access it. Real
access is enforced entirely by `firestore.rules` and the domain check.
Someone who finds the live URL still hits a sign-in wall and gets nowhere
without an `@tavasyacapital.in` account that's also on the team list. A
public repo is fine. (GitHub's free tier doesn't allow Pages on private
repos at all, so a public repo is usually the only option anyway.)

The service-account keys are a different matter entirely — each is a real
password to a whole database. They live in GitHub Secrets and never in the
repo. `.gitignore` is set up to help you avoid committing one by accident.

---

## What each Firestore collection is for

| Collection | Section | Contents |
|---|---|---|
| `users` | All | The team list and roles. Managed from any Team tab |
| `schemes` | All | The scheme list. Managed from any Schemes tab |
| `optionLists` | Investments, Investor Relations | Dropdown values added from inside the app via "+ Add new…" |
| `compliances` | Compliance | One document per obligation |
| `complianceTypes` | Compliance | The compliance type list |
| `reminderLog` | Compliance | What the daily mail last sent (written by the script only) |
| `investments` | Investments | One document per position, and one per CIRP case (`track: "cirp"`) |
| `investmentTasks` | Investments | One document per task, linked by `investmentId`. Sub-tasks are a `subtasks` list on the task, and its place in the team's order is `sortOrder`. The daily script also writes `lastReminderSent` and `reminderCount` back onto each task it emails |
| `investmentReminderLog` | Investments | What the daily mail last sent (written by the script only) |
| `investors` | Investor Relations | One document per investor |
| `investorTasks` | Investor Relations | One document per task, linked by `investorId`. Same shape as investment tasks |
| `investorReminderLog` | Investor Relations | What the daily mail last sent (written by the script only) |

Nothing else is reachable: the rules block everything else outright.

---

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Sign-in screen appears, then nothing works | `config.js` points at the wrong Firebase project, or one that isn't set up — Step 2 |
| Compliance or Investor Relations says "Missing or insufficient permissions" | The updated `firestore.rules` hasn't been published yet — "Switching over", step 1 |
| Compliance register is empty | The compliance data hasn't been copied across yet — "Switching over", steps 2–4 |
| "Missing or insufficient permissions" everywhere | Rules not published (Step 3), or the `users` document ID isn't the exact lowercase email, or `active` was saved as text `"true"` instead of boolean `true` |
| Confirmation email never arrives | Check spam; confirm the GitHub Pages domain is in Authorised domains (Step 5) |
| Signed in fine but told "Not set up yet" | That email isn't on the team list. Add it from a Team tab — or, for the very first account, Step 6 |
| Compliance reminders arrive twice | The old Compliance Register's workflow is still on — "Switching over", step 6 |
| Reminder emails don't arrive | Check the Actions tab log first. Usually a missing or misspelled secret, a service-account key from the wrong project, or every item genuinely outside its window |
| A task never emails anyone | It's probably saved as "Open / no date". Only time-bound tasks email |
| Excel import says "no scheme sheets recognized" | The file's column headers or per-sheet layout don't match the expected 10-column shape |

## What this costs

Nothing at this scale. Firebase's free tier covers far more reads and
writes than a small team browsing a few hundred records generates. GitHub
Pages and Actions are free for a repository this size. The Microsoft 365
SMTP calls cost nothing beyond the existing licence.
