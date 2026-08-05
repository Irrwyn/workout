import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Lets the app keep working offline (e.g. spotty mobile signal) and sync once back online.
try { enableIndexedDbPersistence(db); } catch (e) { /* multiple tabs open, or unsupported browser — fine, just no offline cache */ }

const provider = new GoogleAuthProvider();

// signInWithPopup doesn't work reliably in an iOS "Add to Home Screen"
// standalone app (there's no real popup window to return control to), so
// use the full-page redirect flow there; popup is still nicer on desktop/browser.
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function signIn() {
  return isStandalone ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
}
export function signOutUser() { return signOut(auth); }

// completes a pending signInWithRedirect flow on load (the redirect leaves and
// re-enters the app, so this can't be awaited from a signIn() click handler).
// onAuthStateChanged is the source of truth for whether sign-in worked; errors
// here just mean "no redirect was in flight" in the common case, so swallow them.
getRedirectResult(auth).catch(() => {});

export { onAuthStateChanged, doc, setDoc, getDoc, onSnapshot };
