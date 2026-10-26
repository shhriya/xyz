import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Try to load from .env.local if available (where DATABASE_URL is stored)
env_path = os.path.join(r"c:\Users\ShriyaK\OneDrive - Relanto\Desktop\PROJECTS\de_poc\ai_powered_data_poc", '.env.local')
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("No DATABASE_URL found. Please make sure .env.local is present.")
    exit(1)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

seed_sql = """
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

CREATE TABLE public.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(id),
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.users (name, email) VALUES
    ('Alice Smith', 'alice@example.com'),
    ('Bob Jones', 'bob@example.com'),
    ('Charlie Brown', 'charlie@example.com');

INSERT INTO public.orders (user_id, amount, status) VALUES
    (1, 150.00, 'COMPLETED'),
    (1, 25.50, 'PENDING'),
    (2, 500.00, 'SHIPPED');
"""

def seed_db():
    with engine.begin() as conn:
        conn.execute(text(seed_sql))
        print("Successfully seeded PostgreSQL database with 'users' and 'orders' tables and sample data.")

if __name__ == "__main__":
    seed_db()
