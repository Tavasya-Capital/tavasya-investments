// ============================================================
//  Shared by every page: one Firebase connection, one sign-in.
//
//  Signing in happens once, on index.html. Firebase keeps the session in
//  the browser, so the Compliance, Investments and Investor Relations
//  pages all see the same signed-in person without asking again.
//  Each of those pages calls requireSession() before showing anything.
// ============================================================
import { ORG_DOMAIN, firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// The three functions the hub offers. The key doubles as the ?next= value
// that brings someone back to the page they were on after signing in.
export const FUNCTIONS = {
  compliance: { name: "Compliance", page: "compliance.html" },
  investments: { name: "Investments", page: "investments.html" },
  "investor-relations": { name: "Investor Relations", page: "investor-relations.html" }
};

// Resolves with { user, profile } once the person is signed in, has
// confirmed their email, is on our domain and is active on the team list.
// Anything else sends them to the sign-in page, which brings them back
// here afterwards. Signing out later (from any page) lands here too, and
// so redirects to sign-in.
export function requireSession(sectionKey) {
  const toSignIn = () => location.replace(`index.html?next=${encodeURIComponent(sectionKey)}`);
  return new Promise((resolve) => {
    let resolved = false;
    onAuthStateChanged(auth, async (user) => {
      const email = ((user && user.email) || "").toLowerCase();
      if (!user || !user.emailVerified || !email.endsWith("@" + ORG_DOMAIN)) { toSignIn(); return; }
      if (resolved) return;
      try {
        const snap = await getDoc(doc(db, "users", email));
        if (!snap.exists() || snap.data().active !== true) { toSignIn(); return; }
        resolved = true;
        resolve({ user, profile: snap.data() });
      } catch (e) {
        toSignIn();
      }
    });
  });
}

export function signOutWithConfirm() {
  if (confirm("Sign out of Tavasya Capital?")) signOut(auth);
}
