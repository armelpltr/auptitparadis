# Mise en place de Firebase — panneau admin Au P'tit Paradis

Le panneau admin (`admin.html`) a besoin d'un projet Firebase pour stocker le contenu
modifiable (Firestore), les photos (Storage) et le compte de connexion (Authentication).
Tout est gratuit pour ce volume d'usage (offre Spark).

## 1. Créer le projet
1. Va sur [console.firebase.google.com](https://console.firebase.google.com)
2. "Ajouter un projet" → nomme-le par ex. `auptitparadis` → suis les étapes (Google Analytics
   optionnel, tu peux le désactiver)

## 2. Activer Firestore Database
1. Menu de gauche → **Firestore Database** → "Créer une base de données"
2. Choisis **mode production**, région `eur3 (europe-west)` (ou la plus proche)
3. Une fois créée : onglet **Règles** → colle le contenu du fichier `firestore.rules`
   fourni dans ce projet → **Publier**

## 3. Activer Authentication
1. Menu de gauche → **Authentication** → "Get started"
2. Onglet **Sign-in method** → active **E-mail/Mot de passe**
3. Onglet **Users** → **"Add user"** → renseigne l'e-mail et le mot de passe du propriétaire
   (⚠️ il n'y a volontairement aucune page d'inscription publique sur le site : c'est ici,
   dans la console, qu'on crée les comptes autorisés — un par personne qui doit pouvoir
   modifier le site)

## 4. Activer Storage
1. Menu de gauche → **Storage** → "Get started" → mode production
2. Onglet **Règles** → colle le contenu du fichier `storage.rules` fourni → **Publier**

## 5. Récupérer la configuration Web
1. Icône ⚙️ (Paramètres du projet) → onglet **Général**
2. Section "Vos applications" → icône `</>` (Web) → donne un nom (ex. "Site vitrine") →
   "Enregistrer l'application"
3. Copie l'objet `firebaseConfig` affiché
4. Ouvre `js/firebase-config.js` dans le projet et remplace les valeurs `"À_COMPLETER"`
   par celles copiées

## 6. Mettre en ligne
Héberge le dossier complet (avec `admin.html` inclus) chez ton hébergeur habituel.
Aucune étape de build n'est nécessaire : ce sont des fichiers statiques.

## 7. Premier remplissage du contenu
1. Ouvre `tonsite.fr/admin.html`
2. Connecte-toi avec le compte créé à l'étape 3
3. Onglet **Réglages du site** : remplis les champs avec le contenu actuel (adresse,
   horaires, téléphone, etc.) puis **Enregistrer les réglages**
4. Onglet **Sections** : ajoute des bannières, galeries ou grilles de cartes au besoin

Tant que les réglages n'ont pas été enregistrés une première fois depuis l'admin,
le site affiche le contenu par défaut écrit dans `index.html` — rien ne casse.

## Pour donner l'accès au propriétaire
Une fois que tout fonctionne, tu peux soit :
- lui donner directement l'e-mail/mot de passe du compte admin créé à l'étape 3, ou
- créer un second compte à son nom (étape 3, "Add user" à nouveau) et garder le tien
  séparé pour la maintenance.
