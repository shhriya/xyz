"""Push generated dbt projects to GitHub (shared by Code Conversion and Cloud Modernization)."""

from typing import Optional




def parse_github_repo(raw: str) -> tuple:
    value = (raw or "").strip()
    if not value:
        raise ValueError("Repository is required. Use owner/repo or https://github.com/owner/repo")
    value = value.replace("https://", "").replace("http://", "").replace("ssh://git@", "")
    if value.startswith("git@"):
        value = value.split(":", 1)[-1]
    if value.lower().startswith("github.com/") or value.lower().startswith("www.github.com/"):
        value = value.split("/", 1)[1]
    value = value.strip("/")
    if value.endswith(".git"):
        value = value[:-4]
    parts = [p for p in value.split("/") if p]
    if len(parts) < 2:
        raise ValueError("Repository must be owner/repo (e.g. my-org/dbt-project)")
    return parts[0], parts[1]


def _is_empty_git_error(err: str) -> bool:
    lower = (err or "").lower()
    return "git repository is empty" in lower or ("409" in (err or "") and "empty" in lower)


def _github_api(method: str, path: str, token: str, body: Optional[dict] = None):
    import json as _json
    import urllib.error
    import urllib.request

    url = f"https://api.github.com{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "r-data-dbt-export",
    }
    data = None
    if body is not None:
        data = _json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return _json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = _json.loads(err_body)
            msg = parsed.get("message", err_body)
            extra = parsed.get("documentation_url", "")
        except Exception:
            msg, extra = err_body, ""
        hint = f" {extra}" if extra else ""
        raise RuntimeError(f"GitHub API {e.code}: {msg}{hint}") from e


def _upload_files_via_contents(owner: str, repo: str, token: str, branch: str, commit_msg: str, files: list) -> str:
    """Create or update files with the Contents API. This is the only GitHub API that can make the first commit in an empty repo."""
    import base64
    import urllib.parse

    last_sha = ""
    for i, (rel, content) in enumerate(files):
        path = urllib.parse.quote(rel, safe="/")
        body = {
            "message": commit_msg if i == 0 else f"{commit_msg}: {rel}",
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        try:
            existing = _github_api(
                "GET",
                f"/repos/{owner}/{repo}/contents/{path}?ref={urllib.parse.quote(branch, safe='')}",
                token,
            )
            if isinstance(existing, dict) and existing.get("sha"):
                body["sha"] = existing["sha"]
        except RuntimeError:
            pass
        result = _github_api("PUT", f"/repos/{owner}/{repo}/contents/{path}", token, body)
        last_sha = (result.get("commit") or {}).get("sha") or last_sha
    return last_sha


def push_files_to_github(owner: str, repo: str, token: str, branch: str, commit_msg: str, files: list) -> dict:
    repo_info = _github_api("GET", f"/repos/{owner}/{repo}", token)
    branch = (branch or "").strip() or repo_info.get("default_branch") or "main"
    commit_msg = (commit_msg or "").strip() or "Export dbt project from Review & Generate"

    repo_empty = False
    try:
        _github_api("GET", f"/repos/{owner}/{repo}/commits?per_page=1", token)
    except RuntimeError as e:
        if _is_empty_git_error(str(e)) or "409" in str(e):
            repo_empty = True
        else:
            raise

    # Git Trees/Commits APIs return 409 on a repo with no commits. Contents API can create the first commit.
    if repo_empty:
        commit_sha = _upload_files_via_contents(owner, repo, token, branch, commit_msg, files)
        return {
            "branch": branch,
            "commitHash": (commit_sha or "")[:7],
            "prUrl": f"https://github.com/{owner}/{repo}/tree/{branch}",
            "fileCount": len(files),
        }

    parent_sha = None
    base_tree = None
    ref_exists = False
    try:
        ref = _github_api("GET", f"/repos/{owner}/{repo}/git/ref/heads/{branch}", token)
        parent_sha = ref.get("object", {}).get("sha")
        ref_exists = bool(parent_sha)
    except RuntimeError as e:
        err = str(e)
        missing_ref = "404" in err or _is_empty_git_error(err)
        if not missing_ref:
            raise
        default_branch = repo_info.get("default_branch") or "main"
        if default_branch != branch:
            try:
                ref = _github_api("GET", f"/repos/{owner}/{repo}/git/ref/heads/{default_branch}", token)
                parent_sha = ref.get("object", {}).get("sha")
            except RuntimeError:
                parent_sha = None

    if parent_sha:
        commit = _github_api("GET", f"/repos/{owner}/{repo}/git/commits/{parent_sha}", token)
        base_tree = commit.get("tree", {}).get("sha")

    tree_payload = {
        "tree": [
            {"path": rel, "mode": "100644", "type": "blob", "content": content}
            for rel, content in files
        ]
    }
    if base_tree:
        tree_payload["base_tree"] = base_tree

    try:
        tree = _github_api("POST", f"/repos/{owner}/{repo}/git/trees", token, tree_payload)
    except RuntimeError as e:
        if _is_empty_git_error(str(e)):
            commit_sha = _upload_files_via_contents(owner, repo, token, branch, commit_msg, files)
            return {
                "branch": branch,
                "commitHash": (commit_sha or "")[:7],
                "prUrl": f"https://github.com/{owner}/{repo}/tree/{branch}",
                "fileCount": len(files),
            }
        raise

    new_commit = _github_api("POST", f"/repos/{owner}/{repo}/git/commits", token, {
        "message": commit_msg,
        "tree": tree["sha"],
        "parents": [parent_sha] if parent_sha else [],
    })
    commit_sha = new_commit["sha"]

    if ref_exists:
        _github_api("PATCH", f"/repos/{owner}/{repo}/git/refs/heads/{branch}", token, {
            "sha": commit_sha,
            "force": True,
        })
    else:
        try:
            _github_api("POST", f"/repos/{owner}/{repo}/git/refs", token, {
                "ref": f"refs/heads/{branch}",
                "sha": commit_sha,
            })
        except RuntimeError:
            _github_api("PATCH", f"/repos/{owner}/{repo}/git/refs/heads/{branch}", token, {
                "sha": commit_sha,
                "force": True,
            })

    return {
        "branch": branch,
        "commitHash": commit_sha[:7],
        "prUrl": f"https://github.com/{owner}/{repo}/tree/{branch}",
        "fileCount": len(files),
    }
