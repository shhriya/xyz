from app.modules.cloud_modernization.services.domain_validator import validate_domain_consistency, DomainConsistencyError

bad_meta = {
    "domain": "healthcare",
    "entities": {
        "patients": [],
        "orders": []
    }
}

try:
    validate_domain_consistency(bad_meta)
    print("FAILED: Did not catch domain inconsistency.")
except DomainConsistencyError as e:
    print(f"SUCCESS: Caught mixed domains -> {e}")

