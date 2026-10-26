import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Stepper from '@/features/code-conversion/Stepper';
import Step1SelectSource from '@/features/code-conversion/Step1SelectSource';
import Step3PromptConfig from '@/features/code-conversion/Step3PromptConfig';
import Step4MigrationSettings from '@/features/code-conversion/Step4MigrationSettings';
import Step5ExecuteMigration from '@/features/code-conversion/Step5ExecuteMigration';
import Step6ReviewGenerate from '@/features/code-conversion/Step6ReviewGenerate';
import SettingsModal from '@/components/SettingsModal';
import AnalyticsDashboard from '@/features/cfo-analytics/AnalyticsDashboard';
import { fetchMigrationStatus } from '@/api';
import AIGovernanceDashboard from '@/features/governance/AIGovernanceDashboard';
import PromptMigrationWorkspace from '@/features/cloud-modernization/PromptMigrationWorkspace';
import CdcPipelineDashboard from '@/features/cdc-pipeline/CdcPipelineDashboard';


export default function App() {
  const [activeProjectNav, setActiveProjectNav] = useState('Code Conversion');
  const [activeStep, setActiveStep] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load persisted project state from localStorage on first mount
  const loadPersistedState = () => {
    try {
      const raw = localStorage.getItem('agy_project_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Strip file content blobs (too large for localStorage) — keep metadata only
        if (parsed.uploadedFiles) {
          parsed.uploadedFiles = parsed.uploadedFiles.map(f => ({ ...f, content: undefined }));
        }
        return parsed;
      }
    } catch {/* ignore parse errors */}
    return null;
  };

  // Global Project State persisted across tabs
  const [projectState, setProjectState] = useState(() => ({
    selectedSource: '',
    connectionStatus: '',
    connectionDetails: {},
    uploadedFiles: [],
    discoveredFiles: [],
    selectedFileIds: [],
    savedConnections: [],
    migrationConfig: {},
    targetConnected: false,
    migrationCompleted: false,
    hasMigrated: false,
    prompts: {},
    migrationSettings: {
      sourceDialect: 'teradata',
      targetDialect: 'snowflake',
      projectType: 'dbt_package',
      useAiOptimization: true
    },
    ...(loadPersistedState() || {})
  }));

  // Sync with backend on mount
  useEffect(() => {
    fetchMigrationStatus().then((res) => {
      if (res?.execution?.status === 'Completed') {
        setProjectState(prev => ({
          ...prev,
          targetConnected: true,
          migrationCompleted: true,
          hasMigrated: true
        }));
      }
    });
  }, []);

  // Auto-save project state to localStorage on state changes
  useEffect(() => {
    try {
      const sanitized = {
        ...projectState,
        uploadedFiles: (projectState.uploadedFiles || []).map(f => ({
          name: f.name || f.filename,
          size: f.size || f.fileSize,
          type: f.type || f.sourceType,
          id: f.id
        }))
      };
      localStorage.setItem('agy_project_state', JSON.stringify(sanitized));
    } catch {/* ignore save errors */}
  }, [projectState]);

  // Step Guardrails & Unlock Conditions
  const isSourceReady = !!(
    (projectState.uploadedFiles && projectState.uploadedFiles.length > 0) ||
    (projectState.discoveredFiles && projectState.discoveredFiles.length > 0) ||
    projectState.connectionStatus === 'connected' ||
    projectState.sourceConnected === true
  );
  const isTargetReady = isSourceReady && !!(projectState.targetConnected === true);
  const isMigrationReady = isTargetReady && !!(projectState.migrationCompleted === true || projectState.hasMigrated === true);

  const getStepUnlockStatus = (stepId) => {
    if (stepId === 1) return { unlocked: true };
    if (stepId === 2) {
      return {
        unlocked: isSourceReady,
        reason: 'Step 1 Incomplete: Please connect your ETL source or scan/upload source files in Step 1 first.'
      };
    }
    if (stepId === 3) {
      return {
        unlocked: isSourceReady,
        reason: 'Step 1 Incomplete: Please connect your ETL source or scan/upload source files in Step 1 first.'
      };
    }
    if (stepId === 4) {
      return {
        unlocked: isTargetReady,
        reason: 'Target Connection Required: Please test and verify your Snowflake target warehouse connection in Step 3 first.'
      };
    }
    if (stepId === 5) {
      return {
        unlocked: isMigrationReady,
        reason: 'Migration Not Executed: Please execute the AI migration in Step 4 before reviewing dbt models.'
      };
    }
    return { unlocked: true };
  };

  const calculatedMaxUnlocked = isMigrationReady ? 5 : isTargetReady ? 4 : isSourceReady ? 3 : 1;

  const goToNextStep = () => {
    if (activeStep < 5) {
      const next = activeStep + 1;
      const unlockInfo = getStepUnlockStatus(next);
      if (unlockInfo.unlocked) {
        setActiveStep(next);
      } else {
        alert(unlockInfo.reason || 'Please complete the current step first.');
      }
    }
  };

  return (
    <div className="flex h-screen bg-white text-[#1E1E1E] font-sans overflow-hidden">
      {/* Left Sidebar (Fixed) */}
      <Sidebar
        activeProject={activeProjectNav}
        onSelectProject={(nav) => setActiveProjectNav(nav)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Workspace Layout (Offset by 64 = 256px for Sidebar) */}
      <div className="flex-1 flex flex-col pl-60 h-screen overflow-hidden bg-white min-w-0">
        {activeProjectNav === 'Data Modernization' || activeProjectNav === 'New Migration' ? (
          /* Prompt-Driven dbt Migration Workspace (No Source Files Needed) */
          <main className="flex-1 overflow-y-auto px-8 py-6 bg-[#F8FAFC]">
            <PromptMigrationWorkspace
              projectState={projectState}
              setProjectState={setProjectState}
            />
          </main>
        ) : activeProjectNav === 'CDC Pipeline' ? (
          <main className="flex-1 overflow-y-auto px-8 py-6 bg-[#F8FAFC]">
            <CdcPipelineDashboard projectState={projectState} setProjectState={setProjectState} />
          </main>
        ) : activeProjectNav === 'Analytics Dashboard' ? (
          <main className="flex-1 overflow-y-auto px-8 py-6 bg-[#F8FAFC]">
            <AnalyticsDashboard
              projectState={projectState}
              setProjectState={setProjectState}
              onStartConversion={() => setActiveProjectNav('Code Conversion')}
            />
          </main>
        ) : (activeProjectNav === 'Governance' || activeProjectNav === 'AI Governance') ? (
          /* Governance & Monitoring View */
          <main className="flex-1 overflow-y-auto px-8 py-6 bg-[#F8FAFC]">
            <AIGovernanceDashboard projectState={projectState} setProjectState={setProjectState} />
          </main>

        ) : (
          /* Code Conversion Workflow */
          <>
            {/* Top Progress Stepper (Scrollable, Clean White Relanto Theme) */}
            <Stepper
              activeStep={activeStep}
              setActiveStep={setActiveStep}
              maxUnlockedStep={calculatedMaxUnlocked}
              unlockStatusMap={getStepUnlockStatus}
            />

            {/* Tab Workspace Content Area */}
            <main className="flex-1 overflow-y-auto px-8 py-6 bg-[#F8FAFC]">
              <div className="max-w-7xl mx-auto">
                {activeStep === 1 && (
                  <Step1SelectSource
                    onNext={goToNextStep}
                    projectState={projectState}
                    setProjectState={setProjectState}
                  />
                )}

                {activeStep === 2 && (
                  <Step3PromptConfig
                    onNext={goToNextStep}
                    projectState={projectState}
                    setProjectState={setProjectState}
                  />
                )}

                {activeStep === 3 && (
                  <Step4MigrationSettings
                    onNext={goToNextStep}
                    projectState={projectState}
                    setProjectState={setProjectState}
                  />
                )}

                {activeStep === 4 && (
                  <Step5ExecuteMigration
                    onNext={goToNextStep}
                    projectState={projectState}
                    setProjectState={setProjectState}
                  />
                )}

                {activeStep === 5 && (
                  <Step6ReviewGenerate
                    onStartOver={() => setActiveStep(1)}
                    projectState={projectState}
                    setProjectState={setProjectState}
                  />
                )}
              </div>
            </main>
          </>
        )}
      </div>

      {/* Global Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
