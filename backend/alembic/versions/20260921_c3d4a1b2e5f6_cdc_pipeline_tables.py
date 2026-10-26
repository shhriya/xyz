"""cdc pipeline tables

Revision ID: c3d4a1b2e5f6
Revises: 567e9207d04d
Create Date: 2026-09-21 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4a1b2e5f6'
down_revision: Union[str, Sequence[str], None] = '567e9207d04d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cdc_pipelines',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('source_connection', sa.Text(), nullable=False),
        sa.Column('target_connection', sa.Text(), nullable=False),
        sa.Column('tables_config', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'cdc_checkpoints',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pipeline_id', sa.String(length=64), nullable=False),
        sa.Column('table_name', sa.String(length=255), nullable=False),
        sa.Column('last_loaded_column', sa.String(length=255), nullable=True),
        sa.Column('last_loaded_value', sa.Text(), nullable=True),
        sa.Column('row_count', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['pipeline_id'], ['cdc_pipelines.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cdc_checkpoints_pipeline_id', 'cdc_checkpoints', ['pipeline_id'])
    op.create_table(
        'cdc_run_history',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pipeline_id', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('tables_processed', sa.Integer(), nullable=True),
        sa.Column('total_rows_loaded', sa.Integer(), nullable=True),
        sa.Column('total_rows_updated', sa.Integer(), nullable=True),
        sa.Column('total_rows_deleted', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['pipeline_id'], ['cdc_pipelines.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cdc_run_history_pipeline_id', 'cdc_run_history', ['pipeline_id'])


def downgrade() -> None:
    op.drop_index('ix_cdc_run_history_pipeline_id', table_name='cdc_run_history')
    op.drop_table('cdc_run_history')
    op.drop_index('ix_cdc_checkpoints_pipeline_id', table_name='cdc_checkpoints')
    op.drop_table('cdc_checkpoints')
    op.drop_table('cdc_pipelines')
