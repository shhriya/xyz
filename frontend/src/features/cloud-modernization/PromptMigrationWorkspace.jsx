import React, { useState, useEffect, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";
import {
  Sparkles,
  Folder,
  FolderOpen,
  FileCode,
  Download,
  CheckCircle2,
  X,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Save,
  RefreshCw,
  Code2,
  AlertCircle,
  Layers,
  Maximize,
  Minimize,
  Sliders,
  Database,
  Check,
  Zap,
  ArrowRight,
  Loader2,
  Brain,
  ExternalLink,
  GitPullRequest,
  User,
  Lock,
  Cpu,
  DollarSign,
  UploadCloud,
  Table2,
  ListChecks,
  Plug,
  Wand2,
  MessageSquare,
  Plus,
  RotateCcw
} from "lucide-react";
import {
  generateDbtFromPrompt,
  importDbtFromGit,
  importDbtFromLocalFolder,
  cloudModExportToGit,
  cloudModGetVscodeUri,
  cloudModSyncProject,
  cloudModSaveFile,
  cloudModDeleteFile,
  testCloudModConnection,
  schemaGetDatabases,
  schemaGetSchemas,
  schemaGetTables,
  schemaGetColumns,
  schemaUploadFile,
  sideChatPropose,
} from "@/api";
import PromptOptimizerButton from "@/components/PromptOptimizerButton";
import InlineReviewPanel from "./InlineReviewPanel";
import SideChatPanel from "./SideChatPanel";

const FOLDER_COLORS = {
  models: "#4fc3f7",
  bronze: "#ffa726",
  silver: "#b0bec5",
  gold: "#ffd54f",
  snapshots: "#ce93d8",
  macros: "#80cbc4",
  docs: "#81d4fa",
  tests: "#4ec9b0",
  staging: "#ffa726",
  intermediate: "#b0bec5",
  marts: "#ffd54f"
};

function getLanguage(path) {
  if (!path) return "plaintext";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}

function getFileIcon(name) {
  if (name.endsWith(".sql")) return "📄";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "📋";
  if (name.endsWith(".md")) return "📝";
  return "📃";
}

function buildFileTree(filePaths) {
  const root = {};
  filePaths.forEach((fp) => {
    const parts = fp.split("/");
    let cur = root;
    parts.forEach((part, idx) => {
      if (!cur[part]) cur[part] = idx === parts.length - 1 ? null : {};
      if (cur[part] !== null) cur = cur[part];
    });
  });
  return root;
}

function InlineInput({ defaultValue, onConfirm, onCancel }) {
  const [val, setVal] = useState(defaultValue || "");
  const ref = useRef();
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onConfirm(val.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onConfirm(val.trim())}
      className="bg-[#3c3c3c] border border-[#007fd4] text-[#cccccc] text-xs px-1.5 py-0.5 rounded outline-none w-full"
      autoFocus
    />
  );
}

function TreeNode({
  name,
  node,
  path,
  selectedFile,
  onSelectFile,
  depth,
  renaming,
  onRenameConfirm,
  onRenameCancel,
  setRenaming,
  openFolders,
  onToggleFolder,
  creating,
  setCreating,
  handleCreateConfirm,
  handleDelete,
  onOpenInVsCode
}) {
  const isFile = node === null;
  const fullPath = path ? path + "/" + name : name;
  const isSelected = selectedFile === fullPath;
  const isOpen = openFolders.has(fullPath);
  const folderColor = FOLDER_COLORS[name] || "#c5c5c5";
  const isRenaming = renaming === fullPath;

  if (isFile) {
    return (
      <div
        className={
          "flex items-center gap-1.5 py-1 px-1.5 rounded cursor-pointer select-none transition-colors group " +
          (isSelected
            ? "bg-[#10338D] text-white"
            : "hover:bg-[#2a2d2e] text-[#cccccc]")
        }
        style={{ paddingLeft: depth * 12 + 8 + "px" }}
        onClick={() => onSelectFile(fullPath)}
      >
        <span className="text-[12px] shrink-0">{getFileIcon(name)}</span>
        {isRenaming ? (
          <InlineInput
            defaultValue={name}
            onConfirm={(v) => onRenameConfirm(fullPath, v, path)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="truncate text-[12px]">{name}</span>
        )}
        <div className="ml-auto hidden group-hover:flex items-center gap-1 pr-1 shrink-0">
          <button
            className="p-0.5 hover:bg-[#454545] rounded"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(fullPath);
            }}
            title="Rename"
          >
            <Pencil className="w-3 h-3 text-[#858585] hover:text-white" />
          </button>
          {onOpenInVsCode && (
            <button
              className="p-0.5 hover:bg-[#454545] rounded"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInVsCode(fullPath);
              }}
              title="Open file in VS Code"
            >
              <ExternalLink className="w-3 h-3 text-[#858585] hover:text-white" />
            </button>
          )}
          <button
            className="p-0.5 hover:bg-[#454545] rounded"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(fullPath);
            }}
            title="Delete"
          >
            <Trash2 className="w-3 h-3 text-[#858585] hover:text-white" />
          </button>
        </div>
      </div>
    );
  }

  const childKeys = Object.keys(node).sort((a, b) => {
    const af = node[a] !== null,
      bf = node[b] !== null;
    if (af && !bf) return -1;
    if (!af && bf) return 1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 px-1.5 rounded cursor-pointer select-none hover:bg-[#2a2d2e] text-[#cccccc] transition-colors group"
        style={{ paddingLeft: depth * 12 + 4 + "px" }}
        onClick={() => onToggleFolder(fullPath)}
      >
        <span className="text-[10px] text-[#888] shrink-0">
          {isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
        <span className="text-[13px] shrink-0">
          {isOpen ? (
            <FolderOpen
              className="w-3.5 h-3.5 inline"
              style={{ color: folderColor }}
            />
          ) : (
            <Folder
              className="w-3.5 h-3.5 inline"
              style={{ color: folderColor }}
            />
          )}
        </span>
        {isRenaming ? (
          <InlineInput
            defaultValue={name}
            onConfirm={(v) => onRenameConfirm(fullPath, v, path)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="text-[12px] font-medium truncate">{name}</span>
        )}
        <div className="ml-auto hidden group-hover:flex items-center gap-1 pr-1 shrink-0">
          <button
            className="p-0.5 hover:bg-[#454545] rounded"
            onClick={(e) => {
              e.stopPropagation();
              setCreating({ parentPath: fullPath, type: "file" });
              if (!isOpen) onToggleFolder(fullPath);
            }}
            title="New File"
          >
            <FilePlus className="w-3 h-3 text-[#858585] hover:text-white" />
          </button>
          <button
            className="p-0.5 hover:bg-[#454545] rounded"
            onClick={(e) => {
              e.stopPropagation();
              setCreating({ parentPath: fullPath, type: "folder" });
              if (!isOpen) onToggleFolder(fullPath);
            }}
            title="New Folder"
          >
            <FolderPlus className="w-3 h-3 text-[#858585] hover:text-white" />
          </button>
        </div>
      </div>
      {isOpen && (
        <div>
          {creating && creating.parentPath === fullPath && (
            <div
              className="flex items-center gap-1.5 py-0.5 px-1"
              style={{ paddingLeft: (depth + 1) * 12 + 8 + "px" }}
            >
              <span className="text-[11px] shrink-0">
                {creating.type === "file" ? (
                  <FilePlus className="w-3 h-3" />
                ) : (
                  <FolderPlus className="w-3 h-3" />
                )}
              </span>
              <InlineInput
                defaultValue=""
                onConfirm={handleCreateConfirm}
                onCancel={() => setCreating(null)}
              />
            </div>
          )}
          {childKeys.map((cn) => (
            <TreeNode
              key={cn}
              name={cn}
              node={node[cn]}
              path={fullPath}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={depth + 1}
              renaming={renaming}
              onRenameConfirm={onRenameConfirm}
              onRenameCancel={onRenameCancel}
              setRenaming={setRenaming}
              openFolders={openFolders}
              onToggleFolder={onToggleFolder}
              creating={creating}
              setCreating={setCreating}
              handleCreateConfirm={handleCreateConfirm}
              handleDelete={handleDelete}
              onOpenInVsCode={onOpenInVsCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const GENERATION_STAGES = [
  { id: 1, action: "Thinking", label: "Analyzing requirements & domain entities...", detail: "Extracting business rules, schema constraints, and source specifications" },
  { id: 2, action: "Working", label: "Structuring DAG lineage & dependencies...", detail: "Defining Medallion architecture (Bronze → Silver → Gold) pipeline" },
  { id: 3, action: "Generating", label: "Synthesizing dbt models & SQL...", detail: "Writing staging views, conformed transformations & dimensional marts" },
  { id: 4, action: "Testing", label: "Assembling schema tests & macros...", detail: "Generating schema.yml tests, relationships & surrogate key macros" },
  { id: 5, action: "Finalizing", label: "Mounting files to Monaco IDE...", detail: "Writing project to workspace and syncing file tree" }
];

export default function PromptMigrationWorkspace({ projectState, setProjectState }) {
  // App.jsx unmounts this whole component when navigating to another tab, which normally wipes
  // every useState here — this bundle is how the generated/imported project, prompt, and settings
  // survive that (and a full page reload), via the same projectState -> localStorage pipeline
  // every other tab already uses. See the sync effect below for what's excluded and why.
  const cmw = projectState?.cloudModWorkspace || {};

  // Requirement Prompt Form State
  const [prompt, setPrompt] = useState(cmw.prompt || "");
  const [targetDialect, setTargetDialect] = useState(cmw.targetDialect || "snowflake");
  const [projectName, setProjectName] = useState(cmw.projectName || "r_data_modernization");
  const [architectureStyle, setArchitectureStyle] = useState(cmw.architectureStyle || "medallion");
  const [includeTests, setIncludeTests] = useState(cmw.includeTests !== undefined ? cmw.includeTests : true);
  const [includeMacros, setIncludeMacros] = useState(cmw.includeMacros !== undefined ? cmw.includeMacros : true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [targetConnection, setTargetConnection] = useState({
    account: "",
    user: "",
    password: "",
    role: "",
    database: "",
    warehouse: "",
    schema: "public"
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // null | 'success' | 'error'
  const [genMessage, setGenMessage] = useState(cmw.genMessage || "");
  const [genError, setGenError] = useState("");
  // Set when the backend couldn't fully replace the project folder on disk (a file locked by
  // another program). The editor is still correct; Download ZIP / VS Code would see the leftovers.
  const [diskWarning, setDiskWarning] = useState("");
  const editorSectionRef = useRef(null);
  const scrollToEditorRef = useRef(false);

  // Source mode: start a brand-new project from a prompt, or import an already-existing one
  const [sourceMode, setSourceMode] = useState(cmw.sourceMode || "prompt"); // "prompt" | "import"
  const [importMode, setImportMode] = useState("git"); // "git" | "local"
  const [gitImportConfig, setGitImportConfig] = useState({ repo: "", branch: "main", subPath: "", token: "" });
  const [localFolderFiles, setLocalFolderFiles] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const localFolderInputRef = useRef(null);

  // Schema-Aware Generation: an optional add-on to "Generate from Prompt" — connect live to
  // Snowflake or upload a DDL/YAML/CSV schema file to ground generation in real entities/columns
  // instead of letting the AI guess them.
  const [showSchemaPanel, setShowSchemaPanel] = useState(!!cmw.sourceSchemaEntities);
  const [schemaSubMode, setSchemaSubMode] = useState("live"); // "live" | "upload"
  const [schemaSourceType, setSchemaSourceType] = useState("snowflake"); // "snowflake" | "oracle" | "databricks"
  const [schemaConnection, setSchemaConnection] = useState({
    account: "", username: "", password: "", warehouse: "", role: "", authMethod: "password",
    host: "", port: "1521", serviceName: "", workspaceUrl: "", token: "",
  });
  const [isSchemaConnecting, setIsSchemaConnecting] = useState(false);
  const [schemaConnError, setSchemaConnError] = useState("");
  const [schemaDatabases, setSchemaDatabases] = useState([]);
  const [schemaSchemas, setSchemaSchemas] = useState([]);
  const [schemaTables, setSchemaTables] = useState([]);
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [selectedSchemaName, setSelectedSchemaName] = useState("");
  const [selectedTables, setSelectedTables] = useState([]);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);
  const [sourceSchemaEntities, setSourceSchemaEntities] = useState(cmw.sourceSchemaEntities || null);
  // Where the live-introspected tables actually are ({database, schema, sourceType}). Captured when
  // the columns are loaded — not read from the pickers at generate time, which may have changed
  // since — and sent with generation so sources.yml points at the real location. Without it the AI
  // guessed `database: raw, schema: public`, putting the schema name where the database belongs.
  const [sourceSchemaLocation, setSourceSchemaLocation] = useState(cmw.sourceSchemaLocation || null);
  const [uploadFileType, setUploadFileType] = useState("ddl"); // "ddl" | "yaml" | "csv"
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const schemaUploadInputRef = useRef(null);

  // Editor State
  const [fileContent, setFileContent] = useState(cmw.fileContent || {});
  const [openTabs, setOpenTabs] = useState(cmw.openTabs || []);
  const [activeTab, setActiveTab] = useState(cmw.activeTab || null);
  const [dirtyTabs, setDirtyTabs] = useState(new Set());
  const [openFolders, setOpenFolders] = useState(
    new Set([
      "models",
      "models/bronze",
      "models/silver",
      "models/gold",
      "models/staging",
      "models/intermediate",
      "models/marts",
      "macros",
      "tests"
    ])
  );
  const [renaming, setRenaming] = useState(null);
  const [creating, setCreating] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  // Side Chat: a "Change Requests" card below the IDE for BOTH adding a new
  // requirement and describing a bug to fix — one prompt box, distinguished only by what the user
  // writes. Replaces the old below-editor "Follow-Up Agents" chip bar / Refine bar and the
  // Run & Validate feature. Nothing the AI proposes is applied until the user approves that file.
  const [sideChatMessages, setSideChatMessages] = useState(cmw.sideChatMessages || []);
  const [sideChatInput, setSideChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Two-phase workspace: derived from whether any files are loaded
  const hasProject = Object.keys(fileContent).length > 0;
  // The usage cards and the IDE only make sense once a project exists — never while one is
  // still being generated or imported.
  const showWorkspace = hasProject && !isGenerating && !isImporting;
  useEffect(() => {
    if (showWorkspace && scrollToEditorRef.current && editorSectionRef.current) {
      scrollToEditorRef.current = false;
      editorSectionRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [showWorkspace]);

  const handleStartNewProject = () => {
    setFileContent({});
    setOpenTabs([]);
    setActiveTab(null);
    setDirtyTabs(new Set());
    setGenMessage("");
    setGenError("");
    setPrompt("");
    setSideChatMessages([]);
    setSideChatInput("");
    setSourceSchemaEntities(null);
    setSourceSchemaLocation(null);
  };

  // Git Export & VS Code / Code Server States
  const [showGitModal, setShowGitModal] = useState(false);
  const [gitStep, setGitStep] = useState(1);
  const [gitConfig, setGitConfig] = useState({
    repo: "",
    token: "",
    branch: "main",
    commitMsg: "Export dbt project from Data Modernization"
  });
  const [gitStatus, setGitStatus] = useState(null);
  const [gitError, setGitError] = useState("");

  // Code Server Authentication Modal States
  const [showCodeServerLogin, setShowCodeServerLogin] = useState(false);
  const [csUsername, setCsUsername] = useState("");
  const [csPassword, setCsPassword] = useState("");
  const [csConnecting, setCsConnecting] = useState(false);
  const [backendKpis, setBackendKpis] = useState(cmw.backendKpis || null);
  const [aiUsage, setAiUsage] = useState(cmw.aiUsage || null);

  // Debounced so typing in the prompt box or editing a file doesn't write to localStorage on every
  // keystroke. The catch: the debounce's own cleanup used to just clearTimeout() a pending save
  // instead of running it — so an action right before leaving (e.g. a bug scan that just finished,
  // then switching tabs or refreshing within the 800ms window) was silently dropped and never saved.
  // pendingWorkspaceRef always holds the latest not-yet-written snapshot so the two effects below
  // can flush it on the way out instead of losing it.
  // dirtyTabs/openFolders/renaming/etc. are deliberately left out: dirtyTabs is a Set (not
  // JSON-serializable) and the rest is transient editor-panel UI, not work you'd be upset to lose.
  const pendingWorkspaceRef = useRef(null);
  useEffect(() => {
    if (!setProjectState) return;
    const snapshot = {
      prompt, targetDialect, projectName, architectureStyle, includeTests, includeMacros,
      sourceMode, fileContent, openTabs, activeTab, genMessage, backendKpis, aiUsage,
      sourceSchemaEntities, sourceSchemaLocation,
      // Bound how much chat history grows in localStorage: keep only the last 30 turns, and only
      // keep a resolved change's full new content while it's still "pending" (needed to redraw the
      // diff and let the user approve/decline it after a refresh) — once approved or declined that
      // content is redundant (fileContent already has it, or it was discarded), so drop it.
      sideChatMessages: sideChatMessages.slice(-30).map((m) => (
        !m.changes ? m : { ...m, changes: m.changes.map((c) => (c.status === "pending" ? c : { ...c, content: undefined })) }
      )),
    };
    pendingWorkspaceRef.current = snapshot;
    const timer = setTimeout(() => {
      setProjectState((prev) => ({ ...prev, cloudModWorkspace: snapshot }));
      pendingWorkspaceRef.current = null;
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, targetDialect, projectName, architectureStyle, includeTests, includeMacros,
    sourceMode, fileContent, openTabs, activeTab, genMessage, backendKpis, aiUsage,
    sourceSchemaEntities, sourceSchemaLocation, sideChatMessages]);

  // Flush a still-pending save on the way out, two different ways:
  //  - Switching to another sidebar tab unmounts this whole component (see the top-of-file note),
  //    which this effect's cleanup catches — goes through React state like the debounce above does.
  //  - An actual browser refresh/close doesn't reliably run React effects in time, so beforeunload
  //    writes directly to localStorage, synchronously, bypassing React entirely for just this case.
  useEffect(() => {
    const flushToLocalStorage = () => {
      if (!pendingWorkspaceRef.current) return;
      try {
        const raw = localStorage.getItem("agy_project_state");
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.cloudModWorkspace = pendingWorkspaceRef.current;
        localStorage.setItem("agy_project_state", JSON.stringify(parsed));
      } catch {/* ignore */ }
    };
    window.addEventListener("beforeunload", flushToLocalStorage);
    return () => {
      if (pendingWorkspaceRef.current && setProjectState) {
        setProjectState((prev) => ({ ...prev, cloudModWorkspace: pendingWorkspaceRef.current }));
        pendingWorkspaceRef.current = null;
      }
      window.removeEventListener("beforeunload", flushToLocalStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openInVsCode = async (path) => {
    if (fileContent && Object.keys(fileContent).length > 0) {
      await cloudModSyncProject(fileContent);
    }
    const res = await cloudModGetVscodeUri(path || "");
    if (res?.fileUri && path) window.location.href = res.fileUri;
    else if (res?.folderUri) window.location.href = res.folderUri;
  };

  const openFolderInVsCode = async () => {
    if (fileContent && Object.keys(fileContent).length > 0) {
      await cloudModSyncProject(fileContent);
    }
    const res = await cloudModGetVscodeUri("");
    if (res?.folderUri) window.location.href = res.folderUri;
  };

  // Data Modernization is completely isolated from Code Conversion.
  // It NEVER preloads files from Code Conversion on mount.

  const fileTree = buildFileTree(Object.keys(fileContent));
  const treeRootKeys = Object.keys(fileTree).sort((a, b) => {
    const af = fileTree[a] !== null,
      bf = fileTree[b] !== null;
    if (af && !bf) return -1;
    if (!af && bf) return 1;
    return a.localeCompare(b);
  });

  const filesList = Object.keys(fileContent);

  const openFile = useCallback(
    (path) => {
      setActiveTab(path);
      if (!openTabs.includes(path)) setOpenTabs((prev) => [...prev, path]);
    },
    [openTabs]
  );

  const closeTab = useCallback(
    (path, e) => {
      e?.stopPropagation();
      const nt = openTabs.filter((t) => t !== path);
      setOpenTabs(nt);
      setDirtyTabs((prev) => {
        const n = new Set(prev);
        n.delete(path);
        return n;
      });
      if (activeTab === path) setActiveTab(nt[nt.length - 1] || null);
    },
    [openTabs, activeTab]
  );

  const handleEditorChange = (value) => {
    setFileContent((prev) => ({ ...prev, [activeTab]: value }));
    setDirtyTabs((prev) => new Set([...prev, activeTab]));
    setSaveStatus("");
  };

  const saveFileToDisk = async (filePath) => {
    const content = fileContent[filePath];
    if (content === undefined) return;
    setSaveStatus("saving");
    try {
      const r = await cloudModSaveFile(filePath, content);
      if (r?.status === "success") {
        setDirtyTabs((prev) => {
          const n = new Set(prev);
          n.delete(filePath);
          return n;
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  };

  // Shortcut Ctrl+S
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


  const toggleFolder = (path) => {
    setOpenFolders((prev) => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
  };

  const handleRenameConfirm = async (oldPath, newName, parentPath) => {
    if (!newName || newName === oldPath.split("/").pop()) {
      setRenaming(null);
      return;
    }
    const newPath = parentPath ? parentPath + "/" + newName : newName;
    const currentVal = fileContent[oldPath] || "";
    try {
      await cloudModDeleteFile(oldPath);
      await cloudModSaveFile(newPath, currentVal);
    } catch { }
    setFileContent((prev) => {
      const n = { ...prev };
      if (n[oldPath] !== undefined) {
        n[newPath] = n[oldPath];
        delete n[oldPath];
      }
      return n;
    });
    setOpenTabs((prev) => prev.map((t) => (t === oldPath ? newPath : t)));
    if (activeTab === oldPath) setActiveTab(newPath);
    setRenaming(null);
  };

  const handleDelete = async (path) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    try {
      await cloudModDeleteFile(path);
    } catch { }
    setFileContent((prev) => {
      const n = { ...prev };
      delete n[path];
      return n;
    });
    closeTab(path);
  };

  const handleCreateConfirm = async (name) => {
    if (!name || !creating) {
      setCreating(null);
      return;
    }
    const fullPath = creating.parentPath
      ? creating.parentPath + "/" + name
      : name;
    if (creating.type === "file") {
      const initial = fullPath.endsWith(".sql")
        ? `-- ${name}\nselect 1 as id;\n`
        : "";
      try {
        await cloudModSaveFile(fullPath, initial);
      } catch { }
      setFileContent((prev) => ({ ...prev, [fullPath]: initial }));
      openFile(fullPath);
    } else {
      const placeholderPath = fullPath + "/.keep";
      try {
        await cloudModSaveFile(placeholderPath, "");
      } catch { }
      setFileContent((prev) => ({ ...prev, [placeholderPath]: "" }));
      setOpenFolders((prev) => new Set([...prev, fullPath]));
    }
    setCreating(null);
  };

  // A new generation/import REPLACES the workspace — nothing from the previous project (open tabs,
  // unsaved-change markers, run results) carries over. The backend does the same for the folder.
  const loadFilesIntoWorkspace = (files, kpis, message, usage, folderWarning = "") => {
    if (kpis) setBackendKpis(kpis);
    setAiUsage(usage || null);
    setFileContent(files);
    setDirtyTabs(new Set());
    setDiskWarning(folderWarning || "");
    const paths = Object.keys(files);
    const first = paths.find((p) => p.includes("gold") || p.endsWith(".sql")) || paths[0];
    setActiveTab(first || null);
    setOpenTabs(first ? [first] : []);
    setGenMessage(message || `Loaded ${paths.length} dbt files.`);
    scrollToEditorRef.current = true; // the IDE is still hidden until generation/import finishes
    // These files are a different project now, so proposals made against the previous one no
    // longer apply to it.
    setSideChatMessages([]);
  };

  // ── Side Chat (backend: services/side_chat.py) ────────────────────────────────────────────────
  // One prompt box for both "add this new requirement" and "this is a bug, fix it" — the backend
  // sees the FULL project and proposes only the files that need to change. Nothing is applied until
  // the user approves that specific file; declining (or never responding) leaves the project as-is.

  const handleSendChat = async () => {
    const prompt = sideChatInput.trim();
    if (!prompt || isChatSending) return;
    const userMsg = { id: `u_${Date.now()}`, role: "user", text: prompt };

    if (!fileContent || Object.keys(fileContent).length === 0) {
      setSideChatMessages((prev) => [...prev, userMsg,
      { id: `a_${Date.now()}`, role: "assistant", error: "Generate or import a project first." },
      ]);
      setSideChatInput("");
      return;
    }

    setSideChatMessages((prev) => [...prev, userMsg]);
    setSideChatInput("");
    setIsChatSending(true);
    try {
      const res = await sideChatPropose(prompt, fileContent, targetDialect);
      if (res?.status === "success") {
        if (res.aiUsage) setAiUsage(res.aiUsage);
        const changes = (res.changes || []).map((c) => ({ ...c, status: "pending" }));
        setSideChatMessages((prev) => [...prev, {
          id: `a_${Date.now()}`, role: "assistant",
          summary: res.summary || (changes.length === 0 ? "Nothing needed to change for this." : ""),
          changes,
        }]);
      } else {
        setSideChatMessages((prev) => [...prev, {
          id: `a_${Date.now()}`, role: "assistant", error: res?.message || "Could not process that request.",
        }]);
      }
    } catch {
      setSideChatMessages((prev) => [...prev, {
        id: `a_${Date.now()}`, role: "assistant", error: "Error connecting to the assistant.",
      }]);
    } finally {
      setIsChatSending(false);
    }
  };

  const setChangeStatus = (messageId, path, status) => {
    setSideChatMessages((prev) => prev.map((m) => (
      m.id !== messageId ? m : { ...m, changes: m.changes.map((c) => (c.path === path ? { ...c, status } : c)) }
    )));
  };

  const handleApproveChange = (messageId, path) => {
    const change = sideChatMessages.find((m) => m.id === messageId)?.changes?.find((c) => c.path === path);
    if (change) {
      setFileContent((prev) => ({ ...prev, [path]: change.content }));
      setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      setActiveTab(path);
    }
    setChangeStatus(messageId, path, "approved");
  };

  const handleDeclineChange = (messageId, path) => setChangeStatus(messageId, path, "declined");

  const handleApproveAllChanges = (messageId) => {
    const msg = sideChatMessages.find((m) => m.id === messageId);
    if (!msg) return;
    const updates = {};
    msg.changes.forEach((c) => { if (c.status === "pending") updates[c.path] = c.content; });
    if (Object.keys(updates).length) setFileContent((prev) => ({ ...prev, ...updates }));
    setSideChatMessages((prev) => prev.map((m) => (
      m.id !== messageId ? m : { ...m, changes: m.changes.map((c) => (c.status === "pending" ? { ...c, status: "approved" } : c)) }
    )));
  };

  const handleDeclineAllChanges = (messageId) => {
    setSideChatMessages((prev) => prev.map((m) => (
      m.id !== messageId ? m : { ...m, changes: m.changes.map((c) => (c.status === "pending" ? { ...c, status: "declined" } : c)) }
    )));
  };

  const openFileFromChat = (path) => {
    if (path in fileContent) openFile(path);
  };

  const handleImportGit = async () => {
    if (!gitImportConfig.repo.trim()) {
      setImportError("Please enter a repository (owner/repo or a GitHub URL).");
      return;
    }
    setImportError("");
    setGenMessage("");
    setIsImporting(true);
    try {
      const res = await importDbtFromGit({
        repo: gitImportConfig.repo.trim(),
        branch: gitImportConfig.branch.trim() || "main",
        subPath: gitImportConfig.subPath.trim(),
        token: gitImportConfig.token.trim()
      });
      if (res?.status === "success" && res.files) {
        loadFilesIntoWorkspace(
          res.files,
          res.kpis,
          res.message || `Imported ${Object.keys(res.files).length} files from ${gitImportConfig.repo.trim()}.`,
          res.aiUsage,
          res.diskWarning
        );
      } else {
        setImportError(res?.message || res?.detail || "Failed to import dbt project from git.");
      }
    } catch {
      setImportError("Error connecting to the import service.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleLocalFolderSelected = (e) => {
    const fileList = Array.from(e.target.files || []);
    setLocalFolderFiles(fileList);
    setImportError("");
  };

  const handleImportLocalFolder = async () => {
    if (!localFolderFiles || localFolderFiles.length === 0) {
      setImportError("Please choose a local dbt project folder first.");
      return;
    }
    setImportError("");
    setGenMessage("");
    setIsImporting(true);
    try {
      const res = await importDbtFromLocalFolder(localFolderFiles);
      if (res?.status === "success" && res.files) {
        loadFilesIntoWorkspace(
          res.files,
          res.kpis,
          res.message || `Imported ${Object.keys(res.files).length} files from the local folder.`,
          res.aiUsage,
          res.diskWarning
        );
      } else {
        setImportError(res?.message || res?.detail || "Failed to import dbt project from local folder.");
      }
    } catch {
      setImportError("Error connecting to the import service.");
    } finally {
      setIsImporting(false);
    }
  };

  // ── Schema-Aware Generation handlers ────────────────────────────────────────

  const SCHEMA_SOURCE_LABELS = { snowflake: "Snowflake", oracle: "Oracle", databricks: "Databricks" };

  const validateSchemaConnection = () => {
    if (schemaSourceType === "oracle") {
      if (!schemaConnection.host.trim() || !schemaConnection.serviceName.trim() || !schemaConnection.username.trim()) {
        return "Host, Service Name, and Username are required.";
      }
    } else if (schemaSourceType === "databricks") {
      if (!schemaConnection.workspaceUrl.trim() || !schemaConnection.token.trim()) {
        return "Workspace URL and Access Token are required.";
      }
    } else if (!schemaConnection.account.trim() || !schemaConnection.username.trim()) {
      return "Account and Username are required.";
    }
    return "";
  };

  const handleSchemaConnect = async () => {
    const validationError = validateSchemaConnection();
    if (validationError) {
      setSchemaConnError(validationError);
      return;
    }
    setSchemaConnError("");
    setIsSchemaConnecting(true);
    setSchemaDatabases([]);
    setSchemaSchemas([]);
    setSchemaTables([]);
    setSelectedDatabase("");
    setSelectedSchemaName("");
    setSelectedTables([]);
    setSourceSchemaEntities(null);
    try {
      const res = await schemaGetDatabases({ ...schemaConnection, sourceType: schemaSourceType });
      if (res?.status === "success" && res.databases) {
        setSchemaDatabases(res.databases);
      } else {
        setSchemaConnError(res?.message || `Could not connect to ${SCHEMA_SOURCE_LABELS[schemaSourceType]}.`);
      }
    } catch {
      setSchemaConnError(`Error connecting to ${SCHEMA_SOURCE_LABELS[schemaSourceType]}.`);
    } finally {
      setIsSchemaConnecting(false);
    }
  };

  const handleSelectDatabase = async (db) => {
    setSelectedDatabase(db);
    setSelectedSchemaName("");
    setSchemaSchemas([]);
    setSchemaTables([]);
    setSelectedTables([]);
    setSourceSchemaEntities(null);
    if (!db) return;
    setIsLoadingSchemas(true);
    try {
      const res = await schemaGetSchemas({ ...schemaConnection, sourceType: schemaSourceType }, db);
      if (res?.status === "success" && res.schemas) setSchemaSchemas(res.schemas);
      else setSchemaConnError(res?.message || "Could not fetch schemas.");
    } finally {
      setIsLoadingSchemas(false);
    }
  };

  const handleSelectSchemaName = async (sch) => {
    setSelectedSchemaName(sch);
    setSchemaTables([]);
    setSelectedTables([]);
    setSourceSchemaEntities(null);
    if (!sch) return;
    setIsLoadingTables(true);
    try {
      const res = await schemaGetTables({ ...schemaConnection, sourceType: schemaSourceType }, selectedDatabase, sch);
      if (res?.status === "success" && res.tables) setSchemaTables(res.tables);
      else setSchemaConnError(res?.message || "Could not fetch tables.");
    } finally {
      setIsLoadingTables(false);
    }
  };

  const toggleTableSelection = (tableName) => {
    setSelectedTables((prev) =>
      prev.includes(tableName) ? prev.filter((t) => t !== tableName) : [...prev, tableName]
    );
    setSourceSchemaEntities(null);
  };

  const handleFetchColumns = async () => {
    if (selectedTables.length === 0) return;
    setIsLoadingColumns(true);
    setSchemaConnError("");
    try {
      const res = await schemaGetColumns(
        { ...schemaConnection, sourceType: schemaSourceType }, selectedDatabase, selectedSchemaName, selectedTables
      );
      if (res?.status === "success" && res.entities) {
        setSourceSchemaEntities(res.entities);
        setSourceSchemaLocation({ database: selectedDatabase, schema: selectedSchemaName, sourceType: schemaSourceType });
      } else {
        setSchemaConnError(res?.message || "Could not fetch column metadata.");
      }
    } finally {
      setIsLoadingColumns(false);
    }
  };

  const handleSchemaFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setSourceSchemaEntities(null);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target.result;
      setUploadFileName(file.name);
      try {
        const res = await schemaUploadFile(uploadFileType, content);
        if (res?.status === "success" && res.entities) {
          setSourceSchemaEntities(res.entities);
          setSourceSchemaLocation(null); // an uploaded file carries no connection to locate it in
        } else {
          setUploadError(res?.message || "Could not parse the uploaded schema file.");
        }
      } catch {
        setUploadError("Error uploading schema file.");
      }
    };
    reader.readAsText(file);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setGenError("Please enter your prompt requirement first.");
      return;
    }
    setGenError("");
    setGenMessage("");
    setIsGenerating(true);
    setGenProgress(15);
    setCurrentStageIdx(0);

    const interval = setInterval(() => {
      setGenProgress((prev) => {
        if (prev < 35) {
          setCurrentStageIdx(1);
          return prev + 6;
        } else if (prev < 65) {
          setCurrentStageIdx(2);
          return prev + 5;
        } else if (prev < 85) {
          setCurrentStageIdx(3);
          return prev + 4;
        } else if (prev < 95) {
          setCurrentStageIdx(4);
          return prev + 2;
        }
        return prev;
      });
    }, 600);

    try {
      const res = await generateDbtFromPrompt({
        prompt: prompt.trim(),
        targetDialect,
        projectName,
        architectureStyle,
        includeTests,
        includeMacros,
        targetConnection,
        ...(sourceSchemaEntities ? { sourceSchema: sourceSchemaEntities } : {}),
        ...(sourceSchemaEntities && sourceSchemaLocation ? { sourceLocation: sourceSchemaLocation } : {})
      });

      clearInterval(interval);

      if (res?.status === "success" && res.files) {
        setGenProgress(100);
        setCurrentStageIdx(4);

        setTimeout(() => {
          loadFilesIntoWorkspace(
            res.files,
            res.kpis,
            `Generated ${Object.keys(res.files).length} dbt models and configuration files using Gemini AI.` +
            (res.missingEntities?.length
              ? ` Not covered: ${res.missingEntities.join(", ")} — add them with a follow-up prompt.`
              : ""),
            res.aiUsage,
            res.diskWarning
          );
          setIsGenerating(false);
        }, 800);
      } else {
        clearInterval(interval);
        setIsGenerating(false);
        setGenError(res?.message || "Failed to generate models.");
      }
    } catch {
      clearInterval(interval);
      setIsGenerating(false);
      setGenError("Error connecting to migration generator.");
    }
  };

  const handleTestConnection = async () => {
    if (!targetConnection.account || !targetConnection.user || !targetConnection.password) {
      setConnectionStatus({ type: 'error', message: 'Account, User, and Password are required.' });
      return;
    }
    setIsTestingConnection(true);
    setConnectionStatus(null);

    const payload = {
      dialect: targetDialect,
      account: targetConnection.account,
      user: targetConnection.user,
      password: targetConnection.password,
      database: targetConnection.database,
      warehouse: targetConnection.warehouse,
      role: targetConnection.role
    };

    const result = await testCloudModConnection(payload);

    setIsTestingConnection(false);
    if (result.status === 'success') {
      setConnectionStatus({ type: 'success', message: result.message });
      setTimeout(() => setConnectionStatus(null), 5000);
    } else {
      setConnectionStatus({ type: 'error', message: result.message || 'Connection failed.' });
    }
  };

  const handleDownloadZip = async () => {
    if (fileContent && Object.keys(fileContent).length > 0) {
      // The ZIP is built from the folder on disk, so it must first match the editor exactly.
      const res = await cloudModSyncProject(fileContent);
      setDiskWarning(res?.diskWarning || "");
      if (res?.diskWarning) return; // don't hand out a ZIP that still contains the old project
    }
    window.open("/api/migration/download", "_blank");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-[#10338D] to-[#1E4FD9] rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-white/10 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
            <div className="flex items-center space-x-3">
              <span className="p-2 bg-white/15 rounded-xl backdrop-blur-sm border border-white/20">
                <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-xl font-black tracking-tight text-white">
                    Data Modernization: Prompt-Driven dbt Generator
                  </h1>
                </div>
                <p className="text-xs text-[#D1DEFF] mt-1">
                  Describe your data requirements, staging entities, and files to create.
                  AI architects complete, production-ready dbt models directly into the Monaco IDE.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase A: Project Setup — shown only until a project is generated or imported */}
      {!hasProject && (
        <div className="bg-white rounded-2xl border border-[#D1DEFF] shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#10338D]" />
              <h2 className="text-sm font-bold text-[#1E1E1E]">1. Generate or Import Your dbt Project</h2>
            </div>

            {sourceMode === "prompt" && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowSchemaPanel(!showSchemaPanel)}
                  className="text-xs font-semibold text-[#10338D] hover:underline flex items-center space-x-1 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>
                    {sourceSchemaEntities ? `Schema Connected (${Object.keys(sourceSchemaEntities).length})` : "Ground in Schema"}
                  </span>
                </button>
                <button
                  onClick={() => setShowConfig(!showConfig)}
                  className="text-xs font-semibold text-[#10338D] hover:underline flex items-center space-x-1 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{showConfig ? "Hide Settings" : "Target & Architecture Settings"}</span>
                </button>
              </div>
            )}
          </div>
          <>


            {/* Start new vs import existing project */}
            <div className="mb-4 inline-flex p-1 rounded-xl bg-[#F1F5F9] border border-[#D1DEFF]">
              <button
                onClick={() => setSourceMode("prompt")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${sourceMode === "prompt" ? "bg-white text-[#10338D] shadow-sm" : "text-[#64748B] hover:text-[#334155]"
                  }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate from Prompt</span>
              </button>
              <button
                onClick={() => setSourceMode("import")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${sourceMode === "import" ? "bg-white text-[#10338D] shadow-sm" : "text-[#64748B] hover:text-[#334155]"
                  }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Import Existing dbt Project</span>
              </button>
            </div>

            {/* Collapsible Architecture & Connection Settings */}
            {sourceMode === "prompt" && showConfig && (
              <div className="mb-4 space-y-4">
                <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#334155] mb-1">
                      Target Warehouse Dialect
                    </label>
                    <select
                      value={targetDialect}
                      onChange={(e) => setTargetDialect(e.target.value)}
                      className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                    >
                      <option value="snowflake">Snowflake (SQL / Jinja)</option>
                      <option value="databricks">Databricks (Spark SQL)</option>
                      <option value="bigquery">Google BigQuery</option>
                      <option value="postgres">PostgreSQL</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#334155] mb-1">
                      Project Name
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#334155] mb-1">
                      Architecture Pattern
                    </label>
                    <select
                      value={architectureStyle}
                      onChange={(e) => setArchitectureStyle(e.target.value)}
                      className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                    >
                      <option value="medallion">Medallion (Bronze/Silver/Gold)</option>
                      <option value="marts">Staging & Marts Flat</option>
                    </select>
                  </div>

                  <div className="flex flex-col justify-center space-y-2 pt-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeTests}
                        onChange={(e) => setIncludeTests(e.target.checked)}
                        className="rounded text-[#10338D] focus:ring-[#10338D]"
                      />
                      <span className="font-semibold text-[#334155]">Include schema.yml tests</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeMacros}
                        onChange={(e) => setIncludeMacros(e.target.checked)}
                        className="rounded text-[#10338D] focus:ring-[#10338D]"
                      />
                      <span className="font-semibold text-[#334155]">Include utility macros</span>
                    </label>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] text-xs">
                  <h3 className="font-bold text-[#10338D] mb-3 flex items-center space-x-1.5">
                    <Database className="w-4 h-4" />
                    <span>Target Connection Credentials (for profiles.yml)</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">Account</label>
                      <input
                        type="text"
                        value={targetConnection.account}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, account: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                        placeholder="xy12345.us-east-1"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">User</label>
                      <input
                        type="text"
                        value={targetConnection.user}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, user: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">Password</label>
                      <input
                        type="password"
                        value={targetConnection.password}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, password: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">Role</label>
                      <input
                        type="text"
                        value={targetConnection.role}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, role: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">Warehouse</label>
                      <input
                        type="text"
                        value={targetConnection.warehouse}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, warehouse: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#334155] mb-1">Database</label>
                      <input
                        type="text"
                        value={targetConnection.database}
                        onChange={(e) => setTargetConnection(prev => ({ ...prev, database: e.target.value }))}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#D1DEFF] pt-3">
                    <div className="flex items-center flex-1">
                      {connectionStatus && (
                        <div className={`text-[11px] font-bold flex items-center space-x-1.5 ${connectionStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                          {connectionStatus.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          <span>{connectionStatus.message}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleTestConnection}
                      disabled={isTestingConnection}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${isTestingConnection ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border border-[#10338D] text-[#10338D] hover:bg-[#EEF2FF]'}`}
                    >
                      {isTestingConnection ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>Test Connection</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {sourceMode === "prompt" && showSchemaPanel && (
              <div className="mb-4">
                <p className="text-xs text-[#64748B] mb-3">
                  Optional: ground this generation in your real database schema instead of letting the AI guess column
                  names — connect live to Snowflake, Oracle, or Databricks, or upload a DDL/YAML/CSV schema definition.
                </p>

                {/* Live vs Upload toggle */}
                <div className="flex items-center space-x-2 mb-3">
                  <button
                    onClick={() => setSchemaSubMode("live")}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${schemaSubMode === "live"
                      ? "bg-[#EEF2FF] border-[#10338D] text-[#10338D]"
                      : "bg-white border-[#CBD5E1] text-[#64748B] hover:border-[#94A3B8]"
                      }`}
                  >
                    <Plug className="w-3.5 h-3.5" />
                    <span>Live Connection</span>
                  </button>
                  <button
                    onClick={() => setSchemaSubMode("upload")}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${schemaSubMode === "upload"
                      ? "bg-[#EEF2FF] border-[#10338D] text-[#10338D]"
                      : "bg-white border-[#CBD5E1] text-[#64748B] hover:border-[#94A3B8]"
                      }`}
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload Schema File</span>
                  </button>
                </div>

                {schemaSubMode === "live" ? (
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] space-y-3">
                    {/* Source platform picker */}
                    <div className="flex items-center space-x-2">
                      {["snowflake", "oracle", "databricks"].map((src) => (
                        <button
                          key={src}
                          onClick={() => {
                            setSchemaSourceType(src);
                            setSchemaConnError("");
                            setSchemaDatabases([]);
                            setSchemaSchemas([]);
                            setSchemaTables([]);
                            setSelectedDatabase("");
                            setSelectedSchemaName("");
                            setSelectedTables([]);
                            setSourceSchemaEntities(null);
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${schemaSourceType === src
                            ? "bg-[#10338D] border-[#10338D] text-white"
                            : "bg-white border-[#CBD5E1] text-[#64748B] hover:border-[#94A3B8]"
                            }`}
                        >
                          {SCHEMA_SOURCE_LABELS[src]}
                        </button>
                      ))}
                    </div>

                    {schemaSourceType === "snowflake" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Account <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.account}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, account: e.target.value }))}
                            placeholder="xy12345.us-east-1"
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Username <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.username}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, username: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Password</label>
                          <input
                            type="password"
                            value={schemaConnection.password}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, password: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Warehouse</label>
                          <input
                            type="text"
                            value={schemaConnection.warehouse}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, warehouse: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Role</label>
                          <input
                            type="text"
                            value={schemaConnection.role}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, role: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                      </div>
                    )}

                    {schemaSourceType === "oracle" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Host <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.host}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, host: e.target.value }))}
                            placeholder="oracle-db.company.com"
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Port</label>
                          <input
                            type="text"
                            value={schemaConnection.port}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, port: e.target.value }))}
                            placeholder="1521"
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Service Name <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.serviceName}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, serviceName: e.target.value }))}
                            placeholder="ORCLPDB1"
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Username <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.username}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, username: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Password</label>
                          <input
                            type="password"
                            value={schemaConnection.password}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, password: e.target.value }))}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                      </div>
                    )}

                    {schemaSourceType === "databricks" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Workspace URL <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={schemaConnection.workspaceUrl}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, workspaceUrl: e.target.value }))}
                            placeholder="https://dbc-xxxxx.cloud.databricks.com"
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Access Token <span className="text-red-500">*</span></label>
                          <input
                            type="password"
                            value={schemaConnection.token}
                            onChange={(e) => setSchemaConnection((p) => ({ ...p, token: e.target.value }))}
                            placeholder="dapi..."
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          />
                        </div>
                        <p className="md:col-span-2 text-[10px] text-[#94A3B8]">
                          Reads from Unity Catalog — the token needs at least read access to the catalogs/schemas/tables you want to use.
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-[#D1DEFF] pt-3">
                      {schemaConnError && (
                        <div className="text-[11px] font-bold text-red-600 flex items-center space-x-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>{schemaConnError}</span>
                        </div>
                      )}
                      <div className="ml-auto">
                        <button
                          onClick={handleSchemaConnect}
                          disabled={isSchemaConnecting}
                          className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${isSchemaConnecting ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border border-[#10338D] text-[#10338D] hover:bg-[#EEF2FF]'}`}
                        >
                          {isSchemaConnecting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <>
                              <Plug className="w-3.5 h-3.5" />
                              <span>Connect</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Database -> Schema -> Table cascading picker */}
                    {schemaDatabases.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2 border-t border-[#D1DEFF]">
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Database</label>
                          <select
                            value={selectedDatabase}
                            onChange={(e) => handleSelectDatabase(e.target.value)}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                          >
                            <option value="">Select a database...</option>
                            {schemaDatabases.map((db) => (
                              <option key={db} value={db}>{db}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-bold text-[#334155] mb-1">Schema</label>
                          <select
                            value={selectedSchemaName}
                            onChange={(e) => handleSelectSchemaName(e.target.value)}
                            disabled={!selectedDatabase || isLoadingSchemas}
                            className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E] disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <option value="">{isLoadingSchemas ? "Loading..." : "Select a schema..."}</option>
                            {schemaSchemas.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {selectedSchemaName && (
                      <div className="pt-2 border-t border-[#D1DEFF]">
                        <label className="block font-bold text-[#334155] mb-2 text-xs flex items-center space-x-1.5">
                          <Table2 className="w-3.5 h-3.5" />
                          <span>{isLoadingTables ? "Loading tables..." : `Select tables (${selectedTables.length} selected)`}</span>
                        </label>
                        <div className="max-h-40 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-1.5 p-2 bg-white border border-[#CBD5E1] rounded-lg">
                          {schemaTables.map((t) => (
                            <label key={t.name} className="flex items-center space-x-1.5 text-[11px] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedTables.includes(t.name)}
                                onChange={() => toggleTableSelection(t.name)}
                                className="rounded text-[#10338D] focus:ring-[#10338D]"
                              />
                              <span className="truncate">{t.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center justify-end mt-2">
                          <button
                            onClick={handleFetchColumns}
                            disabled={selectedTables.length === 0 || isLoadingColumns}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${selectedTables.length === 0 || isLoadingColumns
                              ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-[#10338D] hover:bg-[#0C2566] text-white"
                              }`}
                          >
                            {isLoadingColumns ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Fetching columns...</span>
                              </>
                            ) : (
                              <>
                                <ListChecks className="w-3.5 h-3.5" />
                                <span>Load Schema ({selectedTables.length} tables)</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] space-y-3">
                    <div>
                      <label className="block font-bold text-[#334155] mb-1 text-xs">File Type</label>
                      <select
                        value={uploadFileType}
                        onChange={(e) => setUploadFileType(e.target.value)}
                        className="bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E] text-xs"
                      >
                        <option value="ddl">DDL (.sql — CREATE TABLE statements)</option>
                        <option value="yaml">dbt schema.yml / sources.yml</option>
                        <option value="csv">CSV (table_name, column_name, data_type, ...)</option>
                      </select>
                    </div>
                    <input
                      ref={schemaUploadInputRef}
                      type="file"
                      accept=".sql,.yml,.yaml,.csv"
                      className="hidden"
                      onChange={handleSchemaFileSelected}
                    />
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => schemaUploadInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-lg text-xs font-bold border border-[#CBD5E1] bg-white text-[#334155] hover:border-[#10338D] hover:text-[#10338D] transition-all cursor-pointer flex items-center space-x-1.5"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Choose Schema File</span>
                      </button>
                      <span className="text-xs text-[#64748B]">{uploadFileName || "No file selected"}</span>
                    </div>
                    {uploadError && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{uploadError}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Loaded schema summary */}
                {sourceSchemaEntities && Object.keys(sourceSchemaEntities).length > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                    <div className="flex items-center space-x-2 font-bold mb-1.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Schema loaded: {Object.keys(sourceSchemaEntities).length} real entities,{" "}
                        {Object.values(sourceSchemaEntities).reduce((sum, cols) => sum + cols.length, 0)} columns.
                        Generation will use these exact names — nothing will be invented.
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {Object.entries(sourceSchemaEntities).map(([ent, cols]) => (
                        <span key={ent} className="px-2 py-0.5 rounded-md bg-white border border-emerald-300 font-mono text-[10px]">
                          {ent} ({cols.length})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {sourceMode === "prompt" && (
              <>
                {/* Prompt Textarea */}
                <div className="relative">
                  <textarea
                    rows={15}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!isGenerating && prompt.trim()) {
                          handleGenerate();
                        }
                      }
                    }}
                    placeholder="Enter the requirements..."
                    className="w-full bg-[#F8FAFC] border border-[#CBD5E1] focus:border-[#10338D] focus:bg-white rounded-xl p-3.5 text-xs text-[#1E1E1E] leading-relaxed outline-none transition-all resize-y font-mono shadow-inner"
                  />
                  <div className="absolute right-3 bottom-3 flex items-center space-x-2 text-[10px] text-[#94A3B8]">
                    <span>{prompt.length} chars</span>
                  </div>
                </div>

                {genError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{genError}</span>
                  </div>
                )}

                {/* Generate Action Button */}
                <div className="mt-4 flex items-center justify-end space-x-2.5">
                  <PromptOptimizerButton
                    promptText={prompt}
                    onApply={(optimized) => setPrompt(optimized)}
                    disabled={isGenerating}
                  />
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 shadow-sm transition-all cursor-pointer ${isGenerating || !prompt.trim()
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-[#10338D] hover:bg-[#0C2566] text-white hover:shadow-md"
                      }`}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{GENERATION_STAGES[currentStageIdx]?.action || "Working"}... ({genProgress}%)</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-300" />
                        <span>{sourceSchemaEntities ? "Generate dbt Models with AI" : "Generate dbt Models with AI"}</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {sourceMode === "import" && (
              <>
                {/* Import method toggle */}
                <div className="flex items-center space-x-2 mb-3">
                  <button
                    onClick={() => setImportMode("git")}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${importMode === "git"
                      ? "bg-[#EEF2FF] border-[#10338D] text-[#10338D]"
                      : "bg-white border-[#CBD5E1] text-[#64748B] hover:border-[#94A3B8]"
                      }`}
                  >
                    <GitPullRequest className="w-3.5 h-3.5" />
                    <span>From Git Repository</span>
                  </button>
                  <button
                    onClick={() => setImportMode("local")}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${importMode === "local"
                      ? "bg-[#EEF2FF] border-[#10338D] text-[#10338D]"
                      : "bg-white border-[#CBD5E1] text-[#64748B] hover:border-[#94A3B8]"
                      }`}
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>From Local Folder</span>
                  </button>
                </div>

                {importMode === "git" ? (
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="md:col-span-2">
                        <label className="block font-bold text-[#334155] mb-1">
                          Repository <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={gitImportConfig.repo}
                          onChange={(e) => setGitImportConfig((p) => ({ ...p, repo: e.target.value }))}
                          placeholder="owner/repo or https://github.com/owner/repo"
                          className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-[#334155] mb-1">Branch</label>
                        <input
                          type="text"
                          value={gitImportConfig.branch}
                          onChange={(e) => setGitImportConfig((p) => ({ ...p, branch: e.target.value }))}
                          placeholder="main"
                          className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-[#334155] mb-1">Sub-folder Path (optional)</label>
                        <input
                          type="text"
                          value={gitImportConfig.subPath}
                          onChange={(e) => setGitImportConfig((p) => ({ ...p, subPath: e.target.value }))}
                          placeholder="e.g. dbt/ or leave blank for repo root"
                          className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block font-bold text-[#334155] mb-1">GitHub Token (optional, required for private repos)</label>
                        <input
                          type="password"
                          value={gitImportConfig.token}
                          onChange={(e) => setGitImportConfig((p) => ({ ...p, token: e.target.value }))}
                          placeholder="ghp_..."
                          className="w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E1E1E]"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-[#64748B]">
                      Fetches the already-existing dbt project from this repository (instead of generating one from scratch) and loads it into the workspace below.
                    </p>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={handleImportGit}
                        disabled={isImporting || !gitImportConfig.repo.trim()}
                        className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 shadow-sm transition-all cursor-pointer ${isImporting || !gitImportConfig.repo.trim()
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                          : "bg-[#10338D] hover:bg-[#0C2566] text-white hover:shadow-md"
                          }`}
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Fetching project...</span>
                          </>
                        ) : (
                          <>
                            <GitPullRequest className="w-4 h-4 text-amber-300" />
                            <span>Fetch dbt Project from Git</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D1DEFF] space-y-3">
                    <input
                      ref={localFolderInputRef}
                      type="file"
                      webkitdirectory=""
                      directory=""
                      multiple
                      className="hidden"
                      onChange={handleLocalFolderSelected}
                    />
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => localFolderInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-lg text-xs font-bold border border-[#CBD5E1] bg-white text-[#334155] hover:border-[#10338D] hover:text-[#10338D] transition-all cursor-pointer flex items-center space-x-1.5"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Choose dbt Project Folder</span>
                      </button>
                      <span className="text-xs text-[#64748B]">
                        {localFolderFiles && localFolderFiles.length > 0
                          ? `${localFolderFiles.length} files selected`
                          : "No folder selected"}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#64748B]">
                      Select an already-existing dbt project folder on your machine to load it into the workspace below, instead of generating one from scratch.
                    </p>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={handleImportLocalFolder}
                        disabled={isImporting || !localFolderFiles || localFolderFiles.length === 0}
                        className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 shadow-sm transition-all cursor-pointer ${isImporting || !localFolderFiles || localFolderFiles.length === 0
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                          : "bg-[#10338D] hover:bg-[#0C2566] text-white hover:shadow-md"
                          }`}
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Importing project...</span>
                          </>
                        ) : (
                          <>
                            <FolderOpen className="w-4 h-4 text-amber-300" />
                            <span>Import Local dbt Project</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {importError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}
              </>
            )}

            {genMessage && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{genMessage}</span>
              </div>
            )}
          </>
        </div>
      )}

      {/* Phase B: Project Workspace — shown once a project is generated or imported */}
      {hasProject && (
        <>
          {/* Status bar */}
          <div className="bg-white rounded-2xl border border-[#D1DEFF] shadow-sm px-5 py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-[#10338D]">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Project loaded ({filesList.length} files)</span>
            </div>
            <button
              onClick={handleStartNewProject}
              className="text-xs font-semibold text-[#64748B] hover:text-[#10338D] flex items-center space-x-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Start New Project</span>
            </button>
          </div>

          {/* Follow-up requirements, changes, and bug fixes — one request box, since all three
              go through the exact same sideChatPropose() pipeline and only differ in what the
              user happens to type (a new feature, a change, or a pasted error). */}
          <div className="bg-white rounded-2xl border border-[#D1DEFF] shadow-sm p-6">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-2.5 h-2.5 rounded-full bg-[#10338D]" />
              <h2 className="text-sm font-bold text-[#1E1E1E]">Follow-up Requirement, Change, or Fix</h2>
            </div>
            <div className="space-y-4 animate-in fade-in duration-300">
              <p className="text-xs text-[#64748B]">
                Describe what you need — a new model or feature, a change to existing code, or a bug/error to fix.
                The AI sees your whole existing project and proposes only the files that need to change.
              </p>
              <div className="relative">
                <textarea
                  rows={8}
                  value={sideChatInput}
                  onChange={(e) => setSideChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isChatSending && sideChatInput.trim()) {
                        handleSendChat();
                      }
                    }
                  }}
                  placeholder="E.g., Add a products dimension table with category and brand... / Rename column X to Y in the orders model... / Compilation Error in model_name: column 'id' does not exist..."
                  className="w-full bg-[#F8FAFC] border border-[#CBD5E1] focus:border-[#10338D] focus:bg-white rounded-xl p-3.5 text-xs text-[#1E1E1E] leading-relaxed outline-none transition-all resize-y font-mono shadow-inner"
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  onClick={handleSendChat}
                  disabled={isChatSending || !sideChatInput.trim()}
                  className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 shadow-sm transition-all cursor-pointer ${isChatSending || !sideChatInput.trim()
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-[#10338D] hover:bg-[#0C2566] text-white hover:shadow-md"
                    }`}
                >
                  {isChatSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Analyzing Request...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4 text-amber-300" />
                      <span>Propose Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Inline review — right below the request box, in the same card */}
            {sideChatMessages.length > 0 && (
              <div className="mt-5 pt-5 border-t border-[#E2E8F0]">
                <SideChatPanel
                  messages={sideChatMessages}
                  fileContent={fileContent}
                  onApprove={handleApproveChange}
                  onDecline={handleDeclineChange}
                  onApproveAll={handleApproveAllChanges}
                  onDeclineAll={handleDeclineAllChanges}
                  onOpenFile={openFileFromChat}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Live AI Model Generation Progress - Sequential One-by-One Status */}
      {isGenerating && (
        <div className="bg-white rounded-2xl border border-[#D1DEFF] shadow-md p-5 relative overflow-hidden transition-all animate-in fade-in duration-300">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#10338D] to-[#2563EB] text-white flex items-center justify-center shadow-md relative">
                <Brain className="w-5 h-5 animate-pulse text-amber-300" />
                <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white animate-ping" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin text-amber-700" />
                    {GENERATION_STAGES[currentStageIdx]?.action || "Working"}...
                  </span>
                  <h3 className="text-sm font-black text-[#10338D]">
                    {GENERATION_STAGES[currentStageIdx]?.label}
                  </h3>
                </div>
                <p className="text-xs text-[#64748B] mt-1">
                  {GENERATION_STAGES[currentStageIdx]?.detail}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 bg-[#F8FAFC] border border-[#D1DEFF] px-3.5 py-1.5 rounded-xl shadow-2xs">
              <span className="text-2xl font-black text-[#10338D] font-mono tracking-tighter">
                {genProgress}%
              </span>
            </div>
          </div>

          {/* Glowing Shimmer Progress Bar */}
          <div className="mt-4 w-full bg-slate-100 rounded-full h-2.5 overflow-hidden p-0.5 border border-[#D1DEFF] shadow-inner relative">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#10338D] via-[#2563EB] to-emerald-400 transition-all duration-500 relative overflow-hidden"
              style={{ width: `${Math.max(genProgress, 6)}%` }}
            >
              <div className="absolute inset-0 bg-white/25 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {showWorkspace && (<>
        {/* AI Token Usage & Cost KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
            <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
              <Cpu className="w-3.5 h-3.5 text-teal-600" />
              <span>Tokens Consumed</span>
            </div>
            <div className="text-xl font-black text-[#10338D] font-mono mt-1">
              {aiUsage?.tokensUsed ? aiUsage.tokensUsed.toLocaleString() : "0"}
            </div>
            <div className="text-[10px] font-semibold text-teal-600 mt-0.5">Gemini AI</div>
          </div>

          <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
            <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              <span>AI LLM Cost</span>
            </div>
            <div className="text-xl font-black text-emerald-600 font-mono mt-1">
              {aiUsage?.aiCostFormatted || "$0.00"}
            </div>
            <div className="text-[10px] font-semibold text-emerald-600 mt-0.5">Estimated Spend</div>
          </div>

          <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
            <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
              <ArrowRight className="w-3.5 h-3.5 text-amber-600 rotate-90" />
              <span>Prompt / Completion</span>
            </div>
            <div className="text-xl font-black text-[#10338D] font-mono mt-1">
              {aiUsage?.promptTokens ? aiUsage.promptTokens.toLocaleString() : "0"} / {aiUsage?.completionTokens ? aiUsage.completionTokens.toLocaleString() : "0"}
            </div>
            <div className="text-[10px] font-semibold text-amber-600 mt-0.5">Input vs Output Tokens</div>
          </div>

          <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
            <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-[#1C58F6]" />
              <span>AI Calls</span>
            </div>
            <div className="text-xl font-black text-[#10338D] font-mono mt-1">{aiUsage?.aiCalls || 0}</div>
            <div className="text-[10px] font-semibold text-[#1C58F6] mt-0.5">Generate + Refine</div>
          </div>
        </div>

        {/* Monaco Editor IDE Section */}
        <div ref={editorSectionRef} className="bg-white rounded-2xl border border-[#D1DEFF] shadow-sm overflow-hidden">
          {/* Editor Title Bar */}
          <div className="px-6 py-3.5 border-b border-[#D1DEFF] bg-[#F8FAFC] flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-bold text-[#1E1E1E]">
                2. Review & Edit
              </h2>
              <span className="text-[10px] text-[#64748B] bg-white border border-[#CBD5E1] px-2 py-0.5 rounded-md font-mono">
                {Object.keys(fileContent).length} Files Generated
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {saveStatus === "saving" && (
                <span className="text-xs text-[#64748B] flex items-center space-x-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-xs text-emerald-600 font-semibold flex items-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved to Disk</span>
                </span>
              )}
              {activeTab && (
                <button
                  onClick={() => saveFileToDisk(activeTab)}
                  className="px-3 py-1.5 rounded-lg border border-[#D1DEFF] hover:border-[#10338D] bg-white text-[#10338D] text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                  title="Save current file (Ctrl+S)"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              )}

              {/* IDE Project Export & External Sync Actions */}
              <div className="flex items-center space-x-2 pl-2 border-l border-[#CBD5E1]">
                <button
                  onClick={handleDownloadZip}
                  className="px-3.5 py-1.5 rounded-lg bg-[#10338D] hover:bg-[#1C58F6] text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                  title="Download full project as ZIP archive"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download ZIP</span>
                </button>

                <button
                  onClick={() => setShowCodeServerLogin(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#007acc] hover:bg-[#1e9cf1] text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                  title="Sign in to Code Server and open project in VS Code"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>VS Code</span>
                </button>

                <button
                  onClick={() => {
                    setShowGitModal(true);
                    setGitStep(1);
                    setGitError("");
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-[#ECEFFF] text-[#10338D] border border-[#D1DEFF] text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                  title="Export project to GitHub repository"
                >
                  <GitPullRequest className="w-3.5 h-3.5 text-[#1C58F6]" />
                  <span>Export to Git</span>
                </button>
              </div>
            </div>
          </div>

          {diskWarning && (
            <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-[11.5px] text-amber-800 flex items-start justify-between gap-3">
              <span>{diskWarning}</span>
              <button onClick={() => setDiskWarning("")} className="text-amber-700 hover:text-amber-900 shrink-0 cursor-pointer" title="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* IDE Container */}
          <div
            className={
              isFullscreen
                ? "fixed inset-0 z-50 flex flex-col bg-[#1e1e1e]"
                : "flex flex-col border-t border-[#1e1e1e]"
            }
            style={
              !isFullscreen
                ? { height: "540px", background: "#1e1e1e" }
                : {}
            }
          >
            <div className="flex flex-1 overflow-hidden">
              {/* Activity Bar */}
              <div className="w-12 bg-[#333333] flex flex-col items-center py-2 gap-1 border-r border-[#252526] shrink-0">
                <button
                  title="Explorer"
                  className="w-10 h-10 flex items-center justify-center rounded text-white border-l-2 border-white bg-[#252526]"
                >
                  <Layers className="w-5 h-5" />
                </button>
              </div>

              {/* File Explorer Tree */}
              <div className="w-64 bg-[#252526] flex flex-col border-r border-[#1e1e1e] shrink-0 overflow-hidden select-none">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e1e]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#bbb]">
                    Explorer
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      title="New File"
                      onClick={() => setCreating({ parentPath: "", type: "file" })}
                      className="text-[#858585] hover:text-white p-0.5 rounded cursor-pointer"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="New Folder"
                      onClick={() => setCreating({ parentPath: "", type: "folder" })}
                      className="text-[#858585] hover:text-white p-0.5 rounded cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#888] border-b border-[#1e1e1e]">
                  {projectName}
                </div>

                {/* Tree Content */}
                <div className="flex-1 overflow-y-auto py-1 px-1 text-[#cccccc]">
                  {creating && creating.parentPath === "" && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5">
                      <InlineInput
                        defaultValue=""
                        onConfirm={handleCreateConfirm}
                        onCancel={() => setCreating(null)}
                      />
                    </div>
                  )}

                  {treeRootKeys.length === 0 && !creating ? (
                    <div className="p-6 text-center text-[#777] text-xs space-y-2 mt-12">
                      <FileCode className="w-8 h-8 text-[#555] mx-auto mb-2" />
                      <p className="font-semibold text-[#aaa]">No Models Generated Yet</p>
                      <p className="text-[10px] text-[#666]">
                        Enter requirements above and click "Generate dbt Models with AI".
                      </p>
                    </div>
                  ) : (
                    treeRootKeys.map((name) => (
                      <TreeNode
                        key={name}
                        name={name}
                        node={fileTree[name]}
                        path=""
                        selectedFile={activeTab}
                        onSelectFile={openFile}
                        depth={0}
                        renaming={renaming}
                        onRenameConfirm={handleRenameConfirm}
                        onRenameCancel={() => setRenaming(null)}
                        setRenaming={setRenaming}
                        openFolders={openFolders}
                        onToggleFolder={toggleFolder}
                        creating={creating}
                        setCreating={setCreating}
                        handleCreateConfirm={handleCreateConfirm}
                        handleDelete={handleDelete}
                        onOpenInVsCode={openInVsCode}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Monaco Editor Container */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
                {/* Tabs Bar */}
                <div className="flex items-center bg-[#252526] border-b border-[#1e1e1e] overflow-x-auto shrink-0 select-none">
                  {openTabs.map((tab) => {
                    const fname = tab.split("/").pop();
                    const isDirty = dirtyTabs.has(tab);
                    const isActive = activeTab === tab;
                    return (
                      <div
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={
                          "flex items-center gap-1.5 px-3 py-2 border-r border-[#1e1e1e] cursor-pointer shrink-0 transition-colors group " +
                          (isActive
                            ? "bg-[#1e1e1e] text-[#cccccc] border-t-2 border-t-[#007acc]"
                            : "text-[#858585] hover:bg-[#2d2d2d] hover:text-[#cccccc]")
                        }
                        style={{ minWidth: 110, maxWidth: 200 }}
                        title={tab}
                      >
                        <span className="text-[11px] shrink-0">{getFileIcon(fname)}</span>
                        <span className="text-[12px] truncate">{fname}</span>
                        {isDirty && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 ml-0.5" />
                        )}
                        <button
                          onClick={(e) => closeTab(tab, e)}
                          className={
                            "ml-auto shrink-0 rounded p-0.5 " +
                            (isActive
                              ? "opacity-70 hover:opacity-100 hover:bg-[#3d3d3d]"
                              : "opacity-0 group-hover:opacity-70 hover:bg-[#3d3d3d]")
                          }
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  {openTabs.length === 0 && (
                    <div className="text-[#555] text-xs px-4 py-2">
                      No files open. Click a file on the left to edit.
                    </div>
                  )}
                </div>

                {/* Editor Active File Bar */}
                {activeTab && (
                  <div className="flex items-center justify-between bg-[#2d2d2d] border-b border-[#1e1e1e] px-3 py-1.5 shrink-0 select-none">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#9cdcfe] font-mono truncate">
                        {activeTab}
                      </span>
                      {dirtyTabs.has(activeTab) && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.2 rounded border border-amber-500/30">
                          Modified
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#888] font-mono">
                      {getLanguage(activeTab).toUpperCase()} | UTF-8
                    </div>
                  </div>
                )}

                {/* Editor Workspace */}
                <div className="flex-1 relative overflow-hidden">
                  {activeTab ? (
                    <Editor
                      height="100%"
                      language={getLanguage(activeTab)}
                      value={fileContent[activeTab] || ""}
                      onChange={handleEditorChange}
                      onMount={(editorInstance, monacoInstance) => {
                        editorRef.current = editorInstance;
                        monacoRef.current = monacoInstance;
                      }}
                      theme="vs-dark"
                      options={{
                        fontSize: 12.5,
                        fontFamily:
                          "'Fira Code', 'Cascadia Code', Consolas, monospace",
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        lineNumbers: "on",
                        automaticLayout: true,
                        tabSize: 2
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-[#555] space-y-3">
                      <Code2 className="w-12 h-12 text-[#444]" />
                      <p className="text-sm font-medium text-[#777]">
                        Select a file from the explorer or generate models above
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between bg-[#007acc] text-white px-3 py-0.5 text-[11px] shrink-0 gap-4">
              <div className="flex items-center gap-3">
                <span>{projectName}</span>
              </div>
              <div className="flex items-center gap-4">
                {activeTab && <span className="font-mono">{getLanguage(activeTab).toUpperCase()}</span>}
                {activeTab && <span>UTF-8</span>}
                <span className="opacity-75">Ctrl+S to save</span>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="flex items-center gap-1 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                  title="Toggle Fullscreen"
                >
                  {isFullscreen ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>)}


      {/* VS Code Connect Panel */}
      {filesList.length > 0 && (
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
            <button
              onClick={() => setShowCodeServerLogin(true)}
              className="flex items-center gap-1.5 text-xs px-3.5 py-2 bg-[#252526] hover:bg-[#3d3d3d] text-[#4ec9b0] rounded-lg font-semibold border border-[#454545] transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" /> Sign in to Code Server
            </button>
          </div>
        </div>
      )}

      {/* Code Server Login Modal */}
      {showCodeServerLogin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#333] flex items-center justify-between bg-[#252526]">
              <div className="flex items-center gap-2 text-[#cccccc] font-semibold text-sm">
                <Code2 className="w-4 h-4 text-[#4ec9b0]" />
                Code Server Authentication
              </div>
              <button onClick={() => setShowCodeServerLogin(false)} className="text-[#858585] hover:text-[#cccccc] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Username</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#555] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="cs_auth_username_field"
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                    value={csUsername}
                    onChange={(e) => setCsUsername(e.target.value)}
                    className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg pl-9 pr-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                    placeholder="e.g. coder, developer, or admin"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#555] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    name="cs_auth_password_field"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-form-type="other"
                    value={csPassword}
                    onChange={(e) => setCsPassword(e.target.value)}
                    className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg pl-9 pr-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                    placeholder="Enter your Code Server password"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#333] bg-[#252526] flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCodeServerLogin(false)}
                className="px-4 py-2 text-xs font-semibold text-[#cccccc] hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setCsConnecting(true);
                  setTimeout(async () => {
                    setCsConnecting(false);
                    setShowCodeServerLogin(false);
                    if (fileContent && Object.keys(fileContent).length > 0) {
                      await cloudModSyncProject(fileContent);
                    }
                    const res = await cloudModGetVscodeUri("");
                    if (res?.folderUri) {
                      window.location.href = res.folderUri;
                    } else {
                      alert("Could not retrieve VS Code URI");
                    }
                  }, 1500);
                }}
                disabled={!csUsername || !csPassword || csConnecting}
                className="px-4 py-2 text-xs font-semibold bg-[#007acc] hover:bg-[#1e9cf1] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
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
              <button onClick={() => setShowGitModal(false)} className="text-[#858585] hover:text-[#cccccc] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {gitStep === 1 && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">GitHub repository</label>
                    <input
                      type="text"
                      name="gh_repo_target_path"
                      autoComplete="off"
                      data-lpignore="true"
                      data-form-type="other"
                      value={gitConfig.repo}
                      onChange={(e) => setGitConfig({ ...gitConfig, repo: e.target.value })}
                      className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                      placeholder="e.g. organization/repository-name or https://github.com/org/repo"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Personal Access Token (PAT)</label>
                    <input
                      type="password"
                      name="gh_token_secret_pat"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={gitConfig.token}
                      onChange={(e) => setGitConfig({ ...gitConfig, token: e.target.value })}
                      className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                      placeholder="e.g. ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_xxxx"
                    />
                    <p className="text-[10px] text-[#858585] mt-1.5 leading-relaxed">
                      Classic PAT needs the <span className="text-[#cccccc]">repo</span> scope. Fine-grained PAT needs Contents: Read and write on this repository.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Branch</label>
                      <input
                        type="text"
                        name="gh_branch_target"
                        autoComplete="off"
                        data-lpignore="true"
                        data-form-type="other"
                        value={gitConfig.branch}
                        onChange={(e) => setGitConfig({ ...gitConfig, branch: e.target.value })}
                        className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                        placeholder="e.g. main"
                      />
                    </div>
                    <div className="flex-[2]">
                      <label className="block text-[11px] font-semibold text-[#858585] uppercase tracking-wider mb-1.5">Commit Message</label>
                      <input
                        type="text"
                        name="gh_commit_msg_target"
                        autoComplete="off"
                        data-lpignore="true"
                        data-form-type="other"
                        value={gitConfig.commitMsg}
                        onChange={(e) => setGitConfig({ ...gitConfig, commitMsg: e.target.value })}
                        className="w-full bg-[#2d2d2d] border border-[#454545] text-[#cccccc] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                        placeholder="e.g. Export dbt project from Data Modernization"
                      />
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
                  <a
                    href={gitStatus?.prUrl || `https://github.com/${gitConfig.repo.replace(/^https?:\/\//, '').replace(/^github\.com\//i, '').replace(/\.git$/, '')}/tree/${gitConfig.branch}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-xs text-[#1C58F6] hover:underline font-semibold flex items-center gap-1"
                  >
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
                  <button
                    onClick={() => setShowGitModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-[#cccccc] hover:text-white transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setGitError("");
                      setGitStep(2);
                      if (fileContent && Object.keys(fileContent).length > 0) {
                        await cloudModSyncProject(fileContent);
                      }
                      const res = await cloudModExportToGit(gitConfig.repo, gitConfig.token, gitConfig.branch, gitConfig.commitMsg);
                      if (res && res.status === "success") {
                        setGitStatus(res);
                        setGitStep(3);
                      } else {
                        setGitError(res?.error || "Git push failed. Check the repository URL, branch, and token permissions.");
                        setGitStep(1);
                      }
                    }}
                    disabled={!gitConfig.repo || !gitConfig.token}
                    className="px-4 py-2 text-xs font-semibold bg-[#1C58F6] hover:bg-[#10338D] disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    Connect & Push
                  </button>
                </>
              )}
              {gitStep === 3 && (
                <button
                  onClick={() => setShowGitModal(false)}
                  className="px-4 py-2 text-xs font-semibold bg-[#333] hover:bg-[#444] text-white rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
