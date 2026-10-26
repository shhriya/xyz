import React, { useState, useEffect } from 'react';
import {
  Database,
  X,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Key,
  Plus,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { testSnowflakeConnectionApi, saveSnowflakeConnection } from '@/api';

export default function SnowflakeConnectionModal({ 
  isOpen, 
  onClose, 
  onConnectionAdded, 
  onSaveConnection,
  initialCredentials = null,
  scope = 'analytics'
}) {
  const [form, setForm] = useState({
    name: '',
    domain: 'Finance',
    account: '',
    username: '',
    password: '',
    authMethod: 'password', // 'password' (standard, no MFA) | 'password_mfa' (TOTP) | 'externalbrowser' | 'keypair'
    passcode: '',
    passcodeInPassword: false,
    privateKey: '',
    privateKeyPassphrase: '',
    role: 'ACCOUNTADMIN',
    warehouse: 'COMPUTE_WH',
    database: '',
    schema: '',
    cortexRole: '',
    cortexSemanticModel: ''
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  // The record this modal session has already created. A successful Test auto-saves, so without
  // remembering its id the following Save would create a second project for the same credentials.
  const [savedConnectionId, setSavedConnectionId] = useState(null);

  // Opened with no credentials = "New Project". The backend otherwise merges by account+username,
  // which silently returns the existing project when no database is given — and database is
  // optional, so that is the normal case for a new project.
  const isNewProject = !initialCredentials?.id;

  /** Identity for the save: an existing record to update, or an explicit request for a new one. */
  const identityPayload = () => {
    const id = initialCredentials?.id || savedConnectionId;
    return id ? { id } : { asNewProject: isNewProject };
  };

  // Each time the modal opens it is a fresh session: forget the record the previous one created,
  // or the next "New Project" would update that project instead of creating its own.
  useEffect(() => {
    if (isOpen) {
      setSavedConnectionId(null);
      setTestResult(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialCredentials) {
      const initialAuthMethod = initialCredentials.authMethod || (initialCredentials.passcode ? 'password_mfa' : 'password');
      setForm(prev => ({
        ...prev,
        account: initialCredentials.account || prev.account,
        username: initialCredentials.username || prev.username,
        password: initialCredentials.password || prev.password,
        warehouse: initialCredentials.warehouse || prev.warehouse,
        database: initialCredentials.database || prev.database,
        schema: initialCredentials.schema || prev.schema,
        role: initialCredentials.role || prev.role,
        authMethod: initialAuthMethod,
        passcode: initialCredentials.passcode || prev.passcode,
        cortexRole: initialCredentials.cortexRole || prev.cortexRole,
        cortexSemanticModel: initialCredentials.cortexSemanticModel || prev.cortexSemanticModel
      }));
    }
  }, [initialCredentials, isOpen]);

  if (!isOpen) return null;

  const notifyParent = (conn) => {
    // ALWAYS preserve active form credentials, and clean passcode if standard password-only
    const cleanPasscode = form.authMethod === 'password' ? '' : (form.passcode || conn?.passcode || '');
    const isKeypair = form.authMethod === 'keypair';
    const fullConn = {
      ...form,
      ...(conn || {}),
      passcode: cleanPasscode,
      password: form.password || conn?.password || '',
      authMethod: form.authMethod || conn?.authMethod || 'password',
      authenticator: form.authenticator || conn?.authenticator || '',
      passcodeInPassword: form.passcodeInPassword ?? conn?.passcodeInPassword ?? false,
      privateKey: isKeypair ? (form.privateKey || conn?.privateKey || '') : '',
      privateKeyPassphrase: isKeypair ? (form.privateKeyPassphrase || conn?.privateKeyPassphrase || '') : '',
      cortexRole: form.cortexRole || conn?.cortexRole || '',
      cortexSemanticModel: form.cortexSemanticModel || conn?.cortexSemanticModel || ''
    };
    if (onConnectionAdded) onConnectionAdded(fullConn);
    if (onSaveConnection) onSaveConnection(fullConn);
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const isKeypair = form.authMethod === 'keypair';
    const testPayload = {
      ...form,
      passcode: form.authMethod === 'password' ? '' : form.passcode,
      privateKey: isKeypair ? form.privateKey : '',
      privateKeyPassphrase: isKeypair ? form.privateKeyPassphrase : '',
      scope: scope
    };
    const res = await testSnowflakeConnectionApi(testPayload);
    setTestResult(res);
    setIsTesting(false);

    // Auto-save successful test connection and inform parent immediately
    if (res && res.status === 'success' && res.connected) {
      const saveRes = await saveSnowflakeConnection({
        ...testPayload,
        ...identityPayload(),
        latencyMs: res.latencyMs || 25
      });
      if (saveRes?.connection?.id) setSavedConnectionId(saveRes.connection.id);
      notifyParent(saveRes?.connection || testPayload);
    }
    return res;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    const isKeypair = form.authMethod === 'keypair';
    const savePayload = {
      ...form,
      passcode: form.authMethod === 'password' ? '' : form.passcode,
      privateKey: isKeypair ? form.privateKey : '',
      privateKeyPassphrase: isKeypair ? form.privateKeyPassphrase : '',
      latencyMs: testResult?.latencyMs || 25,
      scope: scope
    };
    const res = await saveSnowflakeConnection({ ...savePayload, ...identityPayload() });
    setIsSaving(false);
    if (res?.connection?.id) setSavedConnectionId(res.connection.id);
    notifyParent(res?.connection || savePayload);
    onClose();
  };

  const isMfaRequired = testResult?.mfaRequired || (testResult?.message && (
    testResult.message.includes('MFA with TOTP is required') || 
    testResult.message.includes('394508') ||
    testResult.message.includes('394507') ||
    testResult.message.includes('TOTP Invalid')
  ));

  const isTotpInvalid = testResult?.message && (
    testResult.message.includes('TOTP Invalid') ||
    testResult.message.includes('394507')
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#10338D] to-emerald-500 text-white flex items-center justify-center shadow-md">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <span>Enterprise Snowflake Connection</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Live Telemetry &amp; FinOps
                </span>
              </h2>
              <p className="text-xs text-slate-400">Supports MFA TOTP, Passkey, SSO Browser, Key-Pair, and Standard accounts</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col min-h-0 flex-1 text-xs">
        <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">

        {/* Authentication Method Selector Tabs */}
        <div className="space-y-1.5">
          <label className="text-slate-300 font-semibold text-xs flex items-center justify-between">
            <span>Authentication Method</span>
            <span className="text-[10px] text-slate-400 font-mono">Select for your account security policy</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setForm({ ...form, authMethod: 'password', passcode: '' })}
              className={`px-2 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                form.authMethod === 'password'
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Key className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Password</span>
            </button>

            <button
              type="button"
              onClick={() => setForm({ ...form, authMethod: 'password_mfa' })}
              className={`px-2 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                form.authMethod === 'password_mfa'
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span className="truncate">Password + MFA</span>
            </button>

            <button
              type="button"
              onClick={() => setForm({ ...form, authMethod: 'externalbrowser' })}
              className={`px-2 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                form.authMethod === 'externalbrowser'
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-blue-400" />
              <span className="truncate">Passkey / SSO</span>
            </button>

            <button
              type="button"
              onClick={() => setForm({ ...form, authMethod: 'keypair' })}
              className={`px-2 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                form.authMethod === 'keypair'
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-purple-400" />
              <span className="truncate">Key-Pair (RSA)</span>
            </button>
          </div>
        </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-semibold">Connection Display Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Snowflake Finance EDW"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-medium"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold">Subject Area Domain</label>
              <select
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Finance">Finance &amp; Accounting</option>
                <option value="Sales">Sales &amp; Revenue Ops</option>
                <option value="Customer">Customer 360 &amp; SaaS</option>
                <option value="Retail">Retail &amp; Supply Chain</option>
                <option value="Marketing">Marketing &amp; Growth</option>
                <option value="Education">Higher Education &amp; E-Learning</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-semibold flex items-center justify-between">
              <span>Snowflake Account Identifier</span>
              <span className="text-[10px] text-slate-500 font-mono">e.g. IYRHKSD-WZ85174 or xy12345.us-east-1</span>
            </label>
            <input
              type="text"
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
              required
              placeholder="e.g. IYRHKSD-WZ85174"
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* 1. Standard Password Only (No MFA Required) */}
          {form.authMethod === 'password' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold">Username</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                    placeholder="e.g. SHRIYAK or ANALYST_USER"
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold">Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    placeholder="••••••••••••"
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-300 space-y-1">
                <div className="font-semibold text-xs flex items-center gap-1.5 text-emerald-400">
                  <Key className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Standard Password Authentication</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Direct authentication without MFA passcode or extra token. Ideal for accounts or service roles that do not require MFA.
                </p>
              </div>
            </div>
          )}

          {/* 2. Password + MFA (TOTP 6-Digit Passcode) */}
          {form.authMethod === 'password_mfa' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold">Username</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                    placeholder="e.g. SHRIYAK or ANALYST_USER"
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold">Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    placeholder="••••••••••••"
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* MFA Passcode Field (TOTP) */}
              <div className={`p-3 rounded-xl border transition-all ${
                isMfaRequired 
                  ? 'bg-amber-950/40 border-amber-500/50 shadow-sm' 
                  : 'bg-slate-950/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-200 font-semibold flex items-center space-x-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                    <span>MFA / TOTP Passcode (6 digits)</span>
                  </label>
                  <span className={`text-[10px] font-mono ${isMfaRequired ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                    {isMfaRequired ? 'Required by your Snowflake Account' : 'From Authenticator App'}
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={6}
                  value={form.passcode}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                    setForm({ ...form, passcode: digitsOnly });
                  }}
                  placeholder="e.g. 123456 (from Google Authenticator, Duo, or Microsoft Auth)"
                  className={`w-full bg-slate-950 border rounded-lg p-2 text-xs font-mono tracking-widest focus:outline-none ${
                    isTotpInvalid ? 'border-rose-500 text-rose-300 focus:border-rose-400' : 'border-slate-800 text-amber-300 focus:border-amber-500'
                  }`}
                />
                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                  Enter your current 6-digit passcode from your mobile authenticator app. Codes refresh every 30 seconds.
                </p>
              </div>
            </div>
          )}

          {form.authMethod === 'externalbrowser' && (
            <div className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold">Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                  placeholder="e.g. SHRIYAK or SSO User"
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-blue-300">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Interactive Passkey &amp; SSO Authentication</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Testing this connection will open your default browser tab to complete Passkey (WebAuthn), Okta, Azure AD, or Snowflake Web SSO authentication.
                </p>
              </div>
            </div>
          )}

          {form.authMethod === 'keypair' && (
            <div className="space-y-3">
              <div>
                <label className="text-slate-300 font-semibold">Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                  placeholder="e.g. SERVICE_ACCOUNT_USER"
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-slate-300 font-semibold flex items-center justify-between">
                  <span>RSA Private Key (PEM format)</span>
                  <span className="text-[10px] text-slate-500 font-mono">Bypasses TOTP prompts</span>
                </label>
                <textarea
                  rows={3}
                  value={form.privateKey}
                  onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-slate-300 font-semibold">Private Key Passphrase (Optional)</label>
                <input
                  type="password"
                  value={form.privateKeyPassphrase}
                  onChange={(e) => setForm({ ...form, privateKeyPassphrase: e.target.value })}
                  placeholder="Passphrase if your private key is encrypted"
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-300 font-semibold">Warehouse</label>
              <input
                type="text"
                value={form.warehouse}
                onChange={(e) => setForm({ ...form, warehouse: e.target.value })}
                placeholder="COMPUTE_WH"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold">Role (Optional)</label>
              <input
                type="text"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="ACCOUNTADMIN / SYSADMIN"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold">Database (Optional)</label>
              <input
                type="text"
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
                placeholder="SNOWFLAKE"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Cortex Analyst role / agent name are no longer entered by hand — the Semantic Model
              wizard writes them onto this connection when it creates the Cortex agent. The values
              are still carried through on save so an edit here never clears them. */}

          {/* Real Authentication Test Results Banner */}
          {testResult && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start space-x-2.5 ${
              testResult.status === 'success' && testResult.connected
                ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'
            }`}>
              {testResult.status === 'success' && testResult.connected ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 w-full">
                <div className="font-bold text-xs">{testResult.message}</div>
                {testResult.connected && (
                  <div className="text-[10px] text-emerald-400 font-mono">
                    Snowflake Version: {testResult.version || '8.24'} • Latency: {testResult.latencyMs || 24}ms • Edition: {testResult.edition || 'Enterprise'}
                  </div>
                )}
                {isMfaRequired && form.authMethod === 'password' ? (
                  <div className="text-[11px] text-amber-300 bg-amber-950/80 p-2.5 rounded-lg border border-amber-500/40 mt-2 font-medium flex items-center justify-between gap-2">
                    <div>
                      👉 <strong>MFA Required</strong>: This Snowflake account enforces Multi-Factor Authentication. Please switch to the <strong>Password + MFA</strong> tab to enter your 6-digit TOTP passcode.
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, authMethod: 'password_mfa' }))}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded text-xs shrink-0 cursor-pointer shadow-xs"
                    >
                      Switch to MFA
                    </button>
                  </div>
                ) : isTotpInvalid ? (
                  <div className="text-[11px] text-rose-200 bg-rose-950/80 p-2.5 rounded-lg border border-rose-500/40 mt-2 font-medium leading-relaxed">
                    ⏱️ <strong>Passcode Expired or Invalid</strong>: TOTP codes refresh every 30 seconds. Please check your Authenticator app (Google Authenticator / Duo) for the <strong>current</strong> 6-digit code, enter it above, and click <strong>Test Live Connection</strong>.
                  </div>
                ) : isMfaRequired ? (
                  <div className="text-[11px] text-amber-300 bg-amber-950/80 p-2.5 rounded-lg border border-amber-500/40 mt-2 font-medium">
                    👉 <strong>Action Required</strong>: Enter your 6-digit TOTP code from your mobile authenticator into the <strong>MFA / TOTP Passcode</strong> field above and click <strong>Test Live Connection</strong>.
                  </div>
                ) : null}
              </div>
            </div>
          )}

          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 shrink-0 bg-slate-900 rounded-b-2xl">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isTesting ? 'Authenticating...' : 'Test Live Connection'}</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="bg-slate-950 hover:bg-slate-800 text-slate-400 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || isTesting}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer transition-all"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{isSaving ? 'Saving...' : 'Save & Connect'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
