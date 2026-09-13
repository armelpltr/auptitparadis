// ============================================================
// SITE-DATA.JS — charge le contenu géré depuis l'admin (Firestore)
// et l'applique sur le site public. Si Firebase n'est pas encore
// configuré, ou indisponible, le contenu par défaut du HTML reste
// affiché : rien ne casse.
// ============================================================

import { db } from "./firebase-config.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Icônes des fiches spécialités ---------- */
/* Servies en <img> : Tabler (MIT) via jsDelivr, sauf le sandwich qui vient
   de game-icons et qui est hébergé dans le repo.
   Les clés doivent rester les mêmes que `ICONS` dans js/admin/icons.js :
   c'est ce que le panel propose dans son sélecteur, et ce qu'on relit ici
   dans `item.icon`. */
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

  applyRealisations(s.realisations);

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
      setUrlAttr('heroInstagram', 'href', h.instagram);
    }
    if (h.facebook) {
      setUrlAttr('facebookLink', 'href', h.facebook);
      setUrlAttr('footerFacebook', 'href', h.facebook);
      setUrlAttr('heroFacebook', 'href', h.facebook);
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

/* Les seules tailles de photo acceptées. Le nom vient de la base : on ne
   le recopie pas tel quel dans une classe CSS sans le vérifier. */
const TAILLES_PHOTO = ['grande', 'moyenne', 'petite'];

function renderArticlePresse(a) {
  const url = safeUrl(a.url);
  const image = safeUrl(a.imageUrl);
  const dedans = `
    ${image ? `<img class="presse-photo photo-${TAILLES_PHOTO.includes(a.taillePhoto) ? a.taillePhoto : 'grande'}" src="${escapeHTML(image)}" alt="" loading="lazy">` : ''}
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

/* ---------- Nos réalisations ---------- */
/* Galerie des commandes spéciales, choisies une par une depuis le panel.
   Six photos d'abord, le reste derrière un bouton : la page d'accueil garde
   la même longueur que la boutique en publie dix ou cent. */

const REA_VISIBLES = 6;

/* Le ratio est relevé par le panel au moment de l'import et voyage avec la
   photo. Il sert ici à réserver la place AVANT que l'image n'arrive : sans
   lui, la mosaïque se réorganise à mesure des chargements et le bouton
   « Voir plus » se déplace sous le doigt du visiteur. Une valeur venue de
   la base finit dans une propriété CSS : elle est bornée, pas recopiée. */
function ratioSur(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.2 && n <= 5 ? n.toFixed(4) : null;
}

let photosRealisations = [];

function renderRealisation(photo, index) {
  const legende = String(photo.legende || '').trim();
  const ratio = ratioSur(photo.ratio);
  return `
    <button type="button" class="rea-item" data-index="${index}"
            aria-label="Agrandir${legende ? ' : ' + escapeHTML(legende) : ' la photo'}">
      <img src="${escapeHTML(safeUrl(photo.url))}" alt="" loading="lazy"
           ${ratio ? `style="aspect-ratio:${ratio}"` : ''}>
      ${legende ? `<span class="rea-legende">${escapeHTML(legende)}</span>` : ''}
    </button>`;
}

function applyRealisations(r) {
  const section = document.getElementById('realisations');
  const grille  = document.getElementById('realisationsGrille');
  if (!section || !grille) return;   // page sans galerie (commander, légales…)

  if (r && r.intro) setText('realisationsIntro', r.intro);

  photosRealisations = (Array.isArray(r && r.photos) ? r.photos : [])
    .filter(p => p && safeUrl(p.url));

  // Aucune photo : la section, son séparateur et son lien de menu restent
  // masqués. Mieux vaut pas de rubrique du tout qu'une rubrique vide.
  if (!photosRealisations.length) return;

  grille.innerHTML = photosRealisations.map(renderRealisation).join('');

  section.hidden = false;
  const separateur = section.nextElementSibling;
  if (separateur && separateur.classList.contains('divider')) separateur.hidden = false;
  document.querySelectorAll('[data-nav-realisations]').forEach(el => { el.hidden = false; });

  const reste = photosRealisations.length - REA_VISIBLES;
  const plus = document.getElementById('realisationsPlus');
  if (plus && reste > 0) {
    const libelleDeplier = `Voir ${reste} photo${reste > 1 ? 's' : ''} de plus`;
    plus.textContent = libelleDeplier;
    plus.hidden = false;
    plus.addEventListener('click', () => {
      const deplie = grille.classList.toggle('is-deplie');
      plus.setAttribute('aria-expanded', String(deplie));
      plus.textContent = deplie ? 'Voir moins' : libelleDeplier;
      // Replier depuis le bas de la liste laisserait le visiteur devant une
      // section qui vient de raccourcir sous lui.
      if (!deplie) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  grille.addEventListener('click', e => {
    const item = e.target.closest('.rea-item');
    if (item) ouvrirVisionneuse(Number(item.dataset.index));
  });
}

/* ---------- Photo en grand ---------- */
/* Construite au premier agrandissement : tant que personne ne clique, la
   page n'a pas à porter ce balisage. */

const REA_SVG = {
  prec:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  suiv:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  fermer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

let visionneuse = null;
let photoCourante = 0;
let declencheur = null;   // pour rendre le focus au retour

function construireVisionneuse() {
  const el = document.createElement('div');
  el.className = 'rea-visionneuse';
  el.hidden = true;
  el.innerHTML = `
    <button type="button" class="rea-btn rea-fermer" aria-label="Fermer">${REA_SVG.fermer}</button>
    <button type="button" class="rea-btn rea-prec"   aria-label="Photo précédente">${REA_SVG.prec}</button>
    <figure><img alt=""><figcaption></figcaption></figure>
    <button type="button" class="rea-btn rea-suiv"   aria-label="Photo suivante">${REA_SVG.suiv}</button>`;

  el.querySelector('.rea-fermer').addEventListener('click', fermerVisionneuse);
  el.querySelector('.rea-prec').addEventListener('click', () => deplacerVisionneuse(-1));
  el.querySelector('.rea-suiv').addEventListener('click', () => deplacerVisionneuse(1));
  // Le fond ferme, la photo non : un clic à côté est le geste attendu.
  el.addEventListener('click', e => { if (e.target === el) fermerVisionneuse(); });

  document.body.appendChild(el);
  return el;
}

function afficherPhoto(index) {
  const photo = photosRealisations[index];
  if (!photo) return;
  photoCourante = index;
  const legende = String(photo.legende || '').trim();
  visionneuse.querySelector('img').src = safeUrl(photo.url);
  visionneuse.querySelector('img').alt = legende;
  visionneuse.querySelector('figcaption').textContent = legende;

  // Une seule photo : les flèches n'auraient nulle part où aller.
  const seule = photosRealisations.length < 2;
  visionneuse.querySelector('.rea-prec').hidden = seule;
  visionneuse.querySelector('.rea-suiv').hidden = seule;
}

function deplacerVisionneuse(pas) {
  const total = photosRealisations.length;
  if (!total) return;
  // Le modulo ramène dans les bornes : la galerie tourne en boucle.
  afficherPhoto((photoCourante + pas + total) % total);
}

function toucheVisionneuse(e) {
  if (e.key === 'Escape')     fermerVisionneuse();
  if (e.key === 'ArrowLeft')  deplacerVisionneuse(-1);
  if (e.key === 'ArrowRight') deplacerVisionneuse(1);
}

function ouvrirVisionneuse(index) {
  if (!Number.isInteger(index) || !photosRealisations[index]) return;
  declencheur = document.activeElement;
  if (!visionneuse) visionneuse = construireVisionneuse();
  afficherPhoto(index);
  visionneuse.hidden = false;
  // La page ne doit pas défiler derrière la photo.
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', toucheVisionneuse);
  visionneuse.querySelector('.rea-fermer').focus();
}

function fermerVisionneuse() {
  if (!visionneuse) return;
  visionneuse.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', toucheVisionneuse);
  // Le clavier revient sur la vignette d'où l'on est parti.
  if (declencheur && declencheur.isConnected) declencheur.focus();
  declencheur = null;
}

/* ---------- Utilitaires de rendu ---------- */
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
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

/* Habillage de Noël. js/theme.js a déjà posé le décor avec le dernier état
   connu ; on ne fait ici que confirmer ou corriger depuis Firestore. Réglage
   rangé dans `settings/noel` avec le reste des commandes de Noël : les deux
   s'allument et s'éteignent à la même période.
   C'est theme.js qui compare la date de fin au jour courant — il doit
   déjà savoir le faire sans réseau, autant ne pas dupliquer la règle. */
async function applyNoelTheme() {
  if (typeof window.setNoelTheme !== 'function') return;
  const snap = await getDoc(doc(db, 'settings', 'noel'));
  const s = snap.exists() ? snap.data() : {};
  window.setNoelTheme(s.theme === true, s.themeFin || '');
}

/* ---------- Lancement ---------- */
(async () => {
  // Le décor ne dépend pas du contenu : lancé sans attendre, il s'applique
  // pendant que le reste se charge.
  applyNoelTheme().catch(err => console.warn('Habillage de Noël :', err.message));

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
})();
