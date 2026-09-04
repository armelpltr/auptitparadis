// ============================================================
// STAGES.JS — page publique des ateliers
//
// Les séances sont lues dans Firestore, qui les ouvre à tout le monde :
// elles n'ont rien de confidentiel, et la page doit s'afficher sans compte.
// L'inscription, elle, part vers le Worker — les règles interdisent au
// navigateur d'écrire dans `inscriptions`, faute de quoi la vérification
// anti-robot ne servirait à rien et une place se prendrait sans passer par
// le décompte.
//
// Le nombre de places restantes vient d'un compteur posé sur la séance
// (`placesPrises`), et non des inscriptions elles-mêmes : celles-ci portent
// des prénoms d'enfants et ne sont lisibles par personne d'autre que le
// panel. Un compteur public dit ce qu'il faut savoir — combien il reste —
// sans rien dire de qui a réservé.
// ============================================================

import { db } from "./firebase-config.js";
import { WORKER_URL } from "./config.js";
import {
  doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_PARTICIPANTS = 6;   // doit rester aligné sur worker/src/stages.js

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const jourLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long'
});

let seances = [];
let choisie = null;
/* Un participant = une ligne du formulaire. On garde la saisie en mémoire
   plutôt que de relire le DOM à chaque frappe : la liste se redessine quand
   on ajoute ou retire une ligne, et une valeur tapée ne doit pas disparaître
   avec le redessin. */
let participants = [{ prenom: '', nom: '', age: '' }];

const $ = id => document.getElementById(id);

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

function dateDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function fmtJour(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : jourLong.format(d);
}

function fmtCreneau(s) {
  if (!s.heureDebut) return '';
  const debut = String(s.heureDebut).replace(':', 'h');
  return s.heureFin ? `${debut} – ${String(s.heureFin).replace(':', 'h')}` : debut;
}

/* « Dès 6 ans », « 6 à 10 ans », « à partir de 16 ans »… Une seule borne
   suffit souvent : inutile d'inventer un maximum pour un atelier d'adultes,
   ni un minimum pour un atelier qui accueille tout le monde. */
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
  const prises = Number(s.placesPrises) || 0;
  return Math.max(0, total - prises);
}

/* ---------- Liste des séances ---------- */

/* Repli quand une séance n'a pas encore sa photo. Un dessin plutôt qu'un
   rectangle vide, et surtout pas une carte sans image : deux cartes voisines
   dont l'une seulement porte une photo se décalent, et la liste donne
   l'impression d'être à moitié remplie. Le motif est ici en dur, non
   téléchargé : une image de secours qui met du temps à venir ne vaut pas
   mieux qu'un trou. */
const SEANCE_SANS_PHOTO = `
  <div class="seance-photo seance-photo--vide" aria-hidden="true">
    <svg viewBox="0 0 64 64">
      <path d="M14 40h36" />
      <path d="M20 40c0-8 5.4-14 12-14s12 6 12 14" />
      <path d="M24 26c0-3 1.6-5 3.6-5 1.3 0 2.2.7 2.7 1.7.6-1.9 2-3.2 3.9-3.2 2.3 0 4 1.9 4 4.4 0 .7-.1 1.4-.4 2" />
      <path d="M11 46h42" />
      <circle cx="32" cy="17" r="1.6" />
    </svg>
  </div>`;

function renderSeances() {
  const liste = $('seancesListe');
  const hint = $('seancesHint');

  if (!seances.length) {
    hint.textContent = "Aucune séance à l'affiche pour le moment. Revenez avant les prochaines vacances.";
    liste.innerHTML = '';
    return;
  }
  hint.hidden = true;

  liste.innerHTML = seances.map(s => {
    const restant = placesRestantes(s);
    const complet = restant <= 0;
    const img = safeUrl(s.imageUrl);
    const creneau = fmtCreneau(s);

    return `
      <article class="seance-carte ${complet ? 'is-complet' : ''} ${choisie === s.id ? 'is-choisie' : ''}" data-id="${escapeHTML(s.id)}">
        ${img
          ? `<img class="seance-photo" src="${escapeHTML(img)}" alt="${escapeHTML(s.nom)}" loading="lazy">`
          : SEANCE_SANS_PHOTO}
        <div class="seance-corps">
          <p class="seance-date">${escapeHTML(fmtJour(s.date))}${creneau ? ` · ${escapeHTML(creneau)}` : ''}</p>
          <h3>${escapeHTML(s.nom || 'Atelier')}</h3>
          ${s.description ? `<p class="seance-desc">${escapeHTML(s.description)}</p>` : ''}
          <p class="seance-meta">
            <span class="seance-ages">${escapeHTML(fmtAges(s))}</span>
            <span class="seance-prix">${escapeHTML(euros.format(s.prix || 0))} par participant</span>
          </p>
          ${complet
            ? '<p class="seance-complet">Séance complète</p>'
            : `<p class="seance-places ${restant <= 3 ? 'is-tendu' : ''}">
                 ${restant} place${restant > 1 ? 's' : ''} restante${restant > 1 ? 's' : ''}
               </p>
               <button type="button" class="btn btn-primary btn-small seance-choisir">
                 ${choisie === s.id ? 'Séance choisie ✓' : 'Choisir cette séance'}
               </button>`}
        </div>
      </article>`;
  }).join('');

  liste.querySelectorAll('.seance-carte').forEach(carte => {
    const bouton = carte.querySelector('.seance-choisir');
    if (bouton) bouton.addEventListener('click', () => choisirSeance(carte.dataset.id));
  });
}

function choisirSeance(id) {
  choisie = id;
  renderSeances();
  renderChoix();
  renderParticipants();

  // Sur téléphone le formulaire est sous la liste : sans ce défilement, le
  // clic semble n'avoir rien fait.
  $('stageForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Récapitulatif de la séance choisie ---------- */

function renderChoix() {
  const bloc = $('stageChoix');
  const s = seances.find(x => x.id === choisie);

  if (!s) {
    bloc.innerHTML = '<p class="panier-vide">Choisissez d\'abord une séance dans la liste.</p>';
    $('stageParticipantsBloc').hidden = true;
    $('stageTotal').hidden = true;
    $('stageSubmit').disabled = true;
    return;
  }

  const creneau = fmtCreneau(s);
  bloc.innerHTML = `
    <div class="stage-choix-carte">
      <p class="stage-choix-nom">${escapeHTML(s.nom || 'Atelier')}</p>
      <p class="stage-choix-quand">${escapeHTML(fmtJour(s.date))}${creneau ? ` · ${escapeHTML(creneau)}` : ''}</p>
      <p class="stage-choix-prix">${escapeHTML(euros.format(s.prix || 0))} par participant · ${escapeHTML(fmtAges(s))}</p>
    </div>`;

  $('stageParticipantsBloc').hidden = false;
  $('stageSubmit').disabled = false;
  majTotal();
}

/* ---------- Participants ---------- */

function renderParticipants() {
  const conteneur = $('participantsListe');

  conteneur.innerHTML = participants.map((p, i) => `
    <div class="participant-ligne" data-index="${i}">
      <div class="form-field">
        <label for="part-prenom-${i}">Prénom</label>
        <input type="text" id="part-prenom-${i}" class="part-prenom" maxlength="40"
               value="${escapeHTML(p.prenom)}" required>
      </div>
      <div class="form-field">
        <label for="part-nom-${i}">Nom <span class="form-optional">(facultatif)</span></label>
        <input type="text" id="part-nom-${i}" class="part-nom" maxlength="40" value="${escapeHTML(p.nom)}">
      </div>
      <div class="form-field participant-age">
        <label for="part-age-${i}">Âge</label>
        <input type="text" inputmode="numeric" id="part-age-${i}" class="part-age" maxlength="2"
               value="${escapeHTML(p.age)}" placeholder="—">
      </div>
      ${participants.length > 1
        ? `<button type="button" class="row-remove participant-retirer" title="Retirer ce participant" aria-label="Retirer ce participant">×</button>`
        : ''}
    </div>`).join('');

  conteneur.querySelectorAll('.participant-ligne').forEach(ligne => {
    const i = Number(ligne.dataset.index);
    ligne.querySelector('.part-prenom').addEventListener('input', e => { participants[i].prenom = e.target.value; });
    ligne.querySelector('.part-nom').addEventListener('input', e => { participants[i].nom = e.target.value; });
    ligne.querySelector('.part-age').addEventListener('input', e => {
      // Le champ est libre pour accepter le collage, mais on n'y garde que
      // des chiffres : « 8 ans » partirait sinon en âge invalide.
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2);
      participants[i].age = e.target.value;
    });
    ligne.querySelector('.participant-retirer')?.addEventListener('click', () => {
      participants.splice(i, 1);
      renderParticipants();
      majTotal();
    });
  });

  const ajouter = $('ajouterParticipant');
  const restant = choisie ? placesRestantes(seances.find(s => s.id === choisie) || {}) : 0;
  ajouter.disabled = participants.length >= Math.min(MAX_PARTICIPANTS, Math.max(1, restant));
  majTotal();
}

function majTotal() {
  const s = seances.find(x => x.id === choisie);
  const bloc = $('stageTotal');
  if (!s) { bloc.hidden = true; return; }

  $('stageTotalValeur').textContent = euros.format((Number(s.prix) || 0) * participants.length);
  bloc.hidden = false;
}

/* ---------- Envoi ---------- */

function afficherErreur(message) {
  const el = $('stageErreur');
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

async function envoyerInscription(e) {
  e.preventDefault();
  $('stageErreur').hidden = true;

  // Le piège n'est rempli que par un robot : on s'arrête sans rien envoyer.
  if ($('stgWebsite').value.trim() !== '') return;

  if (!choisie) { afficherErreur('Choisissez une séance avant de valider.'); return; }

  const propres = participants
    .map(p => ({ prenom: p.prenom.trim(), nom: p.nom.trim(), age: p.age.trim() }))
    .filter(p => p.prenom || p.nom || p.age);

  if (!propres.length || propres.some(p => p.prenom.length < 2)) {
    afficherErreur('Indiquez au moins le prénom de chaque participant.');
    return;
  }

  const prenom = $('stgPrenom').value.trim();
  const nom    = $('stgNom').value.trim();
  const tel    = $('stgTel').value.trim();
  const email  = $('stgEmail').value.trim();

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

  const jeton = $('stageForm').querySelector('[name="cf-turnstile-response"]');
  if (!jeton || !jeton.value) {
    afficherErreur("La vérification anti-robot n'est pas terminée. Patientez un instant, puis réessayez.");
    return;
  }

  const bouton = $('stageSubmit');
  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';

  try {
    const res = await fetch(`${WORKER_URL}/stage/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnstileToken: jeton.value,
        stageId: choisie,
        participants: propres,
        client: { prenom, nom, telephone: tel, email },
        commentaire: $('stgCommentaire').value.trim()
      })
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      resetTurnstile();
      /* Une séance devenue complète pendant la saisie : on recharge les
         places avant d'afficher l'erreur, pour que la liste dise la même
         chose que le message. */
      if (res.status === 409) await rechargerSeances();
      afficherErreur(body.error || `L'inscription a échoué (erreur ${res.status}).`);
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
  $('stageSuccesCode').textContent = body.code || '';

  const creneau = body.heureDebut
    ? ` · ${String(body.heureDebut).replace(':', 'h')}${body.heureFin ? ` – ${String(body.heureFin).replace(':', 'h')}` : ''}`
    : '';
  const places = body.nbParticipants > 1 ? `${body.nbParticipants} places` : '1 place';
  $('stageSuccesDetail').textContent =
    `${body.stageNom || 'Atelier'} — ${fmtJour(body.date)}${creneau} · ${places} · ${euros.format(body.total || 0)} à régler sur place.`;

  // Ne rien promettre que le serveur n'ait fait : il répond s'il a écrit
  // au client ou non.
  const email = $('stageSuccesEmail');
  email.hidden = !body.emailEnvoye;
  if (body.emailEnvoye) {
    email.textContent = `Une confirmation vient de vous être envoyée à ${body.email}.`;
  }

  $('stageHead').hidden = true;
  $('stageBody').hidden = true;
  $('stageSucces').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Chargement ---------- */

/* Les séances passées ne sont pas effacées — le panel garde l'historique —
   mais elles n'ont rien à faire sur la page : on filtre sur la date du
   jour, comme le Worker le fait de son côté au moment de réserver. */
async function rechargerSeances() {
  const aujourdhui = dateDuJour();
  try {
    const snap = await getDocs(query(collection(db, 'stages'), orderBy('date', 'asc')));
    seances = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.visible !== false && (s.nom || '').trim() && s.date >= aujourdhui);
  } catch (err) {
    console.error('Séances illisibles :', err.message);
    seances = [];
  }

  // La séance choisie a pu disparaître ou se remplir entre-temps.
  if (choisie && !seances.some(s => s.id === choisie && placesRestantes(s) > 0)) {
    choisie = null;
  }

  renderSeances();
  renderChoix();
}

(async () => {
  let reglages = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'stages'));
    reglages = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.error('Réglages des ateliers illisibles :', err.message);
  }

  /* La photo de la page vient du panel. Sans elle, le bandeau garde la
     texture posée dans le HTML : on ne remplace que si l'adresse est
     sûre, une valeur d'admin finissant dans un `src`. */
  const bandeau = safeUrl(reglages.imageUrl);
  if (bandeau) {
    $('stageBandeau').src = bandeau;
    /* La description par défaut parle de la devanture : elle deviendrait
       fausse dès qu'une autre photo prend sa place. On ne sait pas ce que
       montre celle-là, alors on dit le peu qu'on sait, plutôt que de
       laisser une description à côté de la plaque. */
    $('stageBandeau').alt = "Un atelier à la boulangerie Au P'tit Paradis.";
  }

  if (reglages.message) {
    $('stageMessage').textContent = reglages.message;
    $('stageMessage').hidden = false;
  }

  await rechargerSeances();

  /* Fermé, ou ouvert sans aucune séance à venir : dans les deux cas il n'y
     a rien à réserver, et un formulaire à moitié actif serait pire qu'un
     refus franc. La présentation, elle, reste affichée — c'est justement
     ce qui donne envie de revenir. */
  if (reglages.ouvert !== true || !seances.length) {
    $('stageClosed').hidden = false;
    return;
  }

  $('stageBody').hidden = false;
  renderParticipants();

  $('ajouterParticipant').addEventListener('click', () => {
    if (participants.length >= MAX_PARTICIPANTS) return;
    participants.push({ prenom: '', nom: '', age: '' });
    renderParticipants();
  });

  $('stageForm').addEventListener('submit', envoyerInscription);
})();
