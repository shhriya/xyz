"""
Source adapter registry. To support a new scheduler, add one adapter module and register its class here.
"""

from typing import Any, Dict, List, Type

from .base_adapter import SourceAdapter
from .dbt_adapter import DbtAdapter
from .airflow_adapter import AirflowAdapter
from .oracle_scheduler_adapter import OracleSchedulerAdapter
from .other_adapter import OtherAdapter

ADAPTERS: Dict[str, Type[SourceAdapter]] = {
    DbtAdapter.source_type: DbtAdapter,
    AirflowAdapter.source_type: AirflowAdapter,
    OracleSchedulerAdapter.source_type: OracleSchedulerAdapter,
    OtherAdapter.source_type: OtherAdapter,
}


def get_adapter_class(source_type: str) -> Type[SourceAdapter]:
    key = (source_type or "").strip().lower()
    if key not in ADAPTERS:
        raise ValueError(f"Unsupported source type '{source_type}'. Available: {', '.join(sorted(ADAPTERS))}")
    return ADAPTERS[key]


def build_adapter(source_type: str, config: Dict[str, Any]) -> SourceAdapter:
    return get_adapter_class(source_type)(config)


def describe_source_types() -> List[Dict[str, Any]]:
    return [
        {
            "source_type": cls.source_type,
            "display_label": cls.display_label,
            "credential_fields": cls.credential_fields,
            "default_target_db": cls.default_target_db,
            "default_target_schema": cls.default_target_schema,
            "extension_tables": cls({}).extension_tables(),
        }
        for cls in ADAPTERS.values()
    ]


__all__ = ["SourceAdapter", "ADAPTERS", "get_adapter_class", "build_adapter", "describe_source_types"]
