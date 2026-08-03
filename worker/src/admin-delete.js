// ============================================================
// POST /delete-user — suppression d'un compte administrateur
//
// Le SDK Firebase du navigateur ne sait supprimer que le compte connecté.
// Retirer quelqu'un d'autre demande les droits admin, donc la clé de service.
//
//   1. vérifie le jeton de l'appelant (signature Google, pas juste son contenu)
//   2. vérifie qu'il est bien administrateur dans Firestore
//   3. refuse de supprimer le dernier administrateur, et l'auto-suppression
//   4. supprime le document admins/<uid> puis le compte Firebase
// ============================================================

import { json, httpError } from './http.js';
import {
  verifyIdToken, firestoreGet, firestoreDelete, firestoreList, deleteAuthUser
} from './firebase.js';

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
  if (!['superadmin', 'admin'].includes(role)) {
    throw httpError('Seul un administrateur peut supprimer un compte.', 403);
  }

  return { ...caller, role };
}

export async function handleDeleteUser(request, env, cors) {
  const caller = await requireAdmin(request, env);
  const { uid } = await request.json();

  if (!uid) return json({ error: 'uid manquant' }, 400, cors);
  if (uid === caller.localId) {
    return json({ error: 'Vous ne pouvez pas supprimer votre propre compte ici.' }, 400, cors);
  }

  // Garde-fou serveur, en plus de celui du panel : le client peut mentir.
  const admins = (await firestoreList('admins', env))
    .map(a => ({ uid: a.id, email: a.email ?? '', role: a.role ?? 'admin' }));
  const target = admins.find(a => a.uid === uid);
  if (!target) return json({ error: "Ce compte n'a pas accès à l'administration." }, 404, cors);

  // Un superadmin ne se supprime que par un superadmin. Même verrou que dans
  // les règles Firestore : un administrateur ne doit pas pouvoir effacer le
  // compte qui pourrait corriger ses erreurs.
  if (target.role === 'superadmin' && caller.role !== 'superadmin') {
    return json({ error: 'Seul un super-administrateur peut supprimer un super-administrateur.' }, 403, cors);
  }

  const owners = admins.filter(a => ['superadmin', 'admin'].includes(a.role));
  if (owners.length <= 1 && owners.some(a => a.uid === uid)) {
    return json({ error: 'Impossible de supprimer le dernier administrateur.' }, 400, cors);
  }

  // L'accès d'abord : si la suppression du compte échoue ensuite, la
  // personne est déjà sans pouvoir. L'inverse laisserait un accès actif.
  await firestoreDelete(`admins/${uid}`, env);
  await deleteAuthUser(uid, env);

  return json({ ok: true }, 200, cors);
}
