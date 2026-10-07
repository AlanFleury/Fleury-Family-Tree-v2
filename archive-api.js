/* Fleury Family Archive — secure Auth0 + private archive API adapter. */
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

  if(!window.auth0?.createAuth0Client){
    throw new Error('Auth0 browser SDK did not load.');
  }

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

  if(!auth0Client) throw new Error('Auth0 could not be initialized.');

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
    logoutParams:{
      returnTo:location.origin+location.pathname
    }
  });
}

async function token(){
  if(!auth0Client) await init();

  if(!auth0Client) throw new Error('Auth0 could not be initialized.');

  return auth0Client.getTokenSilently({
    authorizationParams:{
      audience:cfg().AUTH0_AUDIENCE
    }
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

async function loadDatabase(){
  const database=await api('/api/archive');

  if(!database ||
     !Array.isArray(database.people) ||
     !Array.isArray(database.relationships)){
    throw new Error('Private archive returned an invalid database.');
  }

  if(database.people.length===0){
    throw new Error(
      'The private archive returned 0 people. No data was changed.'
    );
  }

  return database;
}

async function saveDatabase(database){
  if(!database ||
     !Array.isArray(database.people) ||
     !Array.isArray(database.relationships)){
    throw new Error('Refusing to save an invalid archive.');
  }

  return api('/api/archive',{
    method:'PUT',
    body:JSON.stringify(database)
  });
}

/* Safe individual-person save. Does not replace the whole archive. */
async function savePerson(person,relationships){
  if(!person || !person.id){
    throw new Error('A valid person is required.');
  }

  if(!Array.isArray(relationships)){
    throw new Error('Invalid person relationships.');
  }

  return api('/api/person',{
    method:'PUT',
    body:JSON.stringify({
      person,
      relationships
    })
  });
}

/* Safe individual-person delete. Does not replace the whole archive. */
async function deletePerson(personId){
  if(!personId){
    throw new Error('A person ID is required.');
  }

  return api('/api/person',{
    method:'DELETE',
    body:JSON.stringify({personId})
  });
}

async function savePersonMapping(email,personId){
  return api('/api/mapping',{
    method:'PUT',
    body:JSON.stringify({email,personId})
  });
}

window.archiveApi={
  initAuth,
  signInWithEmail,
  signOutUser,
  getMyRole,
  loadDatabase,
  saveDatabase,
  savePerson,
  deletePerson,
  savePersonMapping
};

export {
  initAuth,
  signInWithEmail,
  signOutUser,
  getMyRole,
  loadDatabase,
  saveDatabase,
  savePerson,
  deletePerson,
  savePersonMapping
};
