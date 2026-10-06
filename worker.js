function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS"
  };
}

function json(data, status = 200, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors(env),
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function base64urlToUint8Array(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function decodeJwtPart(value) {
  return JSON.parse(
    new TextDecoder().decode(base64urlToUint8Array(value))
  );
}

async function verifyJwt(token, env) {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid access token");
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);

  if (header.alg !== "RS256") {
    throw new Error("Unsupported token algorithm");
  }

  const issuer = `https://${env.AUTH0_DOMAIN}/`;

  if (payload.iss !== issuer) {
    throw new Error("Invalid token issuer");
  }

  const audience = payload.aud;
  const validAudience =
    Array.isArray(audience)
      ? audience.includes(env.AUTH0_AUDIENCE)
      : audience === env.AUTH0_AUDIENCE;

  if (!validAudience) {
    throw new Error("Invalid token audience");
  }

  if (payload.exp && Date.now() / 1000 >= payload.exp) {
    throw new Error("Access token expired");
  }

  const jwksResponse = await fetch(
    `${issuer}.well-known/jwks.json`
  );

  if (!jwksResponse.ok) {
    throw new Error("Unable to load Auth0 signing keys");
  }

  const jwks = await jwksResponse.json();

  const jwk = jwks.keys.find(
    key => key.kid === header.kid
  );

  if (!jwk) {
    throw new Error("Signing key not found");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(
    `${parts[0]}.${parts[1]}`
  );

  const signature = base64urlToUint8Array(parts[2]);

  const valid = await crypto.subtle.verify(
    {
      name: "RSASSA-PKCS1-v1_5"
    },
    cryptoKey,
    signature,
    data
  );

  if (!valid) {
    throw new Error("Invalid access token signature");
  }

  return payload;
}

async function auth(request, env) {
  const h = request.headers.get("Authorization") || "";

  if (!h.startsWith("Bearer ")) {
    throw new Error("Missing access token");
  }

  const token = h.slice(7);

  const payload = await verifyJwt(token, env);

  const sub = String(payload.sub || "");

  if (!sub) {
    throw new Error("Invalid subject");
  }

  const row = await env.DB
    .prepare(
      "SELECT role, person_id AS personId, email FROM users WHERE auth_sub=?"
    )
    .bind(sub)
    .first();

  if (!row) {
    throw new Error(
      "Account is not approved for the family archive"
    );
  }

  return {
    ...row,
    sub
  };
}

async function archive(env) {
  const people = await env.DB
    .prepare(
      "SELECT * FROM people ORDER BY name COLLATE NOCASE"
    )
    .all();

  const relationships = await env.DB
    .prepare(
      "SELECT type, person1, person2 FROM relationships"
    )
    .all();

  const meta = await env.DB
    .prepare(
      "SELECT key,value FROM meta"
    )
    .all();

  return {
    people: people.results.map(r => {
      const x = { ...r };

      delete x.name;

      x["Person ID"] = x.person_id;

      delete x.person_id;

      x.Name = r.name;

      return x;
    }),

    relationships: relationships.results,

    meta: Object.fromEntries(
      meta.results.map(x => [x.key, x.value])
    )
  };
}

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: cors(env)
      });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json(
          { ok: true },
          200,
          env
        );
      }

      const u = await auth(request, env);

      if (
        url.pathname === "/api/me" &&
        request.method === "GET"
      ) {
        return json(
          {
            role: u.role,
            email: u.email,
            personId: u.personId || null
          },
          200,
          env
        );
      }

      if (
        url.pathname === "/api/archive" &&
        request.method === "GET"
      ) {
        return json(
          await archive(env),
          200,
          env
        );
      }

      if (
        url.pathname === "/api/archive" &&
        request.method === "PUT"
      ) {

        if (!["admin", "editor"].includes(u.role)) {
          return json(
            {
              error:
                "Editor or admin access required"
            },
            403,
            env
          );
        }

        const x = await request.json();

        if (
          !Array.isArray(x.people) ||
          !Array.isArray(x.relationships)
        ) {
          return json(
            {
              error:
                "Invalid archive payload"
            },
            400,
            env
          );
        }

        if (x.people.length === 0) {
          return json(
            {
              error:
                "Refusing to save an empty archive"
            },
            400,
            env
          );
        }

        try {

          await env.DB.batch([
            env.DB.prepare(
              "DELETE FROM people"
            ),
            env.DB.prepare(
              "DELETE FROM relationships"
            ),
            env.DB.prepare(
              "DELETE FROM meta"
            )
          ]);

          const PEOPLE_BATCH_SIZE = 100;

          for (
            let i = 0;
            i < x.people.length;
            i += PEOPLE_BATCH_SIZE
          ) {

            const batch = [];

            for (
              const p of x.people.slice(
                i,
                i + PEOPLE_BATCH_SIZE
              )
            ) {

              const id = p["Person ID"];

              if (!id) continue;

              batch.push(
                env.DB.prepare(`
                  INSERT INTO people(
                    person_id,
                    name,
                    gender,
                    birth,
                    death,
                    relationship_to_alan,
                    evidence_status,
                    source_ids,
                    notes,
                    places,
                    json_extra
                  )
                  VALUES(
                    ?,?,?,?,?,?,?,?,?,?,?
                  )
                `).bind(
                  id,
                  p.Name || "",
                  p.Gender || "",
                  p.Birth || "",
                  p.Death || "",
                  p["Relationship to Alan"] || "",
                  p["Evidence Status"] || "",
                  p["Source IDs"] || "",
                  p.Notes || "",
                  p.Places || "",
                  JSON.stringify(p)
                )
              );
            }

            if (batch.length) {
              await env.DB.batch(batch);
            }
          }

          const REL_BATCH_SIZE = 100;

          for (
            let i = 0;
            i < x.relationships.length;
            i += REL_BATCH_SIZE
          ) {

            const batch = [];

            for (
              const r of x.relationships.slice(
                i,
                i + REL_BATCH_SIZE
              )
            ) {

              if (
                !r.type ||
                !r.person1 ||
                !r.person2
              ) {
                continue;
              }

              batch.push(
                env.DB.prepare(`
                  INSERT INTO relationships(
                    type,
                    person1,
                    person2
                  )
                  VALUES(?,?,?)
                `).bind(
                  r.type,
                  r.person1,
                  r.person2
                )
              );
            }

            if (batch.length) {
              await env.DB.batch(batch);
            }
          }

          const metaBatch = [];

          for (
            const [k, v]
            of Object.entries(x.meta || {})
          ) {

            metaBatch.push(
              env.DB.prepare(
                "INSERT INTO meta(key,value) VALUES(?,?)"
              ).bind(
                k,
                JSON.stringify(v)
              )
            );
          }

          if (metaBatch.length) {
            await env.DB.batch(metaBatch);
          }

          return json(
            {
              ok: true,
              people: x.people.length,
              relationships:
                x.relationships.length
            },
            200,
            env
          );

        } catch (e) {

          console.error(
            "Archive save failed:",
            e
          );

          return json(
            {
              error: "Archive save failed",
              detail:
                String(
                  e?.message || e
                )
            },
            500,
            env
          );
        }
      }

      return json(
        { error: "Not found" },
        404,
        env
      );

    } catch (e) {

      return json(
        {
          error:
            e.message ||
            "Unauthorized"
        },
        401,
        env
      );
    }
  }
};
