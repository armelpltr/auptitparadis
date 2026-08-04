// ============================================================
// MEMBRE — un seul contrôle d'accès pour toutes les routes du panel
//
// Chaque route refaisait le sien : vérifier le jeton, relire `admins`, lire
// le rôle. Trois copies, trois occasions d'en oublier une pièce — et c'est
// exactement ce qui s'était produit avec la double authentification, exigée
// nulle part côté serveur.
//
// Le point à ne pas perdre de vue : ce Worker parle à Firestore avec la clé
// de service, qui **contourne les règles**. L'exigence de 2FA posée dans
// `firestore.rules` ne le protège donc pas. Sans le contrôle ci-dessous,
// `/delete-user` supprimait des comptes et `/jourj/code` changeait le code
// de sortie avec le mot de passe seul, la 2FA restant à la porte d'à côté.
// ============================================================

import { httpError } from './http.js';
import { verifyIdToken, firestoreGet, fromFirestoreFields } from './firebase.js';

const ROLES_GESTION = ['superadmin', 'admin'];

/**
 * Vrai si le porteur du jeton a franchi la double authentification depuis
 * CE poste. Même condition que `a2fFranchie()` dans les règles Firestore,
 * et il faut que les deux restent identiques :
 *
 *   - `a2fUntil`, la validité, en millisecondes ;
 *   - `a2fAuthTime` égal à `auth_time`, qui distingue ce poste du compte en
 *     général — un attribut personnalisé vaut pour tout jeton émis pour ce
 *     compte, où qu'il se connecte, alors que `auth_time` change à chaque
 *     vraie connexion.
 */
export function a2fFranchie(claims) {
  const jusqua = Number(claims?.a2fUntil ?? 0);
  const posePour = claims?.a2fAuthTime;
  return Number.isFinite(jusqua)
      && jusqua > Date.now()
      && posePour !== undefined
      && posePour === claims?.auth_time;
}

/**
 * Vérifie le jeton, l'appartenance au panel, la double authentification et,
 * si `gestion` est demandé, le rôle.
 *
 * `exigerA2F` n'est mis à faux que par les routes de la double
 * authentification elle-même : on ne peut pas exiger d'avoir franchi une
 * porte pour ouvrir cette porte.
 */
export async function membreOuRefus(idToken, env, { exigerA2F = true, gestion = false } = {}) {
  let user;
  try {
    user = await verifyIdToken(idToken, env);
  } catch {
    throw httpError('Session invalide. Reconnectez-vous.', 401);
  }

  let membre;
  try {
    const doc = await firestoreGet(`admins/${user.localId}`, env);
    membre = fromFirestoreFields(doc.fields);
  } catch {
    throw httpError("Ce compte n'a pas accès à l'administration.", 403);
  }

  if (exigerA2F && !a2fFranchie(user.claims)) {
    throw httpError('Double authentification requise. Reconnectez-vous.', 401);
  }

  // Même défaut que les règles : le tout premier compte a été créé à la main
  // dans la console, avant que les rôles n'existent.
  const role = membre.role || 'admin';
  if (gestion && !ROLES_GESTION.includes(role)) {
    throw httpError('Action réservée aux administrateurs.', 403);
  }

  /* L'adresse du compte Firebase d'abord, celle du document `admins`
     seulement en secours. C'est celle avec laquelle on vient de
     s'authentifier : elle est forcément juste, sinon la connexion aurait
     échoué. Le champ de `admins` n'est qu'une copie faite à la création de
     l'accès, et une copie diverge — ici elle portait une faute de frappe, et
     les codes partaient depuis le début vers une boîte inexistante. */
  return {
    uid: user.localId,
    email: user.email || membre.email || '',
    prenom: membre.prenom || '',
    role,
    authTime: user.authTime
  };
}
