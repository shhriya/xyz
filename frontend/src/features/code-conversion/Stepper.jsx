import React from 'react';
import { 
  Database, 
  FileCode2, 
  Sliders, 
  PlayCircle, 
  CheckCheck,
  ChevronRight,
  Lock
} from 'lucide-react';

export const STEPS = [
  { id: 1, key: 'source',   label: 'Select Source',        desc: 'ETL Connection & Uploads',     icon: Database  },
  { id: 2, key: 'prompt',   label: 'AI Skill Engine',      desc: 'Agentic Skills & Rules',       icon: FileCode2 },
  { id: 3, key: 'settings', label: 'Target Settings',      desc: 'dbt Targets & Medallion DAG',   icon: Sliders   },
  { id: 4, key: 'execute',  label: 'Execute Migration',    desc: 'Live Stream & AI Pipeline',     icon: PlayCircle},
  { id: 5, key: 'review',   label: 'Review & Generate',    desc: 'dbt Code, Diff & ZIP Export',   icon: CheckCheck}
];

export default function Stepper({ activeStep, setActiveStep, maxUnlockedStep, unlockStatusMap }) {
  return (
    <div className="w-full bg-white border-b border-[#D1DEFF] px-4 py-2.5 sticky top-0 z-20 shadow-xs overflow-x-auto scrollbar-thin">
      <div className="min-w-max max-w-7xl mx-auto flex items-center justify-between gap-1.5 px-2">
        <div className="flex items-center gap-1.5 flex-1">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = activeStep === step.id;
            const status = unlockStatusMap ? unlockStatusMap(step.id) : { unlocked: step.id <= (maxUnlockedStep || 1) };
            const isClickable = status.unlocked;
            const isCompleted = step.id < activeStep && isClickable;
            const lockReason = status.reason || "Complete previous steps to unlock";

            return (
              <React.Fragment key={step.id}>
                {/* Step Item Button */}
                <button
                  onClick={() => {
                    if (isClickable) {
                      setActiveStep(step.id);
                    }
                  }}
                  title={!isClickable ? lockReason : step.desc}
                  className={`group flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                    isActive
                      ? 'bg-[#ECEFFF] border border-[#10338D] text-[#10338D] shadow-xs scale-[1.02]'
                      : isCompleted
                      ? 'text-[#1E1E1E] hover:bg-[#F8FAFC] border border-transparent hover:border-[#D1DEFF] cursor-pointer'
                      : isClickable
                      ? 'text-[#1E1E1E] hover:bg-[#F8FAFC] cursor-pointer'
                      : 'text-[#94A3B8] cursor-not-allowed opacity-60'
                  }`}
                >
                  {/* Step Circle Indicator */}
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs transition-all shrink-0 ${
                      isActive
                        ? 'bg-[#FF3C00] text-white shadow-xs'
                        : isCompleted
                        ? 'bg-[#10338D] text-white'
                        : isClickable
                        ? 'bg-[#F1F2ED] text-[#1E1E1E] border border-[#CBD5E1]'
                        : 'bg-[#F1F5F9] text-[#94A3B8] border border-[#E2E8F0]'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCheck className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : !isClickable ? (
                      <Lock className="w-3 h-3 text-[#94A3B8]" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                  </div>

                  {/* Step Text Info */}
                  <div className="text-left">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">Step {step.id}</span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF3C00] animate-ping"></span>
                      )}
                      {!isClickable && (
                        <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded border border-amber-200">Locked</span>
                      )}
                    </div>
                    <div className={`text-xs font-semibold whitespace-nowrap ${isActive ? 'text-[#10338D]' : !isClickable ? 'text-[#94A3B8]' : 'text-[#1E1E1E]'}`}>
                      {step.label}
                    </div>
                  </div>
                </button>

                {/* Connecting Connector Line */}
                {idx < STEPS.length - 1 && (
                  <div className="flex-1 min-w-[20px] max-w-[40px] flex items-center justify-center shrink-0">
                    <div
                      className={`h-[2px] w-full rounded transition-all ${
                        step.id < activeStep ? 'bg-[#10338D]' : 'bg-[#D1DEFF]'
                      }`}
                    ></div>
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 -ml-1 ${step.id < activeStep ? 'text-[#10338D]' : 'text-[#A7BFFF]'}`} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

      </div>
    </div>
  );
}
