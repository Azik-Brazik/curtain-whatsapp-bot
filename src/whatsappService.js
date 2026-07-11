require('dotenv').config();
const axios = require('axios');

const INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const TOKEN = process.env.GREEN_API_TOKEN;
const BASE_URL = `https://api.green-api.com/waInstance${INSTANCE_ID}`;

// Запоминаем ID сообщений, которые отправил сам бот (не человек вручную).
// Green API уведомляет о ЛЮБОМ исходящем сообщении, включая те, что бот
// отправил через API — этот список позволяет отличить "это ответил бот"
// от "это менеджер написал вручную с телефона".
const botSentMessageIds = new Set();

function isBotMessage(messageId) {
  return botSentMessageIds.has(messageId);
}

async function sendMessage(chatId, message) {
  try {
    const response = await axios.post(`${BASE_URL}/sendMessage/${TOKEN}`, {
      chatId,
      message,
    });

    const idMessage = response.data?.idMessage;
    if (idMessage) {
      botSentMessageIds.add(idMessage);
      setTimeout(() => botSentMessageIds.delete(idMessage), 2 * 60 * 1000);
    }
  } catch (err) {
    console.error('Ошибка отправки в WhatsApp:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendMessage, isBotMessage };