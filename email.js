/**
 * Envío de facturas y confirmaciones por correo (Resend).
 * Configura RESEND_API_KEY y EMAIL_FROM en .env
 * Si no hay API key, los envíos se registran en consola y no fallan el pedido.
 */

const RESEND_URL = 'https://api.resend.com/emails';

function productLabel(type, amount) {
  if (type === 'robux') return `${amount.toLocaleString('es')} Robux`;
  return `${amount.toLocaleString('es')} Diamantes`;
}

function money(price, currency = 'USD') {
  return currency === 'USD' ? `US$${Number(price).toFixed(2)}` : `${Number(price).toFixed(2)} ${currency}`;
}

function baseHtml({ title, intro, order, footerNote }) {
  const rows = [
    ['Ticket', order.ticket],
    ['Producto', productLabel(order.type, order.amount)],
    ['Importe', money(order.price, order.currency)],
    ['Método de pago', order.payment],
    ['Usuario de juego', order.username],
    ['Estado', order.status === 'confirmed' ? 'Pago verificado' : order.status === 'cancelled' ? 'Cancelado' : 'Pendiente de pago'],
    ['Fecha', new Date(order.createdAt || order.created_at || Date.now()).toLocaleString('es')],
  ];
  if (order.confirmed_at || order.confirmedAt) {
    rows.push(['Confirmado', new Date(order.confirmed_at || order.confirmedAt).toLocaleString('es')]);
  }

  const table = rows.map(([k, v]) =>
    `<tr><td style="padding:8px 12px;color:#a3a3a3;border-bottom:1px solid #1f1f1f;">${k}</td>` +
    `<td style="padding:8px 12px;color:#fff;border-bottom:1px solid #1f1f1f;font-weight:600;">${escapeHtml(String(v))}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#030303;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e5e5e5;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:1px;margin-bottom:24px;">
      GAME<span style="color:#c084fc;">STORE</span>
    </div>
    <h1 style="font-size:22px;color:#fff;margin:0 0 12px;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 24px;line-height:1.5;color:#a3a3a3;">${intro}</p>
    <table style="width:100%;border-collapse:collapse;background:#0c0910;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">
      ${table}
    </table>
    <p style="margin:24px 0 8px;font-size:14px;color:#a3a3a3;line-height:1.5;">${footerNote}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#666;">
      Este correo se envió automáticamente desde GAMESTORE. No respondas a este mensaje si no es un buzón de soporte activo.
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pendingEmail(order, discordUrl) {
  const subject = `Pedido recibido · ${order.ticket} · GAMESTORE`;
  const html = baseHtml({
    title: 'Pedido recibido',
    intro: `Hola. Hemos registrado tu pedido. Usa el ticket <strong style="color:#c084fc;">${escapeHtml(order.ticket)}</strong> para confirmar el pago en Discord.`,
    order: { ...order, status: 'pending' },
    footerNote: `Entra al servidor de Discord y envía tu número de ticket al equipo para completar el pago: <a href="${discordUrl}" style="color:#c084fc;">${discordUrl}</a>. Abrir Discord no confirma el pago; lo verificará un administrador.`,
  });
  const text =
    `GAMESTORE — Pedido recibido\n\n` +
    `Ticket: ${order.ticket}\n` +
    `Producto: ${productLabel(order.type, order.amount)}\n` +
    `Importe: ${money(order.price, order.currency)}\n` +
    `Pago: ${order.payment}\n` +
    `Usuario: ${order.username}\n\n` +
    `Confirma en Discord: ${discordUrl}\n`;
  return { subject, html, text };
}

function invoiceEmail(order) {
  const subject = `Factura · ${order.ticket} · Pago verificado · GAMESTORE`;
  const html = baseHtml({
    title: 'Factura / Recibo',
    intro: `Tu pago ha sido verificado. Este correo es tu comprobante de compra en GAMESTORE.`,
    order: { ...order, status: 'confirmed' },
    footerNote: 'El equipo procederá con la entrega del producto según el método acordado. Si tienes dudas, usa el panel de soporte de la tienda o el servidor de Discord.',
  });
  const text =
    `GAMESTORE — Factura / Recibo\n\n` +
    `Ticket: ${order.ticket}\n` +
    `Producto: ${productLabel(order.type, order.amount)}\n` +
    `Importe: ${money(order.price, order.currency)}\n` +
    `Pago: ${order.payment}\n` +
    `Usuario: ${order.username}\n` +
    `Estado: Pago verificado\n` +
    `Fecha: ${new Date(order.createdAt || Date.now()).toLocaleString('es')}\n`;
  return { subject, html, text };
}

export function createMailer() {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || 'GAMESTORE <onboarding@resend.dev>';
  const discordUrl = process.env.DISCORD_URL || 'https://discord.gg/D6N6hNf4e5';

  async function send({ to, subject, html, text }) {
    if (!apiKey) {
      console.info('[email] RESEND_API_KEY no configurada. Simulación:', { to, subject });
      return { ok: true, simulated: true };
    }
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('[email] Error Resend:', res.status, body);
        return { ok: false, error: body };
      }
      const data = await res.json();
      return { ok: true, id: data.id };
    } catch (err) {
      console.error('[email] Fallo de red:', err.message);
      return { ok: false, error: err.message };
    }
  }

  return {
    async sendOrderPending(order) {
      const content = pendingEmail(order, discordUrl);
      return send({ to: order.email, ...content });
    },
    async sendInvoice(order) {
      const content = invoiceEmail(order);
      return send({ to: order.email, ...content });
    },
  };
}
