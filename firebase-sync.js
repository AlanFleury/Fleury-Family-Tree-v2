```js
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let app, auth, store;

export async function initAuth(callback) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  store = getFirestore(app);

  onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  await signOut(auth);
}

export async function getMyRole(uid) {
  const snap = await getDoc(doc(store, 'users', uid));
  return snap.exists() ? snap.data().role : null;
}

export async function loadDatabase() {
  const peopleSnap = await getDocs(collection(store, 'people'));
  const relSnap = await getDocs(collection(store, 'relationships'));
  const metaSnap = await getDoc(doc(store, 'meta', 'archive'));

  return {
    people: peopleSnap.docs.map(d => d.data()),
    relationships: relSnap.docs.map(d => d.data()),
    meta: metaSnap.exists()
      ? metaSnap.data()
      : { name: 'Fleury Family Archive', version: '3.0' }
  };
}

export async function saveDatabase(database) {
  const batch = writeBatch(store);
  const peopleRef = collection(store, 'people');
  const relRef = collection(store, 'relationships');

  for (const p of database.people) {
    batch.set(doc(peopleRef, p['Person ID']), p);
  }

  for (const r of database.relationships) {
    batch.set(doc(relRef, r.id), r);
  }

  batch.set(doc(store, 'meta', 'archive'), {
    ...(database.meta || {}),
    updatedAt: new Date().toISOString(),
    version: '3.0'
  });

  await batch.commit();
}
```
