// ============================================================
// ÉQUIPE — accès au panel, rôles, invitations
// ============================================================

import { auth, db } from "../firebase-config.js";
import {
  doc, setDoc, collection, getDocs, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { confirmDialog, showStatus, escapeAttr, val, fmtDate } from "./ui.js";
import { WORKER_URL } from "./config.js";

const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur' };

/* Le lien vaut un accès à lui seul, sans être rattaché à une adresse : il ne
   doit pas rester valable indéfiniment s'il s'égare. */
const INVITE_VALIDITE_JOURS = 7;

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
      const nom = [r.prenom, r.nom].filter(Boolean).join(' ').trim();
      // Chacun coupe ses propres alertes ; un administrateur coupe celles
      // des autres. Les règles Firestore appliquent la même limite.
      const peutRegler = isOwner || isMe;
      return `
      <div class="team-row">
        <div class="team-info">
          <strong>${escapeAttr(nom || r.email || '(sans e-mail)')}</strong>
          ${nom ? `<span>${escapeAttr(r.email || '')}</span>` : ''}
          ${peutRegler ? `
            <label class="team-notif">
              <input type="checkbox" class="team-notif-input" data-uid="${escapeAttr(r.uid)}" ${r.notifications === true ? 'checked' : ''}>
              <span>Recevoir un e-mail à chaque commande</span>
            </label>` : ''}
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
    listEl.querySelectorAll('.team-notif-input').forEach(box => {
      box.addEventListener('change', () => changeNotifications(box));
    });
  } catch (err) {
    listEl.innerHTML = `<p class="admin-card-hint">Liste illisible : ${escapeAttr(err.message)}</p>`;
  }

  try {
    const snap = await getDocs(collection(db, 'invites'));
    invEl.innerHTML = snap.docs.map(d => {
      const inv = d.data();
      const expire = inv.expiresAt?.toDate ? inv.expiresAt.toDate() : null;
      const perimee = expire ? expire < new Date() : false;
      return `
      <div class="team-row ${perimee ? 'is-expiree' : ''}">
        <div class="team-info">
          <strong>Lien ${ROLE_LABELS[inv.role] ? ROLE_LABELS[inv.role].toLowerCase() : 'éditeur'}</strong>
          <span>Créé le ${escapeAttr(fmtDate(inv.createdAt))}${
            expire ? ` · ${perimee ? 'expiré' : 'expire'} le ${escapeAttr(fmtDate(inv.expiresAt))}` : ''
          }</span>
        </div>
        <button type="button" class="btn btn-ghost btn-small invite-cancel" data-token="${escapeAttr(d.id)}">Annuler</button>
      </div>`;
    }).join('') || '<p class="admin-card-hint">Aucune invitation en attente.</p>';

    invEl.querySelectorAll('.invite-cancel').forEach(btn => {
      btn.addEventListener('click', () => cancelInvite(btn.dataset.token));
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

/* Pas de confirmation : c'est un réglage réversible d'un clic, et le
   demander à chaque bascule serait plus pénible qu'utile. */
async function changeNotifications(box) {
  const actif = box.checked;
  try {
    await updateDoc(doc(db, 'admins', box.dataset.uid), { notifications: actif });
    showStatus(actif ? 'Alertes de commande activées.' : 'Alertes de commande désactivées.');
  } catch (err) {
    box.checked = !actif;   // refus des règles : la case reflète l'état réel
    showStatus('Réglage refusé : ' + err.message, true);
  }
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

async function cancelInvite(token) {
  const ok = await confirmDialog('Annuler cette invitation ?', 'Le lien déjà transmis cessera de fonctionner.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'invites', token));
    showStatus('Invitation annulée.');
    loadTeam();
  } catch (err) {
    showStatus("Impossible d'annuler : " + err.message, true);
  }
}

export function initTeam() {
  document.getElementById('inviteBtn').addEventListener('click', async () => {
    const token = crypto.randomUUID();
    const btn = document.getElementById('inviteBtn');
    btn.disabled = true;
    try {
      // Le rôle est fixé ici, pas au moment où l'invité crée son compte : les
      // règles vérifient que celui qu'il se donne correspond à l'invitation.
      // L'expiration aussi est vérifiée côté règles — un lien égaré cesse de
      // valoir un accès au bout d'une semaine.
      const expiresAt = new Date(Date.now() + INVITE_VALIDITE_JOURS * 86400000);
      await setDoc(doc(db, 'invites', token), {
        role: val('inviteRole') || 'editor',
        createdAt: new Date(),
        createdBy: auth.currentUser.email,
        expiresAt
      });

      document.getElementById('inviteLink').value =
        `${location.origin}${location.pathname}?token=${token}`;
      document.getElementById('inviteResult').hidden = false;
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
