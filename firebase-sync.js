import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';

import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';


let auth = null;
let store = null;


const sleep = ms => new Promise(r => setTimeout(r, ms));


async function retry(fn, label, tries = 4) {
  let last;

  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;

      if (i < tries) {
        await sleep(700 * i);
      }

      console.warn(label + ' attempt ' + i + ' failed', e);
    }
  }

  throw new Error(label + ': ' + (last?.message || last));
}


/* =========================================================
   LOCAL CACHE
   ========================================================= */

const CACHE_NAME = 'fleury-family-archive-v5';

const CACHE_KEY =
  location.origin +
  location.pathname +
  '?archive-cache=v5';


async function readCache() {
  try {
    const cache = await caches.open(CACHE_NAME);

    const response = await cache.match(CACHE_KEY);

    return response ? await response.json() : null;

  } catch (e) {
    console.warn(
      'Family archive cache read unavailable:',
      e
    );

    return null;
  }
}


async function writeCache(database) {
  try {
    const cache = await caches.open(CACHE_NAME);

    await cache.put(
      CACHE_KEY,
      new Response(
        JSON.stringify(database),
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

  } catch (e) {
    console.warn(
      'Family archive cache write unavailable:',
      e
    );
  }
}


async function clearCache() {
  try {
    await caches.delete(CACHE_NAME);

  } catch (e) {
    console.warn(
      'Family archive cache clear unavailable:',
      e
    );
  }
}


/* =========================================================
   FIREBASE INITIALISATION
   ========================================================= */

export async function initAuth(callback) {

  const app =
    getApps().length
      ? getApps()[0]
      : initializeApp(firebaseConfig);

  auth = getAuth(app);

  try {

    await setPersistence(
      auth,
      browserLocalPersistence
    );

  } catch (e) {

    console.warn(
      'Auth persistence unavailable:',
      e
    );
  }

  store = getFirestore(app);

  /*
    Handle a Google redirect result if the user has just
    returned from Google authentication.

    It is safe if there is no redirect result.
  */

  try {

    await getRedirectResult(auth);

  } catch (e) {

    console.warn(
      'Google redirect result unavailable:',
      e
    );
  }

  return onAuthStateChanged(
    auth,
    callback
  );
}


/* =========================================================
   GOOGLE SIGN-IN
   ========================================================= */

/*
  Normal sign-in button.

  This uses a popup and is retained for normal visitors.
*/

export async function signInWithGoogle() {

  if (!auth) {
    throw new Error(
      'Firebase authentication is not ready.'
    );
  }

  const provider =
    new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: 'select_account'
  });

  await signInWithPopup(
    auth,
    provider
  );
}


/*
  Invite-link sign-in.

  This starts Google's redirect authentication.

  IMPORTANT:
  The invite link does NOT grant Firestore access by itself.
  Firebase still authenticates the Google account and the
  Firestore users/<uid> document still determines access.
*/

export async function signInWithGoogleRedirect() {

  if (!auth) {
    throw new Error(
      'Firebase authentication is not ready.'
    );
  }

  const provider =
    new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: 'select_account'
  });

  await signInWithRedirect(
    auth,
    provider
  );
}


/*
  Allows the HTML page to check whether Firebase already
  knows about a signed-in user.
*/

export function getCurrentUser() {

  return auth
    ? auth.currentUser
    : null;
}


/* =========================================================
   SIGN OUT
   ========================================================= */

export async function signOutUser() {

  if (auth) {
    await signOut(auth);
  }
}


/* =========================================================
   USER ROLE
   ========================================================= */

export async function getMyRole(uid) {

  return retry(
    async () => {

      const snap =
        await getDoc(
          doc(store, 'users', uid)
        );

      return snap.exists()
        ? snap.data().role || null
        : null;
    },
    'Reading family access',
    4
  );
}


/* =========================================================
   LOAD DATABASE
   ========================================================= */

export async function loadDatabase() {

  if (!store) {
    throw new Error(
      'Firestore is not ready.'
    );
  }

  return retry(
    async () => {

      /*
        First read only the tiny metadata document.

        If this device already has the same version cached,
        do NOT download the whole family database again.
      */

      const metaSnap =
        await getDoc(
          doc(
            store,
            'meta',
            'archive-v5'
          )
        );

      const remoteMeta =
        metaSnap.exists()
          ? metaSnap.data()
          : {
              name: 'Fleury Family Archive',
              version: '5.0'
            };


      const cached =
        await readCache();


      if (
        cached &&
        cached.people?.length &&
        (cached.meta?.updatedAt || '') ===
        (remoteMeta.updatedAt || '')
      ) {

        return cached;
      }


      /*
        The database has changed, or this device has no cache.

        Only now download the full collections.
      */

      const [
        peopleSnap,
        relSnap
      ] = await Promise.all([

        getDocs(
          collection(
            store,
            'people'
          )
        ),

        getDocs(
          collection(
            store,
            'relationships'
          )
        )

      ]);


      const peopleDocs =
        peopleSnap.docs.filter(
          d => d.id.startsWith('v5_')
        );


      const people =
        (
          peopleDocs.length
            ? peopleDocs
            : peopleSnap.docs
        ).map(
          d => d.data()
        );


      const relDocs =
        relSnap.docs.filter(
          d => d.id.startsWith('v5_')
        );


      const relationships =
        (
          relDocs.length
            ? relDocs
            : relSnap.docs
        ).map(
          d => d.data()
        );


      if (!people.length) {

        throw new Error(
          'The private database returned 0 people. Please retry instead of opening an empty archive.'
        );
      }


      const database = {

        people,

        relationships,

        meta: remoteMeta

      };


      await writeCache(
        database
      );


      return database;

    },
    'Loading the family archive',
    4
  );
}


/* =========================================================
   SAVE DATABASE
   ========================================================= */

export async function saveDatabase(database) {

  if (!store) {

    throw new Error(
      'Firestore is not ready.'
    );
  }


  const chunk = 400;


  /*
    Use the cached database to determine which old records
    were deleted.

    This avoids reading the entire Firestore collections
    just to find records to delete.
  */

  const cached =
    await readCache();


  const oldPeopleIds =
    new Set(

      (cached?.people || [])

        .map(
          p =>
            String(
              p['Person ID'] || ''
            ).trim()
        )

        .filter(Boolean)

    );


  const oldRelIds =
    new Set(

      (cached?.relationships || [])

        .map(
          r =>
            String(
              r.id || ''
            ).trim()
        )

        .filter(Boolean)

    );


  const newPeopleIds =
    new Set(

      (database.people || [])

        .map(
          p =>
            String(
              p['Person ID'] || ''
            ).trim()
        )

        .filter(Boolean)

    );


  const newRelIds =
    new Set(

      (database.relationships || [])

        .map(
          r =>
            String(
              r.id || ''
            ).trim()
        )

        .filter(Boolean)

    );


  const deletes = [];


  oldPeopleIds.forEach(
    id => {

      if (!newPeopleIds.has(id)) {

        deletes.push(
          [
            'people',
            'v5_' + id
          ]
        );

      }

    }
  );


  oldRelIds.forEach(
    id => {

      if (!newRelIds.has(id)) {

        deletes.push(
          [
            'relationships',
            'v5_' + id
          ]
        );

      }

    }
  );


  /*
    Delete old records in batches.
  */

  for (
    let i = 0;
    i < deletes.length;
    i += chunk
  ) {

    const batch =
      writeBatch(store);


    deletes

      .slice(
        i,
        i + chunk
      )

      .forEach(
        ([c, id]) => {

          batch.delete(
            doc(
              store,
              c,
              id
            )
          );

        }
      );


    await batch.commit();
  }


  const writes = [];


  /*
    Prepare people records.
  */

  for (
    const p of database.people || []
  ) {

    const id =
      String(
        p['Person ID'] || ''
      ).trim();


    if (id) {

      writes.push(
        [
          'people',
          'v5_' + id,
          p
        ]
      );

    }

  }


  /*
    Prepare relationship records.
  */

  for (
    const r of database.relationships || []
  ) {

    const id =
      String(
        r.id || ''
      ).trim();


    if (id) {

      writes.push(
        [
          'relationships',
          'v5_' + id,
          r
        ]
      );

    }

  }


  /*
    Write records in batches.

    Firestore batch limit is respected by using 400.
  */

  for (
    let i = 0;
    i < writes.length;
    i += chunk
  ) {

    const batch =
      writeBatch(store);


    writes

      .slice(
        i,
        i + chunk
      )

      .forEach(
        ([c, id, d]) => {

          batch.set(
            doc(
              store,
              c,
              id
            ),
            d
          );

        }
      );


    await batch.commit();
  }


  /*
    Update metadata after the database has been saved.
  */

  const saved = {

    ...database,

    meta: {

      ...(database.meta || {}),

      updatedAt:
        new Date().toISOString(),

      version: '5.0'

    }

  };


  await setDoc(

    doc(
      store,
      'meta',
      'archive-v5'
    ),

    saved.meta

  );


  /*
    Update this device's local cache.
  */

  await writeCache(
    saved
  );
}
