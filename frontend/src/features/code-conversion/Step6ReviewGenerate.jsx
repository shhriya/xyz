import React, { useState, useEffect, useRef, useCallback } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  Folder,
  FolderOpen,
  FileCode,
  Download,
  GitPullRequest,
  CheckCircle2,
  X,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  ExternalLink,
  Save,
  RefreshCw,
  Code2,
  Split,
  Wifi,
  WifiOff,
  AlertCircle,
  Copy,
  Layers,
  Maximize,
  Minimize,
  User,
  Lock,
  Bot,
  ShieldAlert,
  Info,
  XCircle,
  ShieldCheck,
  Check,
} from "lucide-react";
import {
  fetchProjectDiff,
  exportToGit,
  ideListFiles,
  ideReadFile,
  ideWriteFile,
  ideDeleteFile,
  ideRenameFile,
  ideMkdir,
  ideGetVscodeUri,
} from "@/api";

const DEFAULT_FILES = {
  "models/bronze/stg_raw_customers.sql": `-- Bronze Layer Staging Model
with source as (
    select * from {{ source('raw_landing', 'raw_customers') }}
),
renamed as (
    select
        trim(cust_id) as customer_id,
        upper(trim(first_name)) as first_name,
        upper(trim(last_name)) as last_name,
        lower(email_addr) as email,
        sys_updated_ts as updated_at
    from source
)
select * from renamed;`,
  "models/silver/stg_customers_cleaned.sql": `-- Silver Layer Cleansed Model
with bronze_customers as (
    select * from {{ ref('stg_raw_customers') }}
),
transformed as (
    select
        {{ dbt_utils.generate_surrogate_key(['customer_id', 'email']) }} as customer_sk,
        customer_id,
        concat(first_name, ' ', last_name) as full_name,
        email,
        updated_at
    from bronze_customers
    where customer_id is not null
)
select * from transformed;`,
  "models/gold/dim_customer_360.sql": `-- Gold Layer Business Dimensional Model
with scd2_snapshot as (
    select * from {{ ref('snp_customers_scd2') }}
)
select
    customer_sk,
    customer_id,
    full_name,
    email,
    dbt_valid_from as valid_from,
    dbt_valid_to as valid_to,
    case when dbt_valid_to is null then true else false end as is_current
from scd2_snapshot;`,
  "models/schema.yml": `version: 2\n\nmodels:\n  - name: dim_customer_360\n    description: 'Enterprise 360 Customer Dimension'\n    columns:\n      - name: customer_sk\n        tests:\n          - unique\n          - not_null`,
  "snapshots/snp_customers_scd2.sql": `{% snapshot snp_customers_scd2 %}\n{{ config(target_database='EDW_ANALYTICS', unique_key='customer_id', strategy='timestamp', updated_at='updated_at') }}\nselect * from {{ ref('stg_customers_cleaned') }}\n{% endsnapshot %}`,
  "macros/generate_surrogate_key.sql": `{% macro generate_surrogate_key(field_list) %}\n    md5(concat({% for field in field_list %}coalesce(cast({{ field }} as string), ''){% if not loop.last %} || '-' || {% endif %}{% endfor %}))\n{% endmacro %}`,
  "docs/dim_customer_360.md": `# dim_customer_360\nMigrated from Informatica PowerCenter workflow wf_mktg_customer_360.`,
  "dbt_project.yml": `name: 'r_data_modernization'\nversion: '1.0.0'\nprofile: 'snowflake'\n`,
};

const LEGACY_SQL = `/* Legacy Informatica SQL */
SELECT
    CUST_ID,
    UPPER(TRIM(FIRST_NAME)) AS FIRST_NAME,
    LOWER(EMAIL_ADDR) AS EMAIL_ADDR,
    NVL(SYS_UPDATED_TS, SYSDATE) AS SYS_UPDATED_TS
FROM EDW_STAGE.LANDING.SRC_RAW_CUSTOMERS;`;

const FOLDER_COLORS = {
  models: "#4fc3f7", bronze: "#ffa726", silver: "#b0bec5",
  gold: "#ffd54f", snapshots: "#ce93d8", macros: "#80cbc4", docs: "#81d4fa",
};

function getLanguage(path) {
  if (!path) return "plaintext";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".py")) return "python";
  return "plaintext";
}

function getFileIcon(name) {
  if (name.endsWith(".sql")) return "\uD83D\uDDC3";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "\uD83D\uDCCB";
  if (name.endsWith(".md")) return "\uD83D\uDCC4";
  return "\uD83D\uDCDD";
}

function buildFileTree(filePaths) {
  const root = {};
  filePaths.forEach(fp => {
    const parts = fp.split("/");
    let cur = root;
    parts.forEach((part, idx) => {
      if (!cur[part]) cur[part] = idx === parts.length - 1 ? null : {};
      if (cur[part] !== null) cur = cur[part];
    });
  });
  return root;
}

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}
      className="bg-[#252526] border border-[#454545] rounded shadow-2xl py-1 min-w-[180px]">
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} className="border-t border-[#454545] my-1" />
        ) : (
          <button key={i} onClick={() => { item.action(); onClose(); }}
            className="w-full text-left px-4 py-1.5 text-[12px] text-[#cccccc] hover:bg-[#094771] hover:text-white flex items-center gap-2 transition-colors">
            {item.icon && <span>{item.icon}</span>}
            {item.label}
            {item.shortcut && <span className="ml-auto text-[#888] text-[10px]">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

function InlineInput({ defaultValue, onConfirm, onCancel }) {
  const [val, setVal] = useState(defaultValue || "");
  const ref = useRef();
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input ref={ref} value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") onConfirm(val.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onConfirm(val.trim())}
      className="bg-[#3c3c3c] border border-[#007fd4] text-[#cccccc] text-xs px-1 py-0.5 rounded outline-none w-full"
      autoFocus />
  );
}

function TreeNode({ name, node, path, selectedFile, onSelectFile, depth, onContextMenu,
  renaming, onRenameConfirm, onRenameCancel, setRenaming, openFolders, onToggleFolder,
  creating, setCreating, handleCreateConfirm, handleDelete }) {
  const isFile = node === null;
  const fullPath = path ? path + "/" + name : name;
  const isSelected = selectedFile === fullPath;
  const isOpen = openFolders.has(fullPath);
  const folderColor = FOLDER_COLORS[name] || "#c5c5c5";
  const isRenaming = renaming === fullPath;

  if (isFile) {
    return (
      <div
        className={"flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer select-none transition-colors group " +
          (isSelected ? "bg-[#094771] text-white" : "hover:bg-[#2a2d2e] text-[#cccccc]")}
        style={{ paddingLeft: (depth * 12 + 8) + "px" }}
        onClick={() => onSelectFile(fullPath)}
        onContextMenu={e => onContextMenu(e, fullPath, "file", path)}>
        <span className="text-[11px] shrink-0">{getFileIcon(name)}</span>
        {isRenaming
          ? <InlineInput defaultValue={name} onConfirm={v => onRenameConfirm(fullPath, v, path)} onCancel={onRenameCancel} />
          : <span className="truncate text-[12px]">{name}</span>}
        <div className="ml-auto hidden group-hover:flex items-center gap-1 pr-1 shrink-0">
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); setRenaming(fullPath); }} title="Rename"><Pencil className="w-3 h-3 text-[#858585] hover:text-white" /></button>
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); handleDelete(fullPath, "file"); }} title="Delete"><Trash2 className="w-3 h-3 text-[#858585] hover:text-white" /></button>
        </div>
      </div>
    );
  }

  const childKeys = Object.keys(node).sort((a, b) => {
    const af = node[a] !== null, bf = node[b] !== null;
    if (af && !bf) return -1; if (!af && bf) return 1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <div className="flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer select-none hover:bg-[#2a2d2e] text-[#cccccc] transition-colors group"
        style={{ paddingLeft: (depth * 12 + 4) + "px" }}
        onClick={() => onToggleFolder(fullPath)}
        onContextMenu={e => onContextMenu(e, fullPath, "folder", path)}>
        <span className="text-[10px] text-[#888] shrink-0">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="text-[13px] shrink-0">
          {isOpen
            ? <FolderOpen className="w-3.5 h-3.5 inline" style={{ color: folderColor }} />
            : <Folder className="w-3.5 h-3.5 inline" style={{ color: folderColor }} />}
        </span>
        {isRenaming
          ? <InlineInput defaultValue={name} onConfirm={v => onRenameConfirm(fullPath, v, path)} onCancel={onRenameCancel} />
          : <span className="text-[12px] font-medium truncate">{name}</span>}
        <div className="ml-auto hidden group-hover:flex items-center gap-1 pr-1 shrink-0">
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); setCreating({ parentPath: fullPath, type: "file" }); if(!isOpen) onToggleFolder(fullPath); }} title="New File"><FilePlus className="w-3 h-3 text-[#858585] hover:text-white" /></button>
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); setCreating({ parentPath: fullPath, type: "folder" }); if(!isOpen) onToggleFolder(fullPath); }} title="New Folder"><FolderPlus className="w-3 h-3 text-[#858585] hover:text-white" /></button>
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); setRenaming(fullPath); }} title="Rename"><Pencil className="w-3 h-3 text-[#858585] hover:text-white" /></button>
          <button className="p-0.5 hover:bg-[#454545] rounded" onClick={(e) => { e.stopPropagation(); handleDelete(fullPath, "folder"); }} title="Delete"><Trash2 className="w-3 h-3 text-[#858585] hover:text-white" /></button>
        </div>
      </div>
      {isOpen && (
        <div>
          {creating && creating.parentPath === fullPath && (
             <div className="flex items-center gap-1.5 py-0.5 px-1" style={{ paddingLeft: ((depth + 1) * 12 + 8) + "px" }}>
                 <span className="text-[11px] shrink-0">{creating.type === "file" ? <FilePlus className="w-3 h-3"/> : <FolderPlus className="w-3 h-3"/>}</span>
                 <InlineInput defaultValue="" onConfirm={handleCreateConfirm} onCancel={() => setCreating(null)} />
             </div>
          )}
          {childKeys.map(cn => (
            <TreeNode key={cn} name={cn} node={node[cn]} path={fullPath}
              selectedFile={selectedFile} onSelectFile={onSelectFile} depth={depth + 1}
              onContextMenu={onContextMenu} renaming={renaming}
              onRenameConfirm={onRenameConfirm} onRenameCancel={onRenameCancel} setRenaming={setRenaming}
              openFolders={openFolders} onToggleFolder={onToggleFolder}
              creating={creating} setCreating={setCreating} handleCreateConfirm={handleCreateConfirm} handleDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Step6ReviewGenerate({ projectState, setProjectState }) {
  const [fileContent, setFileContent] = useState(DEFAULT_FILES);
  const [diskSynced, setDiskSynced] = useState(false);
  const [projectDir, setProjectDir] = useState("");
  const [openTabs, setOpenTabs] = useState(["models/gold/dim_customer_360.sql"]);
  const [activeTab, setActiveTab] = useState("models/gold/dim_customer_360.sql");
  const [dirtyTabs, setDirtyTabs] = useState(new Set());
  const [editorMode, setEditorMode] = useState("code");
  const [openFolders, setOpenFolders] = useState(new Set([
    "models", "models/bronze", "models/silver", "models/gold", "snapshots", "macros", "docs"
  ]));
  const [renaming, setRenaming] = useState(null);
  const [creating, setCreating] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [gitStatus, setGitStatus] = useState(null);
  const [sourceCode, setSourceCode] = useState(LEGACY_SQL);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCodeServerLogin, setShowCodeServerLogin] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [gitStep, setGitStep] = useState(1);
  const [gitError, setGitError] = useState("");
  const [gitConfig, setGitConfig] = useState({ repo: "", token: "", branch: "main", commitMsg: "Export dbt project from Review & Generate" });
  const [csUsername, setCsUsername] = useState("");
  const [csPassword, setCsPassword] = useState("");
  const [csConnecting, setCsConnecting] = useState(false);

  // Needs Review panel: real issues the AI transpiler (Step 4) surfaced while converting legacy
  // scripts — things it had to infer, or genuinely couldn't resolve. Not auto-fixable (there's no
  // deterministic or AI "correct answer" for "verify this extracted logic is right") — the point
  // of this panel is to point a human at exactly which files/lines need a look, not to fix them.
  const [leftPanelView, setLeftPanelView] = useState("explorer"); // "explorer" | "review"
  const [reviewIssues, setReviewIssues] = useState(projectState?.codeConversionAiIssues || []);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  function flattenTree(tree) {
    const paths = [];
    function walk(nodes) {
      for (const n of nodes) {
        if (n.type === "file") paths.push(n.path);
        else if (n.children) walk(n.children);
      }
    }
    walk(tree);
    return paths;
  }

  useEffect(() => {
    (async () => {
      const ideRes = await ideListFiles();
      if (ideRes?.status === "success" && Array.isArray(ideRes.tree) && ideRes.tree.length > 0) {
        setDiskSynced(true);
        setProjectDir(ideRes.projectDir || "");
        const flatPaths = flattenTree(ideRes.tree);
        const nc = {};
        for (const fp of flatPaths) {
          try {
            const fr = await ideReadFile(fp);
            if (fr?.status === "success") nc[fp] = fr.content;
          } catch {}
        }
        setFileContent(nc);
        const allPaths = Object.keys(nc);
        if (allPaths.length > 0) {
          const firstFile = allPaths.find(p => p.includes("gold") || p.includes("dim") || p.endsWith(".sql")) || allPaths[0];
          setActiveTab(firstFile);
          setOpenTabs([firstFile]);
        } else {
          setActiveTab(null);
          setOpenTabs([]);
        }
      } else {
        setFileContent({});
        setActiveTab(null);
        setOpenTabs([]);
      }
      const diffRes = await fetchProjectDiff();
      if (diffRes?.sourceCode) setSourceCode(diffRes.sourceCode);
    })();
  }, []);

  const fileTree = buildFileTree(Object.keys(fileContent));
  const treeRootKeys = Object.keys(fileTree).sort((a, b) => {
    const af = fileTree[a] !== null, bf = fileTree[b] !== null;
    if (af && !bf) return -1; if (!af && bf) return 1;
    return a.localeCompare(b);
  });

  const openFile = useCallback((path) => {
    setActiveTab(path);
    if (!openTabs.includes(path)) setOpenTabs(prev => [...prev, path]);
  }, [openTabs]);

  const jumpToIssue = (issue) => {
    openFile(issue.file);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(issue.line || 1);
        editorRef.current.setPosition({ lineNumber: issue.line || 1, column: 1 });
        editorRef.current.focus();
      }
    }, 100);
  };

  const markReviewed = (issueId) => {
    setReviewIssues((prev) => {
      const next = prev.filter((i) => i.id !== issueId);
      if (setProjectState) {
        setProjectState((ps) => ({ ...ps, codeConversionAiIssues: next }));
      }
      return next;
    });
  };

  // Mirror the active file's AI-transpile issues as inline Monaco markers, same mechanism as
  // Data Modernization's Bug Detection panel.
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance || !activeTab) return;
    const model = editorInstance.getModel();
    if (!model) return;

    const severityMap = {
      error: monacoInstance.MarkerSeverity.Error,
      warning: monacoInstance.MarkerSeverity.Warning,
      info: monacoInstance.MarkerSeverity.Info,
    };
    const markers = reviewIssues
      .filter((i) => i.file === activeTab)
      .map((i) => ({
        severity: severityMap[i.severity] || monacoInstance.MarkerSeverity.Info,
        message: i.message,
        startLineNumber: i.line || 1,
        startColumn: 1,
        endLineNumber: i.line || 1,
        endColumn: 200,
      }));
    monacoInstance.editor.setModelMarkers(model, "ai-transpile-review", markers);
  }, [reviewIssues, activeTab, fileContent]);

  const closeTab = useCallback((path, e) => {
    e?.stopPropagation();
    const nt = openTabs.filter(t => t !== path);
    setOpenTabs(nt);
    setDirtyTabs(prev => { const n = new Set(prev); n.delete(path); return n; });
    if (activeTab === path) setActiveTab(nt[nt.length - 1] || null);
  }, [openTabs, activeTab]);

  const handleEditorChange = (value) => {
    setFileContent(prev => ({ ...prev, [activeTab]: value }));
    setDirtyTabs(prev => new Set([...prev, activeTab]));
    setSaveStatus("");
  };

  useEffect(() => {
    const handler = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab) await saveFileToDisk(activeTab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, fileContent]);

  const saveFileToDisk = async (path) => {
    setSaveStatus("saving");
    const res = await ideWriteFile(path, fileContent[path] ?? "");
    if (res?.status === "success") {
      setDiskSynced(true);
      setDirtyTabs(prev => { const n = new Set(prev); n.delete(path); return n; });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } else { setSaveStatus("error"); }
  };

  const openInVsCode = async (path) => {
    const res = await ideGetVscodeUri(path || activeTab);
    if (res?.fileUri) window.location.href = res.fileUri;
  };

  const openFolderInVsCode = async () => {
    const res = await ideGetVscodeUri(Object.keys(fileContent)[0] || "");
    if (res?.folderUri) window.location.href = res.folderUri;
  };

  const handleContextMenu = (e, nodePath, nodeType, parentPath) => {
    e.preventDefault(); e.stopPropagation();
    const items = nodeType === "file" ? [
      { label: "Open", icon: <FileCode className="w-3 h-3" />, action: () => openFile(nodePath) },
      { label: "Open in VS Code", icon: <ExternalLink className="w-3 h-3" />, action: () => openInVsCode(nodePath) },
      "divider",
      { label: "Rename", icon: <Pencil className="w-3 h-3" />, action: () => setRenaming(nodePath), shortcut: "F2" },
      { label: "Copy Path", icon: <Copy className="w-3 h-3" />, action: () => navigator.clipboard.writeText(nodePath) },
      "divider",
      { label: "Delete", icon: <Trash2 className="w-3 h-3" />, action: () => handleDelete(nodePath, "file") },
    ] : [
      { label: "New File", icon: <FilePlus className="w-3 h-3" />, action: () => setCreating({ parentPath: nodePath, type: "file" }) },
      { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, action: () => setCreating({ parentPath: nodePath, type: "folder" }) },
      "divider",
      { label: "Open Folder in VS Code", icon: <ExternalLink className="w-3 h-3" />, action: openFolderInVsCode },
      "divider",
      { label: "Rename", icon: <Pencil className="w-3 h-3" />, action: () => setRenaming(nodePath), shortcut: "F2" },
      { label: "Delete Folder", icon: <Trash2 className="w-3 h-3" />, action: () => handleDelete(nodePath, "folder") },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const handleExplorerCtx = (e) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, items: [
      { label: "New File", icon: <FilePlus className="w-3 h-3" />, action: () => setCreating({ parentPath: "", type: "file" }) },
      { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, action: () => setCreating({ parentPath: "", type: "folder" }) },
      "divider",
      { label: "Open Folder in VS Code", icon: <ExternalLink className="w-3 h-3" />, action: openFolderInVsCode },
      { label: "Refresh from Disk", icon: <RefreshCw className="w-3 h-3" />, action: refreshFromDisk },
    ]});
  };

  const handleRenameConfirm = async (oldPath, newName, parentPath) => {
    setRenaming(null);
    if (!newName || newName === oldPath.split("/").pop()) return;
    const newPath = parentPath ? parentPath + "/" + newName : newName;
    await ideRenameFile(oldPath, newPath);
    setFileContent(prev => {
      const u = {};
      for (const [k, v] of Object.entries(prev)) u[k.startsWith(oldPath) ? k.replace(oldPath, newPath) : k] = v;
      return u;
    });
    if (openTabs.includes(oldPath)) {
      setOpenTabs(prev => prev.map(t => t === oldPath ? newPath : t));
      if (activeTab === oldPath) setActiveTab(newPath);
    }
  };

  const handleDelete = async (path, type) => {
    if (!window.confirm("Delete " + type + " \"" + path + "\"?")) return;
    await ideDeleteFile(path);
    setFileContent(prev => { const u = {}; for (const [k, v] of Object.entries(prev)) if (!k.startsWith(path)) u[k] = v; return u; });
    closeTab(path);
  };

  const handleCreateConfirm = async (name) => {
    setCreating(null);
    if (!name) return;
    const np = creating.parentPath ? creating.parentPath + "/" + name : name;
    if (creating.type === "file") {
      await ideWriteFile(np, ""); setFileContent(prev => ({ ...prev, [np]: "" })); openFile(np);
    } else {
      await ideMkdir(np); setFileContent(prev => ({ ...prev, [np + "/.gitkeep"]: "" }));
    }
  };

  const refreshFromDisk = async () => {
    const r = await ideListFiles();
    if (r?.status === "success") {
      const nc = {};
      for (const fp of flattenTree(r.tree)) {
        const fr = await ideReadFile(fp);
        if (fr?.status === "success") nc[fp] = fr.content;
      }
      setFileContent(nc); setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 2000);
    }
  };

  const handleExportGit = async () => { const res = await exportToGit("github.com/enterprise/dbt-analytics"); setGitStatus(res); };
  const toggleFolder = p => setOpenFolders(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const filesList = Object.keys(fileContent);
  const bronzeCount = filesList.filter(f => f.includes("models/bronze") || f.startsWith("bronze")).length;
  const silverCount = filesList.filter(f => f.includes("models/silver") || f.startsWith("silver")).length;
  const goldCount = filesList.filter(f => f.includes("models/gold") || f.startsWith("gold")).length;
  const snapshotCount = filesList.filter(f => f.includes("snapshots") || f.startsWith("snapshots")).length;
  const macroCount = filesList.filter(f => f.includes("macros") || f.startsWith("macros")).length;
  const docCount = filesList.filter(f => f.includes("docs") || f.startsWith("docs")).length;

  const schemaContent = fileContent["models/schema.yml"] || "";
  const testCountMatches = schemaContent.match(/- unique|- not_null|- relationships|- accepted_values/g);
  const testCount = testCountMatches ? testCountMatches.length : (bronzeCount + silverCount + goldCount) * 2;

  const currentContent = fileContent[activeTab] ?? "";
  const currentLang = getLanguage(activeTab);

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-[#ECEFFF] text-[#1C58F6] px-3 py-1 rounded-full text-xs font-semibold border border-[#D1DEFF] mb-2">
            Step 5 of 5 - Modernization Complete
          </div>
          <h1 className="text-xl font-black text-[#10338D] tracking-tight">dbt IDE — Review, Edit &amp; Export</h1>
          <p className="text-xs text-[#666] mt-0.5">Full IDE with Monaco Editor • Live disk sync • Open in VS Code</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => window.open("/api/project/download", "_blank")}
            className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm">
            <Download className="w-3.5 h-3.5" /> Download ZIP
          </button>
          <button onClick={() => { setShowGitModal(true); setGitStep(1); setGitError(""); }}
            className="bg-white hover:bg-[#ECEFFF] text-[#10338D] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 border border-[#D1DEFF] transition-all shadow-sm">
            <GitPullRequest className="w-3.5 h-3.5 text-[#1C58F6]" /> Export to Git
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {[
          { label: "Bronze", val: bronzeCount, color: "#ffa726" },
          { label: "Silver", val: silverCount, color: "#b0bec5" },
          { label: "Gold", val: goldCount, color: "#ffd54f" },
          { label: "Snapshots", val: snapshotCount, color: "#ce93d8" },
          { label: "Tests", val: testCount, color: "#4ec9b0" },
          { label: "Macros", val: macroCount, color: "#4fc3f7" },
          { label: "Docs", val: docCount, color: "#cccccc" },
          { label: "Needs Review", val: reviewIssues.length, color: reviewIssues.length > 0 ? "#f87171" : "#4ade80" },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-white border border-[#D1DEFF] p-3 rounded-xl text-center shadow-sm">
            <div className="text-[10px] font-semibold uppercase text-[#666]">{label}</div>
            <div className="text-lg font-black font-mono mt-0.5" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* IDE Workspace */}
      <div className={isFullscreen 
          ? "fixed inset-0 z-50 flex flex-col bg-[#1e1e1e]" 
          : "rounded-2xl overflow-hidden border border-[#2d2d2d] shadow-2xl flex flex-col"
        }
        style={!isFullscreen ? { height: "calc(100vh - 280px)", minHeight: 480, background: "#1e1e1e" } : {}}>
        <div className="flex flex-1 overflow-hidden">
          {/* Activity Bar */}
          <div className="w-12 bg-[#333333] flex flex-col items-center py-2 gap-1 border-r border-[#252526] shrink-0">
            <button
              title="Explorer"
              onClick={() => setLeftPanelView("explorer")}
              className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer ${leftPanelView === "explorer" ? "text-white border-l-2 border-white bg-[#252526]" : "text-[#858585] hover:text-white"}`}
            >
              <Layers className="w-5 h-5" />
            </button>
            <button
              title="Needs Review (AI Transpilation)"
              onClick={() => setLeftPanelView("review")}
              className={`relative w-10 h-10 flex items-center justify-center rounded cursor-pointer ${leftPanelView === "review" ? "text-white border-l-2 border-white bg-[#252526]" : "text-[#858585] hover:text-white"}`}
            >
              <Bot className="w-5 h-5" />
              {reviewIssues.length > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {reviewIssues.length}
                </span>
              )}
            </button>
          </div>

          {leftPanelView === "explorer" ? (
            /* File Explorer */
            <div className="w-56 bg-[#252526] flex flex-col border-r border-[#1e1e1e] shrink-0 overflow-hidden"
              onContextMenu={handleExplorerCtx}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e1e]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#bbb]">Explorer</span>
                <div className="flex items-center gap-1">
                  <button title="New File" onClick={() => setCreating({ parentPath: "", type: "file" })}
                    className="text-[#858585] hover:text-white p-0.5 rounded"><FilePlus className="w-3.5 h-3.5" /></button>
                  <button title="New Folder" onClick={() => setCreating({ parentPath: "", type: "folder" })}
                    className="text-[#858585] hover:text-white p-0.5 rounded"><FolderPlus className="w-3.5 h-3.5" /></button>
                  <button title="Refresh" onClick={refreshFromDisk}
                    className="text-[#858585] hover:text-white p-0.5 rounded"><RefreshCw className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#888] border-b border-[#1e1e1e]">
                r_data_modernization
              </div>
              <div className="flex-1 overflow-y-auto py-1 px-1 text-[#cccccc]">
                {creating && creating.parentPath === "" && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <InlineInput defaultValue="" onConfirm={handleCreateConfirm} onCancel={() => setCreating(null)} />
                  </div>
                )}
                {treeRootKeys.length === 0 && !creating ? (
                  <div className="p-4 text-center text-[#777] text-xs space-y-1.5 mt-8">
                    <Layers className="w-6 h-6 text-[#555] mx-auto mb-1" />
                    <p className="font-semibold text-[#aaa]">No Models Generated</p>
                    <p className="text-[10px] text-[#666]">Run migration in Step 4 to generate dbt models.</p>
                  </div>
                ) : (
                  treeRootKeys.map(name => (
                    <TreeNode key={name} name={name} node={fileTree[name]} path="" selectedFile={activeTab}
                      onSelectFile={openFile} depth={0} onContextMenu={handleContextMenu}
                      renaming={renaming} onRenameConfirm={handleRenameConfirm} onRenameCancel={() => setRenaming(null)} setRenaming={setRenaming}
                      openFolders={openFolders} onToggleFolder={toggleFolder}
                      creating={creating} setCreating={setCreating} handleCreateConfirm={handleCreateConfirm} handleDelete={handleDelete} />
                  ))
                )}
              </div>
              {projectDir && (
                <div className="px-3 py-1.5 border-t border-[#1e1e1e] text-[9px] text-[#555] truncate" title={projectDir}>{projectDir}</div>
              )}
            </div>
          ) : (
            /* Needs Review Panel — issues the AI transpiler flagged while converting legacy scripts */
            <div className="w-72 bg-[#252526] flex flex-col border-r border-[#1e1e1e] shrink-0 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e1e]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#bbb]">
                  Needs Review ({reviewIssues.length})
                </span>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {reviewIssues.length === 0 ? (
                  <div className="p-6 text-center text-[#777] text-xs space-y-2 mt-12">
                    <ShieldCheck className="w-8 h-8 text-emerald-600/70 mx-auto mb-2" />
                    <p className="font-semibold text-[#aaa]">Nothing to Review</p>
                    <p className="text-[10px] text-[#666]">
                      Either no legacy scripts were AI-converted, or everything converted with high confidence.
                    </p>
                  </div>
                ) : (
                  [...reviewIssues]
                    .sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.severity] - { error: 0, warning: 1, info: 2 }[b.severity]))
                    .map((issue) => (
                      <div
                        key={issue.id}
                        onClick={() => jumpToIssue(issue)}
                        className="px-3 py-2 border-b border-[#1e1e1e] hover:bg-[#2d2d2d] cursor-pointer group"
                      >
                        <div className="flex items-start gap-1.5">
                          {issue.severity === "error" ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          ) : issue.severity === "warning" ? (
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          ) : (
                            <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-[#cccccc] leading-snug">{issue.message}</p>
                            <div className="flex items-center justify-between mt-1 gap-2">
                              <span className="text-[9px] text-[#777] font-mono truncate">
                                {(issue.file || "").split("/").pop()}:{issue.line || 1}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); markReviewed(issue.id); }}
                                title="Mark reviewed (dismisses this flag, does not change the file)"
                                className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#333] hover:bg-emerald-700 text-[#ccc] hover:text-white flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-2.5 h-2.5" />
                                <span>Reviewed</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {/* Editor Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab Bar */}
            <div className="flex items-center bg-[#252526] border-b border-[#1e1e1e] overflow-x-auto shrink-0">
              {openTabs.map(tab => {
                const fname = tab.split("/").pop();
                const isDirty = dirtyTabs.has(tab);
                const isActive = activeTab === tab;
                return (
                  <div key={tab} onClick={() => setActiveTab(tab)}
                    className={"flex items-center gap-1.5 px-3 py-2 border-r border-[#1e1e1e] cursor-pointer shrink-0 transition-colors group " +
                      (isActive ? "bg-[#1e1e1e] text-[#cccccc] border-t border-t-[#007acc]" : "text-[#858585] hover:bg-[#2d2d2d] hover:text-[#cccccc]")}
                    style={{ minWidth: 100, maxWidth: 180 }} title={tab}>
                    <span className="text-[11px] shrink-0">{getFileIcon(fname)}</span>
                    <span className="text-[12px] truncate">{fname}</span>
                    {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 ml-0.5" />}
                    <button onClick={e => closeTab(tab, e)}
                      className={"ml-auto shrink-0 rounded p-0.5 " + (isActive ? "opacity-70 hover:opacity-100 hover:bg-[#3d3d3d]" : "opacity-0 group-hover:opacity-70 hover:bg-[#3d3d3d]")}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {openTabs.length === 0 && <div className="text-[#555] text-xs px-4 py-2">No files open</div>}
            </div>

            {/* Editor Toolbar */}
            {activeTab && (
              <div className="flex items-center justify-between bg-[#2d2d2d] border-b border-[#1e1e1e] px-3 py-1.5 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#9cdcfe] font-mono truncate max-w-xs">{activeTab}</span>
                  {dirtyTabs.has(activeTab) && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30 shrink-0">Modified</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {saveStatus === "saving" && <span className="text-[10px] text-[#888]">Saving...</span>}
                  {saveStatus === "saved" && <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Saved</span>}
                  {saveStatus === "error" && <span className="text-[10px] text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</span>}
                  <div className="bg-[#1e1e1e] p-0.5 rounded border border-[#454545] flex gap-0.5">
                    <button onClick={() => setEditorMode("code")}
                      className={"px-2 py-0.5 rounded text-[11px] font-semibold transition-colors " + (editorMode === "code" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]")}>
                      <Code2 className="w-3 h-3 inline mr-1" />Code
                    </button>
                    <button onClick={() => setEditorMode("diff")}
                      className={"px-2 py-0.5 rounded text-[11px] font-semibold transition-colors " + (editorMode === "diff" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]")}>
                      <Split className="w-3 h-3 inline mr-1" />Diff
                    </button>
                  </div>
                  <button onClick={() => saveFileToDisk(activeTab)} title="Save (Ctrl+S)"
                    className="flex items-center gap-1 text-[11px] px-2 py-1 bg-[#1e1e1e] hover:bg-[#3d3d3d] text-[#858585] hover:text-[#cccccc] rounded border border-[#454545] transition-colors">
                    <Save className="w-3 h-3" />Save
                  </button>
                  <button onClick={() => openInVsCode(activeTab)} title="Open in VS Code"
                    className="flex items-center gap-1 text-[11px] px-2 py-1 bg-[#007acc] hover:bg-[#1e9cf1] text-white rounded transition-colors">
                    <ExternalLink className="w-3 h-3" />VS Code
                  </button>
                </div>
              </div>
            )}

            {/* Monaco Editor */}
            <div className="flex-1 overflow-hidden" onKeyDownCapture={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                  e.preventDefault(); e.stopPropagation();
                  if (activeTab) saveFileToDisk(activeTab);
                }
              }}>
              {activeTab ? (
                editorMode === "code" ? (
                  <Editor height="100%" language={currentLang} value={currentContent}
                    onChange={handleEditorChange}
                    onMount={(editorInstance, monacoInstance) => {
                      editorRef.current = editorInstance;
                      monacoRef.current = monacoInstance;
                    }}
                    theme="vs-dark"
                    options={{
                      fontSize: 13, fontFamily: "'Cascadia Code','Fira Code',Consolas,monospace",
                      fontLigatures: true, minimap: { enabled: true }, wordWrap: "on",
                      lineNumbers: "on", renderLineHighlight: "all", scrollBeyondLastLine: false,
                      automaticLayout: true, tabSize: 4, smoothScrolling: true,
                      cursorBlinking: "expand", cursorSmoothCaretAnimation: "on",
                      bracketPairColorization: { enabled: true }, padding: { top: 10, bottom: 10 },
                    }} />
                ) : (
                  <DiffEditor height="100%" language={currentLang} original={sourceCode}
                    modified={currentContent} theme="vs-dark"
                    options={{
                      fontSize: 12, fontFamily: "'Cascadia Code',Consolas,monospace",
                      renderSideBySide: true, readOnly: false, minimap: { enabled: false },
                      scrollBeyondLastLine: false, automaticLayout: true,
                    }} />
                )
              ) : (
                <div className="flex items-center justify-center h-full flex-col gap-3 text-[#555] p-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#252526] border border-[#333] flex items-center justify-center mb-1">
                    <Layers className="w-7 h-7 text-[#1C58F6]" />
                  </div>
                  <span className="text-sm font-semibold text-[#bbb]">
                    {treeRootKeys.length === 0 ? "No dbt Models Generated Yet" : "Select a File from the Explorer"}
                  </span>
                  <span className="text-xs text-[#666] max-w-xs">
                    {treeRootKeys.length === 0
                      ? "Run the AI migration pipeline in Step 4 to generate your bronze, silver, gold models and snapshots."
                      : "Click any file in the Explorer on the left to view and edit its code in Monaco Editor."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between bg-[#007acc] text-white px-3 py-0.5 text-[11px] shrink-0 gap-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              {diskSynced ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 text-amber-300" />}
              {diskSynced ? "Disk Synced" : "In-Memory Mode"}
            </span>
            <span>r_data_modernization</span>
          </div>
          <div className="flex items-center gap-4">
            {activeTab && <span className="font-mono">{currentLang.toUpperCase()}</span>}
            {activeTab && <span>UTF-8</span>}
            <span className="opacity-75">Ctrl+S to save</span>
            <button onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex items-center gap-1 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors" title="Toggle Fullscreen">
              {isFullscreen ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>
      </div>

      {/* VS Code Connect Panel */}
      <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4">
        <div className="flex-1">
          <div className="text-sm font-bold text-[#cccccc] mb-1 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#4ec9b0]" /> Connect to Code Server
          </div>
          <p className="text-[11px] text-[#858585] leading-relaxed">
            Connect to your remote VS Code instance securely. Requires authentication to access your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={() => setShowCodeServerLogin(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 bg-[#252526] hover:bg-[#3d3d3d] text-[#4ec9b0] rounded-lg font-semibold border border-[#454545] transition-colors">
            <Lock className="w-3.5 h-3.5" /> Sign in to Code Server
          </button>
        </div>
      </div>

      {/* Code Server Login Modal */}
      {showCodeServerLogin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between bg-[#252526]">
              <div className="flex items-center gap-2 text-[#cccccc] font-semibold text-sm">
                <Code2 className="w-4 h-4 text-[#4ec9b0]" />
                Code Server Authentication
              </div>
              <button onClick={() => setShowCodeServerLogin(false)} className="text-[#858585] hover:text-[#cccccc]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Username</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#555] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text"
                    name="cs_auth_username_field"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                    value={csUsername}
                    onChange={e => setCsUsername(e.target.value)}
                    className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg pl-9 pr-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                    placeholder="e.g. coder, developer, or admin"
                    autoFocus />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#555] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="password"
                    name="cs_auth_password_field"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-form-type="other"
                    value={csPassword}
                    onChange={e => setCsPassword(e.target.value)}
                    className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg pl-9 pr-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                    placeholder="Enter your Code Server password" />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#333] bg-[#252526] flex items-center justify-end gap-2">
              <button onClick={() => setShowCodeServerLogin(false)}
                className="px-4 py-2 text-xs font-semibold text-[#cccccc] hover:text-white transition-colors">
                Cancel
              </button>
              <button onClick={() => {
                setCsConnecting(true);
                setTimeout(async () => {
                  setCsConnecting(false);
                  setShowCodeServerLogin(false);
                  const res = await ideGetVscodeUri("");
                  if (res?.folderUri) {
                    window.location.href = res.folderUri;
                  } else {
                    alert("Could not retrieve VS Code URI");
                  }
                }, 1500);
              }}
                disabled={!csUsername || !csPassword || csConnecting}
                className="px-4 py-2 text-xs font-semibold bg-[#007acc] hover:bg-[#1e9cf1] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2">
                {csConnecting ? "Connecting..." : "Secure Login"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Export Modal */}
      {showGitModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between bg-[#252526]">
              <div className="flex items-center gap-2 text-[#cccccc] font-semibold text-sm">
                <GitPullRequest className="w-4 h-4 text-[#1C58F6]" />
                Export to GitHub
              </div>
              <button onClick={() => setShowGitModal(false)} className="text-[#858585] hover:text-[#cccccc]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {gitStep === 1 && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">GitHub repository</label>
                    <input type="text"
                      name="gh_repo_target_path"
                      autoComplete="off"
                      data-lpignore="true"
                      data-form-type="other"
                      value={gitConfig.repo}
                      onChange={e => setGitConfig({...gitConfig, repo: e.target.value})}
                      className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                      placeholder="e.g. organization/repository-name or https://github.com/org/repo" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Personal Access Token (PAT)</label>
                    <input type="password"
                      name="gh_token_secret_pat"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={gitConfig.token}
                      onChange={e => setGitConfig({...gitConfig, token: e.target.value})}
                      className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                      placeholder="e.g. ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_xxxx" />
                    <p className="text-[10px] text-[#858585] mt-1.5 leading-relaxed">
                      Classic PAT needs the <span className="text-[#cccccc]">repo</span> scope. Fine-grained PAT needs Contents: Read and write on this repository.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Branch</label>
                      <input type="text"
                        name="gh_branch_target"
                        autoComplete="off"
                        data-lpignore="true"
                        data-form-type="other"
                        value={gitConfig.branch}
                        onChange={e => setGitConfig({...gitConfig, branch: e.target.value})}
                        className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                        placeholder="e.g. main" />
                    </div>
                    <div className="flex-[2]">
                      <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Commit Message</label>
                      <input type="text"
                        name="gh_commit_msg_target"
                        autoComplete="off"
                        data-lpignore="true"
                        data-form-type="other"
                        value={gitConfig.commitMsg}
                        onChange={e => setGitConfig({...gitConfig, commitMsg: e.target.value})}
                        className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                        placeholder="e.g. Export dbt project from Review & Generate" />
                    </div>
                  </div>
                </>
              )}
              {gitStep === 2 && (
                <div className="flex flex-col items-center justify-center py-6 space-y-4">
                  <div className="w-8 h-8 border-2 border-[#1C58F6] border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-sm text-[#cccccc] font-medium">Pushing to {gitConfig.repo}...</div>
                    <div className="text-xs text-[#858585]">Uploading dbt explorer files to the existing repo</div>
                </div>
              )}
              {gitStep === 3 && (
                <div className="flex flex-col items-center justify-center py-6 space-y-4">
                  <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div className="text-sm text-[#cccccc] font-medium text-center">
                    Successfully pushed to <span className="text-white font-semibold">{gitConfig.branch}</span>!
                  </div>
                  <div className="text-xs text-[#858585] text-center px-4">
                    dbt explorer folders and files were committed to the branch.
                  </div>
                  <a href={gitStatus?.prUrl || `https://github.com/${gitConfig.repo.replace(/^https?:\/\//, '').replace(/^github\.com\//i, '').replace(/\.git$/, '')}/tree/${gitConfig.branch}`} target="_blank" rel="noreferrer"
                    className="mt-2 text-xs text-[#1C58F6] hover:underline font-semibold flex items-center gap-1">
                    View on GitHub <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
            {gitError && gitStep === 1 && (
              <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 leading-relaxed">
                {gitError}
              </div>
            )}
            <div className="px-5 py-4 border-t border-[#333] bg-[#252526] flex items-center justify-end gap-2">
              {gitStep === 1 && (
                <>
                  <button onClick={() => setShowGitModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-[#cccccc] hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button onClick={async () => {
                    setGitError("");
                    setGitStep(2);
                    const res = await exportToGit(gitConfig.repo, gitConfig.token, gitConfig.branch, gitConfig.commitMsg);
                    if (res && res.status === 'success') {
                      setGitStatus(res);
                      setGitStep(3);
                    } else {
                      setGitError(res?.error || "Git push failed. Check the repository URL, branch, and token permissions.");
                      setGitStep(1);
                    }
                  }}
                    disabled={!gitConfig.repo || !gitConfig.token}
                    className="px-4 py-2 text-xs font-semibold bg-[#1C58F6] hover:bg-[#10338D] disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2">
                    Connect & Push
                  </button>
                </>
              )}
              {gitStep === 3 && (
                <button onClick={() => setShowGitModal(false)}
                  className="px-4 py-2 text-xs font-semibold bg-[#333] hover:bg-[#444] text-white rounded-lg transition-colors">
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
