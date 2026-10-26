import React from 'react';
import {
  FileText,
  Sparkles,
  ShieldAlert,
  Lightbulb,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';

export default function CFOExecutiveReport({ report }) {
  if (!report) return null;

  const { summary, insights = [], risks = [], recommendations = [] } = report;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
          <FileText className="w-4 h-4 text-[#1C58F6]" />
          <span>Executive CFO Strategic Assessment & Recommendations</span>
        </h2>
        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
          FY2026 Audit Ready
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* 1. Executive Summary (Full Width) */}
        <div className="lg:col-span-12 bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-md space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-[#1C58F6] uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Executive Summary</span>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed font-sans font-medium">
            {summary}
          </p>
        </div>

        {/* 2. Top 5 Business Insights (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Top 5 Business Insights</span>
            </h3>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Data Driven
            </span>
          </div>

          <div className="space-y-3">
            {insights.map((item, idx) => (
              <div key={idx} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex items-start space-x-3 text-xs">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </div>
                <p className="text-slate-300 leading-relaxed font-medium">{item}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Risks Identified & 4. Recommendations (6 Cols) */}
        <div className="lg:col-span-6 space-y-6">
          
          {/* Risks Identified */}
          <div className="bg-slate-900/90 border border-rose-500/30 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>Risks Identified</span>
              </h3>
              <span className="text-[10px] font-mono font-bold text-rose-300 bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30">
                Critical Exposure
              </span>
            </div>

            <div className="space-y-2.5">
              {risks.map((item, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-rose-500/20 rounded-xl flex items-start space-x-2.5 text-xs text-rose-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 mt-1.5" />
                  <p className="leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Strategic Recommendations */}
          <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
                <Lightbulb className="w-4 h-4 text-emerald-400" />
                <span>Revenue Collection & DSO Reduction Recommendations</span>
              </h3>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                Action Plan
              </span>
            </div>

            <div className="space-y-2.5">
              {recommendations.map((item, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-emerald-500/20 rounded-xl flex items-start space-x-2.5 text-xs text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
