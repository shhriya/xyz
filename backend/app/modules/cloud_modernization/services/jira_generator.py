from typing import Dict, List, Any

def generate_jira_stories(metadata: Dict[str, Any]) -> Dict[str, str]:
    files = {}
    entities = list(metadata.get("entities", {}).keys())
    files["docs/jira_stories.md"] = f"# Jira Stories\nGenerated for entities: {entities}\n"
    return files
