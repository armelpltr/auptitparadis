// ============================================================
// MA-COMMANDE.JS — consulter et annuler sa réservation
//
// La page est atteinte depuis le lien de l'e-mail de confirmation, qui
// porte un jeton en paramètre. Ce jeton ne donne aucun accès à Firestore :
// les règles y interdisent toujours toute lecture publique de `orders`.
// Tout passe par le Worker, qui relit la commande avec la clé de service.
//
// Script classique et non module : rien ici n'a besoin de Firebase.
// ============================================================

(function () {
  'use strict';

  var WORKER_URL = 'https://auptitparadis-worker.armelpltr14-ad6.workers.dev';

  var euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

  var STATUTS = {
    en_attente: 'En attente',
    confirmee: 'Confirmée',
    prete: 'Prête',
    recuperee: 'Récupérée',
    annulee: 'Annulée'
  };

  /* Pourquoi l'annulation en ligne n'est pas proposée. Chaque cas dit quoi
     faire à la place : une page qui se contente de retirer le bouton laisse
     le client sans recours. */
  var RAISONS = {
    recuperee: 'Cette réservation a déjà été récupérée en boutique.',
    annulee: 'Cette réservation est déjà annulée.',
    delai_depasse: "Le délai d'annulation en ligne est passé. Appelez-nous, " +
                   'on trouvera une solution — mieux vaut nous prévenir tard que pas du tout.'
  };

  function $(id) { return document.getElementById(id); }

  function montrer(id, visible) {
    var el = $(id);
    if (el) el.hidden = !visible;
  }

  function texte(id, valeur) {
    var el = $(id);
    if (el) el.textContent = valeur;
  }

  function jourLisible(iso) {
    if (!iso) return 'date inconnue';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  /* Date limite affichée avec son heure : elle tombe rarement à minuit, et
     « jusqu'au 14 décembre » sans heure se lit comme « toute la journée ». */
  function momentLisible(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function jeton() {
    return new URLSearchParams(window.location.search).get('t') || '';
  }

  async function appeler(chemin, corps) {
    var res = await fetch(WORKER_URL + chemin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var e = new Error(data.error || 'Le serveur n\'a pas répondu correctement.');
      e.status = res.status;
      throw e;
    }
    return data;
  }

  /* ---------- Affichage ---------- */

  function afficherErreur(message) {
    montrer('gestionChargement', false);
    montrer('gestionCarte', false);
    texte('gestionErreurTexte', message);
    montrer('gestionErreur', true);
  }

  function afficherCommande(cmd) {
    montrer('gestionChargement', false);
    montrer('gestionErreur', false);

    texte('gestionCode', cmd.code || '——————');
    texte('gestionStatut', STATUTS[cmd.statut] || cmd.statut || '—');
    texte('gestionRetrait', jourLisible(cmd.dateRetrait));
    texte('gestionTotal', euros.format(cmd.total || 0));

    var statutEl = $('gestionStatut');
    if (statutEl) statutEl.className = 'gestion-statut statut-' + (cmd.statut || 'inconnu');

    var lignes = $('gestionLignes');
    lignes.innerHTML = '';
    (cmd.items || []).forEach(function (it) {
      var li = document.createElement('li');
      var qte = document.createElement('span');
      qte.className = 'gestion-qte';
      qte.textContent = it.quantite + '×';
      var nom = document.createElement('span');
      nom.className = 'gestion-nom';
      // textContent et non innerHTML : le nom du produit vient de la base.
      nom.textContent = it.nom || '';
      var prix = document.createElement('span');
      prix.className = 'gestion-ligne-prix';
      prix.textContent = euros.format((it.prixUnitaire || 0) * (it.quantite || 0));
      li.appendChild(qte);
      li.appendChild(nom);
      li.appendChild(prix);
      lignes.appendChild(li);
    });

    if (cmd.commentaire) {
      texte('gestionCommentaire', '« ' + cmd.commentaire + ' »');
      montrer('gestionCommentaire', true);
    } else {
      montrer('gestionCommentaire', false);
    }

    if (cmd.annulable) {
      texte('gestionDelai', 'Vous pouvez annuler jusqu\'au ' + momentLisible(cmd.annulableJusqua) + '.');
      montrer('gestionAnnulation', true);
      montrer('gestionImpossible', false);
    } else {
      montrer('gestionAnnulation', false);
      texte('gestionImpossible', RAISONS[cmd.raison] ||
        "L'annulation en ligne n'est pas possible pour cette réservation. Appelez-nous.");
      montrer('gestionImpossible', true);
    }

    montrer('gestionCarte', true);
  }

  function afficherAnnulee() {
    montrer('gestionChargement', false);
    montrer('gestionErreur', false);
    montrer('gestionCarte', false);
    montrer('gestionAnnulee', true);
  }

  /* ---------- Actions ---------- */

  /* Confirmation via le <dialog> de la page. Enveloppé dans une promesse
     pour garder le déroulé linéaire de annuler(). Repli sur confirm() si
     le navigateur ne connaît pas showModal — mieux vaut une boîte laide
     qu'une annulation qui part sans demander. */
  function demanderConfirmation() {
    var dlg = $('dlgAnnuler');
    if (!dlg || typeof dlg.showModal !== 'function') {
      return Promise.resolve(window.confirm('Annuler définitivement cette réservation ?'));
    }
    return new Promise(function (resolve) {
      function fermer(reponse) {
        dlg.close();
        $('dlgOui').removeEventListener('click', oui);
        $('dlgNon').removeEventListener('click', non);
        dlg.removeEventListener('cancel', echap);
        resolve(reponse);
      }
      function oui() { fermer(true); }
      function non() { fermer(false); }
      // Échap ferme la boîte : c'est un refus, pas une validation.
      function echap(e) { e.preventDefault(); fermer(false); }

      $('dlgOui').addEventListener('click', oui);
      $('dlgNon').addEventListener('click', non);
      dlg.addEventListener('cancel', echap);
      dlg.showModal();
    });
  }

  async function annuler() {
    var bouton = $('btnAnnuler');
    if (!(await demanderConfirmation())) return;

    bouton.disabled = true;
    bouton.textContent = 'Annulation…';
    montrer('gestionErreurAction', false);

    try {
      await appeler('/order/cancel', { token: jeton() });
      afficherAnnulee();
    } catch (err) {
      bouton.disabled = false;
      bouton.textContent = 'Annuler ma réservation';
      texte('gestionErreurAction', err.message);
      montrer('gestionErreurAction', true);
    }
  }

  /* ---------- Lancement ---------- */

  (async function () {
    var t = jeton();
    if (!t) {
      afficherErreur('Ce lien est incomplet. Ouvrez celui reçu dans votre e-mail de confirmation.');
      return;
    }

    try {
      var data = await appeler('/order/manage', { token: t });
      // Une commande déjà annulée s'affiche quand même en entier : le client
      // qui rouvre son lien veut voir ce qu'il avait commandé, pas un écran
      // vide. Le bouton d'annulation, lui, ne s'affichera pas.
      afficherCommande(data.commande);
      $('btnAnnuler').addEventListener('click', annuler);
    } catch (err) {
      afficherErreur(err.message);
    }
  })();
})();
