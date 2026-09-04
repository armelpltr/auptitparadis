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

/* ---------- Compteurs à durée de vie ---------- */

/* Les plafonds anti-force-brute portent désormais leur fenêtre dans le nom
   du document (`<uid>_<fenêtre>`), ce qui rend l'incrément atomique mais
   laisse un document derrière chaque fenêtre utilisée. Ils ne contiennent
   qu'un entier et une date, mais rien ne les efface : la purge nocturne
   passe derrière, sur le même principe que les commandes.

   `expireLe` est un timestamp : la comparaison se fait sur la date du jour,
   pas sur une chaîne. Un document sans ce champ ne remonte pas — Firestore
   écarte les documents où le champ filtré est absent — et reste donc en
   place, ce qui est le bon défaut : on n'efface que ce qui s'annonce
   périmé. */
const COMPTEURS_EPHEMERES = ['jourjEssais', 'imageQuota'];

async function purgerCompteurs(env, maintenant) {
  for (const collection of COMPTEURS_EPHEMERES) {
    try {
      const perimes = await firestoreQueryBefore(
        collection, 'expireLe', maintenant, env, MAX_PAR_PASSAGE
      );
      let effaces = 0;
      for (const doc of perimes) {
        try {
          await firestoreDelete(`${collection}/${doc.id}`, env);
          effaces++;
        } catch (err) {
          console.error(`[purge] ${collection}/${doc.id} non supprimé :`, err.message);
        }
      }
      if (perimes.length) console.log(`[purge] ${collection} — ${effaces}/${perimes.length} compteurs effacés`);
    } catch (err) {
      // Une collection encore vide n'existe pas : ce n'est pas une panne.
      console.error(`[purge] ${collection} illisible :`, err.message);
    }
  }
}

/* Les défis de double authentification s'effacent d'eux-mêmes — à la
   validation, à l'expiration constatée, au dépassement du nombre d'essais.
   Restent ceux qu'on abandonne en fermant l'onglet : ils portent un code
   haché et salé, donc rien d'utilisable, mais ils n'ont plus de raison
   d'être une fois leur validité passée. `expiresAt` y est un nombre de
   millisecondes, d'où la comparaison numérique. */
async function purgerDefisA2F(env, maintenant) {
  try {
    const perimes = await firestoreQueryBefore(
      'otpChallenges', 'expiresAt', maintenant.getTime(), env, MAX_PAR_PASSAGE
    );
    let effaces = 0;
    for (const doc of perimes) {
      try {
        await firestoreDelete(`otpChallenges/${doc.id}`, env);
        effaces++;
      } catch (err) {
        console.error(`[purge] otpChallenges/${doc.id} non supprimé :`, err.message);
      }
    }
    if (perimes.length) console.log(`[purge] otpChallenges — ${effaces}/${perimes.length} défis effacés`);
  } catch (err) {
    console.error('[purge] otpChallenges illisible :', err.message);
  }
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

  /* Les compteurs éphémères partent dans le même passage : une seule
     tâche planifiée, un seul réveil du Worker. Un échec de leur côté ne
     doit pas remettre en cause la purge des commandes, déjà faite. */
  await purgerCompteurs(env, maintenant);
  await purgerDefisA2F(env, maintenant);

  return effacees;
}
