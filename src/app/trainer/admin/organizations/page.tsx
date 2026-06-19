'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  Building2,
  Plus,
  Pencil,
  Power,
  Users,
  Crown,
  X,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

type OrgItem = {
  id: string;
  name: string;
  slug: string;
  subscriptionPlan: 'LIGHT' | 'PRO';
  maxTraineeSeats: number;
  maxTrainerSeats: number;
  isActive: boolean;
  isPlatformOwner: boolean;
  contactEmail: string | null;
  contactPerson: string | null;
  notes: string | null;
  currentTrainers: number;
  currentTrainees: number;
};

type OrgForm = {
  name: string;
  slug: string;
  subscriptionPlan: 'LIGHT' | 'PRO';
  maxTraineeSeats: number;
  maxTrainerSeats: number;
  contactEmail: string;
  contactPerson: string;
  notes: string;
};

const ADMIN_ROLES = ['admin', 'temp_admin'];
const emptyForm: OrgForm = {
  name: '',
  slug: '',
  subscriptionPlan: 'LIGHT',
  maxTraineeSeats: 50,
  maxTrainerSeats: 5,
  contactEmail: '',
  contactPerson: '',
  notes: '',
};

export default function AdminOrganizationsPage() {
  const { profile, user, loading, isAdmin } = useAuth() as any;
  const { t } = useLanguage();
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgItem | null>(null);
  const [form, setForm] = useState<OrgForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const loadOrgs = useCallback(async () => {
    if (!profile) return;
    try {
      const res = await fetch(`/api/admin/organizations?adminId=${profile.id}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('admin.org.failedLoad'));
      const data = await res.json();
      setOrgs(data.organizations || []);
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  }, [profile, t]);

  useEffect(() => {
    if (profile && ADMIN_ROLES.includes(profile.role)) loadOrgs();
  }, [profile, loadOrgs]);

  const openCreate = () => {
    setEditingOrg(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (org: OrgItem) => {
    setEditingOrg(org);
    setForm({
      name: org.name,
      slug: org.slug,
      subscriptionPlan: org.subscriptionPlan,
      maxTraineeSeats: org.maxTraineeSeats,
      maxTrainerSeats: org.maxTrainerSeats,
      contactEmail: org.contactEmail || '',
      contactPerson: org.contactPerson || '',
      notes: org.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error(t('admin.org.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const url = editingOrg
        ? `/api/admin/organizations/${editingOrg.id}?adminId=${profile.id}`
        : `/api/admin/organizations?adminId=${profile.id}`;
      const method = editingOrg ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('admin.org.failedSave'));
      }
      toast.success(editingOrg ? t('admin.org.updated') : t('admin.org.created'));
      setShowForm(false);
      setEditingOrg(null);
      await loadOrgs();
    } catch (e: any) {
      toast.error(e?.message || t('admin.org.failedSave'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (org: OrgItem) => {
    if (org.isPlatformOwner) return;
    setTogglingIds(prev => new Set(prev).add(org.id));
    try {
      const res = await fetch(
        `/api/admin/organizations/${org.id}?adminId=${profile.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !org.isActive }),
        }
      );
      if (!res.ok) throw new Error(t('admin.org.failedToggle'));
      toast.success(org.isActive ? t('admin.org.deactivated') : t('admin.org.activated'));
      await loadOrgs();
    } catch (e: any) {
      toast.error(e?.message || t('admin.org.failedToggle'));
    } finally {
      setTogglingIds(prev => {
        const n = new Set(prev);
        n.delete(org.id);
        return n;
      });
    }
  };

  const deleteOrg = async (org: OrgItem) => {
    const msg = t('admin.org.confirmDelete', { name: org.name });
    if (!window.confirm(msg)) return;

    setDeletingIds(prev => new Set(prev).add(org.id));
    try {
      const res = await fetch(
        `/api/admin/organizations/${org.id}?adminId=${profile.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('admin.org.deleteFailed'));
      }
      toast.success(t('admin.org.orgDeleted'));
      await loadOrgs();
    } catch (e: any) {
      toast.error(e?.message || t('admin.org.deleteFailed'));
    } finally {
      setDeletingIds(prev => {
        const n = new Set(prev);
        n.delete(org.id);
        return n;
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <p className="text-muted-foreground">{t('common.accessDenied')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
              <Building2 className="text-foreground h-8 w-8" />
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {t('admin.org.title')}
              </h1>
              <p className="text-muted">{t('admin.org.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-5 py-3 font-medium transition-colors"
          >
            <Plus className="h-5 w-5" />
            {t('admin.org.newOrganization')}
          </button>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-foreground text-xl font-bold">
              {editingOrg ? t('admin.org.editOrganization') : t('admin.org.newOrganization')}
            </h2>
            <button onClick={() => setShowForm(false)} className="text-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.name')} *</label>
              <input
                value={form.name}
                onChange={e => {
                  setForm(f => ({
                    ...f,
                    name: e.target.value,
                    slug: editingOrg ? f.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                  }));
                }}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Acme GmbH"
              />
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.slug')} *</label>
              <input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                disabled={!!editingOrg}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="acme-gmbh"
              />
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.plan')} *</label>
              <select
                value={form.subscriptionPlan}
                onChange={e => setForm(f => ({ ...f, subscriptionPlan: e.target.value as 'LIGHT' | 'PRO' }))}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="LIGHT">LIGHT</option>
                <option value="PRO">PRO</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.traineeSeats')}</label>
                <input
                  type="number"
                  value={form.maxTraineeSeats}
                  onChange={e => setForm(f => ({ ...f, maxTraineeSeats: parseInt(e.target.value) || 0 }))}
                  className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.trainerSeats')}</label>
                <input
                  type="number"
                  value={form.maxTrainerSeats}
                  onChange={e => setForm(f => ({ ...f, maxTrainerSeats: parseInt(e.target.value) || 0 }))}
                  className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.contactEmail')}</label>
              <input
                value={form.contactEmail}
                onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="admin@acme.de"
              />
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.contactPerson')}</label>
              <input
                value={form.contactPerson}
                onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Max Mustermann"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.org.notes')}</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder={t('admin.org.notesPlaceholder')}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setShowForm(false)}
              className="text-muted hover:text-foreground rounded-xl px-5 py-2.5 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
            >
              {saving ? t('common.saving') : editingOrg ? t('common.update') : t('common.create')}
            </button>
          </div>
        </div>
      )}

      {/* Org List */}
      {error && <div className="text-sm text-red-500">{error}</div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {orgs.map(org => (
          <div
            key={org.id}
            className={`glass-effect rounded-3xl border p-6 shadow-lg transition-all ${
              !org.isActive
                ? 'border-red-500/30 opacity-60'
                : org.isPlatformOwner
                  ? 'border-yellow-500/40 ring-1 ring-yellow-500/20'
                  : 'border-accent/30'
            }`}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-foreground text-xl font-bold">{org.name}</h3>
                  {org.isPlatformOwner && (
                    <span title={t('admin.org.platformOwner')}><Crown className="h-5 w-5 text-yellow-500" /></span>
                  )}
                </div>
                <p className="text-muted text-sm">/{org.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    org.subscriptionPlan === 'PRO'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {org.subscriptionPlan}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    org.isActive
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500'
                  }`}
                >
                  {org.isActive ? t('common.active') : t('common.inactive')}
                </span>
              </div>
            </div>

            {/* Seats */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="bg-background/50 rounded-xl p-3">
                <div className="text-muted text-xs">{t('admin.org.trainers')}</div>
                <div className="text-foreground text-lg font-bold">
                  {org.currentTrainers}
                  <span className="text-muted text-sm font-normal">/{org.maxTrainerSeats}</span>
                </div>
              </div>
              <div className="bg-background/50 rounded-xl p-3">
                <div className="text-muted text-xs">{t('admin.org.trainees')}</div>
                <div className="text-foreground text-lg font-bold">
                  {org.currentTrainees}
                  <span className="text-muted text-sm font-normal">/{org.maxTraineeSeats}</span>
                </div>
              </div>
            </div>

            {/* Contact */}
            {(org.contactPerson || org.contactEmail) && (
              <div className="text-muted mb-4 text-sm">
                {org.contactPerson && <span>{org.contactPerson}</span>}
                {org.contactPerson && org.contactEmail && <span> &middot; </span>}
                {org.contactEmail && <span>{org.contactEmail}</span>}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => openEdit(org)}
                className="text-muted hover:text-foreground hover:bg-accent/10 flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors"
              >
                <Pencil className="h-4 w-4" />
                {t('common.edit')}
              </button>
              {!org.isPlatformOwner && (
                <>
                  <button
                    onClick={() => deleteOrg(org)}
                    disabled={deletingIds.has(org.id)}
                    className="text-red-500 hover:bg-red-500/10 flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('common.delete')}
                  </button>
                  <button
                    onClick={() => toggleActive(org)}
                    disabled={togglingIds.has(org.id)}
                    className={`ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                      org.isActive
                        ? 'border border-red-400/50 text-red-500 hover:bg-red-500/10'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    <Power className="h-4 w-4" />
                    {org.isActive ? t('trainee.management.deactivate') : t('trainee.management.activate')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {orgs.length === 0 && !error && (
        <div className="border-accent/30 rounded-3xl border p-12 text-center">
          <Building2 className="text-muted mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground text-lg font-semibold">{t('admin.org.noOrgs')}</h3>
          <p className="text-muted mt-1 text-sm">{t('admin.org.noOrgsDesc')}</p>
        </div>
      )}
    </div>
  );
}
