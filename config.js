// ============================================================
//  EDIT THIS FILE — it is the only one you need to change.
//  Everything else works as-is.
//
//  This app runs on its OWN Firebase project, entirely separate from
//  the compliance register. That means its own database, its own
//  sign-ins and its own team list — nothing here can affect the
//  compliance app, and nothing there can affect this one. The trade-off
//  is that everyone sets a password here once, separately, the first
//  time they sign in.
// ============================================================

// 1. Your team's email domain. Only these addresses can sign in.
export const ORG_DOMAIN = "tavasyacapital.in";

// 2. The "Tavasya Investments" Firebase project (project ID
//    tavasya-investments, project number 16070672279).
//
//    These aren't secrets — they only say WHICH Firebase project to talk
//    to, not who may read it. Access is enforced by firestore.rules and
//    the domain check above.
//
//    If you ever need them again: Firebase Console → gear icon → Project
//    settings → Your apps → the web app → Config.
export const firebaseConfig = {
  apiKey: "AIzaSyBm3ptUTJklsaKYHzziXj2KD3N2Hr_DTsI",
  authDomain: "tavasya-investments.firebaseapp.com",
  projectId: "tavasya-investments",
  storageBucket: "tavasya-investments.firebasestorage.app",
  messagingSenderId: "16070672279",
  appId: "1:16070672279:web:8a36477c1be24c9413ced2"
};


// 3. Dropdown values and starting data used across the app.
export const OPTIONS = {
  // Seeded into the database the very first time an Admin signs in, so the
  // three scheme buttons are there from day one rather than an empty bar.
  // After that this list is ignored — schemes live in the database and are
  // added or archived from the Schemes tab inside the app.
  //
  // `code` is a short internal key (2–6 letters). `name` is what everyone sees.
  defaultSchemes: [
    { code: "SSF", name: "TAVASYA SSF" },
    { code: "MS2", name: "TAVASYA Mudrikaran Scheme II" },
    { code: "MS3", name: "TAVASYA Mudrikaran Scheme III" }
  ],

  // The order the scheme buttons appear in, by code. Anything not listed
  // here is appended afterwards in alphabetical order, so a scheme added
  // from the Schemes tab still shows up without this file being touched —
  // it just lands at the end until you add its code here.
  schemeOrder: ["SSF", "MS2", "MS3"],

  // Where an investment sits in its lifecycle. Order matters — the
  // dashboard and the stage filter both follow this sequence.
  stages: [
    "Screening",
    "IC Review",
    "Approved",
    "Executed",
    "Monitoring",
    "Exited",
    "Dropped"
  ],

  // What the Scheme actually holds. Add to this list freely; existing
  // records keep whatever they were saved with.
  instruments: [
    "Security Receipt (SR)",
    "Assigned Debt",
    "Resolution Plan (CIRP)",
    "Equity",
    "NCD / Debenture",
    "Structured Credit",
    "Other"
  ],

  sectors: [
    "Manufacturing",
    "Real Estate",
    "Infrastructure",
    "Financial Services",
    "Power",
    "Textiles",
    "Hospitality",
    "Other"
  ],

  // Offered in the "remind me this many days before" dropdown when a
  // task is time-bound. 15 is the default, matching the compliance app.
  reminderLeadDays: [1, 3, 5, 7, 15, 30, 45, 60, 90],

  // Optional grouping for tasks, so a 40-task investment stays readable.
  taskCategories: [
    "Diligence",
    "Legal / Documentation",
    "Regulatory",
    "NCLT / Litigation",
    "Payment / Funding",
    "Monitoring",
    "Exit",
    "Other"
  ]
};
