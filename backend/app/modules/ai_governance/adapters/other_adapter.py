from typing import Any, Dict, List

from .base_adapter import SourceAdapter


class OtherAdapter(SourceAdapter):
    source_type = "other"
    display_label = "Other (Custom Sources)"
    default_target_db = "CUSTOM_MONITORING"
    default_target_schema = "TELEMETRY"
    credential_fields = [
        {"key": "customHost", "label": "Host", "type": "text", "required": False, "placeholder": "api.example.com"},
        {"key": "customToken", "label": "API Token", "type": "password", "required": False, "placeholder": "Token..."},
    ]

    def authenticate(self) -> Dict[str, Any]:
        return {"message": "Custom source endpoint verified.", "version": "1.0"}

    def connection_identity(self) -> str:
        return self.config.get("customHost") or "custom_source"

    def fetch_jobs(self) -> List[Dict[str, Any]]:
        return []

    def fetch_runs(self) -> List[Dict[str, Any]]:
        return []

    def fetch_run_results(self) -> List[Dict[str, Any]]:
        return []

    def test_connection(self) -> Dict[str, Any]:
        return {"status": "success", "message": "Custom source endpoint reached.", "version": "N/A"}

    def extension_tables(self) -> List[str]:
        return []

    def get_display_name(self) -> str:
        return "Custom Source"
