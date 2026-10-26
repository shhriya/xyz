import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  User,
  RefreshCw,
  ChevronRight,
  X,
  Database,
} from 'lucide-react';
import { queryCfoAiAnalyst } from '@/api';

export default function CFOAIAnalyst({ dashboardData, selectedConnection, isOpen, onClose, onOpen }) {
  const persona = 'Analyst Agent';
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: `Hello! I am your ${persona}. I analyze your live Snowflake metrics for whichever schema you're connected to. Ask me any question about your data!`,
      citations: ['Live Analytics Dashboard Engine'],
      suggestions: [
        'Show me the top KPIs for this schema',
        'What tables are available in this schema?',
        'Summarize the most important trends'
      ]
    }
  ]);

  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Switching database/schema means a different agent and different data — start a clean thread
  // so earlier answers from the previous schema aren't carried into the new one as context.
  const scope = `${dashboardData?.database || ''}.${dashboardData?.schema || ''}`;
  const lastScopeRef = useRef(scope);
  useEffect(() => {
    if (lastScopeRef.current !== scope) {
      lastScopeRef.current = scope;
      setMessages([{
        sender: 'ai',
        text: `Now connected to ${scope}. Ask me anything about this schema.`,
        citations: [],
        suggestions: ['Show me the top KPIs for this schema', 'What are the most important trends?']
      }]);
    }
  }, [scope]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (questionText) => {
    const q = (questionText || inputQuestion).trim();
    if (!q || isLoading) return;

    const userMsg = { sender: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setInputQuestion('');
    setIsLoading(true);

    try {
      // Send the last two turns so the agent can resolve short follow-ups in context.
      const contextObj = {
        is_live_snowflake: true,
        connection: selectedConnection || {},
        database: dashboardData?.database,
        schema: dashboardData?.schema,
        history: messages.slice(-2).map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          text: m.text
        }))
      };
      
      const res = await queryCfoAiAnalyst(q, dashboardData?.domain, contextObj);
      if (res && res.answer) {
        setMessages(prev => [
          ...prev,
          {
            sender: 'ai',
            text: res.answer,
            sql: res.sql,
            data: res.data,
            citations: res.citations || [],
            suggestions: res.followup_suggestions || []
          }
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          {
            sender: 'ai',
            text: 'I could not get a clear answer from the connected data for that question. Try rephrasing, or check that a database/schema is selected.',
            citations: [],
            suggestions: ['Show me the top KPIs for this schema', 'What tables are available?']
          }
        ]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          sender: 'ai',
          text: 'Unable to reach the AI Analyst backend server.',
          citations: []
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* FLOATING ACTION BUTTON (Always visible at bottom right) */}
      {!isOpen && (
        <button
          onClick={onOpen}
          className="fixed bottom-6 right-6 z-40 bg-gradient-to-r from-[#10338D] via-[#1C58F6] to-emerald-600 hover:from-[#1C58F6] hover:to-emerald-500 text-white font-bold text-xs px-5 py-3.5 rounded-full shadow-2xl flex items-center space-x-2.5 border border-emerald-400/40 ring-4 ring-emerald-500/20 cursor-pointer transition-all hover:scale-105 group animate-bounce"
        >
          <div className="relative">
            <Bot className="w-5 h-5 text-white" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full" />
          </div>
          <span>Ask {persona}</span>
          <Sparkles className="w-4 h-4 text-emerald-300 group-hover:rotate-12 transition-transform" />
        </button>
      )}

      {/* SIDE DRAWER POPUP MODAL */}
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-slate-950/50 backdrop-blur-xs transition-opacity">
          {/* Backdrop click to close */}
          <div className="absolute inset-0" onClick={onClose} />

          {/* Drawer Container */}
          <div className="relative w-full sm:w-[480px] bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#10338D] to-emerald-500 flex items-center justify-center shadow-md">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                    <span>{persona}</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Side Assistant
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-400">Live Snowflake Context Q&A</p>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setMessages([
                    {
                      sender: 'ai',
                      text: 'Conversation context reset. Ask me anything about your connected dashboard data.',
                      citations: ['Live Analytics Dashboard Engine'],
                      suggestions: ['Show me the top KPIs for this schema', 'What are the most important trends?']
                    }
                  ])}
                  className="text-slate-400 hover:text-slate-200 p-1.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Reset Context"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>

                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-rose-400 p-1.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close AI Assistant"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 text-xs ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.sender === 'ai' && (
                    <div className="w-7 h-7 rounded-lg bg-[#1C58F6]/20 border border-[#1C58F6]/40 text-[#1C58F6] flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div className={`max-w-[88%] space-y-2 ${
                    msg.sender === 'user'
                      ? 'bg-[#10338D] text-white p-3.5 rounded-2xl rounded-tr-none shadow-sm font-medium'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 p-3.5 rounded-2xl rounded-tl-none shadow-sm'
                  }`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                    {/* SQL Render */}
                    {msg.sql && (
                      <div className="mt-3 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                        <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800 text-[10px] font-mono text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                           <Database className="w-3 h-3" /> Cortex Generated SQL
                        </div>
                        <pre className="p-3 text-[10px] text-slate-300 overflow-x-auto font-mono">
                          {msg.sql}
                        </pre>
                      </div>
                    )}

                    {/* Data Render */}
                    {msg.data && msg.data.length > 0 && (
                      <div className="mt-3 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-900 border-b border-slate-800">
                                {Object.keys(msg.data[0]).map((key) => (
                                  <th key={key} className="px-3 py-2 text-[10px] font-bold text-slate-300 uppercase tracking-wider whitespace-nowrap">
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {msg.data.map((row, rIdx) => (
                                <tr key={rIdx} className="border-b border-slate-800/50 hover:bg-slate-900/50">
                                  {Object.values(row).map((val, vIdx) => (
                                    <td key={vIdx} className="px-3 py-2 text-[11px] text-slate-400 whitespace-nowrap">
                                      {val !== null ? val.toString() : 'NULL'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {msg.data.length === 50 && (
                          <div className="bg-slate-900/80 px-3 py-1.5 text-[10px] text-emerald-400 border-t border-slate-800 text-center font-medium">
                            Showing first 50 rows
                          </div>
                        )}
                      </div>
                    )}

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                        <span className="text-slate-400 font-sans">Citations:</span>
                        {msg.citations.map((c, cIdx) => (
                          <span key={cIdx} className="bg-slate-950 text-emerald-400 px-2 py-0.5 rounded border border-slate-800">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Suggestions */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="pt-2 space-y-1.5">
                        <div className="text-[10px] text-slate-400 font-mono">Suggested Questions:</div>
                        <div className="flex flex-col gap-1.5">
                          {msg.suggestions.map((s, sIdx) => (
                            <button
                              key={sIdx}
                              onClick={() => handleSend(s)}
                              className="bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 border border-slate-800 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center justify-between text-left"
                            >
                              <span>{s}</span>
                              <ChevronRight className="w-3 h-3 text-slate-500 shrink-0 ml-1" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {msg.sender === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3 text-xs justify-start items-center">
                  <div className="w-7 h-7 rounded-lg bg-[#1C58F6]/20 border border-[#1C58F6]/40 text-[#1C58F6] flex items-center justify-center shrink-0">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <div className="bg-slate-900 border border-slate-800 text-slate-400 px-4 py-2 rounded-2xl text-xs font-mono animate-pulse">
                    Analyzing live finance data & calculating response...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Box Footer */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="p-4 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                placeholder={`Ask ${persona} (e.g. 'What are our top KPIs?')`}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-medium"
              />
              <button
                type="submit"
                disabled={!inputQuestion.trim() || isLoading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition-all shadow-sm cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
