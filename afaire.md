# À faire

État au 5 septembre 2026. Ce qui est coché n'est pas « codé » mais « en ligne et
vérifié » — la leçon de la journée, c'est que le dépôt et la production peuvent
diverger d'un mois sans que rien ne le signale.

---

## SMS de confirmation — codé, déployé, en sommeil

Le code est en production (Worker `a0ae061f`, commit `695e179`), mais **aucun SMS
ne partira** tant que les deux points ci-dessous ne sont pas réglés. L'interrupteur
du panel est décoché, donc rien ne se déclenche entre-temps.

- [ ] **Acheter des crédits SMS chez Brevo.** Ils sont distincts des crédits
      e-mail. Environ 0,045 € par SMS vers la France, soit ~4,50 € pour cent
      commandes.
- [ ] **Déclarer l'expéditeur alphanumérique `PtitParadis`** auprès de Brevo.
      Depuis 2022, les opérateurs français refusent ou remplacent un expéditeur
      non déclaré. Le nom est dans `worker/wrangler.toml` (`SMS_EXPEDITEUR`,
      11 caractères alphanumériques maximum) ; en changer demande un
      `wrangler deploy`.
- [ ] **Cocher « Envoyer un SMS de confirmation au client »** dans le panel,
      onglet Catalogue Noël, puis « Enregistrer la période ». Le réglage vit
      dans `settings/noel.sms` et est relu à chaque commande.
- [ ] **Passer une commande test avec son propre numéro.** En cas d'échec, la
      cause exacte est dans les logs du Worker : `[brevo-sms] <code> vers …1234`.
      Crédits épuisés et expéditeur refusé donnent deux codes différents.

Ce que fait le message, pour mémoire :

```
Au P'tit Paradis : commande SITE0042 confirmee. Retrait le 24/12 a 10h30.
Presentez ce code en caisse. A bientot !
```

114 caractères, sans accents. Ce n'est pas une négligence : un seul caractère hors
de l'alphabet GSM-7 fait basculer le SMS entier en Unicode, où la limite tombe de
160 à 70 caractères — le même message partirait alors en trois morceaux facturés
trois fois. Toute modification du texte (`messageCommande()` dans
`worker/src/sms.js`) doit rester sous 160 caractères ASCII.

---

## Avant de laisser tourner les ateliers

- [ ] **Les trois séances d'exemple sont en ligne et réservables.** Dates
      factices des 26, 27 et 28 septembre. Quelqu'un peut réserver un atelier
      qui n'existe pas et recevoir une confirmation. Mettre les vraies dates,
      ou repasser les fiches en « Masquée ».
- [ ] **Test d'inscription de bout en bout.** La route `/stage/reserve` n'a
      jamais tourné en production avant aujourd'hui. Vérifier : le code
      `STAGE0001`, l'arrivée de l'e-mail (regarder aussi les spams), le
      décompte des places sur la page publique, l'inscription visible dans le
      panel.
- [ ] **Mentions légales incomplètes.** `entreprise.raisonSociale` et
      `entreprise.siret` sont vides dans Firestore. Pour un site commercial
      français, l'identité de l'exploitant et le SIRET sont obligatoires. À
      remplir dans le panel, onglet Réglages.

---

## Sécurité — reste ouvert, non bloquant

- [ ] **Limitation de débit sur `/stage/reserve`.** Turnstile est le seul frein
      aujourd'hui. Un solveur automatisé peut remplir une séance (six places par
      appel) et consommer les crédits Brevo au passage. Une règle Cloudflare
      Rate Limiting sur ce chemin suffit. ~2 h.
- [ ] **`manageToken` stocké en clair** dans `orders` et `inscriptions`. Sans
      conséquence tant qu'aucune route ne l'accepte comme laissez-passer — mais
      le jour où la gestion en ligne des inscriptions s'ouvre, il faudra le
      hacher et le comparer en temps constant.

---

## Confort et contenu

- [ ] **Photos réelles des ateliers.** Les trois en place (`assets/ateliers/`)
      sont des illustrations libres de droits, choisies faute de mieux. Une
      photo prise pendant le premier atelier les remplace depuis le panel.
      Origines et licences dans `assets/ateliers/CREDITS.md`.
- [ ] **Adresse e-mail de contact** (`horaires.email`) et lien de carte
      (`horaires.mapUrl`) sont vides ; les blocs correspondants restent masqués.
- [ ] **Dépôt privé ?** Décision en suspens. GitHub Pages depuis un dépôt privé
      exige un plan payant ; Cloudflare Pages l'accepte gratuitement et le compte
      Cloudflare existe déjà. Ce que cela cacherait : `worker/src/`,
      `firestore.rules`, l'historique git. Aucun secret ne se trouve dans le
      dépôt.

---

## Exploitation — la leçon du 5 septembre

Trois déploiements distincts, aucun automatique, et deux d'entre eux avaient un
mois de retard sur le dépôt sans que rien ne le signale :

| Quoi | Commande | Vérifier que c'est en ligne |
|---|---|---|
| Site | automatique (GitHub Actions au push) | onglet Actions du dépôt |
| Règles Firestore | `npx firebase-tools deploy --only firestore:rules --project au-ptit-paradis --account armelpltr14@gmail.com` | API `firebaserules.googleapis.com`, comparer au fichier |
| Worker | `npx wrangler deploy` depuis `worker/` | `npx wrangler deployments list`, ou sonder une route |

La publication du Worker échouait silencieusement depuis le 5 août : un vrai saut
de ligne dans une chaîne de `mailer.js` cassait le bundle, et personne ne
relançait la commande. **Avant tout déploiement**, passer `node --check` sur une
copie `.mjs` de chaque fichier de `worker/src/` — c'est le seul autre endroit où
une faute de syntaxe se voit.

- [ ] **Automatiser les deux déploiements manquants** dans le workflow GitHub
      Actions (règles + Worker), pour que le dépôt et la production ne puissent
      plus diverger. ~4 h.
