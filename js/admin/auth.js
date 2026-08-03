// ============================================================
// AUTH — connexion, acceptation d'invitation, garde d'accès au panel
// ============================================================

import { auth, db } from "../firebase-config.js";
/* Ni création de compte ni connexion Google : la première est passée côté
   Worker, seul moyen de fermer l'inscription publique, et la seconde a été
   retirée — un fournisseur d'identité tiers crée le compte avant qu'on ait
   pu vérifier quoi que ce soit. Il ne reste ici que de quoi ouvrir une
   session par mot de passe et lire son propre accès. */
import {
  signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { WORKER_URL } from "./config.js";
import { showMessage } from "./ui.js";
import { evaluerMotDePasse, LONGUEUR_MINIMALE } from "./motdepasse.js";

const loginScreen  = document.getElementById('loginScreen');
const adminApp     = document.getElementById('adminApp');
const loginForm    = document.getElementById('loginForm');
const loginError   = document.getElementById('loginError');
const logoutBtn    = document.getElementById('logoutBtn');
const inviteScreen = document.getElementById('inviteScreen');
const a2fScreen    = document.getElementById('a2fScreen');
const a2fError     = document.getElementById('a2fError');

/* Le lien ne porte plus que le jeton : l'invité saisit lui-même ses
   coordonnées, on ne les connaît pas au moment de l'inviter.
   Remis à null dès l'accès créé : ce jeton commande l'affichage de l'écran
   d'invitation, et le garder ferait revenir un formulaire déjà rempli — ou
   pire, une page vide — à qui se déconnecterait depuis l'écran du code. */
let pendingInvite = new URLSearchParams(location.search).get('token') || null;

/* Un drapeau mettait ici la garde d'accès en pause pendant l'acceptation
   d'une invitation : le navigateur créait le compte, se retrouvait connecté,
   et la garde le rejetait faute d'entrée `admins` — écrite seulement juste
   après. Le Worker écrit désormais cet accès avant que le navigateur
   n'ouvre la session, si bien que la garde trouve tout en place et n'a plus
   besoin d'être suspendue. Elle ne l'est donc plus, et c'est elle qui
   réclame le code de vérification, y compris à cette première connexion. */

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

function loginErrorMessage(err) {
  const known = LOGIN_ERRORS[err && err.code];
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

  logoutBtn.addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
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

  /* ---------- Jauge de solidité ---------- */
  /* Elle se met à jour à la frappe, mais n'apparaît qu'une fois la saisie
     commencée : une barre rouge devant un champ encore vide se lit comme un
     reproche avant même d'avoir essayé. */
  const mdpChamp   = document.getElementById('inviteFormPassword');
  const mdpJauge   = document.getElementById('mdpJauge');
  const mdpBarre   = document.getElementById('mdpBarreRemplie');
  const mdpVerdict = document.getElementById('mdpVerdict');

  function rafraichirJauge() {
    const valeur = mdpChamp.value;
    mdpJauge.hidden = valeur.length === 0;
    if (!valeur) return;

    const { score, libelle, defauts, accepte } = evaluerMotDePasse(valeur, [
      document.getElementById('inviteFormEmail').value,
      document.getElementById('inviteFormPrenom').value,
      document.getElementById('inviteFormNom').value
    ]);

    mdpBarre.dataset.score = String(score);
    mdpVerdict.classList.toggle('is-refuse', !accepte);
    // Le premier reproche seulement : les corriger arrive un à un, et les
    // empiler décourage plus que ça n'aide.
    mdpVerdict.innerHTML = defauts.length
      ? `<strong>${escapeTexte(libelle)}</strong> — ${escapeTexte(defauts[0])}`
      : `<strong>${escapeTexte(libelle)}</strong>`;
  }

  function escapeTexte(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- Confirmation ---------- */
  const mdpChamp2   = document.getElementById('inviteFormPassword2');
  const mdpConfirme = document.getElementById('mdpConfirme');

  /* Rien n'est dit tant que la comparaison n'a pas de sens. Annoncer « ne
     correspond pas » au premier caractère retapé est agaçant et faux : la
     saisie n'est simplement pas finie. On attend donc que la confirmation
     ait rattrapé le mot de passe en longueur, sauf si elle est déjà juste —
     auquel cas on le dit tout de suite.
     Ce silence ne vaut que pour la frappe de la confirmation elle-même.
     Quand c'est le mot de passe qui change ensuite, la confirmation était
     finie : la voir devenir obsolète doit se signaler tout de suite, d'où
     `toujours`. */
  function rafraichirConfirmation(toujours = false) {
    if (!mdpChamp2) return;
    const mdp = mdpChamp.value;
    const copie = mdpChamp2.value;

    if (!copie) { mdpConfirme.hidden = true; return; }

    const identiques = copie === mdp;
    if (!identiques && !toujours && copie.length < mdp.length) {
      mdpConfirme.hidden = true;
      return;
    }

    mdpConfirme.hidden = false;
    mdpConfirme.classList.toggle('is-ok', identiques);
    mdpConfirme.classList.toggle('is-different', !identiques);
    mdpConfirme.textContent = identiques
      ? 'Les deux saisies correspondent.'
      : 'Les deux saisies diffèrent.';
  }

  if (mdpChamp) {
    mdpChamp.addEventListener('input', () => {
      rafraichirJauge();
      // Corriger le mot de passe après avoir confirmé doit relancer la
      // comparaison, sinon un « correspondent » périmé reste affiché.
      rafraichirConfirmation(true);
    });
    mdpChamp2?.addEventListener('input', () => rafraichirConfirmation());

    // Le nom et l'adresse entrent dans l'évaluation : les changer après coup
    // doit rejuger le mot de passe déjà saisi.
    ['inviteFormEmail', 'inviteFormPrenom', 'inviteFormNom'].forEach(id =>
      document.getElementById(id)?.addEventListener('input', () => {
        if (mdpChamp.value) rafraichirJauge();
      }));
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

    /* La confirmation se vérifie avant la solidité : se voir reprocher la
       composition d'un mot de passe qu'on a de toute façon mal recopié fait
       corriger la mauvaise chose. */
    if (password !== document.getElementById('inviteFormPassword2').value) {
      errEl.textContent = 'Les deux mots de passe saisis ne correspondent pas.';
      errEl.hidden = false;
      return;
    }

    /* Le mot de passe est rejugé au moment d'envoyer, et pas seulement à la
       frappe : le champ a pu être rempli par un gestionnaire de mots de
       passe, ou l'adresse changée après coup. */
    const verdict = evaluerMotDePasse(password, [email, prenom, nom]);
    if (!verdict.accepte) {
      errEl.textContent = verdict.defauts.length
        ? `Mot de passe refusé : ${verdict.defauts.join(', ')}.`
        : `Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE} caractères.`;
      errEl.hidden = false;
      return;
    }

    try {
      /* Le Worker fait tout d'un bloc : il relit l'invitation, crée le
         compte, écrit l'entrée `admins` et consomme le jeton. Le rôle qu'il
         renvoie vient de l'invitation, jamais de ce formulaire. */
      await creerAccesViaWorker({ prenom, nom, email, password });

      // Le jeton a servi : il quitte la barre d'adresse et la mémoire.
      history.replaceState({}, '', location.pathname);
      pendingInvite = null;

      /* Ouvrir la session, et rien de plus. C'est onAuthStateChanged qui
         décide de la suite : il relit l'accès, réclame le code envoyé par
         e-mail, et n'ouvre le panel qu'une fois ce code validé.
         Ce bloc ouvrait le panel lui-même, sautant la double
         authentification pour la seule connexion où le compte est encore
         inconnu de tous — précisément celle qu'il fallait vérifier. */
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      errEl.textContent = inviteErrorMessage(err);
      errEl.hidden = false;
      // Compte créé mais accès refusé : on ne laisse pas de session orpheline
      if (auth.currentUser) await signOut(auth);
    }
  });
}
