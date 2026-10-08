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
  try{
    return await auth0Client.getTokenSilently({
      authorizationParams:{audience:cfg().AUTH0_AUDIENCE}
    });
  }catch(e){
    const code=String(e?.error||'');
    if(code==='login_required'||code==='consent_required'||code==='interaction_required'){
      try{
        return await auth0Client.getTokenWithPopup({
          authorizationParams:{audience:cfg().AUTH0_AUDIENCE,scope:'openid profile email'}
        });
      }catch(popupError){
        throw new Error('Auth0 could not issue an archive access token. Please sign in again. '+(popupError?.message||popupError));
      }
    }
    throw new Error('Auth0 token request failed. '+(e?.message||e));
  }
}

async function api(path,options={}){
  let accessToken;
  try{
    accessToken=await token();
  }catch(e){
    throw new Error('Authentication failed before contacting the private archive. '+(e?.message||e));
  }

  const headers=new Headers(options.headers||{});
  headers.set('Authorization','Bearer '+accessToken);
  headers.set('Content-Type','application/json');

  const url=cfg().API_BASE_URL.replace(/\/$/,'')+path;
  let response;
  try{
    response=await fetch(url,{...options,headers,cache:'no-store'});
  }catch(e){
    throw new Error('The browser could not reach the private archive API at '+url+'. This is a network/CORS failure, not a family-data error. '+(e?.message||e));
  }

  if(!response.ok){
    const body=await response.text();
    throw new Error('Private archive API returned HTTP '+response.status+': '+(body||'No response body'));
  }

  try{
    return response.status===204 ? null : await response.json();
  }catch(e){
    throw new Error('The private archive API returned an invalid JSON response for '+path+'.');
  }
}

async function getMyRole(){
  const result=await api('/api/me');
  return result?.role||null;
}

/*
  The old /api/archive response was returning only 13,000 people and
  no relationships in the browser. The rebuilt loader reads the archive
  in smaller pages so no single D1/Worker response has to contain too
  much data.
*/
async function loadDatabase(){
  const people=[];
  const relationships=[];
  const PAGE_SIZE=2000;

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

async function listUsers(){
  return api('/api/users');
}

async function updateUser(email,role,personId=null){
  if(!email) throw new Error('An email address is required.');
  if(!['admin','editor','viewer'].includes(String(role).toLowerCase()))
    throw new Error('Role must be admin, editor, or viewer.');
  return api('/api/users',{
    method:'PUT',
    body:JSON.stringify({email,role:String(role).toLowerCase(),personId})
  });
}

async function savePersonMapping(email,personId){
  return api('/api/mapping',{
    method:'PUT',
    body:JSON.stringify({email,personId})
  });
}


async function restoreArchiveFromWorkbook(data,onProgress){
  if(!data||!Array.isArray(data.people)||!Array.isArray(data.relationships)) throw new Error('Invalid master workbook data.');
  if(data.people.length!==17972||data.relationships.length!==30079) throw new Error('Master workbook must contain exactly 17,972 people and 30,079 relationships.');
  await api('/api/archive/import/start',{method:'POST',body:JSON.stringify({})});
  const send=async(kind,rows)=>{for(let i=0;i<rows.length;i+=200){await api('/api/archive/import/batch',{method:'POST',body:JSON.stringify({kind,rows:rows.slice(i,i+200)})});if(onProgress)onProgress(kind,Math.min(i+200,rows.length),rows.length);}};
  await send('people',data.people); await send('relationships',data.relationships); await send('meta',data.meta||[]);
  const result=await api('/api/archive/import/finish',{method:'POST',body:JSON.stringify({})});
  if(!result?.ok) throw new Error('Verification failed: '+result.people+' people, '+result.relationships+' relationships.');
  return result;
}

window.archiveApi={
  initAuth,signInWithEmail,signOutUser,getMyRole,restoreArchiveFromWorkbook,
  loadDatabase,saveDatabase,savePerson,deletePerson,listUsers,updateUser,savePersonMapping
};
