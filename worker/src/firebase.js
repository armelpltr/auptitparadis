// ============================================================
// FIREBASE — accès serveur au projet, via le compte de service
//
// Le SDK navigateur est limité au compte connecté et soumis aux règles
// Firestore. Ici on parle aux API REST avec la clé de service, qui passe
// outre les règles : tout ce qui vit dans ce fichier est de la confiance
// pure, et doit rester hors du JavaScript servi aux visiteurs.
// ============================================================

/* ---------- Compte de service → jeton d'accès ---------- */

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pemToBytes(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function makeServiceJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
  }));
  const sigInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBytes(sa.private_key).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${sigInput}.${sigB64}`;
}

let _accessToken = null, _accessTokenExpiry = 0;

export async function getAccessToken(env) {
  const now = Date.now() / 1000;
  if (_accessToken && _accessTokenExpiry > now + 120) return _accessToken;

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const jwt = await makeServiceJWT(sa);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Compte de service refusé : ' + JSON.stringify(data));

  _accessToken = data.access_token;
  _accessTokenExpiry = now + (data.expires_in || 3600);
  return _accessToken;
}

/* ---------- Vérification du jeton de l'appelant ---------- */

let _jwksCache = null, _jwksCacheAt = 0;

async function getGoogleJwks() {
  if (_jwksCache && Date.now() - _jwksCacheAt < 3600 * 1000) return _jwksCache;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  _jwksCache = await res.json();
  _jwksCacheAt = Date.now();
  return _jwksCache;
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '='));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function verifyIdToken(idToken, env) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Jeton malformé');

  const header  = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  const now = Math.floor(Date.now() / 1000);

  // L'algorithme est imposé, pas lu dans le jeton : sans ça on suivrait ce que
  // l'appelant déclare, et c'est ainsi qu'on se fait passer un « alg: none ».
  if (header.alg !== 'RS256') throw new Error('Algorithme non autorisé');
  if (payload.exp < now)       throw new Error('Jeton expiré');
  if (payload.iat > now + 300) throw new Error('Jeton émis dans le futur');
  if (payload.aud !== env.FIREBASE_PROJECT_ID) throw new Error('Audience invalide');
  if (payload.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) {
    throw new Error('Émetteur invalide');
  }
  if (!payload.sub)            throw new Error('Identifiant manquant');

  const jwks = await getGoogleJwks();
  const jwk  = jwks.keys?.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Clé publique introuvable');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), sigInput);
  if (!valid) throw new Error('Signature invalide');

  return { localId: payload.sub, email: payload.email };
}

/* ---------- Conversion entre JSON et le format de Firestore ---------- */
/* L'API REST ne prend pas du JSON ordinaire : chaque valeur est étiquetée
   par son type (`{ stringValue: … }`). Le SDK navigateur fait cette
   traduction tout seul, ici elle est à notre charge. */

export function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Nombre non représentable');
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  throw new Error('Type non convertible : ' + typeof v);
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

export function fromFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue'       in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

export function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

/* ---------- Firestore (REST) ---------- */

function docsUrl(env, path = '') {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}`;
}

export async function firestoreGet(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${path}`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  return res.json();
}

export async function firestoreDelete(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${path}`), {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Firestore delete ${res.status}: ${await res.text()}`);
}

export async function firestoreList(collectionPath, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${collectionPath}?pageSize=300`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Firestore list ${res.status}`);
  const data = await res.json();
  return (data.documents || []).map(d => ({
    id: d.name.split('/').pop(),
    ...fromFirestoreFields(d.fields)
  }));
}

/** Crée un document et renvoie son identifiant. */
export async function firestoreCreate(collectionPath, data, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${collectionPath}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  if (!res.ok) throw new Error(`Firestore create ${res.status}: ${await res.text()}`);
  const doc = await res.json();
  return doc.name.split('/').pop();
}

/**
 * Met à jour les seuls champs fournis. Sans `updateMask`, l'API REST
 * remplace le document entier : une commande mise à jour sur son statut
 * perdrait ses produits, son client et son total.
 */
export async function firestoreUpdate(path, data, env) {
  const token = await getAccessToken(env);
  const masque = Object.keys(data)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const res = await fetch(docsUrl(env, `/${path}?${masque}`), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  if (!res.ok) throw new Error(`Firestore update ${res.status}: ${await res.text()}`);
}

/**
 * Égalité sur un seul champ. Volontairement limité : dès qu'on croise deux
 * champs, Firestore réclame un index composite qu'il faut créer à la main
 * dans la console, et l'oubli ne se voit qu'en production.
 */
export async function firestoreQueryByField(collectionId, fieldPath, value, env, limit = 20) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, ':runQuery'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: toFirestoreValue(value)
          }
        },
        limit
      }
    })
  });
  if (!res.ok) throw new Error(`Firestore query ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => ({
      id: r.document.name.split('/').pop(),
      ...fromFirestoreFields(r.document.fields)
    }));
}

/* ---------- Identity Toolkit ---------- */

export async function deleteAuthUser(uid, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
    }
  );
  if (!res.ok) throw new Error(`Suppression du compte refusée (${res.status}): ${await res.text()}`);
}
