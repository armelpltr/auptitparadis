// ============================================================
// ANTI-FRAMING — refuse d'être affiché dans l'iframe d'un tiers
//
// La parade normale est un en-tête HTTP (`X-Frame-Options`, ou
// `frame-ancestors` dans la CSP). GitHub Pages n'en envoie aucun et ne
// permet pas d'en ajouter, et `frame-ancestors` est ignoré par les
// navigateurs quand la politique vient d'une balise <meta> — ce qui est
// notre cas. La CSP du panel ne couvre donc pas ce point.
//
// Sans cela : un site tiers charge le panel dans une iframe, superpose ses
// propres éléments transparents, et fait cliquer une personne déjà connectée
// là où il veut — supprimer un accès, remettre la numérotation à zéro,
// annuler une commande. La double authentification n'y change rien, elle est
// justement déjà franchie pendant une session de travail.
//
// Ce script est classique et non module, et placé avant les autres : un
// module est différé, il s'exécuterait après l'affichage de la page.
// ============================================================

(function () {
  'use strict';
  if (window.top === window.self) return;

  /* Masquer d'abord : si la page qui nous encadre interdit la navigation
     (iframe `sandbox` sans `allow-top-navigation`), la sortie échoue et il
     ne doit alors rien rester de cliquable ni de lisible. */
  document.documentElement.style.display = 'none';

  try {
    window.top.location = window.self.location;
  } catch (e) {
    /* Navigation refusée : la page reste masquée, c'est le but. */
  }
})();
