// ============================================================
// SITE-DATA.JS — charge le contenu géré depuis l'admin (Firestore)
// et l'applique sur le site public. Si Firebase n'est pas encore
// configuré, ou indisponible, le contenu par défaut du HTML reste
// affiché : rien ne casse.
// ============================================================

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Bibliothèque d'icônes (doit rester synchronisée avec admin.js) ---------- */
export const ICONS = {
  bread:   '<path d="M15,68 C15,55 28,46 40,50 C46,38 60,32 70,42 C82,38 92,48 88,60 C92,68 88,78 76,78 L24,78 C14,78 12,72 15,68 Z" /><path d="M28,50 L24,40 M45,46 L44,33 M64,44 L70,33" />',
  pastry:  '<path d="M50,12 C66,12 78,26 78,42 C78,50 72,56 65,58 C68,64 64,70 58,70 L42,70 C36,70 32,64 35,58 C28,56 22,50 22,42 C22,26 34,12 50,12 Z" /><path d="M50,12 C50,20 46,26 50,32 C54,26 50,20 50,12 Z" />',
  icecream:'<path d="M35,42 C35,26 65,26 65,42 L62,42 C66,48 64,56 58,58 L50,86 L42,58 C36,56 34,48 38,42 Z" /><path d="M30,38 C30,18 70,18 70,38" />',
  cake:    '<path d="M20,55 L80,55 L80,80 C80,86 74,90 68,90 L32,90 C26,90 20,86 20,80 Z" /><path d="M20,55 C20,45 30,45 30,55 C30,45 40,45 40,55 C40,45 50,45 50,55 C50,45 60,45 60,55 C60,45 70,45 70,55 C70,45 80,45 80,55" /><path d="M50,40 L50,28 M50,28 C46,28 46,22 50,22 C54,22 54,28 50,28 Z" />',
  gift:    '<rect x="22" y="42" width="56" height="44" rx="4" /><path d="M22,58 L78,58" /><path d="M50,42 L50,86" /><path d="M50,42 C40,30 28,32 30,44 C40,46 46,42 50,42 Z" /><path d="M50,42 C60,30 72,32 70,44 C60,46 54,42 50,42 Z" />',
  star:    '<path d="M50,16 L60,40 L86,42 L66,58 L72,84 L50,70 L28,84 L34,58 L14,42 L40,40 Z" />'
};

function setText(id, value) {
  if (value === undefined || value === null || value === '') return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  if (value === undefined || value === null || value === '') return;
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setAttr(id, attr, value) {
  if (value === undefined || value === null || value === '') return;
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}

/* ---------- Application des réglages fixes ---------- */
function applySettings(s) {
  if (!s) return;

  setText('heroTagline', s.tagline);

  if (Array.isArray(s.specialites)) {
    s.specialites.forEach((item, i) => {
      const n = i + 1;
      setText(`specTitle${n}`, item.title);
      setText(`specText${n}`, item.text);
      const container = document.getElementById(`specProduits${n}`);
      if (container && Array.isArray(item.produits) && item.produits.length) {
        const TAG_LABELS = { 'top-vente': '⭐ Top vente', 'selection': '✦ Sélection du moment', 'nouveaute': '🆕 Nouveauté' };
        container.innerHTML = item.produits.map(p => `
          <div class="spec-produit">
            ${p.imageUrl ? `<img class="spec-produit-img" src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.nom)}">` : ''}
            <div class="spec-produit-info">
              <div class="spec-produit-header">
                <strong>${escapeHTML(p.nom)}</strong>
                ${p.tag && TAG_LABELS[p.tag] ? `<span class="produit-tag produit-tag--${escapeHTML(p.tag)}">${TAG_LABELS[p.tag]}</span>` : ''}
              </div>
              ${p.description ? `<span>${escapeHTML(p.description)}</span>` : ''}
            </div>
          </div>`).join('');
      }
    });
  }

  if (s.histoire) {
    setText('histoireTitle', s.histoire.title);
    setText('histoireText1', s.histoire.text1);
    setText('histoireText2', s.histoire.text2);
    setAttr('histoireImage', 'src', s.histoire.imageUrl);
  }

  if (s.horaires) {
    const h = s.horaires;
    if (Array.isArray(h.rows) && h.rows.length) {
      const tbody = document.getElementById('hoursTableBody');
      if (tbody) {
        tbody.innerHTML = h.rows.map(r =>
          `<tr><th>${escapeHTML(r.day)}</th><td>${escapeHTML(r.hours)}</td></tr>`
        ).join('');
      }
    }
    if (h.address1 || h.address2) {
      setHTML('addressLine', `${escapeHTML(h.address1 || '')}<br>${escapeHTML(h.address2 || '')}`);
    }
    if (h.phone) {
      setText('phoneLink', h.phoneDisplay || h.phone);
      setAttr('phoneLink', 'href', `tel:${h.phone}`);
    }
    if (h.email) {
      setText('emailLink', h.email);
      setAttr('emailLink', 'href', `mailto:${h.email}`);
    }
    if (h.instagram) setAttr('instagramLink', 'href', h.instagram);
    if (h.facebook) setAttr('facebookLink', 'href', h.facebook);
    if (h.mapUrl) setAttr('mapIframe', 'src', h.mapUrl);
  }

  setText('contactIntro', s.contactIntro);
}

/* ---------- Rendu des blocs dynamiques ---------- */
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function renderBanner(b) {
  const styleClass = b.style === 'highlight' ? 'style-highlight' : 'style-info';
  const btn = (b.linkText && b.linkUrl)
    ? `<a href="${escapeHTML(b.linkUrl)}" class="btn btn-primary">${escapeHTML(b.linkText)}</a>`
    : '';
  return `<section class="block-banner ${styleClass}"><p>${escapeHTML(b.text)}</p>${btn}</section>`;
}

function renderCards(b) {
  const items = (b.items || []).map(item => `
    <article class="card">
      <span class="card-icon" aria-hidden="true"><svg viewBox="0 0 100 100">${ICONS[item.icon] || ICONS.star}</svg></span>
      <h3>${escapeHTML(item.title)}</h3>
      <p>${escapeHTML(item.text)}</p>
    </article>`).join('');
  return `
    <section class="block-cards">
      <div class="section-inner">
        ${b.eyebrow ? `<p class="eyebrow">${escapeHTML(b.eyebrow)}</p>` : ''}
        <h2>${escapeHTML(b.title)}</h2>
        <div class="cards">${items}</div>
      </div>
    </section>`;
}

function renderTextImage(b) {
  const rightClass = b.imagePosition === 'right' ? 'img-right' : '';
  return `
    <section class="block-text-image">
      <div class="section-inner text-image-grid ${rightClass}">
        <div class="text-image-visual">
          <div class="text-image-frame"><img src="${escapeHTML(b.imageUrl || '')}" alt=""></div>
        </div>
        <div class="text-image-text">
          <h2>${escapeHTML(b.title)}</h2>
          <p>${escapeHTML(b.text)}</p>
        </div>
      </div>
    </section>`;
}

function renderGallery(b) {
  const imgs = (b.images || []).map(url => `<img src="${escapeHTML(url)}" alt="">`).join('');
  return `
    <section class="block-gallery">
      <div class="section-inner">
        <h2>${escapeHTML(b.title)}</h2>
        <div class="gallery-grid">${imgs}</div>
      </div>
    </section>`;
}

const RENDERERS = {
  banner: renderBanner,
  cards: renderCards,
  'text-image': renderTextImage,
  gallery: renderGallery
};

async function loadDynamicBlocks() {
  const container = document.getElementById('dynamicSections');
  if (!container) return;

  const q = query(collection(db, 'blocks'), where('visible', '==', true), orderBy('order', 'asc'));
  const snap = await getDocs(q);

  const html = snap.docs
    .map(d => d.data())
    .filter(b => RENDERERS[b.type])
    .map(b => RENDERERS[b.type](b))
    .join('');

  container.innerHTML = html;
}

function revealDynamic() {
  document.querySelectorAll('[data-dynamic]').forEach(el => el.classList.add('is-loaded'));
}

function showLoadError() {
  document.querySelectorAll('[data-dynamic]').forEach(el => { el.textContent = ''; });
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:.6em 1.4em;border-radius:6px;font-size:.85rem;font-family:sans-serif;z-index:999;';
  banner.textContent = 'Erreur de chargement';
  document.body.appendChild(banner);
  revealDynamic();
}

/* ---------- Lancement ---------- */
(async () => {
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'site'));
    if (settingsSnap.exists()) applySettings(settingsSnap.data());
    else showLoadError();
  } catch (err) {
    console.error('Firestore indisponible :', err.message);
    showLoadError();
  } finally {
    revealDynamic();
  }

  try {
    await loadDynamicBlocks();
  } catch (err) {
    console.warn('Aucune section dynamique chargée :', err.message);
  }
})();
