require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('./db');
const { generateReply, saveMessage } = require('./claudeService');
const { sendMessage } = require('./whatsappService');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // требование BullMQ
});

// Очередь входящих сообщений от клиентов
const incomingQueue = new Queue('incoming-messages', { connection });

// Находим или создаём клиента в базе по его WhatsApp ID
async function getOrCreateCustomer(whatsappId) {
  const existing = await pool.query(
    'SELECT id FROM customers WHERE whatsapp_id = $1',
    [whatsappId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await pool.query(
    'INSERT INTO customers (whatsapp_id) VALUES ($1) RETURNING id',
    [whatsappId]
  );
  return inserted.rows[0].id;
}

// Обработчик очереди — тут происходит вся реальная работа с одним сообщением.
// Если процесс упадёт посреди обработки — BullMQ повторит задачу, сообщение не потеряется.
const worker = new Worker(
  'incoming-messages',
  async (job) => {
    const { chatId, text, messageId } = job.data;
    console.log('Обрабатываю сообщение из очереди:', { chatId, text });

    const customerId = await getOrCreateCustomer(chatId);
    console.log('Клиент найден/создан, id:', customerId);

    await saveMessage(customerId, 'user', text, messageId);

    // Проверяем, не поставлен ли бот на паузу для этого клиента
    const { rows } = await pool.query(
      `SELECT bot_paused_until FROM customers WHERE id = $1`,
      [customerId]
    );
    const pausedUntil = rows[0]?.bot_paused_until;
    if (pausedUntil && new Date(pausedUntil) > new Date()) {
      console.log('Бот на паузе для этого клиента, пропускаю автоответ до:', pausedUntil);
      return;
    }

    console.log('Отправляю запрос в Claude...');
    const reply = await generateReply(customerId, chatId, text);
    console.log('Ответ от Claude получен:', reply);

    await saveMessage(customerId, 'assistant', reply);
    await sendMessage(chatId, reply);
    console.log('Ответ отправлен в WhatsApp');
  },
  {
    connection,
    concurrency: 5, // сколько сообщений обрабатываем параллельно
    limiter: {
      max: 20,       // максимум 20 обработок...
      duration: 1000, // ...в секунду — защита от перегрузки Claude/WhatsApp API
    },
  }
);

worker.on('failed', (job, err) => {
  console.error(`Задача ${job.id} провалилась:`, err.message);
});

module.exports = { incomingQueue };