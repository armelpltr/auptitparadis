// ============================================================
// POST /invite/accept — création d'un accès depuis une invitation
//
// Le navigateur créait lui-même le compte, par createUserWithEmailAndPassword.
// Cela obligeait à laisser l'inscription ouverte à tous : n'importe quel
// visiteur pouvait se fabriquer un compte Firebase sur le projet. Il n'ouvrait
// aucune donnée — les règles exigent de figurer dans `admins` — mais il
// gonflait la liste des comptes et vidait de sa substance le `request.auth
// != null` sur lequel reposaient les règles des invitations.
//
// La création passe donc par ici, avec la clé de service, ce qui permet de
// fermer l'inscription publique dans la console sans bloquer les invités :
//
//   1. relit l'invitation dans Firestore, jeton et expiration compris
//   2. crée le compte Firebase avec les droits d'administration
//   3. écrit l'entrée `admins` avec le rôle porté par l'invitation
//   4. supprime l'invitation pour que le lien ne resserve pas
//
// Le mot de passe traverse ce Worker sans y être ni stocké ni journalisé :
// il part directement à Firebase, comme dans n'importe quel service qui
// gère lui-même l'inscription de ses utilisateurs.
// ============================================================

import { json, httpError } from './http.js';
import {
  firestoreGet, firestoreSet, firestoreDelete,
  createAuthUser, findAuthUserByEmail, deleteAuthUser
} from './firebase.js';

const ROLES = ['superadmin', 'admin', 'editor'];

function texte(v, { min = 0, max, champ }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw httpError(`${champ} est trop court.`, 400);
  if (s.length > max) throw httpError(`${champ} est trop long (${max} caractères maximum).`, 400);
  return s;
}

export async function handleInviteAccept(request, env, cors) {
  const body = await request.json().catch(() => ({}));

  const token = String(body.token ?? '').trim();
  if (!token || token.length > 100) throw httpError('Invitation introuvable ou expirée.', 400);

  const prenom = texte(body.prenom, { min: 2, max: 40, champ: 'Le prénom' });
  const nom    = texte(body.nom,    { min: 2, max: 40, champ: 'Le nom' });

  const email = texte(body.email, { min: 3, max: 120, champ: "L'adresse e-mail" }).toLowerCase();
  const password = String(body.password ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw httpError('Adresse e-mail invalide.', 400);
  }
  // Même minimum que le formulaire, revérifié ici : le navigateur peut mentir.
  if (password.length < 8 || password.length > 200) {
    throw httpError('Le mot de passe doit faire au moins 8 caractères.', 400);
  }

  /* L'invitation est relue côté serveur : jusqu'ici c'étaient les règles
     Firestore qui la validaient, ce qui supposait un client déjà authentifié
     — donc un compte déjà créé. */
  const invite = await firestoreGet(`invites/${token}`, env).catch(() => null);
  if (!invite) throw httpError('Invitation introuvable ou déjà utilisée.', 400);

  const expiresAt = invite.fields?.expiresAt?.timestampValue;
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    throw httpError('Cette invitation a expiré. Demandez-en une nouvelle.', 400);
  }

  // Le rôle vient de l'invitation, jamais de la requête : sans cela, un
  // invité au rôle « contenu » se déclarerait superadmin en éditant l'appel.
  const role = invite.fields?.role?.stringValue ?? 'editor';
  if (!ROLES.includes(role)) throw httpError('Invitation illisible.', 400);

  /* Une adresse déjà connue de Firebase n'est pas forcément un problème :
     quelqu'un peut avoir un compte sans figurer dans `admins`. On le
     réutilise plutôt que d'échouer, mais sans toucher à son mot de passe —
     le connaître ne doit pas permettre de le remplacer. */
  let uid = await createAuthUser({ email, password }, env);
  let compteCree = uid !== null;

  if (!compteCree) {
    const existant = await findAuthUserByEmail(email, env);
    if (!existant) throw httpError("Impossible de créer l'accès. Réessayez.", 500);
    uid = existant.localId;

    const deja = await firestoreGet(`admins/${uid}`, env).catch(() => null);
    if (deja) throw httpError('Ce compte a déjà accès à l\'administration. Connectez-vous.', 409);
  }

  try {
    await firestoreSet(`admins/${uid}`, {
      email,
      prenom,
      nom,
      role,
      inviteToken: token,
      addedAt: new Date(),
      // Personne ne s'abonne aux alertes en entrant : un administrateur
      // ouvre le robinet depuis l'onglet Équipe.
      notifications: false
    }, env);
  } catch (err) {
    /* L'accès n'a pas pu être écrit : un compte tout juste créé resterait
       sans usage, et l'invitation serait consommée pour rien. On défait ce
       que cette requête a fait, et l'invitation reste utilisable. */
    if (compteCree) await deleteAuthUser(uid, env).catch(() => {});
    throw httpError("Impossible d'enregistrer l'accès. Réessayez.", 500);
  }

  // Le lien ne doit pas resservir : il vaut accès à lui seul.
  await firestoreDelete(`invites/${token}`, env).catch(() => {});

  // Pas de jeton renvoyé : le navigateur ouvre la session avec le mot de
  // passe qui vient d'être choisi. Se connecter reste permis même quand
  // l'inscription publique est fermée.
  return json({ ok: true, role }, 200, cors);
}
