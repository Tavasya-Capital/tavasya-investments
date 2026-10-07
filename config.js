// ============================================================
//  EDIT THIS FILE — it is the only one you need to change.
//  Everything else works as-is.
//
//  Compliance, Investments and Investor Relations all run on this one
//  Firebase project: one sign-in, one team list, one database.
// ============================================================

// 1. Your team's email domain. Only these addresses can sign in.
export const ORG_DOMAIN = "tavasyacapital.in";

// 2. The Firebase project everything runs on. It's still called "Tavasya
//    Investments" (project ID tavasya-investments, project number
//    16070672279), from before Compliance and Investor Relations joined.
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
//
//    The lists below are STARTING values, not the final word. Every
//    dropdown built from them ends with a "+ Add new…" choice, and
//    anything added that way is saved to the database and appears for
//    everyone, in every browser, from then on. You only need to edit
//    this file if you want to change the starting set for a fresh
//    deployment, or reorder the stages.
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
  // dashboard's "By stage" panel and the stage filter both follow this
  // sequence, and any stage added later from the dropdown is appended
  // after these.
  stages: [
    "Screening",
    "IC Review",
    "Approved",
    "Executed",
    "Monitoring",
    "Exit",
    "Dropped"
  ],

  // Where a CIRP case sits before it becomes an investment. These drive the
  // CIRP tab. Once the resolution plan is approved, "Move to Investments"
  // on the case moves it to the Investments tab, tasks and all. Any stage
  // added later from the dropdown is appended after these.
  cirpStages: [
    "Evaluating",
    "EOI submitted",
    "Shortlisted (PRA list)",
    "Resolution plan submitted",
    "Plan approved by CoC",
    "Plan approved by NCLT",
    "Withdrawn"
  ],

  // Optional. Which tranche of a position this record is, when a Scheme
  // goes into the same investment more than once.
  tranches: ["Tranche 1", "Tranche 2", "Tranche 3"],

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
  ],

  // How urgent a task is. "Normal" is the default and shows no tag in
  // the lists — only the ones above it get a coloured label. Shared by
  // Investments and Investor Relations tasks.
  priorities: ["Normal", "High", "Critical"],


  // ---------------- Compliance ----------------
  // Carried over from the standalone Compliance Register.
  frequencies: [
    "One-time", "Per valuation", "Ongoing", "Quarterly",
    "Half-yearly", "Annual", "Phased"
  ],
  // Seed values only — the live list lives in Firestore (complianceTypes
  // collection) so anyone can add a new type inline from the compliance
  // form. This array just seeds that collection the first time it's empty.
  defaultComplianceTypes: [
    "SEBI/AIF Regulatory", "Tax", "Statutory/ROC", "Other"
  ],


  // ---------------- Investor Relations ----------------
  // Starting values for the investor form's dropdowns. Like the
  // Investments ones, each ends with "+ Add new…" in the app.
  investorTypes: ["Individual", "Company", "Partnership", "Trust"],

  // Where the relationship stands. Order matters: the dashboard's
  // "By status" panel follows it.
  investorStatuses: [
    "Prospect",
    "In discussion",
    "Committed",
    "Onboarded",
    "Exited"
  ],

  investorIndustries: [
    "Family Office",
    "Financial Services",
    "Manufacturing",
    "Real Estate",
    "Technology",
    "Healthcare",
    "Professional Services",
    "Other"
  ],

  investorTaskCategories: [
    "KYC / Onboarding",
    "Documentation",
    "Drawdown / Capital call",
    "Distribution",
    "Reporting",
    "Meeting / Call",
    "Other"
  ]
};
