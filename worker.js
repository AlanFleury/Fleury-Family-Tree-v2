const AUTH0_DOMAIN = "dev-rd7gx3zdpkuccxmn.uk.auth0.com";
const AUTH0_AUDIENCE = "https://fleury-family-api";

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

async function archivePage(env,table,offset,limit){
  const safeOffset=Math.max(0,Number.isFinite(offset)?Math.floor(offset):0);
  const safeLimit=Math.min(5000,Math.max(1,Number.isFinite(limit)?Math.floor(limit):5000));

  if(table==="people"){
    const result=await env.DB.prepare(
      "SELECT * FROM people ORDER BY name COLLATE NOCASE, person_id LIMIT ? OFFSET ?"
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
    "SELECT * FROM people ORDER BY name COLLATE NOCASE, person_id"
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
        return withCors(json({ok:true,version:"cors-deploy-2026-10-08"},200,env,origin));

      const u=await auth(request,env);

      if(url.pathname==="/api/me" && request.method==="GET")
        return json({role:u.role,email:u.email,personId:u.personId||null},200,env);

      if(url.pathname==="/api/archive/page" && request.method==="GET"){
        const table=url.searchParams.get("table")||"people";
        const offset=Number(url.searchParams.get("offset")||"0");
        const limit=Number(url.searchParams.get("limit")||"5000");
        return json(await archivePage(env,table,offset,limit),200,env);
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
