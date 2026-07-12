require('dotenv').config();
const express = require('express');
const pool = require('./db');

const router = express.Router();

// Простая защита паролем через Basic Auth — без БД пользователей,
// один пароль на владельца магазина, задаётся в .env
function checkAuth(req, res, next) {
  const auth = req.headers.authorization;
  const expected = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASSWORD}`).toString('base64');

  if (!process.env.ADMIN_PASSWORD || auth !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Требуется авторизация');
  }
  next();
}

router.get('/orders', checkAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.id, o.status, o.width_cm, o.height_cm, o.address, o.preferred_datetime, o.created_at,
           p.name AS product_name,
           c.whatsapp_id
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC
  `);

  const html = `
  <!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Заказы — Магазин штор</title>
    <style>
      body { font-family: -apple-system, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
      h1 { color: #222; }
      table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
      th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
      th { background: #333; color: white; }
      tr:hover { background: #fafafa; }
      .status-new { color: #d97706; font-weight: bold; }
      .status-confirmed { color: #16a34a; font-weight: bold; }
      .status-cancelled { color: #dc2626; font-weight: bold; }
      .empty { text-align: center; padding: 40px; color: #888; }
      .actions { display: flex; gap: 6px; }
      button { border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; color: white; }
      .btn-confirm { background: #16a34a; }
      .btn-cancel { background: #dc2626; }
      .btn-delete { background: #6b7280; }
      button:disabled { background: #ccc; cursor: default; }
    </style>
  </head>
  <body>
    <h1>Заказы магазина штор</h1>
    ${
      rows.length === 0
        ? '<p class="empty">Заказов пока нет</p>'
        : `<table>
        <tr>
          <th>№</th><th>Товар</th><th>Размер</th>
          <th>Адрес</th><th>Замер</th><th>Клиент</th><th>Статус</th><th>Дата</th><th>Действие</th>
        </tr>
        ${rows
          .map(
            (o) => `
          <tr>
            <td>#${o.id}</td>
            <td>${o.product_name || '—'}</td>
            <td>${o.width_cm || '—'}x${o.height_cm || '—'} см</td>
            <td>${o.address}</td>
            <td>${o.preferred_datetime || '—'}</td>
            <td>${o.whatsapp_id ? o.whatsapp_id.replace('@c.us', '') : '—'}</td>
            <td class="status-${o.status}">${o.status}</td>
            <td>${new Date(o.created_at).toLocaleString('ru-RU')}</td>
            <td class="actions">
              <form method="POST" action="/admin/orders/${o.id}/status" style="display:inline">
                <input type="hidden" name="status" value="confirmed">
                <button class="btn-confirm" ${o.status === 'confirmed' ? 'disabled' : ''}>Подтвердить</button>
              </form>
              <form method="POST" action="/admin/orders/${o.id}/status" style="display:inline">
                <input type="hidden" name="status" value="cancelled">
                <button class="btn-cancel" ${o.status === 'cancelled' ? 'disabled' : ''}>Отменить</button>
              </form>
              <form method="POST" action="/admin/orders/${o.id}/delete" style="display:inline" onsubmit="return confirm('Удалить заказ #${o.id} навсегда?');">
                <button class="btn-delete">Удалить</button>
              </form>
            </td>
          </tr>`
          )
          .join('')}
      </table>`
    }
  </body>
  </html>`;

  res.send(html);
});

router.post('/orders/:id/status', checkAuth, express.urlencoded({ extended: true }), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['new', 'confirmed', 'cancelled'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).send('Недопустимый статус');
  }

  await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
  res.redirect('/admin/orders');
});

router.post('/orders/:id/delete', checkAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM orders WHERE id = $1', [id]);
  res.redirect('/admin/orders');
});

module.exports = router;