// ============================================================
// ONGLET SECTIONS — blocs libres insérés dans la page d'accueil
// ============================================================

import { db } from "../firebase-config.js";
import {
  doc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ICONS, ICON_LABELS, BLOCK_LABELS, IB_ICONS, SVG_X } from "./icons.js";
import { createImageUploader } from "./uploader.js";
import { confirmDialog, showSuccess, showStatus, escapeAttr, val } from "./ui.js";

let blocksCache = [];
let editingBlockId = null;
let editingBlockType = null;
let cardItemsState = [];
let galleryImagesState = [];

export async function loadBlocks() {
  try {
    const snap = await getDocs(query(collection(db, 'blocks'), orderBy('order', 'asc')));
    blocksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBlocksList();
  } catch (err) {
    document.getElementById('blocksList').innerHTML =
      `<p class="empty-hint">Impossible de charger les sections (${escapeAttr(err.message)}).</p>`;
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
    <div class="block-row ${b.visible ? '' : 'is-hidden'}" data-id="${escapeAttr(b.id)}">
      <span class="block-type-tag">${escapeAttr(BLOCK_LABELS[b.type] || b.type)}</span>
      <span class="block-row-title">${escapeAttr(blockPreviewTitle(b))}</span>
      <div class="block-row-actions">
        <button class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} title="Monter">${IB_ICONS.up}</button>
        <button class="icon-btn" data-action="down" ${i === blocksCache.length - 1 ? 'disabled' : ''} title="Descendre">${IB_ICONS.down}</button>
        <button class="icon-btn" data-action="toggle" title="${b.visible ? 'Masquer' : 'Afficher'}">${b.visible ? IB_ICONS.eye : IB_ICONS.eyeOff}</button>
        <button class="icon-btn" data-action="edit" title="Modifier">${IB_ICONS.edit}</button>
        <button class="icon-btn" data-action="delete" title="Supprimer">${IB_ICONS.trash}</button>
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
  const ok = await confirmDialog('Retirer cette section ?', 'Elle sera supprimée du site immédiatement. Action irréversible.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'blocks', id));
    await loadBlocks();
    showSuccess('Section retirée', "Elle n'apparaît plus sur le site.");
  } catch (err) {
    showStatus('Erreur : ' + err.message, true);
  }
}

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

  document.getElementById('blockEditor').hidden = false;
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
        <label>Photo</label>
        <div id="imageUrlMount" data-value="${escapeAttr(data.imageUrl || '')}"></div>
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
        <div id="galleryThumbs"></div>
        <button type="button" class="btn btn-ghost btn-small" id="addGalleryUrl">+ Ajouter une photo</button>
      </div>`;
  }

  return '';
}

function wireFieldEvents(type) {
  if (type === 'text-image') {
    const mount = document.getElementById('imageUrlMount');
    mount.appendChild(createImageUploader({
      id: 'f-imageUrl', value: mount.dataset.value, folder: 'sections'
    }));
  }

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
      <button type="button" class="row-remove" data-remove="${i}" title="Supprimer cette carte">${SVG_X}</button>
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
  container.innerHTML = '';

  galleryImagesState.forEach((url, i) => {
    const row = document.createElement('div');
    row.className = 'gallery-row';

    const uploader = createImageUploader({ value: url, folder: 'galerie' });
    const hidden = uploader.querySelector('input[type="hidden"]');
    hidden.addEventListener('input', () => { galleryImagesState[i] = hidden.value.trim(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove';
    removeBtn.title = 'Retirer cette photo';
    removeBtn.innerHTML = SVG_X;
    removeBtn.addEventListener('click', () => {
      galleryImagesState.splice(i, 1);
      renderGalleryThumbs();
    });

    row.append(uploader, removeBtn);
    container.appendChild(row);
  });
}

/* ---------- Câblage ---------- */
export function initBlocks() {
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

  document.getElementById('saveBlockBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('Enregistrer cette section ?', 'Les modifications seront appliquées sur le site immédiatement.');
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
      data = { ...data, title: val('f-title'), images: galleryImagesState.filter(Boolean) };
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
}
