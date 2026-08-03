// ============================================================
// MOT DE PASSE — mesure de solidité et refus des plus faibles
//
// Ce module ne fait qu'informer et guider : c'est le Worker qui décide
// vraiment, en revérifiant la même longueur minimale avant de créer le
// compte. Un contrôle qui ne vit que dans le navigateur se contourne en
// ouvrant les outils de développement.
//
// La règle suit ce que recommandent aujourd'hui l'ANSSI et le NIST : de la
// longueur plutôt qu'un assortiment obligatoire de majuscules, chiffres et
// symboles. « P@ssw0rd! » coche toutes les cases de composition et se casse
// en quelques secondes ; « les buches de noel 2026 » n'en coche presque
// aucune et tient bien mieux.
// ============================================================

export const LONGUEUR_MINIMALE = 12;

/* Les motifs qu'un attaquant essaie en premier. La liste est courte à
   dessein : elle n'a pas vocation à remplacer une base de mots de passe
   compromis, seulement à écarter ce qu'on voit le plus souvent saisir. */
const COURANTS = [
  'motdepasse', 'password', 'azerty', 'qwerty', 'iloveyou', 'admin',
  'boulangerie', 'patisserie', 'paradis', 'ptitparadis', 'lucsurmer',
  'bonjour', 'soleil', 'chocolat', 'baguette', 'croissant'
];

function aUneSuite(mdp) {
  const bas = mdp.toLowerCase();
  const suites = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'azertyuiop', 'qwertyuiop'];
  for (const suite of suites) {
    for (let i = 0; i + 4 <= suite.length; i++) {
      const bout = suite.slice(i, i + 4);
      if (bas.includes(bout) || bas.includes([...bout].reverse().join(''))) return true;
    }
  }
  return false;
}

/* Un mot de passe bâti sur son propre nom ou son adresse ne protège de
   personne : ce sont les premières choses que devine qui vous connaît. */
function reprendUnePersonnelle(mdp, personnel) {
  const bas = mdp.toLowerCase();
  return personnel
    .map(v => String(v || '').toLowerCase().split('@')[0])
    .filter(v => v.length >= 4)
    .some(v => bas.includes(v));
}

/**
 * Évalue un mot de passe.
 * Renvoie son score de 0 à 4, un libellé, et la liste des reproches à
 * corriger. `accepte` dit si la création peut se faire.
 */
export function evaluerMotDePasse(mdp, personnel = []) {
  const s = String(mdp || '');
  const defauts = [];

  if (s.length < LONGUEUR_MINIMALE) {
    defauts.push(`${LONGUEUR_MINIMALE} caractères minimum`);
  }
  if (COURANTS.some(m => s.toLowerCase().includes(m))) {
    defauts.push('évitez les mots trop attendus');
  }
  if (aUneSuite(s)) {
    defauts.push('évitez les suites de touches ou de chiffres');
  }
  if (/^(.)\1+$/.test(s) || /(.)\1{3,}/.test(s)) {
    defauts.push('évitez de répéter le même caractère');
  }
  if (personnel.length && reprendUnePersonnelle(s, personnel)) {
    defauts.push('évitez votre nom ou votre adresse');
  }

  /* Le score mélange longueur et variété, la longueur pesant le plus : c'est
     elle qui fait vraiment le travail contre une attaque par force brute. */
  let points = 0;
  if (s.length >= 12) points += 2;
  if (s.length >= 16) points += 1;
  if (s.length >= 20) points += 1;

  const familles = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(s)).length;
  if (familles >= 2) points += 1;
  if (familles >= 3) points += 1;

  // Un défaut relevé plafonne le score : inutile d'afficher « solide » sur
  // un mot de passe qu'on refuse par ailleurs.
  let score = Math.min(4, points);
  if (defauts.length) score = Math.min(score, 1);
  if (!s) score = 0;

  const LIBELLES = ['Trop court', 'Faible', 'Correct', 'Bon', 'Excellent'];

  return {
    score,
    libelle: s ? LIBELLES[score] : '',
    defauts,
    accepte: s.length >= LONGUEUR_MINIMALE && defauts.length === 0
  };
}
