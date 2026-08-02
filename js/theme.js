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

    buildPersonnages();
    buildOrnements();
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

  /* Un ornement par section, en alternant les côtés. Le sucre d'orge et le
     houx pendent du haut, le reste pousse du bas. */
  var ORNEMENTS = [
    { nom: 'sapin' },
    { nom: 'cadeaux' },
    { nom: 'canne', haut: true },
    { nom: 'lutin' },
    { nom: 'houx', haut: true }
  ];

  /* Toutes les sections, pas seulement celles de <main> : « Vos avis » est
     en dehors, et les blocs pilotés depuis l'admin arrivent plus tard. */
  function buildOrnements() {
    var cibles = document.querySelectorAll('section, .site-footer');
    var i = 0;
    cibles.forEach(function (sec) {
      // Le hero a déjà son traîneau et ses deux lutins.
      if (sec.classList.contains('hero') || sec.querySelector(':scope > .noel-ornement')) return;
      var o = ORNEMENTS[i % ORNEMENTS.length];
      var classe = 'noel-ornement noel-ornement--' + (i % 2 ? 'd' : 'g') +
                   (o.haut ? ' noel-ornement--haut' : '');
      sec.appendChild(img('assets/noel/' + o.nom + '.svg', classe));
      i++;
    });
  }

  /* Père Noël, lutins et bonnet. Chacun est optionnel : les pages légales
     n'ont pas de hero, la page de commande non plus. */
  function buildPersonnages() {
    var brand = document.querySelector('.brand');
    if (brand && !brand.querySelector('.noel-bonnet')) {
      brand.appendChild(img('assets/noel/bonnet.svg', 'noel-bonnet'));
    }

    var hero = document.querySelector('.hero');
    if (!hero || hero.querySelector('.noel-traineau')) return;
    hero.appendChild(img('assets/noel/traineau.svg', 'noel-traineau'));
    hero.appendChild(img('assets/noel/lutin.svg', 'noel-lutin noel-lutin-g'));
    hero.appendChild(img('assets/noel/lutin.svg', 'noel-lutin noel-lutin-d'));
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
    // Les personnages vivent dans le header et le hero, pas dans #noelDecor :
    // ils se retirent un par un.
    document.querySelectorAll('.noel-bonnet, .noel-traineau, .noel-lutin, .noel-ornement, .noel-garland')
      .forEach(function (el) { el.remove(); });
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

  /* Les sections pilotées depuis l'admin arrivent après ce script :
     site-data.js rappelle ceci une fois qu'elles sont posées, pour qu'elles
     reçoivent leur ornement elles aussi. */
  window.decoreSectionsNoel = function () {
    if (document.documentElement.classList.contains('theme-noel')) buildOrnements();
  };

  window.setNoelTheme = function (on) {
    apply(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  };
})();
