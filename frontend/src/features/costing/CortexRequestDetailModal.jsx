import React, { useState } from 'react';
import { X, Copy, Check, Terminal, Clock, User, Shield, Database, Cpu, DollarSign, Layers } from 'lucide-react';
import { fmtMoney, fmtNum } from './executive/ExecOverviewPrimitives';

export default function CortexRequestDetailModal({ request, detail, loading, onClose }) {
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  if (!request) return null;

  const data = detail?.detail || request;

  const handleCopySql = () => {
    if (!data.rawSql) return;
    navigator.clipboard.writeText(data.rawSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleCopyPrompt = () => {
    const text = data.prompt || data.promptSnippet;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F1F5F9] flex items-center justify-between shrink-0 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#10338D]/10 border border-[#10338D]/20 flex items-center justify-center text-[#10338D] shrink-0 font-bold">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#0F172A] truncate">
                  Cortex AI Request Inspection
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  data.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}>
                  {data.status || 'SUCCESS'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-[#64748B] truncate mt-0.5">
                Query ID: {data.queryId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 text-xs text-[#334155] space-y-4 overflow-y-auto">
          {loading ? (
            <div className="space-y-3 py-8 text-center text-[#64748B]">
              <div className="w-6 h-6 border-2 border-[#1C58F6] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p>Fetching complete request metadata from Snowflake...</p>
            </div>
          ) : (
            <>
              {/* Meta Stats Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                    <User className="w-3 h-3 text-[#1C58F6]" /> User
                  </span>
                  <span className="text-[12px] font-bold text-[#0F172A] block truncate">{data.userName || 'System'}</span>
                  <span className="text-[10px] text-[#94A3B8] font-mono block truncate">{data.roleName || 'PUBLIC'}</span>
                </div>

                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                    <Layers className="w-3 h-3 text-purple-600" /> Model / Func
                  </span>
                  <span className="text-[12px] font-bold text-[#0F172A] block truncate">{data.model || 'Auto'}</span>
                  <span className="text-[10px] text-purple-600 font-mono font-bold block truncate">{data.function || 'CORTEX'}</span>
                </div>

                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                    <Cpu className="w-3 h-3 text-indigo-600" /> Tokens
                  </span>
                  <span className="text-[12px] font-bold text-[#0F172A] block">
                    {fmtNum(data.tokens || 0)}
                  </span>
                  <span className="text-[10px] text-[#64748B] font-mono block truncate">
                    {data.promptTokens ? `${data.promptTokens} in / ${data.completionTokens || 0} out` : 'LLM payload'}
                  </span>
                </div>

                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                    <DollarSign className="w-3 h-3 text-emerald-600" /> Cost & Credits
                  </span>
                  <span className="text-[12px] font-bold text-emerald-700 block truncate" title={`Credits: ${data.credits || 0}`}>
                    {Number(data.costUsd || 0) >= 0.01 ? `$${Number(data.costUsd).toFixed(3)}` : `$${Number(data.costUsd || 0).toFixed(6)}`}
                  </span>
                  <span className="text-[10px] text-[#64748B] font-mono block truncate">
                    {Number(data.credits || 0).toFixed(6)} credits
                  </span>
                </div>

                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                    <Clock className="w-3 h-3 text-amber-500" /> Latency
                  </span>
                  <span className="text-[12px] font-bold text-[#0F172A] block truncate">{data.durationMs ? `${data.durationMs.toLocaleString()} ms` : '—'}</span>
                  <span className="text-[10px] text-[#64748B] font-mono block truncate">{data.warehouse || 'Cloud Services'}</span>
                </div>
              </div>

              {/* Prompt Inspection Card */}
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0F172A] text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#1C58F6]" /> Extracted Prompt Payload
                  </span>
                  <button
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-1 text-[11px] font-bold text-[#1C58F6] hover:underline cursor-pointer"
                  >
                    {copiedPrompt ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedPrompt ? 'Copied' : 'Copy Prompt'}
                  </button>
                </div>
                <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 text-xs font-mono text-[#0F172A] whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed shadow-2xs">
                  {data.prompt || data.promptSnippet || 'No prompt payload detected.'}
                </div>
              </div>

              {/* Underlying Snowflake SQL Statement */}
              {data.rawSql && (
                <div className="bg-[#0F172A] text-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-blue-400" /> Snowflake SQL Statement
                    </span>
                    <button
                      onClick={handleCopySql}
                      className="flex items-center gap-1 text-[11px] font-bold text-blue-400 hover:text-blue-300 cursor-pointer"
                    >
                      {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedSql ? 'Copied SQL' : 'Copy SQL'}
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-36 overflow-y-auto p-2 bg-slate-900 rounded-lg border border-slate-800 text-slate-300 leading-normal">
                    {data.rawSql}
                  </pre>
                </div>
              )}

              {/* Execution Diagnostics */}
              <div className="pt-2 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                <span>Started: {data.startTime || '—'}</span>
                {data.queryTag && <span className="font-mono">Tag: {data.queryTag}</span>}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 px-6 border-t border-[#F1F5F9] bg-[#F8FAFC] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-[#CBD5E1] text-[#334155] text-xs font-bold hover:bg-white cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
