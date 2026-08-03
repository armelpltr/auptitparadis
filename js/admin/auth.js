// ============================================================
// AUTH — connexion, acceptation d'invitation, garde d'accès au panel
// ============================================================

import { auth, db } from "../firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { WORKER_URL } from "./config.js";

const loginScreen  = document.getElementById('loginScreen');
const adminApp     = document.getElementById('adminApp');
const loginForm    = document.getElementById('loginForm');
const loginError   = document.getElementById('loginError');
const logoutBtn    = document.getElementById('logoutBtn');
const inviteScreen = document.getElementById('inviteScreen');
const a2fScreen    = document.getElementById('a2fScreen');
const a2fError     = document.getElementById('a2fError');

/* Le lien ne porte plus que le jeton : l'invité saisit lui-même ses
   coordonnées, on ne les connaît pas au moment de l'inviter. */
const pendingInvite = new URLSearchParams(location.search).get('token') || null;

/* Créer le compte connecte aussitôt la personne, donc onAuthStateChanged part
   vérifier son appartenance aux admins — alors que l'entrée n'est écrite que
   juste après. Ce drapeau met la vérification en pause le temps de l'écriture. */
let acceptingInvite = false;

/* Ces messages s'affichent sur une page publique, devant n'importe qui.
   Les versions précédentes indiquaient quoi corriger dans la console
   Firebase : utile au développeur, mais c'était renseigner un inconnu sur
   l'infrastructure et sur l'existence ou non d'un compte. Le code d'erreur
   reste affiché pour les pannes de configuration, il ne dit rien de
   sensible et évite de chercher à l'aveugle. */
const LOGIN_ERRORS = {
  'auth/invalid-credential':    "Connexion refusée : aucun compte ne correspond à ces identifiants. Si vous faites partie de l'équipe, demandez un accès à l'administrateur du site.",
  'auth/user-not-found':        "Connexion refusée : aucun compte ne correspond à ces identifiants. Si vous faites partie de l'équipe, demandez un accès à l'administrateur du site.",
  'auth/wrong-password':        "Connexion refusée : aucun compte ne correspond à ces identifiants. Si vous faites partie de l'équipe, demandez un accès à l'administrateur du site.",
  'auth/invalid-email':         "Format d'adresse e-mail invalide.",
  'auth/user-disabled':         "Cet accès a été désactivé. Contactez l'administrateur du site.",
  'auth/too-many-requests':     'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  'auth/network-request-failed': 'Pas de connexion au serveur. Vérifiez votre connexion internet.',
  // Pannes de configuration : elles ne concernent pas l'utilisateur, mais
  // le code permet de les identifier sans tâtonner.
  'auth/operation-not-allowed':   'Connexion indisponible (auth/operation-not-allowed).',
  'auth/configuration-not-found': 'Connexion indisponible (auth/configuration-not-found).',
  'auth/unauthorized-domain':     'Connexion indisponible (auth/unauthorized-domain).',
  'auth/api-key-not-valid':       'Connexion indisponible (auth/api-key-not-valid).'
};

/* La connexion Google échoue autrement que celle par mot de passe : la
   plupart des cas viennent de la fenêtre surgissante ou d'un réglage du
   projet, pas d'une erreur de saisie. */
const GOOGLE_ERRORS = {
  'auth/popup-closed-by-user':      'Fenêtre Google fermée avant la fin.',
  'auth/cancelled-popup-request':   'Connexion Google annulée.',
  'auth/popup-blocked':             "Votre navigateur a bloqué la fenêtre Google. Autorisez-la, ou connectez-vous avec votre mot de passe.",
  'auth/operation-not-allowed':     'Connexion Google indisponible (auth/operation-not-allowed).',
  'auth/unauthorized-domain':       'Connexion Google indisponible (auth/unauthorized-domain).',
  'auth/internal-error':            'Connexion Google indisponible (auth/internal-error).',
  'auth/account-exists-with-different-credential':
    "Un compte existe déjà avec cette adresse et un mot de passe. Connectez-vous avec le mot de passe."
};

function loginErrorMessage(err) {
  const known = LOGIN_ERRORS[err && err.code] || GOOGLE_ERRORS[err && err.code];
  if (known) return known;
  return `Connexion impossible (${(err && err.code) || 'erreur inconnue'}).`;
}

/* Être connecté ne donne pas accès : il faut figurer dans `admins`.
   Les règles Firestore appliquent la même condition côté serveur — cette
   vérification-ci ne fait qu'éviter d'afficher un panel inutilisable. */
async function isCurrentUserAdmin(user) {
  try {
    return (await getDoc(doc(db, 'admins', user.uid))).exists();
  } catch {
    return false;   // règles refusant la lecture = pas admin
  }
}

/* Le lien doit marcher que la personne ait déjà un compte ou non. Si l'adresse
   est connue de Firebase, on se connecte au compte existant au lieu d'en créer
   un : l'entrée `admins` se crée ensuite de la même façon, le jeton reste
   vérifié par les règles. */
async function accountForInvite(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    if (err.code !== 'auth/email-already-in-use') throw err;
    return await signInWithEmailAndPassword(auth, email, password);
  }
}

function inviteErrorMessage(err) {
  if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
    return "Un compte existe déjà avec cette adresse, mais ce mot de passe ne correspond pas. Saisissez celui de votre compte existant.";
  }
  if (err.code === 'auth/weak-password') return 'Mot de passe trop court — 8 caractères minimum.';
  if (err.code === 'auth/invalid-email') return "Format d'adresse e-mail invalide.";
  if (err.message === 'invitation-introuvable' || err.code === 'permission-denied') {
    return "Cette invitation n'est plus valable. Elle a peut-être expiré, déjà été utilisée, ou été annulée.";
  }
  return err.message || "La création de l'accès a échoué.";
}

/* ---------- Double authentification ---------- */
/* Le mot de passe ouvre la session Firebase, il n'ouvre pas le panel. Il
   faut ensuite un code à six chiffres reçu par e-mail. Le code est tiré et
   comparé par le Worker : le navigateur ne le voit jamais avant qu'on le
   saisisse, et la collection qui le garde n'est lisible par aucun client.

   La preuve du passage est un attribut `a2fUntil` posé sur le compte, donc
   dans le jeton d'identité — et non un drapeau en mémoire, qu'un rechargement
   remettrait à zéro et qu'une console remettrait à ce qu'on veut. */

async function appelerWorker(chemin, corps) {
  const res = await fetch(WORKER_URL + chemin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !('ok' in data)) {
    throw new Error(data.error || 'Le serveur n\'a pas répondu.');
  }
  return data;
}

/* Lu depuis le jeton fraîchement rafraîchi : un jeton en cache pourrait
   dater d'avant la pose de l'attribut. */
async function a2fDejaValidee(user) {
  try {
    const res = await user.getIdTokenResult(true);
    const jusqua = Number(res.claims.a2fUntil || 0);
    return jusqua > Date.now();
  } catch {
    return false;
  }
}

/* `renvoi` distingue le clic sur « Renvoyer un code » de la demande
   automatique faite à la connexion : seul le premier mérite qu'on refuse
   sèchement quand c'est trop tôt. */
async function demanderCode(user, renvoi = false) {
  const data = await appelerWorker('/a2f/request', {
    idToken: await user.getIdToken(),
    renvoi
  });
  if (data.indice) document.getElementById('a2fIndice').textContent = data.indice;
  return data;
}

function montrerEcranA2F() {
  loginScreen.hidden = true;
  inviteScreen.hidden = true;
  adminApp.hidden = true;
  a2fScreen.hidden = false;
  a2fError.hidden = true;
  const champ = document.getElementById('a2fCode');
  champ.value = '';
  champ.focus();
}

/**
 * Câble les écrans de connexion, de vérification et d'invitation.
 * `onReady` est appelé une fois l'accès au panel accordé : c'est là que les
 * onglets chargent leurs données.
 */
export function initAuth(onReady) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      loginError.textContent = loginErrorMessage(err);
      loginError.hidden = false;
    }
  });

  /* Connexion Google. Rien de plus à faire ensuite : onAuthStateChanged
     prend le relais, vérifie l'appartenance au panel et réclame le code
     comme pour une connexion par mot de passe. Un compte Google ne donne
     donc pas d'accès par lui-même — il faut toujours figurer dans `admins`.

     `prompt: select_account` force le choix du compte : sur un poste
     partagé, ou avec plusieurs comptes Google ouverts, Google reconnecte
     sinon silencieusement le dernier utilisé. */
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: 'select_account' });

  document.getElementById('googleBtn').addEventListener('click', async () => {
    loginError.hidden = true;
    try {
      await signInWithPopup(auth, google);
    } catch (err) {
      loginError.textContent = loginErrorMessage(err);
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    if (acceptingInvite) return;   // l'accès est en cours de création
    if (!user) {
      loginScreen.hidden = pendingInvite ? true : false;
      a2fScreen.hidden = true;
      adminApp.hidden = true;
      return;
    }

    if (!(await isCurrentUserAdmin(user))) {
      await signOut(auth);
      loginScreen.hidden = false;
      a2fScreen.hidden = true;
      adminApp.hidden = true;
      loginError.textContent = "Ce compte n'a pas accès à l'administration. Demandez une invitation.";
      loginError.hidden = false;
      return;
    }

    // Membre reconnu, mais le panel n'est pas encore ouvert : il reste le code.
    if (!(await a2fDejaValidee(user))) {
      try {
        // Qu'un code encore valable ait été réutilisé ne regarde pas
        // l'utilisateur : il attend un code, il en a un. L'annoncer en rouge
        // sous le champ le faisait passer pour une erreur.
        await demanderCode(user);
        montrerEcranA2F();
      } catch (err) {
        // Sans code envoyé, personne n'entre : on renvoie à la connexion
        // plutôt que de laisser un écran de saisie sans issue.
        await signOut(auth);
        loginScreen.hidden = false;
        loginError.textContent = err.message;
        loginError.hidden = false;
      }
      return;
    }

    loginScreen.hidden = true;
    inviteScreen.hidden = true;
    a2fScreen.hidden = true;
    adminApp.hidden = false;
    onReady();
  });

  /* ---------- Saisie du code ---------- */
  document.getElementById('a2fForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bouton = document.getElementById('a2fSubmit');
    const code = document.getElementById('a2fCode').value.trim();
    a2fError.hidden = true;
    bouton.disabled = true;
    bouton.textContent = 'Vérification…';

    try {
      const data = await appelerWorker('/a2f/verify', {
        idToken: await auth.currentUser.getIdToken(),
        code
      });
      if (!data.ok) throw new Error(
        data.restant > 0 ? `${data.error} Encore ${data.restant} essai${data.restant > 1 ? 's' : ''}.`
                         : data.error
      );

      // L'attribut vient d'être posé : sans rafraîchissement forcé, le jeton
      // en mémoire ne le contient pas encore et on redemanderait un code.
      await auth.currentUser.getIdToken(true);
      a2fScreen.hidden = true;
      loginScreen.hidden = true;
      inviteScreen.hidden = true;
      adminApp.hidden = false;
      onReady();
    } catch (err) {
      a2fError.textContent = err.message;
      a2fError.hidden = false;
    } finally {
      bouton.disabled = false;
      bouton.textContent = 'Valider';
    }
  });

  document.getElementById('a2fRenvoyer').addEventListener('click', async () => {
    a2fError.hidden = true;
    try {
      await demanderCode(auth.currentUser, true);
      a2fError.textContent = 'Un nouveau code vient de partir.';
      a2fError.hidden = false;
    } catch (err) {
      a2fError.textContent = err.message;
      a2fError.hidden = false;
    }
  });

  document.getElementById('a2fAnnuler').addEventListener('click', () => signOut(auth));

  /* ---------- Acceptation d'une invitation ---------- */
  if (pendingInvite) {
    loginScreen.hidden = true;
    inviteScreen.hidden = false;
  }

  document.getElementById('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('inviteError');
    errEl.hidden = true;

    const prenom   = document.getElementById('inviteFormPrenom').value.trim();
    const nom      = document.getElementById('inviteFormNom').value.trim();
    const email    = document.getElementById('inviteFormEmail').value.trim().toLowerCase();
    const password = document.getElementById('inviteFormPassword').value;

    if (!prenom || !nom) {
      errEl.textContent = 'Merci d\'indiquer votre prénom et votre nom.';
      errEl.hidden = false;
      return;
    }

    acceptingInvite = true;
    try {
      const cred = await accountForInvite(email, password);

      // Le rôle vient de l'invitation, pas du client : les règles vérifient qu'il
      // correspond. Lisible seulement maintenant, une fois l'invité authentifié.
      const inviteSnap = await getDoc(doc(db, 'invites', pendingInvite));
      if (!inviteSnap.exists()) throw new Error('invitation-introuvable');
      const role = inviteSnap.data().role || 'editor';

      // Le jeton et son expiration sont vérifiés par les règles Firestore,
      // pas seulement ici.
      await setDoc(doc(db, 'admins', cred.user.uid), {
        email,
        prenom,
        nom,
        role,
        inviteToken: pendingInvite,
        addedAt: new Date(),
        // Personne ne s'abonne aux alertes de commande en entrant : un
        // administrateur ouvre le robinet depuis l'onglet Équipe.
        notifications: false
      });
      await deleteDoc(doc(db, 'invites', pendingInvite));
      history.replaceState({}, '', location.pathname);   // le jeton quitte la barre d'adresse

      acceptingInvite = false;
      inviteScreen.hidden = true;
      loginScreen.hidden = true;
      adminApp.hidden = false;
      onReady();
    } catch (err) {
      acceptingInvite = false;
      errEl.textContent = inviteErrorMessage(err);
      errEl.hidden = false;
      // Compte créé mais accès refusé : on ne laisse pas de session orpheline
      if (auth.currentUser) await signOut(auth);
    }
  });
}
