"""Snapshot Generator — SCD Type 2 snapshots when historical tracking is detected."""
from typing import Dict, List, Any
from .schema_inference import get_entity_schema, get_pk_column, get_timestamp_columns

def generate_generic_snapshot(entity: str, metadata: Dict[str, Any]) -> str:
    schema = get_entity_schema(entity, metadata.get("entities", {}))
    pk = get_pk_column(entity, metadata.get("entities", {}))
    ts_cols = get_timestamp_columns(entity, metadata.get("entities", {}))
    
    updated_at = ts_cols[0] if ts_cols else "updated_at"
    
    cols = ",\n    ".join([c["name"] for c in schema])
    
    return (
        f"{{% snapshot {entity}_snapshot %}}\n\n"
        "{{\n    config(\n"
        "        target_schema           = 'snapshots',\n"
        f"        unique_key              = '{pk}',\n"
        "        strategy                = 'timestamp',\n"
        f"        updated_at              = '{updated_at}',\n"
        "        invalidate_hard_deletes = true,\n"
        f"        tags                    = ['snapshot', '{entity}', 'scd_type2']\n"
        "    )\n}}\n\n"
        "-- =============================================================================\n"
        f"-- Snapshot: {entity.upper()}_SNAPSHOT (SCD Type 2)\n"
        f"-- Tracks historical changes to {entity} attributes.\n"
        "-- =============================================================================\n\n"
        "select\n    "
        f"{cols}\n"
        f"from {{{{ source('raw_landing', 'raw_{entity}') }}}}\n\n"
        "{% endsnapshot %}\n"
    )

def generate_snapshots(metadata: Dict[str, Any]) -> Dict[str, str]:
    if not metadata.get("snapshots_required", False):
        return {}
        
    files: Dict[str, str] = {}
    snapshots = metadata.get("snapshots", [])
    
    for snap in snapshots:
        entity = snap.replace("_snapshot", "")
        files[f"snapshots/{snap}.sql"] = generate_generic_snapshot(entity, metadata)
        
    return files
