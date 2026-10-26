import React from 'react';
import {
  FileCode2,
  BarChart3,
  ShieldCheck,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';

export default function Sidebar({ activeProject, onSelectProject, onOpenSettings }) {
  return (
    <aside className="w-60 bg-white border-r border-[#D1DEFF] flex flex-col h-screen fixed left-0 top-0 z-30 select-none shadow-sm">
      <div className="px-4 py-3.5 border-b border-[#D1DEFF] bg-gradient-to-r from-white to-[#ECEFFF]">
        <div className="flex items-center space-x-1">
          <img src="/favicon.svg" alt="R" className="h-6 w-auto shrink-0" />
          <div className="text-[13px] font-black text-[#10338D] tracking-tight leading-none flex items-center">
            <span className="text-[#FF3C00] font-black mr-0.5">-</span>Data Intelligence
          </div>
        </div>
        <div className="text-[9px] font-bold text-[#666666] tracking-wider uppercase pl-7 mt-1">
          Unified Data Platform
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#666666] px-2 py-1">Workspace Core</div>

        {/* Navigation 0: Data Modernization (Prompt to dbt) */}
        <button
          onClick={() => onSelectProject('Data Modernization')}
          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            activeProject === 'Data Modernization'
              ? 'bg-[#10338D] text-white shadow-sm font-semibold'
              : 'text-[#334155] hover:text-[#10338D] hover:bg-[#ECEFFF]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <Sparkles className={`w-4 h-4 ${activeProject === 'Data Modernization' ? 'text-amber-300' : 'text-[#10338D]'}`} />
            <span className="font-bold">Data Modernization</span>
          </div>
        </button>

        {/* Navigation 1: Code Conversion */}
        <button
          onClick={() => onSelectProject('Code Conversion')}
          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
            activeProject === 'Code Conversion' || activeProject === 'Projects'
              ? 'bg-[#10338D] text-white shadow-sm font-semibold'
              : 'text-[#334155] hover:text-[#10338D] hover:bg-[#ECEFFF]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <FileCode2 className={`w-4 h-4 ${activeProject === 'Code Conversion' || activeProject === 'Projects' ? 'text-white' : 'text-[#10338D]'}`} />
            <span>Code Conversion</span>
          </div>
        </button>

        {/* Navigation 1b: CDC Pipeline (Temporarily Hidden) 
        <button
          onClick={() => onSelectProject('CDC Pipeline')}
          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
            activeProject === 'CDC Pipeline'
              ? 'bg-[#10338D] text-white shadow-sm font-semibold'
              : 'text-[#334155] hover:text-[#10338D] hover:bg-[#ECEFFF]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <Zap className={`w-4 h-4 ${activeProject === 'CDC Pipeline' ? 'text-white' : 'text-[#10338D]'}`} />
            <span>CDC Pipeline</span>
          </div>
        </button>
        */}
        {/* Navigation 2: Analytics Dashboard */}
        <button
          onClick={() => onSelectProject('Analytics Dashboard')}
          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
            activeProject === 'Analytics Dashboard'
              ? 'bg-[#10338D] text-white shadow-sm font-semibold'
              : 'text-[#334155] hover:text-[#10338D] hover:bg-[#ECEFFF]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <BarChart3 className={`w-4 h-4 ${activeProject === 'Analytics Dashboard' ? 'text-white' : 'text-[#10338D]'}`} />
            <span>Analytics Dashboard</span>
          </div>
        </button>

        {/* Navigation 3: Governance */}
        <button
          onClick={() => onSelectProject('Governance')}
          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
            activeProject === 'Governance'
              ? 'bg-[#10338D] text-white shadow-sm font-semibold'
              : 'text-[#334155] hover:text-[#10338D] hover:bg-[#ECEFFF]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <ShieldCheck className={`w-4 h-4 ${activeProject === 'Governance' ? 'text-white' : 'text-[#10338D]'}`} />
            <span>Governance</span>
          </div>
        </button>


      </nav>

      {/* Footer Navigation */}
      <div className="p-3 border-t border-[#D1DEFF] bg-[#F8FAFC]">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium text-[#334155] hover:text-[#10338D] hover:bg-white transition-colors border border-transparent hover:border-[#D1DEFF]"
        >
          <Settings className="w-4 h-4 text-[#666666]" />
          <span>API Key & Settings</span>
        </button>
      </div>
    </aside>
  );
}
