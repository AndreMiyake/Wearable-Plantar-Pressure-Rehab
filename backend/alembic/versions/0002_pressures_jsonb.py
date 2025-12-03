"""ensure pressures column is jsonb and indexed

Revision ID: 0002
Revises: 0001
Create Date: 2025-12-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Force the column to jsonb (casts existing data) and add a GIN index for @> lookups.
    op.alter_column(
        "pressure_samples",
        "pressures",
        type_=postgresql.JSONB(),
        existing_nullable=True,
        postgresql_using="pressures::jsonb",
    )
    op.create_index(
        "ix_pressure_samples_pressures_gin",
        "pressure_samples",
        ["pressures"],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_pressure_samples_pressures_gin", table_name="pressure_samples")
    op.alter_column(
        "pressure_samples",
        "pressures",
        type_=sa.JSON(),
        existing_nullable=True,
        postgresql_using="pressures::json",
    )
