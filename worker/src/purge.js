// ============================================================
// PURGE — efface les commandes dont la durée de conservation est passée
//
// Une commande porte le nom, le téléphone et l'adresse d'un client. Rien ne
// justifie de les garder indéfiniment, et la page de confidentialité annonce
// une durée : elle doit être tenue par du code, pas par une bonne intention.
//
// Le décompte part du JOUR DE RETRAIT et non de la date de commande, parce
// que c'est ce que la page promet — et parce que c'est ce qui a du sens ici :
// une commande passée en novembre pour le 24 décembre reste utile jusqu'au
// retrait, pas trois mois après l'avoir saisie.
//
// Déclenché par un cron du Worker (voir wrangler.toml), une fois par nuit.
// ============================================================

import { firestoreQueryBefore, firestoreDelete } from './firebase.js';

const JOURS_CONSERVATION = 90;

/* Plafond par exécution. La purge tourne tous les jours : elle n'a qu'un
   jour de retard à rattraper, jamais trois cents commandes. Le plafond
   protège seulement du cas où on la lancerait sur un historique jamais
   nettoyé — mieux vaut plusieurs nuits qu'une exécution coupée en plein
   milieu, à mi-chemin d'un état cohérent. */
const MAX_PAR_PASSAGE = 300;

/* `dateRetrait` est une chaîne « AAAA-MM-JJ ». Comparées comme des chaînes,
   ces dates s'ordonnent correctement — c'est la propriété qui fait de l'ISO
   8601 un format triable, et elle évite ici d'avoir à convertir quoi que ce
   soit côté Firestore. */
function limiteISO(maintenant) {
  const d = new Date(maintenant.getTime() - JOURS_CONSERVATION * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function purgerCommandes(env, maintenant = new Date()) {
  const limite = limiteISO(maintenant);

  const perimees = await firestoreQueryBefore(
    'orders', 'dateRetrait', limite, env, MAX_PAR_PASSAGE
  );

  let effacees = 0;
  for (const commande of perimees) {
    /* La requête compare des chaînes : une date vide, ou mal formée, trie
       avant n'importe quelle date réelle et remonterait ici quel que soit
       son âge. `dateIso()` impose le format à l'écriture, mais une
       suppression définitive ne se fonde pas sur cette confiance — on
       revérifie ce qu'on s'apprête à effacer. */
    const jour = String(commande.dateRetrait ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || jour >= limite) {
      console.error(`[purge] ${commande.id} epargnee — dateRetrait inattendue : « ${jour} »`);
      continue;
    }

    try {
      await firestoreDelete(`orders/${commande.id}`, env);
      effacees++;
    } catch (err) {
      // Un échec isolé ne doit pas arrêter la purge : la commande suivante
      // n'y est pour rien, et le passage de demain reprendra celle-ci.
      console.error(`[purge] ${commande.id} non supprimée :`, err.message);
    }
  }

  console.log(`[purge] retraits avant ${limite} — ${effacees}/${perimees.length} commandes effacées`);
  return effacees;
}
