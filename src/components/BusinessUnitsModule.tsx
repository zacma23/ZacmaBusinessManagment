import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Power,
  ExternalLink,
  FileText,
  Users,
  BarChart3,
  Upload,
  X,
  AlertTriangle,
  Building2,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  canManageBusinessUnits,
  createOrUpdateBusinessUnit,
  deleteBusinessUnitSafe,
  formatTimestamp,
} from '../lib/zacmaService';
import type { BusinessUnit, LeadFilterPreset, NavSection } from '../types';

interface Props {
  onNavigate: (section: NavSection, preset?: { businessUnitId?: string; leadFilter?: LeadFilterPreset }) => void;
}

const DEFAULT_FORM_STATE = {
  name: '',
  description: '',
  category: '',
  servicesText: '',
  logoUrl: '',
  brandColor: '#1D4ED8',
  contactEmail: '',
  phoneNumber: '',
  physicalAddress: '',
  website: '',
  assignedAdminIds: [] as string[],
  assignedStaffIds: [] as string[],
  status: 'active' as 'active' | 'inactive',
};

export function BusinessUnitsModule({ onNavigate }: Props) {
  const {
    user,
    organization,
    effectiveRole,
    businessUnits,
    forms,
    leads,
    members,
  } = usePortal();

  const canManage = canManageBusinessUnits(effectiveRole);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<BusinessUnit | null>(null);
  const [formState, setFormState] = useState(DEFAULT_FORM_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BusinessUnit | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredUnits = useMemo(() => {
    return businessUnits.filter((bu) => {
      if (statusFilter !== 'all' && bu.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          bu.name.toLowerCase().includes(q) ||
          bu.category.toLowerCase().includes(q) ||
          bu.description.toLowerCase().includes(q) ||
          bu.services.some((s) => s.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [businessUnits, statusFilter, search]);

  const unitMetrics = useMemo(() => {
    const map = new Map<string, { formCount: number; publishedCount: number; leadCount: number; convertedCount: number }>();
    for (const bu of businessUnits) {
      const buForms = forms.filter((f) => f.businessUnitId === bu.id);
      const buLeads = leads.filter((l) => l.businessUnitId === bu.id);
      map.set(bu.id, {
        formCount: buForms.length,
        publishedCount: buForms.filter((f) => f.isPublished && f.isActive).length,
        leadCount: buLeads.length,
        convertedCount: buLeads.filter((l) => l.status === 'converted').length,
      });
    }
    return map;
  }, [businessUnits, forms, leads]);

  const openCreateModal = () => {
    setEditingUnit(null);
    setFormState(DEFAULT_FORM_STATE);
    setError(null);
    setModalOpen(true);
  };

  const openEditModal = (bu: BusinessUnit) => {
    setEditingUnit(bu);
    setFormState({
      name: bu.name,
      description: bu.description,
      category: bu.category,
      servicesText: bu.services.join(', '),
      logoUrl: bu.logoUrl,
      brandColor: bu.brandColor || '#1D4ED8',
      contactEmail: bu.contactEmail,
      phoneNumber: bu.phoneNumber,
      physicalAddress: bu.physicalAddress,
      website: bu.website,
      assignedAdminIds: bu.assignedAdminIds || [],
      assignedStaffIds: bu.assignedStaffIds || [],
      status: bu.status,
    });
    setError(null);
    setModalOpen(true);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Logo must be an image file (PNG, JPG, WebP, or SVG).');
      return;
    }
    if (file.size > 180 * 1024) {
      setError('Logo image must be under 180 KB for optimal public form loading.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFormState((prev) => ({ ...prev, logoUrl: reader.result as string }));
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !user) return;
    if (formState.name.trim().length < 2) {
      setError('Business unit name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const services = formState.servicesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await createOrUpdateBusinessUnit({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existing: editingUnit,
        data: {
          name: formState.name,
          description: formState.description,
          category: formState.category || 'General Services',
          services,
          logoUrl: formState.logoUrl,
          brandColor: formState.brandColor,
          contactEmail: formState.contactEmail,
          phoneNumber: formState.phoneNumber,
          physicalAddress: formState.physicalAddress,
          website: formState.website,
          assignedAdminIds: formState.assignedAdminIds,
          assignedStaffIds: formState.assignedStaffIds,
          status: formState.status,
        },
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setModalOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save business unit.');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (bu: BusinessUnit) => {
    if (!organization || !user || !canManage) return;
    await createOrUpdateBusinessUnit({
      organizationId: organization.id,
      ownerId: organization.ownerId,
      authorizedUserIds: organization.authorizedUserIds,
      existing: bu,
      data: {
        name: bu.name,
        description: bu.description,
        category: bu.category,
        services: bu.services,
        logoUrl: bu.logoUrl,
        brandColor: bu.brandColor,
        contactEmail: bu.contactEmail,
        phoneNumber: bu.phoneNumber,
        physicalAddress: bu.physicalAddress,
        website: bu.website,
        assignedAdminIds: bu.assignedAdminIds,
        assignedStaffIds: bu.assignedStaffIds,
        status: bu.status === 'active' ? 'inactive' : 'active',
      },
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Admin',
    });
  };

  const confirmDelete = async () => {
    if (!organization || !user || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBusinessUnitSafe({
        organizationId: organization.id,
        businessUnit: deleteTarget,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const toggleMemberSelection = (field: 'assignedAdminIds' | 'assignedStaffIds', uid: string) => {
    setFormState((prev) => {
      const current = prev[field];
      const next = current.includes(uid)
        ? current.filter((id) => id !== uid)
        : [...current, uid];
      return { ...prev, [field]: next };
    });
  };

  const deleteDeps = deleteTarget ? unitMetrics.get(deleteTarget.id) : null;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Business Units Management
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Create and operate independent business lines under {organization?.name || 'Zacma'} with
            dedicated branding, forms, leads, and staff.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Business Unit
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business units, categories, or services…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {(['all', 'active', 'inactive'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State or Grid */}
      {filteredUnits.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="font-display text-lg font-semibold text-slate-900 mb-2">
            {businessUnits.length === 0 ? 'No Business Units Created Yet' : 'No Matching Business Units'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto mb-6">
            {businessUnits.length === 0
              ? 'Add your first business unit dynamically (for example, a Training Institute, Consultancy, Digital Marketing agency, or Travel desk) to start building AI forms and capturing leads.'
              : 'Try adjusting your search query or status filter.'}
          </p>
          {canManage && businessUnits.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create First Business Unit
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredUnits.map((bu) => {
            const m = unitMetrics.get(bu.id) || {
              formCount: 0,
              publishedCount: 0,
              leadCount: 0,
              convertedCount: 0,
            };
            const convRate = m.leadCount > 0 ? Math.round((m.convertedCount / m.leadCount) * 100) : 0;

            return (
              <div
                key={bu.id}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      {bu.logoUrl ? (
                        <img
                          src={bu.logoUrl}
                          alt={bu.name}
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-white"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
                          style={{ backgroundColor: bu.brandColor || '#1D4ED8' }}
                        >
                          {bu.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold text-slate-900 truncate">
                          {bu.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 flex-wrap">
                          <span>{bu.category}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              bu.status === 'active'
                                ? 'text-emerald-700 font-medium'
                                : 'text-red-600 font-medium'
                            }
                          >
                            {bu.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{bu.slug}</span>
                        </div>
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleStatus(bu)}
                          title={bu.status === 'active' ? 'Deactivate business unit' : 'Activate business unit'}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(bu)}
                          title="Edit business unit"
                          className="p-2 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(bu)}
                          title="Delete business unit"
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {bu.description && (
                    <p className="text-sm text-slate-600 leading-relaxed mb-4 line-clamp-2">
                      {bu.description}
                    </p>
                  )}

                  {bu.services.length > 0 && (
                    <p className="text-xs text-slate-500 mb-4">
                      <span className="font-medium text-slate-700">Services: </span>
                      {bu.services.join(' · ')}
                    </p>
                  )}

                  {/* Contact Metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-slate-500 pb-4 border-b border-slate-100">
                    <div>
                      <span className="text-slate-400">Email: </span>
                      <span className="text-slate-700">{bu.contactEmail || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Phone: </span>
                      <span className="text-slate-700 font-mono">{bu.phoneNumber || '—'}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-400">Address: </span>
                      <span className="text-slate-700">{bu.physicalAddress || '—'}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-400">Website: </span>
                      {bu.website ? (
                        <a
                          href={bu.website.startsWith('http') ? bu.website : `https://${bu.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          {bu.website}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Live KPI Strip + Drilldown Actions */}
                <div className="pt-4">
                  <div className="grid grid-cols-4 gap-3 mb-4 text-center">
                    <div className="py-2 bg-slate-50 rounded-lg">
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                        {m.formCount}
                      </div>
                      <div className="text-[11px] text-slate-500">Forms</div>
                    </div>
                    <div className="py-2 bg-slate-50 rounded-lg">
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                        {m.leadCount}
                      </div>
                      <div className="text-[11px] text-slate-500">Leads</div>
                    </div>
                    <div className="py-2 bg-slate-50 rounded-lg">
                      <div className="text-base font-bold font-mono tabular-nums text-emerald-700">
                        {convRate}%
                      </div>
                      <div className="text-[11px] text-slate-500">Converted</div>
                    </div>
                    <div className="py-2 bg-slate-50 rounded-lg">
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                        {(bu.assignedAdminIds?.length || 0) + (bu.assignedStaffIds?.length || 0)}
                      </div>
                      <div className="text-[11px] text-slate-500">Team</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onNavigate('ai_form_generator', { businessUnitId: bu.id })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Manage Forms
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('all_leads', {
                            leadFilter: { businessUnitId: bu.id, status: 'all' },
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5" />
                        View Leads
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('business_reports', { businessUnitId: bu.id })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        Reports
                      </button>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Created {formatTimestamp(bu.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Business Unit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editingUnit ? `Edit ${editingUnit.name}` : 'Create Business Unit'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Business Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    placeholder="e.g., Zacma Technology Training Institute"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Business Category *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                    placeholder="e.g., Education, Consultancy, Marketing, Travel"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Business Description
                </label>
                <textarea
                  rows={3}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="Describe this business unit's mission, audience, and core offerings…"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Services Offered (comma-separated)
                </label>
                <input
                  type="text"
                  value={formState.servicesText}
                  onChange={(e) => setFormState({ ...formState, servicesText: e.target.value })}
                  placeholder="e.g., Full-Stack Bootcamp, IELTS Prep, Corporate Workshops"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              {/* Branding Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Brand Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formState.brandColor}
                      onChange={(e) => setFormState({ ...formState, brandColor: e.target.value })}
                      className="w-10 h-10 p-1 border border-slate-300 rounded-lg cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formState.brandColor}
                      onChange={(e) => setFormState({ ...formState, brandColor: e.target.value })}
                      className="flex-1 px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Unit Logo (max 180 KB)
                  </label>
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer w-full justify-center">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{formState.logoUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Operational Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as 'active' | 'inactive' })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={formState.contactEmail}
                    onChange={(e) => setFormState({ ...formState, contactEmail: e.target.value })}
                    placeholder="unit@zacma.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={formState.phoneNumber}
                    onChange={(e) => setFormState({ ...formState, phoneNumber: e.target.value })}
                    placeholder="+1 (555) 000-0000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Physical Address
                  </label>
                  <input
                    type="text"
                    value={formState.physicalAddress}
                    onChange={(e) => setFormState({ ...formState, physicalAddress: e.target.value })}
                    placeholder="Street, City, Country"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Website
                  </label>
                  <input
                    type="text"
                    value={formState.website}
                    onChange={(e) => setFormState({ ...formState, website: e.target.value })}
                    placeholder="https://zacma.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Staff Assignments */}
              {members.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-2">
                      Assigned Administrators / Managers
                    </label>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                      {members.map((mem) => (
                        <label key={mem.userId} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formState.assignedAdminIds.includes(mem.userId)}
                            onChange={() => toggleMemberSelection('assignedAdminIds', mem.userId)}
                            className="rounded border-slate-300 text-blue-700"
                          />
                          <span className="truncate">{mem.displayName}</span>
                          <span className="text-slate-400">({mem.role})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-2">
                      Assigned Sales / Operations Staff
                    </label>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                      {members.map((mem) => (
                        <label key={mem.userId} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formState.assignedStaffIds.includes(mem.userId)}
                            onChange={() => toggleMemberSelection('assignedStaffIds', mem.userId)}
                            className="rounded border-slate-300 text-blue-700"
                          />
                          <span className="truncate">{mem.displayName}</span>
                          <span className="text-slate-400">({mem.role})</span>
                        </label>
                      ))}
                    </div>
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
                  className="px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {saving ? 'Saving…' : editingUnit ? 'Save Changes' : 'Create Business Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dependency-Checked Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-display text-base font-bold text-slate-900">
                Delete Business Unit?
              </h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              You are about to remove <span className="font-semibold text-slate-900">{deleteTarget.name}</span>.
            </p>
            {deleteDeps && (deleteDeps.formCount > 0 || deleteDeps.leadCount > 0) && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mb-5 space-y-1">
                <p className="font-semibold">Dependency Check Warning</p>
                <p>
                  This unit currently has <span className="font-mono font-bold">{deleteDeps.formCount}</span> form(s) and{' '}
                  <span className="font-mono font-bold">{deleteDeps.leadCount}</span> lead(s). Consider deactivating instead of deleting if you want to preserve active form operations.
                </p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
