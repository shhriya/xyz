"""Databricks workspace file discovery (Step 1 source discovery)."""

import base64
import os

import requests

from urllib.parse import urlparse


def fetch_databricks_workspace_files(workspace_url: str, token: str, folder_path: str) -> tuple[list, str]:
    """
    Connects to live Databricks Workspace REST API v2.0:
    1. Robustly parses URL hostname (strips query parameters, hashes, trailing slashes)
    2. Tries multiple path permutations (/Users, /Workspace/Users, exact casing)
    3. Exports notebook source code via /api/2.0/workspace/export
    Returns: (files_list, error_or_success_message)
    """
    if not workspace_url or not str(workspace_url).strip():
        return [], "No Databricks Workspace URL provided in Section B."
    if not token or not str(token).strip() or token == "••••••••••••":
        return [], "No Databricks Personal Access Token (PAT) provided in Section B."

    # Parse clean base URL
    raw_ws = workspace_url.strip()
    parsed = urlparse(raw_ws if '://' in raw_ws else f"https://{raw_ws}")
    base_url = f"{parsed.scheme or 'https'}://{parsed.netloc}"

    raw_path = folder_path.strip()
    if not raw_path.startswith('/'):
        raw_path = f"/{raw_path}"

    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json"
    }

    # Generate path permutations
    candidate_paths = [
        raw_path,
        raw_path.replace("/users/", "/Users/"),
        raw_path.replace("/Users/", "/Workspace/Users/"),
        raw_path.replace("/users/", "/Workspace/Users/"),
        f"/Workspace{raw_path}",
    ]

    list_url = f"{base_url}/api/2.0/workspace/list"
    resp = None
    last_err = ""
    matched_path = raw_path

    for cpath in candidate_paths:
        try:
            r = requests.get(list_url, headers=headers, params={"path": cpath}, timeout=8)
            if r.status_code == 200 and "application/json" in r.headers.get("content-type", ""):
                resp = r
                matched_path = cpath
                break
            elif r.status_code == 401:
                last_err = "Databricks 401 Unauthorized: Invalid or expired Personal Access Token (PAT)."
            elif r.status_code == 403:
                last_err = "Databricks 403 Forbidden: Access denied to workspace API."
            elif r.status_code == 404:
                last_err = f"Databricks 404 Not Found: Path '{cpath}' not found."
            else:
                last_err = f"Databricks HTTP {r.status_code}: {r.text[:120]}"
        except Exception as ex:
            last_err = f"Connection to {base_url} failed: {str(ex)}"

    # If direct candidate paths failed, try discovering parent /Users
    if resp is None:
        try:
            for p_root in ["/Users", "/Workspace/Users"]:
                r_root = requests.get(list_url, headers=headers, params={"path": p_root}, timeout=6)
                if r_root.status_code == 200 and "application/json" in r_root.headers.get("content-type", ""):
                    users_data = r_root.json().get("objects", [])
                    sub_target = raw_path.split('/')[-1]
                    for u in users_data:
                        u_path = u.get("path", "")
                        cand = f"{u_path}/{sub_target}"
                        r_cand = requests.get(list_url, headers=headers, params={"path": cand}, timeout=6)
                        if r_cand.status_code == 200 and "application/json" in r_cand.headers.get("content-type", ""):
                            resp = r_cand
                            matched_path = cand
                            break
                    if resp is not None:
                        break
        except Exception:
            pass

    if resp is None:
        return [], last_err or "Unable to connect to Databricks workspace."

    try:
        data = resp.json()
    except Exception:
        return [], "Databricks returned non-JSON response."

    objects = data.get("objects", [])
    if not objects:
        return [], f"Directory '{matched_path}' is empty."

    files = []
    for obj in objects:
        obj_path = obj.get("path", "")
        obj_type = obj.get("object_type", "")
        language = obj.get("language", "PYTHON")
        obj_name = os.path.basename(obj_path)

        if obj_type == "NOTEBOOK":
            content = ""
            try:
                exp_url = f"{base_url}/api/2.0/workspace/export"
                exp_resp = requests.get(exp_url, headers=headers, params={"path": obj_path, "format": "SOURCE"}, timeout=8)
                if exp_resp.status_code == 200:
                    exp_data = exp_resp.json()
                    b64_content = exp_data.get("content", "")
                    content = base64.b64decode(b64_content).decode('utf-8', errors='ignore')
            except Exception:
                content = f"# Databricks Notebook: {obj_name}\n# Path: {obj_path}\n"

            if not content:
                content = f"# Databricks Notebook: {obj_name}\n# Language: {language}\n"

            size_bytes = len(content.encode('utf-8'))
            size_kb = round(size_bytes / 1024, 1)
            size_str = f"{size_kb} KB" if size_kb >= 1 else f"{size_bytes} B"
            lines_count = len(content.splitlines())

            files.append({
                "id": f"dbx-{obj.get('object_id', len(files) + 1)}",
                "filename": f"{obj_name}.py" if not obj_name.endswith('.py') else obj_name,
                "path": obj_path,
                "fileSize": size_str,
                "sizeBytes": size_bytes,
                "lineCount": lines_count,
                "extension": "py",
                "category": f"Databricks {language.title()} Notebook",
                "content": content,
                "selected": True
            })
        elif obj_type == "FILE":
            content = ""
            try:
                exp_url = f"{base_url}/api/2.0/workspace/export"
                exp_resp = requests.get(exp_url, headers=headers, params={"path": obj_path, "format": "AUTO"}, timeout=8)
                if exp_resp.status_code == 200:
                    exp_data = exp_resp.json()
                    b64_content = exp_data.get("content", "")
                    content = base64.b64decode(b64_content).decode('utf-8', errors='ignore')
            except Exception:
                content = ""

            ext = os.path.splitext(obj_name)[1].lstrip('.') or "py"
            size_bytes = len(content.encode('utf-8'))
            size_kb = round(size_bytes / 1024, 1)
            size_str = f"{size_kb} KB" if size_kb >= 1 else f"{size_bytes} B"

            files.append({
                "id": f"dbx-file-{len(files) + 1}",
                "filename": obj_name,
                "path": obj_path,
                "fileSize": size_str,
                "sizeBytes": size_bytes,
                "lineCount": len(content.splitlines()),
                "extension": ext,
                "category": f"Workspace File (.{ext})",
                "content": content,
                "selected": True
            })

    return files, f"Successfully retrieved {len(files)} files from Databricks workspace ({matched_path})."
