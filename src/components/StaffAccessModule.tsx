import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  adminDeleteUserAccount,
  adminProvisionUserAccount,
  adminUpdateUserAccount,
  DEFAULT_ROLE_PERMISSIONS,
  fetchAuthProviderStatus,
  generateStrongPassword,
  normalizeUsername,
  requestPasswordReset,
  resolveEffectivePermissions,
  validatePasswordStrength,
  type AuthProviderStatus,
} from '../lib/authService';
import {
  FIREBASE_CONSOLE_AUTH_DOMAINS_URL,
  FIREBASE_CONSOLE_SIGNIN_METHODS_URL,
  FIREBASE_PROJECT_ID,
} from '../lib/firebase';
import { canManageOrg, formatTimestamp } from '../lib/zacmaService';
import type { MemberPermissions, OrganizationMember, UserRole } from '../types';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organization Admin',
  bu_manager: 'Business Unit Manager',
  staff: 'Staff / Sales Agent',
  accountant: 'Accountant',
  instructor: 'Instructor',
  student: 'Student / Customer',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin:
    'Full platform control across tenants, business units, forms, CRM, user management, AI, and billing.',
  org_admin:
    'Full tenant administrator for this organization: business units, forms, CRM, users, and billing.',
  bu_manager:
    'Manages assigned business units, their dynamic forms, leads, and unit-level reports.',
  staff:
    'Operates assigned business units and CRM leads, updates status, logs calls/notes, and sends follow-ups.',
  accountant:
    'Accounting and billing visibility with CRM disabled unless explicitly granted.',
  instructor:
    'Training & AI support visibility for courses and student questions without CRM access by default.',
  student:
    'Strictly isolated self-service portal: view own enrollments, courses, profile, and password security only.',
};

const PERMISSION_LABELS: Array<{ key: keyof MemberPermissions; label: string }> = [
  { key: 'businessUnits', label: 'Business Units' },
  { key: 'forms', label: 'Forms & AI Builder' },
  { key: 'crm', label: 'CRM & Leads' },
  { key: 'communications', label: 'Email & SMS' },
  { key: 'aiSupport', label: 'AI Support Admin' },
  { key: 'reports', label: 'Reports & Analytics' },
  { key: 'userManagement', label: 'User Management' },
  { key: 'billing', label: 'Billing & Plan' },
];

export function StaffAccessModule() {
  const {
    user,
    organization,
    effectiveRole,
    effectivePermissions,
    isPlatformOwner,
    members,
    loginActivity,
    businessUnits,
    subscriptionPolicy,
  } = usePortal();

  const canManage = canManageOrg(effectiveRole) || effectivePermissions.userManagement;

  const [activeTab, setActiveTab] = useState<'directory' | 'security'>('directory');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auth provider diagnostics
  const [providerStatus, setProviderStatus] = useState<AuthProviderStatus | null>(null);
  const [checkingProvider, setCheckingProvider] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationMember | null>(null);
  const [authProviderMode, setAuthProviderMode] = useState<'username_password' | 'google'>(
    'username_password'
  );
  const [showPasswordField, setShowPasswordField] = useState(true);
  const [formState, setFormState] = useState({
    userId: '',
    displayName: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    role: 'staff' as UserRole,
    permissions: { ...DEFAULT_ROLE_PERMISSIONS.staff } as MemberPermissions,
    assignedBusinessUnitIds: [] as string[],
    status: 'active' as 'active' | 'inactive' | 'invited' | 'suspended',
    mustChangePassword: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-time credential handover modal after admin creates username/password user
  const [createdCredentials, setCreatedCredentials] = useState<{
    displayName: string;
    username: string;
    password: string;
    role: UserRole;
  } | null>(null);
  const [copiedCredField, setCopiedCredField] = useState<string | null>(null);

  // Action feedback toast
  const [actionNotice, setActionNotice] = useState<{ text: string; isError?: boolean } | null>(
    null
  );
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmDeleteMember, setConfirmDeleteMember] = useState<OrganizationMember | null>(null);

  const loadProviderStatus = async () => {
    setCheckingProvider(true);
    try {
      const status = await fetchAuthProviderStatus();
      setProviderStatus(status);
    } finally {
      setCheckingProvider(false);
    }
  };

  useEffect(() => {
    void loadProviderStatus();
  }, []);

  const currentHostname =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'localhost';

  const assignableRoles: UserRole[] = useMemo(() => {
    const all: UserRole[] = [
      'super_admin',
      'org_admin',
      'bu_manager',
      'staff',
      'accountant',
      'instructor',
      'student',
    ];
    return isPlatformOwner ? all : all.filter((r) => r !== 'super_admin');
  }, [isPlatformOwner]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.username || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q)
      );
    });
  }, [members, searchQuery, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = members.length;
    const active = members.filter((m) => m.status === 'active').length;
    const passwordUsers = members.filter((m) => m.authProvider === 'username_password').length;
    const students = members.filter((m) => m.role === 'student').length;
    const restricted = members.filter(
      (m) => m.status === 'inactive' || m.status === 'suspended'
    ).length;
    return { total, active, passwordUsers, students, restricted };
  }, [members]);

  const openAdd = () => {
    setEditing(null);
    setAuthProviderMode('username_password');
    const generatedPw = generateStrongPassword(12);
    setFormState({
      userId: '',
      displayName: '',
      username: '',
      email: '',
      phone: '',
      password: generatedPw,
      role: 'staff',
      permissions: { ...DEFAULT_ROLE_PERMISSIONS.staff },
      assignedBusinessUnitIds: [],
      status: 'active',
      mustChangePassword: true,
    });
    setShowPasswordField(true);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (mem: OrganizationMember) => {
    setEditing(mem);
    setAuthProviderMode(mem.authProvider || 'google');
    setFormState({
      userId: mem.userId,
      displayName: mem.displayName,
      username: mem.username || '',
      email: mem.email,
      phone: mem.phone || '',
      password: '',
      role: mem.role,
      permissions: resolveEffectivePermissions(mem.role, mem.permissions, mem.crmAccess),
      assignedBusinessUnitIds: mem.assignedBusinessUnitIds || [],
      status: mem.status,
      mustChangePassword: Boolean(mem.mustChangePassword),
    });
    setError(null);
    setModalOpen(true);
  };

  const handleRoleChange = (role: UserRole) => {
    setFormState((prev) => ({
      ...prev,
      role,
      permissions: { ...DEFAULT_ROLE_PERMISSIONS[role] },
      assignedBusinessUnitIds: role === 'student' ? [] : prev.assignedBusinessUnitIds,
    }));
  };

  const togglePermission = (key: keyof MemberPermissions) => {
    setFormState((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key],
      },
    }));
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
    if (!formState.displayName.trim()) {
      setError('Full name is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await adminUpdateUserAccount({
          organizationId: organization.id,
          ownerId: organization.ownerId,
          authorizedUserIds: organization.authorizedUserIds,
          existing: editing,
          updates: {
            displayName: formState.displayName.trim(),
            email: formState.email.trim(),
            phone: formState.phone.trim(),
            role: formState.role,
            crmAccess: formState.permissions.crm,
            permissions: formState.permissions,
            assignedBusinessUnitIds: formState.assignedBusinessUnitIds,
            status: formState.status,
            mustChangePassword: formState.mustChangePassword,
          },
          actorId: user.uid,
          actorName: user.displayName || user.email || 'Admin',
        });
        setModalOpen(false);
        setActionNotice({ text: `Updated account for ${formState.displayName.trim()}.` });
      } else {
        const res = await adminProvisionUserAccount({
          organizationId: organization.id,
          ownerId: organization.ownerId,
          authorizedUserIds: organization.authorizedUserIds,
          actorId: user.uid,
          actorName: user.displayName || user.email || 'Admin',
          authProvider: authProviderMode,
          displayName: formState.displayName.trim(),
          username: authProviderMode === 'username_password' ? formState.username : '',
          email: formState.email.trim(),
          phone: formState.phone.trim(),
          password: authProviderMode === 'username_password' ? formState.password : '',
          role: formState.role,
          crmAccess: formState.permissions.crm,
          permissions: formState.permissions,
          assignedBusinessUnitIds: formState.assignedBusinessUnitIds,
          mustChangePassword: formState.mustChangePassword,
          status: formState.status,
          existingUid: authProviderMode === 'google' ? formState.userId.trim() : '',
        });
        setModalOpen(false);
        if (authProviderMode === 'username_password') {
          setCreatedCredentials({
            displayName: formState.displayName.trim(),
            username: res.username,
            password: formState.password,
            role: formState.role,
          });
        } else {
          setActionNotice({ text: `Added Google workspace member ${formState.displayName.trim()}.` });
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save user account.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (mem: OrganizationMember) => {
    if (!organization || !user) return;
    if (mem.userId === user.uid || mem.userId === organization.ownerId) {
      setActionNotice({
        text: 'You cannot suspend or deactivate the primary organization owner or yourself.',
        isError: true,
      });
      return;
    }
    const nextStatus: OrganizationMember['status'] =
      mem.status === 'active' ? 'suspended' : 'active';
    setBusyUid(mem.userId);
    try {
      await adminUpdateUserAccount({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existing: mem,
        updates: {
          displayName: mem.displayName,
          email: mem.email,
          phone: mem.phone || '',
          role: mem.role,
          crmAccess: mem.crmAccess,
          permissions: resolveEffectivePermissions(mem.role, mem.permissions, mem.crmAccess),
          assignedBusinessUnitIds: mem.assignedBusinessUnitIds || [],
          status: nextStatus,
          mustChangePassword: Boolean(mem.mustChangePassword),
        },
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setActionNotice({
        text: `${mem.displayName} is now ${nextStatus}.`,
      });
    } catch (err: unknown) {
      setActionNotice({
        text: err instanceof Error ? err.message : 'Unable to update status.',
        isError: true,
      });
    } finally {
      setBusyUid(null);
    }
  };

  const handleSendPasswordReset = async (mem: OrganizationMember) => {
    setBusyUid(mem.userId);
    try {
      const target = mem.username || mem.email;
      const res = await requestPasswordReset(target);
      setActionNotice({ text: res.message, isError: Boolean(res.requiresAdminReset) });
    } catch (err: unknown) {
      setActionNotice({
        text: err instanceof Error ? err.message : 'Unable to trigger password reset.',
        isError: true,
      });
    } finally {
      setBusyUid(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteMember || !organization || !user) return;
    setBusyUid(confirmDeleteMember.userId);
    try {
      await adminDeleteUserAccount({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        member: confirmDeleteMember,
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setActionNotice({ text: `Removed user account ${confirmDeleteMember.displayName}.` });
      setConfirmDeleteMember(null);
    } catch (err: unknown) {
      setActionNotice({
        text: err instanceof Error ? err.message : 'Unable to delete account.',
        isError: true,
      });
    } finally {
      setBusyUid(null);
    }
  };

  const copyText = (key: string, val: string) => {
    void navigator.clipboard.writeText(val);
    setCopiedCredField(key);
    setTimeout(() => setCopiedCredField(null), 2000);
  };

  const pwStrength = validatePasswordStrength(formState.password);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            User Management &amp; Access Control
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Create Username &amp; Password or Google accounts, enforce granular RBAC across staff
            and students, and monitor sign-in security for{' '}
            <strong className="text-slate-900">{organization?.name || 'Zacma Portal'}</strong>.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={!subscriptionPolicy.canCreateUsers}
            onClick={openAdd}
            title={
              !subscriptionPolicy.canCreateUsers
                ? 'Renew your subscription to add new user accounts'
                : 'Create a new user account'
            }
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            Create User Account
          </button>
        )}
      </div>

      {/* Action Feedback Banner */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
            actionNotice.isError
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{actionNotice.text}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Total Users</div>
          <div className="font-mono text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Active Accounts</div>
          <div className="font-mono text-2xl font-bold text-emerald-700 mt-1">{stats.active}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Username / Password</div>
          <div className="font-mono text-2xl font-bold text-blue-700 mt-1">
            {stats.passwordUsers}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Student Accounts</div>
          <div className="font-mono text-2xl font-bold text-slate-900 mt-1">{stats.students}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Suspended / Inactive</div>
          <div className="font-mono text-2xl font-bold text-red-600 mt-1">{stats.restricted}</div>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('directory')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>User Directory ({members.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'security'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Login Activity &amp; Auth Health ({loginActivity.length})</span>
        </button>
      </div>

      {/* TAB 1: USER DIRECTORY */}
      {activeTab === 'directory' && (
        <div className="space-y-6">
          {/* Search & Filter Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by full name, @username, email, or phone…"
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Roles</option>
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="invited">Invited</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">User &amp; Sign-In Method</th>
                    <th className="py-3 px-4">Role Tier</th>
                    <th className="py-3 px-4">Scope / Business Units</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4">Status</th>
                    {canManage && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                        No matching user accounts found.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((mem) => {
                      const assignedNames = (mem.assignedBusinessUnitIds || [])
                        .map((id) => businessUnits.find((b) => b.id === id)?.name)
                        .filter(Boolean);
                      const isSelfOrOwner =
                        mem.userId === user?.uid || mem.userId === organization?.ownerId;

                      return (
                        <tr key={mem.userId} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">
                                {mem.displayName}
                              </span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {mem.authProvider === 'username_password' ? 'Username' : 'Google'}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {mem.username ? (
                                <span className="font-mono text-blue-700 mr-2">@{mem.username}</span>
                              ) : null}
                              <span>{mem.email}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-xs font-semibold text-slate-800">
                              {ROLE_LABELS[mem.role] || mem.role}
                            </div>
                            {mem.mustChangePassword && (
                              <div className="text-[10px] text-amber-700 mt-0.5">
                                Must change password on next login
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {mem.role === 'student'
                              ? 'Isolated Student Portal'
                              : mem.role === 'super_admin' || mem.role === 'org_admin'
                                ? 'All Business Units'
                                : assignedNames.length > 0
                                  ? assignedNames.join(' · ')
                                  : 'Organization Scope'}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-slate-500">
                            {mem.lastLoginAt ? formatTimestamp(mem.lastLoginAt) : 'Never'}
                          </td>
                          <td className="py-3 px-4 text-xs capitalize">
                            <span
                              className={`font-semibold ${
                                mem.status === 'active'
                                  ? 'text-emerald-700'
                                  : mem.status === 'invited'
                                    ? 'text-amber-700'
                                    : 'text-red-600'
                              }`}
                            >
                              {mem.status}
                            </span>
                          </td>
                          {canManage && (
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={busyUid === mem.userId}
                                  onClick={() => openEdit(mem)}
                                  title="Edit role & permissions"
                                  className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-md cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                {mem.authProvider === 'username_password' && (
                                  <button
                                    type="button"
                                    disabled={busyUid === mem.userId}
                                    onClick={() => void handleSendPasswordReset(mem)}
                                    title="Send password reset email"
                                    className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-md cursor-pointer"
                                  >
                                    <KeyRound className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {!isSelfOrOwner && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busyUid === mem.userId}
                                      onClick={() => void handleToggleStatus(mem)}
                                      title={
                                        mem.status === 'active'
                                          ? 'Suspend account'
                                          : 'Activate account'
                                      }
                                      className={`p-1.5 rounded-md cursor-pointer ${
                                        mem.status === 'active'
                                          ? 'text-slate-600 hover:text-amber-700 hover:bg-amber-50'
                                          : 'text-emerald-600 hover:bg-emerald-50'
                                      }`}
                                    >
                                      {mem.status === 'active' ? (
                                        <UserX className="w-3.5 h-3.5" />
                                      ) : (
                                        <UserCheck className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busyUid === mem.userId}
                                      onClick={() => setConfirmDeleteMember(mem)}
                                      title="Delete account"
                                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Role Governance Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-blue-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Multi-Tenant Role Governance Matrix
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                <div key={role} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-sm font-semibold text-slate-900 mb-1">
                    {ROLE_LABELS[role]}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {ROLE_DESCRIPTIONS[role]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LOGIN ACTIVITY & AUTH HEALTH */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Firebase Auth & Vercel Domain Readiness Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Domain Authorization Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Vercel &amp; Firebase Authorized Domains
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500">{FIREBASE_PROJECT_ID}</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                To prevent <code className="font-mono text-red-600">auth/unauthorized-domain</code>{' '}
                when logging in with Google on Vercel production or preview deployments, ensure this
                hostname is added under Firebase Console → Authentication → Settings → Authorized
                domains:
              </p>
              <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <code className="text-xs font-mono text-slate-900 truncate">{currentHostname}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(currentHostname);
                    setCopiedHost(true);
                    setTimeout(() => setCopiedHost(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 shrink-0 cursor-pointer"
                >
                  {copiedHost ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Host</span>
                    </>
                  )}
                </button>
              </div>
              <a
                href={FIREBASE_CONSOLE_AUTH_DOMAINS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
              >
                <span>Manage Authorized Domains in Firebase Console</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Provider Status & Active Security Policies */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Sign-In Providers &amp; Security Controls
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={checkingProvider}
                  onClick={() => void loadProviderStatus()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingProvider ? 'animate-spin' : ''}`} />
                  <span>Recheck</span>
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="font-medium text-slate-800">Google OAuth (Firebase)</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Enabled
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="font-medium text-slate-800">
                    Email/Password (Admin-Created Accounts)
                  </span>
                  {providerStatus?.emailPasswordEnabled ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Enabled
                    </span>
                  ) : (
                    <a
                      href={FIREBASE_CONSOLE_SIGNIN_METHODS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Enable in Console</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                <div>✓ 5-attempt brute-force lockout</div>
                <div>✓ Strong 8+ char password policy</div>
                <div>✓ 60-min inactivity auto-logout</div>
                <div>✓ Forced first-login reset</div>
              </div>
            </div>
          </div>

          {/* Login Activity Log Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Immutable Login &amp; Security Activity Log
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Append-only authentication audit log scoped strictly to{' '}
                  {organization?.name || 'this tenant'}.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Event</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Domain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loginActivity.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No authentication events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    loginActivity.slice(0, 50).map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                          {formatTimestamp(ev.createdAt)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{ev.displayName}</div>
                          <div className="text-[11px] text-slate-500">
                            {ev.username ? `@${ev.username} · ` : ''}
                            {ev.email}
                          </div>
                        </td>
                        <td className="py-3 px-4 capitalize font-medium text-slate-800">
                          {ev.eventType.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {ev.authMethod === 'google' ? 'Google OAuth' : 'Username & Password'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {ROLE_LABELS[ev.role] || ev.role}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500">{ev.domain || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editing ? `Edit Account · ${editing.displayName}` : 'Create User Account'}
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

              {/* Auth Method Selector (Create only) */}
              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Authentication Method
                  </label>
                  <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setAuthProviderMode('username_password')}
                      className={`py-2 px-3 rounded-md text-xs font-semibold cursor-pointer ${
                        authProviderMode === 'username_password'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Username &amp; Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthProviderMode('google')}
                      className={`py-2 px-3 rounded-md text-xs font-semibold cursor-pointer ${
                        authProviderMode === 'google'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Google OAuth Account
                    </button>
                  </div>
                </div>
              )}

              {!editing &&
                authProviderMode === 'username_password' &&
                providerStatus &&
                !providerStatus.emailPasswordEnabled && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>One-Time Firebase Setup Required</span>
                    </div>
                    <p className="leading-relaxed">
                      Email/Password sign-in is currently disabled on Firebase project{' '}
                      <strong className="font-mono">{FIREBASE_PROJECT_ID}</strong>. Enable it in
                      Firebase Console before creating username/password credentials.
                    </p>
                    <a
                      href={FIREBASE_CONSOLE_SIGNIN_METHODS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                    >
                      <span>Open Firebase Sign-in Method Settings</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.displayName}
                    onChange={(e) => setFormState({ ...formState, displayName: e.target.value })}
                    placeholder="e.g., Dawit Bekele"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    placeholder="+251 9XX XXX XXX"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {authProviderMode === 'username_password' && !editing && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Login Username * (lowercase letters, numbers, . _ -)
                  </label>
                  <div className="flex items-center">
                    <span className="px-3 py-2 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg text-sm text-slate-500 font-mono">
                      @
                    </span>
                    <input
                      type="text"
                      required
                      value={formState.username}
                      onChange={(e) =>
                        setFormState({ ...formState, username: normalizeUsername(e.target.value) })
                      }
                      placeholder="dawit.staff"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-r-lg"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {authProviderMode === 'google'
                    ? 'Google Email Address *'
                    : 'Recovery / Contact Email (Optional — enables self-service password reset)'}
                </label>
                <input
                  type="email"
                  required={authProviderMode === 'google'}
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  placeholder={
                    authProviderMode === 'google'
                      ? 'staff@gmail.com'
                      : 'Leave blank for internal @username login only'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {!editing && authProviderMode === 'google' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Firebase User UID (Optional — paste UID for immediate access)
                  </label>
                  <input
                    type="text"
                    value={formState.userId}
                    onChange={(e) => setFormState({ ...formState, userId: e.target.value })}
                    placeholder="Leave blank to pre-register directory entry"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              {/* Strong Password Field (Create Username/Password) */}
              {!editing && authProviderMode === 'username_password' && (
                <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-800">
                      Initial Password *
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormState({ ...formState, password: generateStrongPassword(14) })
                      }
                      className="text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
                    >
                      Generate Strong Password
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPasswordField ? 'text' : 'password'}
                      required
                      value={formState.password}
                      onChange={(e) => setFormState({ ...formState, password: e.target.value })}
                      className="w-full pl-3 pr-10 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordField((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPasswordField ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={pwStrength.valid ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                      {pwStrength.message}
                    </span>
                    <span className="font-mono text-slate-500">{pwStrength.score}/5 rules</span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.mustChangePassword}
                      onChange={(e) =>
                        setFormState({ ...formState, mustChangePassword: e.target.checked })
                      }
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span>Force password change on first login (recommended)</span>
                  </label>
                </div>
              )}

              {/* Role & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Role Tier *
                  </label>
                  <select
                    value={formState.role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Account Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        status: e.target.value as 'active' | 'inactive' | 'invited' | 'suspended',
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* Granular Module Permissions */}
              {formState.role !== 'student' && formState.role !== 'super_admin' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Granular Module Permissions
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    {PERMISSION_LABELS.map((p) => (
                      <label
                        key={p.key}
                        className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formState.permissions[p.key]}
                          onChange={() => togglePermission(p.key)}
                          className="rounded border-slate-300 text-blue-700"
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {formState.role === 'student' && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
                  Student / Customer accounts are strictly isolated to the self-service Student
                  Portal (own enrollments, courses, profile, and password security only). They
                  cannot view CRM leads, forms, or organization admin pages.
                </div>
              )}

              {businessUnits.length > 0 &&
                !['super_admin', 'org_admin', 'student'].includes(formState.role) && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">
                      Assigned Business Units
                    </label>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-3">
                      {businessUnits.map((bu) => (
                        <label
                          key={bu.id}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                        >
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

              {editing && editing.authProvider === 'username_password' && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.mustChangePassword}
                    onChange={(e) =>
                      setFormState({ ...formState, mustChangePassword: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Require password change on user&apos;s next login</span>
                </label>
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
                  disabled={
                    saving ||
                    (!editing && authProviderMode === 'username_password' && !pwStrength.valid)
                  }
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create User Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ONE-TIME CREDENTIALS HANDOVER MODAL */}
      {createdCredentials && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
              <h3 className="font-display text-lg font-bold text-slate-900">
                Account Created Successfully
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Share these sign-in credentials securely with{' '}
              <strong className="text-slate-900">{createdCredentials.displayName}</strong> (
              {ROLE_LABELS[createdCredentials.role]}). For security, this password is never stored
              in plain text and will not be shown again.
            </p>

            <div className="space-y-2.5 bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-slate-500">Username</div>
                  <div className="text-sm font-mono font-bold text-slate-900">
                    {createdCredentials.username}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('user', createdCredentials.username)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 cursor-pointer"
                >
                  {copiedCredField === 'user' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedCredField === 'user' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="border-t border-slate-200 pt-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-slate-500">Temporary Password</div>
                  <div className="text-sm font-mono font-bold text-slate-900">
                    {createdCredentials.password}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('pass', createdCredentials.password)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 cursor-pointer"
                >
                  {copiedCredField === 'pass' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedCredField === 'pass' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCreatedCredentials(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Done — I Have Saved These Credentials
            </button>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {confirmDeleteMember && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-sm w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-5 h-5" />
              <h3 className="font-display text-base font-bold text-slate-900">
                Revoke &amp; Delete Account?
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This will immediately revoke workspace access for{' '}
              <strong className="text-slate-900">{confirmDeleteMember.displayName}</strong> and
              remove their username login from this organization.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteMember(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyUid === confirmDeleteMember.userId}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer"
              >
                {busyUid === confirmDeleteMember.userId ? 'Removing…' : 'Remove Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
