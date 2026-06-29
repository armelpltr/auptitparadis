// ============================================================
// ADMIN.JS — logique du panneau d'administration
// Au P'tit Paradis
// ============================================================

import { auth, db, storage } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

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
   Upload d'image vers Firebase Storage
   ============================================================ */
async function uploadImage(file, folder) {
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/* ============================================================
   ONGLET RÉGLAGES
   ============================================================ */
let histoireImageUrl = '';

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

document.getElementById('addHourRow').addEventListener('click', () => addHourRowEl());

function collectHourRows() {
  return Array.from(document.querySelectorAll('.hour-row')).map(row => ({
    day: row.querySelector('.hour-day').value.trim(),
    hours: row.querySelector('.hour-hours').value.trim()
  })).filter(r => r.day || r.hours);
}

document.getElementById('file-histoire').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusSpan = document.getElementById('status-histoire');
  statusSpan.textContent = 'Téléversement…';
  try {
    histoireImageUrl = await uploadImage(file, 'images/histoire');
    document.getElementById('preview-histoire').src = histoireImageUrl;
    statusSpan.textContent = 'Image mise à jour ✓';
  } catch (err) {
    statusSpan.textContent = "Échec de l'envoi, réessaie.";
  }
});

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    if (!snap.exists()) return;
    const s = snap.data();

    setVal('set-tagline', s.tagline);

    (s.specialites || []).forEach((item, i) => {
      setVal(`set-spec${i + 1}-title`, item.title);
      setVal(`set-spec${i + 1}-text`, item.text);
    });

    if (s.histoire) {
      setVal('set-histoire-title', s.histoire.title);
      setVal('set-histoire-text1', s.histoire.text1);
      setVal('set-histoire-text2', s.histoire.text2);
      if (s.histoire.imageUrl) {
        histoireImageUrl = s.histoire.imageUrl;
        document.getElementById('preview-histoire').src = histoireImageUrl;
      }
    }

    const container = document.getElementById('hoursRowsContainer');
    container.innerHTML = '';
    const rows = (s.horaires && s.horaires.rows && s.horaires.rows.length) ? s.horaires.rows : [
      { day: 'Lundi', hours: 'Fermé' },
      { day: 'Mardi — Vendredi', hours: '7h00 – 13h30 · 15h30 – 19h30' },
      { day: 'Samedi', hours: '7h00 – 19h30' },
      { day: 'Dimanche', hours: '7h00 – 13h30' }
    ];
    rows.forEach(r => addHourRowEl(r.day, r.hours));

    if (s.horaires) {
      setVal('set-address1', s.horaires.address1);
      setVal('set-address2', s.horaires.address2);
      setVal('set-phone', s.horaires.phone);
      setVal('set-phoneDisplay', s.horaires.phoneDisplay);
      setVal('set-email', s.horaires.email);
      setVal('set-instagram', s.horaires.instagram);
      setVal('set-facebook', s.horaires.facebook);
      setVal('set-mapUrl', s.horaires.mapUrl);
    }

    setVal('set-contactIntro', s.contactIntro);
  } catch (err) {
    showStatus('Impossible de charger les réglages existants (' + err.message + ')', true);
  }
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const data = {
    tagline: val('set-tagline'),
    specialites: [1, 2, 3].map(n => ({
      title: val(`set-spec${n}-title`),
      text: val(`set-spec${n}-text`)
    })),
    histoire: {
      title: val('set-histoire-title'),
      text1: val('set-histoire-text1'),
      text2: val('set-histoire-text2'),
      imageUrl: histoireImageUrl
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
    showStatus('Réglages enregistrés ✓');
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
        <label>Image</label>
        <div class="image-upload">
          <img class="image-upload-preview" id="f-image-preview" src="${escapeAttr(data.imageUrl || '')}" alt="">
          <input type="file" accept="image/*" id="f-image-file">
          <span class="image-upload-status" id="f-image-status"></span>
        </div>
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
        <label>Photos</label>
        <input type="file" accept="image/*" id="f-gallery-file" multiple>
        <span class="image-upload-status" id="f-gallery-status"></span>
        <div class="gallery-thumbs" id="galleryThumbs"></div>
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

  if (type === 'text-image') {
    document.getElementById('f-image-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('f-image-status');
      status.textContent = 'Téléversement…';
      try {
        const url = await uploadImage(file, 'images/blocks');
        document.getElementById('f-image-preview').src = url;
        document.getElementById('f-image-preview').dataset.url = url;
        status.textContent = 'Image mise à jour ✓';
      } catch (err) {
        status.textContent = "Échec de l'envoi, réessaie.";
      }
    });
  }

  if (type === 'gallery') {
    renderGalleryThumbs();
    document.getElementById('f-gallery-file').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      const status = document.getElementById('f-gallery-status');
      status.textContent = `Téléversement de ${files.length} photo(s)…`;
      try {
        for (const file of files) {
          const url = await uploadImage(file, 'images/gallery');
          galleryImagesState.push(url);
        }
        renderGalleryThumbs();
        status.textContent = 'Photos ajoutées ✓';
      } catch (err) {
        status.textContent = "Échec de l'envoi, réessaie.";
      }
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
    <div class="gallery-thumb">
      <img src="${escapeAttr(url)}" alt="">
      <button type="button" class="row-remove" data-remove="${i}" title="Retirer">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      galleryImagesState.splice(Number(btn.dataset.remove), 1);
      renderGalleryThumbs();
    });
  });
}

/* ---------- Enregistrement du bloc ---------- */
document.getElementById('saveBlockBtn').addEventListener('click', async () => {
  const type = editingBlockType;
  let data = { type };

  if (type === 'banner') {
    data = { ...data, text: val('f-text'), linkText: val('f-linkText'), linkUrl: val('f-linkUrl'), style: val('f-style') };
  } else if (type === 'cards') {
    data = { ...data, title: val('f-title'), eyebrow: val('f-eyebrow'), items: cardItemsState };
  } else if (type === 'text-image') {
    const preview = document.getElementById('f-image-preview');
    data = {
      ...data, title: val('f-title'), text: val('f-text'),
      imageUrl: preview.dataset.url || preview.getAttribute('src') || '',
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
    showStatus('Section enregistrée ✓');
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
