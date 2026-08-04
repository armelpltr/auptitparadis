// ============================================================
// POST /a2f/request — envoie un code à six chiffres par e-mail
// POST /a2f/verify  — le vérifie et débloque l'accès au panel
//
// Le principe tient en une phrase : le code n'existe jamais dans le
// navigateur avant d'être saisi. Il est tiré ici, gardé ici, comparé ici.
//
// Il vit dans `otpChallenges/{uid}`, une collection qui n'a AUCUNE règle
// Firestore. Les règles refusent par défaut ce qu'elles n'autorisent pas
// explicitement : personne ne peut lire cette collection, pas même le
// titulaire du compte avec sa propre session. Seul ce Worker y accède, par
// la clé de service. Générer le code côté navigateur, ou le ranger sous un
// document que l'utilisateur peut lire, reviendrait à le lui donner : qui
// détient le mot de passe lirait le code et franchirait la double
// authentification sans jamais ouvrir la boîte mail.
//
// Et il n'y est pas en clair, mais salé et haché : une fuite du contenu de
// Firestore ne donnerait pas les codes en cours.
// ============================================================

import { json, httpError } from './http.js';
import {
  verifyIdToken, firestoreGet, firestoreSet, firestoreDelete,
  firestoreIncrement, firestoreUpdate, fromFirestoreFields, setCustomClaims
} from './firebase.js';
import { envoyerCodeA2F } from './mailer.js';

const TTL_MS         = 10 * 60 * 1000;   // validité d'un code
const MAX_ESSAIS     = 5;                // essais avant invalidation du défi
const MAX_ENVOIS     = 5;                // codes demandés par fenêtre
const FENETRE_MS     = 30 * 60 * 1000;   // durée de la fenêtre de comptage

/* Durée pendant laquelle le panel reste ouvert après un code validé. Passé
   ce délai, un nouveau code est demandé. Court volontairement : le poste
   d'une boulangerie n'est pas toujours sous surveillance. */
const VALIDITE_ACCES_MS = 8 * 60 * 60 * 1000;

/* Tirage par rejet plutôt qu'un modulo : 2^32 n'est pas un multiple d'un
   million, et `% 1000000` rendait les 967 296 premiers codes légèrement plus
   probables que les autres. Le biais était infime, la boucle coûte trois
   lignes — autant ne pas laisser la question ouverte. */
function genererCode() {
  const a = new Uint32Array(1);
  const plafond = Math.floor(4294967296 / 1000000) * 1000000;
  do { crypto.getRandomValues(a); } while (a[0] >= plafond);
  return String(a[0] % 1000000).padStart(6, '0');
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/* Comparaison à durée constante : un `===` sort au premier caractère
   différent, et ce temps de réponse renseigne sur le début du code. */
function memeCode(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Le jeton prouve seulement qu'on s'est connecté à Firebase — n'importe
   qui peut s'y créer un compte. L'appartenance au panel se vérifie ici, et
   c'est aussi elle qui donne l'adresse où écrire : celle inscrite dans
   `admins`, jamais celle fournie par l'appelant. */
async function membreOuRefus(idToken, env) {
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

  /* L'adresse du compte Firebase d'abord, celle du document `admins`
     seulement en secours. C'est celle avec laquelle on vient de
     s'authentifier : elle est forcément juste, sinon la connexion aurait
     échoué. Le champ de `admins` n'est qu'une copie faite à la création de
     l'accès, et une copie diverge — ici elle portait une faute de frappe,
     et les codes partaient depuis le début vers une boîte inexistante. */
  const email = user.email || membre.email;
  if (!email) throw httpError('Aucune adresse e-mail sur ce compte.', 400);

  return { uid: user.localId, email, prenom: membre.prenom || '', authTime: user.authTime };
}

/* ---------- Demande d'un code ---------- */

export async function handleA2fRequest(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });
  const { uid, email, prenom } = await membreOuRefus(body.idToken, env);

  const chemin = `otpChallenges/${uid}`;
  const maintenant = Date.now();

  /* Anti-abus : un délai entre deux envois, et un plafond par fenêtre
     glissante. Sans quoi le formulaire devient un moyen d'inonder la boîte
     mail d'un membre, et de consommer le quota Brevo. */
  let debutFenetre = maintenant;
  let precedent = null;
  try {
    const doc = await firestoreGet(chemin, env);
    precedent = fromFirestoreFields(doc.fields);
  } catch { /* aucune demande en cours */ }

  /* Il n'y a plus de délai minimal entre deux envois : un clic sur
     « Renvoyer » renvoie, toujours. Le seul garde-fou restant est le
     plafond par demi-heure, qui suffit — l'endpoint exige déjà le jeton
     d'un membre, et la seule boîte qu'il peut inonder est la sienne.
     Le délai n'apportait qu'un message « patientez » là où l'utilisateur
     voulait précisément un nouveau code.

     Reste une seule suppression, sur la demande AUTOMATIQUE faite à la
     connexion : si un code a réellement été envoyé et court encore, on ne
     le remplace pas. `lastSentAt > 0` est ce qui distingue un envoi
     confirmé d'un défi écrit puis abandonné. */
  const renvoiExplicite = body.renvoi === true;
  if (precedent) {
    const vraimentEnvoye = (precedent.lastSentAt || 0) > 0;
    const encoreValable = (precedent.expiresAt || 0) > maintenant;

    console.log(`[a2f] defi existant — envoye=${vraimentEnvoye} valable=${encoreValable} renvoi=${renvoiExplicite}`);
    if (vraimentEnvoye && encoreValable && !renvoiExplicite) {
      return json({
        ok: true,
        dejaEnvoye: true,
        expiresAt: precedent.expiresAt,
        indice: masquer(email)
      }, 200, cors);
    }
    if (maintenant - (precedent.windowStart || 0) < FENETRE_MS) {
      debutFenetre = precedent.windowStart;
    }
  }

  /* Le compteur ne compte que les e-mails réellement partis, d'où son nom.
     La version précédente l'incrémentait avant l'envoi, pour qu'une rafale
     de demandes simultanées ne puisse pas passer sous le plafond. Mais elle
     comptait aussi les tentatives infructueuses : quand plus rien ne
     partait, le quota s'épuisait tout seul et interdisait l'accès une
     demi-heure durant, sans qu'un seul message ait été envoyé.
     Le risque écarté est faible ici : cet endpoint exige déjà le jeton d'un
     membre du panel, et la seule boîte qu'il peut inonder est la sienne. */
  const envoisFenetre = (debutFenetre === maintenant) ? 0 : (precedent?.sendsOk || 0);
  if (envoisFenetre >= MAX_ENVOIS) {
    throw httpError('Trop de codes demandés. Réessayez dans une demi-heure.', 429);
  }

  const code = genererCode();
  const sel = crypto.randomUUID();

  /* `lastSentAt` reste à zéro jusqu'à ce que l'e-mail soit réellement
     parti. C'est ce qui empêche l'état le plus vicieux : un défi enregistré
     comme envoyé alors que la requête a été coupée avant l'envoi — un
     rechargement de page suffit. Le code « encore valable » bloquait alors
     tout nouvel envoi pendant dix minutes, sans qu'aucun e-mail n'existe.
     Tant que lastSentAt vaut 0, la demande suivante renvoie un code. */
  await firestoreSet(chemin, {
    codeHash:    await sha256(sel + code),
    sel,
    expiresAt:   maintenant + TTL_MS,
    attempts:    0,
    sendsOk:     envoisFenetre,
    windowStart: debutFenetre,
    lastSentAt:  0
  }, env);

  console.log(`[a2f] envoi d'un nouveau code vers @${String(email).split('@')[1] || '?'}`);
  const envoye = await envoyerCodeA2F({ email, prenom, code }, env);
  if (!envoye) {
    throw httpError("L'envoi du code a échoué. Prévenez l'administrateur du site.", 502);
  }

  // Envoi confirmé : c'est seulement maintenant que le délai anti-renvoi
  // commence à courir et que le quota est entamé.
  await firestoreUpdate(chemin, { lastSentAt: Date.now() }, env);
  await firestoreIncrement(chemin, 'sendsOk', env);
  console.log('[a2f] code envoye, horodate et compte');

  // L'adresse est renvoyée masquée : le panel affiche « ...@gmail.com »
  // pour lever le doute sur la boîte à consulter, sans l'étaler à l'écran.
  return json({ ok: true, expiresAt: maintenant + TTL_MS, indice: masquer(email) }, 200, cors);
}

function masquer(email) {
  const [avant, apres] = String(email).split('@');
  if (!apres) return '';
  const debut = avant.slice(0, 2);
  return `${debut}${'•'.repeat(Math.max(1, avant.length - 2))}@${apres}`;
}

/* ---------- Vérification ---------- */

export async function handleA2fVerify(request, env, cors) {
  const body = await request.json().catch(() => {
    throw httpError('Requête illisible.', 400);
  });
  const code = String(body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw httpError('Le code doit comporter six chiffres.', 400);

  const { uid, authTime } = await membreOuRefus(body.idToken, env);
  const chemin = `otpChallenges/${uid}`;

  let defi;
  try {
    const doc = await firestoreGet(chemin, env);
    defi = fromFirestoreFields(doc.fields);
  } catch {
    throw httpError('Aucun code en cours. Demandez-en un nouveau.', 410);
  }

  if ((defi.expiresAt || 0) < Date.now()) {
    await firestoreDelete(chemin, env);
    throw httpError('Ce code a expiré. Demandez-en un nouveau.', 410);
  }

  // Décompté avant la comparaison, et atomiquement, pour la même raison que
  // le compteur d'envois : sinon la limite ne tient pas face au parallèle.
  const essais = await firestoreIncrement(chemin, 'attempts', env);
  if (essais > MAX_ESSAIS) {
    await firestoreDelete(chemin, env);
    throw httpError('Trop de tentatives. Demandez un nouveau code.', 429);
  }

  const attendu = await sha256((defi.sel || '') + code);
  if (!memeCode(attendu, defi.codeHash || '')) {
    return json({
      ok: false,
      error: 'Code incorrect.',
      restant: Math.max(0, MAX_ESSAIS - essais)
    }, 401, cors);
  }

  // Bon code : usage unique, le défi disparaît avant toute suite.
  await firestoreDelete(chemin, env);

  /* L'attribut posé sur le compte est ce qui permettra aux règles
     Firestore d'exiger la double authentification côté serveur. Tant
     qu'elles ne l'exigent pas, il ne sert qu'au panel — mais il est déjà
     écrit, pour n'avoir qu'une ligne de règle à publier ensuite.

     `a2fAuthTime` est la pièce qui empêche la fuite entre appareils : un
     custom claim vaut pour TOUT jeton émis pour ce compte, où qu'il se
     connecte. Sans cette valeur, se connecter sur un second poste dans les
     8h aurait hérité du même « validé » — sans jamais redemander de code.
     `auth_time`, lui, ne bouge pas à un simple rafraîchissement de jeton,
     mais change à chaque vraie reconnexion : comparer les deux, à la
     vérification, dit si CE poste-ci a bien passé le code, pas seulement
     ce compte n'importe où. */
  const jusqua = Date.now() + VALIDITE_ACCES_MS;
  await setCustomClaims(uid, { a2fUntil: jusqua, a2fAuthTime: authTime }, env);

  return json({ ok: true, a2fUntil: jusqua }, 200, cors);
}
