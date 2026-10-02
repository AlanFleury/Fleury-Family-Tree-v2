/* Fleury Family Archive — secure auth + private API adapter.
   Authentication: Auth0 Database Connection (email/password).
   Data: private API protected by Auth0 access tokens. */
const CONFIG = window.FLEURY_CONFIG || {};
const required = ['AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_AUDIENCE','API_BASE_URL'];
function cfg(){ const missing=required.filter(k=>!CONFIG[k]); if(missing.length) throw new Error('Release configuration is incomplete: '+missing.join(', ')); return CONFIG; }
let auth0Client=null;
let user=null;
async function init(){
  const c=cfg();
  if(!window.createAuth0Client) throw new Error('Auth0 browser SDK did not load.');
  auth0Client=await window.createAuth0Client({domain:c.AUTH0_DOMAIN,clientId:c.AUTH0_CLIENT_ID,authorizationParams:{audience:c.AUTH0_AUDIENCE,redirect_uri:window.location.origin+window.location.pathname}});
  if(window.location.search.includes('code=') && window.location.search.includes('state=')){
    await auth0Client.handleRedirectCallback();
    history.replaceState({},document.title,window.location.pathname);
  }
  if(await auth0Client.isAuthenticated()) user=await auth0Client.getUser();
  return user;
}
async function initAuth(handleUser){ await init(); await handleUser(user); }
async function signInWithEmail(){
  const c=cfg();

  if(!auth0Client){
    await init();
  }

  if(!auth0Client){
    throw new Error('Auth0 could not be initialized.');
  }

  await auth0Client.loginWithRedirect({
    authorizationParams:{
      audience:c.AUTH0_AUDIENCE,
      scope:'openid profile email',
      screen_hint:'login'
    }
  });
}
async function signOutUser(){ await auth0Client.logout({logoutParams:{returnTo:window.location.origin+window.location.pathname}}); }
async function token(){ return auth0Client.getTokenSilently({authorizationParams:{audience:cfg().AUTH0_AUDIENCE}}); }
async function api(path,options={}){
  const t=await token();
  const headers=new Headers(options.headers||{}); headers.set('Authorization','Bearer '+t); headers.set('Content-Type','application/json');
  const r=await fetch(cfg().API_BASE_URL.replace(/\/$/,'')+path,{...options,headers});
  if(!r.ok) throw new Error((await r.text())||('HTTP '+r.status));
  return r.status===204?null:r.json();
}
async function getMyRole(){ const x=await api('/api/me'); return x?.role||null; }
async function loadDatabase(){ return api('/api/archive'); }
async function saveDatabase(db){ return api('/api/archive',{method:'PUT',body:JSON.stringify(db)}); }
async function savePersonMapping(email,personId){ return api('/api/mapping',{method:'PUT',body:JSON.stringify({email,personId})}); }
window.archiveApi={initAuth,signInWithEmail,signOutUser,getMyRole,loadDatabase,saveDatabase,savePersonMapping};
export {initAuth,signInWithEmail,signOutUser,getMyRole,loadDatabase,saveDatabase,savePersonMapping};
