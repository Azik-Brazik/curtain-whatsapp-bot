-- Подключаем расширение для векторного поиска (RAG)
CREATE EXTENSION IF NOT EXISTS vector;

-- ===== Каталог штор =====
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,               -- "Штора блэкаут 'Милан'"
    category TEXT,                    -- "блэкаут" / "тюль" / "рулонные"
    fabric TEXT,                      -- материал
    color TEXT,
    price NUMERIC(10,2) NOT NULL,
    width_cm INTEGER,
    height_cm INTEGER,
    in_stock BOOLEAN DEFAULT TRUE,
    description TEXT,                 -- полное описание для показа клиенту
    -- эмбеддинг описания товара для семантического поиска (RAG)
    embedding vector(1536)
);

CREATE INDEX IF NOT EXISTS products_embedding_idx
    ON products USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ===== Клиенты =====
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    whatsapp_id TEXT UNIQUE NOT NULL,  -- "77001234567@c.us"
    name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ===== История диалога (нужна модели как контекст) =====
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    role TEXT NOT NULL,               -- 'user' | 'assistant'
    content TEXT NOT NULL,
    message_id TEXT UNIQUE,           -- id сообщения от WhatsApp — нужен для идемпотентности
    created_at TIMESTAMP DEFAULT NOW()
);

-- ===== Заказы, которые оформляет ИИ через function calling =====
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    product_id INTEGER REFERENCES products(id),
    width_cm INTEGER,
    height_cm INTEGER,
    address TEXT,
    preferred_datetime TEXT,
    status TEXT DEFAULT 'new',        -- new | confirmed | cancelled
    created_at TIMESTAMP DEFAULT NOW()
);
