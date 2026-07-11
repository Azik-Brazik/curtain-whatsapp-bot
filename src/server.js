const express = require('express');
const { incomingQueue } = require('./queue');
const adminPanel = require('./adminPanel');

const pool = require('./db');
const { isBotMessage } = require('./whatsappService');

const PAUSE_MINUTES = 30;
async function pauseBotForCustomer(chatId) {
  await pool.query(
    `UPDATE customers
     SET bot_paused_until = NOW() + INTERVAL '${PAUSE_MINUTES} minutes'
     WHERE whatsapp_id = $1`,
    [chatId]
  );
}

const app = express();
app.use(express.json());
app.use('/admin', adminPanel);

function verifyWebhook(req, res, next) {
  next();
}

app.post('/webhook', verifyWebhook, async (req, res) => {
  try {
    const body = req.body;
    console.log('Получен вебхук:', body.typeWebhook);

    if (body.typeWebhook === 'outgoingMessageReceived') {
      const chatId = body.senderData?.chatId;
      const messageId = body.idMessage;

      if (chatId && !isBotMessage(messageId)) {
        await pauseBotForCustomer(chatId);
        console.log('Бот поставлен на паузу для клиента (ручной ответ менеджера):', chatId);
      } else {
        console.log('Это собственное сообщение бота, паузу не ставим:', chatId);
      }
    }

    if (body.typeWebhook === 'incomingMessageReceived') {
      const chatId = body.senderData?.chatId;
      const text = body.messageData?.textMessageData?.textMessage
        || body.messageData?.extendedTextMessageData?.text;
      const messageId = body.idMessage;

      console.log('Разобрано сообщение:', { chatId, text, messageId });

      if (chatId && text) {
        await incomingQueue.add('process-message', { chatId, text, messageId });
        console.log('Сообщение добавлено в очередь');
      } else {
        console.log('Пропущено: нет chatId или text');
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Ошибка обработки вебхука:', err);
    res.sendStatus(200);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});