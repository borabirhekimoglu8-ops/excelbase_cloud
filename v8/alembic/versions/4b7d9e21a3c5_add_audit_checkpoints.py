"""add audit checkpoints and active-passport unique index

Revision ID: 4b7d9e21a3c5
Revises: 2f10f322cd83
Create Date: 2026-07-10 10:50:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4b7d9e21a3c5'
down_revision: Union[str, None] = '2f10f322cd83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'audit_checkpoints',
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('verified_position', sa.Integer(), nullable=False),
        sa.Column('verified_hash', sa.String(length=64), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('organization_id'),
    )
    op.create_index(
        'uq_passengers_active_passport',
        'passengers',
        ['organization_id', 'operation_id', 'passport_hash'],
        unique=True,
        sqlite_where=sa.text('deleted_at IS NULL'),
        postgresql_where=sa.text('deleted_at IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_passengers_active_passport', table_name='passengers')
    op.drop_table('audit_checkpoints')
