require('dotenv').config();
const pool = require('./db');
const { getEmbedding } = require('./catalogService');

// Реальный ассортимент клиента (Master Roll Shtor Astana, г. Астана).
// ⚠️ ВАЖНО: цены и размеры ниже — ПРИМЕРНЫЕ ПЛЕЙСХОЛДЕРЫ.
// Обязательно уточните у клиента реальные цены/размеры и замените значения!
const products = [
  {
    name: 'Деревянные жалюзи "Классик"',
    category: 'жалюзи',
    fabric: 'натуральное дерево (ламели)',
    color: 'светлое дерево',
    price: 15000,
    width_cm: 120,
    height_cm: 150,
    description:
      'Деревянные жалюзи из натуральных ламелей, классический вариант для гостиной и кабинета. Прочные, экологичные, регулируют уровень света поворотом ламелей.',
  },
  {
    name: 'Ролл-шторы "Комфорт"',
    category: 'рулонные',
    fabric: 'плотная рулонная ткань',
    color: 'бежевый',
    price: 9000,
    width_cm: 120,
    height_cm: 160,
    description:
      'Ролл-шторы (рулонные шторы) бежевого цвета, компактно скручиваются вверх, подходят для зала, спальни и кухни. Хорошо защищают от солнца.',
  },
  {
    name: 'Ролл-шторы "Комфорт" (серый)',
    category: 'рулонные',
    fabric: 'плотная рулонная ткань',
    color: 'серый',
    price: 9000,
    width_cm: 120,
    height_cm: 160,
    description:
      'Ролл-шторы серого цвета, компактный рулонный механизм, подходят для зала и офиса, легко моются.',
  },
  {
    name: 'Ролл-шторы с электроприводом',
    category: 'рулонные',
    fabric: 'плотная рулонная ткань',
    color: 'на выбор',
    price: 25000,
    width_cm: 120,
    height_cm: 160,
    description:
      'Ролл-шторы с электроприводом — открываются и закрываются автоматически с пульта или через приложение. Интегрируются с системой "Умный дом".',
  },
  {
    name: 'Римские шторы "Уют"',
    category: 'римские',
    fabric: 'плотная ткань с римским механизмом',
    color: 'бежевый',
    price: 13000,
    width_cm: 120,
    height_cm: 150,
    description:
      'Римские шторы для зала и спальни, складываются горизонтальными складками. Бежевый цвет подойдёт под большинство интерьеров.',
  },
  {
    name: 'Москитная сетка на окно',
    category: 'москитные сетки',
    fabric: 'сетка-полотно',
    color: 'серый',
    price: 6000,
    width_cm: 130,
    height_cm: 150,
    description:
      'Москитная сетка на окно, защищает от насекомых, легко снимается на зиму. Подходит под стандартные пластиковые окна.',
  },
  {
    name: 'Детская защита на окно',
    category: 'детская защита',
    fabric: 'металлический профиль + сетка',
    color: 'белый',
    price: 8000,
    width_cm: 130,
    height_cm: 150,
    description:
      'Защита от выпадения детей из окна, устанавливается на распашные и поворотно-откидные окна. Прочная конструкция, не мешает проветриванию.',
  },
];

// Пытаемся получить эмбеддинг, и если Voyage AI отвечает "слишком много запросов"
// (лимит 3 запроса/минуту без привязанной карты оплаты) — ждём минуту и пробуем снова.
async function getEmbeddingWithRetry(text, attempt = 1) {
  try {
    return await getEmbedding(text);
  } catch (err) {
    if (err.response?.status === 429 && attempt <= 3) {
      console.log(`Упёрлись в лимит запросов, жду 65 секунд и пробую снова (попытка ${attempt})...`);
      await new Promise((resolve) => setTimeout(resolve, 65000));
      return getEmbeddingWithRetry(text, attempt + 1);
    }
    throw err;
  }
}

async function seed() {
  console.log('Начинаю загрузку каталога...');

  for (const product of products) {
    const embedding = await getEmbeddingWithRetry(product.description);
    const vectorLiteral = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO products
        (name, category, fabric, color, price, width_cm, height_cm, description, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        product.name,
        product.category,
        product.fabric,
        product.color,
        product.price,
        product.width_cm,
        product.height_cm,
        product.description,
        vectorLiteral,
      ]
    );

    console.log(`Добавлен товар: ${product.name}`);

    await new Promise((resolve) => setTimeout(resolve, 25000));
  }

  console.log('Готово. Каталог загружен.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Ошибка при загрузке каталога:', err);
  process.exit(1);
});