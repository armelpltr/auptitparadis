// ============================================================
// MOT DE PASSE — mesure de solidité et refus des plus faibles
//
// Ce module ne fait qu'informer et guider : c'est le Worker qui décide
// vraiment, en revérifiant la même longueur minimale avant de créer le
// compte. Un contrôle qui ne vit que dans le navigateur se contourne en
// ouvrant les outils de développement.
//
// Quatre exigences : huit caractères, une majuscule, un chiffre, un
// caractère spécial. S'y ajoutent des refus de motifs, qui écartent ce
// qu'un attaquant essaie en premier même quand la composition est bonne —
// « Password1! » satisfait les quatre règles et ne vaut rien.
//
// La jauge, elle, continue de récompenser la longueur : à composition
// égale, c'est elle qui fait le travail contre une attaque par force brute.
// Le minimum est un plancher, pas un objectif.
// ============================================================

export const LONGUEUR_MINIMALE = 8;

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

  // Les quatre exigences, dans l'ordre où on les corrige naturellement.
  if (s.length < LONGUEUR_MINIMALE) {
    defauts.push(`${LONGUEUR_MINIMALE} caractères minimum`);
  }
  if (!/[A-ZÀ-Þ]/.test(s)) {
    defauts.push('il manque une majuscule');
  }
  if (!/[0-9]/.test(s)) {
    defauts.push('il manque un chiffre');
  }
  if (!/[^a-zA-Z0-9À-ÿ]/.test(s)) {
    defauts.push('il manque un caractère spécial (!?*-…)');
  }

  /* Ces refus-ci ne portent pas sur la composition mais sur le contenu :
     « Password1! » satisfait les quatre exigences et se casse pourtant en
     quelques secondes, parce qu'il est en tête de toutes les listes. */
  if (COURANTS.some(m => s.toLowerCase().includes(m))) {
    defauts.push('évitez les mots trop attendus');
  }
  if (aUneSuite(s)) {
    defauts.push('évitez les suites de touches ou de chiffres');
  }
  if (/(.)\1{3,}/.test(s)) {
    defauts.push('évitez de répéter le même caractère');
  }
  if (personnel.length && reprendUnePersonnelle(s, personnel)) {
    defauts.push('évitez votre nom ou votre adresse');
  }

  /* Le minimum est un plancher, pas un objectif : à composition égale, c'est
     la longueur qui fait le travail contre une attaque par force brute. La
     jauge continue donc de monter bien au-delà des huit caractères exigés. */
  let points = 1;
  if (s.length >= 10) points += 1;
  if (s.length >= 14) points += 1;
  if (s.length >= 18) points += 1;

  // Un défaut relevé plafonne le score : inutile d'afficher « solide » sur
  // un mot de passe qu'on refuse par ailleurs.
  let score = Math.min(4, points);
  if (defauts.length) score = Math.min(score, 1);
  if (!s) score = 0;

  const LIBELLES = ['Trop court', 'Insuffisant', 'Correct', 'Bon', 'Excellent'];

  return {
    score,
    libelle: s ? LIBELLES[score] : '',
    defauts,
    accepte: defauts.length === 0
  };
}
