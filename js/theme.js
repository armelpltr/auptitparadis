// ============================================================
// HABILLAGE DE NOËL — palette, guirlande, neige, compte à rebours
//
// Le réglage vit dans Firestore (settings/noel.theme), qui n'arrive
// qu'après un aller-retour réseau : la page se peindrait d'abord en crème
// puis basculerait en rouge sous les yeux du visiteur. On garde donc le
// dernier état connu en localStorage pour peindre juste dès la première
// image ; site-data.js corrige ensuite si la boulangerie a changé d'avis.
//
// Script classique et non module : un module est différé par défaut, donc
// exécuté après le premier rendu — exactement ce qu'on cherche à éviter.
//
// Le décor lui-même n'existe dans aucune page : il est monté ici, et
// démonté quand le thème est coupé. Les pages n'ont rien à savoir.
// ============================================================
(function () {
  var KEY = 'apb-theme-noel';
  var DECOR_ID = 'noelDecor';
  var COUNTDOWN_ID = 'noelCountdown';

  /* Sapin dessiné plutôt qu'emoji : un emoji change de dessin d'un système
     à l'autre, et sort de la charte partout ailleurs. */
  var TREE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3 6.5 10h3L5 16h5v5h4v-5h5l-4.5-6h3z"/></svg>';

  function buildDecor() {
    // Appelé aussi en différé : le thème a pu être coupé entre-temps.
    if (!document.documentElement.classList.contains('theme-noel')) return;
    if (!document.body || document.getElementById(DECOR_ID)) return;

    var decor = document.createElement('div');
    decor.id = DECOR_ID;
    decor.setAttribute('aria-hidden', 'true');
    decor.innerHTML =
      '<div class="noel-snow">' +
        '<i class="noel-snow-1"></i>' +
        '<i class="noel-snow-2"></i>' +
        '<i class="noel-snow-3"></i>' +
      '</div>';
    document.body.appendChild(decor);

    buildGuirlande();
    buildBonnet();
    buildCountdown();
  }

  /* La guirlande se range dans le header, pas dans #noelDecor : accrochée
     à `top:100%`, elle suit sa hauteur au défilement sans qu'on ait à la
     recalculer. */
  function buildGuirlande() {
    var header = document.querySelector('.site-header');
    if (!header || header.querySelector('.noel-garland')) return;
    var g = document.createElement('div');
    g.className = 'noel-garland';
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML =
      '<span class="noel-bulbs noel-bulbs-1"></span>' +
      '<span class="noel-bulbs noel-bulbs-2"></span>' +
      '<span class="noel-bulbs noel-bulbs-3"></span>' +
      '<span class="noel-bulbs noel-bulbs-4"></span>';
    header.appendChild(g);
  }

  /* Bonnet posé sur le grand logo du hero. Le logo est un <img> centré dont
     la largeur dépend de la fenêtre (600 px, plafonnés à 90vw) : on
     l'emballe dans un conteneur qui épouse sa taille, ce qui permet de
     placer le bonnet en pourcentages. Il reste ainsi au même endroit du
     dessin quelle que soit la largeur d'écran.
     Absent des pages légales et de la page de commande, qui n'ont pas de
     hero — d'où le test. */
  function buildBonnet() {
    var logo = document.querySelector('.hero-logo');
    if (!logo || logo.parentNode.classList.contains('noel-logo-wrap')) return;

    var wrap = document.createElement('span');
    wrap.className = 'noel-logo-wrap';
    logo.parentNode.insertBefore(wrap, logo);
    wrap.appendChild(logo);
    wrap.appendChild(img('assets/noel/bonnet.svg', 'noel-bonnet'));
  }

  /* Défait l'emballage du logo, sinon couper le thème laisserait le hero
     avec un conteneur en trop autour de son image. */
  function removeBonnet() {
    var wrap = document.querySelector('.noel-logo-wrap');
    if (!wrap) return;
    var logo = wrap.querySelector('.hero-logo');
    if (logo) wrap.parentNode.insertBefore(logo, wrap);
    wrap.remove();
  }

  function img(src, className) {
    var el = document.createElement('img');
    el.src = src;
    el.className = className;
    el.alt = '';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function removeDecor() {
    var decor = document.getElementById(DECOR_ID);
    if (decor) decor.remove();
    var cd = document.getElementById(COUNTDOWN_ID);
    if (cd) cd.remove();
    // La guirlande vit dans le header, pas dans #noelDecor.
    var g = document.querySelector('.noel-garland');
    if (g) g.remove();
    removeBonnet();
  }

  /* Nombre de jours entiers d'ici au 25 décembre. Le calcul se fait à midi
     des deux côtés : à minuit pile, une heure d'été ou une seconde de
     décalage suffirait à faire basculer la soustraction d'un jour. */
  function joursAvantNoel() {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    var noel = new Date(now.getFullYear(), 11, 25, 12);
    if (today > noel) noel = new Date(now.getFullYear() + 1, 11, 25, 12);
    return Math.round((noel - today) / 86400000);
  }

  function buildCountdown() {
    var hero = document.querySelector('.hero-inner');
    var actions = hero && hero.querySelector('.hero-actions');
    if (!actions || document.getElementById(COUNTDOWN_ID)) return;

    var jours = joursAvantNoel();
    // Au-delà de deux mois, l'annonce ne dit plus rien d'utile : le décor
    // reste, le décompte disparaît.
    if (jours > 60) return;

    var texte;
    if (jours === 0)      texte = 'Joyeux Noël !';
    else if (jours === 1) texte = 'Plus qu’un jour avant Noël';
    else                  texte = 'Plus que ' + jours + ' jours avant Noël';

    var el = document.createElement('p');
    el.id = COUNTDOWN_ID;
    el.className = 'noel-countdown';
    el.innerHTML = TREE_SVG + '<span></span>';
    el.querySelector('span').textContent = texte;
    actions.parentNode.insertBefore(el, actions);
  }

  function apply(on) {
    document.documentElement.classList.toggle('theme-noel', !!on);
    if (!on) { removeDecor(); return; }
    // Le script s'exécute dans le <head> : au premier passage, <body>
    // n'existe pas encore.
    if (document.body) buildDecor();
    else document.addEventListener('DOMContentLoaded', buildDecor, { once: true });
  }

  // Un navigateur en navigation privée peut refuser localStorage : le thème
  // s'appliquera simplement une fois Firestore chargé.
  try { apply(localStorage.getItem(KEY) === '1'); } catch (e) {}

  window.setNoelTheme = function (on) {
    apply(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  };
})();
