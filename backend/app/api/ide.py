"""/api/ide: in-browser file editor over the generated dbt project."""

import logging
import shutil

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import repository as db_service
from app.services.dbt_workspace import (
    IDE_PROJECT_DIR,
    build_tree,
    ensure_ide_project,
    safe_path,
)
from app.state import state


logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["ide"])


@router.get("/api/ide/files")
def ide_list_files():
    """Return the full file tree of the dbt output project directory."""
    if not state.get("has_migrated", False):
        return {
            "status": "success",
            "projectDir": str(IDE_PROJECT_DIR),
            "tree": []
        }
    ensure_ide_project()
    tree = build_tree(IDE_PROJECT_DIR, IDE_PROJECT_DIR)
    return {
        "status": "success",
        "projectDir": str(IDE_PROJECT_DIR),
        "tree": tree
    }


@router.get("/api/ide/file")
def ide_read_file(path: str = Query(..., description="Relative path inside project dir")):
    """Read a single file's content from disk."""
    if not state.get("has_migrated", False):
        raise HTTPException(status_code=404, detail="Migration not executed yet.")
    target = safe_path(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    content = target.read_text(encoding="utf-8", errors="replace")
    return {
        "status": "success",
        "path": path,
        "content": content,
        "size": target.stat().st_size,
        "modified": target.stat().st_mtime
    }


class IdeWriteRequest(BaseModel):
    path: str
    content: str


@router.put("/api/ide/file")
def ide_write_file(req: IdeWriteRequest):
    """Write (create or overwrite) a file on disk."""
    target = safe_path(req.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(req.content, encoding="utf-8")
    try:
        db_service.save_step5_dbt_file(req.path, req.content)
    except Exception as e:
        print(f"DB save warning: {e}")
    return {
        "status": "success",
        "message": f"Saved: {req.path}",
        "path": req.path,
        "size": target.stat().st_size
    }


class IdeDeleteRequest(BaseModel):
    path: str


@router.delete("/api/ide/file")
def ide_delete_file(req: IdeDeleteRequest):
    """Delete a file or folder from disk."""
    target = safe_path(req.path)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {req.path}")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"status": "success", "message": f"Deleted: {req.path}"}


class IdeRenameRequest(BaseModel):
    oldPath: str
    newPath: str


@router.post("/api/ide/rename")
def ide_rename(req: IdeRenameRequest):
    """Rename or move a file/folder."""
    src = safe_path(req.oldPath)
    dst = safe_path(req.newPath)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Source not found: {req.oldPath}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return {"status": "success", "message": f"Renamed {req.oldPath} → {req.newPath}"}


class IdeMkdirRequest(BaseModel):
    path: str


@router.post("/api/ide/mkdir")
def ide_mkdir(req: IdeMkdirRequest):
    """Create a new folder."""
    target = safe_path(req.path)
    target.mkdir(parents=True, exist_ok=True)
    return {"status": "success", "message": f"Created folder: {req.path}"}


@router.get("/api/ide/vscode-uri")
def ide_vscode_uri(path: str = Query(...)):
    """Return the vscode:// URI to open a file in local VS Code."""
    abs_path = str(safe_path(path)).replace("\\", "/")
    uri = f"vscode://file/{abs_path}"
    folder_uri = f"vscode://file/{str(IDE_PROJECT_DIR).replace(chr(92), '/')}"
    return {
        "status": "success",
        "fileUri": uri,
        "folderUri": folder_uri,
        "absolutePath": abs_path,
        "projectDir": str(IDE_PROJECT_DIR)
    }


class IdeRunRequest(BaseModel):
    command: str


@router.post("/api/ide/run")
def ide_run_command(req: IdeRunRequest):
    """Execute a terminal command inside the project directory."""
    import subprocess
    try:
        result = subprocess.run(
            req.command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=str(IDE_PROJECT_DIR)
        )
        output = result.stdout
        if result.stderr:
            output += "\n" + result.stderr
            
        return {
            "status": "success",
            "output": output.strip() or "Command completed with no output."
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }
