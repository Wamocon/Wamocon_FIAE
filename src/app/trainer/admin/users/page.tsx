'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  Users,
  Shield,
  ShieldCheck,
  UserCog,
  GraduationCap,
  Building2,
  ChevronDown,
  Plus,
  X,
  Copy,
  Check,
  Mail,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

type UserItem = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  trainerActivated: boolean;
  organizationId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  createdAt: string;
};

type OrgOption = {
  id: string;
  name: string;
};

const ADMIN_ROLES = ['admin', 'temp_admin'];

const ROLE_CONFIG: Record<string, { labelKey: string; icon: typeof Shield; color: string }> = {
  ADMIN: { labelKey: 'Admin', icon: ShieldCheck, color: 'text-red-400 bg-red-500/10' },
  TEMP_ADMIN: { labelKey: 'Temp Admin', icon: Shield, color: 'text-orange-400 bg-orange-500/10' },
  TRAINER: { labelKey: 'Trainer', icon: UserCog, color: 'text-blue-400 bg-blue-500/10' },
  TRAINEE: { labelKey: 'Trainee', icon: GraduationCap, color: 'text-green-400 bg-green-500/10' },
};

export default function AdminUsersPage() {
  const { profile, loading } = useAuth() as any;
  const { t } = useLanguage();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterOrg, setFilterOrg] = useState<string>('');
  const [filterRole, setFilterRole] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    email: '',
    fullName: '',
    role: 'TRAINEE',
    organizationId: '',
    sendEmail: true,
  });

  const loadUsers = useCallback(async () => {
    if (!profile) return;
    try {
      const params = new URLSearchParams({ adminId: profile.id });
      if (filterOrg) params.set('orgId', filterOrg);
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('admin.users.updateFailed'));
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  }, [profile, filterOrg, t]);

  const loadOrgs = useCallback(async () => {
    if (!profile) return;
    try {
      const res = await fetch(`/api/admin/organizations?adminId=${profile.id}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setOrgs((data.organizations || []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch {
      // non-critical
    }
  }, [profile]);

  useEffect(() => {
    if (profile && ADMIN_ROLES.includes(profile.role)) {
      loadUsers();
      loadOrgs();
    }
  }, [profile, loadUsers, loadOrgs]);

  const updateUser = async (userId: string, updates: Record<string, unknown>) => {
    setSavingIds(prev => new Set(prev).add(userId));
    try {
      const res = await fetch(`/api/admin/users/${userId}?adminId=${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('admin.users.updateFailed'));
      }
      toast.success(t('admin.users.userUpdated'));
      await loadUsers();
    } catch (e: any) {
      toast.error(e?.message || t('admin.users.updateFailed'));
    } finally {
      setSavingIds(prev => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
      setEditingUser(null);
    }
  };

  const createUser = async () => {
    if (!newUser.email || !newUser.fullName || !newUser.organizationId) {
      toast.error(t('admin.users.fillRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/users?adminId=${profile.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('admin.users.createFailed'));
      setCreatedCredentials(data.credentials);
      toast.success(data.emailSent ? t('admin.users.userCreated') : t('admin.users.userCreatedNoEmail'));
      await loadUsers();
    } catch (e: any) {
      toast.error(e?.message || t('admin.users.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const deleteUser = async (user: UserItem) => {
    const displayName = user.fullName || user.email;
    const msg = t('admin.users.confirmDelete', { name: displayName });
    if (!window.confirm(msg)) return;

    setDeletingIds(prev => new Set(prev).add(user.id));
    try {
      const res = await fetch(`/api/admin/users/${user.id}?adminId=${profile.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('admin.users.deleteFailed'));
      }
      toast.success(t('admin.users.userDeleted'));
      await loadUsers();
    } catch (e: any) {
      toast.error(e?.message || t('admin.users.deleteFailed'));
    } finally {
      setDeletingIds(prev => {
        const n = new Set(prev);
        n.delete(user.id);
        return n;
      });
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
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

  const callerRole = (profile.role || '').toUpperCase();
  const isFullAdmin = callerRole === 'ADMIN';

  const filteredUsers = users.filter(u => {
    if (filterRole && u.role?.toUpperCase() !== filterRole) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        u.email?.toLowerCase().includes(q) ||
        u.fullName?.toLowerCase().includes(q) ||
        u.firstName?.toLowerCase().includes(q) ||
        u.lastName?.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
              <Users className="text-foreground h-8 w-8" />
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">{t('admin.users.title')}</h1>
              <p className="text-muted">{t('admin.users.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowCreateForm(true);
              setCreatedCredentials(null);
              setNewUser({ email: '', fullName: '', role: 'TRAINEE', organizationId: '', sendEmail: true });
            }}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-5 py-3 font-medium transition-colors"
          >
            <Plus className="h-5 w-5" />
            {t('admin.users.createUser')}
          </button>
        </div>
      </div>

      {/* Create User Form */}
      {showCreateForm && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-foreground text-xl font-bold">
              {createdCredentials ? t('admin.users.accountCreated') : t('admin.users.createNewUser')}
            </h2>
            <button
              onClick={() => { setShowCreateForm(false); setCreatedCredentials(null); }}
              className="text-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {createdCredentials ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6">
                <div className="mb-4 flex items-center gap-2 text-green-500">
                  <Check className="h-5 w-5" />
                  <span className="font-semibold">{t('admin.users.accountSuccess')}</span>
                </div>
                <p className="text-muted mb-4 text-sm">{t('admin.users.saveCredentials')}</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-background/50 p-4">
                    <div>
                      <div className="text-muted text-xs">{t('admin.users.email')}</div>
                      <div className="text-foreground font-mono">{createdCredentials.email}</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(createdCredentials.email, 'email')}
                      className="text-muted hover:text-foreground rounded-lg p-2 transition-colors"
                    >
                      {copiedField === 'email' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-background/50 p-4">
                    <div>
                      <div className="text-muted text-xs">{t('admin.users.password')}</div>
                      <div className="text-foreground font-mono">{createdCredentials.password}</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(createdCredentials.password, 'password')}
                      className="text-muted hover:text-foreground rounded-lg p-2 transition-colors"
                    >
                      {copiedField === 'password' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(`Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`, 'both')}
                    className="text-muted hover:text-foreground flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition-colors"
                  >
                    {copiedField === 'both' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {t('common.copyBoth')}
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setCreatedCredentials(null);
                    setNewUser({ email: '', fullName: '', role: 'TRAINEE', organizationId: '', sendEmail: true });
                  }}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-5 py-2.5 font-medium transition-colors"
                >
                  {t('admin.users.createAnother')}
                </button>
                <button
                  onClick={() => { setShowCreateForm(false); setCreatedCredentials(null); }}
                  className="text-muted hover:text-foreground rounded-xl px-5 py-2.5 transition-colors"
                >
                  {t('common.done')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.users.fullName')} *</label>
                  <input
                    value={newUser.fullName}
                    onChange={e => setNewUser(f => ({ ...f, fullName: e.target.value }))}
                    className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Max Mustermann"
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.users.email')} *</label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={e => setNewUser(f => ({ ...f, email: e.target.value }))}
                    className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="max@company.de"
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.users.role')} *</label>
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser(f => ({ ...f, role: e.target.value }))}
                    className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="TRAINEE">Trainee</option>
                    <option value="TRAINER">Trainer</option>
                    <option value="TEMP_ADMIN">Temp Admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-foreground mb-1.5 block text-sm font-medium">{t('admin.users.organization')} *</label>
                  <select
                    value={newUser.organizationId}
                    onChange={e => setNewUser(f => ({ ...f, organizationId: e.target.value }))}
                    className="bg-background border-border text-foreground w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">{t('admin.users.selectOrganization')}</option>
                    {orgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUser.sendEmail}
                    onChange={e => setNewUser(f => ({ ...f, sendEmail: e.target.checked }))}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-foreground text-sm flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-muted" />
                    {t('admin.users.sendCredentials')}
                  </span>
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-muted hover:text-foreground rounded-xl px-5 py-2.5 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={createUser}
                  disabled={creating}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? t('common.creating') : t('admin.users.createAccount')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          className="bg-background border-border text-foreground min-w-[250px] rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="relative">
          <select
            value={filterOrg}
            onChange={e => setFilterOrg(e.target.value)}
            className="bg-background border-border text-foreground appearance-none rounded-xl border py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">{t('admin.users.allOrganizations')}</option>
            {orgs.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <ChevronDown className="text-muted pointer-events-none absolute right-3 top-3 h-4 w-4" />
        </div>
        <div className="relative">
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="bg-background border-border text-foreground appearance-none rounded-xl border py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">{t('admin.users.allRoles')}</option>
            <option value="ADMIN">Admin</option>
            <option value="TEMP_ADMIN">Temp Admin</option>
            <option value="TRAINER">Trainer</option>
            <option value="TRAINEE">Trainee</option>
          </select>
          <ChevronDown className="text-muted pointer-events-none absolute right-3 top-3 h-4 w-4" />
        </div>
      </div>

      {/* User Table */}
      {error && <div className="text-sm text-red-500">{error}</div>}
      <div className="glass-effect border-accent/30 overflow-hidden rounded-3xl border shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border/50 border-b">
                <th className="text-muted px-6 py-4 text-left font-medium">{t('admin.users.user')}</th>
                <th className="text-muted px-6 py-4 text-left font-medium">{t('admin.users.role')}</th>
                <th className="text-muted px-6 py-4 text-left font-medium">{t('admin.users.organization')}</th>
                <th className="text-muted px-6 py-4 text-left font-medium">{t('admin.users.status')}</th>
                <th className="text-muted px-6 py-4 text-right font-medium">{t('admin.users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const upperRole = (u.role || '').toUpperCase();
                const rc = ROLE_CONFIG[upperRole] || ROLE_CONFIG.TRAINEE;
                const RoleIcon = rc.icon;
                const isProtected = upperRole === 'ADMIN' && !isFullAdmin;
                const isSelf = u.id === profile.id;
                const isEditing = editingUser === u.id;

                return (
                  <tr key={u.id} className="border-border/30 hover:bg-accent/5 border-b transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-foreground font-medium">
                          {u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || t('common.noName')}
                        </div>
                        <div className="text-muted text-xs">{u.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {isEditing && !isProtected && !isSelf ? (
                        <select
                          defaultValue={upperRole}
                          onChange={e => updateUser(u.id, { role: e.target.value })}
                          className="bg-background border-border text-foreground rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          {isFullAdmin && <option value="ADMIN">Admin</option>}
                          <option value="TEMP_ADMIN">Temp Admin</option>
                          <option value="TRAINER">Trainer</option>
                          <option value="TRAINEE">Trainee</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${rc.color}`}>
                          <RoleIcon className="h-3.5 w-3.5" />
                          {rc.labelKey}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing && !isProtected ? (
                        <select
                          defaultValue={u.organizationId || ''}
                          onChange={e => updateUser(u.id, { organizationId: e.target.value || null })}
                          className="bg-background border-border text-foreground rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          <option value="">{t('admin.users.noOrg')}</option>
                          {orgs.map(o => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-muted flex items-center gap-1.5 text-xs">
                          {u.orgName ? (
                            <>
                              <Building2 className="h-3.5 w-3.5" />
                              {u.orgName}
                            </>
                          ) : (
                            <span className="italic">{t('common.unassigned')}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.isActive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                          }`}
                        >
                          {u.isActive ? t('common.active') : t('common.inactive')}
                        </span>
                        {upperRole === 'TRAINEE' && (
                          <span
                            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                              u.trainerActivated ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {u.trainerActivated ? t('admin.users.trainerOK') : t('admin.users.pending')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isProtected && !isSelf && (
                          <>
                            {isEditing ? (
                              <button
                                onClick={() => setEditingUser(null)}
                                className="text-muted hover:text-foreground rounded-lg px-3 py-1.5 text-xs transition-colors"
                              >
                                {t('common.done')}
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditingUser(u.id)}
                                className="text-muted hover:text-foreground hover:bg-accent/10 rounded-lg px-3 py-1.5 text-xs transition-colors"
                              >
                                {t('common.edit')}
                              </button>
                            )}
                            <button
                              disabled={savingIds.has(u.id)}
                              onClick={() => updateUser(u.id, { isActive: !u.isActive })}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                                u.isActive
                                  ? 'text-red-500 hover:bg-red-500/10'
                                  : 'text-green-500 hover:bg-green-500/10'
                              }`}
                            >
                              {u.isActive ? t('trainee.management.deactivate') : t('trainee.management.activate')}
                            </button>
                            <button
                              disabled={deletingIds.has(u.id)}
                              onClick={() => deleteUser(u)}
                              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-all hover:bg-red-500/10 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        {isSelf && (
                          <span className="text-muted text-xs italic">{t('common.you')}</span>
                        )}
                        {isProtected && !isSelf && (
                          <span className="text-muted text-xs italic">{t('common.protected')}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && !error && (
          <div className="p-12 text-center">
            <Users className="text-muted mx-auto mb-4 h-12 w-12" />
            <h3 className="text-foreground text-lg font-semibold">{t('admin.users.noUsers')}</h3>
            <p className="text-muted mt-1 text-sm">{t('admin.users.noUsersDesc')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
