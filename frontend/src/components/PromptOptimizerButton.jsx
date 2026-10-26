import React, { useState } from 'react';
import { Sparkles, Loader2, Check, X, TrendingDown, AlertTriangle } from 'lucide-react';
import { optimizePrompt } from '@/api';

export default function PromptOptimizerButton({ promptText, onApply, disabled, align = 'right' }) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleOptimize = async () => {
    if (!promptText || !promptText.trim()) return;
    setIsOptimizing(true);
    setError(null);
    setResult(null);
    const res = await optimizePrompt(promptText);
    if (res && res.status === 'success') {
      setResult(res);
    } else {
      setError(res?.message || 'Optimization failed.');
    }
    setIsOptimizing(false);
  };

  const handleApply = () => {
    if (result) onApply(result.optimizedPrompt);
    setResult(null);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleOptimize}
        disabled={disabled || isOptimizing || !promptText?.trim()}
        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="Use AI to tighten this prompt and cut token usage, without dropping any requirement"
      >
        {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        <span>{isOptimizing ? 'Optimizing...' : 'Optimize Prompt'}</span>
      </button>

      {error && (
        <div className={`absolute z-20 mt-2 w-80 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs shadow-lg flex items-start gap-2 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 cursor-pointer shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {result && (
        <div className={`absolute z-20 mt-2 w-[420px] max-w-[90vw] bg-white border border-[#D1DEFF] rounded-xl p-4 shadow-2xl space-y-3 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-[#10338D] flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-emerald-600" />
              {result.tokensSaved > 0 ? `${result.savingsPct}% fewer tokens` : 'Already tight — nothing to cut'}
            </span>
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {result.originalTokens != null && result.optimizedTokens != null && (
            <div className="text-[11px] text-[#666666] flex items-center gap-2 font-mono">
              <span>Before: <strong className="text-[#10338D]">{result.originalTokens}</strong> tokens</span>
              <span className="text-slate-300">&rarr;</span>
              <span>After: <strong className="text-emerald-600">{result.optimizedTokens}</strong> tokens</span>
            </div>
          )}

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2.5 text-[11px] font-mono text-[#1E293B] max-h-40 overflow-y-auto whitespace-pre-wrap">
            {result.optimizedPrompt}
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            Table/column names, formulas, and every explicit requirement are preserved — only filler and
            redundant wording were cut. Review before applying.
            {result.optimizerTokensUsed != null && (
              <> Running this optimizer used ~{result.optimizerTokensUsed} tokens itself.</>
            )}
          </p>

          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setResult(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 cursor-pointer">
              Keep Original
            </button>
            <button onClick={handleApply} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#10338D] hover:bg-[#1C58F6] text-white cursor-pointer flex items-center gap-1.5 transition-all shadow-sm">
              <Check className="w-3.5 h-3.5" />
              <span>Use Optimized</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
