import {
  CheckSquare,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  PERMISSION_CATALOG,
  type PermissionKey,
  sanitizePermissionList,
} from '../../shared/rbac';
import { apiFetch } from '../lib/api';
import type { AuthUser, RoleDefinition } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface UserRolesManagerProps {
  currentUser: AuthUser;
  onFlash: (msg: string) => void;
}

type AdminUserRow = AuthUser & { createdAt: number };

function arePermissionSetsEqual(a: PermissionKey[], b: PermissionKey[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((k) => setA.has(k));
}

function PermissionCheckboxGrid({
  selected,
  disabled = false,
  onToggle,
}: {
  selected: PermissionKey[];
  disabled?: boolean;
  onToggle: (key: PermissionKey) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {PERMISSION_CATALOG.map((item) => {
        const checked = selected.includes(item.key);
        return (
          <label
            key={item.key}
            className={`flex min-h-11 items-start gap-2.5 rounded-xl border px-3 py-2 text-xs transition sm:min-h-9 ${
              disabled
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:border-amber-500/60'
            } ${
              checked
                ? 'border-amber-500/50 bg-amber-500/10 text-slate-900 dark:text-white'
                : 'border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400'
            }`}
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={checked}
              onChange={() => onToggle(item.key)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-amber-500"
            />
            <span className="min-w-0 leading-tight">
              <strong className="block text-[11px] font-extrabold text-slate-900 dark:text-white">
                {item.label}
              </strong>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                {item.group}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function UserRolesManager({
  currentUser,
  onFlash,
}: UserRolesManagerProps) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roleList, setRoleList] = useState<RoleDefinition[]>([]);
  const [userList, setUserList] = useState<AdminUserRow[]>([]);

  // New Role form
  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRolePerms, setNewRolePerms] = useState<PermissionKey[]>([
    'overview',
    'operator',
  ]);
  const [savingRole, setSavingRole] = useState(false);

  // Edit existing Role
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDesc, setEditRoleDesc] = useState('');
  const [editRolePerms, setEditRolePerms] = useState<PermissionKey[]>([]);
  const [pendingDeleteRole, setPendingDeleteRole] = useState<RoleDefinition | null>(
    null
  );

  // New User form
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUserRoleSlug, setNewUserRoleSlug] = useState('panitia');
  const [newUserPerms, setNewUserPerms] = useState<PermissionKey[]>([]);
  const [newUserCustomOverride, setNewUserCustomOverride] = useState(false);
  const [showNewUserPwd, setShowNewUserPwd] = useState(false);

  // Edit existing User
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRoleSlug, setEditUserRoleSlug] = useState('panitia');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserPerms, setEditUserPerms] = useState<PermissionKey[]>([]);
  const [editUserCustomOverride, setEditUserCustomOverride] = useState(false);
  const [showEditUserPwd, setShowEditUserPwd] = useState(false);
  const [savingUserEdit, setSavingUserEdit] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AdminUserRow | null>(
    null
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        apiFetch<{ roles: RoleDefinition[] }>('/api/auth/roles'),
        apiFetch<{ users: AdminUserRow[] }>('/api/auth/users'),
      ]);
      setRoleList(rolesRes.roles);
      setUserList(usersRes.users);

      const defaultPanitia = rolesRes.roles.find((r) => r.slug === 'panitia');
      if (defaultPanitia && !newUserCustomOverride) {
        setNewUserPerms(defaultPanitia.permissions);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Gagal memuat daftar akun & role');
    } finally {
      setLoading(false);
    }
  }, [newUserCustomOverride]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const togglePermKey = (
    list: PermissionKey[],
    key: PermissionKey
  ): PermissionKey[] => {
    const next = list.includes(key)
      ? list.filter((k) => k !== key)
      : [...list, key];
    return sanitizePermissionList(next);
  };

  // --- ROLE ACTIONS ---
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavingRole(true);
    try {
      await apiFetch<{ role: RoleDefinition }>('/api/auth/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: newRoleName,
          description: newRoleDesc,
          permissions: newRolePerms,
        }),
      });
      setNewRoleName('');
      setNewRoleDesc('');
      setNewRolePerms(['overview', 'operator']);
      setShowNewRoleForm(false);
      await loadAll();
      onFlash('Role kustom baru berhasil dibuat');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingRole(false);
    }
  };

  const startEditRole = (role: RoleDefinition) => {
    setErrorMsg(null);
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
    setEditRoleDesc(role.description);
    setEditRolePerms(role.permissions);
  };

  const handleSaveRole = async (e: React.FormEvent, roleId: number) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavingRole(true);
    try {
      await apiFetch<{ role: RoleDefinition }>(`/api/auth/roles/${roleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editRoleName,
          description: editRoleDesc,
          permissions: editRolePerms,
        }),
      });
      setEditingRoleId(null);
      await loadAll();
      onFlash('Izin menu Role berhasil diperbarui & otomatis berlaku real-time');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingRole(false);
    }
  };

  const confirmDeleteRole = async () => {
    if (!pendingDeleteRole) return;
    setSavingRole(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/auth/roles/${pendingDeleteRole.id}`, {
        method: 'DELETE',
      });
      setPendingDeleteRole(null);
      await loadAll();
      onFlash('Role kustom dihapus');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingRole(false);
    }
  };

  // --- USER ACTIONS ---
  const handleSelectNewUserRole = (slug: string) => {
    setNewUserRoleSlug(slug);
    const found = roleList.find((r) => r.slug === slug);
    setNewUserPerms(found ? found.permissions : []);
    setNewUserCustomOverride(false);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const roleObj = roleList.find((r) => r.slug === newUserRoleSlug);
    const isUsingDefault =
      newUserRoleSlug === 'admin' ||
      (!newUserCustomOverride &&
        roleObj &&
        arePermissionSetsEqual(newUserPerms, roleObj.permissions));

    try {
      await apiFetch<{ user: AdminUserRow }>('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          name: newFullName,
          password: newPassword,
          role: newUserRoleSlug,
          permissions: isUsingDefault ? null : newUserPerms,
        }),
      });
      setNewUsername('');
      setNewFullName('');
      setNewPassword('');
      setNewUserCustomOverride(false);
      await loadAll();
      onFlash('Akun baru berhasil dibuat dengan izin menu yang dipilih');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const startEditUser = (target: AdminUserRow) => {
    setErrorMsg(null);
    setEditingUserId(target.id);
    setEditUserName(target.name);
    setEditUserRoleSlug(target.role);
    setEditUserPassword('');
    setShowEditUserPwd(false);
    setEditUserPerms(target.permissions ?? []);
    setEditUserCustomOverride(Boolean(target.hasCustomPermissions));
  };

  const handleEditUserRoleChange = (slug: string) => {
    setEditUserRoleSlug(slug);
    const found = roleList.find((r) => r.slug === slug);
    setEditUserPerms(found ? found.permissions : []);
    setEditUserCustomOverride(false);
  };

  const handleSaveUserEdit = async (e: React.FormEvent, id: number) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavingUserEdit(true);
    try {
      const roleObj = roleList.find((r) => r.slug === editUserRoleSlug);
      const isFollowingRole =
        editUserRoleSlug === 'admin' ||
        (!editUserCustomOverride &&
          roleObj &&
          arePermissionSetsEqual(editUserPerms, roleObj.permissions));

      const payload: {
        name: string;
        role?: string;
        password?: string;
        permissions?: PermissionKey[] | null;
      } = {
        name: editUserName,
      };
      if (id !== currentUser.id) {
        payload.role = editUserRoleSlug;
        payload.permissions = isFollowingRole ? null : editUserPerms;
      }
      if (editUserPassword.trim() !== '') {
        payload.password = editUserPassword;
      }

      const res = await apiFetch<{ user: AdminUserRow }>(`/api/auth/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setEditingUserId(null);
      setEditUserPassword('');
      await loadAll();
      onFlash(
        payload.password
          ? `Password & izin akses @${res.user.username} diperbarui!`
          : `Profil & izin akses @${res.user.username} diperbarui!`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingUserEdit(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!pendingDeleteUser) return;
    setSavingUserEdit(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/auth/users/${pendingDeleteUser.id}`, {
        method: 'DELETE',
      });
      if (editingUserId === pendingDeleteUser.id) setEditingUserId(null);
      setPendingDeleteUser(null);
      await loadAll();
      onFlash('Akun dihapus & sesi aktif langsung dicabut');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingUserEdit(false);
    }
  };

  const selectedCreateRoleObj = roleList.find((r) => r.slug === newUserRoleSlug);

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={loadAll}
            className="rounded-lg bg-red-500/15 px-2.5 py-1 text-[11px] font-bold hover:bg-red-500/25"
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* SECTION 1: ROLE MANAGEMENT (SYSTEM + CUSTOM ROLES) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Role Akses &amp; Template Menu Default ({roleList.length})
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Role bawaan (<strong>Admin</strong>, <strong>Panitia</strong>,{' '}
                <strong>Media</strong>) terjaga dari penghapusan, dan Anda dapat
                membuat <strong>Role Kustom baru</strong> lalu mencentang menu mana saja
                yang boleh dibuka.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowNewRoleForm((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-amber-400 sm:min-h-9"
          >
            <Plus className="h-4 w-4" />
            {showNewRoleForm ? 'Tutup Form Role' : 'Buat Role Baru'}
          </button>
        </div>

        {showNewRoleForm && (
          <form
            onSubmit={handleCreateRole}
            className="mt-4 space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/5 p-4 dark:bg-amber-500/10"
          >
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Tambah Role Kustom Baru
            </h3>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                required
                placeholder="Nama Role (mis: Wasit Lapangan / Sekretariat)"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold sm:min-h-9 dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="text"
                placeholder="Deskripsi singkat (opsional)"
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:min-h-9 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Centang Menu yang Boleh Dibuka oleh Role Ini:
              </span>
              <PermissionCheckboxGrid
                selected={newRolePerms}
                onToggle={(k) => setNewRolePerms((prev) => togglePermKey(prev, k))}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewRoleForm(false)}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold sm:min-h-9 dark:border-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingRole}
                className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 sm:min-h-9 dark:bg-amber-500 dark:text-slate-950"
              >
                {savingRole ? 'Menyimpan...' : 'Simpan Role Baru'}
              </button>
            </div>
          </form>
        )}

        {loading && roleList.length === 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-shimmer h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roleList.map((role) => {
              const isEditingThis = editingRoleId === role.id;
              const isLockedAdmin = role.slug === 'admin';
              return (
                <div
                  key={role.id}
                  className={`rounded-xl border p-3.5 transition ${
                    isEditingThis
                      ? 'border-amber-500 bg-amber-500/5 md:col-span-2 xl:col-span-3'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                          {role.name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                            role.isSystem
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                          }`}
                        >
                          {role.isSystem ? 'Bawaan' : 'Kustom'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        @{role.slug} • {role.userCount ?? 0} akun
                        {role.description ? ` • ${role.description}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {isLockedAdmin ? (
                        <span
                          title="Role Admin selalu memiliki akses penuh"
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300"
                        >
                          <Lock className="h-3 w-3" />
                          Penuh
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              isEditingThis
                                ? setEditingRoleId(null)
                                : startEditRole(role)
                            }
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold hover:border-amber-500 sm:min-h-8 dark:border-slate-700"
                          >
                            <CheckSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                            {isEditingThis ? 'Tutup' : 'Edit Izin'}
                          </button>
                          {!role.isSystem && (
                            <button
                              type="button"
                              aria-label={`Hapus role ${role.name}`}
                              onClick={() => setPendingDeleteRole(role)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 sm:min-h-8 sm:min-w-8"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditingThis ? (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {role.permissions.map((pk) => {
                        const meta = PERMISSION_CATALOG.find((c) => c.key === pk);
                        return (
                          <span
                            key={pk}
                            className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {meta?.shortLabel || pk}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => handleSaveRole(e, role.id)}
                      className="mt-3 space-y-3 border-t border-slate-200/80 pt-3 dark:border-slate-800"
                    >
                      {!role.isSystem && (
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <input
                            type="text"
                            required
                            value={editRoleName}
                            onChange={(e) => setEditRoleName(e.target.value)}
                            placeholder="Nama Role"
                            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            type="text"
                            value={editRoleDesc}
                            onChange={(e) => setEditRoleDesc(e.target.value)}
                            placeholder="Deskripsi"
                            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>
                      )}
                      <PermissionCheckboxGrid
                        selected={editRolePerms}
                        onToggle={(k) =>
                          setEditRolePerms((prev) => togglePermKey(prev, k))
                        }
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingRoleId(null)}
                          className="min-h-10 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold sm:min-h-8 dark:border-slate-700"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          disabled={savingRole}
                          className="min-h-10 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 sm:min-h-8"
                        >
                          {savingRole ? 'Menyimpan...' : 'Simpan Izin Role'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: ACCOUNTS LIST + CREATE ACCOUNT WITH PER-USER CHECKBOX OVERRIDE */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Existing Users List */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-500" />
            <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
              Daftar Akun &amp; Izin Menu ({userList.length})
            </h2>
          </div>
          <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
            Perubahan izin langsung berlaku seketika tanpa menunggu logout. Jika Anda
            mencentang khusus per user, perubahan di template Role tidak menimpa akun
            tersebut.
          </p>

          <div className="space-y-2.5">
            {userList.map((u) => {
              const isEditing = editingUserId === u.id;
              const isSelf = u.id === currentUser.id;
              const effectivePerms = u.permissions ?? [];
              const editRoleObj = roleList.find((r) => r.slug === editUserRoleSlug);

              return (
                <div
                  key={u.id}
                  className={`rounded-xl border p-3.5 transition ${
                    isEditing
                      ? 'border-amber-500/60 bg-amber-500/5 dark:border-amber-400/50 dark:bg-amber-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-bold">{u.name}</p>
                        {isSelf && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                            Anda
                          </span>
                        )}
                        {u.hasCustomPermissions && (
                          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-indigo-700 dark:text-indigo-300">
                            Izin Kustom
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        @{u.username} •{' '}
                        <span className="font-semibold uppercase text-amber-800 dark:text-amber-400">
                          {u.roleName || u.role}
                        </span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {effectivePerms.map((pk) => {
                          const meta = PERMISSION_CATALOG.find((c) => c.key === pk);
                          return (
                            <span
                              key={pk}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            >
                              {meta?.shortLabel || pk}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          isEditing ? setEditingUserId(null) : startEditUser(u)
                        }
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition sm:min-h-8 ${
                          isEditing
                            ? 'border-amber-500 bg-amber-500 text-slate-950'
                            : 'border-slate-300 text-slate-700 hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-amber-300'
                        }`}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>{isEditing ? 'Tutup' : 'Edit & Izin'}</span>
                      </button>

                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteUser(u)}
                          aria-label={`Hapus akun ${u.username}`}
                          title="Hapus Akun"
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 sm:min-h-8 sm:min-w-8"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <form
                      onSubmit={(e) => handleSaveUserEdit(e, u.id)}
                      className="mt-3 space-y-3 border-t border-slate-200/80 pt-3 dark:border-slate-800"
                    >
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Nama Lengkap
                          </label>
                          <input
                            type="text"
                            required
                            value={editUserName}
                            onChange={(e) => setEditUserName(e.target.value)}
                            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Role Dasar {isSelf ? '(Terkunci Akun Sendiri)' : ''}
                          </label>
                          <select
                            disabled={isSelf}
                            value={editUserRoleSlug}
                            onChange={(e) => handleEditUserRoleChange(e.target.value)}
                            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                          >
                            {roleList.map((r) => (
                              <option key={r.slug} value={r.slug}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          Password Baru (Kosongkan jika tidak diganti)
                        </label>
                        <div className="relative">
                          <input
                            type={showEditUserPwd ? 'text' : 'password'}
                            minLength={6}
                            autoComplete="new-password"
                            value={editUserPassword}
                            onChange={(e) => setEditUserPassword(e.target.value)}
                            placeholder="Minimal 6 karakter..."
                            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-10 pl-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditUserPwd((v) => !v)}
                            aria-label={
                              showEditUserPwd
                                ? 'Sembunyikan password'
                                : 'Tampilkan password'
                            }
                            className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:text-slate-800 dark:text-slate-400"
                          >
                            {showEditUserPwd ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {!isSelf && editUserRoleSlug !== 'admin' && (
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                              Menu yang Dibuka untuk @{u.username}
                            </span>
                            {editUserCustomOverride && editRoleObj && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditUserPerms(editRoleObj.permissions);
                                  setEditUserCustomOverride(false);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Ikuti Default Role ({editRoleObj.name})
                              </button>
                            )}
                          </div>
                          <PermissionCheckboxGrid
                            selected={editUserPerms}
                            onToggle={(k) => {
                              setEditUserCustomOverride(true);
                              setEditUserPerms((prev) => togglePermKey(prev, k));
                            }}
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          className="min-h-10 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:min-h-8 dark:border-slate-700 dark:text-slate-300"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          disabled={savingUserEdit}
                          className="min-h-10 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-50 sm:min-h-8"
                        >
                          {savingUserEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Create New Account Form */}
        <form
          onSubmit={handleCreateUser}
          className="space-y-3 self-start rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-amber-500" />
            <h3 className="font-display text-base font-extrabold uppercase tracking-wider">
              Buat Akun Baru
            </h3>
          </div>

          <input
            type="text"
            required
            placeholder="Username (tanpa spasi)"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:min-h-10 dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="text"
            required
            placeholder="Nama Lengkap"
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:min-h-10 dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="relative">
            <input
              type={showNewUserPwd ? 'text' : 'password'}
              required
              minLength={6}
              placeholder="Password (min. 6 karakter)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-10 pl-3 text-sm sm:min-h-10 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={() => setShowNewUserPwd((v) => !v)}
              aria-label={
                showNewUserPwd ? 'Sembunyikan password' : 'Tampilkan password'
              }
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:text-slate-800 dark:text-slate-400"
            >
              {showNewUserPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">
              Pilih Role Default
            </label>
            <select
              value={newUserRoleSlug}
              onChange={(e) => handleSelectNewUserRole(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold sm:min-h-10 dark:border-slate-700 dark:bg-slate-950"
            >
              {roleList.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {newUserRoleSlug !== 'admin' && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {newUserCustomOverride
                    ? 'Izin Kustom Khusus User Ini'
                    : `Menu Default Role (${selectedCreateRoleObj?.name || newUserRoleSlug})`}
                </span>
                {newUserCustomOverride && selectedCreateRoleObj && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewUserPerms(selectedCreateRoleObj.permissions);
                      setNewUserCustomOverride(false);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Default
                  </button>
                )}
              </div>
              <PermissionCheckboxGrid
                selected={newUserPerms}
                onToggle={(k) => {
                  setNewUserCustomOverride(true);
                  setNewUserPerms((prev) => togglePermKey(prev, k));
                }}
              />
            </div>
          )}

          <button
            type="submit"
            className="min-h-11 w-full rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400"
          >
            Tambah Akun Staf
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteRole)}
        title="Hapus Role Kustom?"
        message={
          pendingDeleteRole
            ? `Hapus role "${pendingDeleteRole.name}"? Role yang masih dipakai oleh akun aktif tidak dapat dihapus.`
            : ''
        }
        confirmLabel="Ya, Hapus Role"
        busy={savingRole}
        onConfirm={confirmDeleteRole}
        onCancel={() => setPendingDeleteRole(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteUser)}
        title="Hapus Akun Staf?"
        message={
          pendingDeleteUser
            ? `Hapus akun @${pendingDeleteUser.username} (${pendingDeleteUser.name})? Sesi login akun tersebut akan langsung dicabut seketika.`
            : ''
        }
        confirmLabel="Ya, Hapus Akun"
        busy={savingUserEdit}
        onConfirm={confirmDeleteUser}
        onCancel={() => setPendingDeleteUser(null)}
      />
    </div>
  );
}
