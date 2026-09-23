"""
Alembic Migration: Add telephony fields to sip_trunks and calls tables.

Revision ID: add_telephony_fields_001
Revises: (your current head)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "add_telephony_fields_001"
down_revision = None  # Set to your current head revision
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── sip_trunks ────────────────────────────────────────────────────────────
    op.add_column(
        "sip_trunks",
        sa.Column("agent_id", sa.String(), nullable=True),
    )
    op.add_column(
        "sip_trunks",
        sa.Column("provider", sa.String(), nullable=True, server_default="twilio"),
    )
    op.create_index(
        "ix_sip_trunks_agent_id",
        "sip_trunks",
        ["agent_id"],
    )

    # ── calls ─────────────────────────────────────────────────────────────────
    op.add_column(
        "calls",
        sa.Column("metadata", JSONB, nullable=True, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("calls", "metadata")
    op.drop_index("ix_sip_trunks_agent_id", "sip_trunks")
    op.drop_column("sip_trunks", "provider")
    op.drop_column("sip_trunks", "agent_id")
