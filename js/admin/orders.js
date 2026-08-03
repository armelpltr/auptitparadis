// ============================================================
// ONGLET COMMANDES — suivi des réservations de Noël
//
// Les commandes sont écrites par le Worker ; le panel les lit et fait
// avancer leur statut. Le tri se fait sur la date de retrait : c'est
// l'ordre dans lequel le travail arrive en boutique.
// ============================================================

import { db } from "../firebase-config.js";
import {
  doc, collection, getDocs, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { confirmDialog, showStatus, escapeAttr } from "./ui.js";

/* Une commande non confirmée depuis plus de ce délai est signalée : le
   patron décide au cas par cas, mais il faut d'abord qu'il la voie. */
const JOURS_AVANT_ALERTE = 3;

const STATUTS = {
  en_attente: { label: 'En attente',  suivant: 'confirmee', actionSuivante: 'Confirmer' },
  confirmee:  { label: 'Confirmée',   suivant: 'prete',     actionSuivante: 'Marquer prête' },
  prete:      { label: 'Prête',       suivant: 'recuperee', actionSuivante: 'Marquer récupérée' },
  recuperee:  { label: 'Récupérée',   suivant: null,        actionSuivante: null },
  annulee:    { label: 'Annulée',     suivant: null,        actionSuivante: null }
};

/* Regroupements du filtre. « En cours » est le défaut : les commandes
   récupérées et annulées n'appellent plus d'action. */
const FILTRES = {
  en_cours:  ['en_attente', 'confirmee', 'prete'],
  attente:   ['en_attente'],
  confirmee: ['confirmee'],
  prete:     ['prete'],
  terminees: ['recuperee', 'annulee'],
  toutes:    Object.keys(STATUTS)
};

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const jourLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

let ordersCache = [];

/* ---------- Statistiques ---------- */
/* Une commande annulée ne doit peser ni dans le CA prévisionnel ni dans
   le classement des produits : elle ne sera jamais préparée. */
const STATUTS_ACTIFS = ['en_attente', 'confirmee', 'prete'];

function calculerStats(list) {
  const actives = list.filter(o => STATUTS_ACTIFS.includes(o.statut));
  const ca = actives.reduce((s, o) => s + (o.total || 0), 0);

  const parProduit = new Map();
  for (const o of list) {
    if (o.statut === 'annulee') continue;
    for (const it of (o.items || [])) {
      parProduit.set(it.nom, (parProduit.get(it.nom) || 0) + (it.quantite || 0));
    }
  }
  let top = null;
  for (const [nom, qte] of parProduit) {
    if (!top || qte > top.qte) top = { nom, qte };
  }

  return {
    nbActives: actives.length,
    ca,
    top,
    nbRecuperees: list.filter(o => o.statut === 'recuperee').length
  };
}

function renderStats() {
  const zone = document.getElementById('ordersStats');
  if (!zone) return;
  const { nbActives, ca, top, nbRecuperees } = calculerStats(ordersCache);

  zone.innerHTML = `
    <div class="stat-carte">
      <span class="stat-valeur">${nbActives}</span>
      <span class="stat-label">Commande${nbActives > 1 ? 's' : ''} en cours</span>
    </div>
    <div class="stat-carte">
      <span class="stat-valeur">${escapeAttr(euros.format(ca))}</span>
      <span class="stat-label">CA prévisionnel (en cours)</span>
    </div>
    <div class="stat-carte">
      <span class="stat-valeur">${top ? escapeAttr(top.nom) : '—'}</span>
      <span class="stat-label">${top ? `Le plus demandé (${top.qte})` : 'Aucun produit encore commandé'}</span>
    </div>
    <div class="stat-carte">
      <span class="stat-valeur">${nbRecuperees}</span>
      <span class="stat-label">Récupérée${nbRecuperees > 1 ? 's' : ''}</span>
    </div>`;
}

function toDate(v) {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function joursDepuis(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/* Une annulation se lit à l'heure près : savoir qu'elle est tombée ce matin
   ou il y a trois jours ne se déduit pas d'une date seule. */
function fmtMoment(date) {
  if (!date) return '';
  return date.toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
}

function fmtDateRetrait(iso) {
  if (!iso) return 'date inconnue';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : jourLong.format(d);
}

/* Les premières commandes n'avaient qu'un champ `nom` : on retombe dessus
   plutôt que d'afficher « (sans nom) » sur un historique parfaitement bon. */
function nomClient(c) {
  if (!c) return '(sans nom)';
  const compose = [c.prenom, c.nom].filter(Boolean).join(' ').trim();
  return c.nomComplet || compose || c.nom || '(sans nom)';
}

/* Le téléphone est stocké normalisé (0XXXXXXXXX) ; on le rend lisible. */
function fmtTelephone(tel) {
  const s = String(tel || '');
  return /^0\d{9}$/.test(s) ? s.replace(/(\d{2})(?=\d)/g, '$1 ').trim() : s;
}

/* ---------- À préparer ---------- */
/* Uniquement les commandes qu'il faut vraiment produire ce jour-là : une
   commande encore en attente n'est pas garantie, une récupérée ou une
   annulée n'appelle plus rien. */
function dateDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function agregerParProduit(liste) {
  const parNom = new Map();
  for (const o of liste) {
    for (const it of (o.items || [])) {
      parNom.set(it.nom, (parNom.get(it.nom) || 0) + (it.quantite || 0));
    }
  }
  return [...parNom.entries()].sort((a, b) => b[1] - a[1]);
}

function renderPrepa() {
  const zone = document.getElementById('prepaResultats');
  const dateChoisie = document.getElementById('prepaDate').value;
  if (!zone || !dateChoisie) return;

  const duJour = ordersCache.filter(o => o.dateRetrait === dateChoisie);
  const confirmees = duJour.filter(o => ['confirmee', 'prete'].includes(o.statut));
  const enAttente  = duJour.filter(o => o.statut === 'en_attente');

  const listeHTML = (paires, vide) => paires.length
    ? `<ul class="prepa-liste">${paires.map(([nom, qte]) =>
        `<li><span class="prepa-qte">${qte}×</span> ${escapeAttr(nom)}</li>`).join('')}</ul>`
    : `<p class="empty-hint">${vide}</p>`;

  zone.innerHTML = `
    <div class="prepa-groupe">
      <h4>Confirmées (${confirmees.length})</h4>
      ${listeHTML(agregerParProduit(confirmees), 'Rien de confirmé pour cette date.')}
    </div>
    <div class="prepa-groupe prepa-attente">
      <h4>En attente de confirmation (${enAttente.length})</h4>
      ${listeHTML(agregerParProduit(enAttente), 'Aucune commande en attente pour cette date.')}
    </div>`;
}

/* ---------- Chargement ---------- */
export async function loadOrders() {
  const list = document.getElementById('ordersList');
  try {
    const snap = await getDocs(collection(db, 'orders'));
    ordersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Tri côté client : croiser statut et date de retrait dans la requête
    // réclamerait un index composite créé à la main dans la console.
    ordersCache.sort((a, b) => String(a.dateRetrait || '').localeCompare(String(b.dateRetrait || '')));
    renderStats();
    renderPrepa();
    renderOrders();
  } catch (err) {
    list.innerHTML = `<p class="empty-hint">Commandes illisibles : ${escapeAttr(err.message)}</p>`;
  }
}

function renderOrders() {
  const list = document.getElementById('ordersList');
  const filtre = document.getElementById('ordersFiltre').value;
  const recherche = document.getElementById('ordersRecherche').value.trim().toLowerCase();
  const statutsVoulus = FILTRES[filtre] || FILTRES.toutes;

  const visibles = ordersCache.filter(o => {
    if (!statutsVoulus.includes(o.statut)) return false;
    if (!recherche) return true;
    return [o.code, o.client?.prenom, o.client?.nom, o.client?.nomComplet, o.client?.telephone, o.client?.email]
      .some(v => String(v || '').toLowerCase().includes(recherche));
  });

  document.getElementById('ordersCompte').textContent = visibles.length === 0
    ? 'Aucune commande'
    : `${visibles.length} commande${visibles.length > 1 ? 's' : ''}`;

  if (!visibles.length) {
    list.innerHTML = '<p class="empty-hint">Rien à afficher pour ce filtre.</p>';
    return;
  }

  list.innerHTML = visibles.map(o => {
    const statut = STATUTS[o.statut] || { label: o.statut || '—', suivant: null };
    const attente = o.statut === 'en_attente' ? joursDepuis(toDate(o.createdAt)) : 0;
    const alerte = attente >= JOURS_AVANT_ALERTE;

    const lignes = (o.items || []).map(it => `
      <li><span class="cmd-qte">${escapeAttr(it.quantite)}×</span> ${escapeAttr(it.nom)}
        <span class="cmd-ligne-prix">${escapeAttr(euros.format((it.prixUnitaire || 0) * (it.quantite || 0)))}</span>
      </li>`).join('');

    return `
      <article class="cmd-carte statut-${escapeAttr(o.statut || 'inconnu')} ${alerte ? 'is-alerte' : ''}" data-id="${escapeAttr(o.id)}">
        <header class="cmd-header">
          <span class="cmd-code">${escapeAttr(o.code || '——')}</span>
          <span class="cmd-statut">${escapeAttr(statut.label)}</span>
          <span class="cmd-retrait">Retrait ${escapeAttr(fmtDateRetrait(o.dateRetrait))}</span>
        </header>

        ${alerte ? `<p class="cmd-alerte">Non confirmée depuis ${attente} jour${attente > 1 ? 's' : ''}</p>` : ''}
        ${o.annuleePar === 'client'
          ? `<p class="cmd-annulee-client">Annulée par le client${o.annuleeLe ? `, ${fmtMoment(toDate(o.annuleeLe))}` : ''} — rien à faire</p>`
          : ''}

        <div class="cmd-client">
          <strong>${escapeAttr(nomClient(o.client))}</strong>
          <a href="tel:${escapeAttr(o.client?.telephone || '')}">${escapeAttr(fmtTelephone(o.client?.telephone))}</a>
          ${o.client?.email ? `<a href="mailto:${escapeAttr(o.client.email)}">${escapeAttr(o.client.email)}</a>` : ''}
        </div>

        <ul class="cmd-lignes">${lignes}</ul>
        <p class="cmd-total">Total <strong>${escapeAttr(euros.format(o.total || 0))}</strong></p>

        ${o.commentaire ? `<p class="cmd-commentaire">« ${escapeAttr(o.commentaire)} »</p>` : ''}

        <div class="cmd-actions">
          <select class="cmd-statut-select" data-action="statut">
            ${Object.entries(STATUTS).map(([cle, s]) =>
              `<option value="${cle}" ${o.statut === cle ? 'selected' : ''}>${escapeAttr(s.label)}</option>`
            ).join('')}
          </select>
          <button type="button" class="btn btn-ghost btn-small cmd-supprimer" data-action="supprimer">Supprimer</button>
        </div>
      </article>`;
  }).join('');

  list.querySelectorAll('.cmd-carte').forEach(carte => {
    const id = carte.dataset.id;
    const select = carte.querySelector('[data-action="statut"]');
    select?.addEventListener('change', () => changerStatutViaSelect(id, select.value, select));
    carte.querySelector('[data-action="supprimer"]')?.addEventListener('click', () => supprimerCommande(id));
  });
}

/* ---------- Actions ---------- */
async function changerStatut(id, statut) {
  try {
    await updateDoc(doc(db, 'orders', id), { statut });
    await loadOrders();
  } catch (err) {
    showStatus('Changement de statut refusé : ' + err.message, true);
  }
}

/* Le menu déroulant permet d'aller dans les deux sens (revenir en arrière
   inclus) — seule l'annulation garde une confirmation, vu qu'elle n'a pas
   de retour en arrière simple pour le client. Un choix annulé remet le
   menu sur son statut d'origine, sinon il resterait affiché sur une valeur
   qui n'a en réalité pas été enregistrée. */
async function changerStatutViaSelect(id, nouveauStatut, selectEl) {
  const o = ordersCache.find(x => x.id === id);
  if (!o || nouveauStatut === o.statut) return;

  if (nouveauStatut === 'annulee') {
    const ok = await confirmDialog(
      `Annuler la commande ${o.code || ''} ?`,
      `${o.client ? nomClient(o.client) : 'Le client'} ne sera pas prévenu automatiquement — pensez à l'appeler.`
    );
    if (!ok) { selectEl.value = o.statut; return; }
  }

  await changerStatut(id, nouveauStatut);
  showStatus(`Commande ${o.code || ''} — ${STATUTS[nouveauStatut].label.toLowerCase()}.`);
}

/* Suppression définitive — utile en phase de test pour vider les commandes
   bidon, mais reste accessible ensuite : rien n'empêche de nettoyer un
   vieux dossier annulé ou récupéré depuis longtemps. */
async function supprimerCommande(id) {
  const o = ordersCache.find(x => x.id === id);
  const ok = await confirmDialog(
    `Supprimer définitivement la commande ${o?.code || ''} ?`,
    'Cette action efface la commande de la base — impossible à annuler. Le client ne sera pas prévenu.'
  );
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'orders', id));
    showStatus(`Commande ${o?.code || ''} supprimée.`);
    await loadOrders();
  } catch (err) {
    showStatus('Suppression refusée : ' + err.message, true);
  }
}

/* ---------- Câblage ---------- */
export function initOrders() {
  const prepaDate = document.getElementById('prepaDate');
  if (prepaDate && !prepaDate.value) prepaDate.value = dateDuJour();
  prepaDate?.addEventListener('change', renderPrepa);

  document.getElementById('ordersFiltre').addEventListener('change', renderOrders);
  document.getElementById('ordersRecherche').addEventListener('input', renderOrders);
  document.getElementById('ordersRefresh').addEventListener('click', loadOrders);
}
