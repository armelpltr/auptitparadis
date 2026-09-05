// ============================================================
// ATELIERS-ACCUEIL.JS — aperçu des ateliers sur la page d'accueil
//
// Même source que stages.html : les séances sont publiques dans Firestore,
// le compteur `placesPrises` dit ce qu'il reste sans rien révéler de qui a
// réservé. Ici on ne fait que montrer : pas de formulaire, pas d'écriture,
// donc ni Worker ni vérification anti-robot sur l'accueil.
//
// Rien ne s'affiche tant que les dates ne sont pas là. Une section qui ne
// promet pas de dates vaut mieux qu'un « chargement… » figé si Firestore
// ne répond pas — la présentation, elle, est déjà dans le HTML.
// ============================================================

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_AFFICHEES = 3;   // au-delà, l'aperçu devient la page des ateliers

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const jourCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' });
const moisCourt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

const $ = id => document.getElementById(id);

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function dateDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function fmtCreneau(s) {
  if (!s.heureDebut) return '';
  const debut = String(s.heureDebut).replace(':', 'h');
  return s.heureFin ? `${debut} – ${String(s.heureFin).replace(':', 'h')}` : debut;
}

/* Mêmes bornes d'âge que sur la page des ateliers : une seule suffit souvent. */
function fmtAges(s) {
  const min = Number.isInteger(s.ageMin) ? s.ageMin : null;
  const max = Number.isInteger(s.ageMax) ? s.ageMax : null;
  if (min && max) return `${min} à ${max} ans`;
  if (min) return `dès ${min} ans`;
  if (max) return `jusqu'à ${max} ans`;
  return 'tous les âges';
}

function placesRestantes(s) {
  const total = Number.isInteger(s.places) ? s.places : 0;
  return Math.max(0, total - (Number(s.placesPrises) || 0));
}

function renderSeances(seances) {
  $('ateliersSeances').innerHTML = seances.map(s => {
    const d = new Date(`${s.date}T12:00:00`);
    const valide = !Number.isNaN(d.getTime());
    const restant = placesRestantes(s);
    const creneau = fmtCreneau(s);
    const meta = [creneau, fmtAges(s), euros.format(Number(s.prix) || 0)]
      .filter(Boolean).join(' · ');

    return `
      <li>
        <a class="ateliers-seance ${restant <= 0 ? 'is-complet' : ''}" href="stages.html">
          <span class="as-date" aria-hidden="true">
            <span class="as-jour">${escapeHTML(valide ? jourCourt.format(d) : '—')}</span>
            <span class="as-mois">${escapeHTML(valide ? moisCourt.format(d).replace('.', '') : '')}</span>
          </span>
          <span class="as-corps">
            <span class="as-nom">${escapeHTML(s.nom || 'Atelier')}</span>
            <span class="as-meta">${escapeHTML(meta)}</span>
          </span>
          ${restant <= 0
            ? '<span class="as-places as-complet">Complet</span>'
            : `<span class="as-places ${restant <= 3 ? 'is-tendu' : ''}">${restant} place${restant > 1 ? 's' : ''}</span>`}
        </a>
      </li>`;
  }).join('');
}

(async () => {
  // La section vit dans l'accueil seulement : ailleurs, on ne fait rien.
  if (!$('ateliersDates')) return;

  let reglages = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'stages'));
    reglages = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn('Réglages des ateliers illisibles :', err.message);
    return;
  }

  if (reglages.message) {
    $('ateliersMessage').textContent = reglages.message;
    $('ateliersMessage').hidden = false;
  }

  /* Filtre sur la date du jour côté serveur : `where` et `orderBy` portent
     sur le même champ, aucun index composé n'est nécessaire. On en demande
     quelques-unes de plus que les trois affichées, le temps d'écarter les
     séances masquées ou sans nom. */
  let seances = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'stages'),
      where('date', '>=', dateDuJour()),
      orderBy('date', 'asc'),
      limit(MAX_AFFICHEES * 3)
    ));
    seances = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.visible !== false && (s.nom || '').trim())
      .slice(0, MAX_AFFICHEES);
  } catch (err) {
    console.warn('Séances illisibles :', err.message);
    return;
  }

  const ouvert = reglages.ouvert === true && seances.length > 0;

  if (ouvert) {
    renderSeances(seances);
    $('ateliersCta').textContent = "S'inscrire à un atelier";
  } else {
    /* Fermé, ou plus rien à venir : on le dit franchement plutôt que de
       renvoyer vers une page d'inscription qui n'a rien à proposer. Le
       bouton, lui, reste — la page des ateliers explique le principe. */
    $('ateliersVide').hidden = false;
  }

  $('ateliersDates').hidden = false;
})();
