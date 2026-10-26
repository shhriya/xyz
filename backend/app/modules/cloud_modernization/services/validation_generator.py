from typing import Dict, List, Any

def generate_validation_queries(metadata: Dict[str, Any]) -> Dict[str, str]:
    files = {}
    kpis = metadata.get("kpis", [])
    for k in kpis:
        files[f"analyses/{k}_validation.sql"] = f"-- Validate {k}\nselect 1 as valid;\n"
    return files
