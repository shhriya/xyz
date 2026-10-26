"""Every new generation/import must land in a clean project folder — never merged into the last one."""
import importlib
import os
import stat
import sys

import pytest

# The package re-exports its APIRouter as `router`, shadowing the module of the same name.
cm = importlib.import_module("app.modules.cloud_modernization.router")


@pytest.fixture
def project_dir(tmp_path, monkeypatch):
    d = (tmp_path / "dbt_cloud_modernization").resolve()
    monkeypatch.setattr(cm, "CLOUD_MOD_PROJECT_DIR", d)
    monkeypatch.setattr(cm.time, "sleep", lambda s: None)
    return d


def _tree(d):
    return sorted(str(p.relative_to(d)).replace("\\", "/") for p in d.rglob("*") if p.is_file())


def test_new_project_replaces_old_one_completely(project_dir):
    cm._persist_files_to_disk({
        "dbt_project.yml": "name: old", "models/bronze/stg_old.sql": "select 1",
        "models/legacy_layer/old_mart.sql": "select 2", "seeds/old.csv": "a\n1",
    }, clean_first=True)
    ro = project_dir / "models/bronze/stg_old.sql"
    os.chmod(ro, stat.S_IREAD)                 # read-only, like a file cloned from git
    (project_dir / ".git").mkdir()
    (project_dir / ".git/HEAD").write_text("ref")

    warning = cm._persist_files_to_disk({"dbt_project.yml": "name: new", "models/gold/fct_new.sql": "select 3"}, clean_first=True)

    assert warning == ""
    assert _tree(project_dir) == [".git/HEAD", "dbt_project.yml", "models/gold/fct_new.sql"]
    assert (project_dir / "dbt_project.yml").read_text() == "name: new"


@pytest.mark.skipif(sys.platform != "win32", reason="only Windows refuses to delete an open file")
def test_locked_leftover_is_reported_not_hidden(project_dir):
    import ctypes
    from ctypes import wintypes

    cm._persist_files_to_disk({"seeds/old.csv": "a\n1", "dbt_project.yml": "x"}, clean_first=True)
    # Open the file the way Excel does: sharing read only, NOT delete — so it can't be removed.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.restype = wintypes.HANDLE
    handle = kernel32.CreateFileW(str(project_dir / "seeds/old.csv"), 0x80000000, 0x1, None, 3, 0x80, None)
    assert handle not in (None, wintypes.HANDLE(-1).value)
    try:
        warning = cm._persist_files_to_disk({"dbt_project.yml": "y", "models/gold/fct.sql": "select 2"}, clean_first=True)
    finally:
        kernel32.CloseHandle(handle)
    assert "locked" in warning and "seeds" in warning
    assert (project_dir / "models/gold/fct.sql").exists()   # the new project is still written


def test_paths_cannot_escape_the_project_folder(project_dir):
    cm._persist_files_to_disk({"../outside.sql": "select 1", "models/ok.sql": "select 2"}, clean_first=True)
    assert not (project_dir.parent / "outside.sql").exists()
    assert (project_dir / "models/ok.sql").exists()
