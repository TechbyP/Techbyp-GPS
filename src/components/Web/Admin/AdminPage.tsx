import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Pencil, Plus, RefreshCw, ScrollText, Search, ShieldCheck, Trash2, UserCircle } from 'lucide-react';
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query as firestoreQuery, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { db } from '../../../firebase';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../ui/ConfirmationProvider';
import { getAllRoles, getRoleName, getUserRole, updateUserRole } from '../../../services/rbac';
import type { UserProfile } from '../../../services/userProfileService';
import type { UserRole } from '../../../types';
import { firebaseGPS } from '../../../services/firebaseSync';
import {
  extendAccessExpiry,
  getDaysUntilAccessExpiry,
  fromAccessDateInputValue,
  getUserAccessState,
  isUserAccessExpiringSoon,
  normalizeAccessTimestamp,
  toAccessDateInputValue
} from '../../../utils/userAccess';
import { withTimeout } from '../../../config/timeouts';

const ADMIN_USERS_FETCH_TIMEOUT_MS = 15000;

const normalizeTimestamp = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  return '';
};

const formatAccessDate = (value: unknown): string => {
  const normalized = normalizeAccessTimestamp(value);
  if (!normalized) return '';
  return new Date(normalized).toLocaleDateString();
};

const ACCESS_EXPIRING_SOON_DAYS = 30;

type AccessFilter = 'all' | 'expiringSoon' | 'expired' | 'disabled';

const ACCESS_FILTERS: Array<{ key: AccessFilter; labelKey: string }> = [
  { key: 'all', labelKey: 'admin.filterAll' },
  { key: 'expiringSoon', labelKey: 'admin.filterExpiringSoon' },
  { key: 'expired', labelKey: 'admin.filterExpired' },
  { key: 'disabled', labelKey: 'admin.filterDisabled' }
];

const FEDERAL_STATES = [
  'Baden-Württemberg',
  'Bayern',
  'Berlin',
  'Brandenburg',
  'Bremen',
  'Hamburg',
  'Hessen',
  'Mecklenburg-Vorpommern',
  'Niedersachsen',
  'Nordrhein-Westfalen',
  'Rheinland-Pfalz',
  'Saarland',
  'Sachsen',
  'Sachsen-Anhalt',
  'Schleswig-Holstein',
  'Thüringen'
];

type AdminUser = {
  uid: string;
  email: string;
  role: UserRole;
  lastActive?: string;
  createdAt?: string;
  profile?: UserProfile | null;
};

type AccessLogSource = 'quick-30-days' | 'quick-1-year' | 'manual-edit' | 'initial-access';

type AdminAccessLogEntry = {
  id: string;
  actorUserId?: string;
  actorEmail?: string;
  targetUserId?: string;
  targetUserEmail?: string;
  previousExpiresAt?: string | null;
  nextExpiresAt?: string | null;
  billNumber?: string;
  source?: AccessLogSource;
  createdAt?: string;
};

type BillPromptState = {
  title: string;
  message: string;
  confirmText: string;
  value: string;
  error: string;
};

type AccessLogViewerState = {
  scope: 'all' | 'user';
  uid?: string;
  title: string;
  description: string;
};

type AccessDateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  openCalendarLabel: string;
};

function AccessDateField({ label, value, onChange, openCalendarLabel }: AccessDateFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const input = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) {
      return;
    }

    input.focus();
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  };

  return (
    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
      {label}
      <div className="relative mt-1">
        <input
          ref={inputRef}
          type="date"
          className="admin-date-input w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 pr-12 text-sm text-gray-900 dark:text-white"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={openCalendarLabel}
          title={openCalendarLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openPicker}
          className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
      </div>
    </label>
  );
}

const getAccessTimestampMillis = (value: unknown): number | null => {
  const normalized = normalizeAccessTimestamp(value);
  if (!normalized) return null;

  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const hasAccessTimeBeenAdded = (previousValue: unknown, nextValue: unknown): boolean => {
  const nextTimestamp = getAccessTimestampMillis(nextValue);
  if (nextTimestamp === null) {
    return false;
  }

  const previousTimestamp = getAccessTimestampMillis(previousValue);
  return previousTimestamp === null || nextTimestamp > previousTimestamp;
};

const ROLE_VALUES: UserRole[] = ['admin', 'client', 'consultant', 'lab_manager', 'technician'];

const toUserRole = (value: unknown): UserRole | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase();
  return ROLE_VALUES.includes(normalized as UserRole) ? (normalized as UserRole) : null;
};

export default function AdminPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { showConfirmation } = useConfirmation();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createProfile, setCreateProfile] = useState<Partial<UserProfile>>({});
  const [createRole, setCreateRole] = useState<UserRole>('client');
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editProfile, setEditProfile] = useState<Partial<UserProfile>>({});
  const [editRole, setEditRole] = useState<UserRole>('client');
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const [accessLogs, setAccessLogs] = useState<AdminAccessLogEntry[]>([]);
  const [isAccessLogsLoading, setIsAccessLogsLoading] = useState(false);
  const [accessLogViewer, setAccessLogViewer] = useState<AccessLogViewerState | null>(null);
  const [viewerAccessLogs, setViewerAccessLogs] = useState<AdminAccessLogEntry[]>([]);
  const [isViewerAccessLogsLoading, setIsViewerAccessLogsLoading] = useState(false);
  const [billPrompt, setBillPrompt] = useState<BillPromptState | null>(null);
  const billPromptResolverRef = useRef<((value: string | null) => void) | null>(null);

  const resolveRoleWithClaimsFallback = useCallback(async (): Promise<UserRole> => {
    if (!user) {
      return 'client';
    }

    const firestoreRole = await getUserRole(user.uid);
    if (firestoreRole) {
      return firestoreRole;
    }

    try {
      const tokenResult = await user.getIdTokenResult();
      const claimRole = toUserRole(tokenResult.claims.role);
      const resolvedRole = tokenResult.claims.admin === true
        ? 'admin'
        : (claimRole || null);

      if (!resolvedRole) {
        return 'client';
      }

      // Keep Firestore role in sync with token claims so rules and UI agree.
      await setDoc(doc(db, 'users', user.uid), {
        role: resolvedRole,
        email: user.email || '',
        updated_at: serverTimestamp()
      }, { merge: true });

      return resolvedRole;
    } catch (error) {
      console.warn('Failed to resolve role from token claims:', error);
      return 'client';
    }
  }, [user]);

  const loadUsers = useCallback(async () => {
    if (authLoading && !user) {
      setIsLoading(true);
      return;
    }

    if (!user) {
      setCurrentRole(null);
      setUsers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const role = await resolveRoleWithClaimsFallback();
      setCurrentRole(role);
      if (role !== 'admin') {
        setUsers([]);
        return;
      }

      const [userSnap, profileSnap] = await withTimeout(
        Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'user_profiles'))
        ]),
        ADMIN_USERS_FETCH_TIMEOUT_MS,
        'Admin users query timeout'
      );

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
  }, [authLoading, resolveRoleWithClaimsFallback, t, user]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const root = document.getElementById('root');
    const previousRootOverflow = root?.style.overflow ?? '';

    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    if (root) {
      root.style.overflow = 'auto';
    }

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      const cleanupRoot = document.getElementById('root');
      if (cleanupRoot) {
        cleanupRoot.style.overflow = previousRootOverflow;
      }
    };
  }, []);

  const userAccessSummary = useMemo(() => {
    const withAccess = users.map((entry) => {
      const accessState = getUserAccessState(entry.profile);
      const daysUntilExpiry = getDaysUntilAccessExpiry(entry.profile);
      return {
        entry,
        accessState,
        daysUntilExpiry,
        isExpiringSoon: isUserAccessExpiringSoon(entry.profile, ACCESS_EXPIRING_SOON_DAYS)
      };
    });

    const expiringSoon = withAccess
      .filter((item) => item.isExpiringSoon)
      .sort((left, right) => {
        const leftDays = left.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
        const rightDays = right.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
        return leftDays - rightDays;
      });

    return {
      total: users.length,
      expiringSoon,
      expiredCount: withAccess.filter((item) => item.accessState.status === 'expired').length,
      disabledCount: withAccess.filter((item) => item.accessState.status === 'disabled').length
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return users.filter(user => {
      const accessState = getUserAccessState(user.profile);
      const matchesAccessFilter = accessFilter === 'all'
        ? true
        : accessFilter === 'expiringSoon'
          ? isUserAccessExpiringSoon(user.profile, ACCESS_EXPIRING_SOON_DAYS)
          : accessState.status === accessFilter;

      if (!matchesAccessFilter) {
        return false;
      }

      if (!needle) {
        return true;
      }

      const profile = user.profile;
      const name = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
      const customerNumber = (profile?.customerNumber || '').toLowerCase();
      return (
        user.uid.toLowerCase().includes(needle)
        || user.email.toLowerCase().includes(needle)
        || name.toLowerCase().includes(needle)
        || (profile?.company || '').toLowerCase().includes(needle)
        || customerNumber.includes(needle)
      );
    });
  }, [accessFilter, searchQuery, users]);

  const handleQuickExtendAccess = async (
    target: AdminUser,
    extension: { days?: number; months?: number; years?: number },
    source: AccessLogSource
  ) => {
    const email = (target.profile?.email || target.email || '').trim();
    if (!email) {
      toast.error(t('admin.accessExtendMissingEmail'));
      return;
    }

    const previousExpiresAt = normalizeAccessTimestamp(target.profile?.accessExpiresAt);
    const nextExpiry = extendAccessExpiry(target.profile?.accessExpiresAt, extension);
    const billNumber = await promptForBillNumber(email, nextExpiry);

    if (billNumber === null) {
      return;
    }

    setIsSaving(true);
    try {
      await saveUserProfile({
        uid: target.uid,
        email,
        existingProfile: target.profile,
        profileUpdates: {
          accessDisabled: false,
          accessDisabledAt: null,
          accessExpiresAt: nextExpiry,
          accessUpdatedAt: new Date().toISOString()
        },
        accessLog: createAccessLogPayload({
          uid: target.uid,
          email,
          previousExpiresAt,
          nextExpiresAt: nextExpiry,
          billNumber,
          source
        })
      });

      if (editUser?.uid === target.uid) {
        setEditProfile((prev) => ({
          ...prev,
          email,
          accessDisabled: false,
          accessDisabledAt: null,
          accessExpiresAt: nextExpiry
        }));
        await loadAccessLogs(target.uid);
      }

      toast.success(t('admin.accessExtendedSuccess', {
        email,
        date: formatAccessDate(nextExpiry)
      }));
      await loadUsers();
    } catch (error) {
      console.error('Failed to extend access:', error);
      toast.error(t('admin.accessExtendedFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const getExpiryCountdownLabel = (daysUntilExpiry: number | null) => {
    if (daysUntilExpiry === null) return '';
    if (daysUntilExpiry <= 0) return t('admin.expiresToday');
    if (daysUntilExpiry === 1) return t('admin.expiresTomorrow');
    return t('admin.expiresInDays', { count: daysUntilExpiry });
  };

  const clearSearchQuery = () => {
    setSearchQuery('');
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
  };

  const requestBillNumber = ({ title, message, confirmText }: {
    title: string;
    message: string;
    confirmText: string;
  }) => new Promise<string | null>((resolve) => {
    billPromptResolverRef.current = resolve;
    setBillPrompt({
      title,
      message,
      confirmText,
      value: '',
      error: ''
    });
  });

  const closeBillPrompt = (result: string | null) => {
    const resolver = billPromptResolverRef.current;
    billPromptResolverRef.current = null;
    setBillPrompt(null);
    resolver?.(result);
  };

  const promptForBillNumber = (email: string, nextExpiry: string | null) => requestBillNumber({
    title: t('admin.billNumberDialogTitle'),
    message: t('admin.billNumberDialogMessage', {
      email,
      date: nextExpiry ? formatAccessDate(nextExpiry) : t('admin.accessNoExpiry')
    }),
    confirmText: t('admin.billNumberConfirm')
  });

  const createAccessLogPayload = ({
    uid,
    email,
    previousExpiresAt,
    nextExpiresAt,
    billNumber,
    source
  }: {
    uid: string;
    email: string;
    previousExpiresAt: string | null;
    nextExpiresAt: string | null;
    billNumber: string;
    source: AccessLogSource;
  }) => ({
    actorUserId: user?.uid || '',
    actorEmail: user?.email || '',
    targetUserId: uid,
    targetUserEmail: email,
    previousExpiresAt,
    nextExpiresAt,
    billNumber,
    source
  });

  const saveUserProfile = async ({
    uid,
    email,
    existingProfile,
    profileUpdates,
    accessLog
  }: {
    uid: string;
    email: string;
    existingProfile?: UserProfile | null;
    profileUpdates: Partial<UserProfile>;
    accessLog?: ReturnType<typeof createAccessLogPayload>;
  }) => {
    const now = new Date().toISOString();
    const profileRef = doc(db, 'user_profiles', uid);
    const batch = writeBatch(db);

    const cleanProfile = Object.fromEntries(
      Object.entries({
        ...profileUpdates,
        uid,
        email,
        createdAt: existingProfile?.createdAt || now,
        updatedAt: now
      }).filter(([_, value]) => value !== undefined)
    );

    batch.set(profileRef, cleanProfile, { merge: true });

    if (accessLog) {
      const accessLogRef = doc(collection(db, 'user_profiles', uid, 'access_logs'));
      batch.set(accessLogRef, {
        ...accessLog,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();
  };

  const mapAccessLogDoc = (logDoc: Awaited<ReturnType<typeof getDocs>>['docs'][number]) => {
      const data = logDoc.data() as Record<string, unknown>;
      return {
        id: logDoc.id,
        actorUserId: typeof data.actorUserId === 'string' ? data.actorUserId : '',
        actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '',
        targetUserId: typeof data.targetUserId === 'string' ? data.targetUserId : '',
        targetUserEmail: typeof data.targetUserEmail === 'string' ? data.targetUserEmail : '',
        previousExpiresAt: normalizeAccessTimestamp(data.previousExpiresAt),
        nextExpiresAt: normalizeAccessTimestamp(data.nextExpiresAt),
        billNumber: typeof data.billNumber === 'string' ? data.billNumber : '',
        source: typeof data.source === 'string' ? data.source as AccessLogSource : 'manual-edit',
        createdAt: normalizeTimestamp(data.createdAt)
      } satisfies AdminAccessLogEntry;
  };

  const fetchAccessLogs = useCallback(async (uid?: string) => {
    if (uid) {
      const accessLogSnapshot = await getDocs(firestoreQuery(
        collection(db, 'user_profiles', uid, 'access_logs'),
        orderBy('createdAt', 'desc'),
        limit(25)
      ));

      return accessLogSnapshot.docs.map(mapAccessLogDoc);
    }

    const userIds = users.map((entry) => entry.uid);
    const logSnapshots = await Promise.all(
      userIds.map(async (targetUid) => {
        const snapshot = await getDocs(firestoreQuery(
          collection(db, 'user_profiles', targetUid, 'access_logs'),
          orderBy('createdAt', 'desc'),
          limit(10)
        ));

        return snapshot.docs.map(mapAccessLogDoc);
      })
    );

    return logSnapshots
      .flat()
      .sort((left, right) => {
        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, 50);
  }, [users]);

  const loadAccessLogs = useCallback(async (uid: string) => {
    setIsAccessLogsLoading(true);
    try {
      setAccessLogs(await fetchAccessLogs(uid));
    } catch (error) {
      console.error('Failed to load access history:', error);
      setAccessLogs([]);
      toast.error(t('admin.accessHistoryLoadFailed'));
    } finally {
      setIsAccessLogsLoading(false);
    }
  }, [fetchAccessLogs, t]);

  const openAccessLogViewer = async (viewerState: AccessLogViewerState) => {
    setAccessLogViewer(viewerState);
    setIsViewerAccessLogsLoading(true);

    try {
      setViewerAccessLogs(await fetchAccessLogs(viewerState.uid));
    } catch (error) {
      console.error('Failed to load access log viewer:', error);
      setViewerAccessLogs([]);
      toast.error(t('admin.accessHistoryLoadFailed'));
    } finally {
      setIsViewerAccessLogsLoading(false);
    }
  };

  const closeAccessLogViewer = () => {
    setAccessLogViewer(null);
    setViewerAccessLogs([]);
    setIsViewerAccessLogsLoading(false);
  };

  const openAllAccessLogs = () => openAccessLogViewer({
    scope: 'all',
    title: t('admin.allAccessLogsTitle'),
    description: t('admin.allAccessLogsHelp')
  });

  const openUserAccessLogs = (target: AdminUser) => {
    const displayName = `${target.profile?.firstName || ''} ${target.profile?.lastName || ''}`.trim() || target.email || target.uid;

    return openAccessLogViewer({
      scope: 'user',
      uid: target.uid,
      title: t('admin.userAccessLogsTitle', { name: displayName }),
      description: t('admin.userAccessLogsHelp', { email: target.email || target.uid })
    });
  };

  const getAccessHistorySourceLabel = (source?: AccessLogSource) => {
    if (source === 'quick-30-days') return t('admin.historyQuick30Days');
    if (source === 'quick-1-year') return t('admin.historyQuick1Year');
    if (source === 'initial-access') return t('admin.historyInitialAccess');
    return t('admin.historyManualEdit');
  };

  useEffect(() => {
    if (!editUser) {
      setAccessLogs([]);
      setIsAccessLogsLoading(false);
      return;
    }

    void loadAccessLogs(editUser.uid);
  }, [editUser, loadAccessLogs]);

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
      federalState: target.profile?.federalState,
      accessDisabled: Boolean(target.profile?.accessDisabled),
      accessDisabledAt: normalizeAccessTimestamp(target.profile?.accessDisabledAt),
      accessExpiresAt: normalizeAccessTimestamp(target.profile?.accessExpiresAt)
    });
  };

  const beginCreate = () => {
    setCreateUserOpen(true);
    setCreateRole('client');
    setCreateProfile({
      email: '',
      customerNumber: '',
      firstName: '',
      lastName: '',
      company: '',
      phone: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'Germany',
      federalState: '',
      accessDisabled: false,
      accessDisabledAt: null,
      accessExpiresAt: null
    });
  };

  const handleCreateUser = async () => {
    const email = (createProfile.email || '').trim();

    if (!email) {
      toast.error(t('admin.createUserMissing'));
      return;
    }

    const accessDisabled = Boolean(createProfile.accessDisabled);
    const accessExpiresAt = normalizeAccessTimestamp(createProfile.accessExpiresAt);
    const shouldLogInitialAccess = hasAccessTimeBeenAdded(null, accessExpiresAt);
    const billNumber = shouldLogInitialAccess
      ? await promptForBillNumber(email, accessExpiresAt)
      : null;

    if (shouldLogInitialAccess && billNumber === null) {
      return;
    }

    setIsSaving(true);
    try {
      const uid = doc(collection(db, 'users')).id;

      await firebaseGPS.createUserDocument(uid, email, createProfile.firstName || createProfile.lastName
        ? `${createProfile.firstName || ''} ${createProfile.lastName || ''}`.trim()
        : undefined
      );
      await updateUserRole(uid, createRole);
      await saveUserProfile({
        uid,
        email,
        existingProfile: null,
        profileUpdates: {
          customerNumber: createProfile.customerNumber,
          firstName: createProfile.firstName,
          lastName: createProfile.lastName,
          company: createProfile.company,
          street: createProfile.street,
          postalCode: createProfile.postalCode,
          city: createProfile.city,
          phone: createProfile.phone,
          country: createProfile.country,
          federalState: createProfile.federalState,
          accessDisabled,
          accessDisabledAt: accessDisabled ? normalizeAccessTimestamp(createProfile.accessDisabledAt) || new Date().toISOString() : null,
          accessExpiresAt,
          accessUpdatedAt: new Date().toISOString()
        },
        accessLog: shouldLogInitialAccess && billNumber
          ? createAccessLogPayload({
            uid,
            email,
            previousExpiresAt: null,
            nextExpiresAt: accessExpiresAt,
            billNumber,
            source: 'initial-access'
          })
          : undefined
      });

      await setDoc(doc(db, 'users', uid), {
        email,
        role: createRole,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      }, { merge: true });

      toast.success(t('admin.createUserSuccess'));
      setCreateUserOpen(false);
      clearSearchQuery();
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
      const accessLogSnapshot = await getDocs(collection(db, 'user_profiles', target.uid, 'access_logs'));
      await Promise.all(accessLogSnapshot.docs.map((logDoc) => deleteDoc(logDoc.ref)));

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
    const email = (editProfile.email || editUser.email || '').trim();
    const previousExpiresAt = normalizeAccessTimestamp(editUser.profile?.accessExpiresAt);
    const accessDisabled = Boolean(editProfile.accessDisabled);
    const accessExpiresAt = normalizeAccessTimestamp(editProfile.accessExpiresAt);
    const shouldLogExtension = hasAccessTimeBeenAdded(previousExpiresAt, accessExpiresAt);
    const billNumber = email && shouldLogExtension
      ? await promptForBillNumber(email, accessExpiresAt)
      : null;

    if (shouldLogExtension && billNumber === null) {
      return;
    }

    setIsSaving(true);
    try {
      if (editRole !== editUser.role) {
        await updateUserRole(editUser.uid, editRole);
      }

      if (email) {
        await saveUserProfile({
          uid: editUser.uid,
          email,
          existingProfile: editUser.profile,
          profileUpdates: {
            customerNumber: editProfile.customerNumber,
            firstName: editProfile.firstName,
            lastName: editProfile.lastName,
            company: editProfile.company,
            street: editProfile.street,
            postalCode: editProfile.postalCode,
            city: editProfile.city,
            phone: editProfile.phone,
            country: editProfile.country,
            federalState: editProfile.federalState,
            accessDisabled,
            accessDisabledAt: accessDisabled ? normalizeAccessTimestamp(editProfile.accessDisabledAt) || new Date().toISOString() : null,
            accessExpiresAt,
            accessUpdatedAt: new Date().toISOString()
          },
          accessLog: shouldLogExtension && billNumber
            ? createAccessLogPayload({
              uid: editUser.uid,
              email,
              previousExpiresAt,
              nextExpiresAt: accessExpiresAt,
              billNumber,
              source: previousExpiresAt ? 'manual-edit' : 'initial-access'
            })
            : undefined
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
      <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
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
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-5 pb-10 sm:px-6 sm:py-8 sm:pb-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.titleEyebrow')}</div>
              <h1 className="text-2xl font-semibold sm:text-3xl">{t('admin.title')}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('admin.subtitle')}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end">
              <button
                onClick={() => navigate('/')}
                className="inline-flex w-full items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800 sm:w-auto"
              >
                {t('common.back')}
              </button>
              <button
                onClick={beginCreate}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto"
              >
                <Plus className="w-4 h-4" />
                {t('admin.createUser')}
              </button>
              <button
                onClick={() => void openAllAccessLogs()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-900/40 sm:w-auto"
              >
                <ScrollText className="h-4 w-4" />
                {t('admin.viewLogs')}
              </button>
              <button
                onClick={() => void loadUsers()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                {t('admin.refresh')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-3">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              ref={searchInputRef}
              type="search"
              name="admin-user-search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('admin.searchPlaceholder')}
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-3">
            {ACCESS_FILTERS.map((filter) => {
              const count = filter.key === 'all'
                ? userAccessSummary.total
                : filter.key === 'expiringSoon'
                  ? userAccessSummary.expiringSoon.length
                  : filter.key === 'expired'
                    ? userAccessSummary.expiredCount
                    : userAccessSummary.disabledCount;

              const isActive = accessFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  onClick={() => setAccessFilter(filter.key)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition sm:rounded-2xl sm:px-4 sm:py-3 ${isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-100'
                    : 'border-gray-200 bg-white/80 text-gray-700 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80 sm:text-xs">{t(filter.labelKey)}</div>
                  <div className="mt-1.5 text-xl font-semibold sm:mt-2 sm:text-2xl">{count}</div>
                </button>
              );
            })}
          </div>

          {!isLoading && userAccessSummary.expiringSoon.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900/70 dark:bg-amber-950/25">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      {t('admin.expiringSoonTitle', {
                        count: userAccessSummary.expiringSoon.length,
                        days: ACCESS_EXPIRING_SOON_DAYS
                      })}
                    </div>
                    <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                      {t('admin.expiringSoonHelp', { days: ACCESS_EXPIRING_SOON_DAYS })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAccessFilter('expiringSoon')}
                  className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
                >
                  {t('admin.showExpiringSoon')}
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                {userAccessSummary.expiringSoon.slice(0, 5).map(({ entry, daysUntilExpiry }) => {
                  const profile = entry.profile;
                  const displayName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || entry.email || entry.uid;
                  const expiresAt = getUserAccessState(profile).expiresAt;

                  return (
                    <div
                      key={`expiring-${entry.uid}`}
                        className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white/70 px-4 py-3 dark:border-amber-900/60 dark:bg-gray-900/40 lg:flex-row lg:items-center lg:justify-between"
                    >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white break-words">{displayName}</div>
                          <div className="mt-1 break-all text-xs text-gray-600 dark:text-gray-300">{entry.email || t('admin.noEmail')}</div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-amber-800 dark:text-amber-200">
                          <span>{getExpiryCountdownLabel(daysUntilExpiry)}</span>
                          {expiresAt && <span>{t('admin.accessUntilLabel')}: {formatAccessDate(expiresAt)}</span>}
                        </div>
                      </div>
                        <div className="grid w-full gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end">
                        <button
                          onClick={() => handleQuickExtendAccess(entry, { days: 30 }, 'quick-30-days')}
                          disabled={isSaving}
                            className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
                        >
                          {t('admin.extend30Days')}
                        </button>
                        <button
                          onClick={() => handleQuickExtendAccess(entry, { years: 1 }, 'quick-1-year')}
                          disabled={isSaving}
                            className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
                        >
                          {t('admin.extend1Year')}
                        </button>
                        <button
                          onClick={() => beginEdit(entry)}
                            className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-100 sm:col-span-2 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800 lg:col-span-1"
                        >
                          {t('common.edit')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4">
            {isLoading ? (
              <div className="text-sm text-gray-500">{t('common.loading')}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-sm text-gray-500">{t('admin.noUsers')}</div>
            ) : (
              filteredUsers.map(entry => {
                const profile = entry.profile;
                const displayName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || entry.email || entry.uid;
                const customerNumber = (profile?.customerNumber || '').trim();
                const accessState = getUserAccessState(profile);
                const accessChipClass = accessState.status === 'disabled'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                  : accessState.status === 'expired'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200';
                const accessLabel = accessState.status === 'disabled'
                  ? t('admin.accessDisabled')
                  : accessState.status === 'expired'
                    ? t('admin.accessExpired')
                    : t('admin.accessEnabled');
                return (
                  <div key={entry.uid} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                          <UserCircle className="w-5 h-5 text-blue-700 dark:text-blue-200" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white break-words">{displayName}</div>
                          <div className="break-all text-xs text-gray-500 dark:text-gray-400">{entry.email || (t('admin.noEmail'))}</div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                            {t('orders.customerNumberLabel')}: {customerNumber || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                            <ShieldCheck className="w-3 h-3" />
                            {getRoleName(entry.role)}
                          </span>
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${accessChipClass}`}>
                            {accessLabel}
                          </span>
                        </div>
                        <div className="grid w-full grid-cols-3 gap-2 lg:flex lg:w-auto">
                          <button
                            onClick={() => void openUserAccessLogs(entry)}
                            title={t('admin.viewLogsForUser')}
                            aria-label={t('admin.viewLogsForUser')}
                            className="inline-flex items-center justify-center rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-900/60 dark:text-violet-200 dark:hover:bg-violet-900/30"
                          >
                            <ScrollText className="h-4 w-4 lg:hidden" />
                            <span className="hidden items-center gap-1.5 lg:inline-flex">
                              <ScrollText className="h-3.5 w-3.5" />
                              {t('admin.viewLogs')}
                            </span>
                          </button>
                          <button
                            onClick={() => beginEdit(entry)}
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                            className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800"
                          >
                            <Pencil className="h-4 w-4 lg:hidden" />
                            <span className="hidden items-center gap-1.5 lg:inline-flex">
                              <Pencil className="h-3.5 w-3.5" />
                              {t('common.edit')}
                            </span>
                          </button>
                          <button
                            onClick={() => handleDeleteUser(entry)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                            className="inline-flex items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/30"
                          >
                            <span className="inline-flex items-center gap-1.5 lg:hidden">
                              <Trash2 className="h-4 w-4" />
                            </span>
                            <span className="hidden items-center gap-1.5 lg:inline-flex">
                              <Trash2 className="w-3.5 h-3.5" />
                              {t('common.delete')}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 xl:grid-cols-4">
                      {entry.createdAt && <span>{t('admin.createdAt')}: {new Date(entry.createdAt).toLocaleDateString()}</span>}
                      {entry.lastActive && <span>{t('admin.lastActive')}: {new Date(entry.lastActive).toLocaleDateString()}</span>}
                      {profile?.company && <span>{t('orders.companyLabel')}: {profile.company}</span>}
                      {accessState.expiresAt
                        ? <span>{t('admin.accessUntilLabel')}: {formatAccessDate(accessState.expiresAt)}</span>
                        : <span>{t('admin.accessNoExpiry')}</span>}
                      {accessState.status === 'disabled' && accessState.disabledAt && (
                        <span>{t('admin.disabledAt')}: {formatAccessDate(accessState.disabledAt)}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {createUserOpen && (
        <div className="fixed inset-0 z-[7000] flex items-end justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl rounded-b-2xl border border-gray-200/60 bg-white/95 shadow-2xl dark:border-gray-800/60 dark:bg-gray-900/95 sm:max-h-[90vh] sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:px-6">
              <div className="min-w-0">
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
            <div className="grid gap-4 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
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
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.customerNumberLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.customerNumber || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, customerNumber: event.target.value }))}
                />
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
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">{t('orders.streetLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.street || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, street: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.postalCodeLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.postalCode || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, postalCode: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.cityLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.city || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, city: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.countryLabel')}
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.country || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, country: event.target.value }))}
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.federalStateLabel')}
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm"
                  value={createProfile.federalState || ''}
                  onChange={(event) => setCreateProfile(prev => ({ ...prev, federalState: event.target.value }))}
                >
                  <option value="">{t('common.select') || 'Select...'}</option>
                  {FEDERAL_STATES.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/30 p-4 sm:col-span-2">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('admin.accessSectionTitle')}</div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('admin.accessSectionHelp')}</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <AccessDateField
                    label={t('admin.accessUntilLabel')}
                    openCalendarLabel={t('admin.openCalendar')}
                    value={toAccessDateInputValue(createProfile.accessExpiresAt)}
                    onChange={(nextValue) => setCreateProfile(prev => ({
                      ...prev,
                      accessExpiresAt: fromAccessDateInputValue(nextValue)
                    }))}
                  />
                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-3 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={Boolean(createProfile.accessDisabled)}
                      onChange={(event) => setCreateProfile(prev => ({
                        ...prev,
                        accessDisabled: event.target.checked,
                        accessDisabledAt: event.target.checked ? new Date().toISOString() : null
                      }))}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span>
                      <span className="block font-semibold text-gray-900 dark:text-white">{t('admin.manualDisableLabel')}</span>
                      <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400">{t('admin.manualDisableHelp')}</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:flex-row sm:justify-end sm:px-6">
              <button
                onClick={() => setCreateUserOpen(false)}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800 sm:w-auto"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateUser}
                disabled={isSaving}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
              >
                {isSaving ? (t('common.saving')) : (t('admin.createUserConfirm'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 z-[7000] flex items-end justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl rounded-b-2xl border border-gray-200/60 bg-white/95 shadow-2xl dark:border-gray-800/60 dark:bg-gray-900/95 sm:max-h-[90vh] sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:px-6">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.editUserTitle')}</div>
                <div className="break-all text-lg font-semibold text-gray-900 dark:text-white">{editUser.email || editUser.uid}</div>
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
            <div className="grid gap-4 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
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
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/30 p-4 sm:col-span-2">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('admin.accessSectionTitle')}</div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('admin.accessSectionHelp')}</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <AccessDateField
                    label={t('admin.accessUntilLabel')}
                    openCalendarLabel={t('admin.openCalendar')}
                    value={toAccessDateInputValue(editProfile.accessExpiresAt)}
                    onChange={(nextValue) => setEditProfile(prev => ({
                      ...prev,
                      accessExpiresAt: fromAccessDateInputValue(nextValue)
                    }))}
                  />
                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-3 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={Boolean(editProfile.accessDisabled)}
                      onChange={(event) => setEditProfile(prev => ({
                        ...prev,
                        accessDisabled: event.target.checked,
                        accessDisabledAt: event.target.checked ? new Date().toISOString() : null
                      }))}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span>
                      <span className="block font-semibold text-gray-900 dark:text-white">{t('admin.manualDisableLabel')}</span>
                      <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400">{t('admin.manualDisableHelp')}</span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/30 p-4 sm:col-span-2">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('admin.accessHistoryTitle')}</div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('admin.accessHistoryHelp')}</p>
                <div className="mt-4 max-h-56 space-y-3 overflow-y-auto pr-1 scrollbar-modern sm:max-h-64">
                  {isAccessLogsLoading ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t('admin.accessHistoryLoading')}</div>
                  ) : accessLogs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {t('admin.accessHistoryEmpty')}
                    </div>
                  ) : (
                    accessLogs.map((logEntry) => (
                      <div key={logEntry.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                            {getAccessHistorySourceLabel(logEntry.source)}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {logEntry.createdAt ? new Date(logEntry.createdAt).toLocaleString() : ''}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <span>{t('admin.historyBillNumber')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.billNumber || '-'}</span></span>
                          <span>{t('admin.historyExtendedBy')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.actorEmail || logEntry.actorUserId || '-'}</span></span>
                          <span>{t('admin.historyPreviousAccess')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.previousExpiresAt ? formatAccessDate(logEntry.previousExpiresAt) : t('admin.accessNoExpiry')}</span></span>
                          <span>{t('admin.historyNewAccess')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.nextExpiresAt ? formatAccessDate(logEntry.nextExpiresAt) : t('admin.accessNoExpiry')}</span></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:flex-row sm:justify-end sm:px-6">
              <button
                onClick={() => setEditUser(null)}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800 sm:w-auto"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
              >
                {isSaving ? (t('common.saving')) : (t('common.save'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {accessLogViewer && (
        <div className="fixed inset-0 z-[7050] flex items-end justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl rounded-b-2xl border border-gray-200/60 bg-white/95 shadow-2xl dark:border-gray-800/60 dark:bg-gray-900/95 sm:max-h-[90vh] sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:px-6">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('admin.accessHistoryTitle')}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{accessLogViewer.title}</div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{accessLogViewer.description}</p>
              </div>
              <button
                onClick={closeAccessLogViewer}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              >
                <span className="sr-only">{t('common.close')}</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {isViewerAccessLogsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">{t('admin.accessHistoryLoading')}</div>
              ) : viewerAccessLogs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                  {t('admin.accessHistoryEmpty')}
                </div>
              ) : (
                <div className="space-y-3">
                  {viewerAccessLogs.map((logEntry) => (
                    <div key={`${accessLogViewer.scope}-${logEntry.id}`} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/60 p-3 sm:p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                              {getAccessHistorySourceLabel(logEntry.source)}
                            </span>
                            {accessLogViewer.scope === 'all' && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                                {logEntry.targetUserEmail || logEntry.targetUserId || t('admin.noEmail')}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {logEntry.createdAt ? new Date(logEntry.createdAt).toLocaleString() : ''}
                          </div>
                        </div>
                        <div className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-200">
                          {t('admin.historyBillNumber')}: {logEntry.billNumber || '-'}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-2">
                        <span>{t('admin.historyExtendedBy')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.actorEmail || logEntry.actorUserId || '-'}</span></span>
                        {accessLogViewer.scope === 'all' && (
                          <span>{t('admin.historyTargetUser')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.targetUserEmail || logEntry.targetUserId || '-'}</span></span>
                        )}
                        <span>{t('admin.historyPreviousAccess')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.previousExpiresAt ? formatAccessDate(logEntry.previousExpiresAt) : t('admin.accessNoExpiry')}</span></span>
                        <span>{t('admin.historyNewAccess')}: <span className="font-semibold text-gray-900 dark:text-white">{logEntry.nextExpiresAt ? formatAccessDate(logEntry.nextExpiresAt) : t('admin.accessNoExpiry')}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:flex-row sm:justify-end sm:px-6">
              <button
                onClick={closeAccessLogViewer}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800 sm:w-auto"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {billPrompt && (
        <div className="fixed inset-0 z-[7100] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl rounded-b-2xl border border-gray-200/60 bg-white/95 shadow-2xl dark:border-gray-800/60 dark:bg-gray-900/95 sm:rounded-2xl">
            <div className="border-b border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:px-6">
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{billPrompt.title}</div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{billPrompt.message}</p>
            </div>
            <div className="px-4 py-5 sm:px-6">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                {t('admin.billNumberLabel')}
                <input
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  value={billPrompt.value}
                  onChange={(event) => setBillPrompt((prev) => prev ? {
                    ...prev,
                    value: event.target.value,
                    error: ''
                  } : prev)}
                  placeholder={t('admin.billNumberPlaceholder')}
                />
              </label>
              {billPrompt.error && (
                <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">{billPrompt.error}</div>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-gray-200/60 px-4 py-4 dark:border-gray-800/60 sm:flex-row sm:justify-end sm:px-6">
              <button
                onClick={() => closeBillPrompt(null)}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-800 sm:w-auto"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  const trimmedValue = billPrompt.value.trim();
                  if (!trimmedValue) {
                    setBillPrompt((prev) => prev ? {
                      ...prev,
                      error: t('admin.billNumberRequired')
                    } : prev);
                    return;
                  }

                  closeBillPrompt(trimmedValue);
                }}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 sm:w-auto"
              >
                {billPrompt.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
