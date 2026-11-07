// Inicialización de Firebase compartida por la app y el panel.
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "firebase/auth";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs, Timestamp,
} from "firebase/firestore";

const app = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
function base() {
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager({}) }) }); }
  catch { return getFirestore(app); }
}
export const db = base();
export { onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs, Timestamp };
