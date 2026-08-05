import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged,
  EmailAuthProvider, linkWithCredential
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

// Email/password rather than Google sign-in: Google's OAuth flow refuses to
// complete inside any WebView, which is exactly what an iOS "Add to Home
// Screen" standalone app is (no popup or redirect trick gets around it).
// Email/password is a plain Firebase call, so it works the same everywhere.
export function signInEmail(email, password) { return signInWithEmailAndPassword(auth, email, password); }
export function createAccountEmail(email, password) { return createUserWithEmailAndPassword(auth, email, password); }
export function resetPasswordEmail(email) { return sendPasswordResetEmail(auth, email); }
export function signOutUser() { return signOut(auth); }

// attaches a password to the CURRENTLY signed-in account (same uid, same
// Firestore doc/history) instead of creating a brand-new account — this is
// what lets a Google-signed-in session (e.g. still logged in from before) add
// password sign-in without losing/duplicating its data.
export function linkPasswordToAccount(password) {
  const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
  return linkWithCredential(auth.currentUser, cred);
}

export { onAuthStateChanged, doc, setDoc, getDoc, onSnapshot };
