import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

env_path = os.path.join(r"c:\Users\ShriyaK\OneDrive - Relanto\Desktop\PROJECTS\de_poc\ai_powered_data_poc", '.env.local')
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("No DATABASE_URL found.")
    exit(1)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

insert_sql = """
INSERT INTO public.users (name, email) VALUES
    ('Diana Prince', 'diana@example.com');

-- We know user_id=1 (Alice) and 3 (Charlie) exist from the previous seed
INSERT INTO public.orders (user_id, amount, status) VALUES
    (1, 450.00, 'PENDING'),
    (3, 120.75, 'COMPLETED');
"""

def insert_db():
    with engine.begin() as conn:
        conn.execute(text(insert_sql))
        print("Successfully inserted 1 new user (Diana Prince) and 2 new orders!")

if __name__ == "__main__":
    insert_db()
