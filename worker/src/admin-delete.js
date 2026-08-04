// ============================================================
// POST /delete-user — suppression d'un compte administrateur
//
// Le SDK Firebase du navigateur ne sait supprimer que le compte connecté.
// Retirer quelqu'un d'autre demande les droits admin, donc la clé de service.
//
//   1. vérifie le jeton de l'appelant, son appartenance au panel, sa double
//      authentification et son rôle — tout cela dans `membre.js`
//   2. refuse de supprimer le dernier administrateur, et l'auto-suppression
//   3. supprime le document admins/<uid> puis le compte Firebase
// ============================================================

import { json, httpError } from './http.js';
import { membreOuRefus } from './membre.js';
import { firestoreDelete, firestoreList, deleteAuthUser } from './firebase.js';

export async function handleDeleteUser(request, env, cors) {
  /* Ici le jeton voyage dans l'en-tête et non dans le corps, contrairement
     aux autres routes du panel. Le contrôle lui-même est commun : membre,
     double authentification franchie, et rôle de gestion. Sans l'exigence
     de 2FA, cette route supprimait des comptes avec le mot de passe seul —
     la clé de service contourne les règles Firestore qui l'imposent. */
  const entete = request.headers.get('Authorization') || '';
  const idToken = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!idToken) throw httpError('Jeton manquant', 401);

  const caller = await membreOuRefus(idToken, env, { gestion: true });
  const { uid } = await request.json();

  if (!uid) return json({ error: 'uid manquant' }, 400, cors);
  if (uid === caller.uid) {
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
