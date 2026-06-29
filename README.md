# Au P'tit Paradis — Site vitrine + panel admin

## Structure du projet
```
auptitparadis/
├── index.html             → le site public
├── admin.html              → le panneau d'administration (protégé par connexion)
├── css/style.css            → styles du site public
├── css/admin.css             → styles du panneau admin
├── js/script.js               → menu mobile, animations du site public
├── js/site-data.js             → charge le contenu Firestore sur le site public
├── js/admin.js                  → logique du panneau admin
├── js/firebase-config.js         → À COMPLÉTER avec ta config Firebase
├── firestore.rules                → règles de sécurité à coller dans Firebase Console
├── storage.rules                   → règles de sécurité à coller dans Firebase Console
├── SETUP-FIREBASE.md                → guide pas-à-pas pour la mise en place
└── assets/logo.jpg                   → le logo
```

Aucune dépendance à installer, aucun build : dépose le dossier tel quel chez ton
hébergeur (OVH, Netlify, Cloudflare Pages, GitHub Pages...).

## Le panel admin, en bref
Le propriétaire peut se connecter sur `tonsite.fr/admin.html` (lien discret en bas
de page, dans le footer) pour :
- **Onglet "Réglages du site"** : modifier l'accroche, les 3 fiches "Nos spécialités",
  le texte et la photo de "Notre histoire", les horaires, l'adresse, le téléphone,
  l'e-mail, les liens Instagram/Facebook et la carte Google Maps.
- **Onglet "Sections"** : ajouter, modifier, réordonner, masquer ou supprimer des
  sections libres entre "Nos spécialités" et "Notre histoire" — au choix parmi
  4 modèles : Bannière (annonce), Grille de cartes, Texte + image, Galerie photo.

Ça demande un projet Firebase (gratuit) : voir `SETUP-FIREBASE.md` pour la mise en
place complète (10-15 min, une seule fois).

Tant que `js/firebase-config.js` n'est pas rempli avec une vraie config, le site
public continue d'afficher le contenu par défaut écrit dans `index.html` — rien ne
casse, l'admin affichera juste une erreur de connexion.

## Palette utilisée (extraite directement du logo)
- Noir encre : `#211c17`
- Or caramel (couleur signature) : `#c8853a`
- Caramel foncé : `#8c5a26`
- Crème (fond) : `#fbf6ee`
- Sable : `#f1e6d3`
- Touche "bord de mer" (très discrète, section Horaires) : `#5c7a78`

## Ce qu'il reste à personnaliser avant mise en ligne
1. **Adresse, téléphone, e-mail réels** — directement dans `index.html`
   (cherche `<!-- À PERSONNALISER -->`), ou plus simplement une fois l'admin
   configuré, via l'onglet "Réglages du site"
2. **Horaires réels**
3. **Carte Google Maps** : Google Maps → rechercher l'adresse → Partager →
   Intégrer une carte → copier le lien
4. **Texte "Notre histoire"**
5. **Liens Instagram / Facebook**
6. **Formulaire de contact** : statique pour l'instant — pour qu'il envoie de
   vrais e-mails, le plus simple est Formspree (https://formspree.io)
   (remplacer `action="#"` par l'URL fournie)
7. **Config Firebase** pour activer le panel admin (voir `SETUP-FIREBASE.md`)

## Pour la suite
Dis-moi simplement ce que tu veux changer : je ne te renverrai que le ou les
fichiers modifiés (pas l'archive complète), pour que tu n'aies qu'à les remplacer
dans ton dossier.
