require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('./db');
const { searchCatalog } = require('./catalogService');
const { sendMessage } = require('./whatsappService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== Инструменты, которые модель может "вызывать" =====
// Это и есть механизм, который превращает бота из "болталки"
// в консультанта, способного реально оформить заказ.
const tools = [
  {
    name: 'create_order',
    description:
      'Создать заказ на шторы, когда клиент подтвердил выбор товара, размеры и адрес доставки.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'ID товара из каталога' },
        width_cm: { type: 'number', description: 'Ширина окна в см' },
        height_cm: { type: 'number', description: 'Высота окна в см' },
        address: { type: 'string', description: 'Адрес доставки/замера' },
      },
      required: ['product_id', 'address'],
    },
  },
  {
    name: 'update_order_address',
    description:
      'Изменить адрес доставки в последнем заказе клиента — используй, когда клиент просит поменять/уточнить адрес уже оформленного заказа.',
    input_schema: {
      type: 'object',
      properties: {
        new_address: { type: 'string', description: 'Новый адрес доставки' },
      },
      required: ['new_address'],
    },
  },
  {
    name: 'escalate_to_manager',
    description:
      'Передать диалог живому менеджеру — если клиент явно просит человека, злится, или вопрос не про шторы.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Кратко, почему передаём менеджеру' },
      },
      required: ['reason'],
    },
  },
];

function buildSystemPrompt(catalogResults) {
  const catalogText = catalogResults
    .map(
      (p) =>
        `- [id:${p.id}] ${p.name}: ${p.description} Размер: ${p.width_cm}x${p.height_cm} см.`
    )
    .join('\n');

  return `Ты — вежливый и живой консультант компании Master Roll Shtor (Астана), специализирующейся на жалюзи, ролл-шторах, римских шторах, москитных сетках и детской защите на окна. Общайся по-человечески, кратко, без канцелярита.

О компании (упоминай к месту, не навязчиво):
- Работа "под ключ" — от замера до установки
- Бесплатный выезд специалиста
- Изготовление от 1 дня
- Гарантия 1 год
- Доставка по всему Казахстану
- Дизайнерская консультация
- Интеграция с "Умным домом" (для моделей с электроприводом)

Понимание сообщений клиента:
- Клиенты пишут размер по-разному: "2х2", "2м x 2м", "200 на 200", "два метра на два", "150x200см" и т.п. Понимай ЛЮБОЙ такой формат.
- Если число похоже на метры (обычно 1-5) — переведи в сантиметры (умножь на 100). Если число уже похоже на сантиметры (обычно 50-500) — используй как есть.
- Если сообщение клиента реально непонятно (не про размер, не про адрес, не про товар) — просто вежливо переспроси своими словами, не эскалируй на менеджера из-за одной неясной фразы.

Сценарий диалога по заказу (следуй этим шагам по порядку):
1. Клиент описывает, что ищет → найди подходящий товар в списке ниже и расскажи о нём.
2. Если клиент проявил интерес (сказал "да", "интересует", "нравится", "беру" и т.п.) — НЕ эскалируй, а сам спроси размер окна (ширина и высота в см).
3. Когда узнал размер — спроси адрес доставки/замера.
4. Когда есть товар, размер и адрес — покажи итоговую сводку и спроси подтверждение.
5. Когда клиент подтвердил сводку ("да", "верно", "всё правильно") — ОБЯЗАТЕЛЬНО вызови create_order. Это финальный шаг, не эскалация.

Правила:
1. Отвечай ТОЛЬКО на основе товаров ниже. Никогда не выдумывай цены, наличие или характеристики.
2. Если клиент написал короткое сообщение, совпадающее с названием товара из списка (например, просто "Уют" или "жалюзи") — считай это уточняющим вопросом про этот конкретный товар и расскажи о нём подробнее.
3. Если подходящего товара нет в списке вообще — честно скажи, что уточнишь у менеджера, и вызови escalate_to_manager.
4. Когда ты показал клиенту итоговую сводку заказа (товар, размер, адрес) и клиент подтвердил её — ОБЯЗАТЕЛЬНО вызови create_order, а НЕ escalate_to_manager.
5. Если клиент просит изменить адрес уже оформленного заказа — вызови update_order_address.
6. Вызывай escalate_to_manager ТОЛЬКО в трёх случаях: (а) клиент прямо просит человека/менеджера/оператора, (б) клиент жалуется или недоволен, (в) вопрос совсем не про шторы. Простое "да", "интересует", "хорошо", "нравится" — это НЕ повод эскалировать, это сигнал продолжать сценарий заказа (спросить размер/адрес).
7. Никогда не пиши, что что-то "передано менеджеру" или "изменено", если ты не вызвал соответствующий инструмент.
8. Пиши коротко, как в мессенджере, не более 3-4 предложений за раз.
9. НИКОГДА не называй клиенту цену — ни точную, ни примерную, ни "от X тг". Фиксированной цены нет — точную стоимость определяет специалист на месте после замера. Если клиент спрашивает про цену — вежливо объясни, что цена зависит от размеров и определяется мастером при бесплатном замере.
10. Сценарий строится так: рассказал о товаре → предложил бесплатный замер → узнал адрес для выезда замерщика → создал заявку на замер через create_order.
Релевантные товары по текущему запросу:
${catalogText || 'Ничего не найдено по этому запросу.'}`;
}

async function getHistory(customerId) {
  const { rows } = await pool.query(
    `SELECT role, content FROM messages
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [customerId]
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

async function saveMessage(customerId, role, content, messageId = null) {
  await pool.query(
    `INSERT INTO messages (customer_id, role, content, message_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (message_id) DO NOTHING`,
    [customerId, role, content, messageId]
  );
}

// Убираем техническую часть "@c.us" из номера телефона — только для
// отображения человеку (в уведомлениях), не используем это в реальной
// отправке сообщений, где нужен полный chatId с @c.us
function formatPhoneForDisplay(chatId) {
  return chatId ? chatId.replace('@c.us', '') : chatId;
}

// Выполняем реальное действие, которое запросила модель
async function executeTool(name, input, customerId, chatId) {
  if (name === 'create_order') {
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id, product_id, width_cm, height_cm, address)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [customerId, input.product_id, input.width_cm, input.height_cm, input.address]
    );

    const orderId = rows[0].id;

    // Сразу уведомляем владельца/менеджера о новом заказе в его личный WhatsApp,
    // чтобы не нужно было заходить в базу данных и проверять вручную
    await sendMessage(
      process.env.MANAGER_WHATSAPP_ID,
      `🛒 Новый заказ #${orderId}\nТовар ID: ${input.product_id}\nРазмер: ${input.width_cm || '—'}x${input.height_cm || '—'} см\nАдрес: ${input.address}\nКлиент: ${formatPhoneForDisplay(chatId)}`
    );

    return `Заказ #${orderId} успешно создан.`;
  }

  if (name === 'update_order_address') {
    // Находим последний (самый свежий) заказ этого клиента
    const { rows } = await pool.query(
      `SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );

    if (rows.length === 0) {
      return 'У клиента нет ни одного заказа для изменения адреса.';
    }

    const orderId = rows[0].id;

    await pool.query(`UPDATE orders SET address = $1 WHERE id = $2`, [
      input.new_address,
      orderId,
    ]);

    await sendMessage(
      process.env.MANAGER_WHATSAPP_ID,
      `📍 Адрес изменён в заказе #${orderId}\nНовый адрес: ${input.new_address}\nКлиент: ${formatPhoneForDisplay(chatId)}`
    );

    return `Адрес в заказе #${orderId} обновлён на: ${input.new_address}`;
  }

  if (name === 'escalate_to_manager') {
    await sendMessage(
      process.env.MANAGER_WHATSAPP_ID,
      `Клиент ${formatPhoneForDisplay(chatId)} просит помощи менеджера. Причина: ${input.reason}`
    );
    return 'Менеджер уведомлён и скоро подключится к диалогу.';
  }

  return 'Неизвестный инструмент';
}

// Вызываем Claude с автоматическим повтором при временном превышении лимита
// запросов (429) — вместо того чтобы бот "молчал", ждём немного и пробуем снова
async function createMessageWithRetry(params, attempt = 1) {
  try {
    return await anthropic.messages.create(params);
  } catch (err) {
    if (err.status === 429 && attempt <= 3) {
      const waitMs = attempt * 3000; // 3с, 6с, 9с
      console.log(`Claude API: превышен лимит запросов, жду ${waitMs / 1000}с (попытка ${attempt})...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return createMessageWithRetry(params, attempt + 1);
    }
    throw err;
  }
}

// Главная функция: клиент написал сообщение — генерируем ответ
async function generateReply(customerId, chatId, userText) {
  const catalogResults = await searchCatalog(userText);
  const system = buildSystemPrompt(catalogResults);
  const history = await getHistory(customerId);

  let messages = [...history, { role: 'user', content: userText }];

  let response = await createMessageWithRetry({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system,
    tools,
    messages,
  });

  // Модель может запросить вызов одного или НЕСКОЛЬКИХ инструментов сразу.
  // Обрабатываем цикл: выполняем ВСЕ инструменты из ответа -> отдаём все результаты обратно модели -> получаем финальный текст.
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

    const toolResults = [];
    for (const toolUseBlock of toolUseBlocks) {
      const toolResult = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input,
        customerId,
        chatId
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseBlock.id,
        content: toolResult,
      });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await createMessageWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system,
      tools,
      messages,
    });
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Извините, не смог сформировать ответ.';
}

module.exports = { generateReply, saveMessage };