// ============================================================
// ÉQUIPE — accès au panel, rôles, invitations
// ============================================================

import { auth, db } from "../firebase-config.js";
import {
  doc, setDoc, collection, getDocs, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { confirmDialog, showStatus, escapeAttr, val, setVal, fmtDate } from "./ui.js";
import { WORKER_URL } from "./config.js";

const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur' };

/* Le tout premier compte a été créé à la main dans la console, avant que les
   rôles n'existent : sans rôle inscrit, on le considère administrateur.
   Les règles Firestore appliquent le même défaut. */
const roleOf = r => r.role || 'admin';

let myRole = 'editor';

export async function loadTeam() {
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
    const snap = await getDocs(collection(db, 'invites'));
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
  const ok = await confirmDialog(`Passer ${email} en ${label} ?`,
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

async function revokeAdmin(uid, email) {
  const ok = await confirmDialog(`Supprimer le compte de ${email} ?`,
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
  const ok = await confirmDialog(`Annuler l'invitation de ${email} ?`, 'Le lien déjà transmis cessera de fonctionner.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'invites', email));
    showStatus('Invitation annulée.');
    loadTeam();
  } catch (err) {
    showStatus("Impossible d'annuler : " + err.message, true);
  }
}

export function initTeam() {
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
}
