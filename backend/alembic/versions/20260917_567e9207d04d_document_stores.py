"""document stores and encrypted connection details

Replaces the *_store.json files with tables, and stores projects.connection_details
as (optionally Fernet-encrypted) text.

Revision ID: 567e9207d04d
Revises: e26842abf290
Create Date: 2026-09-17 20:16:50.899732

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '567e9207d04d'
down_revision: Union[str, Sequence[str], None] = 'e26842abf290'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# table name -> column type of `data` (Text holds encrypted JSON)
DOCUMENT_TABLES = {
    'app_settings': sa.Text(),
    'governance_sources': sa.Text(),
    'saved_connections': sa.Text(),
    'snowflake_scope_credentials': sa.Text(),
    'kpi_dashboards': sa.JSON(),
    'semantic_models': sa.JSON(),
}


def upgrade() -> None:
    for name, data_type in DOCUMENT_TABLES.items():
        op.create_table(
            name,
            sa.Column('key', sa.String(length=255), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('data', data_type, nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('key'),
        )
    op.alter_column(
        'projects', 'connection_details',
        existing_type=postgresql.JSON(astext_type=sa.Text()),
        type_=sa.Text(),
        existing_nullable=True,
        postgresql_using='connection_details::text',
    )


def downgrade() -> None:
    # Only possible while connection_details values are still plain (unencrypted) JSON.
    op.alter_column(
        'projects', 'connection_details',
        existing_type=sa.Text(),
        type_=postgresql.JSON(astext_type=sa.Text()),
        existing_nullable=True,
        postgresql_using='connection_details::json',
    )
    for name in reversed(list(DOCUMENT_TABLES)):
        op.drop_table(name)
