/* Fleury Family Archive — clean rebuild API adapter. */
const CONFIG=window.FLEURY_CONFIG||{};
const required=['AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_AUDIENCE','API_BASE_URL'];
function cfg(){
  const missing=required.filter(k=>!CONFIG[k]);
  if(missing.length) throw new Error('Release configuration is incomplete: '+missing.join(', '));
  return CONFIG;
}
let auth0Client=null, user=null;
async function init(){
  const c=cfg();
  if(!window.auth0?.createAuth0Client) throw new Error('Auth0 browser SDK did not load.');
  auth0Client=await window.auth0.createAuth0Client({
    domain:c.AUTH0_DOMAIN,clientId:c.AUTH0_CLIENT_ID,
    authorizationParams:{audience:c.AUTH0_AUDIENCE,redirect_uri:location.origin+location.pathname}
  });
  if(location.search.includes('code=')&&location.search.includes('state=')){
    await auth0Client.handleRedirectCallback();
    history.replaceState({},document.title,location.pathname);
  }
  if(await auth0Client.isAuthenticated()) user=await auth0Client.getUser();
  return user;
}
async function initAuth(handler){ await init(); return handler(user); }
async function signInWithEmail(){
  const c=cfg();
  if(!auth0Client) await init();
  return auth0Client.loginWithRedirect({authorizationParams:{audience:c.AUTH0_AUDIENCE,scope:'openid profile email',screen_hint:'login'}});
}
async function signOutUser(){
  if(auth0Client) await auth0Client.logout({logoutParams:{returnTo:location.origin+location.pathname}});
}
async function token(){return auth0Client.getTokenSilently({authorizationParams:{audience:cfg().AUTH0_AUDIENCE}});}
async function api(path,options={}){
  const t=await token(), h=new Headers(options.headers||{});
  h.set('Authorization','Bearer '+t); h.set('Content-Type','application/json');
  const r=await fetch(cfg().API_BASE_URL.replace(/\/$/,'')+path,{...options,headers:h});
  if(!r.ok) throw new Error((await r.text())||('HTTP '+r.status));
  return r.status===204?null:r.json();
}
async function getMyRole(){const x=await api('/api/me');return x?.role||null;}
async function loadDatabase(){return api('/api/archive');}
async function saveDatabase(db){return api('/api/archive',{method:'PUT',body:JSON.stringify(db)});}
async function savePersonMapping(email,personId){return api('/api/mapping',{method:'PUT',body:JSON.stringify({email,personId})});}
window.archiveApi={initAuth,signInWithEmail,signOutUser,getMyRole,loadDatabase,saveDatabase,savePersonMapping};
