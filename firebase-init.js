import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
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

export function signIn() { return signInWithPopup(auth, provider); }
export function signOutUser() { return signOut(auth); }

export { onAuthStateChanged, doc, setDoc, getDoc, onSnapshot };
