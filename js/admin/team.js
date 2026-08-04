// ============================================================
// ÉQUIPE — accès au panel, rôles, invitations
// ============================================================

import { auth, db } from "../firebase-config.js";
import {
  doc, setDoc, collection, getDocs, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { confirmDialog, showStatus, escapeAttr, val, fmtDate } from "./ui.js";
import { WORKER_URL } from "./config.js";

/* Quatre rôles :
     superadmin — tout, et seul à pouvoir toucher aux autres superadmins
     admin      — tout le site, les commandes et les accès
     editor     — le contenu du site seulement, ni commandes ni accès
     comptoir   — le mode jour J seulement : chercher une commande et
                  avancer son statut au comptoir, rien d'autre
   Un admin gère l'équipe, mais ne peut ni promouvoir quelqu'un
   superadmin ni retirer un superadmin : c'est ce qui garde une main
   au-dessus de la sienne si le panel est mal manipulé. */
const ROLE_LABELS = {
  superadmin: 'Super-administrateur',
  admin:      'Administrateur',
  editor:     'Réglages du site',
  comptoir:   'Comptoir (jour J)'
};

const GERE_EQUIPE = ['superadmin', 'admin'];

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
    const isOwner = GERE_EQUIPE.includes(myRole);
    const isSuper = myRole === 'superadmin';
    // Ne pas laisser retirer ou rétrograder le dernier de ceux qui gèrent
    // les accès : plus personne ne pourrait en redonner.
    const ownerCount = rows.filter(r => GERE_EQUIPE.includes(roleOf(r))).length;

    applyRoleToUI(isOwner, isSuper);

    listEl.innerHTML = rows.map(r => {
      const role = roleOf(r);
      const isMe = r.uid === me.uid;
      const lastOwner = GERE_EQUIPE.includes(role) && ownerCount === 1;
      /* Un superadmin n'est modifiable que par un superadmin. Sans ça, le
         patron pourrait rétrograder ou supprimer le compte qui lui sert de
         recours. */
      const intouchable = role === 'superadmin' && !isSuper;
      const modifiable = isOwner && !lastOwner && !intouchable;
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
          ${modifiable
            ? `<select class="team-role" data-uid="${escapeAttr(r.uid)}" data-email="${escapeAttr(r.email || '')}">
                 ${Object.entries(ROLE_LABELS)
                   // Seul un superadmin peut en nommer un autre.
                   .filter(([v]) => v !== 'superadmin' || isSuper)
                   .map(([v, l]) => `<option value="${v}" ${role === v ? 'selected' : ''}>${l}</option>`)
                   .join('')}
               </select>`
            : `<span class="team-role-fixed">${ROLE_LABELS[role] || role}</span>`}
          ${isMe
            ? '<span class="team-you">compte actuel</span>'
            : modifiable
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

/* Qui ne gère pas les accès garde l'onglet Équipe pour voir qui a accès,
   mais rien pour agir : les règles refuseraient de toute façon, autant ne
   pas afficher les boutons. Le choix « super-administrateur » à
   l'invitation n'apparaît qu'aux superadmins. */
function applyRoleToUI(isOwner, isSuper) {
  document.getElementById('teamInviteCard').hidden = !isOwner;
  document.getElementById('teamInvitesCard').hidden = !isOwner;
  const optSuper = document.querySelector('#inviteRole option[value="superadmin"]');
  if (optSuper) optSuper.hidden = !isSuper;
}

const CONSEQUENCES = {
  superadmin: 'Cette personne pourra tout faire, y compris gérer les autres super-administrateurs.',
  admin:      'Cette personne pourra gérer le site, les commandes et les accès de l\'équipe.',
  editor:     'Cette personne pourra modifier le contenu du site, mais ni voir les commandes ni gérer les accès.',
  comptoir:   'Cette personne n\'aura accès qu\'au mode jour J : chercher une commande et faire avancer son statut au comptoir. Rien d\'autre ne lui sera visible.'
};

async function changeRole(select, email) {
  const role = select.value;
  const ok = await confirmDialog(
    `Passer ${email} en « ${ROLE_LABELS[role].toLowerCase()} » ?`,
    CONSEQUENCES[role] || ''
  );
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
