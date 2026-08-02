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
/* Icônes des fiches spécialités, servies en <img>.
   Tabler (MIT) via jsDelivr, sauf le sandwich qui vient de game-icons
   et qui est hébergé dans le repo. */
const TABLER = s => `https://cdn.jsdelivr.net/npm/@tabler/icons@2.47.0/icons/${s}.svg`;
const ICON_URLS = {
  bread:    TABLER('baguette'),
  pastry:   TABLER('cake'),
  icecream: TABLER('ice-cream-2'),
  cake:     TABLER('cake'),
  gift:     TABLER('gift'),
  star:     TABLER('star'),
  snacking: 'assets/icon-snacking.svg'   // heberge dans le repo, cf. assets/
};

export const ICONS = {
  bread:   '<path d="M15,68 C15,55 28,46 40,50 C46,38 60,32 70,42 C82,38 92,48 88,60 C92,68 88,78 76,78 L24,78 C14,78 12,72 15,68 Z" /><path d="M28,50 L24,40 M45,46 L44,33 M64,44 L70,33" />',
  pastry:  '<path d="M50,12 C66,12 78,26 78,42 C78,50 72,56 65,58 C68,64 64,70 58,70 L42,70 C36,70 32,64 35,58 C28,56 22,50 22,42 C22,26 34,12 50,12 Z" /><path d="M50,12 C50,20 46,26 50,32 C54,26 50,20 50,12 Z" />',
  icecream:'<path d="M35,42 C35,26 65,26 65,42 L62,42 C66,48 64,56 58,58 L50,86 L42,58 C36,56 34,48 38,42 Z" /><path d="M30,38 C30,18 70,18 70,38" />',
  cake:    '<path d="M20,55 L80,55 L80,80 C80,86 74,90 68,90 L32,90 C26,90 20,86 20,80 Z" /><path d="M20,55 C20,45 30,45 30,55 C30,45 40,45 40,55 C40,45 50,45 50,55 C50,45 60,45 60,55 C60,45 70,45 70,55 C70,45 80,45 80,55" /><path d="M50,40 L50,28 M50,28 C46,28 46,22 50,22 C54,22 54,28 50,28 Z" />',
  gift:    '<rect x="22" y="42" width="56" height="44" rx="4" /><path d="M22,58 L78,58" /><path d="M50,42 L50,86" /><path d="M50,42 C40,30 28,32 30,44 C40,46 46,42 50,42 Z" /><path d="M50,42 C60,30 72,32 70,44 C60,46 54,42 50,42 Z" />',
  star:    '<path d="M50,16 L60,40 L86,42 L66,58 L72,84 L50,70 L28,84 L34,58 L14,42 L40,40 Z" />',
  /* game-icons "sandwich" (viewBox 512) remis à l'échelle 100. Tracé plein :
     le fill/stroke est forcé en style inline, sinon la règle .card-icon svg
     (fill:none) le rendrait invisible. */
  snacking:'<g transform="scale(0.1953)" style="fill:var(--icon-ink);stroke:none"><path d="M441.6 47.65c-5.8 0-12.1.65-18.9 1.92c-20.9 3.87-46.1 13.56-73.2 27.53c-5.7 2.93-11.5 6.04-17.3 9.33c11.4 3.5 22.9 7.26 32.7 11.65c8.8 3.82 16.4 8.12 21.9 14.42c5.5 6.4 7.7 16.7 3.5 25.3c-2.8 5.7-7.4 7-11.4 8.1c-4.1 1-8.6 1.5-13.7 1.7c-10.3.5-23.3-.2-37.5-1.6c-23.2-2.2-49.6-6.2-71.3-10.5c-13.6 9.8-27.2 20.1-40.7 30.8c11.3 3.6 21.9 8.3 31.1 13.6c10.4 6 18.9 12.5 24.5 19.9c2.8 3.8 5 7.9 5.5 12.8c.5 5-1.4 10.6-5.1 14.3c-8.1 8.3-19.4 8.6-32.3 8.4c-12.8-.1-27.7-2.1-42.5-4.7c-16.5-3-32.3-6.6-44.7-9.8c-16.3 14.9-31.6 29.9-45.8 44.5c9.6 3.7 20 8.5 29.3 13.6c8 4.4 15.1 8.9 20.4 14c2.7 2.5 5 5.1 6.6 8.7s2 9-.4 13.2v.1c-2.7 4.5-6.5 6.2-10.2 7.6c-3.6 1.4-7.7 2.4-12.3 3.1c-9.2 1.5-20.2 2.2-31.8 2.4c-19.55.3-39.81-.9-53.58-3.1c-3.33 4.4-6.47 8.6-9.37 12.8c-14.01 20.1-22.6 37.6-24.54 48.7c-.97 5.6-.34 9.1.81 11.2c1.14 2.1 2.91 3.7 7.74 5c9.18 2.3 24.81.5 44.11-6.3s42.23-18 67.03-32.5c49.6-29 106.6-70.7 159.1-114.6s100.5-90 132.2-127.6c15.8-18.8 27.6-35.45 33.6-47.93c3-6.25 4.5-11.42 4.8-14.71c.2-2.78-.1-3.68-.7-4.36c-6.5-4.27-14.9-6.64-25.1-6.92h-2.5zM311.1 98.83c-11.2 6.87-22.6 14.27-34.1 22.07c17.1 3 35.8 5.6 52.5 7.2c13.7 1.3 26.1 1.9 34.9 1.5c4.4-.2 7.9-.6 9.8-1.1c.6-.2.5-.2.7-.3c.5-1.5.1-1.9-1.7-3.9c-2.3-2.7-8-6.4-15.6-9.8c-12.6-5.6-30.1-10.7-46.5-15.67m159.3 1.47c-6.8 10.1-15.3 21.2-25.2 32.9c-10.8 12.8-23.3 26.4-37.1 40.6c9.1.4 19.1-.4 29.3-2.9c18.2-4.5 33.5-13.3 43.1-23c9.5-9.8 13-19.7 10.9-28.2c-2-8.2-9.1-15.2-21-19.4m-272.1 80.2c-7 5.8-13.9 11.6-20.7 17.5c-3.1 2.7-6.2 5.4-9.3 8.2c9.8 2.3 20.8 4.7 31.8 6.7c14.2 2.5 28.4 4.3 39.6 4.4c11.1.2 18.8-2.7 19.2-3c-.1-.4-.5-1.7-2-3.7c-3-4.1-10-9.9-19.1-15c-11.1-6.4-25.4-12-39.5-15.1m193.6 9.4c-19.9 19.5-42 39.7-65.2 59.6c5.3.8 10.9 1.3 16.7 1.3c18.8 0 35.7-4.9 47.3-12.1s17.3-16 17.3-24.8c0-8.5-5.3-16.9-16.1-24m87.6.7c-2.5 2.5-5.1 5.1-8 7.5c-60.4 51.1-133.4 117.2-206.9 169.2c-72.4 51.3-145.3 89.7-209.52 84.4c6.98 5.1 14.36 8.2 21.77 10.1c18.94 5 38.55 1.5 49.75-1.7c80.8-23.3 166.8-80.4 233.1-134.6c33.1-27.1 61.3-53.4 81.5-74.3c10.1-10.4 18.2-19.4 23.9-26.4c5.7-6.9 8.9-13.2 8.7-12.3q3.45-11.7 5.7-21.9m-170.1 73.5c-22.9 19.2-46.6 37.9-70.3 55.4c5.4.7 11 1.1 16.8 1.1c20.2 0 38.4-4.7 50.8-11.7s18.3-15.4 18.3-23.2c0-7.2-5-14.9-15.6-21.6M92.8 279.7c-9.06 9.8-17.47 19.3-25.14 28.6c11.51 1.1 26.35 1.8 40.14 1.7c11-.2 21.4-.9 29.1-2.1c3-.5 5.2-1.2 7-1.7c-.1-.2 0-.1-.1-.2c-3.3-3.2-9.5-7.4-16.8-11.4c-10.7-5.9-23.9-11.5-34.2-14.9m120.7 58.2c-22 15.4-43.6 29.4-64.2 41.4c-6.3 3.7-12.4 7.1-18.5 10.4c8.1 1.8 17.1 2.8 26.4 2.8c20.2 0 38.4-4.7 50.8-11.7s18.3-15.4 18.3-23.2c0-6.5-4.2-13.5-12.8-19.7m-109.9 65.4c-8.54 3.9-16.71 7.3-24.48 10c-19.44 6.8-36.52 10.2-51.14 7.4c1 1 2.09 1.9 3.29 2.8c7.44 5.6 18.33 9.3 30.54 9.3s23.1-3.7 30.54-9.3c7.42-5.5 11.25-12.3 11.25-19.5z"/></g>'
};

const TAG_ICONS = {
  'top-vente': '<svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 1l1.2 2.8 2.8.3-2 1.9.6 3L5 7.5 2.4 9 3 6 1 4.1l2.8-.3z"/></svg>',
  'selection': '<svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 0L10 5 5 10 0 5z"/></svg>',
  'nouveaute': '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 1v8M1 5h8"/></svg>'
};
const TAG_LABELS = {
  'top-vente': `${TAG_ICONS['top-vente']} Top vente`,
  'selection': `${TAG_ICONS['selection']} Sélection du moment`,
  'nouveaute': `${TAG_ICONS['nouveaute']} Nouveauté`
};

function setText(id, value) {
  if (value === undefined || value === null) return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  if (value === undefined || value === null) return;
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setAttr(id, attr, value) {
  if (value === undefined || value === null || value === '') return;
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}

/* Une URL venue de l'admin finit dans un href ou un src. `javascript:...`
   s'exécuterait au clic, avec la même origine que le panel d'administration :
   on n'accepte donc que les schémas inoffensifs. */
function safeUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  if (/^[./#?]/.test(raw)) return raw;              // chemin relatif ou ancre
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';  // tout autre schéma
  return raw;
}

/* Une iframe est plus sensible qu'un lien : seul https passe. */
function safeFrameUrl(url) {
  const raw = String(url ?? '').trim();
  return /^https:\/\//i.test(raw) ? raw : '';
}

function setUrlAttr(id, attr, value) {
  setAttr(id, attr, safeUrl(value));
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

/* ---------- Application des réglages fixes ---------- */
function applySettings(s) {
  if (!s) return;

  setText('heroTagline', s.tagline);

  if (Array.isArray(s.specialites) && s.specialites.length) {
    const specCards = document.getElementById('specCards');
    if (specCards) {
      const SLOT_ICONS = ['bread', 'pastry', 'icecream'];
      specCards.innerHTML = s.specialites.map((item, idx) => {
        const produitHTML = Array.isArray(item.produits) && item.produits.length
          ? `<div class="spec-selection"><p class="spec-selection-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.09 4.26L18.8 8l-3.4 3.32.8 4.68L12 13.9 7.8 16l.8-4.68L5.2 8l4.71-.74z"/></svg>Notre sélection</p><div class="spec-produits">${item.produits.map(p => `
              <div class="spec-produit">
                ${p.imageUrl ? `<img class="spec-produit-img" src="${escapeHTML(safeUrl(p.imageUrl))}" alt="${escapeHTML(p.nom)}">` : ''}
                <div class="spec-produit-info">
                  <div class="spec-produit-header">
                    <strong>${escapeHTML(p.nom)}</strong>
                    ${p.tag && TAG_LABELS[p.tag] ? `<span class="produit-tag produit-tag--${escapeHTML(p.tag)}">${TAG_LABELS[p.tag]}</span>` : ''}
                  </div>
                  ${p.description ? `<span>${escapeHTML(p.description)}</span>` : ''}
                </div>
              </div>`).join('')}</div></div>`
          : '';
        /* Deux bibliothèques : Tabler n'a pas de sandwich, Lucide si.
           Toutes deux en trait 2px sur 24, le rendu reste homogène. */
        const iconUrl = ICON_URLS[item.icon] || ICON_URLS[SLOT_ICONS[idx]] || ICON_URLS.star;
        return `
          <article class="card">
            <span class="card-icon" aria-hidden="true"><img src="${iconUrl}" alt=""></span>
            <h3>${escapeHTML(item.title || '')}</h3>
            <p>${escapeHTML(item.text || '')}</p>
            ${produitHTML}
          </article>`;
      }).join('');
    }
  }

  if (s.presse) applyPresse(s.presse);

  if (s.histoire) {
    setText('histoireTitle', s.histoire.title);
    setText('histoireText1', s.histoire.text1);
    setText('histoireText2', s.histoire.text2);
    setUrlAttr('histoireImage', 'src', s.histoire.imageUrl);
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
    if (h.address1 != null || h.address2 != null) {
      const addressHTML = `${escapeHTML(h.address1 || '')}<br>${escapeHTML(h.address2 || '')}`;
      setHTML('addressLine', addressHTML);
      setHTML('footerAddress', addressHTML);
    }
    if (h.phone != null) {
      const phoneLabel = h.phone ? (h.phoneDisplay || h.phone) : '';
      setText('phoneLink', phoneLabel);
      setText('footerPhoneText', phoneLabel);
      // Pages légales : le contact doit rester le même partout, sans
      // recopie manuelle qui finirait par diverger.
      setText('legalPhone', phoneLabel);
      if (h.phone) {
        setAttr('phoneLink', 'href', `tel:${h.phone}`);
        setAttr('footerPhoneLink', 'href', `tel:${h.phone}`);
        setAttr('maCall', 'href', `tel:${h.phone}`);
      }
    }
    // Pas d'adresse e-mail renseignée = pas de ligne du tout, ni ici ni dans
    // le pied de page. Les deux blocs restent masqués par défaut.
    const email = (h.email || '').trim();
    setHidden('emailRow', !email);
    setHidden('footerEmailLink', !email);
    if (email) {
      setText('emailLink', email);
      setText('footerEmailText', email);
      setText('legalEmail', email);
      setAttr('emailLink', 'href', `mailto:${email}`);
      setAttr('footerEmailLink', 'href', `mailto:${email}`);
    }
    if (h.instagram) {
      setUrlAttr('instagramLink', 'href', h.instagram);
      setUrlAttr('footerInstagram', 'href', h.instagram);
    }
    if (h.facebook) {
      setUrlAttr('facebookLink', 'href', h.facebook);
      setUrlAttr('footerFacebook', 'href', h.facebook);
    }
    if (h.mapUrl) setAttr('mapIframe', 'src', safeFrameUrl(h.mapUrl));

    // Itinéraire de la barre mobile : construit depuis l'adresse publiée.
    const dest = [h.address1, h.address2].filter(Boolean).join(' ');
    if (dest) {
      setAttr('maRoute', 'href',
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`);
      setAttr('footerMapsLink', 'href',
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`);
    }

    // Footer et badge ouvert/fermé dérivent du tableau d'horaires : à régénérer.
    // Les lignes sont passées telles quelles, car la page « Commander » n'a
    // pas de tableau d'horaires d'où les relire.
    if (typeof window.syncFooterHours === 'function') {
      window.syncFooterHours(Array.isArray(h.rows) && h.rows.length ? h.rows : undefined);
    }
    if (typeof window.refreshOpenStatus === 'function') window.refreshOpenStatus();
  }

  setText('contactIntro', s.contactIntro);
}

/* ---------- « Ils parlent de nous » ---------- */
/* Articles de presse et avis Google, choisis un par un depuis le panel.
   Rien n'est récupéré automatiquement : la sélection est éditoriale. */

const LIEN_EXTERNE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

function etoiles(note) {
  const n = Math.max(0, Math.min(5, Math.round(Number(note) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function renderArticlePresse(a) {
  const url = safeUrl(a.url);
  const image = safeUrl(a.imageUrl);
  const dedans = `
    ${image ? `<img class="presse-photo" src="${escapeHTML(image)}" alt="" loading="lazy">` : ''}
    <div class="presse-article-corps">
      ${a.media ? `<span class="presse-media">${escapeHTML(a.media)}</span>` : ''}
      <h3>${escapeHTML(a.titre || '')}</h3>
      ${a.extrait ? `<p class="presse-extrait">« ${escapeHTML(a.extrait)} »</p>` : ''}
      ${a.date ? `<p class="presse-date">${escapeHTML(a.date)}</p>` : ''}
      ${url ? `<span class="presse-lire">Lire l'article ${LIEN_EXTERNE_SVG}</span>` : ''}
    </div>`;

  // Sans lien valide, la carte reste lisible mais cesse d'être cliquable :
  // un <a href=""> rechargerait la page d'accueil.
  return url
    ? `<a class="presse-article" href="${escapeHTML(url)}" target="_blank" rel="noopener">${dedans}</a>`
    : `<article class="presse-article">${dedans}</article>`;
}

function renderAvis(av) {
  return `
    <figure class="avis-carte">
      <div class="avis-etoiles" aria-label="${escapeHTML(Math.round(Number(av.note) || 0))} sur 5">${etoiles(av.note)}</div>
      <blockquote>${escapeHTML(av.texte || '')}</blockquote>
      <figcaption>${escapeHTML(av.auteur || 'Client')}${
        av.date ? ` <span class="avis-source">· ${escapeHTML(av.date)}</span>` : ''
      }</figcaption>
    </figure>`;
}

function applyPresse(p) {
  const section  = document.getElementById('presse');
  const articles = document.getElementById('presseArticles');
  const avis     = document.getElementById('presseAvis');
  if (!section || !articles || !avis) return;

  const listeArticles = (Array.isArray(p.articles) ? p.articles : []).filter(a => a.titre);
  const listeAvis     = (Array.isArray(p.avis)     ? p.avis     : []).filter(a => a.texte);

  articles.innerHTML = listeArticles.map(renderArticlePresse).join('');
  avis.innerHTML     = listeAvis.map(renderAvis).join('');

  // Plus rien à montrer : la section disparaît, et le séparateur qui la suit
  // avec elle — son dégradé partirait sinon d'une couleur devenue absente.
  const vide = !listeArticles.length && !listeAvis.length;
  section.hidden = vide;
  const separateur = section.nextElementSibling;
  if (separateur && separateur.classList.contains('divider')) separateur.hidden = vide;
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
    ? `<a href="${escapeHTML(safeUrl(b.linkUrl))}" class="btn btn-primary">${escapeHTML(b.linkText)}</a>`
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
          <div class="text-image-frame"><img src="${escapeHTML(safeUrl(b.imageUrl))}" alt=""></div>
        </div>
        <div class="text-image-text">
          <h2>${escapeHTML(b.title)}</h2>
          <p>${escapeHTML(b.text)}</p>
        </div>
      </div>
    </section>`;
}

function renderGallery(b) {
  const imgs = (b.images || []).map(url => `<img src="${escapeHTML(safeUrl(url))}" alt="">`).join('');
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

  // Pas de where+orderBy combiné : évite l'exigence d'index composite Firestore.
  // On récupère tout et on filtre/trie côté client.
  const snap = await getDocs(collection(db, 'blocks'));

  const html = snap.docs
    .map(d => d.data())
    .filter(b => b.visible !== false && RENDERERS[b.type])
    .sort((a, b) => (a.order || 0) - (b.order || 0))
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
