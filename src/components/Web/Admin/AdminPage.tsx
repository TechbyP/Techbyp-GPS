import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ShieldCheck, Trash2, UserCircle } from 'lucide-react';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { db } from '../../../firebase';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../ui/ConfirmationProvider';
import { getAllRoles, getCurrentUserRole, getRoleName, updateUserRole } from '../../../services/rbac';
import { userProfileService, type UserProfile } from '../../../services/userProfileService';
import type { UserRole } from '../../../types';
import { firebaseGPS } from '../../../services/firebaseSync';

const normalizeTimestamp = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  return '';
};

type AdminUser = {
  uid: string;
  email: string;
  role: UserRole;
  lastActive?: string;
  createdAt?: string;
  profile?: UserProfile | null;
};

export default function AdminPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showConfirmation } = useConfirmation();
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createProfile, setCreateProfile] = useState<Partial<UserProfile>>({});
  const [createRole, setCreateRole] = useState<UserRole>('client');
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editProfile, setEditProfile] = useState<Partial<UserProfile>>({});
  const [editRole, setEditRole] = useState<UserRole>('client');

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const role = await getCurrentUserRole();
      setCurrentRole(role);
      if (role !== 'admin') {
        setUsers([]);
        return;
      }

      const [userSnap, profileSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'user_profiles'))
      ]);

      const profileMap = new Map<string, UserProfile>();
      profileSnap.forEach(doc => {
        profileMap.set(doc.id, doc.data() as UserProfile);
      });

      const seen = new Set<string>();
      const nextUsers: AdminUser[] = userSnap.docs.map(doc => {
        const data = doc.data() as any;
        const profile = profileMap.get(doc.id) || null;
        seen.add(doc.id);
        return {
          uid: doc.id,
          email: data.email || profile?.email || '',
          role: (data.role as UserRole) || 'client',
          lastActive: normalizeTimestamp(data.lastActive),
          createdAt: normalizeTimestamp(data.created_at || data.createdAt),
          profile
        };
      });

      profileMap.forEach((profile, uid) => {
        if (seen.has(uid)) return;
        nextUsers.push({
          uid,
          email: profile.email || '',
          role: 'client',
          profile,
          lastActive: normalizeTimestamp(profile.updatedAt),
          createdAt: normalizeTimestamp(profile.createdAt)
        });
      });

      nextUsers.sort((a, b) => a.email.localeCompare(b.email));
      setUsers(nextUsers);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error(t('admin.loadUsersFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(user => {
      const profile = user.profile;
      const name = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
      return (
        user.uid.toLowerCase().includes(needle)
        || user.email.toLowerCase().includes(needle)
        || name.toLowerCase().includes(needle)
        || (profile?.company || '').toLowerCase().includes(needle)
      );
    });
  }, [query, users]);

  const beginEdit = (target: AdminUser) => {
    setEditUser(target);
    setEditRole(target.role);
    setEditProfile({
      uid: target.uid,
      email: target.profile?.email || target.email,
      customerNumber: target.profile?.customerNumber,
      firstName: target.profile?.firstName,
      lastName: target.profile?.lastName,
      company: target.profile?.company,
      street: target.profile?.street,
      postalCode: target.profile?.postalCode,
      city: target.profile?.city,
      phone: target.profile?.phone,
      country: target.profile?.country,
      federalState: target.profile?.federalState
    });
  };

  const beginCreate = () => {
    setCreateUserOpen(true);
    setCreateRole('client');
    setCreateProfile({
      uid: '',
      email: '',
      firstName: '',
      lastName: ''
    });
  };

  const handleCreateUser = async () => {
    const uid = (createProfile.uid || '').trim();
    const email = (createProfile.email || '').trim();

    if (!uid || !email) {
      toast.error(t('admin.createUserMissing'));
      return;
    }

    setIsSaving(true);
    try {
      await firebaseGPS.createUserDocument(uid, email, createProfile.firstName || createProfile.lastName
        ? `${createProfile.firstName || ''} ${createProfile.lastName || ''}`.trim()
        : undefined
      );
      await updateUserRole(uid, createRole);
      await userProfileService.upsertProfile({
        uid,
        email,
        customerNumber: createProfile.customerNumber,
        firstName: createProfile.firstName,
        lastName: createProfile.lastName,
        company: createProfile.company,
        street: createProfile.street,
        postalCode: createProfile.postalCode,
        city: createProfile.city,
        phone: createProfile.phone,
        country: createProfile.country,
        federalState: createProfile.federalState
      });

      await setDoc(doc(db, 'users', uid), {
        email,
        role: createRole,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      }, { merge: true });

      toast.success(t('admin.createUserSuccess'));
      setCreateUserOpen(false);
      await loadUsers();
    } catch (error) {
      console.error('Failed to create user:', error);
      toast.error(t('admin.createUserFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (target: AdminUser) => {
    if (user?.uid && target.uid === user.uid) {
      toast.error(t('admin.deleteSelfNotAllowed'));
      return;
    }

    const confirmed = await showConfirmation(
      t('admin.deleteUserTitle'),
      t('admin.deleteUserBody', { email: target.email || target.uid }) || `Delete ${target.email || target.uid}? This removes the user record and profile data.`,
      {
        type: 'warning',
        confirmText: t('common.delete'),
        cancelText: t('common.cancel')
      }
    );

    if (!confirmed) return;

    setIsSaving(true);
    try {
      await deleteDoc(doc(db, 'users', target.uid));
      await deleteDoc(doc(db, 'user_profiles', target.uid));
      toast.success(t('admin.deleteUserSuccess'));
      await loadUsers();
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast.error(t('admin.deleteUserFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editUser) return;
    setIsSaving(true);
    try {
      if (editRole !== editUser.role) {
        await updateUserRole(editUser.uid, editRole);
      }

      const email = (editProfile.email || editUser.email || '').trim();
      if (email) {
        await userProfileService.upsertProfile({
          uid: editUser.uid,
          email,
          customerNumber: editProfile.customerNumber,
          firstName: editProfile.firstName,
          lastName: editProfile.lastName,
          company: editProfile.company,
          street: editProfile.street,
          postalCode: editProfile.postalCode,
          city: editProfile.city,
          phone: editProfile.phone,
          country: editProfile.country,
          federalState: editProfile.federalState
        });
      }

      toast.success(t('admin.saveUserSuccess'));
      setEditUser(null);
      await loadUsers();
    } catch (error) {
      console.error('Failed to save user:', error);
      toast.error(t('admin.saveUserFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  if (currentRole && currentRole !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-6">
            <h1 className="text-2xl font-semibold">{t('admin.accessDeniedTitle')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              {t('admin.accessDeniedBody')}
            </p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              {t('common.back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10 pb-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.titleEyebrow')}</div>
              <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('admin.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t('common.back')}
              </button>
              <button
                onClick={beginCreate}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('admin.createUser')}
              </button>
              <button
                onClick={loadUsers}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                {t('admin.refresh')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('admin.searchPlaceholder')}
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>

          <div className="grid gap-4">
            {isLoading ? (
              <div className="text-sm text-gray-500">{t('common.loading')}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-sm text-gray-500">{t('admin.noUsers')}</div>
            ) : (
              filteredUsers.map(entry => {
                const profile = entry.profile;
                const displayName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || entry.email || entry.uid;
                return (
                  <div key={entry.uid} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                          <UserCircle className="w-5 h-5 text-blue-700 dark:text-blue-200" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{displayName}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{entry.email || (t('admin.noEmail'))}</div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">UID: {entry.uid}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                          <ShieldCheck className="w-3 h-3" />
                          {getRoleName(entry.role)}
                        </span>
                        <button
                          onClick={() => beginEdit(entry)}
                          className="px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(entry)}
                          className="px-3 py-2 rounded-lg text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/30"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('common.delete')}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
                      {entry.createdAt && <span>{t('admin.createdAt')}: {new Date(entry.createdAt).toLocaleDateString()}</span>}
                      {entry.lastActive && <span>{t('admin.lastActive')}: {new Date(entry.lastActive).toLocaleDateString()}</span>}
                      {profile?.company && <span>{t('orders.companyLabel')}: {profile.company}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {createUserOpen && (
        <div className="fixed inset-0 z-[7000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl bg-white/95 dark:bg-gray-900/95 border border-gray-200/60 dark:border-gray-800/60 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200/60 dark:border-gray-800/60 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.createUserTitle')}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{t('admin.createUserSubtitle')}</div>
              </div>
              <button
                onClick={() => setCreateUserOpen(false)}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              >
                <span className="sr-only">{t('common.close')}</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('admin.uidLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.uid || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, uid: event.target.value }))}
                  placeholder={t('admin.uidPlaceholder')}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.emailLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.email || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, email: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('admin.roleLabel')}
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createRole}
                  onChange={(event) => setCreateRole(event.target.value as UserRole)}
                >
                  {getAllRoles().map(role => (
                    <option key={role} value={role}>{getRoleName(role)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.firstNameLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.firstName || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, firstName: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.lastNameLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.lastName || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, lastName: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.companyLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.company || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, company: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.phoneLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.phone || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, phone: event.target.value }))}
                />
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200/60 dark:border-gray-800/60 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateUserOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-sm font-semibold"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateUser}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60"
              >
                {isSaving ? (t('common.saving')) : (t('admin.createUserConfirm'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 z-[7000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl bg-white/95 dark:bg-gray-900/95 border border-gray-200/60 dark:border-gray-800/60 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200/60 dark:border-gray-800/60 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.editUserTitle')}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{editUser.email || editUser.uid}</div>
              </div>
              <button
                onClick={() => setEditUser(null)}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              >
                <span className="sr-only">{t('common.close')}</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.emailLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.email || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, email: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('admin.roleLabel')}
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editRole}
                  onChange={(event) => setEditRole(event.target.value as UserRole)}
                >
                  {getAllRoles().map(role => (
                    <option key={role} value={role}>{getRoleName(role)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.firstNameLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.firstName || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, firstName: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.lastNameLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.lastName || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, lastName: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.companyLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.company || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, company: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.customerNumberLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.customerNumber || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, customerNumber: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.streetLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.street || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, street: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.postalCodeLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.postalCode || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, postalCode: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.cityLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.city || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, city: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.phoneLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.phone || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, phone: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.countryLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.country || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, country: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.federalStateLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={editProfile.federalState || ''}
                  onChange={(event) => setEditProfile(prev => ({ ...prev, federalState: event.target.value }))}
                />
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200/60 dark:border-gray-800/60 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditUser(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-sm font-semibold"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-60"
              >
                {isSaving ? (t('common.saving')) : (t('common.save'))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
