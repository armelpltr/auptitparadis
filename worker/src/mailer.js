// ============================================================
// MAILER — confirmations de commande, via l'API Brevo
//
// Rien ici ne doit faire échouer une commande. Le client a déjà son code
// à l'écran et la réservation est écrite en base : si l'e-mail ne part
// pas, on le signale à l'appelant, on ne perd pas la commande.
// ============================================================

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const euros = n => Number(n || 0).toLocaleString('fr-FR', {
  style: 'currency', currency: 'EUR'
});

function jourLisible(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

/* Le nom du client et son commentaire finissent dans du HTML d'e-mail.
   Les clients de messagerie interprètent ce HTML : sans échappement, un
   nom contenant du balisage casserait la mise en page, au mieux. */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function lignesHtml(items) {
  return (items || []).map(it => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #f1e6d3;">
        <strong>${it.quantite}×</strong> ${esc(it.nom)}
      </td>
      <td style="padding:6px 0;border-bottom:1px solid #f1e6d3;text-align:right;white-space:nowrap;">
        ${esc(euros(it.prixUnitaire * it.quantite))}
      </td>
    </tr>`).join('');
}

function lignesTexte(items) {
  return (items || []).map(it =>
    `  ${it.quantite} x ${it.nom} — ${euros(it.prixUnitaire * it.quantite)}`
  ).join('\n');
}

function mailClient(commande) {
  const { code, client, items, total, dateRetrait } = commande;
  const jour = jourLisible(dateRetrait);

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">Votre réservation est enregistrée</h1>
  <p style="color:#4a423a;margin:0 0 24px;">Bonjour ${esc(client.prenom || client.nom)},</p>

  <div style="background:#f1e6d3;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#4a423a;">
      Votre code de réservation
    </p>
    <p style="margin:0;font-size:32px;font-weight:bold;letter-spacing:.18em;color:#8c5a26;">
      ${esc(code)}
    </p>
  </div>

  <p style="margin:0 0 8px;"><strong>Retrait :</strong> ${esc(jour)}</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Total à régler en boutique</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;white-space:nowrap;">${esc(euros(total))}</td>
    </tr>
  </table>

  <p style="background:#fdf6e9;border-left:3px solid #c8853a;padding:12px 16px;margin:0 0 20px;">
    Votre réservation est acceptée <strong>sous réserve de votre passage en boutique</strong>.
    Présentez ce code pour la confirmer. Le règlement se fait sur place, au retrait —
    aucun paiement n'est demandé en ligne.
  </p>

  <p style="color:#4a423a;font-size:14px;margin:0;">
    À très vite,<br>Au P'tit Paradis — Luc-sur-Mer
  </p>
</div>`;

  const texte = `Votre réservation est enregistrée

Bonjour ${client.prenom || client.nom},

Votre code de réservation : ${code}
Retrait : ${jour}

${lignesTexte(items)}

Total à régler en boutique : ${euros(total)}

Votre réservation est acceptée sous réserve de votre passage en boutique.
Présentez ce code pour la confirmer. Le règlement se fait sur place, au
retrait — aucun paiement n'est demandé en ligne.

À très vite,
Au P'tit Paradis — Luc-sur-Mer`;

  return { sujet: `Votre réservation Au P'tit Paradis — code ${code}`, html, texte };
}

function mailPatron(commande) {
  const { code, client, items, total, dateRetrait, commentaire } = commande;
  const nom = client.nomComplet || `${client.prenom} ${client.nom}`;

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;color:#211c17;max-width:520px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 16px;">Nouvelle réservation — ${esc(code)}</h1>
  <p style="margin:0 0 4px;"><strong>${esc(nom)}</strong></p>
  <p style="margin:0 0 4px;">${esc(client.telephone)} · ${esc(client.email)}</p>
  <p style="margin:0 0 16px;"><strong>Retrait :</strong> ${esc(jourLisible(dateRetrait))}</p>
  <table style="width:100%;border-collapse:collapse;">
    ${lignesHtml(items)}
    <tr>
      <td style="padding:10px 0;font-weight:bold;">Total</td>
      <td style="padding:10px 0;text-align:right;font-weight:bold;">${esc(euros(total))}</td>
    </tr>
  </table>
  ${commentaire ? `<p style="background:#f1e6d3;padding:12px 16px;font-style:italic;">« ${esc(commentaire)} »</p>` : ''}
  <p style="color:#4a423a;font-size:13px;">À confirmer dans le panel quand le client passe en boutique.</p>
</div>`;

  const texte = `Nouvelle réservation — ${code}

${nom}
${client.telephone} · ${client.email}
Retrait : ${jourLisible(dateRetrait)}

${lignesTexte(items)}

Total : ${euros(total)}
${commentaire ? `\nCommentaire : « ${commentaire} »\n` : ''}
À confirmer dans le panel quand le client passe en boutique.`;

  return { sujet: `Nouvelle commande — ${nom} — ${dateRetrait}`, html, texte };
}

async function envoyer({ destinataire, nomDestinataire, sujet, html, texte }, env) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: env.EMAIL_EXPEDITEUR,
        name: env.EMAIL_EXPEDITEUR_NOM || "Au P'tit Paradis"
      },
      to: [{ email: destinataire, name: nomDestinataire || undefined }],
      subject: sujet,
      htmlContent: html,
      textContent: texte
    })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

/**
 * Envoie la confirmation au client et, si une adresse est configurée, une
 * alerte au patron. Ne lève jamais : renvoie `true` si le client a bien
 * été prévenu, `false` sinon.
 */
export async function envoyerConfirmation(commande, env) {
  // Service non configuré : la commande reste valable, le client a son
  // code à l'écran. On ne prétend simplement pas lui avoir écrit.
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR) return false;

  let clientPrevenu = false;
  try {
    const m = mailClient(commande);
    await envoyer({
      destinataire: commande.client.email,
      nomDestinataire: commande.client.nomComplet,
      ...m
    }, env);
    clientPrevenu = true;
  } catch (err) {
    console.error('Confirmation client non envoyée :', err.message);
  }

  if (env.EMAIL_PATRON) {
    try {
      const m = mailPatron(commande);
      await envoyer({ destinataire: env.EMAIL_PATRON, ...m }, env);
    } catch (err) {
      console.error('Alerte patron non envoyée :', err.message);
    }
  }

  return clientPrevenu;
}
