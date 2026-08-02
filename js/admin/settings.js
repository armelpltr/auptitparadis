// ============================================================
// ONGLET RÉGLAGES — accroche, spécialités, histoire, horaires, contact
// ============================================================

import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ICONS, ICON_LABELS, SVG_X } from "./icons.js";
import { createImageUploader } from "./uploader.js";
import {
  confirmDialog, showSuccess, showStatus, escapeAttr, val, setVal, deepMerge
} from "./ui.js";

const DEFAULTS = {
  tagline: "Il y a des matins où l'odeur du pain chaud rivalise avec celle de la mer. Les nôtres, c'est tous les jours.",
  specialites: [
    { title: 'Boulangerie',        icon: 'bread',    text: "On se lève à 4h pour que vous ayez du pain chaud à 7h. Baguette de tradition, miche de campagne, pains aux céréales : chaque fournée est une promesse recommencée chaque matin." },
    { title: 'Pâtisserie',         icon: 'pastry',   text: "Pur beurre, sans compromis — c'est la règle depuis le premier jour. Croissants feuilletés, tartes de saison, entremets : le genre de choses qu'on mange lentement, parce qu'on sait que ça ne dure pas." },
    { title: 'Glaces artisanales', icon: 'icecream', text: "En juillet, la file d'attente commence à 10h. On ne s'en plaint pas. Glaces et sorbets faits maison, aux fruits de saison — le meilleur alibi pour rester cinq minutes de plus à Luc-sur-Mer." }
  ],
  /* Un seul article connu au moment de l'écriture. La date n'est pas
     renseignée : actu.fr bloque la lecture automatique de ses pages, et
     inventer une date de publication n'aurait servi personne. */
  presse: {
    articles: [{
      titre: "Son métier n'avait rien à voir : Fabrice reprend une boulangerie-pâtisserie sur la Côte de Nacre",
      media: 'actu.fr',
      date: '',
      url: 'https://actu.fr/normandie/luc-sur-mer_14384/son-metier-navait-rien-a-voir-fabrice-reprend-une-boulangerie-patisserie-sur-la-cote-de-nacre_64229309.html',
      imageUrl: '',
      extrait: ''
    }],
    avis: []
  },
  histoire: {
    title: "On se lève avant vous. Depuis longtemps.",
    text1: "Au P'tit Paradis, les journées commencent dans le noir. Pendant que Luc-sur-Mer dort encore, notre équipe pétrit, façonne, enfourne. Pas parce qu'on y est obligés — parce qu'un pain fait à la main et cuit à l'heure, c'est une chose qui a encore du sens.",
    text2: "On accueille les habitués qui savent qu'on les reconnaît, et les vacanciers qui reviennent chaque été parce qu'ils n'ont pas trouvé mieux ailleurs. C'est peu, et c'est tout."
  }
};

const DEFAULT_HOURS = [
  { day: 'Lundi', hours: 'Fermé' },
  { day: 'Mardi — Vendredi', hours: '7h00 – 13h30 · 15h30 – 19h30' },
  { day: 'Samedi', hours: '7h00 – 19h30' },
  { day: 'Dimanche', hours: '7h00 – 13h30' }
];

/* ---------- Horaires ---------- */
function addHourRowEl(day = '', hours = '') {
  const container = document.getElementById('hoursRowsContainer');
  const row = document.createElement('div');
  row.className = 'hour-row';
  row.innerHTML = `
    <input type="text" class="hour-day" placeholder="Jour (ex. Lundi)" value="${escapeAttr(day)}">
    <input type="text" class="hour-hours" placeholder="Horaires (ex. Fermé)" value="${escapeAttr(hours)}">
    <button type="button" class="row-remove" title="Supprimer cette ligne">${SVG_X}</button>
  `;
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectHourRows() {
  return Array.from(document.querySelectorAll('.hour-row')).map(row => ({
    day: row.querySelector('.hour-day').value.trim(),
    hours: row.querySelector('.hour-hours').value.trim()
  })).filter(r => r.day || r.hours);
}

/* ---------- « Ils parlent de nous » ---------- */
/* Deux listes indépendantes, éditées en ligne : la sélection est éditoriale,
   rien n'est récupéré automatiquement depuis Google ou la presse. */

function addPresseArticleRow({ titre = '', media = '', date = '', url = '', extrait = '', imageUrl = '' } = {}) {
  const list = document.getElementById('presseArticlesList');
  const row = document.createElement('div');
  row.className = 'card-item-edit presse-article-edit';
  row.innerHTML = `
    <button type="button" class="row-remove" title="Retirer cet article">${SVG_X}</button>
    <div class="form-row"><label>Titre de l'article</label><input type="text" class="pa-titre" value="${escapeAttr(titre)}"></div>
    <div class="form-row-grid">
      <div class="form-row"><label>Journal</label><input type="text" class="pa-media" placeholder="actu.fr, Ouest-France…" value="${escapeAttr(media)}"></div>
      <div class="form-row"><label>Date</label><input type="text" class="pa-date" placeholder="mars 2026" value="${escapeAttr(date)}"></div>
    </div>
    <div class="form-row"><label>Lien vers l'article</label><input type="text" class="pa-url" placeholder="https://…" value="${escapeAttr(url)}"></div>
    <div class="form-row"><label>Photo de l'article</label><div class="pa-image-mount"></div></div>
    <div class="form-row"><label>Extrait cité (optionnel)</label><textarea class="pa-extrait" rows="2">${escapeAttr(extrait)}</textarea></div>
  `;
  row.querySelector('.pa-image-mount').appendChild(
    createImageUploader({ className: 'pa-image', value: imageUrl, folder: 'presse' })
  );
  // :scope > pour ne pas attraper le bouton « retirer la photo » de l'uploader
  row.querySelector(':scope > .row-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function addPresseAvisRow({ auteur = '', note = 5, texte = '', date = '' } = {}) {
  const list = document.getElementById('presseAvisList');
  const row = document.createElement('div');
  row.className = 'card-item-edit presse-avis-edit';
  row.innerHTML = `
    <button type="button" class="row-remove" title="Retirer cet avis">${SVG_X}</button>
    <div class="form-row-grid">
      <div class="form-row"><label>Nom affiché</label><input type="text" class="av-auteur" placeholder="Marie L." value="${escapeAttr(auteur)}"></div>
      <div class="form-row">
        <label>Note</label>
        <select class="av-note">
          ${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${Number(note) === n ? 'selected' : ''}>${n} étoile${n > 1 ? 's' : ''}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row"><label>Avis</label><textarea class="av-texte" rows="3" placeholder="Collez ici le texte de l'avis Google">${escapeAttr(texte)}</textarea></div>
    <div class="form-row"><label>Date (optionnel)</label><input type="text" class="av-date" placeholder="janvier 2026" value="${escapeAttr(date)}"></div>
  `;
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectPresse() {
  const articles = Array.from(document.querySelectorAll('#presseArticlesList .presse-article-edit')).map(r => ({
    titre:   r.querySelector('.pa-titre').value.trim(),
    media:   r.querySelector('.pa-media').value.trim(),
    date:    r.querySelector('.pa-date').value.trim(),
    url:      r.querySelector('.pa-url').value.trim(),
    imageUrl: r.querySelector('.pa-image').value.trim(),
    extrait:  r.querySelector('.pa-extrait').value.trim()
  })).filter(a => a.titre);

  const avis = Array.from(document.querySelectorAll('#presseAvisList .presse-avis-edit')).map(r => ({
    auteur: r.querySelector('.av-auteur').value.trim(),
    note:   Number(r.querySelector('.av-note').value) || 5,
    texte:  r.querySelector('.av-texte').value.trim(),
    date:   r.querySelector('.av-date').value.trim()
  })).filter(a => a.texte);

  return { articles, avis };
}

function renderPresse(p) {
  document.getElementById('presseArticlesList').innerHTML = '';
  document.getElementById('presseAvisList').innerHTML = '';
  (p.articles || []).forEach(addPresseArticleRow);
  (p.avis || []).forEach(addPresseAvisRow);
}

/* ---------- Spécialités et leurs produits vedettes ---------- */
function addProduitRowForIndex(i, nom = '', description = '', imageUrl = '', tag = '') {
  const list = document.getElementById(`spec-produits-${i}`);
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'produit-row';
  row.innerHTML = `
    <input type="text" class="produit-nom" placeholder="Nom du produit" value="${escapeAttr(nom)}">
    <textarea class="produit-desc" rows="3" placeholder="Description courte">${escapeAttr(description)}</textarea>
    <select class="produit-tag">
      <option value="">— Pas de tag —</option>
      <option value="top-vente" ${tag === 'top-vente' ? 'selected' : ''}>Top vente</option>
      <option value="selection" ${tag === 'selection' ? 'selected' : ''}>Sélection du moment</option>
      <option value="nouveaute" ${tag === 'nouveaute' ? 'selected' : ''}>Nouveauté</option>
    </select>
    <button type="button" class="row-remove" title="Supprimer">${SVG_X}</button>
  `;
  row.insertBefore(
    createImageUploader({ className: 'produit-img', value: imageUrl, folder: 'produits', compact: true }),
    row.querySelector('.produit-tag')
  );
  // :scope > pour ne pas attraper le bouton "retirer la photo" de l'uploader
  row.querySelector(':scope > .row-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectSpecProduitsForIndex(i) {
  return Array.from(document.querySelectorAll(`#spec-produits-${i} .produit-row`)).map(row => ({
    nom: row.querySelector('.produit-nom').value.trim(),
    description: row.querySelector('.produit-desc').value.trim(),
    imageUrl: row.querySelector('.produit-img').value.trim(),
    tag: row.querySelector('.produit-tag').value
  })).filter(p => p.nom);
}

let specState = [];

function syncSpecStateFromDOM() {
  document.querySelectorAll('#specList .spec-edit').forEach((el, i) => {
    specState[i] = {
      title: el.querySelector('.spec-title').value.trim(),
      text:  el.querySelector('.spec-text').value.trim(),
      icon:  el.querySelector('.spec-icon').value,
      produits: collectSpecProduitsForIndex(i)
    };
  });
}

function renderSpecList() {
  const container = document.getElementById('specList');
  if (!container) return;
  container.innerHTML = specState.map((item, i) => `
    <div class="spec-edit" data-index="${i}">
      <div class="spec-edit-header">
        <h3>Fiche ${i + 1}${item.title ? ' — ' + escapeAttr(item.title) : ''}</h3>
        ${specState.length > 1 ? `<button type="button" class="row-remove" data-remove="${i}" title="Supprimer cette fiche">${SVG_X}</button>` : ''}
      </div>
      <div class="form-row">
        <label>Icône</label>
        <select class="spec-icon">
          ${Object.keys(ICONS).map(k => `<option value="${k}" ${(item.icon || 'bread') === k ? 'selected' : ''}>${ICON_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Titre</label><input type="text" class="spec-title" placeholder="ex. Boulangerie" value="${escapeAttr(item.title || '')}"></div>
      <div class="form-row"><label>Texte</label><textarea class="spec-text" rows="3">${escapeAttr(item.text || '')}</textarea></div>
      <div class="form-row">
        <label>Produits vedettes</label>
        <div class="produits-list" id="spec-produits-${i}"></div>
        <button type="button" class="btn btn-ghost btn-small add-spec-produit" data-index="${i}">+ Ajouter un produit</button>
      </div>
    </div>
  `).join('');

  specState.forEach((item, i) => {
    (item.produits || []).forEach(p => addProduitRowForIndex(i, p.nom, p.description, p.imageUrl, p.tag));
  });

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncSpecStateFromDOM();
      specState.splice(Number(btn.dataset.remove), 1);
      renderSpecList();
    });
  });

  container.querySelectorAll('.add-spec-produit').forEach(btn => {
    btn.addEventListener('click', () => addProduitRowForIndex(Number(btn.dataset.index)));
  });
}

/* ---------- Chargement ---------- */
export async function loadSettings() {
  setVal('set-tagline', DEFAULTS.tagline);
  setVal('set-histoire-title', DEFAULTS.histoire.title);
  setVal('set-histoire-text1', DEFAULTS.histoire.text1);
  setVal('set-histoire-text2', DEFAULTS.histoire.text2);

  specState = DEFAULTS.specialites.map(s => ({ ...s, produits: [] }));
  renderPresse(DEFAULTS.presse);

  const container = document.getElementById('hoursRowsContainer');
  container.innerHTML = '';
  DEFAULT_HOURS.forEach(r => addHourRowEl(r.day, r.hours));

  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    if (!snap.exists()) { renderSpecList(); return; }
    const s = snap.data();

    if (s.tagline) setVal('set-tagline', s.tagline);

    if (Array.isArray(s.specialites) && s.specialites.length) {
      specState = s.specialites.map(item => ({
        title:    item.title    || '',
        text:     item.text     || '',
        icon:     item.icon     || 'bread',
        produits: Array.isArray(item.produits) ? item.produits : []
      }));
    }

    // Présent mais vide = tout a été retiré volontairement, on le respecte.
    if (s.presse) renderPresse(s.presse);

    if (s.histoire) {
      if (s.histoire.title)    setVal('set-histoire-title',    s.histoire.title);
      if (s.histoire.text1)    setVal('set-histoire-text1',    s.histoire.text1);
      if (s.histoire.text2)    setVal('set-histoire-text2',    s.histoire.text2);
      if (s.histoire.imageUrl) setVal('set-histoire-imageUrl', s.histoire.imageUrl);
    }

    if (s.horaires && s.horaires.rows && s.horaires.rows.length) {
      container.innerHTML = '';
      s.horaires.rows.forEach(r => addHourRowEl(r.day, r.hours));
    }

    if (s.horaires) {
      setVal('set-address1',    s.horaires.address1);
      setVal('set-address2',    s.horaires.address2);
      setVal('set-phone',       s.horaires.phone);
      setVal('set-phoneDisplay',s.horaires.phoneDisplay);
      setVal('set-email',       s.horaires.email);
      setVal('set-instagram',   s.horaires.instagram);
      setVal('set-facebook',    s.horaires.facebook);
      setVal('set-mapUrl',      s.horaires.mapUrl);
    }
  } catch (err) {
    showStatus('Impossible de charger les réglages existants (' + err.message + ')', true);
  }

  renderSpecList();
  // Les champs sont remplis : les saisies suivantes viennent de l'utilisateur
  suppressDirty = false;
  setDirty(false);
}

/* Chaque carte des réglages s'enregistre séparément. L'écriture se fait en
   merge : une carte ne touche que ses propres champs et laisse le reste du
   document intact — deux parties peuvent donc être modifiées sans risque de
   s'écraser l'une l'autre. "Horaires" et "Adresse & contact" écrivent dans la
   même map `horaires`, le merge de Firestore est profond sur les maps. */
const SETTINGS_SECTIONS = {
  tagline: {
    label: "l'accroche",
    collect: () => ({ tagline: val('set-tagline') })
  },
  specialites: {
    label: 'les spécialités',
    // Firestore ne sait pas fusionner un seul élément d'un tableau : le bouton
    // d'une fiche réécrit forcément les trois. Autant le dire.
    hint: 'Toutes les fiches de spécialités sont enregistrées ensemble.',
    collect: () => ({
      specialites: Array.from(document.querySelectorAll('#specList .spec-edit')).map((el, i) => ({
        title:    el.querySelector('.spec-title').value.trim(),
        text:     el.querySelector('.spec-text').value.trim(),
        icon:     el.querySelector('.spec-icon').value,
        produits: collectSpecProduitsForIndex(i)
      }))
    })
  },
  presse: {
    label: '« Ils parlent de nous »',
    collect: () => ({ presse: collectPresse() })
  },
  histoire: {
    label: '« Notre histoire »',
    collect: () => ({
      histoire: {
        title: val('set-histoire-title'),
        text1: val('set-histoire-text1'),
        text2: val('set-histoire-text2'),
        imageUrl: val('set-histoire-imageUrl')
      }
    })
  },
  horaires: {
    label: 'les horaires',
    collect: () => ({ horaires: { rows: collectHourRows() } })
  },
  contact: {
    label: "l'adresse et les contacts",
    collect: () => ({
      horaires: {
        address1: val('set-address1'),
        address2: val('set-address2'),
        phone: val('set-phone'),
        phoneDisplay: val('set-phoneDisplay'),
        email: val('set-email'),
        instagram: val('set-instagram'),
        facebook: val('set-facebook'),
        mapUrl: val('set-mapUrl')
      }
    })
  }
};

/* ---------- Suivi des modifications non enregistrées ---------- */
let isDirty = false;
/* loadSettings() remplit les champs par programme et setVal() émet un 'input' :
   sans ce verrou, la page s'annoncerait modifiée dès son chargement. */
let suppressDirty = true;

function setDirty(dirty) {
  const saveBar = document.getElementById('saveBar');
  isDirty = dirty;
  saveBar.classList.toggle('is-dirty', dirty);
  document.getElementById('saveBarStatus').textContent = dirty
    ? 'Modifications non enregistrées'
    : 'Tout est enregistré';
}

function markDirty() {
  if (suppressDirty || isDirty) return;
  setDirty(true);
}

/* ---------- Câblage ---------- */
export function initSettings() {
  // Monté tout de suite : loadSettings() appelle setVal('set-histoire-imageUrl', …)
  document.getElementById('histoireImageMount').appendChild(
    createImageUploader({ id: 'set-histoire-imageUrl', folder: 'histoire' })
  );

  document.getElementById('addSpecBtn').addEventListener('click', () => {
    syncSpecStateFromDOM();
    specState.push({ title: '', text: '', icon: 'bread', produits: [] });
    renderSpecList();
  });

  document.getElementById('addHourRow').addEventListener('click', () => addHourRowEl());

  document.getElementById('addPresseArticle').addEventListener('click', () => addPresseArticleRow());
  document.getElementById('addPresseAvis').addEventListener('click', () => addPresseAvisRow());

  // Capture : attrape aussi les champs créés après coup (fiches, produits, uploads)
  const panel = document.getElementById('panel-settings');
  panel.addEventListener('input', markDirty, true);
  panel.addEventListener('change', markDirty, true);
  panel.addEventListener('click', (e) => {
    // Ajout/suppression de fiche, de produit ou de ligne d'horaire
    if (e.target.closest('#addSpecBtn, #addHourRow, #addPresseArticle, #addPresseAvis, .add-spec-produit, .row-remove')) markDirty();
  });

  // Dernier filet si l'onglet est fermé ou la page rechargée
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  const saveBtn = document.getElementById('saveSettingsBtn');
  saveBtn.addEventListener('click', async () => {
    const ok = await confirmDialog('Enregistrer les réglages ?', 'Les modifications seront appliquées sur le site immédiatement.');
    if (!ok) return;

    const data = Object.values(SETTINGS_SECTIONS)
      .reduce((acc, section) => deepMerge(acc, section.collect()), {});

    const original = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement…';
    try {
      await setDoc(doc(db, 'settings', 'site'), data, { merge: true });
      setDirty(false);
      await showSuccess('Réglages enregistrés ✓', 'Les modifications sont en ligne.');
    } catch (err) {
      showStatus("Erreur lors de l'enregistrement : " + err.message, true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = original;
    }
  });
}
