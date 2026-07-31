// ============================================================
// auptitparadis-worker — suppression de comptes administrateurs
//
// Le SDK Firebase du navigateur ne sait supprimer que le compte connecté.
// Retirer quelqu'un d'autre demande les droits admin, donc une clé de service,
// qui ne peut pas vivre dans du JavaScript servi aux visiteurs. Ce Worker est
// le seul endroit où elle est à l'abri.
//
// POST /delete-user   { uid }   + en-tête Authorization: Bearer <idToken>
//   1. vérifie le jeton de l'appelant (signature Google, pas juste son contenu)
//   2. vérifie qu'il est bien administrateur dans Firestore
//   3. refuse de supprimer le dernier administrateur, et l'auto-suppression
//   4. supprime le document admins/<uid> puis le compte Firebase
// ============================================================

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (new URL(request.url).pathname !== '/delete-user') {
      return json({ error: 'Not found' }, 404, cors);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée' }, 405, cors);
    }

    try {
      const caller = await requireAdmin(request, env);
      const { uid } = await request.json();

      if (!uid) return json({ error: 'uid manquant' }, 400, cors);
      if (uid === caller.localId) {
        return json({ error: 'Vous ne pouvez pas supprimer votre propre compte ici.' }, 400, cors);
      }

      // Garde-fou serveur, en plus de celui du panel : le client peut mentir.
      const admins = await listAdmins(env);
      const target = admins.find(a => a.uid === uid);
      if (!target) return json({ error: "Ce compte n'a pas accès à l'administration." }, 404, cors);

      const owners = admins.filter(a => a.role === 'admin');
      if (target.role === 'admin' && owners.length <= 1) {
        return json({ error: 'Impossible de supprimer le dernier administrateur.' }, 400, cors);
      }

      // L'accès d'abord : si la suppression du compte échoue ensuite, la
      // personne est déjà sans pouvoir. L'inverse laisserait un accès actif.
      await firestoreDelete(`admins/${uid}`, env);
      await deleteAuthUser(uid, env);

      return json({ ok: true }, 200, cors);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.message || 'Erreur serveur' }, status, cors);
    }
  },
};

/* ---------- HTTP ---------- */

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- Autorisation ---------- */

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!idToken) throw httpError('Jeton manquant', 401);

  let caller;
  try {
    caller = await verifyIdToken(idToken, env);
  } catch (err) {
    throw httpError('Jeton invalide : ' + err.message, 401);
  }

  const doc = await firestoreGet(`admins/${caller.localId}`, env).catch(() => null);
  if (!doc) throw httpError("Vous n'avez pas accès à l'administration.", 403);

  // Rôle absent = administrateur : le tout premier compte a été créé à la main
  // dans la console, avant que les rôles n'existent. Même défaut que les règles.
  const role = doc.fields?.role?.stringValue ?? 'admin';
  if (role !== 'admin') throw httpError('Seul un administrateur peut supprimer un compte.', 403);

  return caller;
}

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

async function getAccessToken(env) {
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

async function verifyIdToken(idToken, env) {
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

/* ---------- Firestore & Identity Toolkit (REST) ---------- */

async function firestoreGet(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  return res.json();
}

async function firestoreDelete(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Firestore delete ${res.status}: ${await res.text()}`);
}

async function listAdmins(env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/admins`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Firestore list ${res.status}`);
  const data = await res.json();
  return (data.documents || []).map(d => ({
    uid: d.name.split('/').pop(),
    email: d.fields?.email?.stringValue ?? '',
    role: d.fields?.role?.stringValue ?? 'admin',
  }));
}

async function deleteAuthUser(uid, env) {
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
