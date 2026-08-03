// ============================================================
// ADMIN — point d'entrée du panneau d'administration
// Au P'tit Paradis
//
// La logique vit dans js/admin/ : un module par onglet, plus quelques
// modules partagés (ui, icons, uploader). Ce fichier ne fait que câbler
// les écrans au chargement, puis charger les données une fois l'accès
// au panel accordé.
// ============================================================

import { initAuth } from "./admin/auth.js";
import { initTabs, appliquerRole } from "./admin/tabs.js";
import { initSettings, loadSettings } from "./admin/settings.js";
import { initBlocks, loadBlocks } from "./admin/blocks.js";
import { initTeam, loadTeam } from "./admin/team.js";
import { initNoel, loadNoel } from "./admin/noel.js";
import { initOrders, loadOrders, appliquerRoleOrders } from "./admin/orders.js";

initTabs();
initSettings();
initBlocks();
initTeam();
initNoel();
initOrders();

/* Chaque onglet ne charge ses données que si le rôle y donne droit :
   sinon les règles Firestore refusent la lecture et l'onglet, masqué,
   afficherait quand même son message d'erreur au premier plan. */
initAuth((role) => {
  appliquerRole(role);

  loadSettings();
  loadBlocks();

  if (role === 'superadmin' || role === 'admin') {
    loadTeam();
    loadNoel();
    loadOrders();
    // La remise à zéro de la numérotation n'est ouverte qu'au superadmin.
    appliquerRoleOrders(role);
  }
});
