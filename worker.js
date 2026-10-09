const AUTH0_DOMAIN = "dev-rd7gx3zdpkuccxmn.uk.auth0.com";
const AUTH0_AUDIENCE = "https://fleury-family-api";
// Deployment configuration verified 2026-10-08.

function cors(env,origin="") {
  const allowed = new Set([
    "https://alanfleury.github.io",
    "http://localhost:8000",
    "http://localhost:8080",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080"
  ]);
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://alanfleury.github.io",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data,status=200,env,origin="") {
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      ...cors(env,origin),
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    }
  });
}

function base64urlToUint8Array(value){
  const base64=value.replace(/-/g,"+").replace(/_/g,"/")
    .padEnd(Math.ceil(value.length/4)*4,"=");
  const binary=atob(base64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function decodeJwtPart(value){
  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(value)));
}

async function verifyJwt(token,env){
  const parts=token.split(".");
  if(parts.length!==3) throw new Error("Invalid access token");

  const header=decodeJwtPart(parts[0]);
  const payload=decodeJwtPart(parts[1]);
  if(header.alg!=="RS256") throw new Error("Unsupported token algorithm");

  const issuer=`https://${AUTH0_DOMAIN}/`;
  if(payload.iss!==issuer) throw new Error("Invalid token issuer");

  const audience=payload.aud;
  const validAudience=Array.isArray(audience)
    ? audience.includes(AUTH0_AUDIENCE)
    : audience===AUTH0_AUDIENCE;
  if(!validAudience) throw new Error("Invalid token audience");
  if(payload.exp && Date.now()/1000>=payload.exp) throw new Error("Access token expired");

  const jwksResponse=await fetch(`${issuer}.well-known/jwks.json`);
  if(!jwksResponse.ok) throw new Error("Unable to load Auth0 signing keys");
  const jwks=await jwksResponse.json();
  const jwk=jwks.keys.find(key=>key.kid===header.kid);
  if(!jwk) throw new Error("Signing key not found");

  const cryptoKey=await crypto.subtle.importKey(
    "jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]
  );
  const data=new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature=base64urlToUint8Array(parts[2]);
  const valid=await crypto.subtle.verify(
    {name:"RSASSA-PKCS1-v1_5"},cryptoKey,signature,data
  );
  if(!valid) throw new Error("Invalid access token signature");
  return payload;
}

async function auth(request,env){
  const h=request.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer ")) throw new Error("Missing access token");

  const token=h.slice(7);
  const payload=await verifyJwt(token,env);
  const sub=String(payload.sub||"");
  if(!sub) throw new Error("Invalid subject");

  let row=await env.DB.prepare(
    "SELECT role, person_id AS personId, email FROM users WHERE auth_sub=?"
  ).bind(sub).first();

  // One-time bootstrap for the archive owner. The email is accepted only
  // when Auth0's /userinfo endpoint confirms the authenticated identity.
  if(!row){
    const userinfoResponse=await fetch(`https://${AUTH0_DOMAIN}/userinfo`,{
      headers:{Authorization:`Bearer ${token}`}
    });

    if(userinfoResponse.ok){
      const profile=await userinfoResponse.json();
      const email=String(profile?.email||"").trim().toLowerCase();
      const verified=profile?.email_verified===true;

      if(verified && email==="alanfleury1@gmail.com"){
        const existing=await env.DB.prepare(
          "SELECT auth_sub FROM users WHERE lower(email)=lower(?)"
        ).bind(email).first();

        if(existing){
          await env.DB.prepare(
            "UPDATE users SET auth_sub=?, role='admin' WHERE lower(email)=lower(?)"
          ).bind(sub,email).run();
        }else{
          await env.DB.prepare(
            "INSERT INTO users(auth_sub,email,role) VALUES(?,?,?)"
          ).bind(sub,email,"admin").run();
        }

        row=await env.DB.prepare(
          "SELECT role, person_id AS personId, email FROM users WHERE auth_sub=?"
        ).bind(sub).first();
      }
    }
  }

  if(!row) throw new Error("Account is not approved for the family archive");
  return {...row,sub};
}

function mapPerson(r){
  const x={...r};
  delete x.name;
  x["Person ID"]=x.person_id;
  delete x.person_id;
  x.Name=r.name;
  return x;
}


async function gmailAccessToken(env){
  if(!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET||!env.GMAIL_REFRESH_TOKEN)
    throw new Error("Gmail notifications are not configured");
  const body=new URLSearchParams({
    client_id:env.GMAIL_CLIENT_ID,
    client_secret:env.GMAIL_CLIENT_SECRET,
    refresh_token:env.GMAIL_REFRESH_TOKEN,
    grant_type:"refresh_token"
  });
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const data=await response.json();
  if(!response.ok||!data.access_token) throw new Error("Unable to refresh Gmail access token");
  return data.access_token;
}
function base64Url(value){
  const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
  let binary="";
  for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function sendGmailNotification(env,{to,subject,text}){
  const token=await gmailAccessToken(env);
  const raw=["From: Alan Fleury <alanfleury1@gmail.com>","To: "+to,"Subject: "+subject,"Content-Type: text/plain; charset=UTF-8","MIME-Version: 1.0","",text].join("\r\n");
  const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({raw:base64Url(raw)})});
  if(!response.ok) throw new Error("Gmail send failed: "+(await response.text()).slice(0,500));
}
async function gmailOAuthState(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gmail_oauth_states(state TEXT PRIMARY KEY, created_at TEXT NOT NULL)`).run();
}

async function ensureAccessRequestsTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS access_requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auth_sub TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by TEXT
  )`).run();
}

async function verifiedProfile(token){
  const response=await fetch(`https://${AUTH0_DOMAIN}/userinfo`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok) throw new Error("Unable to verify the signed-in account");
  const profile=await response.json();
  const email=String(profile?.email||"").trim().toLowerCase();
  if(!email||profile?.email_verified!==true) throw new Error("A verified email address is required");
  return {profile,email,sub:String(profile?.sub||"")};
}

async function archivePage(env,table,offset,limit){
  const safeOffset=Math.max(0,Number.isFinite(offset)?Math.floor(offset):0);
  const safeLimit=Math.min(5000,Math.max(1,Number.isFinite(limit)?Math.floor(limit):5000));

  if(table==="people"){
    const result=await env.DB.prepare(
      "SELECT * FROM people LIMIT ? OFFSET ?"
    ).bind(safeLimit,safeOffset).all();
    return {people:result.results.map(mapPerson),offset:safeOffset,limit:safeLimit};
  }

  if(table==="relationships"){
    const result=await env.DB.prepare(
      "SELECT type, person1, person2 FROM relationships ORDER BY rowid LIMIT ? OFFSET ?"
    ).bind(safeLimit,safeOffset).all();
    return {relationships:result.results,offset:safeOffset,limit:safeLimit};
  }

  if(table==="meta"){
    const result=await env.DB.prepare(
      "SELECT key,value FROM meta ORDER BY key LIMIT ? OFFSET ?"
    ).bind(safeLimit,safeOffset).all();
    return {
      meta:Object.fromEntries(result.results.map(x=>[x.key,x.value])),
      offset:safeOffset,limit:safeLimit
    };
  }

  throw new Error("Invalid archive table");
}

async function archive(env){
  const people=await env.DB.prepare(
    "SELECT * FROM people"
  ).all();
  const relationships=await env.DB.prepare(
    "SELECT type, person1, person2 FROM relationships"
  ).all();
  const meta=await env.DB.prepare(
    "SELECT key,value FROM meta"
  ).all();

  return {
    people:people.results.map(mapPerson),
    relationships:relationships.results,
    meta:Object.fromEntries(meta.results.map(x=>[x.key,x.value]))
  };
}

export default {
  async fetch(request,env){
    const origin=request.headers.get("Origin")||"";
    const withCors=(response)=>{
      const headers=new Headers(response.headers);
      for(const [key,value] of Object.entries(cors(env,origin))) headers.set(key,value);
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    };

    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors(env,origin)});

    try{
      const url=new URL(request.url);

      if(url.pathname==="/health")
        return withCors(json({ok:true,version:"full-10x-2026-10-08"},200,env,origin));


      // Access requests are deliberately handled before archive authorization.
      // A signed-in but unapproved person may request access without receiving any family data.
      if(url.pathname==="/api/access-request" && request.method==="POST"){
        const h=request.headers.get("Authorization")||"";
        if(!h.startsWith("Bearer ")) return json({error:"Sign in before requesting access"},401,env,origin);
        const token=h.slice(7);
        const payload=await verifyJwt(token,env);
        const identity=await verifiedProfile(token);
        if(payload.sub && identity.sub && payload.sub!==identity.sub)
          return json({error:"Authenticated identity mismatch"},401,env,origin);
        const x=await request.json();
        const name=String(x?.name||"").trim().slice(0,160);
        const email=identity.email;
        const reason=String(x?.reason||"").trim().slice(0,4000);
        if(!name) return json({error:"Name is required"},400,env,origin);
        await ensureAccessRequestsTable(env);
        const existing=await env.DB.prepare(
          "SELECT id,status FROM access_requests WHERE lower(email)=lower(?) AND status='pending' ORDER BY id DESC LIMIT 1"
        ).bind(email).first();
        if(existing) return json({ok:true,alreadyPending:true,id:existing.id,emailSent:false},200,env,origin);
        const createdAt=new Date().toISOString();
        const ins=await env.DB.prepare(
          "INSERT INTO access_requests(auth_sub,name,email,reason,status,created_at) VALUES(?,?,?,?, 'pending',?)"
        ).bind(identity.sub,name,email,reason,createdAt).run();
        const id=ins.meta?.last_row_id||null;
        let emailSent=false;
        const emailConfigured=Boolean(env.GMAIL_CLIENT_ID&&env.GMAIL_CLIENT_SECRET&&env.GMAIL_REFRESH_TOKEN);
        if(emailConfigured){
          try{
            const subject="Fleury Family Tree — Access Approval Request";
            const text=[
              "Hello Alan,","",
              "A new person has requested access to the Fleury Family Tree private archive.","",
              "Name: "+name,"Email: "+email,"Date/time: "+createdAt,"",
              "Reason for requesting access:",
              reason||"(No reason supplied)","",
              "Please review the request in the Admin section of the Fleury Family Tree and approve or reject the account as appropriate.","",
              "Fleury Family Tree — Private Archive"
            ].join("\n");
            await sendGmailNotification(env,{to:"alanfleury1@gmail.com",subject,text});
            emailSent=true;
          }catch(e){console.error("Access request Gmail notification failed:",e?.message||e)}
        }
        return json({ok:true,id,emailSent,emailConfigured},200,env,origin);
      }

      if(url.pathname==="/api/gmail/test" && request.method==="POST"){
        await auth(request,env);
        try{
          await sendGmailNotification(env,{to:"alanfleury1@gmail.com",subject:"Fleury Family Tree — Gmail test",text:"This is a test message confirming that Gmail API notifications are working for the Fleury Family Tree private archive.\n\nIf you received this message, Gmail access-request notifications are configured correctly."});
          return json({ok:true,emailSent:true},200,env,origin);
        }catch(e){
          console.error("Gmail test failed:",e?.message||e);
          return json({ok:false,emailSent:false,error:String(e?.message||e).slice(0,800)},502,env,origin);
        }
      }

      if(url.pathname==="/api/gmail/start" && request.method==="GET"){
        const u=await auth(request,env);
        if(u.role!=="admin") return json({error:"Admin access required"},403,env,origin);
        if(!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET)
          return json({error:"Gmail OAuth client is not configured on the Worker"},500,env,origin);
        await gmailOAuthState(env);
        const bytes=new Uint8Array(24); crypto.getRandomValues(bytes);
        const state=base64Url(bytes);
        await env.DB.prepare("INSERT INTO gmail_oauth_states(state,created_at) VALUES(?,?)").bind(state,new Date().toISOString()).run();
        const params=new URLSearchParams({
          client_id:env.GMAIL_CLIENT_ID,
          redirect_uri:"https://fleury-family-api.alanfleury1.workers.dev/api/gmail/callback",
          response_type:"code",access_type:"offline",prompt:"consent",
          scope:"https://www.googleapis.com/auth/gmail.send",state
        });
        return json({url:"https://accounts.google.com/o/oauth2/v2/auth?"+params.toString()},200,env,origin);
      }

      if(url.pathname==="/api/gmail/callback" && request.method==="GET"){
        const code=url.searchParams.get("code")||"",state=url.searchParams.get("state")||"",error=url.searchParams.get("error")||"";
        if(error) return new Response("Google authorization was cancelled or denied.",{status:400,headers:{"Content-Type":"text/plain; charset=UTF-8"}});
        if(!code||!state) return new Response("Missing Google OAuth code/state.",{status:400});
        await gmailOAuthState(env);
        const row=await env.DB.prepare("SELECT state,created_at FROM gmail_oauth_states WHERE state=?").bind(state).first();
        if(!row) return new Response("Invalid or already used OAuth state.",{status:400});
        if(Date.now()-Date.parse(row.created_at)>10*60*1000){await env.DB.prepare("DELETE FROM gmail_oauth_states WHERE state=?").bind(state).run();return new Response("OAuth state expired. Start again.",{status:400});}
        await env.DB.prepare("DELETE FROM gmail_oauth_states WHERE state=?").bind(state).run();
        const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:"https://fleury-family-api.alanfleury1.workers.dev/api/gmail/callback"})});
        const tokenData=await tokenResponse.json();
        if(!tokenResponse.ok||!tokenData.refresh_token) return new Response("Google authorization succeeded but no refresh token was returned. Start again with consent.",{status:500});
        return new Response("Gmail authorization complete. Copy the refresh token below into the Worker secret GMAIL_REFRESH_TOKEN, then close this page. Do not send the token to anyone.\n\n"+tokenData.refresh_token,{status:200,headers:{"Content-Type":"text/plain; charset=UTF-8","Cache-Control":"no-store"}});
      }

      const u=await auth(request,env);

      if(url.pathname==="/api/me" && request.method==="GET")
        return json({role:u.role,email:u.email,personId:u.personId||null},200,env);

      if(url.pathname==="/api/archive/page" && request.method==="GET"){
        const table=url.searchParams.get("table")||"people";
        const offset=Number(url.searchParams.get("offset")||"0");
        const limit=Number(url.searchParams.get("limit")||"5000");
        return json(await archivePage(env,table,offset,limit),200,env);
      }


      if(url.pathname==="/api/access-requests" && request.method==="GET"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env,origin);
        await ensureAccessRequestsTable(env);
        const result=await env.DB.prepare(
          "SELECT id,name,email,reason,status,created_at,reviewed_at,reviewed_by FROM access_requests ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, id DESC LIMIT 200"
        ).all();
        return json({requests:result.results},200,env,origin);
      }

      if(url.pathname==="/api/access-requests" && request.method==="PUT"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env,origin);
        await ensureAccessRequestsTable(env);
        const x=await request.json();
        const id=Number(x?.id);
        const decision=String(x?.decision||"").toLowerCase();
        if(!Number.isInteger(id)||!["approve","reject"].includes(decision))
          return json({error:"Invalid access request decision"},400,env,origin);
        const req=await env.DB.prepare(
          "SELECT id,auth_sub,name,email,status FROM access_requests WHERE id=?"
        ).bind(id).first();
        if(!req) return json({error:"Access request not found"},404,env,origin);
        if(req.status!=="pending") return json({ok:true,status:req.status},200,env,origin);
        const now=new Date().toISOString();
        if(decision==="approve"){
          if(!req.auth_sub) return json({error:"This request has no verified sign-in identity; ask the applicant to sign in again and resubmit."},400,env,origin);
          const existing=await env.DB.prepare(
            "SELECT auth_sub FROM users WHERE lower(email)=lower(?)"
          ).bind(req.email).first();
          if(existing){
            await env.DB.prepare(
              "UPDATE users SET auth_sub=?, role=CASE WHEN role='admin' THEN role ELSE 'viewer' END WHERE lower(email)=lower(?)"
            ).bind(req.auth_sub,req.email).run();
          }else{
            await env.DB.prepare(
              "INSERT INTO users(auth_sub,email,role) VALUES(?,?,?)"
            ).bind(req.auth_sub,req.email,"viewer").run();
          }
        }
        await env.DB.prepare(
          "UPDATE access_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?"
        ).bind(decision==="approve"?"approved":"rejected",now,u.email||u.sub,id).run();
        return json({ok:true,id,status:decision==="approve"?"approved":"rejected"},200,env,origin);
      }

      if(url.pathname==="/api/users" && request.method==="GET"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        const result=await env.DB.prepare(
          "SELECT email, role, person_id AS personId FROM users ORDER BY email COLLATE NOCASE"
        ).all();
        return json({users:result.results},200,env);
      }

      if(url.pathname==="/api/users" && request.method==="PUT"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        const x=await request.json();
        const email=String(x?.email||"").trim();
        const role=String(x?.role||"").trim().toLowerCase();
        const personId=x?.personId==null||x.personId===""?null:String(x.personId);
        if(!email) return json({error:"Email is required"},400,env);
        if(!["admin","editor","viewer"].includes(role))
          return json({error:"Role must be admin, editor, or viewer"},400,env);
        const result=await env.DB.prepare(
          "UPDATE users SET role=?, person_id=? WHERE lower(email)=lower(?)"
        ).bind(role,personId,email).run();
        if(!result.meta?.changes) return json({error:"No approved user matched that email"},404,env);
        return json({ok:true,email,role,personId},200,env);
      }

      if(url.pathname==="/api/mapping" && request.method==="PUT"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        const x=await request.json();
        const email=String(x?.email||"").trim();
        const personId=x?.personId==null||x.personId===""?null:String(x.personId);
        if(!email) return json({error:"Email is required"},400,env);
        const result=await env.DB.prepare(
          "UPDATE users SET person_id=? WHERE lower(email)=lower(?)"
        ).bind(personId,email).run();
        if(!result.meta?.changes) return json({error:"No approved user matched that email"},404,env);
        return json({ok:true,email,personId},200,env);
      }

      if(url.pathname==="/api/person" && request.method==="PUT"){
        if(!["admin","editor"].includes(u.role))
          return json({error:"Editor or admin access required"},403,env);

        const x=await request.json();
        const p=x?.person;
        const family=Array.isArray(x?.relationships)?x.relationships:[];
        const id=String(p?.["Person ID"]||p?.person_id||p?.id||"");

        if(!id) return json({error:"Person ID is required"},400,env);

        const familyTypes=new Set(["parent","mother","father","child","son","daughter"]);
        const cleanFamily=family.map(r=>({
          type:String(r?.type||""),
          person1:String(r?.person1??r?.fromId??r?.from??r?.Person1??""),
          person2:String(r?.person2??r?.toId??r?.to??r?.Person2??"")
        })).filter(r=>
          familyTypes.has(r.type.toLowerCase()) &&
          r.person1 && r.person2 && r.person1!==r.person2
        );

        try{
          const writes=[
            env.DB.prepare(`INSERT INTO people(
              person_id,name,gender,birth,death,relationship_to_alan,
              evidence_status,source_ids,notes,places,json_extra
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(person_id) DO UPDATE SET
              name=excluded.name,
              gender=excluded.gender,
              birth=excluded.birth,
              death=excluded.death,
              relationship_to_alan=excluded.relationship_to_alan,
              evidence_status=excluded.evidence_status,
              source_ids=excluded.source_ids,
              notes=excluded.notes,
              places=excluded.places,
              json_extra=excluded.json_extra`).bind(
                id,p.Name||"",p.Gender||"",p.Birth||"",p.Death||"",
                p["Relationship to Alan"]||"",p["Evidence Status"]||"",
                p["Source IDs"]||"",p.Notes||"",p.Places||"",
                JSON.stringify(p)
              ),
            env.DB.prepare(`DELETE FROM relationships
              WHERE (person1=? OR person2=?)
              AND lower(type) IN ('parent','mother','father','child','son','daughter')`
            ).bind(id,id)
          ];

          for(const r of cleanFamily){
            writes.push(env.DB.prepare(
              "INSERT OR IGNORE INTO relationships(type,person1,person2) VALUES(?,?,?)"
            ).bind(r.type,r.person1,r.person2));
          }

          await env.DB.batch(writes);
          return json({ok:true,personId:id,relationships:cleanFamily.length},200,env);
        }catch(e){
          console.error("Person save failed:",e);
          return json({error:"Person save failed",detail:String(e?.message||e)},500,env);
        }
      }

      if(url.pathname==="/api/person" && request.method==="DELETE"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);

        const x=await request.json();
        const id=String(x?.personId||"");
        if(!id) return json({error:"Person ID is required"},400,env);

        try{
          await env.DB.batch([
            env.DB.prepare("DELETE FROM relationships WHERE person1=? OR person2=?").bind(id,id),
            env.DB.prepare("DELETE FROM people WHERE person_id=?").bind(id)
          ]);
          return json({ok:true,personId:id},200,env);
        }catch(e){
          console.error("Person delete failed:",e);
          return json({error:"Person delete failed",detail:String(e?.message||e)},500,env);
        }
      }

      if(url.pathname==="/api/archive/import/start" && request.method==="POST"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM relationships"),
          env.DB.prepare("DELETE FROM people"),
          env.DB.prepare("DELETE FROM meta")
        ]);
        return json({ok:true,started:true},200,env);
      }

      if(url.pathname==="/api/archive/import/batch" && request.method==="POST"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        const x=await request.json();
        const kind=String(x?.kind||"");
        const rows=Array.isArray(x?.rows)?x.rows:[];
        if(!["people","relationships","meta"].includes(kind) || !rows.length)
          return json({error:"Invalid import batch"},400,env);

        try{
          const batch=[];
          if(kind==="people"){
            for(const p of rows){
              const id=String(p?.person_id||"");
              if(!id) continue;
              batch.push(env.DB.prepare(`INSERT INTO people(
                person_id,name,gender,birth,death,relationship_to_alan,
                evidence_status,source_ids,notes,places,json_extra
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(person_id) DO UPDATE SET
                name=excluded.name,gender=excluded.gender,birth=excluded.birth,
                death=excluded.death,relationship_to_alan=excluded.relationship_to_alan,
                evidence_status=excluded.evidence_status,source_ids=excluded.source_ids,
                notes=excluded.notes,places=excluded.places,json_extra=excluded.json_extra`
              ).bind(
                id,String(p.name||""),String(p.gender||""),String(p.birth||""),
                String(p.death||""),String(p.relationship_to_alan||""),
                String(p.evidence_status||""),String(p.source_ids||""),
                String(p.notes||""),String(p.places||""),String(p.json_extra||"")
              ));
            }
          }else if(kind==="relationships"){
            for(const r of rows){
              if(!r?.type||!r?.person1||!r?.person2) continue;
              batch.push(env.DB.prepare(
                "INSERT INTO relationships(type,person1,person2) VALUES(?,?,?)"
              ).bind(String(r.type),String(r.person1),String(r.person2)));
            }
          }else{
            for(const m of rows){
              if(!m?.key) continue;
              batch.push(env.DB.prepare(
                "INSERT INTO meta(key,value) VALUES(?,?)"
              ).bind(String(m.key),String(m.value??"")));
            }
          }
          if(batch.length) await env.DB.batch(batch);
          return json({ok:true,kind,count:batch.length},200,env);
        }catch(e){
          console.error("Archive import batch failed:",e);
          return json({error:"Archive import batch failed",detail:String(e?.message||e)},500,env);
        }
      }

      if(url.pathname==="/api/archive/import/finish" && request.method==="POST"){
        if(u.role!=="admin") return json({error:"Admin access required"},403,env);
        const people=await env.DB.prepare("SELECT COUNT(*) AS count FROM people").first();
        const relationships=await env.DB.prepare("SELECT COUNT(*) AS count FROM relationships").first();
        const meta=await env.DB.prepare("SELECT COUNT(*) AS count FROM meta").first();
        return json({
          ok:Number(people?.count||0)===17972 && Number(relationships?.count||0)===30079,
          people:Number(people?.count||0),
          relationships:Number(relationships?.count||0),
          meta:Number(meta?.count||0)
        },200,env);
      }

      if(url.pathname==="/api/archive" && request.method==="GET")
        return json(await archive(env),200,env);

      if(url.pathname==="/api/archive" && request.method==="PUT"){
        if(!["admin","editor"].includes(u.role))
          return json({error:"Editor or admin access required"},403,env);

        const x=await request.json();
        if(!Array.isArray(x.people)||!Array.isArray(x.relationships))
          return json({error:"Invalid archive payload"},400,env);
        if(x.people.length===0)
          return json({error:"Refusing to save an empty archive"},400,env);

        try{
          await env.DB.batch([
            env.DB.prepare("DELETE FROM people"),
            env.DB.prepare("DELETE FROM relationships"),
            env.DB.prepare("DELETE FROM meta")
          ]);

          for(let i=0;i<x.people.length;i+=100){
            const batch=[];
            for(const p of x.people.slice(i,i+100)){
              const id=p["Person ID"];
              if(!id) continue;
              batch.push(env.DB.prepare(`INSERT INTO people(
                person_id,name,gender,birth,death,relationship_to_alan,
                evidence_status,source_ids,notes,places,json_extra
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
                id,p.Name||"",p.Gender||"",p.Birth||"",p.Death||"",
                p["Relationship to Alan"]||"",p["Evidence Status"]||"",
                p["Source IDs"]||"",p.Notes||"",p.Places||"",JSON.stringify(p)
              ));
            }
            if(batch.length) await env.DB.batch(batch);
          }

          for(let i=0;i<x.relationships.length;i+=100){
            const batch=[];
            for(const r of x.relationships.slice(i,i+100)){
              if(!r.type||!r.person1||!r.person2) continue;
              batch.push(env.DB.prepare(
                "INSERT INTO relationships(type,person1,person2) VALUES(?,?,?)"
              ).bind(r.type,r.person1,r.person2));
            }
            if(batch.length) await env.DB.batch(batch);
          }

          const metaBatch=[];
          for(const [k,v] of Object.entries(x.meta||{})){
            metaBatch.push(env.DB.prepare(
              "INSERT INTO meta(key,value) VALUES(?,?)"
            ).bind(k,JSON.stringify(v)));
          }
          if(metaBatch.length) await env.DB.batch(metaBatch);

          return json({ok:true,people:x.people.length,relationships:x.relationships.length},200,env);
        }catch(e){
          console.error("Archive save failed:",e);
          return json({error:"Archive save failed",detail:String(e?.message||e)},500,env);
        }
      }

      return withCors(json({error:"Not found"},404,env,origin));
    }catch(e){
      return withCors(json({error:e.message||"Unauthorized"},401,env,origin));
    }
  }
};
