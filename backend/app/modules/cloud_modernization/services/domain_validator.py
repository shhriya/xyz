"""
Domain Consistency Validator
Ensures that the LLM output does not mix entities from multiple domains.
For example, retail entities (customers, orders) shouldn't appear in healthcare.
"""
from typing import Dict, Any

class DomainConsistencyError(Exception):
    pass

RETAIL_ENTITIES = {"customers", "orders", "products", "inventory", "sales", "campaigns"}
HEALTHCARE_ENTITIES = {"patients", "claims", "hospitals", "providers", "policies", "diagnoses", "encounters"}
FINANCE_ENTITIES = {"accounts", "transactions", "loans", "payments", "ledgers", "invoices"}
HR_ENTITIES = {"employees", "departments", "payroll", "attendance", "leaves"}

def validate_domain_consistency(metadata: Dict[str, Any]):
    domain = metadata.get("domain", "").lower()
    entities = metadata.get("entities", {})
    entity_names = set(entities.keys())

    if domain == "healthcare":
        bad_entities = entity_names.intersection(RETAIL_ENTITIES | FINANCE_ENTITIES | HR_ENTITIES)
        if bad_entities:
            raise DomainConsistencyError(f"Healthcare domain mixed with invalid entities: {bad_entities}")

    elif domain == "retail":
        bad_entities = entity_names.intersection(HEALTHCARE_ENTITIES | HR_ENTITIES)
        if bad_entities:
            raise DomainConsistencyError(f"Retail domain mixed with invalid entities: {bad_entities}")

    if not entity_names:
        raise DomainConsistencyError("No valid entities extracted.")
