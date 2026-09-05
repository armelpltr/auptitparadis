// ============================================================
// ONGLET ATELIERS — séances proposées et personnes inscrites
//
// Collection `stages` (une séance = un document), `inscriptions` pour les
// personnes, et `settings/stages` pour l'ouverture des réservations.
//
// Une séance porte son propre compteur, `placesPrises`. Ce n'est pas un
// doublon des inscriptions : c'est lui que la page publique lit, parce
// qu'elle n'a pas le droit de lire les inscriptions elles-mêmes — elles
// portent des prénoms d'enfants. Le Worker l'incrémente en réservant, et
// ce module le recalcule dès qu'une place est libérée à la main : sans
// cela, une inscription annulée depuis le panel laisserait une place
// occupée par personne.
// ============================================================

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { IB_ICONS } from "./icons.js";
import { createImageUploader } from "./uploader.js";
import { confirmDialog, showSuccess, showStatus, escapeAttr, val, setVal } from "./ui.js";
import { parsePrix, fmtPrix } from "./noel.js";

let seancesCache = [];
let inscriptionsCache = [];
/* Dernier état lu de `settings/stages`. Une séance peut être en ligne sans
   rien afficher : tant que les inscriptions sont fermées, la page publique
   ne liste aucune séance. Le panel doit pouvoir le dire au moment où on
   enregistre, pas seulement dans la carte du haut. */
let reglagesOuvert = false;

const STATUTS = {
  en_attente: { label: 'En attente', suivant: 'confirmee' },
  confirmee:  { label: 'Confirmée',  suivant: 'venue' },
  venue:      { label: 'Venue',      suivant: null },
  annulee:    { label: 'Annulée',    suivant: null }
};

/* Une place n'est réellement prise que par une inscription qui tient
   toujours : une annulation la rend, une personne venue l'a consommée. */
const STATUTS_QUI_OCCUPENT = ['en_attente', 'confirmee', 'venue'];

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function dateDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function fmtJour(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? (iso || '—')
    : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtCreneau(s) {
  if (!s.heureDebut) return '';
  const debut = String(s.heureDebut).replace(':', 'h');
  return s.heureFin ? `${debut} – ${String(s.heureFin).replace(':', 'h')}` : debut;
}

/* Vide = pas de borne, stocké `null` : « aucun minimum » et « à partir de
   0 an » ne veulent pas dire la même chose sur une page. */
function parseAge(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[^\d]/g, ''));
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

function parsePlaces(raw) {
  const n = Number(String(raw ?? '').replace(/[^\d]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function placesPrises(seance) {
  return Number(seance.placesPrises) || 0;
}

/* Ce que le visiteur verra, dit en une phrase. Trois choses peuvent retenir
   une séance parfaitement enregistrée : elle est masquée, sa date est
   passée, ou les inscriptions sont fermées — auquel cas la page publique
   n'affiche aucune séance, même en ligne. Sans cette phrase, « Séance
   enregistrée » laisse croire qu'elle est sur le site. */
function etatPublication(seance) {
  if (seance.visible === false) {
    return { texte: "elle reste masquée et n'apparaît pas sur le site.", ton: 'warn' };
  }
  if ((seance.date || '') < dateDuJour()) {
    return { texte: 'sa date est passée : la page publique ne montre que les séances à venir.', ton: 'warn' };
  }
  if (!reglagesOuvert) {
    return {
      texte: "les inscriptions sont fermées : la page n'affiche aucune séance tant qu'elles le sont.",
      ton: 'warn'
    };
  }
  return { texte: 'elle est en ligne sur le site.', ton: false };
}

function placesRestantes(seance) {
  return Math.max(0, (Number(seance.places) || 0) - placesPrises(seance));
}

/* ---------- Chargement ---------- */

export async function loadStages() {
  try {
    const snap = await getDocs(query(collection(db, 'stages'), orderBy('date', 'asc')));
    seancesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    document.getElementById('stagesList').innerHTML =
      `<p class="empty-hint">Impossible de charger les séances (${escapeAttr(err.message)}).</p>`;
    return;
  }

  try {
    const snap = await getDocs(collection(db, 'inscriptions'));
    inscriptionsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    showStatus('Inscriptions illisibles : ' + err.message, true);
    inscriptionsCache = [];
  }

  renderSeances();
  renderInscriptions();

  try {
    const snap = await getDoc(doc(db, 'settings', 'stages'));
    const s = snap.exists() ? snap.data() : {};
    reglagesOuvert = s.ouvert === true;
    document.getElementById('stages-ouvert').checked = reglagesOuvert;
    setVal('stages-message', s.message || '');

    /* L'uploader est recréé à chaque chargement plutôt que rempli : c'est
       lui qui porte l'aperçu, et poser la valeur dans son champ caché
       laisserait la vignette d'avant à l'écran. */
    const mount = document.querySelector('.stage-page-img-mount');
    if (mount) {
      mount.innerHTML = '';
      mount.appendChild(createImageUploader({
        className: 'stg-page-img', value: s.imageUrl || '', folder: 'stages'
      }));
    }
  } catch (err) {
    showStatus('Réglages des ateliers illisibles : ' + err.message, true);
  }
}

/* ---------- Séances ---------- */

function renderSeances() {
  const list = document.getElementById('stagesList');
  const vide = document.getElementById('stagesExemples');

  if (!seancesCache.length) {
    list.innerHTML = '<p class="empty-hint">Aucune séance pour le moment.</p>';
    // Le bouton d'exemples n'a de sens que sur une page vierge : une fois
    // des séances créées, il n'ajouterait que du désordre.
    if (vide) vide.hidden = false;
    return;
  }
  if (vide) vide.hidden = true;

  const aujourdhui = dateDuJour();

  list.innerHTML = seancesCache.map(s => {
    const passee = (s.date || '') < aujourdhui;
    const restant = placesRestantes(s);

    return `
    <div class="noel-item ${s.visible === false ? 'is-rupture' : ''}" data-id="${escapeAttr(s.id)}">
      <div class="noel-item-header">
        <h3>${escapeAttr(s.nom || '(séance sans nom)')}</h3>
        <button type="button" class="noel-dispo" data-action="visible">${s.visible === false ? 'Masquée' : 'En ligne'}</button>
        <div class="noel-item-actions">
          <button class="icon-btn" data-action="delete" title="Supprimer">${IB_ICONS.trash}</button>
        </div>
      </div>

      <p class="field-hint stage-recap">
        ${escapeAttr(fmtJour(s.date))}${fmtCreneau(s) ? ` · ${escapeAttr(fmtCreneau(s))}` : ''}
        · ${placesPrises(s)}/${escapeAttr(s.places ?? 0)} place${(s.places || 0) > 1 ? 's' : ''} prise${placesPrises(s) > 1 ? 's' : ''}
        ${restant === 0 && (s.places || 0) > 0 ? ' · <strong>complet</strong>' : ''}
        ${passee ? ' · <strong>séance passée</strong>' : ''}
      </p>

      <div class="form-row">
        <label>Photo</label>
        <div class="stage-img-mount" data-value="${escapeAttr(s.imageUrl || '')}"></div>
      </div>

      <div class="form-row">
        <label>Nom de la séance</label>
        <input type="text" class="stg-nom" value="${escapeAttr(s.nom || '')}" placeholder="ex. Petits sablés de vacances">
      </div>

      <div class="form-row-grid">
        <div class="form-row">
          <label>Date</label>
          <input type="date" class="stg-date" value="${escapeAttr(s.date || '')}">
        </div>
        <div class="form-row">
          <label>Prix par participant (€)</label>
          <input type="text" inputmode="decimal" class="stg-prix" value="${escapeAttr(s.prix != null ? fmtPrix(s.prix) : '')}" placeholder="18,00">
        </div>
      </div>

      <div class="form-row-grid">
        <div class="form-row">
          <label>Début</label>
          <input type="time" class="stg-heureDebut" step="900" value="${escapeAttr(s.heureDebut || '')}">
        </div>
        <div class="form-row">
          <label>Fin</label>
          <input type="time" class="stg-heureFin" step="900" value="${escapeAttr(s.heureFin || '')}">
        </div>
      </div>

      <div class="form-row-grid">
        <div class="form-row">
          <label>Places</label>
          <input type="text" inputmode="numeric" class="stg-places" value="${escapeAttr(s.places ?? '')}" placeholder="10">
        </div>
        <div class="form-row">
          <label>Âge minimum</label>
          <input type="text" inputmode="numeric" class="stg-ageMin" value="${escapeAttr(s.ageMin ?? '')}" placeholder="6">
        </div>
        <div class="form-row">
          <label>Âge maximum</label>
          <input type="text" inputmode="numeric" class="stg-ageMax" value="${escapeAttr(s.ageMax ?? '')}" placeholder="—">
        </div>
      </div>
      <p class="field-hint">Laissez un âge vide pour ne pas poser cette limite. Sans maximum, la séance est aussi ouverte aux adultes.</p>

      <div class="form-row">
        <label>Description</label>
        <textarea class="stg-desc" rows="2" placeholder="Ce qu'on y fait, ce qu'on en rapporte…">${escapeAttr(s.description || '')}</textarea>
      </div>

      <div class="noel-item-save">
        <button type="button" class="btn btn-primary btn-small" data-action="save">Enregistrer cette séance</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.noel-item').forEach(el => {
    const id = el.dataset.id;
    const seance = seancesCache.find(s => s.id === id) || {};

    const mount = el.querySelector('.stage-img-mount');
    mount.appendChild(createImageUploader({
      className: 'stg-img', value: mount.dataset.value, folder: 'stages'
    }));

    el.querySelector('[data-action="visible"]').addEventListener('click', () => toggleVisible(id));
    el.querySelector('[data-action="delete"]').addEventListener('click', () => supprimerSeance(id, seance));
    el.querySelector('[data-action="save"]').addEventListener('click', () => saveSeance(id, el));
  });
}

async function saveSeance(id, el) {
  const nom = el.querySelector('.stg-nom').value.trim();
  if (!nom) { showStatus('La séance a besoin d\'un nom.', true); return; }

  const date = el.querySelector('.stg-date').value;
  if (!date) { showStatus('Indiquez la date de la séance.', true); return; }

  const prix = parsePrix(el.querySelector('.stg-prix').value);
  if (prix === null) { showStatus('Prix invalide. Exemple : 18,00', true); return; }

  const places = parsePlaces(el.querySelector('.stg-places').value);
  if (places === null) { showStatus('Indiquez un nombre de places (au moins 1).', true); return; }

  const heureDebut = el.querySelector('.stg-heureDebut').value;
  const heureFin   = el.querySelector('.stg-heureFin').value;
  if (heureFin && !heureDebut) {
    showStatus("Indiquez l'heure de début, ou laissez les deux vides.", true);
    return;
  }
  if (heureDebut && heureFin && heureFin <= heureDebut) {
    showStatus('La fin de la séance doit être après son début.', true);
    return;
  }

  const ageMin = parseAge(el.querySelector('.stg-ageMin').value);
  const ageMax = parseAge(el.querySelector('.stg-ageMax').value);
  if (ageMin !== null && ageMax !== null && ageMax < ageMin) {
    showStatus("L'âge maximum est inférieur au minimum.", true);
    return;
  }

  /* Réduire les places sous ce qui est déjà réservé n'annule rien : les
     inscriptions restent, et la séance afficherait un décompte négatif.
     Mieux vaut refuser et laisser annuler d'abord. */
  const seance = seancesCache.find(s => s.id === id) || {};
  if (places < placesPrises(seance)) {
    showStatus(
      `${placesPrises(seance)} place(s) sont déjà réservées : annulez des inscriptions avant de descendre plus bas.`,
      true
    );
    return;
  }

  const btn = el.querySelector('[data-action="save"]');
  btn.disabled = true;
  try {
    await updateDoc(doc(db, 'stages', id), {
      nom, date, prix, places, heureDebut, heureFin, ageMin, ageMax,
      description: el.querySelector('.stg-desc').value.trim(),
      imageUrl: el.querySelector('.stg-img').value.trim()
    });
    await loadStages();
    /* La liste vient d'être redessinée : on retrouve la fiche pour la
       marquer. Le message de statut, lui, est en bas de l'écran — mais deux
       signaux valent mieux qu'un quand la fiche fait un écran de haut. */
    document.querySelector(`.noel-item[data-id="${CSS.escape(id)}"]`)?.classList.add('is-saved');
    const etat = etatPublication(seancesCache.find(s => s.id === id) || {});
    showStatus(`Séance enregistrée — ${etat.texte}`, etat.ton);
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
  btn.disabled = false;
}

async function toggleVisible(id) {
  const s = seancesCache.find(x => x.id === id);
  try {
    await updateDoc(doc(db, 'stages', id), { visible: s.visible === false });
    await loadStages();
    const etat = etatPublication(seancesCache.find(x => x.id === id) || {});
    showStatus(`Séance ${s.visible === false ? 'mise en ligne' : 'masquée'} — ${etat.texte}`, etat.ton);
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

async function supprimerSeance(id, seance) {
  const inscrits = inscriptionsCache.filter(i => i.stageId === id);
  const ok = await confirmDialog(
    `Supprimer « ${seance.nom || 'cette séance'} » ?`,
    inscrits.length
      ? `${inscrits.length} inscription(s) y sont rattachées. Elles ne seront pas effacées, mais la séance disparaîtra de la page — prévenez les inscrits avant.`
      : "Elle disparaîtra de la page des ateliers immédiatement."
  );
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'stages', id));
    await loadStages();
    showSuccess('Séance supprimée', "Elle n'apparaît plus sur la page des ateliers.");
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

/* ---------- Inscriptions ---------- */

function renderInscriptions() {
  const zone = document.getElementById('inscriptionsList');
  const aujourdhui = dateDuJour();

  /* Les inscriptions se lisent par séance : au comptoir, la question est
     toujours « qui vient jeudi matin », jamais « qui s'est inscrit en
     troisième ». Les séances passées ferment la marche. */
  const parSeance = new Map();
  for (const i of inscriptionsCache) {
    if (!parSeance.has(i.stageId)) parSeance.set(i.stageId, []);
    parSeance.get(i.stageId).push(i);
  }

  const groupes = [...parSeance.entries()]
    .map(([stageId, liste]) => {
      const seance = seancesCache.find(s => s.id === stageId);
      return {
        stageId,
        // La séance a pu être supprimée : l'inscription en garde une copie.
        nom: seance?.nom || liste[0]?.stageNom || 'Séance supprimée',
        date: seance?.date || liste[0]?.date || '',
        liste: liste.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
      };
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (!groupes.length) {
    zone.innerHTML = '<p class="empty-hint">Aucune inscription pour le moment.</p>';
    return;
  }

  zone.innerHTML = groupes.map(g => {
    const passee = (g.date || '') < aujourdhui;
    const actives = g.liste.filter(i => STATUTS_QUI_OCCUPENT.includes(i.statut));
    const personnes = actives.reduce((n, i) => n + (i.nbParticipants || 1), 0);

    return `
    <div class="inscription-groupe ${passee ? 'is-passee' : ''}">
      <h3 class="inscription-groupe-titre">
        ${escapeAttr(g.nom)}
        <span>${escapeAttr(fmtJour(g.date))} · ${personnes} participant${personnes > 1 ? 's' : ''}</span>
      </h3>
      ${g.liste.map(i => {
        const statut = STATUTS[i.statut] || { label: i.statut || '—' };
        const noms = (i.participants || [])
          .map(p => `${p.prenom || ''}${p.age ? ` (${p.age} ans)` : ''}`.trim())
          .filter(Boolean).join(', ');

        return `
        <div class="inscription-ligne statut-${escapeAttr(i.statut || 'inconnu')}" data-id="${escapeAttr(i.id)}">
          <div class="inscription-info">
            <span class="inscription-code">${escapeAttr(i.code || '——')}</span>
            <strong>${escapeAttr(noms || '(participant sans nom)')}</strong>
            <span class="inscription-contact">
              ${escapeAttr(i.client?.nomComplet || '')}
              · <a href="tel:${escapeAttr(i.client?.telephone || '')}">${escapeAttr(i.client?.telephone || '')}</a>
              ${i.client?.email ? ` · <a href="mailto:${escapeAttr(i.client.email)}">${escapeAttr(i.client.email)}</a>` : ''}
            </span>
            ${i.commentaire ? `<span class="inscription-note">« ${escapeAttr(i.commentaire)} »</span>` : ''}
            <span class="inscription-total">${escapeAttr(euros.format(i.total || 0))}</span>
          </div>
          <div class="inscription-actions">
            <select class="inscription-statut" data-action="statut">
              ${Object.entries(STATUTS).map(([cle, s]) =>
                `<option value="${cle}" ${i.statut === cle ? 'selected' : ''}>${escapeAttr(s.label)}</option>`
              ).join('')}
            </select>
            <button class="icon-btn" data-action="delete" title="Supprimer cette inscription">${IB_ICONS.trash}</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  zone.querySelectorAll('.inscription-ligne').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-action="statut"]').addEventListener('change', e => {
      changerStatut(id, e.target.value);
    });
    el.querySelector('[data-action="delete"]').addEventListener('click', () => supprimerInscription(id));
  });
}

async function changerStatut(id, statut) {
  const inscription = inscriptionsCache.find(i => i.id === id);
  if (!inscription) return;

  if (statut === 'annulee') {
    const ok = await confirmDialog(
      'Annuler cette inscription ?',
      'La place repart aussitôt à la vente sur la page des ateliers. Prévenez la personne : aucun e-mail ne part automatiquement.'
    );
    if (!ok) { renderInscriptions(); return; }
  }

  try {
    await updateDoc(doc(db, 'inscriptions', id), { statut });
    // La place change de main : le compteur public doit suivre, sinon la
    // séance reste affichée complète.
    await recalculerPlaces(inscription.stageId);
    await loadStages();
    showStatus('Inscription mise à jour.');
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
    renderInscriptions();
  }
}

async function supprimerInscription(id) {
  const inscription = inscriptionsCache.find(i => i.id === id);
  const ok = await confirmDialog(
    'Supprimer cette inscription ?',
    'Elle disparaît définitivement, avec les coordonnées qu\'elle porte. La place repart à la vente.'
  );
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'inscriptions', id));
    if (inscription) await recalculerPlaces(inscription.stageId);
    await loadStages();
    showSuccess('Inscription supprimée', 'La place est de nouveau disponible.');
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

/**
 * Recompte les places d'une séance à partir des inscriptions réelles, et
 * réécrit le compteur que lit la page publique.
 *
 * Le compteur est la seule chose que la page peut lire — les inscriptions
 * lui sont fermées. Il dérive donc dès qu'on touche à une inscription
 * ailleurs que par le formulaire : ce recompte est ce qui le remet d'aplomb,
 * et il repart des documents eux-mêmes plutôt que d'ajouter ou retrancher
 * au passage, une soustraction ratée se propageant indéfiniment.
 */
async function recalculerPlaces(stageId) {
  if (!stageId) return;
  try {
    const snap = await getDocs(query(collection(db, 'inscriptions'), where('stageId', '==', stageId)));
    const prises = snap.docs
      .map(d => d.data())
      .filter(i => STATUTS_QUI_OCCUPENT.includes(i.statut))
      .reduce((n, i) => n + (Number(i.nbParticipants) || 1), 0);

    await updateDoc(doc(db, 'stages', stageId), { placesPrises: prises });
  } catch (err) {
    // La séance a pu être supprimée entre-temps : il n'y a alors plus de
    // compteur à tenir, et l'échec n'a pas à remonter à l'écran.
    console.error('Recompte des places impossible :', err.message);
  }
}

/* ---------- Exemples ---------- */
/* Trois séances toutes faites, pour que la page ne soit pas vide au premier
   jour. Les dates sont posées trois semaines plus loin : assez près pour
   qu'on les corrige tout de suite, assez loin pour ne pas afficher une
   séance déjà passée si personne n'y touche le jour même. */
function seancesExemples() {
  return [
    {
      nom: 'Petits sablés de vacances',
      description: "Pâte, emporte-pièces, glaçage et beaucoup de sucre glace sur le tablier. Chacun repart avec sa boîte.",
      date: dansNJours(21), heureDebut: '10:00', heureFin: '12:00',
      prix: 18, places: 10, ageMin: 6, ageMax: 11,
      imageUrl: '', visible: true, placesPrises: 0
    },
    {
      nom: 'La baguette, du pétrin au four',
      description: "Pétrissage, façonnage, coup de lame. On enfourne, on attend — c'est la partie difficile — et on repart avec ses baguettes.",
      date: dansNJours(22), heureDebut: '09:00', heureFin: '11:30',
      prix: 25, places: 8, ageMin: 8, ageMax: null,
      imageUrl: '', visible: true, placesPrises: 0
    },
    {
      nom: 'Éclairs comme au comptoir',
      description: "Pâte à choux, crème pâtissière, fondant bien lisse. Un atelier pour les grands, et les ados qui veulent apprendre pour de bon.",
      date: dansNJours(23), heureDebut: '14:00', heureFin: '17:00',
      prix: 32, places: 8, ageMin: 14, ageMax: null,
      imageUrl: '', visible: true, placesPrises: 0
    }
  ];
}

/* ---------- Câblage ---------- */

export function initStages() {
  document.getElementById('addStageBtn').addEventListener('click', async () => {
    // Créée tout de suite en base : la carte a besoin d'un identifiant pour
    // que ses boutons aient une cible.
    try {
      await addDoc(collection(db, 'stages'), {
        nom: '', description: '', imageUrl: '',
        date: dansNJours(14), heureDebut: '', heureFin: '',
        prix: 0, places: 8, ageMin: null, ageMax: null,
        visible: false, placesPrises: 0
      });
      await loadStages();
      showStatus('Séance ajoutée — remplissez-la, puis mettez-la en ligne.');
    } catch (err) {
      showStatus("Impossible d'ajouter la séance : " + err.message, true);
    }
  });

  document.getElementById('addStageExemplesBtn').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Créer trois séances d\'exemple ?',
      'Elles arrivent masquées, avec des dates dans trois semaines. Corrigez-les, puis mettez-les en ligne une par une.'
    );
    if (!ok) return;

    try {
      // Masquées à la création : des dates d'exemple ne doivent pas
      // s'afficher sur le site avant d'avoir été relues.
      for (const seance of seancesExemples()) {
        await addDoc(collection(db, 'stages'), { ...seance, visible: false });
      }
      await loadStages();
      await showSuccess(
        'Trois séances créées ✓',
        'Elles sont masquées : ajustez les dates et les prix, puis passez-les « en ligne ».'
      );
    } catch (err) {
      showStatus('Impossible de créer les exemples : ' + err.message, true);
    }
  });

  document.getElementById('saveStagesReglagesBtn').addEventListener('click', async () => {
    const ouvert = document.getElementById('stages-ouvert').checked;

    const enLigne = seancesCache.filter(s => s.visible !== false && (s.date || '') >= dateDuJour());
    if (ouvert && !enLigne.length) {
      showStatus('Aucune séance à venir n\'est en ligne : la page n\'aurait rien à proposer.', true);
      return;
    }

    const ok = await confirmDialog(
      ouvert ? 'Ouvrir les inscriptions aux ateliers ?' : 'Fermer les inscriptions aux ateliers ?',
      ouvert
        ? 'La page « Ateliers » acceptera les réservations dès maintenant.'
        : 'La page restera visible et présentera les ateliers, mais n\'acceptera plus d\'inscription.'
    );
    if (!ok) return;

    try {
      await setDoc(doc(db, 'settings', 'stages'), {
        ouvert,
        message: val('stages-message'),
        imageUrl: document.querySelector('.stg-page-img')?.value.trim() || ''
      }, { merge: true });
      reglagesOuvert = ouvert;
      await showSuccess(
        'Réglages enregistrés ✓',
        ouvert
          ? `Les inscriptions sont ouvertes : ${enLigne.length} séance${enLigne.length > 1 ? 's' : ''} à venir ${enLigne.length > 1 ? 'sont affichées' : 'est affichée'} sur la page.`
          : "Les inscriptions sont fermées : la page présente les ateliers, mais n'affiche aucune séance."
      );
    } catch (err) {
      showStatus("Erreur lors de l'enregistrement : " + err.message, true);
    }
  });
}
