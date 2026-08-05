import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged
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

export { onAuthStateChanged, doc, setDoc, getDoc, onSnapshot };
