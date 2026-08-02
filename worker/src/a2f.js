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
  firestoreIncrement, fromFirestoreFields, setCustomClaims
} from './firebase.js';
import { envoyerCodeA2F } from './mailer.js';

const TTL_MS         = 10 * 60 * 1000;   // validité d'un code
const MAX_ESSAIS     = 5;                // essais avant invalidation du défi
const MAX_ENVOIS     = 5;                // codes demandés par fenêtre
const FENETRE_MS     = 30 * 60 * 1000;   // durée de la fenêtre de comptage
const DELAI_RENVOI_MS = 45 * 1000;       // attente minimale entre deux envois

/* Durée pendant laquelle le panel reste ouvert après un code validé. Passé
   ce délai, un nouveau code est demandé. Court volontairement : le poste
   d'une boulangerie n'est pas toujours sous surveillance. */
const VALIDITE_ACCES_MS = 8 * 60 * 60 * 1000;

function genererCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
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

  const email = membre.email || user.email;
  if (!email) throw httpError('Aucune adresse e-mail sur ce compte.', 400);

  return { uid: user.localId, email, prenom: membre.prenom || '' };
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

  /* Un code encore valable existe déjà : on ne le remplace pas et on ne
     renvoie rien. Le refus sec ne vaut que pour un renvoi demandé
     explicitement — sinon toute reconnexion dans les 45 secondes suivant
     la précédente était rejetée, et l'appelant se retrouvait déconnecté
     avec « patientez » sans avoir rien demandé. */
  const renvoiExplicite = body.renvoi === true;
  if (precedent) {
    const tropTot = maintenant - (precedent.lastSentAt || 0) < DELAI_RENVOI_MS;
    const encoreValable = (precedent.expiresAt || 0) > maintenant;

    if (tropTot && renvoiExplicite) {
      throw httpError('Patientez quelques secondes avant de demander un nouveau code.', 429);
    }
    if (tropTot && encoreValable) {
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

  /* Le compteur d'envois est incrémenté AVANT l'envoi, et de façon
     atomique : deux demandes simultanées liraient sinon la même valeur, et
     le plafond ne bornerait plus le nombre d'e-mails réellement partis. */
  let envois;
  if (debutFenetre === maintenant) {
    envois = 1;
  } else {
    envois = await firestoreIncrement(chemin, 'sends', env);
    if (envois > MAX_ENVOIS) {
      throw httpError('Trop de codes demandés. Réessayez dans une demi-heure.', 429);
    }
  }

  const code = genererCode();
  const sel = crypto.randomUUID();

  await firestoreSet(chemin, {
    codeHash:    await sha256(sel + code),
    sel,
    expiresAt:   maintenant + TTL_MS,
    attempts:    0,
    sends:       envois,
    windowStart: debutFenetre,
    lastSentAt:  maintenant
  }, env);

  const envoye = await envoyerCodeA2F({ email, prenom, code }, env);
  if (!envoye) {
    throw httpError("L'envoi du code a échoué. Prévenez l'administrateur du site.", 502);
  }

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

  const { uid } = await membreOuRefus(body.idToken, env);
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
     écrit, pour n'avoir qu'une ligne de règle à publier ensuite. */
  const jusqua = Date.now() + VALIDITE_ACCES_MS;
  await setCustomClaims(uid, { a2fUntil: jusqua }, env);

  return json({ ok: true, a2fUntil: jusqua }, 200, cors);
}
