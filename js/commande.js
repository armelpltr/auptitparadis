// ============================================================
// COMMANDE.JS — page publique de réservation des commandes de Noël
//
// Le catalogue et la période sont lus dans Firestore. La commande, elle,
// part vers le Worker : les règles interdisent au navigateur d'écrire dans
// `orders`, faute de quoi la vérification anti-robot ne servirait à rien.
// ============================================================

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const WORKER_URL = 'https://auptitparadis-worker.armelpltr14-ad6.workers.dev';

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
        commentaire: $('ordCommentaire').value.trim()
      })
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      resetTurnstile();
      afficherErreur(body.duplicate && body.code
        ? `${body.error} Votre code est le ${body.code}. Passez en boutique pour la confirmer ou la modifier.`
        : (body.error || `La réservation a échoué (erreur ${res.status}).`));
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
  $('succesDetail').textContent = date
    ? `Retrait le ${date} — ${euros.format(body.total || 0)} à régler sur place.`
    : '';

  // Ne rien promettre que le serveur n'ait fait : il répond s'il a écrit
  // au client ou non.
  const email = $('succesEmail');
  email.hidden = !body.emailEnvoye;
  if (body.emailEnvoye) {
    email.textContent = `Une confirmation vient de vous être envoyée à ${body.email}.`;
  }

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

  $('commandeBody').hidden = false;
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
