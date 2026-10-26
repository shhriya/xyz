"""
Schema Inference — Entity-to-Column Mapping
Consumes dynamic domain-aware metadata instead of relying on hardcoded retail schemas.
"""
from typing import Dict, List, Any

ColumnDef = Dict[str, Any]

# Fallback in case LLM misses schema definition for standard retail
ENTITY_SCHEMAS: Dict[str, List[ColumnDef]] = {
    "_default": [
        {"name": "__PK___id", "type": "VARCHAR(64)",   "desc": "Unique identifier",       "pk": True,  "fk": False, "nullable": False, "ts": False},
        {"name": "name",      "type": "VARCHAR(200)",  "desc": "Name or title",            "pk": False, "fk": False, "nullable": True,  "ts": False},
        {"name": "status",    "type": "VARCHAR(30)",   "desc": "Record status",            "pk": False, "fk": False, "nullable": True,  "ts": False},
        {"name": "created_at","type": "TIMESTAMP_NTZ", "desc": "Creation timestamp",       "pk": False, "fk": False, "nullable": True,  "ts": True},
        {"name": "updated_at","type": "TIMESTAMP_NTZ", "desc": "Last update timestamp",    "pk": False, "fk": False, "nullable": True,  "ts": True},
    ],
}

def get_entity_schema(entity: str, dynamic_metadata: Dict[str, Any] = None) -> List[ColumnDef]:
    """Retrieves schema definition for the entity from dynamic metadata."""
    ent = entity.lower().strip()
    
    if dynamic_metadata and ent in dynamic_metadata:
        schema = dynamic_metadata[ent]
        if schema and isinstance(schema, list) and len(schema) > 0:
            return schema

    # Fallback to default
    cols = []
    pk_name = f"{ent.rstrip('s')}_id"
    for col in ENTITY_SCHEMAS["_default"]:
        c = dict(col)
        c["name"] = c["name"].replace("__PK__", ent.rstrip("s"))
        cols.append(c)
    return cols

def get_pk_column(entity: str, dynamic_metadata: Dict[str, Any] = None) -> str:
    schema = get_entity_schema(entity, dynamic_metadata)
    pks = [c["name"] for c in schema if c.get("pk")]
    return pks[0] if pks else f"{entity.lower().rstrip('s')}_id"

def get_timestamp_columns(entity: str, dynamic_metadata: Dict[str, Any] = None) -> List[str]:
    return [c["name"] for c in get_entity_schema(entity, dynamic_metadata) if c.get("ts")]

def get_fk_columns(entity: str, dynamic_metadata: Dict[str, Any] = None) -> List[str]:
    return [c["name"] for c in get_entity_schema(entity, dynamic_metadata) if c.get("fk")]
