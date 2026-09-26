import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
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

export async function initAuth(callback) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn('Browser-local Firebase auth persistence unavailable:', e);
  }
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
    getDoc(doc(store, 'meta', 'archive-v5'))
  ]);

  return {
    people: peopleSnap.docs.filter(d => d.id.startsWith('v5_')).map(d => d.data()),
    relationships: relSnap.docs.filter(d => d.id.startsWith('v5_')).map(d => d.data()),
    meta: metaSnap.exists()
      ? metaSnap.data()
      : { name: 'Fleury Family Archive', version: '4.0' }
  };
}

export async function saveDatabase(database) {
  if (!store) throw new Error('Firestore is not ready.');

  const chunkSize = 400;
  const existingPeople = await getDocs(collection(store, 'people'));
  const existingRelationships = await getDocs(collection(store, 'relationships'));
  const deletes = [...existingPeople.docs.filter(s => s.id.startsWith('v5_')), ...existingRelationships.docs.filter(s => s.id.startsWith('v5_'))];
  for (let i = 0; i < deletes.length; i += chunkSize) {
    const batch = writeBatch(store);
    deletes.slice(i, i + chunkSize).forEach(snap => batch.delete(snap.ref));
    await batch.commit();
  }

  const writes = [];
  for (const p of database.people || []) {
    const id = String(p['Person ID'] || '').trim();
    if (id) writes.push(['people', 'v5_' + id, p]);
  }
  for (const r of database.relationships || []) {
    const id = String(r.id || '').trim();
    if (id) writes.push(['relationships', 'v5_' + id, r]);
  }
  for (let i = 0; i < writes.length; i += chunkSize) {
    const batch = writeBatch(store);
    writes.slice(i, i + chunkSize).forEach(([col, id, data]) => batch.set(doc(store, col, id), data));
    await batch.commit();
  }

  await setDoc(doc(store, 'meta', 'archive-v5'), {
    ...(database.meta || {}),
    updatedAt: new Date().toISOString(),
    version: '5.0'
  });
}
