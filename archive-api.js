/* Fleury Family Archive — secure Auth0 + paginated private archive API adapter. */
const CONFIG=window.FLEURY_CONFIG||{};
const required=['AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_AUDIENCE','API_BASE_URL'];

function cfg(){
  const missing=required.filter(k=>!CONFIG[k]);
  if(missing.length) throw new Error('Release configuration is incomplete: '+missing.join(', '));
  return CONFIG;
}

let auth0Client=null;
let currentUser=null;

async function init(){
  const c=cfg();
  if(!window.auth0?.createAuth0Client) throw new Error('Auth0 browser SDK did not load.');

  auth0Client=await window.auth0.createAuth0Client({
    domain:c.AUTH0_DOMAIN,
    clientId:c.AUTH0_CLIENT_ID,
    authorizationParams:{
      audience:c.AUTH0_AUDIENCE,
      redirect_uri:location.origin+location.pathname
    }
  });

  if(location.search.includes('code=')&&location.search.includes('state=')){
    await auth0Client.handleRedirectCallback();
    history.replaceState({},document.title,location.pathname);
  }

  currentUser=await auth0Client.isAuthenticated()
    ? await auth0Client.getUser()
    : null;

  return currentUser;
}

async function initAuth(handler){
  const user=await init();
  return typeof handler==='function' ? handler(user) : user;
}

async function signInWithEmail(){
  const c=cfg();
  if(!auth0Client) await init();
  await auth0Client.loginWithRedirect({
    authorizationParams:{
      audience:c.AUTH0_AUDIENCE,
      scope:'openid profile email',
      screen_hint:'login'
    }
  });
}

async function signOutUser(){
  if(!auth0Client) return;
  await auth0Client.logout({
    logoutParams:{returnTo:location.origin+location.pathname}
  });
}

async function token(){
  if(!auth0Client) await init();
  return auth0Client.getTokenSilently({
    authorizationParams:{audience:cfg().AUTH0_AUDIENCE}
  });
}

async function api(path,options={}){
  const accessToken=await token();
  const headers=new Headers(options.headers||{});
  headers.set('Authorization','Bearer '+accessToken);
  headers.set('Content-Type','application/json');

  const response=await fetch(
    cfg().API_BASE_URL.replace(/\/$/,'')+path,
    {...options,headers}
  );

  if(!response.ok){
    const body=await response.text();
    throw new Error(body||('HTTP '+response.status));
  }

  return response.status===204 ? null : response.json();
}

async function getMyRole(){
  const result=await api('/api/me');
  return result?.role||null;
}

/*
  The old /api/archive response was returning only 13,000 people and
  no relationships in the browser. The rebuilt loader deliberately
  reads the archive in small pages so no single D1/Worker response
  has to contain the whole archive.
*/
async function loadDatabase(){
  const people=[];
  const relationships=[];
  const PAGE_SIZE=5000;

  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await api(
      `/api/archive/page?table=people&offset=${offset}&limit=${PAGE_SIZE}`
    );
    if(!page || !Array.isArray(page.people))
      throw new Error('Private archive returned an invalid people page.');
    people.push(...page.people);
    if(page.people.length<PAGE_SIZE) break;
  }

  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await api(
      `/api/archive/page?table=relationships&offset=${offset}&limit=${PAGE_SIZE}`
    );
    if(!page || !Array.isArray(page.relationships))
      throw new Error('Private archive returned an invalid relationship page.');
    relationships.push(...page.relationships);
    if(page.relationships.length<PAGE_SIZE) break;
  }

  const metaPage=await api('/api/archive/page?table=meta&offset=0&limit=5000');
  const meta=metaPage?.meta||{};

  if(!people.length)
    throw new Error('The private archive returned 0 people. No data was changed.');

  return {people,relationships,meta};
}

/* Kept for legacy/manual use. The website must not call this for person edits. */
async function saveDatabase(database){
  if(!database || !Array.isArray(database.people) || !Array.isArray(database.relationships))
    throw new Error('Refusing to save an invalid archive.');
  return api('/api/archive',{method:'PUT',body:JSON.stringify(database)});
}

/* Safe individual-person save. */
async function savePerson(person,relationships){
  if(!person) throw new Error('A valid person is required.');
  const id=String(person['Person ID']||person.person_id||person.id||'');
  if(!id) throw new Error('A valid person ID is required.');
  if(!Array.isArray(relationships)) throw new Error('Invalid person relationships.');

  const payload={...person};
  payload['Person ID']=id;
  return api('/api/person',{
    method:'PUT',
    body:JSON.stringify({person:payload,relationships})
  });
}

/* Safe individual-person delete. */
async function deletePerson(personId){
  if(!personId) throw new Error('A person ID is required.');
  return api('/api/person',{
    method:'DELETE',
    body:JSON.stringify({personId:String(personId)})
  });
}

async function savePersonMapping(email,personId){
  return api('/api/mapping',{
    method:'PUT',
    body:JSON.stringify({email,personId})
  });
}

window.archiveApi={
  initAuth,signInWithEmail,signOutUser,getMyRole,
  loadDatabase,saveDatabase,savePerson,deletePerson,savePersonMapping
};

export {
  initAuth,signInWithEmail,signOutUser,getMyRole,
  loadDatabase,saveDatabase,savePerson,deletePerson,savePersonMapping
};
