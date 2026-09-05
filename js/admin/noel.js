// ============================================================
// ONGLET CATALOGUE NOËL — produits proposés à la commande
// Collection `noel_produits` + période de retrait dans `settings/noel`.
// ============================================================

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { IB_ICONS } from "./icons.js";
import { createImageUploader } from "./uploader.js";
import { confirmDialog, showSuccess, showStatus, escapeAttr, val, setVal } from "./ui.js";

let produitsCache = [];

/* Le prix est saisi à la main : « 24,50 » est au moins aussi probable que
   « 24.50 » sur un clavier français, et un <input type="number"> refuse la
   virgule sans rien dire. On accepte les deux et on stocke un nombre. */
export function parsePrix(raw) {
  const n = Number(String(raw ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function fmtPrix(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Vide = illimité, stocké `null` plutôt que 0 pour ne pas confondre
   « aucune limite » et « stock épuisé ». */
export function parseCapacite(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[^\d]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function capaciteRowHTML(date, limite) {
  return `
    <div class="capacite-row">
      <input type="date" class="cap-date" value="${escapeAttr(date || '')}">
      <input type="text" inputmode="numeric" class="cap-limite" value="${escapeAttr(limite ?? '')}" placeholder="Limite">
      <button type="button" class="row-remove" title="Retirer cette date">×</button>
    </div>`;
}

function wireCapaciteRow(row) {
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
}

/* Relit les lignes telles que saisies : une date sans limite valide, ou une
   limite sans date, n'entre pas dans l'objet renvoyé — plutôt ignorer une
   ligne mal remplie que d'écrire une valeur inexploitable en base. */
function lireCapacites(el) {
  const capacites = {};
  el.querySelectorAll('.capacite-row').forEach(row => {
    const date = row.querySelector('.cap-date').value;
    const limite = parseCapacite(row.querySelector('.cap-limite').value);
    if (date && limite !== null) capacites[date] = limite;
  });
  return capacites;
}

/* Date du jour en AAAA-MM-JJ, dans le fuseau de l'utilisateur : c'est le
   format des <input type="date">, et deux chaînes de cette forme se
   comparent dans l'ordre chronologique. */
function dateDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

function fmtJour(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/* ---------- Chargement ---------- */
export async function loadNoel() {
  try {
    const snap = await getDocs(query(collection(db, 'noel_produits'), orderBy('order', 'asc')));
    produitsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNoelList();
  } catch (err) {
    document.getElementById('noelList').innerHTML =
      `<p class="empty-hint">Impossible de charger le catalogue (${escapeAttr(err.message)}).</p>`;
  }

  try {
    const snap = await getDoc(doc(db, 'settings', 'noel'));
    const s = snap.exists() ? snap.data() : {};
    document.getElementById('noel-ouvert').checked = s.ouvert === true;
    document.getElementById('noel-sms').checked = s.sms === true;
    document.getElementById('noel-theme').checked  = s.theme  === true;
    setVal('noel-themeFin', s.themeFin || '');
    setVal('noel-dateDebut', s.dateDebut || '');
    setVal('noel-dateFin',   s.dateFin   || '');
    setVal('noel-message',   s.message   || '');
    setVal('noel-heureDebut', s.heureDebut || '');
    setVal('noel-heureFin',   s.heureFin   || '');
    setVal('noel-pasCreneau', String(s.pasCreneauMinutes || 30));
    // Réglage absent = pas d'annulation en ligne : c'est l'état des
    // commandes déjà passées avant l'ajout de cette option.
    setVal('noel-delaiAnnulation', String(s.delaiAnnulationJours ?? 0));
  } catch (err) {
    showStatus('Période de retrait illisible : ' + err.message, true);
  }
}

function renderNoelList() {
  const list = document.getElementById('noelList');
  if (!produitsCache.length) {
    list.innerHTML = '<p class="empty-hint">Aucun produit pour le moment. Clique sur « + Ajouter un produit » pour commencer.</p>';
    return;
  }

  list.innerHTML = produitsCache.map((p, i) => `
    <div class="noel-item ${p.disponible === false ? 'is-rupture' : ''}" data-id="${escapeAttr(p.id)}">
      <div class="noel-item-header">
        <h3>${escapeAttr(p.nom || '(sans nom)')}</h3>
        <button type="button" class="noel-dispo" data-action="dispo">${p.disponible === false ? 'En rupture' : 'Disponible'}</button>
        <div class="noel-item-actions">
          <button class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} title="Monter">${IB_ICONS.up}</button>
          <button class="icon-btn" data-action="down" ${i === produitsCache.length - 1 ? 'disabled' : ''} title="Descendre">${IB_ICONS.down}</button>
          <button class="icon-btn" data-action="delete" title="Supprimer">${IB_ICONS.trash}</button>
        </div>
      </div>

      <div class="form-row">
        <label>Photo</label>
        <div class="noel-img-mount" data-value="${escapeAttr(p.imageUrl || '')}"></div>
      </div>
      <div class="form-row-grid">
        <div class="form-row"><label>Nom du produit</label><input type="text" class="noel-nom" value="${escapeAttr(p.nom || '')}" placeholder="ex. Bûche vanille-caramel"></div>
        <div class="form-row">
          <label>Prix (€)</label>
          <input type="text" inputmode="decimal" class="noel-prix" value="${escapeAttr(p.prix != null ? fmtPrix(p.prix) : '')}" placeholder="24,50">
        </div>
      </div>
      <div class="form-row">
        <label>Limites de commandes par date</label>
        <div class="capacite-list" data-capacite-list>
          ${(Object.entries(p.capacites || {}).sort((a, b) => a[0].localeCompare(b[0])))
            .map(([date, limite]) => capaciteRowHTML(date, limite)).join('')}
        </div>
        <button type="button" class="btn btn-ghost btn-small" data-action="cap-add">+ Ajouter une date</button>
        <p class="field-hint">Sans ligne pour une date : pas de limite ce jour-là. Toutes les commandes de cette date comptent, quel que soit le client.</p>
      </div>
      <div class="form-row">
        <label>Description</label>
        <textarea class="noel-desc" rows="2" placeholder="Parts, parfums, allergènes…">${escapeAttr(p.description || '')}</textarea>
      </div>
      <div class="noel-item-save">
        <button type="button" class="btn btn-primary btn-small" data-action="save">Enregistrer ce produit</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.noel-item').forEach(el => {
    const id = el.dataset.id;
    const produit = produitsCache.find(p => p.id === id) || {};

    const mount = el.querySelector('.noel-img-mount');
    mount.appendChild(createImageUploader({
      className: 'noel-img', value: mount.dataset.value, folder: 'noel'
    }));

    el.querySelector('[data-action="up"]').addEventListener('click', () => moveProduit(id, -1));
    el.querySelector('[data-action="down"]').addEventListener('click', () => moveProduit(id, 1));
    el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteProduit(id, produit.nom));
    el.querySelector('[data-action="dispo"]').addEventListener('click', () => toggleDispo(id));
    el.querySelector('[data-action="save"]').addEventListener('click', () => saveProduit(id, el));

    el.querySelectorAll('.capacite-row').forEach(wireCapaciteRow);
    el.querySelector('[data-action="cap-add"]').addEventListener('click', () => {
      const liste = el.querySelector('[data-capacite-list]');
      liste.insertAdjacentHTML('beforeend', capaciteRowHTML('', ''));
      wireCapaciteRow(liste.lastElementChild);
    });
  });
}

/* ---------- Écritures ---------- */
async function saveProduit(id, el) {
  const nom = el.querySelector('.noel-nom').value.trim();
  if (!nom) { showStatus('Le produit a besoin d\'un nom.', true); return; }

  const prix = parsePrix(el.querySelector('.noel-prix').value);
  if (prix === null) { showStatus('Prix invalide. Exemple : 24,50', true); return; }

  const btn = el.querySelector('[data-action="save"]');
  btn.disabled = true;
  try {
    await updateDoc(doc(db, 'noel_produits', id), {
      nom,
      prix,
      description: el.querySelector('.noel-desc').value.trim(),
      imageUrl: el.querySelector('.noel-img').value.trim(),
      capacites: lireCapacites(el)
    });
    await loadNoel();
    showStatus('Produit enregistré.');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
  btn.disabled = false;
}

async function toggleDispo(id) {
  const p = produitsCache.find(x => x.id === id);
  try {
    await updateDoc(doc(db, 'noel_produits', id), { disponible: p.disponible === false });
    await loadNoel();
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

async function moveProduit(id, direction) {
  const index = produitsCache.findIndex(p => p.id === id);
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= produitsCache.length) return;

  const a = produitsCache[index];
  const b = produitsCache[swapIndex];
  const tempOrder = a.order;
  a.order = b.order;
  b.order = tempOrder;

  try {
    await updateDoc(doc(db, 'noel_produits', a.id), { order: a.order });
    await updateDoc(doc(db, 'noel_produits', b.id), { order: b.order });
    await loadNoel();
  } catch (err) {
    showStatus('Erreur lors du déplacement : ' + err.message, true);
  }
}

async function deleteProduit(id, nom) {
  const ok = await confirmDialog(
    `Retirer « ${nom || 'ce produit'} » du catalogue ?`,
    "Il disparaîtra de la page de commande immédiatement. Les commandes déjà passées le conservent."
  );
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'noel_produits', id));
    await loadNoel();
    showSuccess('Produit retiré', "Il n'apparaît plus sur la page de commande.");
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

/* ---------- Câblage ---------- */
export function initNoel() {
  document.getElementById('addNoelBtn').addEventListener('click', async () => {
    // Créé tout de suite en base : la carte a besoin d'un identifiant pour que
    // ses boutons (ordre, disponibilité, suppression) aient une cible.
    const maxOrder = produitsCache.reduce((max, p) => Math.max(max, p.order || 0), 0);
    try {
      await addDoc(collection(db, 'noel_produits'), {
        nom: '', description: '', prix: 0, imageUrl: '',
        disponible: true, order: maxOrder + 1, capacites: {}
      });
      await loadNoel();
    } catch (err) {
      showStatus("Impossible d'ajouter le produit : " + err.message, true);
    }
  });

  /* L'habillage a son propre bouton : changer les couleurs du site n'a rien
     à voir avec l'ouverture des commandes, et le merge Firestore laisse
     l'autre carte intacte. */
  document.getElementById('saveNoelThemeBtn').addEventListener('click', async () => {
    const theme = document.getElementById('noel-theme').checked;
    const themeFin = val('noel-themeFin');

    /* Cocher la case avec une date déjà passée n'afficherait rien : le
       décor s'éteint au lendemain de la date de fin. Autant le dire tout
       de suite plutôt que de laisser chercher pourquoi rien ne change. */
    if (theme && themeFin && themeFin < dateDuJour()) {
      showStatus('Cette date est déjà passée : le décor ne s\'afficherait pas.', true);
      return;
    }

    const ok = await confirmDialog(
      theme ? 'Afficher le décor de Noël ?' : 'Retirer le décor de Noël ?',
      theme
        ? (themeFin
            ? `Guirlande, neige et bonnet apparaîtront pour tous les visiteurs, jusqu'au ${fmtJour(themeFin)} inclus.`
            : 'Guirlande, neige et bonnet apparaîtront pour tous les visiteurs, jusqu\'à ce que vous les retiriez.')
        : 'Le site retrouvera son apparence habituelle.'
    );
    if (!ok) return;

    try {
      await setDoc(doc(db, 'settings', 'noel'), { theme, themeFin }, { merge: true });
      await showSuccess(
        theme ? 'Décor activé ✓' : 'Décor retiré ✓',
        'Le changement est visible sur le site dans quelques secondes.'
      );
    } catch (err) {
      showStatus("Erreur lors de l'enregistrement : " + err.message, true);
    }
  });

  document.getElementById('saveNoelPeriodeBtn').addEventListener('click', async () => {
    const debut = val('noel-dateDebut');
    const fin   = val('noel-dateFin');
    if (debut && fin && fin < debut) {
      showStatus('La fin de période est avant son début.', true);
      return;
    }

    const ouvert = document.getElementById('noel-ouvert').checked;
    const sms = document.getElementById('noel-sms').checked;
    if (ouvert && !(debut && fin)) {
      showStatus('Renseigne les deux dates avant d\'ouvrir les commandes.', true);
      return;
    }

    /* Le champ est libre : une valeur négative ou farfelue ne doit pas
       partir en base, où le Worker devrait la rattraper. */
    const delaiBrut = Number(val('noel-delaiAnnulation'));
    if (!Number.isInteger(delaiBrut) || delaiBrut < 0 || delaiBrut > 60) {
      showStatus("Le délai d'annulation doit être un nombre de jours entre 0 et 60.", true);
      return;
    }

    const ok = await confirmDialog(
      ouvert ? 'Ouvrir les commandes de Noël ?' : 'Fermer les commandes de Noël ?',
      (ouvert
        ? 'La page « Commander » acceptera les réservations dès maintenant.'
        : 'La page « Commander » restera visible mais n\'acceptera plus de réservation.') +
      // La date limite est gravée dans chaque commande au moment où elle est
      // passée : changer le délai ne touche que les suivantes.
      ' Le délai d\'annulation ne s\'applique qu\'aux commandes à venir, pas à celles déjà passées.'
    );
    if (!ok) return;

    /* Les deux heures vont ensemble : une seule renseignée ne décrit aucune
       plage, et le formulaire de commande ne saurait quoi proposer. */
    const heureDebut = val('noel-heureDebut');
    const heureFin   = val('noel-heureFin');
    if (Boolean(heureDebut) !== Boolean(heureFin)) {
      showStatus('Renseignez les deux heures de retrait, ou aucune des deux.', true);
      return;
    }
    if (heureDebut && heureFin <= heureDebut) {
      showStatus('Le dernier créneau de retrait doit être après le premier.', true);
      return;
    }

    try {
      await setDoc(doc(db, 'settings', 'noel'), {
        ouvert, sms, dateDebut: debut, dateFin: fin, message: val('noel-message'),
        delaiAnnulationJours: delaiBrut,
        heureDebut, heureFin,
        pasCreneauMinutes: Number(val('noel-pasCreneau')) || 30
      }, { merge: true });
      await showSuccess(
        'Période enregistrée ✓',
        sms
          ? 'La page de commande est à jour. Chaque réservation déclenchera un SMS au client.'
          : "La page de commande est à jour. Aucun SMS ne part : seul l'e-mail de confirmation est envoyé."
      );
    } catch (err) {
      showStatus("Erreur lors de l'enregistrement : " + err.message, true);
    }
  });
}
