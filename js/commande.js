// ============================================================
// COMMANDE.JS — page publique de réservation des commandes de Noël
//
// Le catalogue et la période sont lus dans Firestore. La commande, elle,
// part vers le Worker : les règles interdisent au navigateur d'écrire dans
// `orders`, faute de quoi la vérification anti-robot ne servirait à rien.
// ============================================================

import { db } from "./firebase-config.js";
import { WORKER_URL } from "./config.js";
import {
  doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_QUANTITE = 20;   // doit rester aligné sur worker/src/orders.js

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long'
});

/* Le panier : identifiant de produit → quantité. */
const panier = new Map();
let catalogue = [];

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

/* Une URL de photo vient de l'admin et finit dans un src. */
function safeUrl(url) {
  const raw = String(url ?? '').trim();
  return /^https?:\/\//i.test(raw) || /^[./]/.test(raw) ? raw : '';
}

const $ = id => document.getElementById(id);

/* ---------- Catalogue ---------- */

function renderCatalogue() {
  const grid = $('produitsGrid');
  const hint = $('catalogueHint');

  if (!catalogue.length) {
    hint.textContent = "Le catalogue n'est pas encore en ligne. Revenez d'ici quelques jours.";
    grid.innerHTML = '';
    return;
  }
  hint.hidden = true;

  grid.innerHTML = catalogue.map(p => {
    const rupture = p.disponible === false;
    const img = safeUrl(p.imageUrl);
    return `
      <article class="produit-carte ${rupture ? 'is-rupture' : ''}" data-id="${escapeHTML(p.id)}">
        ${img
          ? `<img class="produit-photo" src="${escapeHTML(img)}" alt="${escapeHTML(p.nom)}" loading="lazy">`
          : '<div class="produit-photo produit-photo--vide" aria-hidden="true"></div>'}
        <div class="produit-corps">
          <h3>${escapeHTML(p.nom)}</h3>
          ${p.description ? `<p>${escapeHTML(p.description)}</p>` : ''}
          <p class="produit-prix">${escapeHTML(euros.format(p.prix || 0))}</p>
        </div>
        ${rupture
          ? '<p class="produit-rupture">Épuisé pour cette saison</p>'
          : `<div class="produit-stepper">
               <button type="button" class="stepper-btn" data-pas="-1" aria-label="Retirer un ${escapeHTML(p.nom)}">−</button>
               <output class="stepper-valeur">0</output>
               <button type="button" class="stepper-btn" data-pas="1" aria-label="Ajouter un ${escapeHTML(p.nom)}">+</button>
             </div>`}
      </article>`;
  }).join('');

  grid.querySelectorAll('.produit-carte').forEach(carte => {
    carte.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        changerQuantite(carte.dataset.id, Number(btn.dataset.pas));
      });
    });
  });
}

function changerQuantite(id, pas) {
  const actuel = panier.get(id) || 0;
  const suivant = Math.min(MAX_QUANTITE, Math.max(0, actuel + pas));

  if (suivant === 0) panier.delete(id);
  else panier.set(id, suivant);

  const output = document.querySelector(`.produit-carte[data-id="${CSS.escape(id)}"] .stepper-valeur`);
  if (output) output.textContent = String(suivant);

  renderPanier();
}

/* ---------- Panier ---------- */

function renderPanier() {
  const lignes = $('panierLignes');
  const totalBloc = $('panierTotal');

  if (!panier.size) {
    lignes.innerHTML = '<p class="panier-vide">Votre panier est vide.</p>';
    totalBloc.hidden = true;
    $('commandeSubmit').disabled = true;
    return;
  }

  let total = 0;
  lignes.innerHTML = [...panier].map(([id, quantite]) => {
    const p = catalogue.find(x => x.id === id);
    if (!p) return '';
    const sousTotal = (p.prix || 0) * quantite;
    total += sousTotal;
    return `
      <div class="panier-ligne">
        <span class="panier-qte">${quantite}×</span>
        <span class="panier-nom">${escapeHTML(p.nom)}</span>
        <span class="panier-prix">${escapeHTML(euros.format(sousTotal))}</span>
      </div>`;
  }).join('');

  $('panierTotalValeur').textContent = euros.format(total);
  totalBloc.hidden = false;
  $('commandeSubmit').disabled = false;
}

/* ---------- Jours de retrait ---------- */
/* Un <select> plutôt qu'un <input type="date"> : la plage est courte et
   fermée, et un calendrier laisserait croire que toutes les dates valent. */
function remplirDates(dateDebut, dateFin) {
  const select = $('ordDate');
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const debut = dateDebut < aujourdhui ? aujourdhui : dateDebut;

  const options = [];
  const curseur = new Date(`${debut}T12:00:00`);   // midi : à l'abri des décalages horaires
  const fin = new Date(`${dateFin}T12:00:00`);

  while (curseur <= fin && options.length < 60) {
    const iso = curseur.toISOString().slice(0, 10);
    options.push(`<option value="${iso}">${escapeHTML(jourLong.format(curseur))}</option>`);
    curseur.setDate(curseur.getDate() + 1);
  }

  select.innerHTML = options.join('');
  return options.length > 0;
}

/* ---------- Heures de retrait ---------- */
/* Des créneaux et non une heure libre : la boutique n'est pas ouverte à
   toute heure, et un champ libre produit des demandes intenables. La plage
   et l'espacement viennent des réglages ; sans plage, on ne demande que le
   jour, comme avant. */
function remplirHeures(heureDebut, heureFin, pasMinutes) {
  if (!heureDebut || !heureFin) return false;

  const enMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };

  const debut = enMinutes(heureDebut);
  const fin   = enMinutes(heureFin);
  const pas   = [15, 30, 60].includes(Number(pasMinutes)) ? Number(pasMinutes) : 30;
  if (debut === null || fin === null || fin < debut) return false;

  const options = [];
  for (let m = debut; m <= fin && options.length < 96; m += pas) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    options.push(`<option value="${hhmm}">${escapeHTML(hhmm.replace(':', 'h'))}</option>`);
  }
  if (!options.length) return false;

  $('ordHeure').innerHTML = options.join('');
  $('ordHeureChamp').hidden = false;
  $('ordHeure').required = true;
  return true;
}

/* ---------- Liste déroulante habillée ---------- */
/* La liste ouverte d'un <select> est dessinée par le système : ni sa police,
   ni ses couleurs, ni ses arrondis ne suivent le reste du formulaire. On la
   remplace par une liste à nous, en gardant le <select> comme source de la
   valeur — le reste du code continue de lire `ordDate.value`. */
function habillerSelecteur(select, labelId) {
  const options = [...select.options];
  if (!options.length) return;

  const bloc = document.createElement('div');
  bloc.className = 'select-perso';

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'select-perso-bouton';
  bouton.setAttribute('role', 'combobox');
  bouton.setAttribute('aria-haspopup', 'listbox');
  bouton.setAttribute('aria-expanded', 'false');
  bouton.setAttribute('aria-labelledby', `${labelId} ${select.id}-valeur`);
  bouton.innerHTML =
    `<span class="select-perso-valeur" id="${select.id}-valeur">${escapeHTML(options[0].textContent)}</span>` +
    `<svg class="select-perso-fleche" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5l5-5"/></svg>`;

  const liste = document.createElement('ul');
  liste.className = 'select-perso-liste';
  liste.id = `${select.id}-liste`;
  liste.setAttribute('role', 'listbox');
  liste.hidden = true;
  liste.innerHTML = options.map((o, i) => `
    <li role="option" id="${select.id}-opt-${i}" data-value="${escapeHTML(o.value)}"
        aria-selected="${i === 0 ? 'true' : 'false'}"
        class="${i === 0 ? 'is-choisie' : ''}">${escapeHTML(o.textContent)}</li>`).join('');

  bouton.setAttribute('aria-controls', liste.id);

  const items = [...liste.children];
  let actif = 0;

  function marquerActif(i) {
    actif = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, n) => el.classList.toggle('is-active', n === actif));
    bouton.setAttribute('aria-activedescendant', items[actif].id);
    items[actif].scrollIntoView({ block: 'nearest' });
  }

  function ouvrir() {
    liste.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
    marquerActif(options.findIndex(o => o.value === select.value));
  }

  function fermer() {
    liste.hidden = true;
    bouton.setAttribute('aria-expanded', 'false');
    bouton.removeAttribute('aria-activedescendant');
  }

  function choisir(i) {
    select.value = items[i].dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    bouton.querySelector('.select-perso-valeur').textContent = items[i].textContent;
    items.forEach((el, n) => {
      el.setAttribute('aria-selected', String(n === i));
      el.classList.toggle('is-choisie', n === i);
    });
    fermer();
    bouton.focus();
  }

  bouton.addEventListener('click', () => (liste.hidden ? ouvrir() : fermer()));
  items.forEach((el, i) => el.addEventListener('click', () => choisir(i)));

  bouton.addEventListener('keydown', e => {
    const ouverte = !liste.hidden;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); ouverte ? marquerActif(actif + 1) : ouvrir(); break;
      case 'ArrowUp':   e.preventDefault(); ouverte ? marquerActif(actif - 1) : ouvrir(); break;
      case 'Home':      if (ouverte) { e.preventDefault(); marquerActif(0); } break;
      case 'End':       if (ouverte) { e.preventDefault(); marquerActif(items.length - 1); } break;
      case 'Enter':
      case ' ':         e.preventDefault(); ouverte ? choisir(actif) : ouvrir(); break;
      case 'Escape':    if (ouverte) { e.preventDefault(); fermer(); } break;
      case 'Tab':       fermer(); break;
    }
  });

  // Un clic ailleurs referme : sans ça la liste resterait ouverte derrière
  // le reste du formulaire.
  document.addEventListener('click', e => {
    if (!liste.hidden && !bloc.contains(e.target)) fermer();
  });

  select.hidden = true;
  bloc.append(bouton, liste);
  select.after(bloc);

  // La valeur affichée doit correspondre à celle que le formulaire enverra.
  select.value = options[0].value;
}

/* ---------- Envoi ---------- */

function afficherErreur(message) {
  const el = $('commandeErreur');
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function resetTurnstile() {
  // Un jeton ne vaut qu'une fois : sans remise à zéro, le second envoi
  // échouerait sur un jeton déjà consommé.
  if (window.turnstile && typeof window.turnstile.reset === 'function') {
    window.turnstile.reset();
  }
}

async function envoyerCommande(e) {
  e.preventDefault();
  $('commandeErreur').hidden = true;

  const form = $('commandeForm');
  const bouton = $('commandeSubmit');

  // Le piège n'est rempli que par un robot : on s'arrête sans rien envoyer.
  if ($('ordWebsite').value.trim() !== '') return;

  const prenom = $('ordPrenom').value.trim();
  const nom    = $('ordNom').value.trim();
  const tel    = $('ordTel').value.trim();
  const email  = $('ordEmail').value.trim();

  if (prenom.length < 2) { afficherErreur('Merci d\'indiquer votre prénom.'); return; }
  if (nom.length < 2)    { afficherErreur('Merci d\'indiquer votre nom.'); return; }
  if (!/^(?:\+33|0)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}$/.test(tel)) {
    afficherErreur('Numéro de téléphone invalide. Exemple : 06 12 34 56 78');
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    afficherErreur('Merci d\'indiquer une adresse e-mail valide.');
    return;
  }

  const jeton = form.querySelector('[name="cf-turnstile-response"]');
  if (!jeton || !jeton.value) {
    afficherErreur("La vérification anti-robot n'est pas terminée. Patientez un instant, puis réessayez.");
    return;
  }

  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';

  try {
    const res = await fetch(`${WORKER_URL}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnstileToken: jeton.value,
        items: [...panier].map(([id, quantite]) => ({ id, quantite })),
        client: { prenom, nom, telephone: tel, email },
        dateRetrait: $('ordDate').value,
        // Vide tant qu'aucune plage horaire n'est réglée : le Worker le sait
        // et n'exige alors pas d'heure.
        heureRetrait: $('ordHeureChamp').hidden ? '' : $('ordHeure').value,
        commentaire: $('ordCommentaire').value.trim()
      })
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      resetTurnstile();
      // Le code de la commande existante n'est plus renvoyé par le Worker :
      // le message qu'il compose se suffit à lui-même.
      afficherErreur(body.error || `La réservation a échoué (erreur ${res.status}).`);
      return;
    }

    afficherSucces(body);
  } catch {
    resetTurnstile();
    afficherErreur("Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.");
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

function afficherSucces(body) {
  $('succesCode').textContent = body.code || '';

  const date = body.dateRetrait ? jourLong.format(new Date(`${body.dateRetrait}T12:00:00`)) : '';
  const heure = body.heureRetrait ? ` à ${body.heureRetrait.replace(':', 'h')}` : '';
  $('succesDetail').textContent = date
    ? `Retrait le ${date}${heure} — ${euros.format(body.total || 0)} à régler sur place.`
    : '';

  // Ne rien promettre que le serveur n'ait fait : il répond s'il a écrit
  // au client ou non.
  const email = $('succesEmail');
  email.hidden = !body.emailEnvoye;
  if (body.emailEnvoye) {
    email.textContent = `Une confirmation vient de vous être envoyée à ${body.email}.`;
  }

  /* L'en-tête et son trait de séparation disparaissent avec le formulaire :
     ils invitent à choisir des produits et à indiquer un jour, ce que la
     personne vient précisément de faire. */
  $('commandeHead').hidden = true;
  $('commandeDivider').hidden = true;
  $('commandeBody').hidden = true;
  $('commandeSucces').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Démarrage ---------- */

(async () => {
  let periode = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'noel'));
    periode = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.error('Période de commande illisible :', err.message);
  }

  if (periode.message) {
    $('commandeMessage').textContent = periode.message;
    $('commandeMessage').hidden = false;
  }

  const datesOk = periode.dateDebut && periode.dateFin
    && remplirDates(periode.dateDebut, periode.dateFin);

  // Fermé, ou ouvert sans jour de retrait restant : dans les deux cas il n'y
  // a rien à réserver, et une page à moitié active serait pire qu'un refus.
  if (periode.ouvert !== true || !datesOk) {
    $('commandeClosed').hidden = false;
    return;
  }

  const heuresOk = remplirHeures(periode.heureDebut, periode.heureFin, periode.pasCreneauMinutes);

  $('commandeBody').hidden = false;
  // Après l'affichage : la liste mesure ses positions, ce qu'un conteneur
  // encore masqué ne permet pas.
  habillerSelecteur($('ordDate'), 'ordDateLabel');
  if (heuresOk) habillerSelecteur($('ordHeure'), 'ordHeureLabel');
  $('commandeForm').addEventListener('submit', envoyerCommande);

  try {
    const snap = await getDocs(query(collection(db, 'noel_produits'), orderBy('order', 'asc')));
    catalogue = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => (p.nom || '').trim());
  } catch (err) {
    console.error('Catalogue illisible :', err.message);
  }
  renderCatalogue();
})();
