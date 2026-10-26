"""
AI Governance & Pipeline Monitoring Sub-Package
Includes dbt governance & Airflow orchestration telemetry router.
"""

from .router import router

__all__ = ["router"]
