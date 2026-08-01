// ============================================================
// CONFIG — points d'entrée externes du panel
// ============================================================

/* Supprimer le compte de quelqu'un d'autre, ou valider un jeton anti-bot,
   demande des droits que le SDK navigateur n'a pas. Le Worker les détient et
   refait toutes les vérifications côté serveur : le client peut mentir. */
export const WORKER_URL = 'https://auptitparadis-worker.armelpltr14-ad6.workers.dev';
