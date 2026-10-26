from typing import Dict, List, Any

def generate_all_yaml(metadata: Dict[str, Any]) -> Dict[str, str]:
    files = {}
    files["models/schema.yml"] = (
        "version: 2\n\nmodels:\n"
        "  - name: generic_model\n"
        "    description: 'Generic schema description'\n"
    )
    return files
