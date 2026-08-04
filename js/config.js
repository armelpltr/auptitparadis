// ============================================================
// CONFIG — points d'entrée externes, partagés par tout le site
//
// L'adresse du Worker était écrite en dur dans trois fichiers. Elle n'a rien
// de secret — le navigateur l'appelle, elle est publique par construction —
// mais elle changera le jour d'un nom de domaine propre, et une copie
// oubliée casse une page sans que rien ne le signale. Une seule source, donc.
// ============================================================

/* Ce que le navigateur ne peut pas faire seul : écrire une commande après
   vérification anti-bot, relire une commande depuis le lien reçu par
   e-mail, supprimer le compte de quelqu'un d'autre, ou vérifier le code de
   sortie du mode jour J. Le Worker détient la clé de service et refait
   toutes les vérifications côté serveur : le client peut mentir. */
export const WORKER_URL = 'https://auptitparadis-worker.armelpltr14-ad6.workers.dev';
