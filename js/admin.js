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
import { initTabs } from "./admin/tabs.js";
import { initSettings, loadSettings } from "./admin/settings.js";
import { initBlocks, loadBlocks } from "./admin/blocks.js";
import { initTeam, loadTeam } from "./admin/team.js";

initTabs();
initSettings();
initBlocks();
initTeam();

initAuth(() => {
  loadSettings();
  loadBlocks();
  loadTeam();
});
