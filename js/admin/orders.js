// ============================================================
// ONGLET COMMANDES — suivi des réservations de Noël
//
// Les commandes sont écrites par le Worker ; le panel les lit et fait
// avancer leur statut. Le tri se fait sur la date de retrait : c'est
// l'ordre dans lequel le travail arrive en boutique.
// ============================================================

import { db, auth } from "../firebase-config.js";
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { confirmDialog, showStatus, escapeAttr } from "./ui.js";

/* Une commande non confirmée depuis plus de ce délai est signalée : le
   patron décide au cas par cas, mais il faut d'abord qu'il la voie. */
const JOURS_AVANT_ALERTE = 3;

/* `label` reste du texte pur : il part aussi sur les tickets, où une
   imprimante thermique ne sait pas rendre un emoji. L'icône vit à côté et
   ne sert qu'à l'écran. */
const STATUTS = {
  en_attente: { label: 'En attente de validation', emoji: '⏳', suivant: 'confirmee', actionSuivante: 'Confirmer' },
  confirmee:  { label: 'Confirmée',                emoji: '✅', suivant: 'prete',     actionSuivante: 'Marquer prête' },
  prete:      { label: 'Prête',                    emoji: '🎁', suivant: 'recuperee', actionSuivante: 'Marquer récupérée' },
  recuperee:  { label: 'Récupérée',                emoji: '🤝', suivant: null,        actionSuivante: null },
  annulee:    { label: 'Annulée',                  emoji: '❌', suivant: null,        actionSuivante: null }
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

/* Entête des tickets : lue une fois dans les réglages du site plutôt que
   codée en dur, pour qu'un changement d'adresse ou de téléphone n'oblige
   pas à repasser par le code. Chargée à part des commandes : si elle
   manque, les tickets sortent sans entête mais sortent quand même. */
let boutiqueCache = null;

async function chargerBoutique() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    const s = snap.exists() ? snap.data() : {};
    boutiqueCache = {
      nom:      s.entreprise?.raisonSociale || '',
      siret:    s.entreprise?.siret || '',
      adresse1: s.horaires?.address1 || '',
      adresse2: s.horaires?.address2 || '',
      tel:      s.horaires?.phoneDisplay || s.horaires?.phone || ''
    };
  } catch {
    boutiqueCache = { nom: '', siret: '', adresse1: '', adresse2: '', tel: '' };
  }
}

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

function fmtHeure(hhmm) {
  return hhmm ? String(hhmm).replace(':', 'h') : '';
}

/* Le jour, et l'heure quand il y en a une : les commandes passées avant les
   créneaux n'en portent pas et doivent rester lisibles telles quelles. */
function fmtRetrait(o) {
  const jour = fmtDateRetrait(o.dateRetrait);
  return o.heureRetrait ? `${jour} à ${fmtHeure(o.heureRetrait)}` : jour;
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

/* ---------- Mode jour J ---------- */
/* Une interface à part, pas un simple filtre dans la liste habituelle :
   au comptoir le jour du retrait, la vitesse et la lisibilité priment sur
   tout — pas d'onglets, pas de statistiques, pas de menu déroulant à
   plusieurs choix. Une recherche, une carte.

   Volontairement consultatif : aucune action n'y modifie une commande, pas
   même avancer son statut. C'est une vue pour des employés qui n'ont pas
   accès au panel — ils peuvent chercher et lire, pas écrire. Changer un
   statut reste réservé à l'onglet Commandes classique, aux comptes
   admin/superadmin. */

/* Le verrou doit survivre à un rechargement de page, pas seulement à une
   navigation dans le panel : sinon un F5 (ou un tirer-pour-actualiser sur
   tablette) revient direct sur l'écran normal, sans jamais demander le
   code — exactement ce qu'on essaie d'empêcher. localStorage tient sur
   cet appareil précis, ce qui tombe bien : l'idée est de verrouiller CE
   poste de comptoir, peu importe qui s'y connecte ensuite. */
const CLE_VERROU_JOURJ = 'jourjVerrouille';

function verrouillerJourJ() {
  try { localStorage.setItem(CLE_VERROU_JOURJ, '1'); } catch { /* stockage indisponible, tant pis */ }
}
function deverrouillerJourJ() {
  try { localStorage.removeItem(CLE_VERROU_JOURJ); } catch { /* idem */ }
}

/** Appelé au chargement du panel : si ce poste était verrouillé avant le
 *  rechargement, on repart directement en mode jour J plutôt que de
 *  laisser admin.js afficher les onglets, ne serait-ce qu'un instant. */
export function modeJourJVerrouille() {
  try { return localStorage.getItem(CLE_VERROU_JOURJ) === '1'; } catch { return false; }
}

/* Rien ne rafraîchissait les données une fois le panel ouvert — ni dans
   l'onglet Commandes classique, ni en mode jour J : il fallait cliquer
   « Actualiser » pour voir une commande qui vient d'arriver. Un intervalle
   global comble ça pour les deux vues à la fois, puisque loadOrders()
   redessine déjà tout (liste classique, stats, à préparer, mode jour J). */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20 * 1000;
let intervalleRafraichissement = null;

/** Démarre le rafraîchissement automatique. Idempotent : un second appel
 *  ne double pas l'intervalle, il le remplace proprement. */
export function demarrerAutoRefresh() {
  clearInterval(intervalleRafraichissement);
  intervalleRafraichissement = setInterval(loadOrders, INTERVALLE_RAFRAICHISSEMENT_MS);
}

export function ouvrirModeJourJ() {
  verrouillerJourJ();
  const overlay = document.getElementById('jourjOverlay');
  const recherche = document.getElementById('jourjRecherche');
  overlay.hidden = false;
  recherche.value = '';
  document.getElementById('jourjDate').value = '';
  // Défensif : si la popup de code était restée ouverte d'une façon ou
  // d'une autre, elle ne doit jamais réapparaître pré-remplie à une
  // nouvelle entrée dans le mode jour J.
  document.getElementById('jourjPinOverlay').hidden = true;
  reinitialiserPin();
  renderJourJ();
  // Le clavier virtuel s'ouvre tout de suite : au comptoir, la première
  // chose qu'on fait est taper un nom ou un code, jamais regarder l'écran.
  recherche.focus();
}

/* Pas une vraie barrière de sécurité — n'importe qui avec les outils de
   développement la contournerait en une ligne, et ce champ est de toute
   façon lisible par tous dans Firestore (settings est public en lecture).
   Elle ne protège aucune donnée : les règles Firestore s'en chargent déjà,
   quel que soit ce qui se passe à l'écran. Son seul rôle est physique —
   empêcher qu'un geste du quotidien au comptoir ("tiens, c'est quoi ce
   bouton ?") sorte du mode jour J pendant le service, sur le compte du
   patron resté ouvert toute la journée.

   Stocké dans settings/noel plutôt qu'en dur dans ce fichier : modifiable
   depuis l'admin, sans dépendre de moi ni d'un redéploiement. La valeur
   par défaut ne sert qu'avant le tout premier réglage. */
let codeSortieJourJ = '8822';

async function chargerCodeSortie() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'noel'));
    const valeur = snap.exists() ? snap.data().codeSortieJourJ : null;
    if (/^\d{4}$/.test(valeur || '')) codeSortieJourJ = valeur;
  } catch { /* la valeur par défaut reste en place */ }
}

/* Toujours vide à l'ouverture, jamais un reste de saisie précédente —
   que ce soit un code faux qui traînait, ou même le bon : le champ ne
   doit jamais donner l'impression qu'il est pré-rempli ou mémorisé. */
function reinitialiserPin() {
  document.getElementById('jourjPinInput').value = '';
  document.getElementById('jourjPinErreur').hidden = true;
}

function demanderCodeSortie() {
  reinitialiserPin();
  document.getElementById('jourjPinOverlay').hidden = false;
  document.getElementById('jourjPinInput').focus();
}

function annulerCodeSortie() {
  document.getElementById('jourjPinOverlay').hidden = true;
  reinitialiserPin();
}

function validerCodeSortie() {
  const input = document.getElementById('jourjPinInput');
  if (input.value === codeSortieJourJ) {
    document.getElementById('jourjPinOverlay').hidden = true;
    fermerModeJourJ();
    reinitialiserPin();
    return;
  }
  document.getElementById('jourjPinErreur').hidden = false;
  input.value = '';
  input.focus();
}

function fermerModeJourJ() {
  deverrouillerJourJ();
  document.getElementById('jourjOverlay').hidden = true;
}

function jourjCarteHTML(o) {
  const statut = STATUTS[o.statut] || { label: o.statut, suivant: null, actionSuivante: null };
  const figee = !statut.suivant;

  return `
    <div class="jourj-carte ${figee ? 'is-figee' : ''}" data-id="${escapeAttr(o.id)}">
      <div class="jourj-carte-entete">
        <span class="jourj-code">${escapeAttr(o.code || '——')}</span>
        <span class="jourj-nom">${escapeAttr(nomClient(o.client))}</span>
        <span class="jourj-statut-badge">${statut.emoji || ''} ${escapeAttr(statut.label)}</span>
      </div>
      <p class="jourj-detail"><strong>Retrait :</strong> ${escapeAttr(fmtDateRetrait(o.dateRetrait))}</p>
      <p class="jourj-detail"><strong>Tél :</strong> ${escapeAttr(fmtTelephone(o.client?.telephone))}</p>
      <p class="jourj-detail">${(o.items || []).map(it => `${it.quantite}× ${escapeAttr(it.nom)}`).join(' · ')}</p>
      ${o.commentaire ? `<p class="jourj-detail">💬 « ${escapeAttr(o.commentaire)} »</p>` : ''}
    </div>`;
}

function renderJourJ() {
  const zone = document.getElementById('jourjResultats');
  const sousTitre = document.getElementById('jourjSousTitre');
  const recherche = document.getElementById('jourjRecherche').value.trim().toLowerCase();
  const dateFiltre = document.getElementById('jourjDate').value;

  // Toutes les commandes par défaut — pas seulement celles du jour : c'est
  // la vue qu'un employé doit pouvoir consulter, sans avoir en plus accès
  // au panel complet. Les annulées restent de côté, elles n'apportent rien
  // au comptoir. La date et la recherche se combinent : les deux réduisent
  // la liste, aucune ne prend le pas sur l'autre.
  let liste = ordersCache.filter(o => o.statut !== 'annulee');
  if (dateFiltre) liste = liste.filter(o => o.dateRetrait === dateFiltre);
  if (recherche) {
    liste = liste.filter(o =>
      [o.code, o.client?.prenom, o.client?.nom, o.client?.nomComplet, o.client?.telephone, o.client?.email]
        .some(v => String(v || '').toLowerCase().includes(recherche))
    );
  }

  const morceaux = [];
  morceaux.push(dateFiltre ? `Retraits du ${fmtDateRetrait(dateFiltre)}` : 'Toutes les dates');
  if (recherche) morceaux.push(`recherche « ${recherche} »`);
  sousTitre.textContent = `${morceaux.join(' · ')} — ${liste.length} commande${liste.length > 1 ? 's' : ''}`;

  zone.innerHTML = liste.length
    ? liste.map(jourjCarteHTML).join('')
    : '<p class="jourj-vide">Aucune commande ne correspond.</p>';
}

/* ---------- Chargement ---------- */
export async function loadOrders() {
  const list = document.getElementById('ordersList');
  if (!boutiqueCache) chargerBoutique(); // sans await : n'a d'effet qu'à l'impression
  try {
    const snap = await getDocs(collection(db, 'orders'));
    ordersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Tri côté client : croiser statut et date de retrait dans la requête
    // réclamerait un index composite créé à la main dans la console.
    /* L'heure entre dans le tri : sur une même journée, c'est l'ordre dans
       lequel les clients se présentent au comptoir. Les commandes sans heure
       passent en tête de leur journée, faute de mieux. */
    ordersCache.sort((a, b) =>
      `${a.dateRetrait || ''} ${a.heureRetrait || ''}`
        .localeCompare(`${b.dateRetrait || ''} ${b.heureRetrait || ''}`));
    renderStats();
    renderPrepa();
    renderOrders();
    // Toujours appelé, même hors mode jour J : lire une valeur d'input
    // sur un écran caché ne coûte rien, et ça évite qu'un compte comptoir
    // atterrisse sur une liste vide le temps que ce chargement termine.
    renderJourJ();
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
    // « Toutes » veut dire toutes — y compris une commande dont le statut
    // est vide, mal orthographié ou absent de la liste connue (donnée de
    // test, import manuel, bug ailleurs). Un filtre par statut, lui,
    // reste strict : il n'a de sens que sur les valeurs qu'il connaît.
    if (filtre !== 'toutes' && !statutsVoulus.includes(o.statut)) return false;
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
    /* Le client a lui-même annulé depuis son e-mail : le dossier est clos de
       son côté. Le rouvrir depuis le panel ferait croire à une commande
       vivante que personne n'attend plus. */
    const verrouillee = o.annuleePar === 'client';

    const lignes = (o.items || []).map(it => `
      <li><span class="cmd-qte">${escapeAttr(it.quantite)}×</span> ${escapeAttr(it.nom)}
        <span class="cmd-ligne-prix">${escapeAttr(euros.format((it.prixUnitaire || 0) * (it.quantite || 0)))}</span>
      </li>`).join('');

    return `
      <article class="cmd-carte statut-${escapeAttr(o.statut || 'inconnu')} ${alerte ? 'is-alerte' : ''}" data-id="${escapeAttr(o.id)}">
        <header class="cmd-header">
          <span class="cmd-code">${escapeAttr(o.code || '——')}</span>
          <span class="cmd-statut statut-${escapeAttr(o.statut || 'inconnu')}">${statut.emoji || ''} ${escapeAttr(statut.label)}</span>
          <span class="cmd-retrait">Retrait ${escapeAttr(fmtRetrait(o))}</span>
        </header>

        ${alerte ? `<p class="cmd-alerte">Non confirmée depuis ${attente} jour${attente > 1 ? 's' : ''}</p>` : ''}
        ${verrouillee
          ? `<p class="cmd-annulee-client">Annulée par le client${o.annuleeLe ? `, ${fmtMoment(toDate(o.annuleeLe))}` : ''} — statut verrouillé</p>`
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
          <label class="cmd-statut-champ">
            <span class="cmd-statut-libelle">Statut commande</span>
            <select class="cmd-statut-select statut-${escapeAttr(o.statut || 'inconnu')}"
                    data-action="statut" ${verrouillee ? 'disabled' : ''}>
              ${Object.entries(STATUTS).map(([cle, s]) =>
                `<option value="${cle}" ${o.statut === cle ? 'selected' : ''}>${s.emoji} ${escapeAttr(s.label)}</option>`
              ).join('')}
            </select>
          </label>
          <button type="button" class="btn btn-ghost btn-small" data-action="imprimer">Imprimer…</button>
          <button type="button" class="btn btn-ghost btn-small cmd-supprimer" data-action="supprimer">Supprimer</button>
        </div>
      </article>`;
  }).join('');

  list.querySelectorAll('.cmd-carte').forEach(carte => {
    const id = carte.dataset.id;
    const select = carte.querySelector('[data-action="statut"]');
    select?.addEventListener('change', () => changerStatutViaSelect(id, select.value, select));
    carte.querySelector('[data-action="imprimer"]')?.addEventListener('click', () => imprimerCommande(id));
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
  // Le menu est déjà désactivé dans ce cas ; la garde tient si le rendu change.
  if (o.annuleePar === 'client') { selectEl.value = o.statut; return; }

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
/* Sur le seul ticket qui part avec le client : c'est par là qu'il repasse
   commande, et l'adresse ne figure nulle part ailleurs sur le papier. */
const SITE_WEB = 'auptitparadis.fr';

const TICKETS = {
  client:     { titre: 'CLIENT',     prix: true,  coordonnees: false, boutique: true  },
  commande:   { titre: 'INTERNE',    prix: true,  coordonnees: true,  boutique: true  },
  production: { titre: 'À PRODUIRE', prix: false, coordonnees: false, boutique: false }
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

/* Le corps d'un ticket seul, sans en-tête de document : plusieurs peuvent
   ainsi partir dans la même impression, séparés par un saut de page — donc
   par une découpe du rouleau. */
function corpsTicket(o, type = 'commande') {
  const conf = TICKETS[type] || TICKETS.commande;
  const total = nbArticles(o);

  /* Prix unitaire *et* total de ligne, comme sur les tickets de caisse : sans
     l'unitaire, un client qui commande deux fois le même produit ne peut pas
     vérifier le calcul. */
  const enTeteColonnes = conf.prix
    ? `<tr class="t-colonnes">
         <td class="t-qte">PCE</td>
         <td class="t-nom">PRODUIT</td>
         <td class="t-pu">€/UN</td>
         <td class="t-prix">TOTAL</td>
       </tr>`
    : '';

  const lignes = (o.items || []).map(it => `
    <tr>
      <td class="t-qte">${escapeAttr(it.quantite)}×</td>
      <td class="t-nom">${escapeAttr(it.nom)}</td>
      ${conf.prix ? `
        <td class="t-pu">${escapeAttr(euros.format(it.prixUnitaire || 0))}</td>
        <td class="t-prix">${escapeAttr(euros.format((it.prixUnitaire || 0) * (it.quantite || 0)))}</td>` : ''}
    </tr>`).join('');

  const b = boutiqueCache || {};
  const entete = conf.boutique
    ? `<h1>${escapeAttr(b.nom || "Au P'tit Paradis")}</h1>
       <p class="t-adresse">
         ${[b.adresse1, b.adresse2].filter(Boolean).map(escapeAttr).join('<br>')}
         ${b.tel ? `<br>Tél : ${escapeAttr(b.tel)}` : ''}
         ${b.siret ? `<br>Siret : ${escapeAttr(b.siret)}` : ''}
       </p>`
    : ''; // ce ticket ne quitte jamais la cuisine : l'adresse y est du bruit

  /* Le code passe en tête sur les tickets de comptoir — c'est par lui qu'on
     retrouve la commande. En production c'est la date qui commande le
     travail : elle prend la vedette, le code reste en rappel discret. */
  const heure = o.heureRetrait
    ? `<p class="t-heure">${escapeAttr(fmtHeure(o.heureRetrait))}</p>`
    : '';

  const identite = type === 'production'
    ? `<p class="t-jour">${escapeAttr(fmtDateRetrait(o.dateRetrait))}</p>
       ${heure}
       <p class="t-rappel">${escapeAttr(nomClient(o.client))} — ${escapeAttr(o.code || '——')}</p>`
    : `<p class="t-code">${escapeAttr(o.code || '——')}</p>
       <p class="t-jour-libelle">RETRAIT</p>
       <p class="t-jour">${escapeAttr(fmtDateRetrait(o.dateRetrait))}</p>
       ${heure}`;

  /* Une commande web et une commande prise au comptoir finissent dans la même
     pile de tickets : sans cette mention, impossible de savoir laquelle est
     déjà dans le logiciel de caisse et laquelle n'y est pas. */
  const recue = toDate(o.createdAt);
  const origine = `<p class="t-info"><strong>Commande en ligne</strong>${
    recue ? ` — reçue le ${escapeAttr(fmtMoment(recue))}` : ''}</p>`;

  const client = conf.coordonnees
    ? `<p class="t-info"><strong>Client :</strong> ${escapeAttr(nomClient(o.client))}</p>
       <p class="t-info"><strong>Tél :</strong> ${escapeAttr(fmtTelephone(o.client?.telephone))}</p>
       ${o.client?.email ? `<p class="t-info"><strong>E-mail :</strong> ${escapeAttr(o.client.email)}</p>` : ''}
       <p class="t-info"><strong>Statut :</strong> ${escapeAttr((STATUTS[o.statut] || {}).label || o.statut || '—')}</p>
       ${origine}`
    : type === 'client'
      ? `<p class="t-info"><strong>Client :</strong> ${escapeAttr(nomClient(o.client))}</p>
         ${origine}`
      : '';

  const totalLigne = conf.prix
    ? `<div class="t-sep-fort"></div>
       <table>
         <tr><td class="t-total" colspan="3">TOTAL</td><td class="t-prix t-total">${escapeAttr(euros.format(o.total || 0))}</td></tr>
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

  /* La date d'annulation est figée à la commande et déjà annoncée par e-mail :
     l'imprimer évite au client de rouvrir sa boîte mail pour la retrouver. */
  const limite = toDate(o.annulableJusqua);
  const annulation = (type === 'client' && limite && limite > new Date())
    ? `<p class="t-centre t-petit">Annulable jusqu'au ${escapeAttr(jourLong.format(limite))}</p>`
    : '';

  const pied = type === 'client'
    ? `<div class="t-sep"></div>
       <p class="t-centre t-fort">À présenter au retrait</p>
       ${annulation}
       <p class="t-centre">Merci et à bientôt !</p>
       <p class="t-centre t-petit">${escapeAttr(SITE_WEB)}</p>`
    : '';

  return `<section class="ticket ${type === 'production' ? 'prod' : ''}">
  ${entete}
  <p class="t-bande">${escapeAttr(conf.titre)}</p>
  ${identite}

  ${client ? `<div class="t-sep"></div>${client}` : ''}

  <div class="t-sep"></div>
  <table>${enTeteColonnes}${lignes}</table>
  ${totalLigne}

  ${commentaire}
  ${pied}

  <p class="t-pied">imprimé le ${escapeAttr(fmtImpression())}</p>
</section>`;
}

/* Un seul document pour toute la sélection : ouvrir une fenêtre par ticket
   ferait tomber le bloqueur de pop-ups dès le deuxième, et obligerait à
   valider autant de dialogues d'impression. */
function documentTickets(o, types) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escapeAttr(o.code || 'Commande')} — ${escapeAttr(types.map(t => TICKETS[t]?.titre || t).join(' + '))}</title>
<style>
  @page{ size:80mm auto; margin:0; }
  body{ margin:0; font-family:'Courier New', monospace; color:#000; }
  .ticket{
    width:72mm; margin:0 auto;
    /* La marge basse n'est pas décorative : sans elle, la découpe du rouleau
       passe dans la dernière ligne au lieu du vide qui la suit. */
    padding:3mm 0 14mm;
    font-size:12px; line-height:1.35;
  }
  /* Chaque ticket sur son propre bout de rouleau : une page par ticket, tous
     envoyés dans la même commande d'impression. Le break-inside évite qu'un
     ticket long soit coupé en deux au lieu de démarrer une page. */
  .ticket + .ticket{ break-before:page; page-break-before:always; }
  .ticket{ break-inside:avoid; page-break-inside:avoid; }

  /* Repère de découpe visible seulement à l'écran, dans la fenêtre qui
     s'ouvre avant le dialogue : sinon rien ne montre où les tickets se
     séparent, et on croit qu'ils sortiront collés. */
  @media screen{
    body{ background:#e9e6e1; padding:8px 0; }
    .ticket{ background:#fff; box-shadow:0 2px 8px rgba(0,0,0,.15); }
    .ticket + .ticket{ margin-top:14px; position:relative; }
    .ticket + .ticket::before{
      content:'✂ - - - - - - - - - - - - - - - - - -';
      position:absolute; top:-13px; left:0; right:0;
      text-align:center; font-size:10px; color:#8a8279;
    }
  }

  h1{ font-size:15px; text-align:center; margin:0 0 2px; letter-spacing:1px; }
  .t-adresse{ text-align:center; font-size:10px; margin:0 0 6px; }

  /* Cadre fin plutôt qu'un aplat noir : sur du thermique un fond plein use
     la tête d'impression et ralentit la sortie pour rien. Le cadre et
     l'espacement des lettres suffisent à retrouver le titre dans une pile. */
  .t-bande{
    border:1px solid #000;
    text-align:center; font-weight:bold; font-size:13px; letter-spacing:3px;
    padding:2px 0; margin:6px 0 5px;
  }

  .t-code{ text-align:center; font-size:22px; font-weight:bold; letter-spacing:2px; margin:0 0 6px; }
  .t-jour-libelle{ text-align:center; font-size:10px; letter-spacing:2px; margin:0; }
  .t-jour{ text-align:center; font-size:16px; font-weight:bold; margin:0 0 4px; }
  /* L'heure est ce qu'on cherche en premier au comptoir quand la journée est
     chargée : elle se lit plus gros que le jour. */
  .t-heure{ text-align:center; font-size:20px; font-weight:bold; margin:0 0 4px; }
  .t-rappel{ text-align:center; font-size:12px; margin:2px 0 4px; }

  .t-sep{ border-top:1px dashed #000; margin:5px 0; }
  .t-sep-fort{ border-top:2px solid #000; margin:5px 0; }

  table{ width:100%; border-collapse:collapse; margin:5px 0; }
  td{ padding:1px 0; vertical-align:top; }
  /* Quatre colonnes sur 72 mm : le nom se replie sous lui-même, les colonnes
     chiffrées gardent leur largeur, sinon un prix finirait hors du rouleau —
     c'est exactement ce qui tronque les tickets de la caisse. */
  .t-qte{ width:11%; font-weight:bold; white-space:nowrap; }
  .t-nom{ word-break:break-word; padding-right:3px; font-size:11px; }
  .t-pu{ width:21%; text-align:right; white-space:nowrap; font-size:11px; }
  .t-prix{ width:24%; text-align:right; white-space:nowrap; }
  .t-colonnes td{ font-size:9px; letter-spacing:1px; border-bottom:1px solid #000; padding-bottom:2px; }
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

  .t-petit{ font-size:10px; }
  .t-pied{ text-align:center; font-size:9px; margin:8px 0 0; }
</style>
</head>
<body>
${types.map(t => corpsTicket(o, t)).join('\n')}
</body>
</html>`;
}

/* Le choix se fait au clic sur « Imprimer » plutôt que dans un menu posé en
   permanence sur chaque carte : on n'y pense qu'au moment d'imprimer, et
   plusieurs tickets partent souvent ensemble — le client et la production
   pour une même commande, par exemple. */
function choisirTypesTickets(o) {
  return new Promise(resolve => {
    const overlay = document.getElementById('printOverlay');
    const cases = [...overlay.querySelectorAll('input[type="checkbox"]')];
    const ok = document.getElementById('printOk');
    const cancel = document.getElementById('printCancel');

    document.getElementById('printSub').textContent =
      `Commande ${o.code || ''} — cochez tout ce qu'il vous faut. Chaque ticket part dans sa propre impression, pour que le papier soit coupé entre chacun.`;

    // Rien de coché n'imprimerait rien : le bouton le dit avant le clic.
    const majBouton = () => { ok.disabled = !cases.some(c => c.checked); };
    cases.forEach(c => c.addEventListener('change', majBouton));
    majBouton();

    overlay.hidden = false;

    function fermer(resultat) {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onFond);
      cases.forEach(c => c.removeEventListener('change', majBouton));
      resolve(resultat);
    }
    const onOk = () => fermer(cases.filter(c => c.checked).map(c => c.value));
    const onCancel = () => fermer(null);
    const onFond = e => { if (e.target === overlay) fermer(null); };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onFond);
  });
}

/* Un ticket, une impression, dans la même fenêtre réécrite entre chaque.
   Tout envoyer en un seul document de plusieurs pages semblait plus simple,
   mais une imprimante thermique coupe le papier à la fin d'un travail
   d'impression, pas entre deux pages du même travail : les tickets
   sortaient en une seule bande. En contrepartie, le navigateur ouvre un
   dialogue par ticket — sauf s'il est lancé en impression directe
   (Chrome --kiosk-printing), où la série s'enchaîne toute seule. */
function imprimerUnTicket(fenetre, html) {
  return new Promise(resolve => {
    let fini = false;
    let secours = null;

    function suite() {
      if (fini) return;
      fini = true;
      clearTimeout(secours);
      fenetre.removeEventListener('afterprint', suite);
      resolve();
    }

    fenetre.document.open();
    fenetre.document.write(html);
    fenetre.document.close();

    fenetre.addEventListener('afterprint', suite);

    /* `document.close()` peut avoir déjà déclenché le load : un `onload` posé
       après ne partirait alors jamais. On imprime donc tout de suite si le
       document est prêt, et on attend seulement s'il ne l'est pas. */
    const lancer = () => {
      fenetre.focus();
      fenetre.print();
      /* print() rend la main une fois le dialogue fermé, mais tous les
         navigateurs n'émettent pas afterprint : sans ce filet, une série
         s'arrêterait au premier ticket. */
      secours = setTimeout(suite, 700);
    };

    if (fenetre.document.readyState === 'complete') lancer();
    else fenetre.addEventListener('load', lancer, { once: true });
  });
}

async function imprimerCommande(id) {
  const o = ordersCache.find(x => x.id === id);
  if (!o) return;

  const types = await choisirTypesTickets(o);
  if (!types || !types.length) return;

  const fenetre = window.open('', '_blank', 'width=400,height=600');
  if (!fenetre) {
    showStatus("Le navigateur a bloqué l'ouverture de la fenêtre d'impression (pop-up).", true);
    return;
  }

  for (const [i, type] of types.entries()) {
    // La fenêtre a pu être fermée à la main au milieu de la série.
    if (fenetre.closed) {
      showStatus(`Impression interrompue : ${i} ticket${i > 1 ? 's' : ''} sur ${types.length}.`, true);
      return;
    }
    if (types.length > 1) {
      showStatus(`Impression ${i + 1} sur ${types.length} — ${TICKETS[type]?.titre || type}…`);
    }
    await imprimerUnTicket(fenetre, documentTickets(o, [type]));
  }

  if (!fenetre.closed) fenetre.close();
  showStatus(`Commande ${o.code || ''} — ${types.length} ticket${types.length > 1 ? 's' : ''} envoyé${types.length > 1 ? 's' : ''} à l'imprimante.`);
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
/* ---------- Numérotation des commandes ---------- */
/* Le compteur vit dans `compteurs/commandes`, champ `dernier` : c'est le
   Worker qui l'incrémente à chaque commande. Le remettre à zéro fait
   réattribuer des codes déjà donnés à des clients, d'où le rôle exigé ici
   et, surtout, la règle Firestore qui refuse l'écriture aux autres. */
const COMPTEUR_COMMANDES = 'commandes';

async function afficherCompteur() {
  const etat = document.getElementById('compteurEtat');
  if (!etat) return;
  try {
    const snap = await getDoc(doc(db, 'compteurs', COMPTEUR_COMMANDES));
    const dernier = snap.exists() ? (snap.data().dernier || 0) : 0;
    etat.textContent = dernier
      ? `Dernier code attribué : SITE${String(dernier).padStart(4, '0')} — le prochain sera SITE${String(dernier + 1).padStart(4, '0')}.`
      : 'Aucun code encore attribué : la prochaine commande sera SITE0001.';
  } catch (err) {
    etat.textContent = 'Compteur illisible : ' + err.message;
  }
}

async function reinitialiserCompteur() {
  const ok = await confirmDialog(
    'Remettre la numérotation à SITE0001 ?',
    'La prochaine commande reprendra le code SITE0001. Si des commandes existent déjà avec ce code, elles deviendront impossibles à distinguer.'
  );
  if (!ok) return;

  try {
    await setDoc(doc(db, 'compteurs', COMPTEUR_COMMANDES), { dernier: 0 });
    showStatus('Numérotation remise à zéro : la prochaine commande sera SITE0001.');
    await afficherCompteur();
  } catch (err) {
    showStatus('Remise à zéro refusée : ' + err.message, true);
  }
}

/* Le panel n'est qu'un habillage : ce sont les règles Firestore qui
   refusent réellement l'écriture. Masquer la carte évite d'offrir un bouton
   qui échouerait. */
export function appliquerRoleOrders(role) {
  const carte = document.getElementById('compteurCarte');
  if (!carte) return;
  carte.hidden = role !== 'superadmin';
  if (role === 'superadmin') afficherCompteur();
}

/* Un compte comptoir n'a rien d'autre à voir : pas de croix pour revenir
   à un panel sur lequel il n'a de toute façon aucun droit (les règles
   Firestore le refuseraient), et une vraie déconnexion à la place — sans
   ça, ce poste resterait ouvert tant que personne n'y pense. Les données
   restent protégées même si cet appel n'était jamais fait : c'est
   `firestore.rules` qui fait le travail, ceci n'est que l'habillage qui
   évite d'afficher des pages qui échoueraient. */
export function entrerModeComptoir() {
  document.getElementById('jourjQuitter').hidden = true;
  const deco = document.getElementById('jourjDeconnexion');
  deco.hidden = false;
  deco.addEventListener('click', () => signOut(auth));
  ouvrirModeJourJ();
}

export function initOrders() {
  chargerCodeSortie();

  const prepaDate = document.getElementById('prepaDate');
  if (prepaDate && !prepaDate.value) prepaDate.value = dateDuJour();
  prepaDate?.addEventListener('change', renderPrepa);

  document.getElementById('ordersFiltre').addEventListener('change', renderOrders);
  document.getElementById('ordersRecherche').addEventListener('input', renderOrders);
  document.getElementById('ordersRefresh').addEventListener('click', loadOrders);
  document.getElementById('compteurReset')?.addEventListener('click', reinitialiserCompteur);

  document.getElementById('modeJourJBtn')?.addEventListener('click', ouvrirModeJourJ);
  document.getElementById('jourjQuitter')?.addEventListener('click', demanderCodeSortie);
  document.getElementById('jourjRecherche')?.addEventListener('input', renderJourJ);
  document.getElementById('jourjDate')?.addEventListener('change', renderJourJ);
  document.getElementById('jourjAujourdhui')?.addEventListener('click', () => {
    document.getElementById('jourjDate').value = dateDuJour();
    renderJourJ();
  });
  document.getElementById('jourjToutesDates')?.addEventListener('click', () => {
    document.getElementById('jourjDate').value = '';
    renderJourJ();
  });

  document.getElementById('jourjPinValider')?.addEventListener('click', validerCodeSortie);
  document.getElementById('jourjPinAnnuler')?.addEventListener('click', annulerCodeSortie);
  document.getElementById('jourjPinInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') validerCodeSortie();
  });

  document.getElementById('codeSortieInput')?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });
  document.getElementById('codeSortieBtn')?.addEventListener('click', enregistrerCodeSortie);
}

async function enregistrerCodeSortie() {
  const input = document.getElementById('codeSortieInput');
  const valeur = input.value.trim();
  if (!/^\d{4}$/.test(valeur)) {
    showStatus('Le code doit comporter exactement 4 chiffres.', true);
    return;
  }
  try {
    await setDoc(doc(db, 'settings', 'noel'), { codeSortieJourJ: valeur }, { merge: true });
    codeSortieJourJ = valeur;
    input.value = '';
    input.placeholder = '••••';
    showStatus('Code de sortie mis à jour ✓');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
}
