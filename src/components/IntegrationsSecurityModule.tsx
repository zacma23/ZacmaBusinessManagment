import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, History, Check, Ban, Sliders } from 'lucide-react';
import { auth } from '../lib/firebase';
import { usePortal } from '../context/PortalContext';
import {
  formatTimestamp,
  updateIntegrationApproval,
  updateOrganizationSettings,
} from '../lib/zacmaService';
import type { DuplicateMatchMode, IntegrationConfig } from '../types';

export function IntegrationsSecurityModule() {
  const { user, organization, isSuperAdmin, integrations, auditLogs } = usePortal();
  const [serverEnvStatus, setServerEnvStatus] = useState<Record<string, { configured: boolean }>>({});
  const [orgName, setOrgName] = useState(organization?.name || 'Zacma Technology');
  const [dupMode, setDupMode] = useState<DuplicateMatchMode>(
    organization?.duplicateMatchMode || 'email_or_phone'
  );
  const [savingOrg, setSavingOrg] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name);
      setDupMode(organization.duplicateMatchMode);
    }
  }, [organization]);

  useEffect(() => {
    let active = true;
    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        fetch('/api/integrations/status', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (active && data) setServerEnvStatus(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !isSuperAdmin) return;
    setSavingOrg(true);
    try {
      await updateOrganizationSettings({
        organization,
        updates: {
          name: orgName,
          duplicateMatchMode: dupMode,
        },
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSavingOrg(false);
    }
  };

  const handleApproval = async (
    integration: IntegrationConfig,
    status: IntegrationConfig['approvalStatus']
  ) => {
    if (!organization || !user || !isSuperAdmin) return;
    await updateIntegrationApproval({
      organizationId: organization.id,
      integration,
      approvalStatus: status,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Super Admin',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Integrations Governance &amp; Security Audit
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Approve external communication providers before enabling paid APIs, configure duplicate
          lead detection, and review immutable administrative audit trails.
        </p>
      </div>

      {/* Organization Settings & Duplicate Detection */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sliders className="w-4 h-4 text-blue-700" />
          <h2 className="font-display text-base font-bold text-slate-900">
            Organization &amp; Duplicate Detection Policy
          </h2>
        </div>
        <form onSubmit={handleSaveOrg} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Organization Name
            </label>
            <input
              type="text"
              disabled={!isSuperAdmin}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              CRM Lead Duplicate Matching Rule
            </label>
            <select
              disabled={!isSuperAdmin}
              value={dupMode}
              onChange={(e) => setDupMode(e.target.value as DuplicateMatchMode)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            >
              <option value="email_or_phone">Match Email OR Phone</option>
              <option value="email_only">Match Email Only</option>
              <option value="phone_only">Match Phone Only</option>
              <option value="email_and_phone">Match Both Email AND Phone</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <button
                type="submit"
                disabled={savingOrg}
                className="px-5 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
              >
                {savingOrg ? 'Saving…' : 'Save Policy'}
              </button>
            )}
            {savedNotice && <span className="text-xs text-emerald-700 font-medium">Saved</span>}
          </div>
        </form>
      </div>

      {/* External API Provider Approval Governance */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-base font-bold text-slate-900">
              API Integration Approval Registry
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Secrets live strictly in server environment variables — never in browser code or Firestore.
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {integrations.map((intItem) => {
            const envReady = Boolean(serverEnvStatus[intItem.providerKey]?.configured);
            return (
              <div
                key={intItem.id}
                className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-semibold text-sm text-slate-900">
                      {intItem.displayName}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span
                      className={`text-xs font-semibold ${
                        intItem.approvalStatus === 'enabled'
                          ? 'text-emerald-700'
                          : intItem.approvalStatus === 'approved_awaiting_env'
                            ? 'text-blue-700'
                            : intItem.approvalStatus === 'disabled'
                              ? 'text-red-600'
                              : 'text-amber-700'
                      }`}
                    >
                      {intItem.approvalStatus.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-mono text-slate-500">
                      Server env: {envReady ? 'Configured' : 'Not set'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{intItem.purpose}</p>
                  <div className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">Required Credentials:</span>{' '}
                    <span className="font-mono">{intItem.requiredCredentials.join(', ')}</span>
                    {' · '}
                    <span className="font-semibold text-slate-700">Est. Cost:</span>{' '}
                    {intItem.estimatedCost}
                  </div>
                </div>

                {isSuperAdmin && intItem.providerKey !== 'gemini_ai' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        handleApproval(
                          intItem,
                          envReady ? 'enabled' : 'approved_awaiting_env'
                        )
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {envReady ? 'Approve & Enable' : 'Approve Provider'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproval(intItem, 'disabled')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Disable
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Immutable Audit Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-base font-bold text-slate-900">
              Immutable Security &amp; Operations Audit Log
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
            <ShieldCheck className="w-4 h-4" />
            <span>Append-only enforced in Firestore Rules</span>
          </div>
        </div>
        {auditLogs.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No audit entries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {auditLogs.slice(0, 50).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{log.actorName}</td>
                    <td className="py-2.5 px-4 font-mono text-blue-700">{log.action}</td>
                    <td className="py-2.5 px-4 text-slate-700">{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
