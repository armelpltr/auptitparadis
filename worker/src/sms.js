// ============================================================
// SMS — confirmation de commande, via l'API Brevo
//
// Même fournisseur que les e-mails, donc même clé : rien de nouveau à
// configurer côté Cloudflare. L'endpoint, lui, est distinct de celui du
// courrier.
//
// Un SMS coûte de l'argent, contrairement à un e-mail : il ne part que si
// la boutique l'a demandé (`settings/noel.sms`), et une seule fois, à la
// commande. Rien ici ne doit faire échouer une réservation — le client a
// déjà son code à l'écran et la commande est écrite en base.
//
// Deux contraintes du support, qui expliquent le reste du fichier :
//
//   1. 160 caractères tant qu'on reste dans l'alphabet GSM-7. Un seul
//      caractère hors de cet alphabet fait basculer le message entier en
//      Unicode, où la limite tombe à 70 — le message part alors en trois
//      morceaux facturés trois fois. D'où le passage en ASCII : « confirmée »
//      devient « confirmee », et le message tient en un seul SMS.
//   2. L'expéditeur alphanumérique (« PtitParadis ») fait 11 caractères
//      maximum et doit être déclaré chez Brevo pour la France. Sans
//      déclaration, l'opérateur remplace ou refuse le message.
// ============================================================

const BREVO_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/sms';

const MAX_CARACTERES = 160;   // au-delà, le SMS est facturé en plusieurs morceaux

/* Les commandes stockent le numéro normalisé en 0XXXXXXXXX. Brevo attend
   l'indicatif sans le « + », soit 33XXXXXXXXX. */
function enInternational(tel) {
  const brut = String(tel ?? '').replace(/[\s.\-()]/g, '');
  if (/^0[1-9]\d{8}$/.test(brut)) return '33' + brut.slice(1);
  if (/^\+?33[1-9]\d{8}$/.test(brut)) return brut.replace(/^\+/, '');
  return '';
}

/* « é » et « à » existent en GSM-7, « ê », « â », « œ » et les guillemets
   typographiques non. Plutôt que de tenir la liste exacte des caractères
   admis — elle diffère selon les opérateurs — on retire les accents et on
   remplace ce qui traîne. Un SMS sans accents reste lisible ; un SMS coupé
   en trois coûte trois fois le prix. */
function enGSM(texte) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e, ê → e
    .replace(/[«»“”„]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '');                    // le reste ne passe pas
}

/* JJ/MM, sans l'année : le SMS parle d'un retrait des prochaines semaines,
   et chaque caractère compte. */
function jourCourt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}` : '';
}

function messageCommande(commande, env) {
  const enseigne = enGSM(env.EMAIL_EXPEDITEUR_NOM || "Au P'tit Paradis");
  const jour  = jourCourt(commande.dateRetrait);
  const heure = commande.heureRetrait ? ` a ${String(commande.heureRetrait).replace(':', 'h')}` : '';
  const quand = jour ? ` Retrait le ${jour}${heure}.` : '';

  const message = enGSM(
    `${enseigne} : commande ${commande.code} confirmee.${quand} `
    + `Presentez ce code en caisse. A bientot !`
  );

  /* Une adresse longue ou un nom d'enseigne allongé peuvent faire déborder :
     on coupe plutôt que de payer un second SMS sans s'en apercevoir. */
  return message.length > MAX_CARACTERES ? message.slice(0, MAX_CARACTERES) : message;
}

/**
 * Envoie la confirmation. Renvoie `true` si Brevo l'a acceptée.
 *
 * Ne lève jamais : l'appelant vient d'écrire la commande, et un SMS qui ne
 * part pas ne doit pas transformer une réservation réussie en erreur.
 */
export async function envoyerConfirmationSms(commande, env) {
  if (!env.BREVO_API_KEY || !env.SMS_EXPEDITEUR) return false;

  const destinataire = enInternational(commande.client?.telephone);
  if (!destinataire) return false;

  try {
    const res = await fetch(BREVO_SMS_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        // 11 caractères maximum, déclaré chez Brevo pour la France.
        sender: String(env.SMS_EXPEDITEUR).slice(0, 11),
        recipient: destinataire,
        content: messageCommande(commande, env),
        // « transactional » et non « marketing » : une confirmation de
        // commande n'est pas soumise aux horaires de la prospection, et
        // n'a pas à porter de mention STOP.
        type: 'transactional',
        tag: 'commande'
      })
    });

    /* Journalisé même en cas de succès, et sans le numéro complet : un SMS
       qui n'arrive pas laisse sinon le doute entre « jamais parti »,
       « refusé par l'opérateur » et « crédits épuisés ». */
    const corps = await res.text();
    console.log(`[brevo-sms] ${res.status} vers …${destinataire.slice(-4)} — ${corps.slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.error('[brevo-sms] envoi impossible :', err.message);
    return false;
  }
}
