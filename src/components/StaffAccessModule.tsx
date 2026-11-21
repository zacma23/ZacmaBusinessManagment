import React, { useState } from 'react';
import { UserPlus, Shield, Edit3, X, Check } from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import { canManageOrg, upsertOrganizationMember } from '../lib/zacmaService';
import type { OrganizationMember, UserRole } from '../types';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organization Admin',
  bu_manager: 'Business Unit Manager',
  staff: 'Staff / Sales Agent',
  accountant: 'Accountant (Non-CRM)',
  instructor: 'Instructor (Non-CRM)',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Full platform control across all business units, forms, leads, staff, AI, and API integrations.',
  org_admin: 'Manage organization business units, forms, leads, staff assignments, communications, and reports.',
  bu_manager: 'Manage assigned business units, their forms, leads, and unit-level performance reports.',
  staff: 'Access assigned business units and leads, update status, log calls/notes, and send permitted follow-ups.',
  accountant: 'Preserves existing accounting role; CRM access remains off unless explicitly authorized.',
  instructor: 'Preserves existing instructor role; CRM access remains off unless explicitly authorized.',
};

export function StaffAccessModule() {
  const { user, organization, effectiveRole, members, businessUnits } = usePortal();
  const canManage = canManageOrg(effectiveRole);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationMember | null>(null);
  const [formState, setFormState] = useState({
    userId: '',
    displayName: '',
    email: '',
    role: 'staff' as UserRole,
    crmAccess: true,
    assignedBusinessUnitIds: [] as string[],
    status: 'active' as 'active' | 'inactive' | 'invited',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormState({
      userId: '',
      displayName: '',
      email: '',
      role: 'staff',
      crmAccess: true,
      assignedBusinessUnitIds: [],
      status: 'active',
    });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (mem: OrganizationMember) => {
    setEditing(mem);
    setFormState({
      userId: mem.userId,
      displayName: mem.displayName,
      email: mem.email,
      role: mem.role,
      crmAccess: mem.crmAccess,
      assignedBusinessUnitIds: mem.assignedBusinessUnitIds || [],
      status: mem.status,
    });
    setError(null);
    setModalOpen(true);
  };

  const handleRoleChange = (role: UserRole) => {
    const defaultCrm = !['accountant', 'instructor'].includes(role);
    setFormState((prev) => ({ ...prev, role, crmAccess: defaultCrm }));
  };

  const toggleBu = (buId: string) => {
    setFormState((prev) => ({
      ...prev,
      assignedBusinessUnitIds: prev.assignedBusinessUnitIds.includes(buId)
        ? prev.assignedBusinessUnitIds.filter((id) => id !== buId)
        : [...prev.assignedBusinessUnitIds, buId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !user) return;
    if (!formState.displayName.trim() || !formState.email.trim()) {
      setError('Display name and email are required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await upsertOrganizationMember({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existing: editing,
        data: formState,
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setModalOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save staff member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Business Staff &amp; Role-Based Access Control
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Assign administrators, business unit managers, sales agents, and non-CRM roles. Enforced
            at both API and Firestore Security Rules layers.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            Add Staff Member
          </button>
        )}
      </div>

      {/* Staff Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Team Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Assigned Business Units</th>
                <th className="py-3 px-4">CRM Access</th>
                <th className="py-3 px-4">Status</th>
                {canManage && <th className="py-3 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {members.map((mem) => {
                const assignedNames = (mem.assignedBusinessUnitIds || [])
                  .map((id) => businessUnits.find((b) => b.id === id)?.name)
                  .filter(Boolean);

                return (
                  <tr key={mem.userId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{mem.displayName}</div>
                      <div className="text-xs text-slate-500">{mem.email}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium">
                      {ROLE_LABELS[mem.role] || mem.role}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {mem.role === 'super_admin' || mem.role === 'org_admin'
                        ? 'All Business Units'
                        : assignedNames.length > 0
                          ? assignedNames.join(' · ')
                          : 'None assigned'}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className={mem.crmAccess ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                        {mem.crmAccess ? 'Authorized' : 'Restricted'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs capitalize">
                      <span
                        className={
                          mem.status === 'active'
                            ? 'text-emerald-700 font-medium'
                            : mem.status === 'invited'
                              ? 'text-amber-700 font-medium'
                              : 'text-red-600 font-medium'
                        }
                      >
                        {mem.status}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(mem)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Governance Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-blue-700" />
          <h2 className="font-display text-base font-bold text-slate-900">
            Access Level Governance Matrix
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <div key={role} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-sm font-semibold text-slate-900 mb-1">
                {ROLE_LABELS[role]}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Staff Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editing ? 'Update Staff Permissions' : 'Add Staff Member'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formState.displayName}
                  onChange={(e) => setFormState({ ...formState, displayName: e.target.value })}
                  placeholder="e.g., Sarah Kebede"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Workspace Email *
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  placeholder="sarah@zacma.com"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {!editing && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Firebase User UID (optional — paste user's UID to grant immediate login access)
                  </label>
                  <input
                    type="text"
                    value={formState.userId}
                    onChange={(e) => setFormState({ ...formState, userId: e.target.value })}
                    placeholder="Leave blank to create staff directory entry"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Role Tier
                  </label>
                  <select
                    value={formState.role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Account Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        status: e.target.value as 'active' | 'inactive' | 'invited',
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.crmAccess}
                  onChange={(e) => setFormState({ ...formState, crmAccess: e.target.checked })}
                  className="rounded border-slate-300 text-blue-700"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Grant CRM Module Access</div>
                  <div className="text-[11px] text-slate-500">
                    Accountants and Instructors keep CRM disabled unless explicitly checked here.
                  </div>
                </div>
              </label>

              {businessUnits.length > 0 && !['super_admin', 'org_admin'].includes(formState.role) && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Authorized Business Units
                  </label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-3">
                    {businessUnits.map((bu) => (
                      <label key={bu.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formState.assignedBusinessUnitIds.includes(bu.id)}
                          onChange={() => toggleBu(bu.id)}
                          className="rounded border-slate-300 text-blue-700"
                        />
                        <span>{bu.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
