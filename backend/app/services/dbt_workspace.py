"""Local dbt project workspace used by the Code Conversion IDE, diff and download features."""

import os
from pathlib import Path

from fastapi import HTTPException

from app.core.config import settings


# Directory where the dbt output project is stored on disk.
# Override with DBT_PROJECT_DIR in .env
IDE_PROJECT_DIR = Path(settings.dbt_project_dir).resolve()


GIT_SKIP_DIRS = {".git", "__pycache__", "target", "dbt_packages", "logs", "node_modules"}


def ensure_ide_project() -> None:
    """Ensure the on-disk dbt project directory exists."""
    IDE_PROJECT_DIR.mkdir(parents=True, exist_ok=True)


def collect_dbt_project_files() -> list:
    ensure_ide_project()
    collected = []
    for root, dirs, filenames in os.walk(IDE_PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in GIT_SKIP_DIRS]
        for name in filenames:
            if name in {".DS_Store"}:
                continue
            full = Path(root) / name
            rel = str(full.relative_to(IDE_PROJECT_DIR)).replace("\\", "/")
            try:
                collected.append((rel, full.read_text(encoding="utf-8")))
            except UnicodeDecodeError:
                continue
    return collected


def safe_path(rel_path: str) -> Path:
    """Resolve a relative path safely, preventing directory traversal."""
    target = (IDE_PROJECT_DIR / rel_path).resolve()
    if not str(target).startswith(str(IDE_PROJECT_DIR)):
        raise HTTPException(status_code=403, detail="Path traversal not allowed")
    return target


def build_tree(directory: Path, base: Path) -> list:
    """Recursively build a VS Code-style file tree."""
    items = []
    try:
        entries = sorted(directory.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
    except PermissionError:
        return items
    for entry in entries:
        if entry.name in GIT_SKIP_DIRS:
            continue
        rel = str(entry.relative_to(base)).replace("\\", "/")
        if entry.is_dir():
            items.append({
                "name": entry.name,
                "path": rel,
                "type": "folder",
                "children": build_tree(entry, base)
            })
        else:
            items.append({
                "name": entry.name,
                "path": rel,
                "type": "file",
                "ext": entry.suffix.lstrip('.')
            })
    return items
