import React from 'react';

// Deprecated and removed per user directive. Step 2 is now Prompt Configuration.
export default function Step2SourceOverview() {
  return null;
}
  
  // Metadata state
  const [metadata, setMetadata] = useState({
    summary: { workflowCount: 12, mappingCount: 28, sourceTables: 34, targetTables: 18, lookupTables: 14, transformationsDetected: 142 },
    workflows: [
      { id: 'wf_customer_360', name: 'wf_mktg_customer_360', folder: 'GLOBAL_EDW_MKTG', mappings: ['m_stg_customers', 'm_dim_customer_scd2', 'm_fact_orders_daily'] },
      { id: 'wf_billing_recon', name: 'wf_finance_billing_recon', folder: 'FINANCE_CORE', mappings: ['m_stg_invoices', 'm_fct_monthly_billing'] }
    ],
    mappings: [
      {
        id: 'm_dim_customer_scd2',
        name: 'm_dim_customer_scd2',
        source: 'SRC_RAW_CUSTOMERS (Oracle)',
        target: 'DIM_CUSTOMER (Snowflake)',
        joins: ['SRC_RAW_CUSTOMERS INNER JOIN LKP_GEO_LOC ON SRC_RAW_CUSTOMERS.ZIP = LKP_GEO_LOC.ZIP_CODE'],
        lookups: ['LKP_GEO_LOC', 'LKP_CURRENCY_RATES'],
        filters: ["SRC_RAW_CUSTOMERS.IS_ACTIVE = 'Y'", "SRC_RAW_CUSTOMERS.CREATED_DATE >= '2020-01-01'"],
        expressions: [
          "FULL_NAME = CONCAT(FIRST_NAME, ' ', LAST_NAME)",
          "HASH_KEY = MD5(CONCAT(CUST_ID, FIRST_NAME, LAST_NAME, EMAIL))",
          "EFFECTIVE_FROM = NVL(UPDATED_AT, CREATED_AT)"
        ],
        columns: [
          { source: "CUST_ID", target: "CUSTOMER_ID", transformation: "DIRECT_MAP" },
          { source: "FIRST_NAME", target: "FIRST_NAME", transformation: "UPPER(TRIM())" },
          { source: "LAST_NAME", target: "LAST_NAME", transformation: "UPPER(TRIM())" },
          { source: "EMAIL_ADDR", target: "EMAIL", transformation: "LOWER()" },
          { source: "SYS_UPDATED_TS", target: "VALID_FROM", transformation: "SCD2_EFFECTIVE_DATE" }
        ]
      }
    ],
    tables: [
      {
        id: 'tbl_1',
        tableName: 'RAW_CUSTOMERS',
        database: 'EDW_STAGE',
        schema: 'LANDING',
        type: 'Source',
        columns: [
          { name: 'CUST_ID', datatype: 'VARCHAR(50)', isPk: true, edited: false },
          { name: 'FIRST_NAME', datatype: 'VARCHAR(100)', isPk: false, edited: false },
          { name: 'LAST_NAME', datatype: 'VARCHAR(100)', isPk: false, edited: false },
          { name: 'EMAIL_ADDR', datatype: 'VARCHAR(255)', isPk: false, edited: false },
          { name: 'SYS_UPDATED_TS', datatype: 'TIMESTAMP_NTZ', isPk: false, edited: false }
        ]
      },
      {
        id: 'tbl_2',
        tableName: 'DIM_CUSTOMER',
        database: 'EDW_ANALYTICS',
        schema: 'CORE',
        type: 'Target',
        columns: [
          { name: 'CUSTOMER_SK', datatype: 'NUMBER(38,0)', isPk: true, edited: true },
          { name: 'CUSTOMER_ID', datatype: 'VARCHAR(50)', isPk: false, edited: false },
          { name: 'FULL_NAME', datatype: 'VARCHAR(200)', isPk: false, edited: false },
          { name: 'EMAIL', datatype: 'VARCHAR(255)', isPk: false, edited: false },
          { name: 'VALID_FROM', datatype: 'TIMESTAMP_NTZ', isPk: false, edited: false },
          { name: 'VALID_TO', datatype: 'TIMESTAMP_NTZ', isPk: false, edited: false },
          { name: 'IS_CURRENT', datatype: 'BOOLEAN', isPk: false, edited: false }
        ]
      }
    ],
    aiDetections: {
      scdType: 'SCD Type 2',
      loadStrategy: 'Incremental Load',
      mergeStrategy: 'Merge on Surrogate Key',
      timestampStrategy: 'SYS_UPDATED_TS',
      checkStrategy: 'MD5 Hash Comparison',
      confidenceScore: 98.4
    }
  });

  // Edit Mode state
  const [editingTableId, setEditingTableId] = useState(null);
  const [editingTableData, setEditingTableData] = useState(null);
  const [editedBadgeCount, setEditedBadgeCount] = useState(1);

  useEffect(() => {
    fetchMetadata().then(res => {
      if (res) setMetadata(res);
    });
  }, []);

  const startEditTable = (tbl) => {
    setEditingTableId(tbl.id);
    setEditingTableData(JSON.parse(JSON.stringify(tbl)));
  };

  const handleSaveEdit = async () => {
    if (!editingTableData) return;
    
    // Mark edited columns
    editingTableData.columns = editingTableData.columns.map(col => ({
      ...col,
      edited: true
    }));

    setMetadata(prev => ({
      ...prev,
      tables: prev.tables.map(t => t.id === editingTableId ? editingTableData : t)
    }));

    await editMetadata(editingTableId, editingTableData);
    setEditedBadgeCount(prev => prev + 1);
    setEditingTableId(null);
  };

  const handleOverrideScd = (key, val) => {
    setMetadata(prev => ({
      ...prev,
      aiDetections: {
        ...prev.aiDetections,
        [key]: val
      }
    }));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-xs font-semibold border border-emerald-500/20 mb-2">
            <span>Step 2 of 5 • Modernization Inspection</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Source Overview & AI AST Inspector</h1>
          <p className="text-sm text-slate-400 mt-1">
            Review parsed workflows, mappings, table definitions, and override AI-detected SCD strategies.
          </p>
        </div>

        <button
          onClick={onNext}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
        >
          <span>Continue to Prompt Configuration</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Header Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Workflows</div>
          <div className="text-2xl font-black text-white font-mono mt-1">{metadata.summary.workflowCount}</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">100% Parsed</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Mappings</div>
          <div className="text-2xl font-black text-white font-mono mt-1">{metadata.summary.mappingCount}</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">Clean AST</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Source Tables</div>
          <div className="text-2xl font-black text-slate-100 font-mono mt-1">{metadata.summary.sourceTables}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Landing Schema</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Target Tables</div>
          <div className="text-2xl font-black text-emerald-400 font-mono mt-1">{metadata.summary.targetTables}</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">dbt Target</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Lookups</div>
          <div className="text-2xl font-black text-teal-400 font-mono mt-1">{metadata.summary.lookupTables}</div>
          <div className="text-[10px] text-teal-400 mt-0.5">Join Refs</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Transformations</div>
          <div className="text-2xl font-black text-white font-mono mt-1">{metadata.summary.transformationsDetected}</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">Refactored</div>
        </div>
      </div>

      {/* Overview Main Body — Left Nav + Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Navigation inside Overview */}
        <div className="lg:col-span-3 space-y-2">
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
            <div className="text-[11px] font-semibold uppercase text-slate-500 px-3 py-1">Overview Views</div>
            
            <button
              onClick={() => setActiveTab('workflows')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'workflows' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center space-x-2">
                <FolderTree className="w-4 h-4" />
                <span>Workflows Explorer</span>
              </span>
              <span className="text-[10px] font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">12</span>
            </button>

            <button
              onClick={() => setActiveTab('mappings')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'mappings' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center space-x-2">
                <GitBranch className="w-4 h-4" />
                <span>Mapping Viewer</span>
              </span>
              <span className="text-[10px] font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">28</span>
            </button>

            <button
              onClick={() => setActiveTab('tables')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'tables' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center space-x-2">
                <Table className="w-4 h-4" />
                <span>Source & Target Tables</span>
              </span>
              <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/30">
                {editedBadgeCount} Edited
              </span>
            </button>

            <button
              onClick={() => setActiveTab('scd')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'scd' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center space-x-2">
                <BrainCircuit className="w-4 h-4 text-emerald-400" />
                <span>AI SCD Detection</span>
              </span>
              <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800">
                98.4%
              </span>
            </button>
          </div>
        </div>

        {/* Main Workspace Area */}
        <div className="lg:col-span-9 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
          {/* TAB 1: WORKFLOW EXPLORER */}
          {activeTab === 'workflows' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <FolderTree className="w-4 h-4 text-emerald-400" />
                  <span>Workflow Tree Structure (Workflow → Mapping → Source → Target)</span>
                </h3>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
                {metadata.workflows.map((wf) => (
                  <div key={wf.id} className="space-y-2 border-b border-slate-800/80 pb-3 last:border-0">
                    <div className="flex items-center space-x-2 text-emerald-400 font-bold">
                      <FolderTree className="w-4 h-4" />
                      <span>{wf.name}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-sans">{wf.folder}</span>
                    </div>

                    <div className="pl-6 space-y-2 border-l border-slate-800 ml-2">
                      {wf.mappings.map((m, idx) => (
                        <div key={idx} className="flex items-center space-x-2 text-slate-300">
                          <GitBranch className="w-3.5 h-3.5 text-teal-400" />
                          <span>Mapping: {m}</span>
                          <span className="text-[10px] text-slate-500">→ SRC_RAW_CUSTOMERS → DIM_CUSTOMER</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: MAPPING VIEWER */}
          {activeTab === 'mappings' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <span>Mapping AST Viewer: m_dim_customer_scd2</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Join Logic & Filters</span>
                  <div className="bg-slate-900 p-2.5 rounded border border-slate-800 font-mono text-xs text-emerald-300">
                    {metadata.mappings[0].joins[0]}
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Expressions & Refactoring</span>
                  <div className="bg-slate-900 p-2.5 rounded border border-slate-800 font-mono text-xs text-teal-300">
                    {metadata.mappings[0].expressions.join('\n')}
                  </div>
                </div>
              </div>

              {/* Column Mapping Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Source Column</th>
                      <th className="px-4 py-3">Target Column</th>
                      <th className="px-4 py-3">Transformation Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/50 font-mono">
                    {metadata.mappings[0].columns.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 text-slate-200">{c.source}</td>
                        <td className="px-4 py-2.5 text-emerald-400 font-bold">{c.target}</td>
                        <td className="px-4 py-2.5 text-teal-300">{c.transformation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: SOURCE & TARGET TABLES (EDITABLE SECTION) */}
          {activeTab === 'tables' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <Table className="w-4 h-4 text-emerald-400" />
                  <span>Metadata Table Schema Viewer (Editable)</span>
                </h3>
                <span className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                  Edit Button on Every Table
                </span>
              </div>

              {metadata.tables.map((tbl) => {
                const isEditing = editingTableId === tbl.id;
                const currentData = isEditing ? editingTableData : tbl;

                return (
                  <div key={tbl.id} className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Database className="w-5 h-5 text-emerald-400" />
                        <div>
                          {isEditing ? (
                            <input
                              type="text"
                              value={currentData.tableName}
                              onChange={(e) => setEditingTableData({ ...currentData, tableName: e.target.value })}
                              className="bg-slate-900 border border-emerald-500 rounded px-2 py-1 text-sm font-mono font-bold text-emerald-400"
                            />
                          ) : (
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-bold text-white font-mono">{tbl.tableName}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tbl.type === 'Source' ? 'bg-slate-800 text-slate-300' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'}`}>
                                {tbl.type} Table
                              </span>
                            </div>
                          )}
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            {tbl.database}.{tbl.schema}
                          </div>
                        </div>
                      </div>

                      {/* Edit / Save Buttons */}
                      <div>
                        {isEditing ? (
                          <button
                            onClick={handleSaveEdit}
                            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Save Metadata</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => startEditTable(tbl)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Edit Table & Columns</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Columns Grid Table */}
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase font-semibold">
                          <tr>
                            <th className="px-3 py-2">Column Name</th>
                            <th className="px-3 py-2">Datatype</th>
                            <th className="px-3 py-2">Primary Key / Surrogate</th>
                            <th className="px-3 py-2">Edit Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 bg-slate-950 font-mono text-[11px]">
                          {currentData.columns.map((col, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/50">
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={col.name}
                                    onChange={(e) => {
                                      const updatedCols = [...currentData.columns];
                                      updatedCols[idx].name = e.target.value;
                                      setEditingTableData({ ...currentData, columns: updatedCols });
                                    }}
                                    className="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-emerald-300 w-full"
                                  />
                                ) : (
                                  <span className="font-semibold text-slate-200">{col.name}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-400">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={col.datatype}
                                    onChange={(e) => {
                                      const updatedCols = [...currentData.columns];
                                      updatedCols[idx].datatype = e.target.value;
                                      setEditingTableData({ ...currentData, columns: updatedCols });
                                    }}
                                    className="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-slate-300 w-full"
                                  />
                                ) : (
                                  col.datatype
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {col.isPk ? (
                                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                                    PK
                                  </span>
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {col.edited ? (
                                  <span className="inline-flex items-center space-x-1 text-[9px] font-bold bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40">
                                    <Check className="w-2.5 h-2.5" />
                                    <span>Edited</span>
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-slate-500">Original</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )})}
            </div>
          )}

          {/* TAB 4: AI SCD DETECTION PANEL */}
          {activeTab === 'scd' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                    <BrainCircuit className="w-5 h-5 text-emerald-400" />
                    <span>AI Pattern Detection & Strategy Override</span>
                  </h3>
                  <p className="text-xs text-slate-400">Automated AST heuristic detection for dimension change tracking.</p>
                </div>
                <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/30">
                  Confidence Score: {metadata.aiDetections.confidenceScore}%
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Dimension SCD Strategy</label>
                  <select
                    value={metadata.aiDetections.scdType}
                    onChange={(e) => handleOverrideScd('scdType', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="SCD Type 1">SCD Type 1 (Overwrite History)</option>
                    <option value="SCD Type 2">SCD Type 2 (Full History via Snapshots)</option>
                    <option value="SCD Type 3">SCD Type 3 (Previous Column Tracking)</option>
                    <option value="SCD Type 6">SCD Type 6 (Hybrid 1+2+3)</option>
                  </select>
                  <p className="text-[10px] text-slate-400">AI Detected `SYS_UPDATED_TS` and `CURR_FLAG` columns in Informatica AST.</p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <label className="text-xs font-semibold text-slate-300">dbt Model Load Strategy</label>
                  <select
                    value={metadata.aiDetections.loadStrategy}
                    onChange={(e) => handleOverrideScd('loadStrategy', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Incremental Load">Incremental Load (unique_key merge)</option>
                    <option value="Full Load">Full Load (Table Drop & Recreate)</option>
                    <option value="Append Only">Append Only Log Load</option>
                  </select>
                  <p className="text-[10px] text-slate-400">Optimizes warehouse scan costs for large enterprise tables.</p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Timestamp Watermark Column</label>
                  <input
                    type="text"
                    value={metadata.aiDetections.timestampStrategy}
                    onChange={(e) => handleOverrideScd('timestampStrategy', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-emerald-400"
                  />
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Surrogate Key Strategy</label>
                  <input
                    type="text"
                    value={metadata.aiDetections.mergeStrategy}
                    onChange={(e) => handleOverrideScd('mergeStrategy', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-emerald-400"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
