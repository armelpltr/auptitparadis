// ============================================================
// AUTH — connexion, acceptation d'invitation, garde d'accès au panel
// ============================================================

import { auth, db } from "../firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { setVal } from "./ui.js";

const loginScreen  = document.getElementById('loginScreen');
const adminApp     = document.getElementById('adminApp');
const loginForm    = document.getElementById('loginForm');
const loginError   = document.getElementById('loginError');
const logoutBtn    = document.getElementById('logoutBtn');
const inviteScreen = document.getElementById('inviteScreen');

const inviteParams = new URLSearchParams(location.search);
const pendingInvite = inviteParams.get('invite') && inviteParams.get('token')
  ? { email: inviteParams.get('invite').toLowerCase(), token: inviteParams.get('token') }
  : null;

/* Créer le compte connecte aussitôt la personne, donc onAuthStateChanged part
   vérifier son appartenance aux admins — alors que l'entrée n'est écrite que
   juste après. Ce drapeau met la vérification en pause le temps de l'écriture. */
let acceptingInvite = false;

/* Un message par cause réelle : "vérifie l'e-mail et le mot de passe" envoyait
   sur une fausse piste quand le vrai problème était côté configuration. */
const LOGIN_ERRORS = {
  'auth/invalid-credential':    "E-mail ou mot de passe incorrect. Si le compte n'a jamais été créé, ajoute-le dans Firebase Console > Authentication > Users.",
  'auth/user-not-found':        "Aucun compte avec cet e-mail. Crée-le dans Firebase Console > Authentication > Users.",
  'auth/wrong-password':        'Mot de passe incorrect.',
  'auth/invalid-email':         "Format d'e-mail invalide.",
  'auth/user-disabled':         'Ce compte a été désactivé dans Firebase.',
  'auth/too-many-requests':     'Trop de tentatives. Patiente quelques minutes avant de réessayer.',
  'auth/operation-not-allowed': "La connexion par e-mail/mot de passe n'est pas activée. Firebase Console > Authentication > Sign-in method > Email/Password > Activer.",
  'auth/configuration-not-found': "Authentication n'est pas configuré sur ce projet Firebase. Console > Authentication > Get started.",
  'auth/unauthorized-domain':   "Domaine non autorisé. Ajoute armelpltr.github.io dans Firebase Console > Authentication > Settings > Domaines autorisés.",
  'auth/network-request-failed': 'Pas de connexion au serveur Firebase. Vérifie ta connexion internet.',
  'auth/api-key-not-valid':     'Clé API Firebase invalide dans firebase-config.js.'
};

function loginErrorMessage(err) {
  const known = LOGIN_ERRORS[err && err.code];
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
  if (err.code === 'permission-denied') {
    return "Cette invitation n'est plus valable. Elle a peut-être déjà été utilisée ou annulée.";
  }
  return err.message || "La création de l'accès a échoué.";
}

/**
 * Câble les écrans de connexion et d'invitation.
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

  logoutBtn.addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    if (acceptingInvite) return;   // l'accès est en cours de création
    if (!user) {
      loginScreen.hidden = pendingInvite ? true : false;
      adminApp.hidden = true;
      return;
    }

    if (!(await isCurrentUserAdmin(user))) {
      await signOut(auth);
      loginScreen.hidden = false;
      adminApp.hidden = true;
      loginError.textContent = "Ce compte n'a pas accès à l'administration. Demandez une invitation.";
      loginError.hidden = false;
      return;
    }

    loginScreen.hidden = true;
    inviteScreen.hidden = true;
    adminApp.hidden = false;
    onReady();
  });

  /* ---------- Acceptation d'une invitation ---------- */
  if (pendingInvite) {
    loginScreen.hidden = true;
    inviteScreen.hidden = false;
    setVal('inviteFormEmail', pendingInvite.email);
  }

  document.getElementById('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('inviteError');
    errEl.hidden = true;
    const password = document.getElementById('inviteFormPassword').value;

    acceptingInvite = true;
    try {
      const cred = await accountForInvite(pendingInvite.email, password);

      // Le rôle vient de l'invitation, pas du client : les règles vérifient qu'il
      // correspond. Lisible seulement maintenant, une fois l'invité authentifié.
      const inviteSnap = await getDoc(doc(db, 'invites', pendingInvite.email));
      const role = inviteSnap.exists() ? (inviteSnap.data().role || 'editor') : 'editor';

      // Le jeton est vérifié par les règles Firestore, pas seulement ici.
      await setDoc(doc(db, 'admins', cred.user.uid), {
        email: pendingInvite.email,
        role,
        inviteToken: pendingInvite.token,
        addedAt: new Date()
      });
      await deleteDoc(doc(db, 'invites', pendingInvite.email));
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
