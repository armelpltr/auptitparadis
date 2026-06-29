// ============================================================
// ADMIN.JS — logique du panneau d'administration
// Au P'tit Paradis
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ============================================================
   Bibliothèque d'icônes pour le bloc "Grille de cartes"
   (doit rester synchronisée avec js/site-data.js)
   ============================================================ */
const ICONS = {
  bread:    '<path d="M15,68 C15,55 28,46 40,50 C46,38 60,32 70,42 C82,38 92,48 88,60 C92,68 88,78 76,78 L24,78 C14,78 12,72 15,68 Z" /><path d="M28,50 L24,40 M45,46 L44,33 M64,44 L70,33" />',
  pastry:   '<path d="M50,12 C66,12 78,26 78,42 C78,50 72,56 65,58 C68,64 64,70 58,70 L42,70 C36,70 32,64 35,58 C28,56 22,50 22,42 C22,26 34,12 50,12 Z" /><path d="M50,12 C50,20 46,26 50,32 C54,26 50,20 50,12 Z" />',
  icecream: '<path d="M35,42 C35,26 65,26 65,42 L62,42 C66,48 64,56 58,58 L50,86 L42,58 C36,56 34,48 38,42 Z" /><path d="M30,38 C30,18 70,18 70,38" />',
  cake:     '<path d="M20,55 L80,55 L80,80 C80,86 74,90 68,90 L32,90 C26,90 20,86 20,80 Z" /><path d="M20,55 C20,45 30,45 30,55 C30,45 40,45 40,55 C40,45 50,45 50,55 C50,45 60,45 60,55 C60,45 70,45 70,55 C70,45 80,45 80,55" /><path d="M50,40 L50,28 M50,28 C46,28 46,22 50,22 C54,22 54,28 50,28 Z" />',
  gift:     '<rect x="22" y="42" width="56" height="44" rx="4" /><path d="M22,58 L78,58" /><path d="M50,42 L50,86" /><path d="M50,42 C40,30 28,32 30,44 C40,46 46,42 50,42 Z" /><path d="M50,42 C60,30 72,32 70,44 C60,46 54,42 50,42 Z" />',
  star:     '<path d="M50,16 L60,40 L86,42 L66,58 L72,84 L50,70 L28,84 L34,58 L14,42 L40,40 Z" />'
};
const ICON_LABELS = {
  bread: 'Pain / Boulangerie', pastry: 'Pâtisserie', icecream: 'Glace',
  cake: 'Gâteau', gift: 'Cadeau', star: 'Étoile / Nouveauté'
};
const BLOCK_LABELS = {
  banner: 'Bannière', cards: 'Grille de cartes', 'text-image': 'Texte + image', gallery: 'Galerie photo'
};

const DEFAULTS = {
  tagline: "Il y a des matins où l'odeur du pain chaud rivalise avec celle de la mer. Les nôtres, c'est tous les jours.",
  specialites: [
    { title: 'Boulangerie', text: "On se lève à 4h pour que vous ayez du pain chaud à 7h. Baguette de tradition, miche de campagne, pains aux céréales : chaque fournée est une promesse recommencée chaque matin." },
    { title: 'Pâtisserie',  text: "Pur beurre, sans compromis — c'est la règle depuis le premier jour. Croissants feuilletés, tartes de saison, entremets : le genre de choses qu'on mange lentement, parce qu'on sait que ça ne dure pas." },
    { title: 'Glaces artisanales', text: "En juillet, la file d'attente commence à 10h. On ne s'en plaint pas. Glaces et sorbets faits maison, aux fruits de saison — le meilleur alibi pour rester cinq minutes de plus à Luc-sur-Mer." }
  ],
  histoire: {
    title: "On se lève avant vous. Depuis longtemps.",
    text1: "Au P'tit Paradis, les journées commencent dans le noir. Pendant que Luc-sur-Mer dort encore, notre équipe pétrit, façonne, enfourne. Pas parce qu'on y est obligés — parce qu'un pain fait à la main et cuit à l'heure, c'est une chose qui a encore du sens.",
    text2: "On accueille les habitués qui savent qu'on les reconnaît, et les vacanciers qui reviennent chaque été parce qu'ils n'ont pas trouvé mieux ailleurs. C'est peu, et c'est tout."
  }
};

/* ============================================================
   Références DOM
   ============================================================ */
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('adminStatus');

/* ============================================================
   Modal de confirmation
   ============================================================ */
function confirm(title, sub) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'flex';
    document.querySelector('.confirm-actions--success').style.display = 'none';
    overlay.hidden = false;

    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');

    function close(result) {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk = () => close(true);
    const onCancel = () => close(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); }, { once: true });
  });
}

function showSuccess(title, sub = '') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmSub').textContent = sub;
    document.querySelector('.confirm-actions').style.display = 'none';
    document.querySelector('.confirm-actions--success').style.display = 'flex';
    overlay.hidden = false;

    const closeBtn = document.getElementById('confirmClose');
    function close() {
      overlay.hidden = true;
      closeBtn.removeEventListener('click', close);
      resolve();
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
  });
}

/* ============================================================
   Authentification
   ============================================================ */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "Connexion impossible : vérifie l'e-mail et le mot de passe.";
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.hidden = true;
    adminApp.hidden = false;
    loadSettings();
    loadBlocks();
  } else {
    loginScreen.hidden = false;
    adminApp.hidden = true;
  }
});

/* ============================================================
   Message de statut
   ============================================================ */
let statusTimer = null;
function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = 'admin-status' + (isError ? ' is-error' : '');
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.hidden = true; }, 4000);
}

/* ============================================================
   Onglets
   ============================================================ */
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('is-active');
  });
});

/* ============================================================
   ONGLET RÉGLAGES
   ============================================================ */

function addHourRowEl(day = '', hours = '') {
  const container = document.getElementById('hoursRowsContainer');
  const row = document.createElement('div');
  row.className = 'hour-row';
  row.innerHTML = `
    <input type="text" class="hour-day" placeholder="Jour (ex. Lundi)" value="${escapeAttr(day)}">
    <input type="text" class="hour-hours" placeholder="Horaires (ex. Fermé)" value="${escapeAttr(hours)}">
    <button type="button" class="row-remove" title="Supprimer cette ligne">✕</button>
  `;
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addProduitRow(specN, nom = '', description = '', imageUrl = '', tag = '') {
  const list = document.getElementById(`spec${specN}-produits-list`);
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'produit-row';
  row.innerHTML = `
    <input type="text" class="produit-nom" placeholder="Nom du produit" value="${escapeAttr(nom)}">
    <input type="text" class="produit-desc" placeholder="Description courte" value="${escapeAttr(description)}">
    <input type="url" class="produit-img" placeholder="URL image" value="${escapeAttr(imageUrl)}">
    <select class="produit-tag">
      <option value="">— Pas de tag —</option>
      <option value="top-vente" ${tag === 'top-vente' ? 'selected' : ''}>⭐ Top vente</option>
      <option value="selection" ${tag === 'selection' ? 'selected' : ''}>✦ Sélection du moment</option>
      <option value="nouveaute" ${tag === 'nouveaute' ? 'selected' : ''}>🆕 Nouveauté</option>
    </select>
    <button type="button" class="row-remove" title="Supprimer">✕</button>
  `;
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

[1, 2, 3].forEach(n => {
  const btn = document.getElementById(`addSpec${n}Produit`);
  if (btn) btn.addEventListener('click', () => addProduitRow(n));
});

function collectSpecProduits(n) {
  return Array.from(document.querySelectorAll(`#spec${n}-produits-list .produit-row`)).map(row => ({
    nom: row.querySelector('.produit-nom').value.trim(),
    description: row.querySelector('.produit-desc').value.trim(),
    imageUrl: row.querySelector('.produit-img').value.trim(),
    tag: row.querySelector('.produit-tag').value
  })).filter(p => p.nom);
}

document.getElementById('addHourRow').addEventListener('click', () => addHourRowEl());

function collectHourRows() {
  return Array.from(document.querySelectorAll('.hour-row')).map(row => ({
    day: row.querySelector('.hour-day').value.trim(),
    hours: row.querySelector('.hour-hours').value.trim()
  })).filter(r => r.day || r.hours);
}


async function loadSettings() {
  // Pré-remplissage avec les valeurs par défaut du site
  setVal('set-tagline', DEFAULTS.tagline);
  DEFAULTS.specialites.forEach((item, i) => {
    setVal(`set-spec${i + 1}-title`, item.title);
    setVal(`set-spec${i + 1}-text`, item.text);
  });
  setVal('set-histoire-title', DEFAULTS.histoire.title);
  setVal('set-histoire-text1', DEFAULTS.histoire.text1);
  setVal('set-histoire-text2', DEFAULTS.histoire.text2);

  const container = document.getElementById('hoursRowsContainer');
  container.innerHTML = '';
  [
    { day: 'Lundi', hours: 'Fermé' },
    { day: 'Mardi — Vendredi', hours: '7h00 – 13h30 · 15h30 – 19h30' },
    { day: 'Samedi', hours: '7h00 – 19h30' },
    { day: 'Dimanche', hours: '7h00 – 13h30' }
  ].forEach(r => addHourRowEl(r.day, r.hours));

  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    if (!snap.exists()) return;
    const s = snap.data();

    if (s.tagline) setVal('set-tagline', s.tagline);

    (s.specialites || []).forEach((item, i) => {
      const n = i + 1;
      if (item.title) setVal(`set-spec${n}-title`, item.title);
      if (item.text)  setVal(`set-spec${n}-text`,  item.text);
      if (Array.isArray(item.produits)) {
        item.produits.forEach(p => addProduitRow(n, p.nom, p.description, p.imageUrl, p.tag));
      }
    });

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
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const ok = await confirm('Enregistrer les réglages ?', 'Les modifications seront appliquées sur le site immédiatement.');
  if (!ok) return;
  const data = {
    tagline: val('set-tagline'),
    specialites: [1, 2, 3].map(n => ({
      title: val(`set-spec${n}-title`),
      text: val(`set-spec${n}-text`),
      produits: collectSpecProduits(n)
    })),
    histoire: {
      title: val('set-histoire-title'),
      text1: val('set-histoire-text1'),
      text2: val('set-histoire-text2'),
      imageUrl: val('set-histoire-imageUrl')
    },
    horaires: {
      rows: collectHourRows(),
      address1: val('set-address1'),
      address2: val('set-address2'),
      phone: val('set-phone'),
      phoneDisplay: val('set-phoneDisplay'),
      email: val('set-email'),
      instagram: val('set-instagram'),
      facebook: val('set-facebook'),
      mapUrl: val('set-mapUrl')
    },
    contactIntro: val('set-contactIntro')
  };

  try {
    await setDoc(doc(db, 'settings', 'site'), data);
    showSuccess('Réglages enregistrés ✓', 'Les modifications sont en ligne.');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
});

/* ============================================================
   ONGLET SECTIONS
   ============================================================ */
let blocksCache = [];
let editingBlockId = null;
let editingBlockType = null;
let cardItemsState = [];
let galleryImagesState = [];

async function loadBlocks() {
  try {
    const snap = await getDocs(query(collection(db, 'blocks'), orderBy('order', 'asc')));
    blocksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBlocksList();
  } catch (err) {
    document.getElementById('blocksList').innerHTML =
      `<p class="empty-hint">Impossible de charger les sections (${err.message}).</p>`;
  }
}

function blockPreviewTitle(b) {
  if (b.type === 'banner') return b.text || '(sans texte)';
  return b.title || '(sans titre)';
}

function renderBlocksList() {
  const list = document.getElementById('blocksList');
  if (!blocksCache.length) {
    list.innerHTML = '<p class="empty-hint">Aucune section pour le moment. Clique sur "+ Ajouter une section" pour commencer.</p>';
    return;
  }
  list.innerHTML = blocksCache.map((b, i) => `
    <div class="block-row ${b.visible ? '' : 'is-hidden'}" data-id="${b.id}">
      <span class="block-type-tag">${BLOCK_LABELS[b.type] || b.type}</span>
      <span class="block-row-title">${escapeAttr(blockPreviewTitle(b))}</span>
      <div class="block-row-actions">
        <button class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
        <button class="icon-btn" data-action="down" ${i === blocksCache.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
        <button class="icon-btn" data-action="toggle" title="${b.visible ? 'Masquer' : 'Afficher'}">${b.visible ? '👁' : '🚫'}</button>
        <button class="icon-btn" data-action="edit" title="Modifier">✎</button>
        <button class="icon-btn" data-action="delete" title="Supprimer">🗑</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.block-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="up"]').addEventListener('click', () => moveBlock(id, -1));
    row.querySelector('[data-action="down"]').addEventListener('click', () => moveBlock(id, 1));
    row.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleVisible(id));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openBlockEditor(id));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteBlock(id));
  });
}

async function moveBlock(id, direction) {
  const index = blocksCache.findIndex(b => b.id === id);
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= blocksCache.length) return;

  const a = blocksCache[index];
  const b = blocksCache[swapIndex];
  const tempOrder = a.order;
  a.order = b.order;
  b.order = tempOrder;

  try {
    await updateDoc(doc(db, 'blocks', a.id), { order: a.order });
    await updateDoc(doc(db, 'blocks', b.id), { order: b.order });
    await loadBlocks();
  } catch (err) {
    showStatus('Erreur lors du déplacement : ' + err.message, true);
  }
}

async function toggleVisible(id) {
  const b = blocksCache.find(x => x.id === id);
  try {
    await updateDoc(doc(db, 'blocks', id), { visible: !b.visible });
    await loadBlocks();
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

async function deleteBlock(id) {
  if (!confirm('Supprimer définitivement cette section ?')) return;
  try {
    await deleteDoc(doc(db, 'blocks', id));
    await loadBlocks();
    showStatus('Section supprimée ✓');
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

/* ---------- Sélecteur de modèle ---------- */
const templatePicker = document.getElementById('templatePicker');
const blockEditor = document.getElementById('blockEditor');

document.getElementById('addBlockBtn').addEventListener('click', () => { templatePicker.hidden = false; });
document.getElementById('cancelTemplatePicker').addEventListener('click', () => { templatePicker.hidden = true; });
document.getElementById('cancelBlockEditor').addEventListener('click', () => { blockEditor.hidden = true; });

document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', () => {
    templatePicker.hidden = true;
    openBlockEditor(null, card.dataset.type);
  });
});

/* ---------- Construction du formulaire d'édition selon le type ---------- */
function openBlockEditor(id, forcedType = null) {
  const fieldsContainer = document.getElementById('blockEditorFields');
  const titleEl = document.getElementById('blockEditorTitle');

  let data = {};
  if (id) {
    data = blocksCache.find(b => b.id === id) || {};
    editingBlockId = id;
    editingBlockType = data.type;
  } else {
    editingBlockId = null;
    editingBlockType = forcedType;
    data = {};
  }

  titleEl.textContent = id ? 'Modifier la section' : `Ajouter — ${BLOCK_LABELS[editingBlockType]}`;
  cardItemsState = (data.items || []).map(i => ({ ...i }));
  galleryImagesState = [...(data.images || [])];

  fieldsContainer.innerHTML = buildFieldsHTML(editingBlockType, data);
  wireFieldEvents(editingBlockType);

  blockEditor.hidden = false;
}

function buildFieldsHTML(type, data) {
  if (type === 'banner') {
    return `
      <div class="form-row"><label>Texte de l'annonce</label><textarea id="f-text" rows="2">${escapeAttr(data.text)}</textarea></div>
      <div class="form-row-grid">
        <div class="form-row"><label>Texte du bouton (optionnel)</label><input type="text" id="f-linkText" value="${escapeAttr(data.linkText)}"></div>
        <div class="form-row"><label>Lien du bouton (optionnel)</label><input type="text" id="f-linkUrl" value="${escapeAttr(data.linkUrl)}"></div>
      </div>
      <div class="form-row">
        <label>Style</label>
        <select id="f-style">
          <option value="info" ${data.style !== 'highlight' ? 'selected' : ''}>Discret</option>
          <option value="highlight" ${data.style === 'highlight' ? 'selected' : ''}>Mise en avant (fond doré)</option>
        </select>
      </div>`;
  }

  if (type === 'cards') {
    return `
      <div class="form-row"><label>Eyebrow (petit texte au-dessus, optionnel)</label><input type="text" id="f-eyebrow" value="${escapeAttr(data.eyebrow)}"></div>
      <div class="form-row"><label>Titre de la section</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div id="cardItemsContainer"></div>
      <button type="button" class="btn btn-ghost btn-small" id="addCardItem">+ Ajouter une carte</button>`;
  }

  if (type === 'text-image') {
    return `
      <div class="form-row"><label>Titre</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div class="form-row"><label>Texte</label><textarea id="f-text" rows="4">${escapeAttr(data.text)}</textarea></div>
      <div class="form-row">
        <label>URL de l'image</label>
        <input type="url" id="f-imageUrl" value="${escapeAttr(data.imageUrl || '')}" placeholder="https://...">
      </div>
      <div class="form-row">
        <label>Position de l'image</label>
        <select id="f-imagePosition">
          <option value="left" ${data.imagePosition !== 'right' ? 'selected' : ''}>Gauche</option>
          <option value="right" ${data.imagePosition === 'right' ? 'selected' : ''}>Droite</option>
        </select>
      </div>`;
  }

  if (type === 'gallery') {
    return `
      <div class="form-row"><label>Titre</label><input type="text" id="f-title" value="${escapeAttr(data.title)}"></div>
      <div class="form-row">
        <label>URLs des photos</label>
        <div id="galleryThumbs"></div>
        <button type="button" class="btn btn-ghost btn-small" id="addGalleryUrl">+ Ajouter une URL</button>
      </div>`;
  }

  return '';
}

function wireFieldEvents(type) {
  if (type === 'cards') {
    renderCardItems();
    document.getElementById('addCardItem').addEventListener('click', () => {
      if (cardItemsState.length >= 6) return;
      cardItemsState.push({ icon: 'bread', title: '', text: '' });
      renderCardItems();
    });
  }

  if (type === 'gallery') {
    renderGalleryThumbs();
    document.getElementById('addGalleryUrl').addEventListener('click', () => {
      galleryImagesState.push('');
      renderGalleryThumbs();
    });
  }
}

function renderCardItems() {
  const container = document.getElementById('cardItemsContainer');
  container.innerHTML = cardItemsState.map((item, i) => `
    <div class="card-item-edit" data-index="${i}">
      <button type="button" class="row-remove" data-remove="${i}" title="Supprimer cette carte">✕</button>
      <div class="form-row">
        <label>Icône</label>
        <select data-field="icon" data-index="${i}">
          ${Object.keys(ICONS).map(k => `<option value="${k}" ${item.icon === k ? 'selected' : ''}>${ICON_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Titre</label><input type="text" data-field="title" data-index="${i}" value="${escapeAttr(item.title)}"></div>
      <div class="form-row"><label>Texte</label><textarea data-field="text" data-index="${i}" rows="2">${escapeAttr(item.text)}</textarea></div>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      cardItemsState.splice(Number(btn.dataset.remove), 1);
      renderCardItems();
    });
  });
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      cardItemsState[Number(input.dataset.index)][input.dataset.field] = input.value;
    });
  });
}

function renderGalleryThumbs() {
  const container = document.getElementById('galleryThumbs');
  container.innerHTML = galleryImagesState.map((url, i) => `
    <div class="hour-row">
      <input type="url" class="gallery-url-input" data-index="${i}" value="${escapeAttr(url)}" placeholder="https://...">
      <button type="button" class="row-remove" data-remove="${i}" title="Retirer">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      galleryImagesState.splice(Number(btn.dataset.remove), 1);
      renderGalleryThumbs();
    });
  });
  container.querySelectorAll('.gallery-url-input').forEach(input => {
    input.addEventListener('input', () => {
      galleryImagesState[Number(input.dataset.index)] = input.value.trim();
    });
  });
}

/* ---------- Enregistrement du bloc ---------- */
document.getElementById('saveBlockBtn').addEventListener('click', async () => {
  const ok = await confirm('Enregistrer cette section ?', 'Les modifications seront appliquées sur le site immédiatement.');
  if (!ok) return;
  const type = editingBlockType;
  let data = { type };

  if (type === 'banner') {
    data = { ...data, text: val('f-text'), linkText: val('f-linkText'), linkUrl: val('f-linkUrl'), style: val('f-style') };
  } else if (type === 'cards') {
    data = { ...data, title: val('f-title'), eyebrow: val('f-eyebrow'), items: cardItemsState };
  } else if (type === 'text-image') {
    data = {
      ...data, title: val('f-title'), text: val('f-text'),
      imageUrl: val('f-imageUrl'),
      imagePosition: val('f-imagePosition')
    };
  } else if (type === 'gallery') {
    data = { ...data, title: val('f-title'), images: galleryImagesState };
  }

  try {
    if (editingBlockId) {
      await updateDoc(doc(db, 'blocks', editingBlockId), data);
    } else {
      const maxOrder = blocksCache.reduce((max, b) => Math.max(max, b.order || 0), 0);
      await addDoc(collection(db, 'blocks'), { ...data, order: maxOrder + 1, visible: true });
    }
    blockEditor.hidden = true;
    await loadBlocks();
    showSuccess('Section enregistrée ✓', 'Les modifications sont en ligne.');
  } catch (err) {
    showStatus("Erreur lors de l'enregistrement : " + err.message, true);
  }
});

/* ============================================================
   Petits utilitaires
   ============================================================ */
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, value) { const el = document.getElementById(id); if (el && value !== undefined) el.value = value; }
function escapeAttr(str) { return String(str ?? '').replace(/"/g, '&quot;'); }
