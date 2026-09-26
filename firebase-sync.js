import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, getDocs, writeBatch, setDoc } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let auth=null, store=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn,label,tries=4){
  let last;
  for(let i=1;i<=tries;i++){
    try{return await fn()}catch(e){last=e;if(i<tries)await sleep(700*i);console.warn(label+' attempt '+i+' failed',e);}
  }
  throw new Error(label+': '+(last?.message||last));
}
export async function initAuth(callback){
  const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
  auth=getAuth(app);
  try{await setPersistence(auth,browserLocalPersistence)}catch(e){console.warn('Auth persistence unavailable:',e)}
  store=getFirestore(app);
  return onAuthStateChanged(auth,callback);
}
export async function signInWithGoogle(){
  if(!auth) throw new Error('Firebase authentication is not ready.');
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  await signInWithPopup(auth,provider);
}
export async function signOutUser(){if(auth) await signOut(auth)}
export async function getMyRole(uid){
  return retry(async()=>{
    const snap=await getDoc(doc(store,'users',uid));
    return snap.exists()?snap.data().role||null:null;
  },'Reading family access',4);
}
export async function loadDatabase(){
  if(!store) throw new Error('Firestore is not ready.');
  return retry(async()=>{
    const [peopleSnap,relSnap,metaSnap]=await Promise.all([
      getDocs(collection(store,'people')),
      getDocs(collection(store,'relationships')),
      getDoc(doc(store,'meta','archive-v5'))
    ]);
    const peopleDocs=peopleSnap.docs.filter(d=>d.id.startsWith('v5_')); const people=(peopleDocs.length?peopleDocs:peopleSnap.docs).map(d=>d.data());
    const relDocs=relSnap.docs.filter(d=>d.id.startsWith('v5_')); const relationships=(relDocs.length?relDocs:relSnap.docs).map(d=>d.data());
    if(!people.length) throw new Error('The private database returned 0 people. Please retry instead of opening an empty archive.');
    return {people,relationships,meta:metaSnap.exists()?metaSnap.data():{name:'Fleury Family Archive',version:'5.0'}};
  },'Loading the family archive',4);
}
export async function saveDatabase(database){
  if(!store) throw new Error('Firestore is not ready.');
  const chunk=400;
  const [existingPeople,existingRelationships]=await Promise.all([
    getDocs(collection(store,'people')),getDocs(collection(store,'relationships'))
  ]);
  const deletes=[...existingPeople.docs.filter(s=>s.id.startsWith('v5_')),...existingRelationships.docs.filter(s=>s.id.startsWith('v5_'))];
  for(let i=0;i<deletes.length;i+=chunk){
    const batch=writeBatch(store);
    deletes.slice(i,i+chunk).forEach(s=>batch.delete(s.ref));
    await batch.commit();
  }
  const writes=[];
  for(const p of database.people||[]){const id=String(p['Person ID']||'').trim();if(id)writes.push(['people','v5_'+id,p]);}
  for(const r of database.relationships||[]){const id=String(r.id||'').trim();if(id)writes.push(['relationships','v5_'+id,r]);}
  for(let i=0;i<writes.length;i+=chunk){
    const batch=writeBatch(store);
    writes.slice(i,i+chunk).forEach(([c,id,d])=>batch.set(doc(store,c,id),d));
    await batch.commit();
  }
  await setDoc(doc(store,'meta','archive-v5'),{...(database.meta||{}),updatedAt:new Date().toISOString(),version:'5.0'});
}

