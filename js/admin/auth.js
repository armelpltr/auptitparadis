// ============================================================
// AUTH — connexion, acceptation d'invitation, garde d'accès au panel
// ============================================================

import { auth, db } from "../firebase-config.js";
/* Plus de createUserWithEmailAndPassword : créer un compte est passé côté
   Worker, seul moyen de fermer l'inscription publique. Il ne reste ici que
   de quoi ouvrir une session et lire son propre accès. */
import {
  signInWithEmailAndPassword,
  onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { WORKER_URL } from "./config.js";
import { showMessage } from "./ui.js";

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
/* Ces trois-là ne viennent jamais de la personne qui se connecte mais d'un
   réglage du projet Firebase : lui répéter un code d'erreur ne l'avance à
   rien, alors qu'elle a un mot de passe sous la main. On dit donc quoi
   faire tout de suite, et le code reste en fin de phrase pour le jour où
   quelqu'un doit corriger la console. */
const REPLI_MOT_DE_PASSE = 'Connectez-vous avec votre mot de passe en attendant';

const GOOGLE_ERRORS = {
  'auth/popup-closed-by-user':      'Fenêtre Google fermée avant la fin.',
  'auth/cancelled-popup-request':   'Connexion Google annulée.',
  'auth/popup-blocked':             "Votre navigateur a bloqué la fenêtre Google. Autorisez-la, ou connectez-vous avec votre mot de passe.",
  'auth/operation-not-allowed':     `La connexion Google n'est pas activée sur ce site. ${REPLI_MOT_DE_PASSE} (auth/operation-not-allowed).`,
  'auth/unauthorized-domain':       `Ce domaine n'est pas autorisé pour la connexion Google. ${REPLI_MOT_DE_PASSE} (auth/unauthorized-domain).`,
  /* Erreur fourre-tout de Firebase : le plus souvent le fournisseur Google
     est activé mais son identifiant OAuth est incomplet côté console. Ça
     peut aussi être un simple incident réseau, d'où le « réessayez ». */
  'auth/internal-error':            `La connexion Google ne répond pas. Réessayez dans un instant ; si cela persiste, la configuration Google du projet est à vérifier. ${REPLI_MOT_DE_PASSE} (auth/internal-error).`,
  'auth/network-request-failed':    `Connexion Google impossible : le réseau n'a pas répondu. Vérifiez la connexion, puis réessayez (auth/network-request-failed).`,
  /* L'inscription est fermée : Google ne peut plus créer de compte, il ne
     peut que connecter un compte existant. Une adresse inconnue tombe donc
     ici, et non sur la garde d'accès — c'est le refus voulu, pas une panne,
     d'où un message qui parle d'accès et non de configuration. */
  'auth/admin-restricted-operation':
    "Ce compte Google n'a pas accès à l'administration. Les accès se créent sur invitation.",
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
/* Renvoie le rôle du compte, ou null s'il n'a pas accès au panel.
   Le rôle sert ensuite à n'ouvrir que les onglets qui le concernent — les
   règles Firestore appliquent la même limite côté serveur, celle-ci n'est
   qu'un confort d'affichage.
   Défaut à 'admin' quand le champ manque : le tout premier compte a été
   créé à la main avant que les rôles n'existent. */
/* Renvoie `{ role }` si le compte a accès, sinon `{ refus: true }` quand la
   réponse est nette, ou `{ panne: true }` quand on n'a pas pu savoir.
   Les deux cas se ressemblaient jusqu'ici — un `catch` renvoyait `null` sans
   distinguer « cette personne n'est pas membre » de « Firestore n'a pas
   répondu ». La différence compte maintenant qu'un refus efface le compte :
   une coupure réseau ne doit pas supprimer celui d'un administrateur.
   `permission-denied` est la réponse normale pour un non-membre : la règle
   de lecture exige d'exister dans `admins`, donc l'absence s'y traduit par
   un refus et non par un document vide. */
async function roleOfCurrentUser(user) {
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists() ? { role: snap.data().role || 'admin' } : { refus: true };
  } catch (err) {
    return err?.code === 'permission-denied' ? { refus: true } : { panne: true, err };
  }
}

/* Le compte n'est plus créé ici mais par le Worker, avec la clé de service.
   Le navigateur ne peut créer un compte que par l'inscription publique, celle
   qui répond à quiconque détient la clé API — donc à n'importe quel visiteur.
   La déporter permet de fermer cette porte dans la console sans empêcher les
   invités d'entrer : se connecter reste permis, s'inscrire ne l'est plus. */
async function creerAccesViaWorker(charge) {
  const res = await fetch(`${WORKER_URL}/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pendingInvite, ...charge })
  });
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corps.error || "La création de l'accès a échoué.");
  return corps.role || 'editor';
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
   dater d'avant la pose de l'attribut.

   Deux conditions, pas une seule : `a2fUntil` ne suffit pas, puisqu'il vaut
   pour le compte entier, sur n'importe quel poste. `a2fAuthTime` doit en
   plus correspondre à l'`auth_time` de CETTE session — c'est-à-dire que ce
   poste-ci a bien fourni le code, pas qu'un autre poste l'a fait dans les
   8 dernières heures. */
async function a2fDejaValidee(user) {
  try {
    const res = await user.getIdTokenResult(true);
    const jusqua = Number(res.claims.a2fUntil || 0);
    const memeSession = res.claims.a2fAuthTime === res.claims.auth_time;
    return memeSession && jusqua > Date.now();
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

    const acces = await roleOfCurrentUser(user);
    if (!acces.role) {
      const adresse = user.email || 'Ce compte';
      /* Se connecter avec Google crée le compte Firebase avant même qu'on
         ait pu vérifier quoi que ce soit. Refusé dans la foulée, il n'a
         aucune raison de rester : sans cela, la liste des comptes se remplit
         de gens qui n'ont jamais eu accès à rien.
         On n'efface que ce que cette connexion vient de créer — deux dates
         identiques — et jamais sur une panne : un compte plus ancien peut
         être celui d'un administrateur retiré de l'équipe, dont l'e-mail et
         le mot de passe servent peut-être ailleurs. */
      const creeALInstant = user.metadata?.creationTime
        && user.metadata.creationTime === user.metadata.lastSignInTime;

      let efface = false;
      if (acces.refus && creeALInstant) {
        try { await user.delete(); efface = true; } catch { /* on se rabat sur la déconnexion */ }
      }
      if (!efface) await signOut(auth);

      loginScreen.hidden = false;
      a2fScreen.hidden = true;
      adminApp.hidden = true;

      /* Une modale plutôt qu'une ligne rouge sous le champ : ce refus n'est
         pas une faute de saisie qu'on corrige en réessayant, mais un compte
         qui n'a rien à faire ici. Il mérite d'être lu et acquitté.
         L'adresse est rappelée : sur un poste où plusieurs comptes Google
         sont ouverts, c'est souvent le mauvais qui a été choisi. */
      if (acces.panne) {
        await showMessage(
          "Impossible de vérifier vos accès",
          "La base n'a pas répondu. Réessayez dans un instant — votre compte n'est pas en cause."
        );
      } else {
        await showMessage(
          "Ce compte n'a pas accès à l'administration",
          `${adresse} ne figure pas parmi les personnes autorisées. `
          + `Demandez une invitation, ou reconnectez-vous avec le compte qui a reçu l'accès.`
        );
      }
      return;
    }
    const role = acces.role;

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
    onReady(role);
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
      onReady((await roleOfCurrentUser(auth.currentUser)).role);
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
      /* Le Worker fait tout d'un bloc : il relit l'invitation, crée le
         compte, écrit l'entrée `admins` et consomme le jeton. Le rôle qu'il
         renvoie vient de l'invitation, jamais de ce formulaire. */
      const role = await creerAccesViaWorker({ prenom, nom, email, password });

      // L'accès existe : il ne reste qu'à ouvrir la session, avec le mot de
      // passe que la personne vient de choisir. Se connecter reste permis
      // même lorsque l'inscription publique est fermée.
      await signInWithEmailAndPassword(auth, email, password);

      history.replaceState({}, '', location.pathname);   // le jeton quitte la barre d'adresse

      acceptingInvite = false;
      inviteScreen.hidden = true;
      loginScreen.hidden = true;
      adminApp.hidden = false;
      // Le rôle vient de l'invitation qu'on vient d'accepter.
      onReady(role);
    } catch (err) {
      acceptingInvite = false;
      errEl.textContent = inviteErrorMessage(err);
      errEl.hidden = false;
      // Compte créé mais accès refusé : on ne laisse pas de session orpheline
      if (auth.currentUser) await signOut(auth);
    }
  });
}
