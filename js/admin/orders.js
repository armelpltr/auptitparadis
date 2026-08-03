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
          <select class="cmd-impression-type" data-action="typeTicket">
            <option value="client">Ticket client</option>
            <option value="commande">Ticket commande</option>
            <option value="production">Ticket production</option>
          </select>
          <button type="button" class="btn btn-ghost btn-small" data-action="imprimer">Imprimer</button>
          <button type="button" class="btn btn-ghost btn-small cmd-supprimer" data-action="supprimer">Supprimer</button>
        </div>
      </article>`;
  }).join('');

  list.querySelectorAll('.cmd-carte').forEach(carte => {
    const id = carte.dataset.id;
    const select = carte.querySelector('[data-action="statut"]');
    select?.addEventListener('change', () => changerStatutViaSelect(id, select.value, select));
    carte.querySelector('[data-action="imprimer"]')?.addEventListener('click', () => {
      const type = carte.querySelector('[data-action="typeTicket"]').value;
      imprimerCommande(id, type);
    });
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

/* ---------- Impression ---------- */
/* Un ticket au format du rouleau existant (80mm) : la mise en page compte
   sur le dialogue d'impression du navigateur, pas sur un pilote ESC/POS —
   on choisit l'imprimante SAGA comme n'importe quelle autre, depuis le
   même poste que la caisse. */
/* Chaque type a un lecteur et une question différents, d'où trois mises en
   page et non une seule avec des champs masqués :
   - client     : il cherche son code et ce qu'il a payé ;
   - commande   : le comptoir cherche qui appeler et où en est le dossier ;
   - production : la cuisine cherche un jour, des quantités et une allergie. */
const TICKETS = {
  client:     { titre: 'COMMANDE',           prix: true,  coordonnees: false, boutique: true  },
  commande:   { titre: 'COMMANDE — INTERNE', prix: true,  coordonnees: true,  boutique: true  },
  production: { titre: 'À PRODUIRE',         prix: false, coordonnees: false, boutique: false }
};

/* Le ticket est un instantané : sur un rouleau qui traîne, savoir de quand
   il date évite de préparer une commande depuis modifiée ou annulée. */
function fmtImpression() {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function nbArticles(o) {
  return (o.items || []).reduce((s, it) => s + (it.quantite || 0), 0);
}

function ticketHTML(o, type = 'commande') {
  const conf = TICKETS[type] || TICKETS.commande;
  const total = nbArticles(o);

  const lignes = (o.items || []).map(it => `
    <tr>
      <td class="t-qte">${escapeAttr(it.quantite)}×</td>
      <td class="t-nom">${escapeAttr(it.nom)}</td>
      ${conf.prix ? `<td class="t-prix">${escapeAttr(euros.format((it.prixUnitaire || 0) * (it.quantite || 0)))}</td>` : ''}
    </tr>`).join('');

  const entete = conf.boutique
    ? `<h1>Au P'tit Paradis</h1>
       <p class="t-adresse">1 Place du Petit Enfer — 14530 Luc-sur-Mer</p>`
    : ''; // ce ticket ne quitte jamais la cuisine : l'adresse y est du bruit

  /* Le code passe en tête sur les tickets de comptoir — c'est par lui qu'on
     retrouve la commande. En production c'est la date qui commande le
     travail : elle prend la vedette, le code reste en rappel discret. */
  const identite = type === 'production'
    ? `<p class="t-jour">${escapeAttr(fmtDateRetrait(o.dateRetrait))}</p>
       <p class="t-rappel">${escapeAttr(nomClient(o.client))} — ${escapeAttr(o.code || '——')}</p>`
    : `<p class="t-code">${escapeAttr(o.code || '——')}</p>
       <p class="t-jour-libelle">RETRAIT</p>
       <p class="t-jour">${escapeAttr(fmtDateRetrait(o.dateRetrait))}</p>`;

  const client = conf.coordonnees
    ? `<p class="t-info"><strong>Client :</strong> ${escapeAttr(nomClient(o.client))}</p>
       <p class="t-info"><strong>Tél :</strong> ${escapeAttr(fmtTelephone(o.client?.telephone))}</p>
       ${o.client?.email ? `<p class="t-info"><strong>E-mail :</strong> ${escapeAttr(o.client.email)}</p>` : ''}
       <p class="t-info"><strong>Statut :</strong> ${escapeAttr((STATUTS[o.statut] || {}).label || o.statut || '—')}</p>
       ${toDate(o.createdAt) ? `<p class="t-info"><strong>Reçue le :</strong> ${escapeAttr(fmtMoment(toDate(o.createdAt)))}</p>` : ''}`
    : type === 'client'
      ? `<p class="t-info"><strong>Client :</strong> ${escapeAttr(nomClient(o.client))}</p>`
      : '';

  const totalLigne = conf.prix
    ? `<div class="t-sep-fort"></div>
       <table>
         <tr><td class="t-total">TOTAL</td><td></td><td class="t-prix t-total">${escapeAttr(euros.format(o.total || 0))}</td></tr>
       </table>`
    : `<p class="t-compte">${total} article${total > 1 ? 's' : ''} au total</p>`;

  // Le commentaire compte double en production : c'est le seul endroit où
  // une allergie ou une demande particulière peut encore être vue avant
  // que le produit ne soit fait.
  const commentaire = o.commentaire
    ? type === 'production'
      ? `<div class="t-sep"></div>
         <div class="t-note-forte">
           <p class="t-note-titre">DEMANDE PARTICULIÈRE</p>
           <p class="t-note-texte">${escapeAttr(o.commentaire)}</p>
         </div>`
      : `<div class="t-sep"></div>
         <p class="t-note">« ${escapeAttr(o.commentaire)} »</p>`
    : '';

  const pied = type === 'client'
    ? `<div class="t-sep"></div>
       <p class="t-centre t-fort">À présenter au retrait</p>
       <p class="t-centre">Merci et à bientôt !</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escapeAttr(conf.titre)} ${escapeAttr(o.code || '')}</title>
<style>
  @page{ size:80mm auto; margin:0; }
  body{
    width:72mm; margin:0 auto;
    /* La marge basse n'est pas décorative : sans elle, la découpe du rouleau
       passe dans la dernière ligne au lieu du vide qui la suit. */
    padding:3mm 0 14mm;
    font-family:'Courier New', monospace; font-size:12px; line-height:1.35; color:#000;
  }
  h1{ font-size:15px; text-align:center; margin:0 0 2px; letter-spacing:1px; }
  .t-adresse{ text-align:center; font-size:10px; margin:0 0 6px; }

  /* Bandeau inversé : sur du thermique c'est le repère qu'on retrouve d'un
     coup d'œil dans une pile de tickets, sans avoir à lire. */
  .t-bande{
    background:#000; color:#fff;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
    text-align:center; font-weight:bold; font-size:13px; letter-spacing:1px;
    padding:2px 0; margin:6px 0 5px;
  }

  .t-code{ text-align:center; font-size:22px; font-weight:bold; letter-spacing:2px; margin:0 0 6px; }
  .t-jour-libelle{ text-align:center; font-size:10px; letter-spacing:2px; margin:0; }
  .t-jour{ text-align:center; font-size:16px; font-weight:bold; margin:0 0 4px; }
  .t-rappel{ text-align:center; font-size:12px; margin:2px 0 4px; }

  .t-sep{ border-top:1px dashed #000; margin:5px 0; }
  .t-sep-fort{ border-top:2px solid #000; margin:5px 0; }

  table{ width:100%; border-collapse:collapse; margin:5px 0; }
  td{ padding:1px 0; vertical-align:top; }
  /* Un nom de produit long doit se replier sous lui-même sans pousser le
     prix hors du rouleau : les colonnes chiffrées gardent leur largeur. */
  .t-qte{ width:14%; font-weight:bold; white-space:nowrap; }
  .t-nom{ word-break:break-word; padding-right:3px; }
  .t-prix{ width:28%; text-align:right; white-space:nowrap; }
  .t-total{ font-weight:bold; font-size:14px; }

  /* En cuisine le ticket se lit à bout de bras, posé sur un plan de travail. */
  .prod .t-qte, .prod .t-nom{ font-size:15px; line-height:1.5; }
  .t-compte{ text-align:center; font-size:11px; margin:4px 0 0; }

  .t-info{ margin:2px 0; }
  .t-centre{ text-align:center; margin:2px 0; }
  .t-fort{ font-weight:bold; }
  .t-note{ margin:4px 0; font-style:italic; }
  .t-note-forte{ border:2px solid #000; padding:4px 5px; margin:4px 0; }
  .t-note-titre{ font-size:10px; letter-spacing:1px; margin:0 0 2px; }
  .t-note-texte{ font-size:15px; font-weight:bold; margin:0; word-break:break-word; }

  .t-pied{ text-align:center; font-size:9px; margin:8px 0 0; }
</style>
</head>
<body class="${type === 'production' ? 'prod' : ''}">
  ${entete}
  <p class="t-bande">${escapeAttr(conf.titre)}</p>
  ${identite}

  ${client ? `<div class="t-sep"></div>${client}` : ''}

  <div class="t-sep"></div>
  <table>${lignes}</table>
  ${totalLigne}

  ${commentaire}
  ${pied}

  <p class="t-pied">imprimé le ${escapeAttr(fmtImpression())}</p>
</body>
</html>`;
}

function imprimerCommande(id, type = 'commande') {
  const o = ordersCache.find(x => x.id === id);
  if (!o) return;

  const fenetre = window.open('', '_blank', 'width=400,height=600');
  if (!fenetre) {
    showStatus("Le navigateur a bloqué l'ouverture de la fenêtre d'impression (pop-up).", true);
    return;
  }
  fenetre.document.write(ticketHTML(o, type));
  fenetre.document.close();

  /* `document.close()` peut avoir déjà déclenché le load : un `onload` posé
     après ne partirait alors jamais. On imprime donc tout de suite si le
     document est prêt, et on attend seulement s'il ne l'est pas. */
  const lancer = () => {
    fenetre.focus();
    fenetre.print();
  };
  if (fenetre.document.readyState === 'complete') lancer();
  else fenetre.addEventListener('load', lancer, { once: true });
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
