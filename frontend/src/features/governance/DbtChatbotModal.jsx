import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  X,
  Trash2,
  Copy,
  Check,
  Database,
  Code,
  Table,
  ChevronDown,
  ChevronUp,
  Zap,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { sendMonitoringChatMessage } from '@/api';

// Source-aware copilot: the same modal serves whichever source's dashboard is open.
const DEFAULT_SUGGESTIONS = [
  "Summarize the health of this source",
  "Which jobs failed most recently?",
  "What are the slowest runs and why?",
  "What should we fix first on this dashboard?"
];

const historyKey = (sourceId) => `gov_monitoring_chat_history:${sourceId}`;

const welcomeMessage = (displayName, targetDatabase, targetSchema) => ({
  id: 'welcome',
  role: 'assistant',
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  content: `👋 Hello! I am your **${displayName} AI Copilot**.\n\nI answer questions using this source's own tables and AI-selected KPIs in **${targetDatabase}.${targetSchema}**, with read-only Snowflake access.\n\nHow can I help analyze your pipelines today?`,
  suggestedQuestions: DEFAULT_SUGGESTIONS.slice(0, 3)
});

const loadHistory = (sourceId, displayName, targetDatabase, targetSchema) => {
  try {
    const saved = localStorage.getItem(historyKey(sourceId));
    if (saved) return JSON.parse(saved);
  } catch {}
  return [welcomeMessage(displayName, targetDatabase, targetSchema)];
};

export default function DbtChatbotModal({
  isOpen,
  onClose,
  sourceId,
  sourceType,
  displayName = 'Pipeline',
  targetDatabase = 'DBT_MONITORING',
  targetSchema = 'METADATA'
}) {
  const [messages, setMessages] = useState(() => loadHistory(sourceId, displayName, targetDatabase, targetSchema));
  const [historySourceId, setHistorySourceId] = useState(sourceId);

  // Switching dashboards swaps in that source's own conversation.
  useEffect(() => {
    if (sourceId !== historySourceId) {
      setMessages(loadHistory(sourceId, displayName, targetDatabase, targetSchema));
      setHistorySourceId(sourceId);
    }
  }, [sourceId]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [expandedTableIndex, setExpandedTableIndex] = useState({});
  const [isExpanded, setIsExpanded] = useState(false);
  const chatBottomRef = useRef(null);
  const inputRef = useRef(null);

  // Sync with localStorage
  useEffect(() => {
    if (historySourceId !== sourceId) return;
    try {
      localStorage.setItem(historyKey(sourceId), JSON.stringify(messages));
    } catch {}
  }, [messages, historySourceId]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, messages]);

  const handleSend = async (userPrompt) => {
    const text = (userPrompt || input).trim();
    if (!text || loading) return;

    const userMsg = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Build conversation history payload
      const historyPayload = messages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const res = await sendMonitoringChatMessage(sourceType, {
        sourceId,
        message: text,
        history: historyPayload
      });

      const assistantMsg = {
        id: `ast_${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: res.reply || 'Analysis complete.',
        sql: res.sql,
        queryResults: res.query_results,
        executionSource: res.execution_source,
        suggestedQuestions: res.suggested_questions || DEFAULT_SUGGESTIONS.slice(0, 3)
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `⚠️ **Error querying Snowflake ${targetDatabase}:**\n${err.message || 'Please verify backend and connection settings.'}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    const initialMsg = [
      {
        id: 'welcome',
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `🧹 Chat history cleared.\n\nAsk any question about **${displayName}** in **${targetDatabase}.${targetSchema}**.`,
        suggestedQuestions: DEFAULT_SUGGESTIONS.slice(0, 4)
      }
    ];
    setMessages(initialMsg);
    localStorage.removeItem(historyKey(sourceId));
  };

  const handleCopySql = (sqlText, idx) => {
    navigator.clipboard.writeText(sqlText);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const toggleTableExpand = (msgId) => {
    setExpandedTableIndex(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end p-0 sm:p-6 bg-black/40 backdrop-blur-xs transition-all animate-in fade-in">
      <div 
        className={`bg-white shadow-2xl rounded-t-2xl sm:rounded-2xl border border-[#CBD5E1] flex flex-col transition-all duration-300 w-full ${
          isExpanded 
            ? 'sm:w-[92vw] sm:max-w-4xl h-[95vh]' 
            : 'sm:w-[540px] h-[85vh] sm:max-h-[750px]'
        }`}
      >
        {/* ============================================================ */}
        {/* HEADER */}
        {/* ============================================================ */}
        <div className="bg-gradient-to-r from-[#10338D] via-[#0D266B] to-[#071339] text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <Sparkles className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm tracking-tight text-white">{displayName} AI Copilot</h3>
                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#1C58F6]/40 text-[#93C5FD] border border-[#60A5FA]/30">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-[#A3B4DB] font-mono flex items-center space-x-1 mt-0.5">
                <Database className="w-3 h-3 text-[#93C5FD]" />
                <span>{targetDatabase}.{targetSchema}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={handleClearHistory}
              title="Clear conversation history"
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Collapse width" : "Expand width"}
              className="hidden sm:block p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* MESSAGES LIST */}
        {/* ============================================================ */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F8FAFC]">
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            const isTableExpanded = expandedTableIndex[m.id] !== false; // expanded by default

            return (
              <div
                key={m.id || idx}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
              >
                <div className="flex items-center space-x-1.5 text-[10px] text-[#94A3B8] px-1 font-mono">
                  <span>{isUser ? 'You' : 'AI Copilot'}</span>
                  <span>&middot;</span>
                  <span>{m.timestamp}</span>
                  {m.executionSource === 'live_snowflake' && (
                    <span className="text-[#10B981] font-bold">Snowflake Live</span>
                  )}
                </div>

                {isUser ? (
                  <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-xs bg-[#10338D] text-white rounded-tr-xs font-sans font-medium">
                    <p className="text-white whitespace-pre-wrap selection:bg-white/30">{m.content}</p>
                  </div>
                ) : (
                  <div className="max-w-[92%] sm:max-w-[88%] rounded-2xl p-4 text-xs leading-relaxed shadow-xs transition-all bg-white border border-[#E2E8F0] text-[#1E293B] rounded-tl-xs space-y-3">
                    {/* Assistant Text */}
                    <div className="space-y-2 text-xs leading-relaxed text-[#1E293B]">
                      {m.content.split('\n\n').map((block, bIdx) => {
                        const lines = block.split('\n');
                        
                        // Heading 3
                        if (lines[0].startsWith('### ')) {
                          return (
                            <div key={bIdx} className="space-y-1">
                              <h4 className="font-bold text-sm text-[#10338D] border-b border-[#E2E8F0] pb-1 mt-1">
                                {lines[0].replace('### ', '')}
                              </h4>
                              {lines.slice(1).map((l, lIdx) => (
                                <p key={lIdx} className="text-[#334155]">{l}</p>
                              ))}
                            </div>
                          );
                        }

                        // Bullet list block
                        if (lines.some(l => l.trim().startsWith('* ') || l.trim().startsWith('- '))) {
                          return (
                            <ul key={bIdx} className="space-y-1.5 pl-1 my-1">
                              {lines.map((l, lIdx) => {
                                const cleanLine = l.trim().replace(/^[*\-]\s+/, '');
                                if (!cleanLine) return null;
                                return (
                                  <li key={lIdx} className="flex items-start space-x-2 text-[#334155]">
                                    <span className="text-[#10338D] font-black text-sm leading-none mt-0.5">&bull;</span>
                                    <span className="flex-1">
                                      {cleanLine.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, pIdx) => {
                                        if (part.startsWith('**') && part.endsWith('**')) {
                                          return <strong key={pIdx} className="font-bold text-[#0F172A]">{part.slice(2, -2)}</strong>;
                                        }
                                        if (part.startsWith('`') && part.endsWith('`')) {
                                          return <code key={pIdx} className="px-1.5 py-0.5 bg-[#F1F5F9] text-[#10338D] rounded font-mono text-[11px] font-semibold">{part.slice(1, -1)}</code>;
                                        }
                                        return part;
                                      })}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        }

                        // Regular paragraph with inline formatting
                        return (
                          <p key={bIdx} className="text-[#334155]">
                            {block.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, pIdx) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={pIdx} className="font-bold text-[#0F172A]">{part.slice(2, -2)}</strong>;
                              }
                              if (part.startsWith('`') && part.endsWith('`')) {
                                return <code key={pIdx} className="px-1.5 py-0.5 bg-[#F1F5F9] text-[#10338D] rounded font-mono text-[11px] font-semibold">{part.slice(1, -1)}</code>;
                              }
                              return part;
                            })}
                          </p>
                        );
                      })}
                    </div>

                  {/* SQL Snippet Block */}
                  {m.sql && (
                    <div className="bg-[#0A1128] text-[#E2E8F0] rounded-xl p-3 border border-[#1E293B] font-mono text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-[#94A3B8] border-b border-white/10 pb-1.5">
                        <div className="flex items-center space-x-1.5 text-[#60A5FA]">
                          <Code className="w-3.5 h-3.5" />
                          <span className="font-bold uppercase tracking-wider">Executed Snowflake SQL</span>
                        </div>
                        <button
                          onClick={() => handleCopySql(m.sql, idx)}
                          className="inline-flex items-center space-x-1 text-[#93C5FD] hover:text-white transition-colors cursor-pointer"
                        >
                          {copiedIndex === idx ? (
                            <>
                              <Check className="w-3 h-3 text-[#10B981]" />
                              <span className="text-[#10B981]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="overflow-x-auto text-[#93C5FD] py-1">
                        <code>{m.sql}</code>
                      </div>
                    </div>
                  )}

                  {/* Result Data Table */}
                  {m.queryResults && m.queryResults.rows && m.queryResults.rows.length > 0 && (
                    <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white shadow-xs">
                      <div 
                        onClick={() => toggleTableExpand(m.id)}
                        className="bg-[#F1F5F9] px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-[#E2E8F0] transition-colors"
                      >
                        <div className="flex items-center space-x-1.5 text-[11px] font-bold text-[#1E293B]">
                          <Table className="w-3.5 h-3.5 text-[#1C58F6]" />
                          <span>Query Results ({m.queryResults.row_count || m.queryResults.rows.length} rows)</span>
                        </div>
                        <div className="flex items-center space-x-1 text-[10px] text-[#64748B]">
                          <span>{isTableExpanded ? 'Collapse' : 'Expand'}</span>
                          {isTableExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </div>
                      </div>

                      {isTableExpanded && (
                        <div className="overflow-x-auto max-h-56">
                          <table className="w-full text-left text-[10.5px]">
                            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0">
                              <tr>
                                {m.queryResults.columns.map((col, cIdx) => (
                                  <th key={cIdx} className="py-2 px-2.5 font-bold text-[#475569] uppercase font-mono tracking-tight whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F1F5F9] font-mono">
                              {m.queryResults.rows.map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-[#F8FAFC] transition-colors">
                                  {m.queryResults.columns.map((col, cIdx) => (
                                    <td key={cIdx} className="py-1.5 px-2.5 text-[#1E293B] whitespace-nowrap">
                                      {String(row[col] !== undefined && row[col] !== null ? row[col] : '-')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Follow-up Suggestion Chips */}
                  {!isUser && m.suggestedQuestions && m.suggestedQuestions.length > 0 && (
                    <div className="pt-2 border-t border-[#F1F5F9] space-y-1.5">
                      <div className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider flex items-center space-x-1">
                        <Zap className="w-3 h-3 text-[#F59E0B]" />
                        <span>Suggested Next Questions</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.suggestedQuestions.map((q, qIdx) => (
                          <button
                            key={qIdx}
                            onClick={() => handleSend(q)}
                            disabled={loading}
                            className="text-[11px] font-medium text-[#10338D] bg-[#ECEFFF] hover:bg-[#D1DEFF] border border-[#D1DEFF] px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-left"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
          })}

          {/* Loading Indicator Bubble */}
          {loading && (
            <div className="flex flex-col items-start space-y-1 animate-pulse">
              <div className="flex items-center space-x-1.5 text-[10px] text-[#94A3B8] px-1 font-mono">
                <span>AI Copilot</span>
                <span>&middot;</span>
                <span>Thinking & Querying Snowflake...</span>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-2xl rounded-tl-xs p-4 shadow-xs flex items-center space-x-3 text-xs text-[#64748B]">
                <div className="w-4 h-4 border-2 border-[#10338D] border-t-transparent rounded-full animate-spin" />
                <span>Analyzing metadata schema & generating Snowflake SQL query...</span>
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* ============================================================ */}
        {/* INPUT BAR */}
        {/* ============================================================ */}
        <div className="p-3.5 bg-white border-t border-[#E2E8F0] rounded-b-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center space-x-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask anything about ${displayName} jobs, runs, KPIs, or failures...`}
              disabled={loading}
              className="flex-1 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-4 py-2.5 text-xs text-[#1E293B] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#10338D]/20 focus:border-[#10338D] transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className={`p-2.5 rounded-xl font-bold transition-all cursor-pointer flex items-center justify-center ${
                input.trim() && !loading
                  ? 'bg-gradient-to-r from-[#10338D] to-[#1C58F6] text-white shadow-md hover:shadow-lg'
                  : 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="flex items-center justify-between text-[10px] text-[#94A3B8] mt-2 px-1">
            <span>Powered by Relanto AI &middot; Read-only Snowflake Access</span>
            <span className="hidden sm:inline font-mono">Press Enter ↵ to ask</span>
          </div>
        </div>
      </div>
    </div>
  );
}
