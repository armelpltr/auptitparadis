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
  /* Sans ce contrôle, une réponse d'erreur de Google était mise en cache une
     heure durant, et toute vérification de jeton échouait pendant ce temps :
     plus personne n'entrait dans le panel. On préfère refaire l'appel à la
     requête suivante que garder une réponse inutilisable. */
  if (!res.ok) throw new Error(`Clés publiques Google indisponibles (${res.status})`);
  const jwks = await res.json();
  if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) {
    throw new Error('Clés publiques Google illisibles');
  }

  _jwksCache = jwks;
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

  /* `claims` porte la charge utile entière, attributs personnalisés compris.
     C'est là que vivent `a2fUntil` et `a2fAuthTime`, dont les routes ont
     besoin : ce Worker parle à Firestore avec la clé de service, laquelle
     contourne les règles — l'exigence de double authentification qu'elles
     posent ne le couvre donc pas, il doit la refaire lui-même. */
  return {
    localId: payload.sub,
    email: payload.email,
    authTime: payload.auth_time,
    claims: payload
  };
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

/**
 * Encode un chemin de document ou de collection avant de l'interpoler dans
 * une URL.
 *
 * Sans ça, un segment `..` venu d'une valeur d'appelant sortait du document
 * visé : le parseur d'URL normalise les points, et
 * `documents/invites/../admins/UID` désigne `documents/admins/UID`. Les
 * appelants n'ont pas tous une valeur de confiance à passer — un jeton
 * d'invitation vient du corps d'une requête publique.
 */
function cheminSur(path) {
  const segments = String(path ?? '').split('/');
  return segments.map(s => {
    if (!s || /^\.+$/.test(s)) throw new Error('Chemin Firestore invalide');
    return encodeURIComponent(s);
  }).join('/');
}

export async function firestoreGet(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${cheminSur(path)}`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  return res.json();
}

export async function firestoreDelete(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${cheminSur(path)}`), {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Firestore delete ${res.status}: ${await res.text()}`);
}

export async function firestoreList(collectionPath, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${cheminSur(collectionPath)}?pageSize=300`), {
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
  const res = await fetch(docsUrl(env, `/${cheminSur(collectionPath)}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  if (!res.ok) throw new Error(`Firestore create ${res.status}: ${await res.text()}`);
  const doc = await res.json();
  return doc.name.split('/').pop();
}

/**
 * Écrit le document en entier, en écrasant ce qui s'y trouvait. C'est
 * exactement le comportement d'un PATCH sans `updateMask` — ici il est
 * voulu : un défi OTP repart toujours de zéro, on ne veut pas qu'un
 * compteur d'essais d'un défi précédent survive.
 */
export async function firestoreSet(path, data, env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, `/${cheminSur(path)}`), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  if (!res.ok) throw new Error(`Firestore set ${res.status}: ${await res.text()}`);
}

/**
 * Incrémente un entier et renvoie sa nouvelle valeur, en une seule
 * opération côté serveur. Lire puis réécrire ne conviendrait pas : deux
 * requêtes simultanées liraient le même compteur et le plafond d'essais
 * ne bornerait plus rien face à une force brute parallèle.
 *
 * Le chemin passe par `cheminSur()` comme partout ailleurs. C'était la
 * seule fonction Firestore à l'interpoler brut : aucun appelant actuel ne
 * lui passe autre chose qu'un uid vérifié ou une constante, mais un
 * durcissement qui dépend de la vigilance du prochain appelant n'en est
 * pas un.
 *
 * Échoue si le document n'existe pas encore : un `transform` seul ne le
 * crée pas. Les appelants rattrapent ce cas en posant la valeur initiale.
 *
 * `pas` vaut 1 par défaut, et accepte un entier négatif : c'est ce qui
 * permet de réserver plusieurs places d'un coup, puis de les rendre si la
 * séance s'avère pleine. Une réservation qui ne peut pas être annulée
 * atomiquement laisserait des places fantômes.
 */
export async function firestoreIncrement(path, champ, env, pas = 1) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, ':commit'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${cheminSur(path)}`,
          fieldTransforms: [{ fieldPath: champ, increment: { integerValue: String(pas) } }]
        }
      }]
    })
  });
  if (!res.ok) throw new Error(`Firestore increment ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const v = data.writeResults?.[0]?.transformResults?.[0];
  return Number(v?.integerValue ?? 0);
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
  const res = await fetch(docsUrl(env, `/${cheminSur(path)}?${masque}`), {
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

/**
 * Documents dont un champ est strictement inférieur à une valeur. Sert à la
 * purge : retrouver ce qui a dépassé la durée de conservation.
 *
 * Un seul champ, donc aucun index composite à créer à la main — même raison
 * que pour la recherche par égalité juste au-dessus.
 */
export async function firestoreQueryBefore(collectionId, fieldPath, valeur, env, limit = 300) {
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
            op: 'LESS_THAN',
            value: toFirestoreValue(valeur)
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

/**
 * Pose des attributs personnalisés sur un compte. Ils atterrissent dans le
 * jeton d'identité du client à son prochain rafraîchissement, et les règles
 * Firestore peuvent les lire — c'est ce qui permettra, plus tard, d'exiger
 * côté serveur que la double authentification ait été franchie.
 *
 * `customAttributes` est une chaîne JSON, pas un objet : l'API l'exige
 * ainsi, et un objet passerait silencieusement à la trappe.
 */
export async function setCustomClaims(uid, claims, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) })
    }
  );
  if (!res.ok) throw new Error(`Attributs refusés (${res.status}): ${await res.text()}`);
}

/**
 * Crée un compte Firebase avec les droits d'administration, par l'API
 * `projects/.../accounts` et non par le `accounts:signUp` public.
 *
 * C'est toute la différence : `signUp` répond à qui présente la clé API,
 * donc à n'importe quel visiteur, et reste ouvert même quand on interdit
 * l'inscription publique dans la console. Cette route-ci exige la clé de
 * service, que seul ce Worker détient — l'inscription peut donc être fermée
 * partout ailleurs sans empêcher les invités d'entrer.
 *
 * Renvoie l'identifiant du compte créé, ou null si l'adresse est déjà prise :
 * l'appelant décide alors quoi en faire, selon qu'il attendait ou non un
 * compte préexistant.
 */
export async function createAuthUser({ email, password }, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, emailVerified: false }),
    }
  );

  const corps = await res.json().catch(() => ({}));
  if (res.ok) return corps.localId;
  if (corps?.error?.message === 'EMAIL_EXISTS') return null;
  throw new Error(`Création du compte refusée (${res.status}): ${corps?.error?.message || ''}`);
}

/** Retrouve un compte par son adresse. Null s'il n'existe pas. */
export async function findAuthUserByEmail(email, env) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    }
  );
  if (!res.ok) throw new Error(`Recherche du compte refusée (${res.status})`);
  const corps = await res.json().catch(() => ({}));
  return corps.users?.[0] || null;
}

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
