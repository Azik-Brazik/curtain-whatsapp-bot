require('dotenv').config();
const axios = require('axios');
const pool = require('./db');

// Получаем векторное представление (эмбеддинг) текста через Voyage AI.
// Эмбеддинг — это просто массив чисел, который отражает "смысл" текста,
// чтобы потом можно было искать похожие по смыслу товары.
async function getEmbedding(text) {
  const response = await axios.post(
    'https://api.voyageai.com/v1/embeddings',
    {
      input: [text],
      model: 'voyage-3.5',
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.data[0].embedding;
}

// Ищем в каталоге товары, наиболее релевантные запросу клиента.
// Например клиент написал "нужны плотные шторы в спальню, тёмно-синие"
// — находим товары, максимально близкие по смыслу, а не только по ключевым словам.
async function searchCatalog(query, limit = 5) {
  const embedding = await getEmbedding(query);
  const vectorLiteral = `[${embedding.join(',')}]`;

  const { rows } = await pool.query(
    `SELECT id, name, category, fabric, color, price, width_cm, height_cm, in_stock, description
     FROM products
     WHERE in_stock = true
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [vectorLiteral, limit]
  );

  return rows;
}

module.exports = { getEmbedding, searchCatalog };
