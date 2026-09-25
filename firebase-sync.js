import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  writeBatch,
  deleteDoc
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let auth = null;
let store = null;

export function initAuth(callback) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  store = getFirestore(app);
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase authentication is not ready.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  if (!auth) return;
  await signOut(auth);
}

export async function getMyRole(uid) {
  const snap = await getDoc(doc(store, 'users', uid));
  return snap.exists() ? snap.data().role || null : null;
}

export async function loadDatabase() {
  const [peopleSnap, relSnap, metaSnap] = await Promise.all([
    getDocs(collection(store, 'people')),
    getDocs(collection(store, 'relationships')),
    getDoc(doc(store, 'meta', 'archive'))
  ]);

  return {
    people: peopleSnap.docs.map(d => d.data()),
    relationships: relSnap.docs.map(d => d.data()),
    meta: metaSnap.exists()
      ? metaSnap.data()
      : { name: 'Fleury Family Archive', version: '4.0' }
  };
}

export async function saveDatabase(database) {
  if (!store) throw new Error('Firestore is not ready.');

  const batch = writeBatch(store);

  const existingPeople = await getDocs(collection(store, 'people'));
  existingPeople.forEach(snap => batch.delete(snap.ref));

  const existingRelationships = await getDocs(collection(store, 'relationships'));
  existingRelationships.forEach(snap => batch.delete(snap.ref));

  for (const p of database.people || []) {
    const id = String(p['Person ID'] || '').trim();
    if (id) batch.set(doc(store, 'people', id), p);
  }

  for (const r of database.relationships || []) {
    const id = String(r.id || '').trim();
    if (id) batch.set(doc(store, 'relationships', id), r);
  }

  batch.set(doc(store, 'meta', 'archive'), {
    ...(database.meta || {}),
    updatedAt: new Date().toISOString(),
    version: '4.0'
  });

  await batch.commit();
}
