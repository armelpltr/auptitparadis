// ============================================================
// HABILLAGE DE NOËL — bascule du thème rouge/vert
//
// Le réglage vit dans Firestore (settings/noel.theme), qui n'arrive
// qu'après un aller-retour réseau : la page se peindrait d'abord en crème
// puis basculerait en rouge sous les yeux du visiteur. On garde donc le
// dernier état connu en localStorage pour peindre juste dès la première
// image ; site-data.js corrige ensuite si la boulangerie a changé d'avis.
//
// Script classique et non module : un module est différé par défaut, donc
// exécuté après le premier rendu — exactement ce qu'on cherche à éviter.
// ============================================================
(function () {
  var KEY = 'apb-theme-noel';

  function apply(on) {
    document.documentElement.classList.toggle('theme-noel', !!on);
  }

  // Un navigateur en navigation privée peut refuser localStorage : le thème
  // s'appliquera simplement une fois Firestore chargé.
  try { apply(localStorage.getItem(KEY) === '1'); } catch (e) {}

  window.setNoelTheme = function (on) {
    apply(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  };
})();
