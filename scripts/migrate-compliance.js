// One-off: copies the Compliance Register's records from its old Firebase
// project (tavasya-compliance-a2295) into the tavasya-investments project
// that Compliance, Investments and Investor Relations now share.
// Run it from the Actions tab: "Copy compliance data across (one-off)".
//
// What it copies, keeping every document's ID:
//   compliances      — every obligation, with owners, links, completion
//                      proofs and reminder counts exactly as they are
//   complianceTypes  — the type list (a type whose name already exists in
//                      the new project is skipped, so nothing is doubled)
//   reminderLog      — what the old daily email last sent
//   schemes          — only schemes the new project doesn't have yet
//                      (matched by code and by name)
//
// What it deliberately does NOT copy: the old project's team list and
// sign-ins. Everyone signs in with their existing Tavasya Investments
// account, and the team list there covers all three sections. The log
// lists anyone who was on the old compliance team list but isn't on the
// new one, so an Admin can add them from the Team tab if they should
// have access.
//
// Safe to run more than once. A document that already exists in the new
// project is left alone, so anything edited there since is never
// overwritten. Nothing in the old project is changed or deleted.
//
// Environment:
//   MODE                               — "dry-run" (default: report only,
//                                        write nothing) or "copy"
//   COMPLIANCE_SERVICE_ACCOUNT_JSON    — key for the OLD compliance project
//   FIREBASE_SERVICE_ACCOUNT_JSON      — key for tavasya-investments

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const MODE = (process.env.MODE || "dry-run").trim();
if (!["dry-run", "copy"].includes(MODE)) throw new Error(`MODE must be "dry-run" or "copy", not "${MODE}"`);
const writing = MODE === "copy";

const need = (name) => {
  if (!process.env[name]) throw new Error(`Missing the ${name} secret. See README "Moving the compliance data across".`);
  return JSON.parse(process.env[name]);
};
const sourceKey = need("COMPLIANCE_SERVICE_ACCOUNT_JSON");
const targetKey = need("FIREBASE_SERVICE_ACCOUNT_JSON");
if (sourceKey.project_id === targetKey.project_id) {
  throw new Error(`Both keys are for the same project (${targetKey.project_id}). COMPLIANCE_SERVICE_ACCOUNT_JSON must be the OLD compliance project's key.`);
}

const source = getFirestore(initializeApp({ credential: cert(sourceKey) }, "source"));
const target = getFirestore(initializeApp({ credential: cert(targetKey) }, "target"));

console.log(`Mode: ${MODE}${writing ? "" : " (nothing will be written)"}`);
console.log(`From: ${sourceKey.project_id}  →  To: ${targetKey.project_id}\n`);

const all = async (db, name) => (await db.collection(name).get()).docs;

// Writes in batches of 400 (Firestore caps a batch at 500).
async function write(name, docs) {
  if (!writing || !docs.length) return;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = target.batch();
    docs.slice(i, i + 400).forEach((d) => batch.set(target.collection(name).doc(d.id), d.data()));
    await batch.commit();
  }
}

// Copies every document whose ID the new project doesn't already have.
async function copyById(name) {
  const [src, dst] = await Promise.all([all(source, name), all(target, name)]);
  const have = new Set(dst.map((d) => d.id));
  const fresh = src.filter((d) => !have.has(d.id));
  await write(name, fresh);
  console.log(`${name}: ${src.length} in the old project — ${fresh.length} ${writing ? "copied" : "to copy"}, ${src.length - fresh.length} already there (left alone)`);
  return src;
}

async function run() {
  const compliances = await copyById("compliances");
  await copyById("reminderLog");

  // Types: also skip any whose NAME already exists, whatever its ID.
  {
    const [src, dst] = await Promise.all([all(source, "complianceTypes"), all(target, "complianceTypes")]);
    const ids = new Set(dst.map((d) => d.id));
    const names = new Set(dst.map((d) => String(d.data().name || "").toLowerCase()));
    const fresh = src.filter((d) => !ids.has(d.id) && !names.has(String(d.data().name || "").toLowerCase()));
    await write("complianceTypes", fresh);
    console.log(`complianceTypes: ${src.length} in the old project — ${fresh.length} ${writing ? "copied" : "to copy"}, ${src.length - fresh.length} already there`);
  }

  // Schemes are shared with Investments, so only add ones that are new by
  // both code and name.
  {
    const [src, dst] = await Promise.all([all(source, "schemes"), all(target, "schemes")]);
    const codes = new Set(dst.map((d) => d.id));
    const names = new Set(dst.map((d) => String(d.data().name || "").toLowerCase()));
    const fresh = src.filter((d) => !codes.has(d.id) && !names.has(String(d.data().name || "").toLowerCase()));
    await write("schemes", fresh);
    console.log(`schemes: ${src.length} in the old project — ${fresh.length} ${writing ? "copied" : "to copy"}${fresh.length ? ` (${fresh.map((d) => d.data().name).join(", ")})` : ""}, the rest already exist`);

    // Compliance rows point at their scheme by NAME. Flag any name that
    // won't match a scheme in the new project.
    const known = new Set([...dst, ...fresh].map((d) => d.data().name));
    const missing = [...new Set(compliances.map((d) => d.data().scheme).filter((n) => n && !known.has(n)))];
    if (missing.length) {
      console.log(`\n⚠ Compliance rows refer to scheme names the new project doesn't have: ${missing.join(", ")}.`);
      console.log(`  They'll still show in the register, but won't match a scheme in the dropdowns. Rename the scheme on the Schemes tab, or edit those rows.`);
    }
  }

  // Team list: reported, never copied.
  {
    const [src, dst] = await Promise.all([all(source, "users"), all(target, "users")]);
    const onNew = new Set(dst.map((d) => d.id));
    const notOnNew = src.filter((d) => d.data().active === true && !onNew.has(d.id));
    const owners = [...new Set(compliances.flatMap((d) => [d.data().ownerEmail, d.data().ccEmail]).filter((e) => e && !onNew.has(e)))];
    console.log(`\nTeam list: not copied (sign-ins stay as they are in Tavasya Investments).`);
    if (notOnNew.length) {
      console.log(`  Active on the old compliance team list but not on the current one (add them from the Team tab if they should have access):`);
      notOnNew.forEach((d) => console.log(`    - ${d.id} (${d.data().name || "no name"}, ${d.data().role || "member"})`));
    }
    if (owners.length) {
      console.log(`  Compliance rows owned or CC'd to people not on the current team list: ${owners.join(", ")}. Their reminder emails still go to those addresses.`);
    }
  }

  console.log(writing
    ? "\nDone. Open the Compliance section to check the register, then switch off the old Compliance Register's daily email (see README)."
    : "\nDry run finished — nothing was written. Run it again with mode \"copy\" to copy for real.");
}

run().catch((e) => { console.error(e); process.exit(1); });
