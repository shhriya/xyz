from typing import Dict, List, Any

def generate_seeds(metadata: Dict[str, Any]) -> Dict[str, str]:
    files = {}
    seeds_required = metadata.get("seeds_required", [])
    
    if "gst_rates" in seeds_required:
        files["seeds/gst_rates.csv"] = "state,rate\nMH,0.18\nKA,0.18"
    if "product_categories" in seeds_required:
        files["seeds/product_categories.csv"] = "category,margin\nelectronics,0.15\napparel,0.3"
    
    files["seeds/lookup.csv"] = "id,name\n1,Placeholder"
    return files
