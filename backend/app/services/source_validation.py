"""Credential checks for the Step 1 source connection form."""

from typing import Any, Dict, List, Optional




def validate_source_credentials(source_type: Optional[str], details: Dict[str, Any]) -> tuple[bool, str, List[str]]:
    if not source_type or not str(source_type).strip():
        return False, "No source dialect selected. Please choose a dialect from Section A above.", ["sourceType"]
    
    source_lower = source_type.lower()
    missing_fields = []
    
    def check_field(field_key: str, label: str):
        val = str(details.get(field_key, "")).strip()
        if not val or val == "••••••••••••":
            missing_fields.append(label)

    if any(k in source_lower for k in ["spark", "pyspark", "databricks"]):
        check_field("workspace", "Databricks Workspace URL")
        check_field("catalog", "Unity Catalog Name")
        
        token_val = str(details.get("token", "")).strip() or str(details.get("password", "")).strip()
        if not token_val or token_val == "••••••••••••":
            missing_fields.append("Personal Access Token (PAT)")
            
        if missing_fields:
            return False, f"Connection Failed: Missing required Databricks parameters: {', '.join(missing_fields)}. All starred (*) fields are required to authenticate with the workspace.", missing_fields

    elif any(k in source_lower for k in ["snowflake", "sql server", "oracle", "teradata", "generic sql"]):
        check_field("account", "Account / Host")
        check_field("database", "Database Name")
        check_field("username", "Username")
        check_field("password", "Password / Secret Key")
        if missing_fields:
            return False, f"Connection Failed: Missing required credentials: {', '.join(missing_fields)}. All starred (*) fields including Password are required to establish an authenticated connection.", missing_fields

    elif "informatica" in source_lower:
        check_field("repository", "Repository Name")
        check_field("domain", "Domain")
        check_field("integrationService", "Integration Service")
        check_field("username", "Username / User ID")
        check_field("password", "Password / Security Token")
        if missing_fields:
            return False, f"Connection Failed: Missing required Informatica parameters: {', '.join(missing_fields)}. All starred (*) fields are required to authenticate with the repository.", missing_fields



    elif "bigquery" in source_lower:
        check_field("projectId", "GCP Project ID")
        check_field("dataset", "Target Dataset / Schema")
        if missing_fields:
            return False, f"Connection Failed: Missing required BigQuery credentials: {', '.join(missing_fields)}.", missing_fields

    elif "redshift" in source_lower:
        check_field("host", "Redshift Host / Endpoint")
        check_field("database", "Database Name")
        check_field("username", "Username")
        if missing_fields:
            return False, f"Connection Failed: Missing required Redshift credentials: {', '.join(missing_fields)}.", missing_fields

    elif "json" in source_lower or "custom" in source_lower or "xml" in source_lower:
        if not details or not isinstance(details, dict):
            return False, "Connection Failed: JSON configuration payload cannot be empty.", ["details"]
        for r_key, r_label in [("account", "Account/Host"), ("database", "Database"), ("username", "Username"), ("password", "Password")]:
            if not str(details.get(r_key, "")).strip():
                missing_fields.append(r_label)
        if missing_fields:
            return False, f"Connection Failed: Missing required configuration keys in JSON: {', '.join(missing_fields)}.", missing_fields

    else:
        check_field("account", "Account / Host")
        check_field("username", "Username")
        check_field("password", "Password")
        if missing_fields:
            return False, f"Connection Failed: Missing required parameters: {', '.join(missing_fields)}.", missing_fields

    return True, f"Successfully authenticated and verified schema access for {source_type}.", []
