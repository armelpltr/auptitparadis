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

  // Présent mais vide = tout a été retiré depuis le panel, on le respecte.
  // Absent = réglage jamais écrit, le repli du HTML reste en place.
  if (s.presse) {
    applyTemoignages(s.presse);
    applyActualites(s.presse);
  }

  applyRealisations(s.realisations);
  applyEquipe(s.equipe);

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

/* ---------- « Ils parlent de nous » et « Actualités » ---------- */
/* Les avis d'un côté, les articles de presse de l'autre : deux sections sur
   le site, un seul réglage dans Firestore (`presse.avis` et
   `presse.articles`). La séparation est éditoriale, pas une migration — les
   articles déjà publiés n'ont pas eu à changer de place.
   Rien n'est récupéré automatiquement : la sélection est faite à la main
   depuis le panel. */

/* Une rubrique facultative se retire avec la vague qui la suit : le dégradé
   de celle-ci part d'une couleur qui ne serait plus à l'écran. */
function afficherSection(id, remplie) {
  const section = document.getElementById(id);
  if (!section) return;              // page qui ne porte pas cette section
  section.hidden = !remplie;
  const separateur = section.nextElementSibling;
  if (separateur && separateur.classList.contains('divider')) separateur.hidden = !remplie;
}

/* Un lien de menu vers une section vide ne mène nulle part : les liens des
   rubriques facultatives naissent masqués dans le HTML et c'est le contenu
   publié qui les révèle. Réglé à part de la section elle-même : les pages
   secondaires portent le menu sans porter les sections. */
function montrerLienNav(cle, visible) {
  document.querySelectorAll(`[data-nav-${cle}]`).forEach(el => { el.hidden = !visible; });
}

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
  const auteur = av.auteur || 'Client';
  return `
    <figure class="avis-carte">
      <div class="avis-bulle">
        <div class="avis-etoiles" aria-label="${escapeHTML(Math.round(Number(av.note) || 0))} sur 5">${etoiles(av.note)}</div>
        <blockquote>${escapeHTML(av.texte || '')}</blockquote>
      </div>
      <figcaption>
        <span class="avis-initiale" aria-hidden="true">${escapeHTML(auteur.trim().charAt(0).toUpperCase())}</span>
        <span>${escapeHTML(auteur)}${
          av.date ? ` <span class="avis-source">· ${escapeHTML(av.date)}</span>` : ''
        }</span>
      </figcaption>
    </figure>`;
}

function applyTemoignages(p) {
  const liste = (Array.isArray(p.avis) ? p.avis : []).filter(a => a.texte);
  montrerLienNav('avis', liste.length > 0);

  const grille = document.getElementById('presseAvis');
  if (!grille) return;               // page sans la rubrique
  const cartes = liste.map(renderAvis).join('');

  // En dessous de trois avis, un bandeau qui défile tournerait à vide :
  // les cartes restent posées côte à côte.
  if (liste.length < 3) {
    grille.classList.remove('avis-defile');
    grille.innerHTML = cartes;
  } else {
    // La piste porte deux fois la liste : quand la première moitié est
    // sortie, la seconde est exactement à sa place et l'animation repart
    // de zéro sans saut. La copie est cachée aux lecteurs d'écran et au
    // clavier — ils lisent chaque avis une seule fois.
    grille.classList.add('avis-defile');
    grille.innerHTML = `
      <div class="avis-piste" style="--avis-duree:${liste.length * 9}s">
        <div class="avis-serie">${cartes}</div>
        <div class="avis-serie" aria-hidden="true" inert>${cartes}</div>
      </div>
      <button type="button" class="avis-pause" aria-pressed="false">Mettre en pause</button>`;
    const bouton = grille.querySelector('.avis-pause');
    bouton.addEventListener('click', () => {
      const enPause = grille.classList.toggle('en-pause');
      bouton.setAttribute('aria-pressed', String(enPause));
      bouton.textContent = enPause ? 'Reprendre le défilement' : 'Mettre en pause';
    });
  }
  afficherSection('avis', liste.length > 0);
}

function applyActualites(p) {
  const liste = (Array.isArray(p.articles) ? p.articles : []).filter(a => a.titre);
  montrerLienNav('actualites', liste.length > 0);

  const grille = document.getElementById('presseArticles');
  if (!grille) return;
  grille.innerHTML = liste.map(renderArticlePresse).join('');
  afficherSection('actualites', liste.length > 0);
}

/* ---------- Notre équipe ---------- */
/* Le personnel, présenté depuis le panel. Aucun repli écrit en dur : une
   équipe d'exemple serait prise pour la vraie, donc sans fiche publiée la
   rubrique n'existe pas. */

/* Sans photo, l'initiale du nom tient la place du portrait : la grille garde
   son rythme même si tout le monde n'a pas encore été photographié. */
function initiale(nom) {
  const premiere = String(nom || '').trim().charAt(0);
  return premiere ? premiere.toUpperCase() : '·';
}

function renderMembre(m) {
  const photo = safeUrl(m.photoUrl);
  const nom   = String(m.nom || '').trim();
  const portrait = photo
    ? `<img class="equipe-photo" src="${escapeHTML(photo)}" alt="${escapeHTML(nom)}" loading="lazy">`
    : `<span class="equipe-monogramme" aria-hidden="true">${escapeHTML(initiale(nom))}</span>`;
  return `
    <article class="equipe-membre">
      ${portrait}
      <h3>${escapeHTML(nom)}</h3>
      ${m.role ? `<p class="equipe-role">${escapeHTML(m.role)}</p>` : ''}
      ${m.mot  ? `<p class="equipe-mot">${escapeHTML(m.mot)}</p>`   : ''}
    </article>`;
}

function applyEquipe(e) {
  const membres = (Array.isArray(e && e.membres) ? e.membres : []).filter(m => m && m.nom);
  montrerLienNav('equipe', membres.length > 0);

  const grille = document.getElementById('equipeGrille');
  if (!grille) return;               // page sans la rubrique
  grille.innerHTML = membres.map(renderMembre).join('');

  // Texte d'introduction facultatif : sans lui, pas de paragraphe vide.
  const intro = document.getElementById('equipeIntro');
  const texte = String((e && e.intro) || '').trim();
  if (intro) {
    intro.textContent = texte;
    intro.hidden = !texte;
  }

  afficherSection('equipe', membres.length > 0);
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
  photosRealisations = (Array.isArray(r && r.photos) ? r.photos : [])
    .filter(p => p && safeUrl(p.url));
  montrerLienNav('realisations', photosRealisations.length > 0);

  const section = document.getElementById('realisations');
  const grille  = document.getElementById('realisationsGrille');
  if (!section || !grille) return;   // page sans galerie (commander, légales…)

  if (r && r.intro) setText('realisationsIntro', r.intro);

  // Aucune photo : la section et son séparateur restent masqués. Mieux vaut
  // pas de rubrique du tout qu'une rubrique vide.
  if (!photosRealisations.length) return;

  grille.innerHTML = photosRealisations.map(renderRealisation).join('');

  afficherSection('realisations', true);

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

/* ---------- Dégradés des vagues ---------- */
/* Chaque vague descend de la couleur de la section qu'elle quitte vers celle
   de la section qu'elle rejoint. La feuille de style décrit l'enchaînement
   complet, mais quatre rubriques peuvent manquer (pas d'avis, pas d'article,
   pas de photo, pas de fiche d'équipe) : l'ordre réel ne se connaît qu'ici,
   une fois le contenu appliqué. */
const FONDS_SECTION = {
  cream:      'var(--cream)',
  sand:       'var(--sand)',
  white:      'var(--white)',
  'sea-pale': 'var(--sea-pale)'
};

/* La couleur vient d'un attribut du HTML, donc d'une liste fermée : on ne
   recopie pas sa valeur telle quelle dans une propriété CSS. */
function fondDe(section) {
  return section ? FONDS_SECTION[section.dataset.fond] || null : null;
}

function sectionVisible(depart, sens) {
  for (let el = depart[sens]; el; el = el[sens]) {
    if (el.tagName === 'SECTION' && !el.hidden) return el;
  }
  return null;
}

function harmoniserVagues() {
  document.querySelectorAll('#main > .divider').forEach(vague => {
    if (vague.hidden) return;
    const avant = fondDe(sectionVisible(vague, 'previousElementSibling'));
    const apres = fondDe(sectionVisible(vague, 'nextElementSibling'));
    // Une extrémité manque (haut de page, pied de page, autre gabarit) : le
    // dégradé écrit dans la feuille de style reste le meilleur choix.
    if (!avant || !apres) return;
    // Une vague retournée retourne aussi son dégradé.
    const [haut, bas] = vague.classList.contains('divider-flip')
      ? [apres, avant]
      : [avant, apres];
    vague.style.background = `linear-gradient(to bottom, ${haut}, ${bas})`;
  });
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
    // Les rubriques facultatives ont pris leur état définitif : les vagues
    // peuvent s'accorder à ce qui reste visible.
    harmoniserVagues();
  }
})();
