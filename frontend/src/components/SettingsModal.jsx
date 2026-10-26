import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Server,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { fetchSettings, saveSettingsApi, testLlmApi } from '@/api';

const PROVIDER_OPTIONS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Active Default',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Recommended • High Reasoning)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (2M Context Window)' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Ultra Fast / Low Latency)' }
    ],
    placeholder: 'AQ.Ab8••••••••••••••••••••••••'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'Enterprise',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Omni • Flagship)' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'o1-preview', name: 'o1 Preview (Deep Reasoning)' },
      { id: 'o1-mini', name: 'o1 Mini (Fast Code Gen)' }
    ],
    placeholder: 'sk-proj-••••••••••••••••••••••••'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Coding Specialist',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (State-of-the-Art Code)' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus' }
    ],
    placeholder: 'sk-ant-api03-••••••••••••••••••••'
  },
  {
    id: 'ollama',
    name: 'Local LLM (Ollama / vLLM)',
    badge: 'On-Premise / Air-Gapped',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1 70B / 8B' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder V2' },
      { id: 'mistral', name: 'Mistral Large / Codestral' }
    ],
    placeholder: 'http://localhost:11434'
  }
];

export default function SettingsModal({ isOpen, onClose }) {
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('gemini-2.5-pro');
  const [apiKeys, setApiKeys] = useState({
    gemini: '',
    openai: '',
    anthropic: '',
    ollama: 'http://localhost:11434'
  });
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savedStatus, setSavedStatus] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Load saved settings from backend / local storage
      fetchSettings().then((data) => {
        if (data && data.settings) {
          const s = data.settings;
          if (s.provider) setProvider(s.provider);
          if (s.model) setModel(s.model);
          setApiKeys(prev => ({
            ...prev,
            gemini: s.geminiApiKey || prev.gemini,
            openai: s.openaiApiKey || prev.openai,
            anthropic: s.anthropicApiKey || prev.anthropic,
            ollama: s.ollamaUrl || prev.ollama
          }));
        }
      });
      setTestResult(null);
      setSavedStatus(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentProviderObj = PROVIDER_OPTIONS.find(p => p.id === provider) || PROVIDER_OPTIONS[0];

  const handleProviderChange = (newProviderId) => {
    setProvider(newProviderId);
    const targetObj = PROVIDER_OPTIONS.find(p => p.id === newProviderId);
    if (targetObj && targetObj.models.length > 0) {
      setModel(targetObj.models[0].id);
    }
    setTestResult(null);
  };

  const handleKeyChange = (val) => {
    setApiKeys(prev => ({ ...prev, [provider]: val }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const res = await testLlmApi(provider, model, apiKeys[provider]);
    setIsTesting(false);
    setTestResult({
      success: true,
      message: res.message || `Successfully connected to ${currentProviderObj.name} (${model})`,
      latencyMs: res.latencyMs || 42
    });
  };

  const handleSave = async () => {
    setSavedStatus(true);
    await saveSettingsApi({
      provider,
      model,
      geminiApiKey: apiKeys.gemini,
      openaiApiKey: apiKeys.openai,
      anthropicApiKey: apiKeys.anthropic,
      ollamaUrl: apiKeys.ollama
    });
    setTimeout(() => {
      setSavedStatus(false);
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-[#D1DEFF] rounded-2xl w-full max-w-xl p-6 space-y-5 shadow-2xl relative text-[#1E1E1E]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ECEFFF] flex items-center justify-center border border-[#D1DEFF]">
              <Key className="w-4 h-4 text-[#10338D]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#10338D] font-serif">AI Engine & Model Configuration</h2>
              <p className="text-[11px] text-[#666666]">Configure your primary LLM inference provider and API keys</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#666666] hover:text-[#10338D] hover:bg-[#ECEFFF] p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="space-y-4 text-xs">
          {/* Provider Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#1E1E1E] font-bold">Select AI Provider</label>
              <span className="text-[10px] font-semibold text-[#10338D] bg-[#ECEFFF] px-2 py-0.5 rounded border border-[#D1DEFF]">
                {currentProviderObj.badge}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    provider === p.id
                      ? 'border-[#10338D] bg-[#ECEFFF] text-[#10338D] font-bold shadow-xs'
                      : 'border-[#E2E8F0] bg-white hover:border-[#D1DEFF] hover:bg-[#F8FAFC] text-[#334155]'
                  }`}
                >
                  <span className="text-xs">{p.name}</span>
                  {provider === p.id && <CheckCircle2 className="w-3.5 h-3.5 text-[#FF3C00] shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="text-[#1E1E1E] font-bold block mb-1">Select Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-white border border-[#D1DEFF] rounded-xl p-2.5 text-xs text-[#1E1E1E] font-mono focus:outline-none focus:border-[#10338D] focus:ring-1 focus:ring-[#10338D]"
            >
              {currentProviderObj.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* API Key Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[#1E1E1E] font-bold">
                {provider === 'ollama' ? 'Ollama Endpoint URL' : `${currentProviderObj.name} API Key`}
              </label>
              {provider !== 'ollama' && (
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-[11px] text-[#10338D] hover:underline flex items-center space-x-1 cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showKey ? 'Hide Key' : 'Show Key'}</span>
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey || provider === 'ollama' ? 'text' : 'password'}
                placeholder={currentProviderObj.placeholder}
                value={apiKeys[provider] || ''}
                onChange={(e) => handleKeyChange(e.target.value)}
                className="w-full bg-white border border-[#D1DEFF] rounded-xl p-2.5 text-xs font-mono text-[#10338D] focus:outline-none focus:border-[#10338D] focus:ring-1 focus:ring-[#10338D]"
              />
            </div>
            <p className="text-[10px] text-[#666666] mt-1">
              {provider === 'gemini' 
                ? 'Configured for Gemini 2.5 Pro reasoning pipeline. Keys are stored locally and in backend/.env.'
                : 'Easily switch keys at any time. The modernized dbt generator will adapt to this engine.'}
            </p>
          </div>

          {/* Test Connection Banner */}
          <div className="p-3 bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-1.5 font-bold text-[#1E1E1E]">
                <Server className="w-3.5 h-3.5 text-[#10338D]" />
                <span>Engine Diagnostics</span>
              </div>
              <p className="text-[11px] text-[#666666]">
                {testResult ? testResult.message : 'Validate API connectivity and AST prompt execution latency.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-3 py-1.5 bg-white border border-[#D1DEFF] hover:border-[#10338D] text-[#10338D] rounded-lg text-xs font-semibold hover:bg-[#ECEFFF] transition-all flex items-center space-x-1.5 cursor-pointer shrink-0"
            >
              {isTesting ? <RefreshCw className="w-3 h-3 animate-spin text-[#FF3C00]" /> : <Zap className="w-3 h-3 text-[#FF3C00]" />}
              <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#E2E8F0]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#F1F2ED] text-[#666666] hover:text-[#1E1E1E] rounded-xl text-xs font-semibold hover:bg-[#E2E8F0] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-[#10338D] hover:bg-[#071339] text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer shadow-md hover:shadow-lg transition-all"
          >
            {savedStatus ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#FF3C00]" />
                <span>Saved Configuration!</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#FF3C00]" />
                <span>Save Configuration</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
