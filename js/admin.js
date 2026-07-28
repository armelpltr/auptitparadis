// ============================================================
// ADMIN.JS — logique du panneau d'administration
// Au P'tit Paradis
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ============================================================
   Bibliothèque d'icônes pour le bloc "Grille de cartes"
   (doit rester synchronisée avec js/site-data.js)
   ============================================================ */
const ICONS = {
  bread:    '<path d="M15,68 C15,55 28,46 40,50 C46,38 60,32 70,42 C82,38 92,48 88,60 C92,68 88,78 76,78 L24,78 C14,78 12,72 15,68 Z" /><path d="M28,50 L24,40 M45,46 L44,33 M64,44 L70,33" />',
  pastry:   '<path d="M50,12 C66,12 78,26 78,42 C78,50 72,56 65,58 C68,64 64,70 58,70 L42,70 C36,70 32,64 35,58 C28,56 22,50 22,42 C22,26 34,12 50,12 Z" /><path d="M50,12 C50,20 46,26 50,32 C54,26 50,20 50,12 Z" />',
  icecream: '<path d="M35,42 C35,26 65,26 65,42 L62,42 C66,48 64,56 58,58 L50,86 L42,58 C36,56 34,48 38,42 Z" /><path d="M30,38 C30,18 70,18 70,38" />',
  cake:     '<path d="M20,55 L80,55 L80,80 C80,86 74,90 68,90 L32,90 C26,90 20,86 20,80 Z" /><path d="M20,55 C20,45 30,45 30,55 C30,45 40,45 40,55 C40,45 50,45 50,55 C50,45 60,45 60,55 C60,45 70,45 70,55 C70,45 80,45 80,55" /><path d="M50,40 L50,28 M50,28 C46,28 46,22 50,22 C54,22 54,28 50,28 Z" />',
  gift:     '<rect x="22" y="42" width="56" height="44" rx="4" /><path d="M22,58 L78,58" /><path d="M50,42 L50,86" /><path d="M50,42 C40,30 28,32 30,44 C40,46 46,42 50,42 Z" /><path d="M50,42 C60,30 72,32 70,44 C60,46 54,42 50,42 Z" />',
  star:     '<path d="M50,16 L60,40 L86,42 L66,58 L72,84 L50,70 L28,84 L34,58 L14,42 L40,40 Z" />',
  snacking: '<g transform="scale(0.1953)" style="fill:var(--icon-ink);stroke:none"><path d="M441.6 47.65c-5.8 0-12.1.65-18.9 1.92c-20.9 3.87-46.1 13.56-73.2 27.53c-5.7 2.93-11.5 6.04-17.3 9.33c11.4 3.5 22.9 7.26 32.7 11.65c8.8 3.82 16.4 8.12 21.9 14.42c5.5 6.4 7.7 16.7 3.5 25.3c-2.8 5.7-7.4 7-11.4 8.1c-4.1 1-8.6 1.5-13.7 1.7c-10.3.5-23.3-.2-37.5-1.6c-23.2-2.2-49.6-6.2-71.3-10.5c-13.6 9.8-27.2 20.1-40.7 30.8c11.3 3.6 21.9 8.3 31.1 13.6c10.4 6 18.9 12.5 24.5 19.9c2.8 3.8 5 7.9 5.5 12.8c.5 5-1.4 10.6-5.1 14.3c-8.1 8.3-19.4 8.6-32.3 8.4c-12.8-.1-27.7-2.1-42.5-4.7c-16.5-3-32.3-6.6-44.7-9.8c-16.3 14.9-31.6 29.9-45.8 44.5c9.6 3.7 20 8.5 29.3 13.6c8 4.4 15.1 8.9 20.4 14c2.7 2.5 5 5.1 6.6 8.7s2 9-.4 13.2v.1c-2.7 4.5-6.5 6.2-10.2 7.6c-3.6 1.4-7.7 2.4-12.3 3.1c-9.2 1.5-20.2 2.2-31.8 2.4c-19.55.3-39.81-.9-53.58-3.1c-3.33 4.4-6.47 8.6-9.37 12.8c-14.01 20.1-22.6 37.6-24.54 48.7c-.97 5.6-.34 9.1.81 11.2c1.14 2.1 2.91 3.7 7.74 5c9.18 2.3 24.81.5 44.11-6.3s42.23-18 67.03-32.5c49.6-29 106.6-70.7 159.1-114.6s100.5-90 132.2-127.6c15.8-18.8 27.6-35.45 33.6-47.93c3-6.25 4.5-11.42 4.8-14.71c.2-2.78-.1-3.68-.7-4.36c-6.5-4.27-14.9-6.64-25.1-6.92h-2.5zM311.1 98.83c-11.2 6.87-22.6 14.27-34.1 22.07c17.1 3 35.8 5.6 52.5 7.2c13.7 1.3 26.1 1.9 34.9 1.5c4.4-.2 7.9-.6 9.8-1.1c.6-.2.5-.2.7-.3c.5-1.5.1-1.9-1.7-3.9c-2.3-2.7-8-6.4-15.6-9.8c-12.6-5.6-30.1-10.7-46.5-15.67m159.3 1.47c-6.8 10.1-15.3 21.2-25.2 32.9c-10.8 12.8-23.3 26.4-37.1 40.6c9.1.4 19.1-.4 29.3-2.9c18.2-4.5 33.5-13.3 43.1-23c9.5-9.8 13-19.7 10.9-28.2c-2-8.2-9.1-15.2-21-19.4m-272.1 80.2c-7 5.8-13.9 11.6-20.7 17.5c-3.1 2.7-6.2 5.4-9.3 8.2c9.8 2.3 20.8 4.7 31.8 6.7c14.2 2.5 28.4 4.3 39.6 4.4c11.1.2 18.8-2.7 19.2-3c-.1-.4-.5-1.7-2-3.7c-3-4.1-10-9.9-19.1-15c-11.1-6.4-25.4-12-39.5-15.1m193.6 9.4c-19.9 19.5-42 39.7-65.2 59.6c5.3.8 10.9 1.3 16.7 1.3c18.8 0 35.7-4.9 47.3-12.1s17.3-16 17.3-24.8c0-8.5-5.3-16.9-16.1-24m87.6.7c-2.5 2.5-5.1 5.1-8 7.5c-60.4 51.1-133.4 117.2-206.9 169.2c-72.4 51.3-145.3 89.7-209.52 84.4c6.98 5.1 14.36 8.2 21.77 10.1c18.94 5 38.55 1.5 49.75-1.7c80.8-23.3 166.8-80.4 233.1-134.6c33.1-27.1 61.3-53.4 81.5-74.3c10.1-10.4 18.2-19.4 23.9-26.4c5.7-6.9 8.9-13.2 8.7-12.3q3.45-11.7 5.7-21.9m-170.1 73.5c-22.9 19.2-46.6 37.9-70.3 55.4c5.4.7 11 1.1 16.8 1.1c20.2 0 38.4-4.7 50.8-11.7s18.3-15.4 18.3-23.2c0-7.2-5-14.9-15.6-21.6M92.8 279.7c-9.06 9.8-17.47 19.3-25.14 28.6c11.51 1.1 26.35 1.8 40.14 1.7c11-.2 21.4-.9 29.1-2.1c3-.5 5.2-1.2 7-1.7c-.1-.2 0-.1-.1-.2c-3.3-3.2-9.5-7.4-16.8-11.4c-10.7-5.9-23.9-11.5-34.2-14.9m120.7 58.2c-22 15.4-43.6 29.4-64.2 41.4c-6.3 3.7-12.4 7.1-18.5 10.4c8.1 1.8 17.1 2.8 26.4 2.8c20.2 0 38.4-4.7 50.8-11.7s18.3-15.4 18.3-23.2c0-6.5-4.2-13.5-12.8-19.7m-109.9 65.4c-8.54 3.9-16.71 7.3-24.48 10c-19.44 6.8-36.52 10.2-51.14 7.4c1 1 2.09 1.9 3.29 2.8c7.44 5.6 18.33 9.3 30.54 9.3s23.1-3.7 30.54-9.3c7.42-5.5 11.25-12.3 11.25-19.5z"/></g>'
};
const ICON_LABELS = {
  bread: 'Pain / Boulangerie', pastry: 'Pâtisserie', icecream: 'Glace',
  cake: 'Gâteau', gift: 'Cadeau', star: 'Étoile / Nouveauté',
  snacking: 'Snacking'
};
const BLOCK_LABELS = {
  banner: 'Bannière', cards: 'Grille de cartes', 'text-image': 'Texte + image', gallery: 'Galerie photo'
};

const DEFAULTS = {
  tagline: "Il y a des matins où l'odeur du pain chaud rivalise avec celle de la mer. Les nôtres, c'est tous les jours.",
  specialites: [
    { title: 'Boulangerie',        icon: 'bread',    text: "On se lève à 4h pour que vous ayez du pain chaud à 7h. Baguette de tradition, miche de campagne, pains aux céréales : chaque fournée est une promesse recommencée chaque matin." },
    { title: 'Pâtisserie',         icon: 'pastry',   text: "Pur beurre, sans compromis — c'est la règle depuis le premier jour. Croissants feuilletés, tartes de saison, entremets : le genre de choses qu'on mange lentement, parce qu'on sait que ça ne dure pas." },
    { title: 'Glaces artisanales', icon: 'icecream', text: "En juillet, la file d'attente commence à 10h. On ne s'en plaint pas. Glaces et sorbets faits maison, aux fruits de saison — le meilleur alibi pour rester cinq minutes de plus à Luc-sur-Mer." }
  ],
  histoire: {
    title: "On se lève avant vous. Depuis longtemps.",
    text1: "Au P'tit Paradis, les journées commencent dans le noir. Pendant que Luc-sur-Mer dort encore, notre équipe pétrit, façonne, enfourne. Pas parce qu'on y est obligés — parce qu'un pain fait à la main et cuit à l'heure, c'est une chose qui a encore du sens.",
    text2: "On accueille les habitués qui savent qu'on les reconnaît, et les vacanciers qui reviennent chaque été parce qu'ils n'ont pas trouvé mieux ailleurs. C'est peu, et c'est tout."
  }
};

/* ============================================================
   Références DOM
   ============================================================ */
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('adminStatus');
const inviteScreen = document.getElementById('inviteScreen');

/* Déclaré ici, et pas dans la section Équipe plus bas : onAuthStateChanged
   s'en sert, et une déclaration postérieure le mettrait en zone morte. */
const inviteParams = new URLSearchParams(location.search);
const pendingInvite = inviteParams.get('invite') && inviteParams.get('token')
  ? { email: inviteParams.get('invite').toLowerCase(), token: inviteParams.get('token') }
  : null;

/* Créer le compte connecte aussitôt la personne, donc onAuthStateChanged part
   vérifier son appartenance aux admins — alors que l'entrée n'est écrite que
   juste après. Ce drapeau met la vérification en pause le temps de l'écriture. */
let acceptingInvite = false;

/* ============================================================
   Modal de confirmation
   ============================================================ */
function confirm(title, sub) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'flex';
    document.querySelector('.confirm-actions--success').style.display = 'none';
    overlay.hidden = false;

    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');

    function close(result) {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk = () => close(true);
    const onCancel = () => close(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); }, { once: true });
  });
}

function showSuccess(title, sub = '') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'none';
    document.querySelector('.confirm-actions--success').style.display = 'flex';
    overlay.hidden = false;

    const closeBtn = document.getElementById('confirmClose');
    function close() {
      overlay.hidden = true;
      closeBtn.removeEventListener('click', close);
      resolve();
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
  });
}

/* ============================================================
   Authentification
   ============================================================ */
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

logoutBtn.addEventListener('click', () => signOut(auth));

/* Être connecté ne donne plus accès : il faut figurer dans `admins`.
   Les règles Firestore appliquent la même condition côté serveur — cette
   vérification-ci ne fait qu'éviter d'afficher un panel inutilisable. */
async function isCurrentUserAdmin(user) {
  try {
    return (await getDoc(doc(db, 'admins', user.uid))).exists();
  } catch {
    return false;   // règles refusant la lecture = pas admin
  }
}

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
  loadSettings();
  loadBlocks();
  loadTeam();
});

/* ============================================================
   ÉQUIPE — accès au panel, invitations
   ============================================================ */
const invitesCol = () => collection(db, 'invites');

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur' };
/* Le tout premier compte a été créé à la main dans la console, avant que les
   rôles n'existent : sans rôle inscrit, on le considère administrateur.
   Les règles Firestore appliquent le même défaut. */
const roleOf = r => r.role || 'admin';

let myRole = 'editor';

async function loadTeam() {
  const listEl = document.getElementById('adminsList');
  const invEl  = document.getElementById('invitesList');
  const me = auth.currentUser;

  try {
    const snap = await getDocs(collection(db, 'admins'));
    const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

    myRole = roleOf(rows.find(r => r.uid === me.uid) || {});
    const isOwner = myRole === 'admin';
    // Ne pas laisser retirer ou rétrograder le dernier administrateur :
    // plus personne ne pourrait gérer les accès.
    const ownerCount = rows.filter(r => roleOf(r) === 'admin').length;

    applyRoleToUI(isOwner);

    listEl.innerHTML = rows.map(r => {
      const role = roleOf(r);
      const isMe = r.uid === me.uid;
      const lastOwner = role === 'admin' && ownerCount === 1;
      return `
      <div class="team-row">
        <div class="team-info">
          <strong>${escapeAttr(r.email || '(sans e-mail)')}</strong>
        </div>
        <div class="team-actions">
          ${isOwner && !lastOwner
            ? `<select class="team-role" data-uid="${escapeAttr(r.uid)}" data-email="${escapeAttr(r.email || '')}">
                 <option value="editor" ${role === 'editor' ? 'selected' : ''}>Éditeur</option>
                 <option value="admin"  ${role === 'admin'  ? 'selected' : ''}>Administrateur</option>
               </select>`
            : `<span class="team-role-fixed">${ROLE_LABELS[role]}</span>`}
          ${isMe
            ? '<span class="team-you">compte actuel</span>'
            : isOwner && !lastOwner
              ? `<button type="button" class="btn btn-ghost btn-small team-revoke" data-uid="${escapeAttr(r.uid)}" data-email="${escapeAttr(r.email || '')}">Supprimer</button>`
              : ''}
        </div>
      </div>`;
    }).join('') || '<p class="admin-card-hint">Personne pour l\'instant.</p>';

    listEl.querySelectorAll('.team-revoke').forEach(btn => {
      btn.addEventListener('click', () => revokeAdmin(btn.dataset.uid, btn.dataset.email));
    });
    listEl.querySelectorAll('.team-role').forEach(sel => {
      sel.addEventListener('change', () => changeRole(sel, sel.dataset.email));
    });
  } catch (err) {
    listEl.innerHTML = `<p class="admin-card-hint">Liste illisible : ${escapeAttr(err.message)}</p>`;
  }

  try {
    const snap = await getDocs(invitesCol());
    invEl.innerHTML = snap.docs.map(d => `
      <div class="team-row">
        <div class="team-info">
          <strong>${escapeAttr(d.id)}</strong>
          <span>Invitée le ${escapeAttr(fmtDate(d.data().createdAt))}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-small invite-cancel" data-email="${escapeAttr(d.id)}">Annuler</button>
      </div>`).join('') || '<p class="admin-card-hint">Aucune invitation en attente.</p>';

    invEl.querySelectorAll('.invite-cancel').forEach(btn => {
      btn.addEventListener('click', () => cancelInvite(btn.dataset.email));
    });
  } catch (err) {
    invEl.innerHTML = `<p class="admin-card-hint">Invitations illisibles : ${escapeAttr(err.message)}</p>`;
  }
}

/* Un éditeur garde l'onglet Équipe pour voir qui a accès, mais rien pour agir :
   les règles refuseraient de toute façon, autant ne pas afficher les boutons. */
function applyRoleToUI(isOwner) {
  document.getElementById('teamInviteCard').hidden = !isOwner;
  document.getElementById('teamInvitesCard').hidden = !isOwner;
}

async function changeRole(select, email) {
  const role = select.value;
  const label = role === 'admin' ? 'administrateur' : 'éditeur';
  const ok = await confirm(`Passer ${email} en ${label} ?`,
    role === 'admin'
      ? 'Cette personne pourra aussi inviter et révoquer des accès.'
      : "Cette personne pourra toujours modifier le contenu, mais plus gérer les accès.");
  if (!ok) { loadTeam(); return; }   // annulation : on remet le select à l'état réel

  try {
    await updateDoc(doc(db, 'admins', select.dataset.uid), { role });
    showStatus('Rôle mis à jour.');
  } catch (err) {
    showStatus('Changement de rôle refusé : ' + err.message, true);
  }
  loadTeam();
}

/* Supprimer le compte de quelqu'un d'autre demande les droits admin, que le SDK
   navigateur n'a pas. Le Worker les détient et refait toutes les vérifications
   côté serveur : le client peut mentir. */
const WORKER_URL = 'https://auptitparadis-worker.armelpltr.workers.dev';

async function revokeAdmin(uid, email) {
  const ok = await confirm(`Supprimer le compte de ${email} ?`,
    'Son accès et son compte seront supprimés définitivement. Cette action est irréversible.');
  if (!ok) return;

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/delete-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);

    showStatus('Compte supprimé.');
  } catch (err) {
    showStatus('Suppression impossible : ' + err.message, true);
  }
  loadTeam();
}

async function cancelInvite(email) {
  const ok = await confirm(`Annuler l'invitation de ${email} ?`, 'Le lien déjà transmis cessera de fonctionner.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'invites', email));
    showStatus('Invitation annulée.');
    loadTeam();
  } catch (err) {
    showStatus("Impossible d'annuler : " + err.message, true);
  }
}

document.getElementById('inviteBtn').addEventListener('click', async () => {
  const email = val('inviteEmail').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showStatus('Adresse e-mail invalide.', true);
    return;
  }

  const token = crypto.randomUUID();
  const btn = document.getElementById('inviteBtn');
  btn.disabled = true;
  try {
    // Le rôle est fixé ici, pas au moment où l'invité crée son compte : les
    // règles vérifient que celui qu'il se donne correspond à l'invitation.
    await setDoc(doc(db, 'invites', email), {
      token,
      role: val('inviteRole') || 'editor',
      createdAt: new Date(),
      createdBy: auth.currentUser.email
    });

    const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(email)}&token=${token}`;
    document.getElementById('inviteLink').value = link;
    document.getElementById('inviteResult').hidden = false;
    setVal('inviteEmail', '');
    loadTeam();
  } catch (err) {
    showStatus("Création de l'invitation impossible : " + err.message, true);
  }
  btn.disabled = false;
});

document.getElementById('copyInviteBtn').addEventListener('click', async () => {
  const input = document.getElementById('inviteLink');
  try {
    await navigator.clipboard.writeText(input.value);
    showStatus('Lien copié.');
  } catch {
    input.select();   // clipboard refusé : au moins le lien est sélectionné
    showStatus('Copie automatique refusée par le navigateur — faites Ctrl+C.', true);
  }
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
    loadSettings();
    loadBlocks();
    loadTeam();
  } catch (err) {
    acceptingInvite = false;
    errEl.textContent = inviteErrorMessage(err);
    errEl.hidden = false;
    // Compte créé mais accès refusé : on ne laisse pas de session orpheline
    if (auth.currentUser) await signOut(auth);
  }
});

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

/* ============================================================
   Message de statut
   ============================================================ */
let statusTimer = null;
function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = 'admin-status' + (isError ? ' is-error' : '');
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.hidden = true; }, 4000);
}

/* ============================================================
   Onglets
   ============================================================ */
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('is-active');
  });
});

/* ============================================================
   ONGLET RÉGLAGES
   ============================================================ */

function addHourRowEl(day = '', hours = '') {
  const container = document.getElementById('hoursRowsContainer');
  const row = document.createElement('div');
  row.className = 'hour-row';
  row.innerHTML = `
    <input type="text" class="hour-day" placeholder="Jour (ex. Lundi)" value="${escapeAttr(day)}">
    <input type="text" class="hour-hours" placeholder="Horaires (ex. Fermé)" value="${escapeAttr(hours)}">
    <button type="button" class="row-remove" title="Supprimer cette ligne"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
  `;
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

const SVG_X = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';

/* ============================================================
   Import de photos (Cloudinary)
   ============================================================ */
/* Cloudinary — hébergement des photos.
   Ces deux valeurs sont publiques par nature : le cloud name apparaît dans
   chaque URL d'image, et le preset est "unsigned" (envoi sans signature).
   Aucun secret ici — l'API Secret du compte ne doit jamais arriver dans ce
   fichier, qui est téléchargé par tous les visiteurs du site. */
const CLOUDINARY_CLOUD_NAME = 'erbyexpc';
const CLOUDINARY_PRESET     = 'auptitparadis';
const CLOUDINARY_ENDPOINT   = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // doit rester aligné sur le preset Cloudinary
const RING_LENGTH = 339.292;              // 2πr avec r=54, cf. .upload-ring-fill

/* ---------- Popup de progression ---------- */
const uploadUI = {
  overlay:  document.getElementById('uploadOverlay'),
  modal:    document.querySelector('.upload-modal'),
  thumb:    document.getElementById('uploadThumb'),
  ring:     document.getElementById('uploadRing'),
  percent:  document.getElementById('uploadPercent'),
  check:    document.getElementById('uploadCheck'),
  cross:    document.getElementById('uploadCross'),
  title:    document.getElementById('uploadTitle'),
  sub:      document.getElementById('uploadSub'),
  actions:  document.getElementById('uploadActions'),
  closeBtn: document.getElementById('uploadCloseBtn')
};

function setUploadProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  uploadUI.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - clamped / 100));
  uploadUI.percent.firstChild.nodeValue = String(clamped);
}

let uploadCloseTimer = null;

function openUploadModal(file) {
  clearTimeout(uploadCloseTimer); // un import relancé ne doit pas hériter du timer précédent
  uploadUI.modal.classList.remove('is-error');
  uploadUI.check.hidden = true;
  uploadUI.cross.hidden = true;
  uploadUI.percent.hidden = false;
  uploadUI.actions.hidden = true;
  uploadUI.title.textContent = 'Import de la photo';
  uploadUI.sub.textContent = file.name;
  uploadUI.ring.style.strokeDashoffset = String(RING_LENGTH);
  setUploadProgress(0);

  // Aperçu local immédiat, sans attendre la fin de l'envoi
  if (uploadUI.thumb.dataset.blob) URL.revokeObjectURL(uploadUI.thumb.dataset.blob);
  const blobUrl = URL.createObjectURL(file);
  uploadUI.thumb.dataset.blob = blobUrl;
  uploadUI.thumb.src = blobUrl;

  uploadUI.overlay.hidden = false;
}

function finishUploadModal({ ok, title, sub }) {
  uploadUI.percent.hidden = true;
  uploadUI.modal.classList.toggle('is-error', !ok);
  uploadUI.check.hidden = !ok;
  uploadUI.cross.hidden = ok;
  if (ok) setUploadProgress(100);
  uploadUI.title.textContent = title;
  uploadUI.sub.textContent = sub;

  if (ok) {
    uploadCloseTimer = setTimeout(closeUploadModal, 900); // succès : se referme tout seul
  } else {
    uploadUI.actions.hidden = false;   // erreur : l'utilisateur doit la lire
    uploadUI.closeBtn.focus();
  }
}

function closeUploadModal() {
  clearTimeout(uploadCloseTimer);
  uploadUI.overlay.hidden = true;
  if (uploadUI.thumb.dataset.blob) {
    URL.revokeObjectURL(uploadUI.thumb.dataset.blob);
    delete uploadUI.thumb.dataset.blob;
  }
  uploadUI.thumb.removeAttribute('src');
}

uploadUI.closeBtn.addEventListener('click', closeUploadModal);

/* ---------- Envoi vers Cloudinary ---------- */
/* XMLHttpRequest plutôt que fetch : c'est le seul moyen d'avoir la
   progression d'un envoi, fetch ne l'expose pas. */
function uploadImageFile(file, folder) {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error("Ce fichier n'est pas une image."));
  if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new Error('Photo trop lourde — 8 Mo maximum.'));

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_PRESET);
  form.append('folder', `auptitparadis/${folder}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CLOUDINARY_ENDPOINT);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress((e.loaded / e.total) * 100);
    });

    xhr.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* réponse illisible */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) resolve(body.secure_url);
      else reject(new Error(cloudinaryError(xhr.status, body)));
    });

    xhr.addEventListener('error', () => reject(new Error('Connexion impossible à Cloudinary. Vérifie ta connexion internet.')));
    xhr.addEventListener('abort', () => reject(new Error("L'import a été annulé.")));

    xhr.send(form);
  });
}

function cloudinaryError(statusCode, body) {
  const raw = body && body.error && body.error.message ? body.error.message : '';
  if (/upload preset not found/i.test(raw)) {
    return `Le preset « ${CLOUDINARY_PRESET} » est introuvable. Vérifie son nom exact dans Cloudinary (Settings > Upload).`;
  }
  if (/unsigned|whitelist/i.test(raw)) {
    return `Le preset « ${CLOUDINARY_PRESET} » n'est pas en mode Unsigned, ou les envois non signés sont bloqués (Settings > Security).`;
  }
  if (/file size|too large/i.test(raw)) return 'Photo refusée par Cloudinary : fichier trop lourd.';
  if (/format/i.test(raw)) return 'Format refusé par Cloudinary. Utilise un JPG, PNG ou WebP.';
  return raw || `Cloudinary a renvoyé une erreur (code ${statusCode}).`;
}

function uploadErrorMessage(err) {
  return err.message || "L'import a échoué.";
}

/**
 * Bloc "Importer une photo" qui remplace un ancien champ URL.
 * L'URL finale reste dans un <input type="hidden"> qui garde l'id/la classe
 * d'origine, pour que le code de collecte existant continue de marcher.
 */
function createImageUploader({ id = '', className = '', value = '', folder = 'images', compact = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'image-upload' + (compact ? ' image-upload--compact' : '');

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  if (id) hidden.id = id;
  if (className) hidden.className = className;
  hidden.value = value || '';

  const preview = document.createElement('img');
  preview.className = 'image-upload-preview';
  preview.alt = '';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn btn-ghost btn-small';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'row-remove';
  clearBtn.title = 'Retirer la photo';
  clearBtn.innerHTML = SVG_X;

  function refresh() {
    const url = hidden.value.trim();
    if (url) preview.src = url; else preview.removeAttribute('src');
    pickBtn.textContent = url ? 'Changer la photo' : 'Importer une photo';
    clearBtn.hidden = !url;
  }

  pickBtn.addEventListener('click', () => fileInput.click());

  clearBtn.addEventListener('click', () => {
    hidden.value = '';
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // permet de re-choisir le même fichier ensuite
    if (!file) return;
    pickBtn.disabled = true;
    openUploadModal(file);
    try {
      hidden.value = await uploadImageFile(file, folder);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      finishUploadModal({ ok: true, title: 'Photo importée', sub: 'Elle est prête à être enregistrée.' });
    } catch (err) {
      finishUploadModal({ ok: false, title: "L'import a échoué", sub: uploadErrorMessage(err) });
    }
    pickBtn.disabled = false;
  });

  // setVal() émet un 'input' : l'aperçu se met à jour au chargement des réglages
  hidden.addEventListener('input', refresh);

  wrap.append(preview, pickBtn, clearBtn, hidden, fileInput);
  refresh();
  return wrap;
}

function addProduitRowForIndex(i, nom = '', description = '', imageUrl = '', tag = '') {
  const list = document.getElementById(`spec-produits-${i}`);
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'produit-row';
  row.innerHTML = `
    <input type="text" class="produit-nom" placeholder="Nom du produit" value="${escapeAttr(nom)}">
    <textarea class="produit-desc" rows="3" placeholder="Description courte">${escapeAttr(description)}</textarea>
    <select class="produit-tag">
      <option value="">— Pas de tag —</option>
      <option value="top-vente" ${tag === 'top-vente' ? 'selected' : ''}>Top vente</option>
      <option value="selection" ${tag === 'selection' ? 'selected' : ''}>Sélection du moment</option>
      <option value="nouveaute" ${tag === 'nouveaute' ? 'selected' : ''}>Nouveauté</option>
    </select>
    <button type="button" class="row-remove" title="Supprimer">${SVG_X}</button>
  `;
  row.insertBefore(
    createImageUploader({ className: 'produit-img', value: imageUrl, folder: 'produits', compact: true }),
    row.querySelector('.produit-tag')
  );
  // :scope > pour ne pas attraper le bouton "retirer la photo" de l'uploader
  row.querySelector(':scope > .row-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectSpecProduitsForIndex(i) {
  return Array.from(document.querySelectorAll(`#spec-produits-${i} .produit-row`)).map(row => ({
    nom: row.querySelector('.produit-nom').value.trim(),
    description: row.querySelector('.produit-desc').value.trim(),
    imageUrl: row.querySelector('.produit-img').value.trim(),
    tag: row.querySelector('.produit-tag').value
  })).filter(p => p.nom);
}

let specState = [];

function syncSpecStateFromDOM() {
  document.querySelectorAll('#specList .spec-edit').forEach((el, i) => {
    specState[i] = {
      title: el.querySelector('.spec-title').value.trim(),
      text:  el.querySelector('.spec-text').value.trim(),
      icon:  el.querySelector('.spec-icon').value,
      produits: collectSpecProduitsForIndex(i)
    };
  });
}

function renderSpecList() {
  const container = document.getElementById('specList');
  if (!container) return;
  container.innerHTML = specState.map((item, i) => `
    <div class="spec-edit" data-index="${i}">
      <div class="spec-edit-header">
        <h3>Fiche ${i + 1}${item.title ? ' — ' + escapeAttr(item.title) : ''}</h3>
        ${specState.length > 1 ? `<button type="button" class="row-remove" data-remove="${i}" title="Supprimer cette fiche">${SVG_X}</button>` : ''}
      </div>
      <div class="form-row">
        <label>Icône</label>
        <select class="spec-icon">
          ${Object.keys(ICONS).map(k => `<option value="${k}" ${(item.icon || 'bread') === k ? 'selected' : ''}>${ICON_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Titre</label><input type="text" class="spec-title" placeholder="ex. Boulangerie" value="${escapeAttr(item.title || '')}"></div>
      <div class="form-row"><label>Texte</label><textarea class="spec-text" rows="3">${escapeAttr(item.text || '')}</textarea></div>
      <div class="form-row">
        <label>Produits vedettes</label>
        <div class="produits-list" id="spec-produits-${i}"></div>
        <button type="button" class="btn btn-ghost btn-small add-spec-produit" data-index="${i}">+ Ajouter un produit</button>
      </div>
    </div>
  `).join('');

  specState.forEach((item, i) => {
    (item.produits || []).forEach(p => addProduitRowForIndex(i, p.nom, p.description, p.imageUrl, p.tag));
  });

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncSpecStateFromDOM();
      specState.splice(Number(btn.dataset.remove), 1);
      renderSpecList();
    });
  });

  container.querySelectorAll('.add-spec-produit').forEach(btn => {
    btn.addEventListener('click', () => addProduitRowForIndex(Number(btn.dataset.index)));
  });
}

// Monté tout de suite : loadSettings() appelle setVal('set-histoire-imageUrl', …)
document.getElementById('histoireImageMount').appendChild(
  createImageUploader({ id: 'set-histoire-imageUrl', folder: 'histoire' })
);

document.getElementById('addSpecBtn').addEventListener('click', () => {
  syncSpecStateFromDOM();
  specState.push({ title: '', text: '', icon: 'bread', produits: [] });
  renderSpecList();
});

document.getElementById('addHourRow').addEventListener('click', () => addHourRowEl());

function collectHourRows() {
  return Array.from(document.querySelectorAll('.hour-row')).map(row => ({
    day: row.querySelector('.hour-day').value.trim(),
    hours: row.querySelector('.hour-hours').value.trim()
  })).filter(r => r.day || r.hours);
}


async function loadSettings() {
  setVal('set-tagline', DEFAULTS.tagline);
  setVal('set-histoire-title', DEFAULTS.histoire.title);
  setVal('set-histoire-text1', DEFAULTS.histoire.text1);
  setVal('set-histoire-text2', DEFAULTS.histoire.text2);

  specState = DEFAULTS.specialites.map(s => ({ ...s, produits: [] }));

  const container = document.getElementById('hoursRowsContainer');
  container.innerHTML = '';
  [
    { day: 'Lundi', hours: 'Fermé' },
    { day: 'Mardi — Vendredi', hours: '7h00 – 13h30 · 15h30 – 19h30' },
    { day: 'Samedi', hours: '7h00 – 19h30' },
    { day: 'Dimanche', hours: '7h00 – 13h30' }
  ].forEach(r => addHourRowEl(r.day, r.hours));

  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    if (!snap.exists()) { renderSpecList(); return; }
    const s = snap.data();

    if (s.tagline) setVal('set-tagline', s.tagline);

    if (Array.isArray(s.specialites) && s.specialites.length) {
      specState = s.specialites.map(item => ({
        title:    item.title    || '',
        text:     item.text     || '',
        icon:     item.icon     || 'bread',
        produits: Array.isArray(item.produits) ? item.produits : []
      }));
    }

    if (s.histoire) {
      if (s.histoire.title)    setVal('set-histoire-title',    s.histoire.title);
      if (s.histoire.text1)    setVal('set-histoire-text1',    s.histoire.text1);
      if (s.histoire.text2)    setVal('set-histoire-text2',    s.histoire.text2);
      if (s.histoire.imageUrl) setVal('set-histoire-imageUrl', s.histoire.imageUrl);
    }

    if (s.horaires && s.horaires.rows && s.horaires.rows.length) {
      container.innerHTML = '';
      s.horaires.rows.forEach(r => addHourRowEl(r.day, r.hours));
    }

    if (s.horaires) {
      setVal('set-address1',    s.horaires.address1);
      setVal('set-address2',    s.horaires.address2);
      setVal('set-phone',       s.horaires.phone);
      setVal('set-phoneDisplay',s.horaires.phoneDisplay);
      setVal('set-email',       s.horaires.email);
      setVal('set-instagram',   s.horaires.instagram);
      setVal('set-facebook',    s.horaires.facebook);
      setVal('set-mapUrl',      s.horaires.mapUrl);
    }
  } catch (err) {
    showStatus('Impossible de charger les réglages existants (' + err.message + ')', true);
  }

  renderSpecList();
  // Les champs sont remplis : les saisies suivantes viennent de l'utilisateur
  suppressDirty = false;
  setDirty(false);
}

/* Chaque carte des réglages s'enregistre séparément. L'écriture se fait en
   merge : une carte ne touche que ses propres champs et laisse le reste du
   document intact — deux parties peuvent donc être modifiées sans risque de
   s'écraser l'une l'autre. "Horaires" et "Adresse & contact" écrivent dans la
   même map `horaires`, le merge de Firestore est profond sur les maps. */
const SETTINGS_SECTIONS = {
  tagline: {
    label: "l'accroche",
    collect: () => ({ tagline: val('set-tagline') })
  },
  specialites: {
    label: 'les spécialités',
    // Firestore ne sait pas fusionner un seul élément d'un tableau : le bouton
    // d'une fiche réécrit forcément les trois. Autant le dire.
    hint: 'Toutes les fiches de spécialités sont enregistrées ensemble.',
    collect: () => ({
      specialites: Array.from(document.querySelectorAll('#specList .spec-edit')).map((el, i) => ({
        title:    el.querySelector('.spec-title').value.trim(),
        text:     el.querySelector('.spec-text').value.trim(),
        icon:     el.querySelector('.spec-icon').value,
        produits: collectSpecProduitsForIndex(i)
      }))
    })
  },
  histoire: {
    label: '« Notre histoire »',
    collect: () => ({
      histoire: {
        title: val('set-histoire-title'),
        text1: val('set-histoire-text1'),
        text2: val('set-histoire-text2'),
        imageUrl: val('set-histoire-imageUrl')
      }
    })
  },
  horaires: {
    label: 'les horaires',
    collect: () => ({ horaires: { rows: collectHourRows() } })
  },
  contact: {
    label: "l'adresse et les contacts",
    collect: () => ({
      horaires: {
        address1: val('set-address1'),
        address2: val('set-address2'),
        phone: val('set-phone'),
        phoneDisplay: val('set-phoneDisplay'),
        email: val('set-email'),
        instagram: val('set-instagram'),
        facebook: val('set-facebook'),
        mapUrl: val('set-mapUrl')
      }
    })
  }
};

/* ---------- Suivi des modifications non enregistrées ---------- */
const saveBar    = document.getElementById('saveBar');
const saveBarMsg = document.getElementById('saveBarStatus');
const saveBtn    = document.getElementById('saveSettingsBtn');

let isDirty = false;
/* loadSettings() remplit les champs par programme et setVal() émet un 'input' :
   sans ce verrou, la page s'annoncerait modifiée dès son chargement. */
let suppressDirty = true;

function setDirty(dirty) {
  isDirty = dirty;
  saveBar.classList.toggle('is-dirty', dirty);
  saveBarMsg.textContent = dirty
    ? 'Modifications non enregistrées'
    : 'Tout est enregistré';
}

function markDirty() {
  if (suppressDirty || isDirty) return;
  setDirty(true);
}

// Capture : attrape aussi les champs créés après coup (fiches, produits, uploads)
document.getElementById('panel-settings').addEventListener('input', markDirty, true);
document.getElementById('panel-settings').addEventListener('change', markDirty, true);
document.getElementById('panel-settings').addEventListener('click', (e) => {
  // Ajout/suppression de fiche, de produit ou de ligne d'horaire
  if (e.target.closest('#addSpecBtn, #addHourRow, .add-spec-produit, .row-remove')) markDirty();
});

// Dernier filet si l'onglet est fermé ou la page rechargée
window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ---------- Enregistrement ---------- */
saveBtn.addEventListener('click', async () => {
  const ok = await confirm('Enregistrer les réglages ?', 'Les modifications seront appliquées sur le site immédiatement.');
  if (!ok) return;

  const data = Object.values(SETTINGS_SECTIONS)
    .reduce((acc, section) => deepMerge(acc, section.collect()), {});

  const original = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Enregistrement…';
  try {
    await setDoc(doc(db, 'settings', 'site'), data, { merge: true });
    setDirty(false);
    await showSuccess('Réglages enregistrés ✓', 'Les modifications sont en ligne.');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = original;
  }
});

/* "Horaires" et "Adresse & contact" écrivent tous deux dans la map `horaires` :
   un Object.assign écraserait la première par la seconde. */
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/* ============================================================
   ONGLET SECTIONS
   ============================================================ */
let blocksCache = [];
let editingBlockId = null;
let editingBlockType = null;
let cardItemsState = [];
let galleryImagesState = [];

async function loadBlocks() {
  try {
    const snap = await getDocs(query(collection(db, 'blocks'), orderBy('order', 'asc')));
    blocksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBlocksList();
  } catch (err) {
    document.getElementById('blocksList').innerHTML =
      `<p class="empty-hint">Impossible de charger les sections (${err.message}).</p>`;
  }
}

function blockPreviewTitle(b) {
  if (b.type === 'banner') return b.text || '(sans texte)';
  return b.title || '(sans titre)';
}

const _ibSvg = (inner) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const IB_ICONS = {
  up:     _ibSvg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down:   _ibSvg('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  eye:    _ibSvg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: _ibSvg('<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.16 2.96M6.6 6.6A13 13 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.5-1.2M3 3l18 18"/>'),
  edit:   _ibSvg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  trash:  _ibSvg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>')
};

function renderBlocksList() {
  const list = document.getElementById('blocksList');
  if (!blocksCache.length) {
    list.innerHTML = '<p class="empty-hint">Aucune section pour le moment. Clique sur "+ Ajouter une section" pour commencer.</p>';
    return;
  }
  list.innerHTML = blocksCache.map((b, i) => `
    <div class="block-row ${b.visible ? '' : 'is-hidden'}" data-id="${b.id}">
      <span class="block-type-tag">${BLOCK_LABELS[b.type] || b.type}</span>
      <span class="block-row-title">${escapeAttr(blockPreviewTitle(b))}</span>
      <div class="block-row-actions">
        <button class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} title="Monter">${IB_ICONS.up}</button>
        <button class="icon-btn" data-action="down" ${i === blocksCache.length - 1 ? 'disabled' : ''} title="Descendre">${IB_ICONS.down}</button>
        <button class="icon-btn" data-action="toggle" title="${b.visible ? 'Masquer' : 'Afficher'}">${b.visible ? IB_ICONS.eye : IB_ICONS.eyeOff}</button>
        <button class="icon-btn" data-action="edit" title="Modifier">${IB_ICONS.edit}</button>
        <button class="icon-btn" data-action="delete" title="Supprimer">${IB_ICONS.trash}</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.block-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="up"]').addEventListener('click', () => moveBlock(id, -1));
    row.querySelector('[data-action="down"]').addEventListener('click', () => moveBlock(id, 1));
    row.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleVisible(id));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openBlockEditor(id));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteBlock(id));
  });
}

async function moveBlock(id, direction) {
  const index = blocksCache.findIndex(b => b.id === id);
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= blocksCache.length) return;

  const a = blocksCache[index];
  const b = blocksCache[swapIndex];
  const tempOrder = a.order;
  a.order = b.order;
  b.order = tempOrder;

  try {
    await updateDoc(doc(db, 'blocks', a.id), { order: a.order });
    await updateDoc(doc(db, 'blocks', b.id), { order: b.order });
    await loadBlocks();
  } catch (err) {
    showStatus('Erreur lors du déplacement : ' + err.message, true);
  }
}

async function toggleVisible(id) {
  const b = blocksCache.find(x => x.id === id);
  try {
    await updateDoc(doc(db, 'blocks', id), { visible: !b.visible });
    await loadBlocks();
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

async function deleteBlock(id) {
  const ok = await confirm('Retirer cette section ?', 'Elle sera supprimée du site immédiatement. Action irréversible.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'blocks', id));
    await loadBlocks();
    showSuccess('Section retirée', 'Elle n\'apparaît plus sur le site.');
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

/* ---------- Sélecteur de modèle ---------- */
const templatePicker = document.getElementById('templatePicker');
const blockEditor = document.getElementById('blockEditor');

document.getElementById('addBlockBtn').addEventListener('click', () => { templatePicker.hidden = false; });
document.getElementById('cancelTemplatePicker').addEventListener('click', () => { templatePicker.hidden = true; });
document.getElementById('cancelBlockEditor').addEventListener('click', () => { blockEditor.hidden = true; });

document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', () => {
    templatePicker.hidden = true;
    openBlockEditor(null, card.dataset.type);
  });
});

/* ---------- Construction du formulaire d'édition selon le type ---------- */
function openBlockEditor(id, forcedType = null) {
  const fieldsContainer = document.getElementById('blockEditorFields');
  const titleEl = document.getElementById('blockEditorTitle');

  let data = {};
  if (id) {
    data = blocksCache.find(b => b.id === id) || {};
    editingBlockId = id;
    editingBlockType = data.type;
  } else {
    editingBlockId = null;
    editingBlockType = forcedType;
    data = {};
  }

  titleEl.textContent = id ? 'Modifier la section' : `Ajouter — ${BLOCK_LABELS[editingBlockType]}`;
  cardItemsState = (data.items || []).map(i => ({ ...i }));
  galleryImagesState = [...(data.images || [])];

  fieldsContainer.innerHTML = buildFieldsHTML(editingBlockType, data);
  wireFieldEvents(editingBlockType);

  blockEditor.hidden = false;
}

function buildFieldsHTML(type, data) {
  if (type === 'banner') {
    return `
      <div class="form-row"><label>Texte de l'annonce</label><textarea id="f-text" rows="2">${escapeAttr(data.text)}</textarea></div>
      <div class="form-row-grid">
        <div class="form-row"><label>Texte du bouton (optionnel)</label><input type="text" id="f-linkText" value="${escapeAttr(data.linkText)}"></div>
        <div class="form-row"><label>Lien du bouton (optionnel)</label><input type="text" id="f-linkUrl" value="${escapeAttr(data.linkUrl)}"></div>
      </div>
      <div class="form-row">
        <label>Style</label>
        <select id="f-style">
          <option value="info" ${data.style !== 'highlight' ? 'selected' : ''}>Discret</option>
          <option value="highlight" ${data.style === 'highlight' ? 'selected' : ''}>Mise en avant (fond doré)</option>
        </select>
      </div>`;
  }

  if (type === 'cards') {
    return `
      <div class="form-row"><label>Eyebrow (petit texte au-dessus, optionnel)</label><input type="text" id="f-eyebrow" value="${escapeAttr(data.eyebrow)}"></div>
      <div class="form-row"><label>Titre de la section</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div id="cardItemsContainer"></div>
      <button type="button" class="btn btn-ghost btn-small" id="addCardItem">+ Ajouter une carte</button>`;
  }

  if (type === 'text-image') {
    return `
      <div class="form-row"><label>Titre</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div class="form-row"><label>Texte</label><textarea id="f-text" rows="4">${escapeAttr(data.text)}</textarea></div>
      <div class="form-row">
        <label>Photo</label>
        <div id="imageUrlMount" data-value="${escapeAttr(data.imageUrl || '')}"></div>
      </div>
      <div class="form-row">
        <label>Position de l'image</label>
        <select id="f-imagePosition">
          <option value="left" ${data.imagePosition !== 'right' ? 'selected' : ''}>Gauche</option>
          <option value="right" ${data.imagePosition === 'right' ? 'selected' : ''}>Droite</option>
        </select>
      </div>`;
  }

  if (type === 'gallery') {
    return `
      <div class="form-row"><label>Titre</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div class="form-row">
        <label>Photos</label>
        <div id="galleryThumbs"></div>
        <button type="button" class="btn btn-ghost btn-small" id="addGalleryUrl">+ Ajouter une photo</button>
      </div>`;
  }

  return '';
}

function wireFieldEvents(type) {
  if (type === 'text-image') {
    const mount = document.getElementById('imageUrlMount');
    mount.appendChild(createImageUploader({
      id: 'f-imageUrl', value: mount.dataset.value, folder: 'sections'
    }));
  }

  if (type === 'cards') {
    renderCardItems();
    document.getElementById('addCardItem').addEventListener('click', () => {
      if (cardItemsState.length >= 6) return;
      cardItemsState.push({ icon: 'bread', title: '', text: '' });
      renderCardItems();
    });
  }

  if (type === 'gallery') {
    renderGalleryThumbs();
    document.getElementById('addGalleryUrl').addEventListener('click', () => {
      galleryImagesState.push('');
      renderGalleryThumbs();
    });
  }
}

function renderCardItems() {
  const container = document.getElementById('cardItemsContainer');
  container.innerHTML = cardItemsState.map((item, i) => `
    <div class="card-item-edit" data-index="${i}">
      <button type="button" class="row-remove" data-remove="${i}" title="Supprimer cette carte"<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
      <div class="form-row">
        <label>Icône</label>
        <select data-field="icon" data-index="${i}">
          ${Object.keys(ICONS).map(k => `<option value="${k}" ${item.icon === k ? 'selected' : ''}>${ICON_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Titre</label><input type="text" data-field="title" data-index="${i}" value="${escapeAttr(item.title)}"></div>
      <div class="form-row"><label>Texte</label><textarea data-field="text" data-index="${i}" rows="2">${escapeAttr(item.text)}</textarea></div>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      cardItemsState.splice(Number(btn.dataset.remove), 1);
      renderCardItems();
    });
  });
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      cardItemsState[Number(input.dataset.index)][input.dataset.field] = input.value;
    });
  });
}

function renderGalleryThumbs() {
  const container = document.getElementById('galleryThumbs');
  container.innerHTML = '';

  galleryImagesState.forEach((url, i) => {
    const row = document.createElement('div');
    row.className = 'gallery-row';

    const uploader = createImageUploader({ value: url, folder: 'galerie' });
    const hidden = uploader.querySelector('input[type="hidden"]');
    hidden.addEventListener('input', () => { galleryImagesState[i] = hidden.value.trim(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove';
    removeBtn.title = 'Retirer cette photo';
    removeBtn.innerHTML = SVG_X;
    removeBtn.addEventListener('click', () => {
      galleryImagesState.splice(i, 1);
      renderGalleryThumbs();
    });

    row.append(uploader, removeBtn);
    container.appendChild(row);
  });
}

/* ---------- Enregistrement du bloc ---------- */
document.getElementById('saveBlockBtn').addEventListener('click', async () => {
  const ok = await confirm('Enregistrer cette section ?', 'Les modifications seront appliquées sur le site immédiatement.');
  if (!ok) return;
  const type = editingBlockType;
  let data = { type };

  if (type === 'banner') {
    data = { ...data, text: val('f-text'), linkText: val('f-linkText'), linkUrl: val('f-linkUrl'), style: val('f-style') };
  } else if (type === 'cards') {
    data = { ...data, title: val('f-title'), eyebrow: val('f-eyebrow'), items: cardItemsState };
  } else if (type === 'text-image') {
    data = {
      ...data, title: val('f-title'), text: val('f-text'),
      imageUrl: val('f-imageUrl'),
      imagePosition: val('f-imagePosition')
    };
  } else if (type === 'gallery') {
    data = { ...data, title: val('f-title'), images: galleryImagesState.filter(Boolean) };
  }

  try {
    if (editingBlockId) {
      await updateDoc(doc(db, 'blocks', editingBlockId), data);
    } else {
      const maxOrder = blocksCache.reduce((max, b) => Math.max(max, b.order || 0), 0);
      await addDoc(collection(db, 'blocks'), { ...data, order: maxOrder + 1, visible: true });
    }
    blockEditor.hidden = true;
    await loadBlocks();
    showSuccess('Section enregistrée ✓', 'Les modifications sont en ligne.');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
});

/* ============================================================
   Petits utilitaires
   ============================================================ */
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, value) {
  const el = document.getElementById(id);
  if (!el || value === undefined) return;
  el.value = value;
  // les uploaders écoutent 'input' pour rafraîchir leur aperçu
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function escapeAttr(str) { return String(str ?? '').replace(/"/g, '&quot;'); }
