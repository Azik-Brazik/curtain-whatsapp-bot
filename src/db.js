require('dotenv').config();
const { Pool } = require('pg');

// Единый пул соединений с базой — переиспользуется во всём проекте
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Если соединение с базой обрывается — не роняем весь процесс, а логируем
  console.error('Неожиданная ошибка в пуле PostgreSQL:', err);
});

module.exports = pool;
