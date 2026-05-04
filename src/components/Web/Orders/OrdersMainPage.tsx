import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, User, LogOut, Settings, Square, Pentagon, ChevronDown, Trash2, ShieldCheck, Menu, ArrowRight, FileText, Send, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDarkMode } from '../../../hooks/useDarkMode';
import { useLanguage } from '../../../hooks/useLanguage';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../ui/ConfirmationProvider';
import OrdersMapView from './OrdersMapView';
import OrderWizard from './OrderWizard';
import area from '@turf/area';
import type { DrawnField } from './types';
import type { LufaStandarduntersuchungsumfang, OrderDraft, OrderLabProvider } from '../../../types';
import { userProfileService, type UserProfile } from '../../../services/userProfileService';
import { createOrderDraft } from './orderDraftUtils';
import { db } from '../../../firebase';
import { collection, query, where, getDocs, deleteDoc, doc, getDoc, updateDoc, setDoc, deleteField } from 'firebase/firestore';
import { deserializeGeometryFromFirestore, simplifyGeometryForStorage } from '../../../utils/geometryUtils';
import toast from 'react-hot-toast';

type OrderFilter = 'submitted' | 'in_progress' | 'completed';

type WizardSourceField = NonNullable<OrderDraft['sourceFields']>[number] & {
  color?: string;
  firestoreId?: string;
};

type ContractEntry = {
  id: string;
  name: string;
  clientId?: string;
  status?: string;
  completedAt?: string;
  completedBy?: string;
};

type ContractField = {
  firestoreId?: string;
  baseId: string;
  baseName: string;
  areaHa: number;
  geometry: any;
  color?: string;
  labAttributes?: Record<string, string>;
  samplingCell?: NonNullable<OrderDraft['sourceFields']>[number]['samplingCell'];
  exportMapping?: NonNullable<OrderDraft['sourceFields']>[number]['exportMapping'];
  projectId: string;
  clientId?: string;
};

export default function OrdersMainPage() {
  const navigate = useNavigate();
  const [isDarkMode, toggleDarkMode] = useDarkMode();
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();
  const { user, logout } = useAuth();
  const { showConfirmation } = useConfirmation();
  const confirmationQuipIndexRef = useRef(0);
  const [activeFilter, setActiveFilter] = useState<OrderFilter>('submitted');
  const [showSidebar, setShowSidebar] = useState(false);
  const [showStepModal, setShowStepModal] = useState(false);
  const [selectedStep, setSelectedStep] = useState(1);
  const [viewportHeightPx, setViewportHeightPx] = useState<number | null>(null);
  const [mapLayoutSyncToken, setMapLayoutSyncToken] = useState(0);
  const [gridPreviewEnabled, setGridPreviewEnabled] = useState(true);
  const [gridPreviewSizeHa, setGridPreviewSizeHa] = useState<3 | 5>(5);
  const submitOrderRef = useRef<(() => void) | null>(null);
  const stepContentRef = useRef<HTMLDivElement | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<OrderFilter | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNewContractModal, setShowNewContractModal] = useState(false);
  const [newContractName, setNewContractName] = useState('');
  const [newContractOwnerId, setNewContractOwnerId] = useState('');
  const [newContractLabProvider, setNewContractLabProvider] = useState<OrderLabProvider | ''>('');
  const [newContractLufaScope, setNewContractLufaScope] = useState<LufaStandarduntersuchungsumfang>('DED');
  const [isCreatingContract, setIsCreatingContract] = useState(false);
  const [showOwnersDropdown, setShowOwnersDropdown] = useState(false);
  const [wizardPanelCollapsed, setWizardPanelCollapsed] = useState(false);
  const [step3Collapsed, setStep3Collapsed] = useState(false);
  const [compactFieldPanelCollapsed, setCompactFieldPanelCollapsed] = useState(false);
  const [drawingMode, setDrawingMode] = useState<'polygon' | 'rectangle' | 'edit' | 'delete' | null>(null);
  const [uploadedFields, setUploadedFields] = useState<WizardSourceField[]>([]);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([]);
  const [fieldSummaries, setFieldSummaries] = useState<Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }>>({});
  const clearSelectedFields = useCallback(() => {
    setSelectedFieldKey(null);
    setSelectedFieldKeys([]);
  }, []);

  const syncViewportHeight = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    const nextHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
    let shouldSyncMap = force;

    setViewportHeightPx((prev) => {
      if (prev !== nextHeight) {
        shouldSyncMap = true;
        return nextHeight;
      }
      return prev;
    });

    if (shouldSyncMap) {
      setMapLayoutSyncToken((prev) => prev + 1);
    }
  }, []);

  const resetViewportPosition = useCallback(() => {
    if (typeof window === 'undefined') return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      activeElement.blur();
    }

    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    const syncAndScroll = () => {
      scrollToTop();
      syncViewportHeight(true);
    };

    syncAndScroll();
    window.requestAnimationFrame(() => {
      syncAndScroll();
      window.requestAnimationFrame(syncAndScroll);
    });
    window.setTimeout(syncAndScroll, 120);
    window.setTimeout(syncAndScroll, 280);
  }, [syncViewportHeight]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frameId = 0;
    const updateViewportHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        syncViewportHeight();
      });
    };

    updateViewportHeight();

    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, [syncViewportHeight]);

  useEffect(() => {
    syncViewportHeight(true);
  }, [showNewContractModal, showStepModal, syncViewportHeight]);

  const closeNewContractModal = useCallback(() => {
    setShowNewContractModal(false);
    resetViewportPosition();
  }, [resetViewportPosition]);

  useEffect(() => {
    if (!stepContentRef.current) return;
    stepContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedStep]);

  useEffect(() => {
    if (!showStepModal) return;
    setWizardPanelCollapsed(false);
  }, [showStepModal, selectedStep]);

  const selectFieldKey = useCallback((key: string, multiSelect: boolean) => {
    setSelectedFieldKey(key);
    setSelectedFieldKeys(prev => {
      if (!multiSelect) return [key];
      return prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key];
    });
  }, []);
  const [focusedBoundaryId, setFocusedBoundaryId] = useState<string | null>(null);
  const [focusedDrawnFieldId, setFocusedDrawnFieldId] = useState<string | null>(null);
  const [fieldsSidebarCollapsed, setFieldsSidebarCollapsed] = useState(false);
  const [mapSelectionEvent, setMapSelectionEvent] = useState<{ baseId: string; ctrlKey: boolean; timestamp: number } | null>(null);
  const [stepReadiness, setStepReadiness] = useState({
    step1Ready: false,
    step2Ready: false,
    step3Ready: false,
    step4Ready: false,
    step5Ready: false,
    step6Ready: false
  });
  const [drawnFields, setDrawnFields] = useState<DrawnField[]>([]);
  const [draftDrawnFields, setDraftDrawnFields] = useState<DrawnField[]>([]);
  const drawnFieldsCountRef = useRef(0);
  const [fieldDetailsOpen, setFieldDetailsOpen] = useState(false);
  const [fieldDetailsKey, setFieldDetailsKey] = useState<string | null>(null);
  const [fieldDetailsName, setFieldDetailsName] = useState('');
  const [fieldDetailsId, setFieldDetailsId] = useState('');
  const [fieldDetailsColor, setFieldDetailsColor] = useState('#3B82F6');
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<null | {
    fieldId: number | string;
    source?: 'uploaded' | 'drawn';
  }>(null);
  const [editModeMenu, setEditModeMenu] = useState<null | {
    fieldId: number | string;
    source?: 'uploaded' | 'drawn';
  }>(null);
  const [editingFieldBackup, setEditingFieldBackup] = useState<DrawnField | null>(null);
  const editingFieldSourceRef = useRef<'drawn' | 'draft' | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);
  const contractDropdownRef = useRef<HTMLDivElement>(null);
  const headerStatusControlsRef = useRef<HTMLDivElement>(null);
  const headerStatusPanelRef = useRef<HTMLDivElement>(null);
  const headerSelectorPanelRef = useRef<HTMLDivElement>(null);
  const fieldItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fieldsListRef = useRef<HTMLDivElement | null>(null);
  const toastCooldownRef = useRef<Record<string, number>>({});
  const boundarySyncSessionsRef = useRef<Record<string, string>>({});
  const projectTelemetrySessionRef = useRef<Record<string, string>>({});
  const saveTelemetryRef = useRef<Record<string, {
    projectId: string;
    sourceFieldCount?: number;
    submitStartedAt?: number;
    draftUpsertedAt?: number;
    boundariesSyncStartedAt?: number;
    boundariesSyncedAt?: number;
    visibleAt?: number;
    persistedCount?: number;
    failed?: boolean;
  }>>({});
  const makeDrawnId = useCallback(() => `drawn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, []);
  const [profileDraft, setProfileDraft] = useState<Partial<UserProfile> | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [draftOverrideId, setDraftOverrideId] = useState<string | null>(null);
  const [draftOverrideName, setDraftOverrideName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'client' | 'admin'>('client');
  const isAdmin = userRole === 'admin';
  const [userOptions, setUserOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const federalStates = [
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
  const colorPresets = [
    '#3B82F6',
    '#22C55E',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#14B8A6',
    '#F97316',
    '#E11D48',
    '#0EA5E9',
    '#84CC16',
    '#A855F7',
    '#64748B',
    '#1D4ED8',
    '#16A34A',
    '#D97706',
    '#B91C1C',
    '#7C3AED',
    '#0F766E',
    '#EA580C',
    '#BE123C',
    '#0284C7',
    '#65A30D',
    '#9333EA',
    '#475569'
  ];

  // Contract selector state
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [showContractsDropdown, setShowContractsDropdown] = useState(false);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [allContractFields, setAllContractFields] = useState<ContractField[]>([]);
  const fieldCompletionSampleThreshold = 3;
  const [fieldSampleCountByBoundaryId, setFieldSampleCountByBoundaryId] = useState<Record<string, number>>({});
  const [contractStatusMap, setContractStatusMap] = useState<Record<string, OrderFilter>>({});
  const [projectDataMap, setProjectDataMap] = useState<Record<string, any>>({});
  
  // Tracks state for field color changes
  const [tracks, setTracks] = useState<Array<any>>([]);

  useEffect(() => {
    drawnFieldsCountRef.current = drawnFields.length;
  }, [drawnFields.length]);

  const notifyToast = useCallback((
    type: 'error' | 'success',
    key: string,
    message: string,
    cooldownMs: number = 3500
  ) => {
    const now = Date.now();
    const last = toastCooldownRef.current[key] || 0;
    if (now - last < cooldownMs) return;
    toastCooldownRef.current[key] = now;

    if (type === 'error') {
      toast.error(message, { id: key });
      return;
    }
    toast.success(message, { id: key });
  }, []);

  const nowMs = useCallback(() => (typeof performance !== 'undefined' ? performance.now() : Date.now()), []);

  const closeStatusMenus = useCallback(() => {
    setOpenFilterMenu(null);
    setShowHeaderMenu(false);
  }, []);

  const handleSelectContract = useCallback((contract: ContractEntry) => {
    setSelectedContractId(contract.id);
    setDraftOverrideId(null);
    setDraftOverrideName(null);
    setShowContractsDropdown(false);
    closeStatusMenus();
    if (isAdmin && contract.clientId) {
      setSelectedOwnerId(contract.clientId);
    }
  }, [closeStatusMenus, isAdmin]);

  const logTelemetrySummary = useCallback((sessionId: string, reason: 'visible' | 'failed') => {
    const entry = saveTelemetryRef.current[sessionId];
    if (!entry) return;

    const submitToUpsert = entry.submitStartedAt != null && entry.draftUpsertedAt != null
      ? entry.draftUpsertedAt - entry.submitStartedAt
      : null;
    const upsertToSyncStart = entry.draftUpsertedAt != null && entry.boundariesSyncStartedAt != null
      ? entry.boundariesSyncStartedAt - entry.draftUpsertedAt
      : null;
    const syncToVisible = entry.boundariesSyncedAt != null && entry.visibleAt != null
      ? entry.visibleAt - entry.boundariesSyncedAt
      : null;
    const submitToVisible = entry.submitStartedAt != null && entry.visibleAt != null
      ? entry.visibleAt - entry.submitStartedAt
      : null;

    console.info('[OrdersTelemetry] Save flow summary', {
      reason,
      sessionId,
      projectId: entry.projectId,
      sourceFieldCount: entry.sourceFieldCount,
      persistedCount: entry.persistedCount,
      submitToUpsertMs: submitToUpsert,
      upsertToSyncStartMs: upsertToSyncStart,
      syncToVisibleMs: syncToVisible,
      submitToVisibleMs: submitToVisible,
      failed: Boolean(entry.failed)
    });
  }, []);

  // Memoize selected contract to avoid TDZ errors in callbacks
  const selectedContract = useMemo(() => {
    if (!selectedContractId) return null;
    return contracts.find((contract) => contract.id === selectedContractId) || null;
  }, [contracts, selectedContractId]);

  const selectedOwnerDropdownValue = selectedOwnerId || '';
  const selectedOwnerOption = useMemo(() => (
    userOptions.find((option) => option.id === selectedOwnerDropdownValue) || null
  ), [userOptions, selectedOwnerDropdownValue]);
  const selectedOwnerButtonLabel = selectedOwnerOption?.label || t('orders.mapUserAll');
  const selectedContractButtonLabel = selectedContractId
    ? selectedContract?.name || t('orders.selectContract')
    : t('orders.contracts');

  const ownerLabelById = useMemo(() => {
    const map = new globalThis.Map<string, string>();
    userOptions.forEach((option) => {
      if (!option.id) return;
      map.set(option.id, option.label);
    });
    return map;
  }, [userOptions]);

  const resolveContractStatus = useCallback((projectData: any, hasTracks: boolean): OrderFilter => {
    // Completion markers and explicit completed status take highest priority
    if (projectData?.completedAt || projectData?.completedBy) {
      return 'completed';
    }

    if (projectData?.status === 'completed') {
      return 'completed';
    }

    // Any active tracking means in-progress, even if status was never updated from submitted
    if (projectData?.status === 'in_progress' || hasTracks) {
      return 'in_progress';
    }

    // Explicit submitted applies only when there is no progress data
    if (projectData?.status === 'submitted') {
      return 'submitted';
    }

    // Finally, check if all fields are completed (legacy/fallback logic)
    const fields = Array.isArray(projectData?.fields) ? projectData.fields : [];
    const allFieldsCompleted = fields.length > 0 && fields.every((field: any) => (
      field?.status === 'completed' || field?.status === 'skipped'
    ));

    if (allFieldsCompleted) {
      return 'completed';
    }

    return 'submitted';
  }, []);

  const loadAllContractFields = useCallback(async (contractsList: ContractEntry[]) => {
    const allFields: ContractField[] = [];

    await Promise.all(contractsList.map(async (contract) => {
      if (!contract.clientId) return;
      try {
        const boundariesPath = `users/${contract.clientId}/field_boundaries`;
        const boundariesRef = collection(db, boundariesPath);
        const q = query(boundariesRef, where('project_id', '==', contract.id));
        const snapshot = await getDocs(q);

        snapshot.docs.forEach((docSnapshot, index) => {
          try {
            const geometry = deserializeGeometryFromFirestore(docSnapshot.data().geometry);
            allFields.push({
              firestoreId: docSnapshot.id,
              baseId: docSnapshot.data().baseId || docSnapshot.data().id || `Field ${index + 1}`,
              baseName: docSnapshot.data().baseName || docSnapshot.data().name || `Field ${index + 1}`,
              areaHa: docSnapshot.data().areaHa || 0,
              geometry,
              color: docSnapshot.data().color || '#3B82F6',
              projectId: contract.id,
              clientId: contract.clientId
            });
          } catch (err) {
            console.error('Error deserializing geometry for field:', docSnapshot.id, err);
          }
        });
      } catch (error) {
        console.error('Error loading contract fields:', error);
      }
    }));

    setAllContractFields(allFields);
  }, []);

  const loadContracts = useCallback(async () => {
    if (!user?.uid) return;

    setContractsLoading(true);
    try {
      // Try to get user role from Firestore first, then fall back to custom claims
      let resolvedRole: 'client' | 'admin' = 'client';
      
      // Method 1: Try Firestore users/{uid}.role
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const firestoreRole = userDoc.data().role;
          console.log('📋 Firestore role:', firestoreRole);
          resolvedRole = (firestoreRole || 'client') === 'admin' ? 'admin' : 'client';
        } else {
          console.log('⚠️ users/{uid} document does not exist');
        }
      } catch (e: any) {
        console.error('❌ Error loading user role from Firestore:', e.code, e.message);
        console.log('🔄 Falling back to custom claims...');
        
        // Method 2: Fallback to custom claims
        try {
          const tokenResult = await user.getIdTokenResult();
          console.log('🔑 Custom claims:', tokenResult.claims);
          if (tokenResult.claims.admin === true) {
            resolvedRole = 'admin';
            console.log('✅ Admin role detected via custom claims');
            
            // Sync the role to Firestore so security rules work correctly
            try {
              const userDocRef = doc(db, 'users', user.uid);
              await setDoc(userDocRef, { 
                role: 'admin', 
                email: user.email || '' 
              }, { merge: true });
              console.log('✅ Synced admin role to Firestore');
            } catch (syncError) {
              console.error('⚠️ Failed to sync role to Firestore:', syncError);
            }
          } else {
            console.log('ℹ️ No admin claim found, using client role');
          }
        } catch (claimError) {
          console.error('❌ Could not read custom claims:', claimError);
          console.log('⚠️ Defaulting to client view');
        }
      }
      
      console.log('👤 Final resolved role:', resolvedRole);
      setUserRole(resolvedRole);

      const contractEntries: Array<{ contract: ContractEntry; projectData: any }> = [];

      if (resolvedRole === 'client') {
        // For clients, load only their own projects from users/{uid}/projects
        try {
          const projectsRef = collection(db, `users/${user.uid}/projects`);
          const snapshot = await getDocs(projectsRef);

          snapshot.docs.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const contract: ContractEntry = {
              id: docSnapshot.id,
              name: data.name || `Project ${docSnapshot.id.slice(0, 8)}`,
              clientId: user.uid,
              status: data.status
            };
            if (data.completedAt) contract.completedAt = data.completedAt;
            if (data.completedBy) contract.completedBy = data.completedBy;
            contractEntries.push({
              contract,
              projectData: data
            });
          });
        } catch (e) {
          console.error('Error loading client projects:', e);
        }
      } else {
        // For admins, load projects from all users
        try {
          const usersRef = collection(db, 'users');
          const profilesRef = collection(db, 'user_profiles');
          const [usersSnapshot, profilesSnapshot] = await Promise.all([
            getDocs(usersRef),
            getDocs(profilesRef)
          ]);

          const profileMap = new Map<string, { label: string }>();
          profilesSnapshot.docs.forEach((docSnapshot) => {
            const data = docSnapshot.data() as any;
            const firstName = String(data.firstName || '').trim();
            const lastName = String(data.lastName || '').trim();
            const fullName = `${firstName} ${lastName}`.trim();
            const company = String(data.company || '').trim();
            const label = fullName || company || data.email || docSnapshot.id;
            profileMap.set(docSnapshot.id, { label });
          });

          const nextUserOptions = usersSnapshot.docs.map((docSnapshot) => {
            const profile = profileMap.get(docSnapshot.id);
            return {
              id: docSnapshot.id,
              label: profile?.label || docSnapshot.data().email || docSnapshot.id
            };
          });
          setUserOptions([
            { id: '', label: t('orders.mapUserAll') },
            ...nextUserOptions
          ]);

          for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const projectsRef = collection(db, `users/${userId}/projects`);
            const projectsSnapshot = await getDocs(projectsRef);

            projectsSnapshot.docs.forEach(docSnapshot => {
              const data = docSnapshot.data();
              const contract: ContractEntry = {
                id: docSnapshot.id,
                name: data.name || `Project ${docSnapshot.id.slice(0, 8)}`,
                clientId: userId,
                status: data.status
              };
              if (data.completedAt) contract.completedAt = data.completedAt;
              if (data.completedBy) contract.completedBy = data.completedBy;
              contractEntries.push({
                contract,
                projectData: data
              });
            });
          }
        } catch (e) {
          console.error('Error loading admin projects:', e);
        }
      }

      const allContracts = contractEntries.map((entry) => entry.contract);
      const projectDataMap: Record<string, any> = {};
      contractEntries.forEach((entry) => {
        projectDataMap[entry.contract.id] = entry.projectData;
      });

      const trackStates = await Promise.all(allContracts.map(async (contract) => {
        if (!contract.clientId) {
          return { id: contract.id, hasTracks: false };
        }
        try {
          const tracksRef = collection(db, `users/${contract.clientId}/tracks`);
          const tracksQuery = query(tracksRef, where('project_id', '==', contract.id));
          const snapshot = await getDocs(tracksQuery);
          return { id: contract.id, hasTracks: !snapshot.empty };
        } catch (error) {
          console.warn('Failed to load tracks for contract:', contract.id, error);
          return { id: contract.id, hasTracks: false };
        }
      }));

      const nextStatusMap: Record<string, OrderFilter> = {};
      trackStates.forEach(({ id, hasTracks }) => {
        nextStatusMap[id] = resolveContractStatus(projectDataMap[id], hasTracks);
      });

      setContracts(allContracts);
      setContractStatusMap(nextStatusMap);
      setProjectDataMap(projectDataMap);
      await loadAllContractFields(allContracts);
    } catch (error) {
      console.error('Error loading contracts:', error);
      notifyToast('error', 'orders.loadContractsFailed', t('orders.loadContractsFailed'));
    } finally {
      setContractsLoading(false);
    }
  }, [user?.uid, resolveContractStatus, loadAllContractFields, t, selectedOwnerId, notifyToast]);

  // Load contracts on mount
  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const loadContractFields = useCallback(async (contractId: string) => {
    const loadStartedMs = nowMs();
    try {
      if (!contractId || !contracts.length) {
        console.log('loadContractFields early return - contractId:', contractId, 'contracts:', contracts.length);
        return;
      }
      
      // Find the client ID from the selected contract
      const selectedContract = contracts.find(c => c.id === contractId);
      console.log('loadContractFields - Looking for contract:', contractId);
      console.log('loadContractFields - Found contract:', selectedContract);
      
      if (!selectedContract?.clientId) {
        console.log('loadContractFields - No clientId found on contract');
        return;
      }
      
      // Boundaries are stored at users/{clientId}/field_boundaries with project_id field
      const boundariesPath = `users/${selectedContract.clientId}/field_boundaries`;
      console.log('loadContractFields - Querying path:', boundariesPath, 'for project_id:', contractId);
      
      // Query field_boundaries collection filtered by project_id
      const boundariesRef = collection(db, boundariesPath);
      const q = query(boundariesRef, where('project_id', '==', contractId));
      const snapshot = await getDocs(q);
      
      console.log('loadContractFields - Found documents:', snapshot.docs.length);
      
      const mappedFields = snapshot.docs.map((doc, index) => {
        try {
          // Deserialize geometry from Firestore (may be stored as string)
          const geometry = deserializeGeometryFromFirestore(doc.data().geometry);
          
          const raw = doc.data();
          const properties = (raw.properties && typeof raw.properties === 'object') ? raw.properties : {};
          const field = {
            firestoreId: doc.id,  // Store the actual Firestore document ID for track matching
            baseId: raw.baseId || properties.baseId || raw.id || `Field ${index + 1}`,
            baseName: raw.baseName || properties.baseName || raw.name || `Field ${index + 1}`,
            areaHa: raw.areaHa ?? properties.areaHa ?? properties.area_ha ?? 0,
            geometry: geometry,
            color: raw.color || '#3B82F6'
          };
          
          // Log all fields with their IDs for debugging
          if (index < 20 || field.baseName.includes('5')) {  // Show first 20 or any field 5
            console.log(`Field ${index}: firestoreId=${field.firestoreId}, baseId=${field.baseId}, baseName=${field.baseName}`);
          }
          
          return field;
        } catch (err) {
          console.error('Error deserializing geometry for field:', doc.id, err);
          return null;
        }
      }).filter((field): field is NonNullable<typeof field> => field !== null);
      
      setUploadedFields(mappedFields);
      console.log(`Loaded ${mappedFields.length} fields for contract ${contractId}`);

      const sessionId = projectTelemetrySessionRef.current[contractId];
      if (sessionId) {
        const telemetry = saveTelemetryRef.current[sessionId];
        if (telemetry && telemetry.boundariesSyncedAt != null && telemetry.visibleAt == null) {
          telemetry.visibleAt = nowMs();
          telemetry.persistedCount = telemetry.persistedCount ?? mappedFields.length;
          logTelemetrySummary(sessionId, 'visible');
        }
      }

      console.debug('[OrdersTelemetry] loadContractFields duration', {
        projectId: contractId,
        fieldsCount: mappedFields.length,
        durationMs: nowMs() - loadStartedMs
      });
    } catch (error) {
      console.error('Error loading contract fields:', error);
      notifyToast('error', 'orders.loadFieldsFailed', t('orders.loadFieldsFailed'));
    }
  }, [contracts, t, notifyToast, nowMs, logTelemetrySummary]);

  const loadContractTracks = useCallback(async (contractId: string) => {
    try {
      if (!contractId || !contracts.length) {
        console.log('loadContractTracks early return');
        return;
      }
      
      // Find the client ID from the selected contract
      const selectedContract = contracts.find(c => c.id === contractId);
      if (!selectedContract?.clientId) return;
      
      const tracksPath = `users/${selectedContract.clientId}/tracks`;
      console.log('loadContractTracks - Querying path:', tracksPath, 'for project_id:', contractId);
      
      // Query tracks collection filtered by project_id
      const tracksRef = collection(db, tracksPath);
      const q = query(tracksRef, where('project_id', '==', contractId));
      const snapshot = await getDocs(q);
      
      const loadedTracks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Load samples and GPS points for each track to get proper rendering on map
      const hydratedTracks = await Promise.all(
        loadedTracks.map(async (track: any) => {
          try {
            // Load samples for this track
            const samplesRef = collection(db, `users/${selectedContract.clientId}/samples`);
            const samplesQuery = query(samplesRef, where('track_id', '==', track.id));
            const samplesSnapshot = await getDocs(samplesQuery);
            const samples = samplesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Load GPS points for this track
            const gpsPointsRef = collection(db, `users/${selectedContract.clientId}/gps_points`);
            const gpsPointsQuery = query(gpsPointsRef, where('track_id', '==', track.id));
            const gpsPointsSnapshot = await getDocs(gpsPointsQuery);
            const gpsPoints = gpsPointsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            return {
              ...track,
              samples: samples,
              gps_points: gpsPoints
            };
          } catch (error) {
            console.warn(`Failed to load samples/gps_points for track ${track.id}:`, error);
            return {
              ...track,
              samples: [],
              gps_points: []
            };
          }
        })
      );
      
      // Log track details for debugging
      hydratedTracks.forEach((track, idx) => {
        console.log(`Track ${idx + 1}:`, {
          id: track.id,
          field_boundary_id: track.field_boundary_id,
          name: track.name,
          samples_count: track.samples?.length || 0
        });
      });
      
      setTracks(hydratedTracks);

      const hasTracks = hydratedTracks.length > 0;
      const computedStatus = resolveContractStatus(projectDataMap[contractId], hasTracks);
      setContractStatusMap((prev) => {
        if (prev[contractId] === computedStatus) {
          return prev;
        }
        return {
          ...prev,
          [contractId]: computedStatus
        };
      });

      console.log(`Loaded ${hydratedTracks.length} tracks for contract ${contractId}`);
    } catch (error) {
      console.error('Error loading contract tracks:', error);
      // Don't show toast for tracks - it's not critical
    }
  }, [contracts, projectDataMap, resolveContractStatus]);

  const loadContractFieldSamples = useCallback(async (contractId: string) => {
    try {
      if (!contractId || !contracts.length) {
        setFieldSampleCountByBoundaryId({});
        return;
      }

      const selectedContract = contracts.find((contract) => contract.id === contractId);
      if (!selectedContract?.clientId) {
        setFieldSampleCountByBoundaryId({});
        return;
      }

      const samplesRef = collection(db, `users/${selectedContract.clientId}/field_samples`);
      const samplesQuery = query(samplesRef, where('project_id', '==', contractId));
      const samplesSnapshot = await getDocs(samplesQuery);

      const counts: Record<string, number> = {};
      samplesSnapshot.docs.forEach((sampleDoc) => {
        const data = sampleDoc.data() as any;
        const boundaryId = data?.field_boundary_id;
        if (boundaryId === undefined || boundaryId === null || boundaryId === '') return;
        const key = String(boundaryId);
        counts[key] = (counts[key] || 0) + 1;
      });

      setFieldSampleCountByBoundaryId(counts);
    } catch (error) {
      console.error('Error loading field samples:', error);
      setFieldSampleCountByBoundaryId({});
    }
  }, [contracts]);

  useEffect(() => {
    if (!selectedContractId) {
      setUploadedFields([]);
      setTracks([]);
      setFieldSampleCountByBoundaryId({});
      return;
    }

    loadContractFields(selectedContractId);
    loadContractTracks(selectedContractId);
    loadContractFieldSamples(selectedContractId);
  }, [selectedContractId, loadContractFields, loadContractTracks, loadContractFieldSamples]);

  useEffect(() => {
    const handleSubmitStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; sessionId?: string; sourceFieldCount?: number; ts?: number }>).detail;
      if (!detail?.projectId || !detail?.sessionId) return;

      projectTelemetrySessionRef.current[detail.projectId] = detail.sessionId;
      saveTelemetryRef.current[detail.sessionId] = {
        projectId: detail.projectId,
        sourceFieldCount: detail.sourceFieldCount,
        submitStartedAt: detail.ts ?? nowMs()
      };
    };

    const handleDraftUpserted = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; sessionId?: string; ts?: number }>).detail;
      if (!detail?.projectId || !detail?.sessionId) return;

      const entry = saveTelemetryRef.current[detail.sessionId] || { projectId: detail.projectId };
      entry.draftUpsertedAt = detail.ts ?? nowMs();
      saveTelemetryRef.current[detail.sessionId] = entry;
      projectTelemetrySessionRef.current[detail.projectId] = detail.sessionId;
    };

    const handleBoundariesSyncStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; sessionId?: string; ts?: number; sourceFieldCount?: number }>).detail;
      if (!detail?.projectId || !detail?.sessionId) return;
      boundarySyncSessionsRef.current[detail.projectId] = detail.sessionId;
      projectTelemetrySessionRef.current[detail.projectId] = detail.sessionId;

      const entry = saveTelemetryRef.current[detail.sessionId] || { projectId: detail.projectId };
      entry.boundariesSyncStartedAt = detail.ts ?? nowMs();
      entry.sourceFieldCount = entry.sourceFieldCount ?? detail.sourceFieldCount;
      saveTelemetryRef.current[detail.sessionId] = entry;
    };

    const handleBoundariesSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; sessionId?: string; persistedCount?: number; ts?: number }>).detail;
      if (!detail?.projectId) return;

      if (detail.sessionId && boundarySyncSessionsRef.current[detail.projectId] && boundarySyncSessionsRef.current[detail.projectId] !== detail.sessionId) {
        return;
      }

      if (detail.sessionId) {
        const entry = saveTelemetryRef.current[detail.sessionId] || { projectId: detail.projectId };
        entry.boundariesSyncedAt = detail.ts ?? nowMs();
        entry.persistedCount = detail.persistedCount;
        saveTelemetryRef.current[detail.sessionId] = entry;
        projectTelemetrySessionRef.current[detail.projectId] = detail.sessionId;
      }

      delete boundarySyncSessionsRef.current[detail.projectId];
      void loadContracts();

      if (!selectedContractId || detail.projectId === selectedContractId) {
        void loadContractFields(detail.projectId);
        void loadContractTracks(detail.projectId);
        void loadContractFieldSamples(detail.projectId);
      }
    };

    const handleBoundariesSyncFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; sessionId?: string; message?: string; ts?: number }>).detail;
      if (!detail?.projectId) return;
      if (detail.sessionId && boundarySyncSessionsRef.current[detail.projectId] && boundarySyncSessionsRef.current[detail.projectId] !== detail.sessionId) {
        return;
      }

      if (detail.sessionId) {
        const entry = saveTelemetryRef.current[detail.sessionId] || { projectId: detail.projectId };
        entry.failed = true;
        entry.boundariesSyncedAt = detail.ts ?? nowMs();
        saveTelemetryRef.current[detail.sessionId] = entry;
        projectTelemetrySessionRef.current[detail.projectId] = detail.sessionId;
        logTelemetrySummary(detail.sessionId, 'failed');
      }

      delete boundarySyncSessionsRef.current[detail.projectId];
      notifyToast('error', 'orders.boundarySyncFailed', detail.message || (t('orders.loadFieldsFailed')));
      void loadContracts();
    };

    window.addEventListener('orders:submitStarted', handleSubmitStarted as EventListener);
    window.addEventListener('orders:draftUpserted', handleDraftUpserted as EventListener);
    window.addEventListener('orders:boundariesSyncStarted', handleBoundariesSyncStarted as EventListener);
    window.addEventListener('orders:boundariesSynced', handleBoundariesSynced as EventListener);
    window.addEventListener('orders:boundariesSyncFailed', handleBoundariesSyncFailed as EventListener);
    return () => {
      window.removeEventListener('orders:submitStarted', handleSubmitStarted as EventListener);
      window.removeEventListener('orders:draftUpserted', handleDraftUpserted as EventListener);
      window.removeEventListener('orders:boundariesSyncStarted', handleBoundariesSyncStarted as EventListener);
      window.removeEventListener('orders:boundariesSynced', handleBoundariesSynced as EventListener);
      window.removeEventListener('orders:boundariesSyncFailed', handleBoundariesSyncFailed as EventListener);
    };
  }, [selectedContractId, loadContractFields, loadContractTracks, loadContractFieldSamples, loadContracts, notifyToast, t, nowMs, logTelemetrySummary]);

  const handleNewOrder = useCallback(() => {
    closeStatusMenus();
    setShowOwnersDropdown(false);
    setShowContractsDropdown(false);
    setNewContractName('');
    setNewContractOwnerId(selectedOwnerId || user?.uid || '');
    setNewContractLabProvider('');
    setNewContractLufaScope('DED');
    setShowNewContractModal(true);
  }, [closeStatusMenus, selectedOwnerId, user?.uid]);

  const handleCreateContract = useCallback(async () => {
    if (!user?.uid) return;
    const trimmedName = newContractName.trim();
    if (!trimmedName) {
      toast.error(t('orders.contractNameRequired'));
      return;
    }

    if (userRole === 'admin' && !newContractOwnerId) {
      toast.error(t('orders.contractOwnerRequired'));
      return;
    }

    if (!newContractLabProvider) {
      toast.error(t('orders.contractLabRequired'));
      return;
    }

    setIsCreatingContract(true);
    try {
      const ownerId = userRole === 'admin' ? newContractOwnerId : user.uid;
      const newId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const seededDraft = createOrderDraft(ownerId, newId, trimmedName, {
        labProvider: newContractLabProvider,
        lufaScope: newContractLufaScope
      });
      try {
        localStorage.setItem(`order_draft_${newId}`, JSON.stringify(seededDraft));
      } catch (error) {
        console.warn('[OrdersMainPage] Failed to persist seeded draft locally:', error);
      }
      setDraftOverrideId(newId);
      setDraftOverrideName(trimmedName);
      setSelectedContractId(null);
      setUploadedFields([]);
      setDrawnFields([]);
      setDraftDrawnFields([]);
      clearSelectedFields();
      setFocusedBoundaryId(null);
      setFocusedDrawnFieldId(null);
      setTracks([]);
      setMapSelectionEvent(null);
      setShowSidebar(true);
      setSelectedStep(1);
      setShowStepModal(true);
      setShowNewContractModal(false);
      resetViewportPosition();
      toast.success(t('orders.contractDraftReady'));
    } catch (error) {
      console.error('Failed to create contract:', error);
      toast.error(t('orders.contractCreateFailed'));
    } finally {
      setIsCreatingContract(false);
    }
  }, [newContractName, t, user?.uid, userRole, newContractOwnerId, newContractLabProvider, newContractLufaScope, clearSelectedFields, resetViewportPosition]);

  const handleDiscardContract = useCallback(async () => {
    const discardQuips = [
      t('orders.discardConfirmQuips.0'),
      t('orders.discardConfirmQuips.1'),
      t('orders.discardConfirmQuips.2'),
      t('orders.discardConfirmQuips.3'),
      t('orders.discardConfirmQuips.4')
    ];
    const quip = discardQuips[Math.floor(Math.random() * discardQuips.length)];
    const confirmed = await showConfirmation(
      t('orders.discardConfirmTitle'),
      quip,
      {
        type: 'warning',
        confirmText: t('orders.discard'),
        cancelText: t('common.cancel')
      }
    );

    if (!confirmed) return;

    if (draftOverrideId) {
      try {
        localStorage.removeItem(`order_draft_${draftOverrideId}`);
      } catch (error) {
        console.warn('[OrdersMainPage] Failed to clear draft cache:', error);
      }
    }

    setDraftOverrideId(null);
    setDraftOverrideName(null);
    setSelectedContractId(null);
    setUploadedFields([]);
    setDrawnFields([]);
    setDraftDrawnFields([]);
    clearSelectedFields();
    setFocusedBoundaryId(null);
    setFocusedDrawnFieldId(null);
    setTracks([]);
    setMapSelectionEvent(null);
    setShowNewContractModal(false);
    setShowContractsDropdown(false);
    setShowStepModal(false);
    setStep3Collapsed(false);
    setShowSidebar(false);
    setSelectedStep(1);
    setNewContractName('');
    setNewContractOwnerId(selectedOwnerId || user?.uid || '');
    setNewContractLabProvider('');
    setNewContractLufaScope('DED');
    resetViewportPosition();
  }, [draftOverrideId, clearSelectedFields, selectedOwnerId, user?.uid, showConfirmation, t, resetViewportPosition]);

  const handleOpenStep = useCallback((step: number) => {
    setSelectedStep(step);
    setShowStepModal(true);
    if (step !== 3) {
      setStep3Collapsed(false);
    }
    if (step === 4) {
      clearSelectedFields();
      setFocusedBoundaryId(null);
      setFocusedDrawnFieldId(null);
      setMapSelectionEvent(null);
    }
  }, []);

  const handleWizardStepChange = useCallback((step: number) => {
    setSelectedStep(step);
    setShowStepModal(true);
    if (step !== 3) {
      setStep3Collapsed(false);
    }
    if (step === 4) {
      clearSelectedFields();
      setFocusedBoundaryId(null);
      setFocusedDrawnFieldId(null);
      setMapSelectionEvent(null);
    }
  }, []);

  const handleCloseStepModal = useCallback(() => {
    setShowStepModal(false);
    setStep3Collapsed(false);
    resetViewportPosition();
  }, [resetViewportPosition]);

  const handleOrderComplete = useCallback(() => {
    setShowSidebar(false);
    setShowStepModal(false);
    setStep3Collapsed(false);
    setDraftOverrideId(null);
    setDraftOverrideName(null);
    setUploadedFields([]);
    setDrawnFields([]);
    setDraftDrawnFields([]);
    clearSelectedFields();
    setFocusedBoundaryId(null);
    setFocusedDrawnFieldId(null);
    setMapSelectionEvent(null);
    resetViewportPosition();
    loadContracts();
  }, [clearSelectedFields, loadContracts, resetViewportPosition]);

  const handleDeleteContract = useCallback(async (contract: ContractEntry) => {
    if (!contract.clientId) return;

    const confirmed = await showConfirmation(
      t('orders.confirmDeleteContractTitle'),
      `${nextConfirmationQuip()} ${t('orders.confirmDeleteContractMessage', { name: contract.name })
        || `Delete "${contract.name}"? This cannot be undone.`}`,
      {
        type: 'danger',
        confirmText: t('common.delete'),
        cancelText: t('common.cancel')
      }
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, `users/${contract.clientId}/projects/${contract.id}`));

      setContracts((prev) => prev.filter((item) => item.id !== contract.id));
      setContractStatusMap((prev) => {
        const next = { ...prev };
        delete next[contract.id];
        return next;
      });
      setAllContractFields((prev) => prev.filter((field) => field.projectId !== contract.id));

      if (selectedContractId === contract.id) {
        setSelectedContractId(null);
        setUploadedFields([]);
        setTracks([]);
      }

      toast.success(t('orders.contractDeleted'));
    } catch (error) {
      console.error('Failed to delete contract:', error);
      toast.error(t('orders.contractDeleteFailed'));
    }
  }, [selectedContractId, showConfirmation, t]);

  const handleFieldsLoaded = useCallback((fields: NonNullable<OrderDraft['sourceFields']>) => {
    const normalizedFields = fields.map((field) => ({ ...field, color: field.color ?? '#3B82F6' }));
    setUploadedFields(normalizedFields);

    if (!selectedContractId) return;
    const selectedContract = contracts.find((contract) => contract.id === selectedContractId);
    if (!selectedContract?.clientId) return;

    setAllContractFields((prev) => ([
      ...prev.filter((field) => field.projectId !== selectedContractId),
      ...normalizedFields.map((field) => ({
        ...field,
        projectId: selectedContractId,
        clientId: selectedContract.clientId
      }))
    ]));
  }, [contracts, selectedContractId]);

  const isDrawingSession = drawingMode === 'polygon' || drawingMode === 'rectangle';
  const previewDrawnFields = useMemo(() => (
    isDrawingSession || draftDrawnFields.length
      ? [...drawnFields, ...draftDrawnFields]
      : drawnFields
  ), [drawnFields, draftDrawnFields, isDrawingSession]);

  const mappedUploadedFields = useMemo(() =>
    uploadedFields.map((field, index) => ({
      ...field,
      source: 'uploaded' as const,
      boundaryId: field.firestoreId || (index + 1),  // Use firestoreId for track matching, fallback to index
      key: `u-${field.firestoreId || index + 1}`
    })),
  [uploadedFields]);

  const mappedDrawnFields = useMemo(() =>
    previewDrawnFields.map((field) => ({
      ...field,
      source: 'drawn' as const,
      drawnId: field.id,
      key: `d-${field.id}`
    })),
  [previewDrawnFields]);

  const combinedFields = useMemo(() => (
    [...mappedUploadedFields, ...mappedDrawnFields]
  ), [mappedUploadedFields, mappedDrawnFields]);

  const wizardSourceFields = useMemo(() => {
    const normalizedUploaded = uploadedFields.map((field) => ({
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      geometry: field.geometry,
      color: field.color,
      labAttributes: field.labAttributes,
      samplingCell: field.samplingCell,
      exportMapping: field.exportMapping,
    }));

    const normalizedDraftDrawn = draftDrawnFields.map((field) => ({
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      geometry: field.geometry,
      color: field.color
    }));

    return [...normalizedUploaded, ...normalizedDraftDrawn];
  }, [uploadedFields, draftDrawnFields]);

  const resolveDrawnField = useCallback((fieldId: number | string) => {
    const id = String(fieldId);
    return drawnFields.find((field) => field.id === id)
      ?? draftDrawnFields.find((field) => field.id === id)
      ?? null;
  }, [drawnFields, draftDrawnFields]);

  const handleWizardFieldFocus = useCallback((baseId: string) => {
    const uploadedIndex = uploadedFields.findIndex((field) => field.baseId === baseId || field.baseName === baseId);
    if (uploadedIndex >= 0) {
      const boundaryId = uploadedFields[uploadedIndex].firestoreId || (uploadedIndex + 1);
      selectFieldKey(`u-${boundaryId}`, false);
      setFocusedBoundaryId(String(boundaryId));
      setFocusedDrawnFieldId(null);
      return;
    }

    const drawn = previewDrawnFields.find((field) => field.baseId === baseId || field.baseName === baseId);
    if (drawn) {
      selectFieldKey(`d-${drawn.id}`, false);
      setFocusedDrawnFieldId(drawn.id);
      setFocusedBoundaryId(null);
    }
  }, [previewDrawnFields, uploadedFields, selectFieldKey]);

  const openFieldDetails = useCallback((fieldKey: string) => {
    const field = combinedFields.find((item) => item.key === fieldKey);
    if (field) {
      setFieldDetailsKey(fieldKey);
      setFieldDetailsName(field.baseName);
      setFieldDetailsId(field.baseId);
      setFieldDetailsColor(field.color ?? '#3B82F6');
      setFieldDetailsOpen(true);
      return;
    }
    if (fieldKey.startsWith('d-')) {
      const id = fieldKey.replace('d-', '');
      const drawnField = resolveDrawnField(id);
      if (!drawnField) return;
      setFieldDetailsKey(fieldKey);
      setFieldDetailsName(drawnField.baseName);
      setFieldDetailsId(drawnField.baseId);
      setFieldDetailsColor(drawnField.color ?? '#3B82F6');
      setFieldDetailsOpen(true);
    }
  }, [combinedFields, resolveDrawnField]);

  const handleFieldEditRequest = useCallback((fieldId: number | string, source?: 'uploaded' | 'drawn') => {
    if (!isAdmin && !(showStepModal || draftOverrideId)) {
      return;
    }
    if (source === 'drawn') {
      const key = `d-${fieldId}`;
      selectFieldKey(key, false);
      openFieldDetails(key);
      return;
    }

    const key = `u-${fieldId}`;
    selectFieldKey(key, false);
    openFieldDetails(key);

    const fallback = allContractFields.find((field) => String(field.firestoreId) === String(fieldId));
    if (!fallback) return;
    setFieldDetailsKey(key);
    setFieldDetailsName(fallback.baseName);
    setFieldDetailsId(fallback.baseId);
    setFieldDetailsColor(fallback.color ?? '#3B82F6');
    setFieldDetailsOpen(true);
  }, [openFieldDetails, selectFieldKey, allContractFields, isAdmin, showStepModal, draftOverrideId]);

  const resolveUploadedIndex = useCallback((fieldId: number | string) => {
    const fieldIdString = String(fieldId);
    const numericId = Number(fieldId);
    const byFirestoreId = uploadedFields.findIndex((field) => String(field.firestoreId ?? '') === fieldIdString);
    if (byFirestoreId >= 0) return byFirestoreId;
    if (!Number.isNaN(numericId)) {
      const byIndex = numericId - 1;
      if (byIndex >= 0 && byIndex < uploadedFields.length) return byIndex;
    }
    return uploadedFields.findIndex((field) => field.baseId === fieldIdString || field.baseName === fieldIdString);
  }, [uploadedFields]);

  const handleFieldShapeAction = useCallback((action: 'edit-shape' | 'redraw-shape' | 'delete-shape', fieldId: number | string, source?: 'uploaded' | 'drawn') => {
    if (!isAdmin && !(showStepModal || draftOverrideId)) {
      return;
    }
    if (action === 'delete-shape') {
      setDeleteConfirmTarget({ fieldId, source });
      return;
    }

    if (action === 'redraw-shape') {
      // Directly trigger redraw workflow
      if (source === 'drawn') {
        const existing = resolveDrawnField(fieldId);
        if (!existing) return;
        const isDraft = draftDrawnFields.some((field) => field.id === String(fieldId));
        editingFieldSourceRef.current = isDraft ? 'draft' : 'drawn';
        // Backup and remove the field to allow redrawing
        setEditingFieldBackup({ ...existing });
        if (isDraft) {
          setDraftDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
        } else {
          setDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
        }
        clearSelectedFields();
        setFocusedDrawnFieldId(null);
        setDrawingMode('polygon');
        return;
      }

      // Convert uploaded field to drawn, then remove it for redrawing
      const existingField = allContractFields.find((field) => String(field.firestoreId) === String(fieldId))
        || uploadedFields[resolveUploadedIndex(fieldId)];
      if (!existingField) return;

      const drawnId = makeDrawnId();
      const areaHa = existingField.areaHa ?? Number((area({ type: 'Feature', geometry: existingField.geometry, properties: {} }) / 10000).toFixed(2));
      const drawnField: DrawnField = {
        id: drawnId,
        baseId: existingField.baseId,
        baseName: existingField.baseName,
        areaHa,
        geometry: existingField.geometry,
        color: existingField.color ?? '#3B82F6'
      };

      setEditingFieldBackup({ ...drawnField });
      editingFieldSourceRef.current = 'drawn';
      setUploadedFields((prev) => prev.filter((field) => String(field.firestoreId) !== String(fieldId)));
      setAllContractFields((prev) => prev.filter((field) => String(field.firestoreId) !== String(fieldId)));
      clearSelectedFields();
      setFocusedDrawnFieldId(null);
      setFocusedBoundaryId(null);
      setDrawingMode('polygon');
      return;
    }

    // Show edit mode menu (vertex edit or recreate)
    setEditModeMenu({ fieldId, source });
  }, [drawnFields, uploadedFields, allContractFields, makeDrawnId, area, resolveUploadedIndex, resolveDrawnField, draftDrawnFields, clearSelectedFields, isAdmin, showStepModal, draftOverrideId]);

  const handleMapBackgroundClick = useCallback(() => {
    clearSelectedFields();
    setFocusedBoundaryId(null);
    setFocusedDrawnFieldId(null);
    setFieldDetailsOpen(false);
    setEditModeMenu(null);
    setDeleteConfirmTarget(null);
    setMapSelectionEvent(null);
  }, [clearSelectedFields]);

  const handleEditVertices = useCallback(() => {
    if (!editModeMenu) return;
    const { fieldId, source } = editModeMenu;

    if (source === 'drawn') {
      const existing = resolveDrawnField(fieldId);
      if (!existing) return;
      const isDraft = draftDrawnFields.some((field) => field.id === String(fieldId));
      editingFieldSourceRef.current = isDraft ? 'draft' : 'drawn';
      // Backup the current field
      setEditingFieldBackup({ ...existing });
      const key = `d-${fieldId}`;
      selectFieldKey(key, false);
      setDrawingMode('edit');
      setEditModeMenu(null);
      return;
    }

    // Convert uploaded field to drawn field
    const index = resolveUploadedIndex(fieldId);
    if (index < 0) return;
    const field = uploadedFields[index];
    if (!field) return;

    const drawnId = makeDrawnId();
    const areaHa = field.areaHa ?? Number((area({ type: 'Feature', geometry: field.geometry, properties: {} }) / 10000).toFixed(2));
    const drawnField: DrawnField = {
      id: drawnId,
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa,
      geometry: field.geometry,
      color: field.color ?? '#3B82F6'
    };

    setEditingFieldBackup({ ...drawnField });
    editingFieldSourceRef.current = 'drawn';
    setUploadedFields((prev) => prev.filter((_, idx) => idx !== index));
    setDrawnFields((prev) => [...prev, drawnField]);
    selectFieldKey(`d-${drawnId}`, false);
    setDrawingMode('edit');
    setEditModeMenu(null);
  }, [editModeMenu, drawnFields, makeDrawnId, uploadedFields, selectFieldKey, resolveUploadedIndex, resolveDrawnField, draftDrawnFields]);

  const handleRecreateField = useCallback(() => {
    if (!editModeMenu) return;
    const { fieldId, source } = editModeMenu;

    if (source === 'drawn') {
      const existing = resolveDrawnField(fieldId);
      if (!existing) return;
      const isDraft = draftDrawnFields.some((field) => field.id === String(fieldId));
      editingFieldSourceRef.current = isDraft ? 'draft' : 'drawn';
      // Backup and remove the field to allow redrawing
      setEditingFieldBackup({ ...existing });
      if (isDraft) {
        setDraftDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
      } else {
        setDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
      }
      clearSelectedFields();
      setFocusedDrawnFieldId(null);
      setDrawingMode('polygon');
      setEditModeMenu(null);
      return;
    }

    // Convert uploaded field to drawn, then remove it for redrawing
    const index = resolveUploadedIndex(fieldId);
    if (index < 0) return;
    const field = uploadedFields[index];
    if (!field) return;

    const drawnId = makeDrawnId();
    const areaHa = field.areaHa ?? Number((area({ type: 'Feature', geometry: field.geometry, properties: {} }) / 10000).toFixed(2));
    const drawnField: DrawnField = {
      id: drawnId,
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa,
      geometry: field.geometry,
      color: field.color ?? '#3B82F6'
    };

    setEditingFieldBackup({ ...drawnField });
    editingFieldSourceRef.current = 'drawn';
    setUploadedFields((prev) => prev.filter((_, idx) => idx !== index));
    clearSelectedFields();
    setFocusedDrawnFieldId(null);
    setFocusedBoundaryId(null);
    setDrawingMode('polygon');
    setEditModeMenu(null);
  }, [editModeMenu, drawnFields, makeDrawnId, uploadedFields, clearSelectedFields, resolveUploadedIndex, resolveDrawnField, draftDrawnFields]);

  const handleCancelEdit = useCallback(() => {
    if (!editingFieldBackup) return;

    // Restore the backup
    if (editingFieldSourceRef.current === 'draft') {
      setDraftDrawnFields((prev) => {
        const filtered = prev.filter((field) => field.id !== editingFieldBackup.id);
        return [...filtered, editingFieldBackup];
      });
    } else {
      setDrawnFields((prev) => {
        const filtered = prev.filter((field) => field.id !== editingFieldBackup.id);
        return [...filtered, editingFieldBackup];
      });
    }

    setDrawingMode(null);
    setEditingFieldBackup(null);
    editingFieldSourceRef.current = null;
    clearSelectedFields();
    setFocusedDrawnFieldId(null);
  }, [editingFieldBackup, clearSelectedFields]);

  const handleUpdateEdit = useCallback(() => {
    // Just exit edit mode, keeping the changes
    setDrawingMode(null);
    setEditingFieldBackup(null);
    editingFieldSourceRef.current = null;
    clearSelectedFields();
    setFocusedDrawnFieldId(null);
  }, [clearSelectedFields]);

  const handleConfirmDeleteShape = useCallback(() => {
    if (!deleteConfirmTarget) return;
    const { fieldId, source } = deleteConfirmTarget;
    if (source === 'drawn') {
      const key = `d-${fieldId}`;
      setDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
      setDraftDrawnFields((prev) => prev.filter((field) => field.id !== String(fieldId)));
      setSelectedFieldKey((prev) => (prev === key ? null : prev));
      setSelectedFieldKeys((prev) => prev.filter(item => item !== key));
      setFocusedDrawnFieldId((prev) => (prev === String(fieldId) ? null : prev));
    } else {
      const numericId = Number(fieldId);
      const fallback = allContractFields.find((field) => String(field.firestoreId) === String(fieldId));
      const targetIndex = resolveUploadedIndex(fieldId);
      const key = targetIndex !== -1 ? `u-${targetIndex + 1}` : `u-${fieldId}`;

      setUploadedFields((prev) => prev.filter((field) => String(field.firestoreId) !== String(fieldId)));
      setAllContractFields((prev) => prev.filter((field) => String(field.firestoreId) !== String(fieldId)));
      setSelectedFieldKey((prev) => (prev === key ? null : prev));
      setSelectedFieldKeys((prev) => prev.filter(item => item !== key));
      setFocusedBoundaryId((prev) => (prev === numericId ? null : prev));

      const targetClientId = fallback?.clientId || selectedContract?.clientId;
      const firestoreId = fallback?.firestoreId || String(fieldId);
      if (targetClientId && firestoreId) {
        deleteDoc(doc(db, `users/${targetClientId}/field_boundaries/${firestoreId}`)).catch((error) => {
          console.warn('Failed to delete field boundary:', error);
        });
      }
    }
    setDrawingMode(null);
    setDeleteConfirmTarget(null);
  }, [deleteConfirmTarget, resolveUploadedIndex, allContractFields, selectedContract?.clientId, db]);

  const handleSaveFieldDetails = useCallback(async () => {
    if (!fieldDetailsKey) return;
    if (fieldDetailsKey.startsWith('u-')) {
      const idPart = fieldDetailsKey.replace('u-', '');
      
      // Update local state
      setUploadedFields((prev) => prev.map((field, idx) => {
        const fieldKey = field.firestoreId || String(idx + 1);
        if (fieldKey !== idPart) return field;
        return { ...field, baseName: fieldDetailsName, baseId: fieldDetailsId, color: fieldDetailsColor };
      }));

      // Find the field and save to Firebase
      const field = uploadedFields.find((f, idx) => {
        const fieldKey = f.firestoreId || String(idx + 1);
        return fieldKey === idPart;
      });

      const oldBaseId = field?.baseId || '';
      const oldBaseName = field?.baseName || '';
      const newBaseId = fieldDetailsId || oldBaseId;
      const newBaseName = fieldDetailsName || oldBaseName;

      // Preserve summary badges when identifiers are edited by remapping old summary keys.
      setFieldSummaries((prev) => {
        const next = { ...prev };
        const oldKey = [oldBaseId, oldBaseName].find((key) => key && next[key]);
        const targetKey = newBaseId || newBaseName;
        if (!oldKey || !targetKey || oldKey === targetKey) {
          return prev;
        }

        const oldSummary = next[oldKey];
        if (!oldSummary) return prev;

        if (next[targetKey]) {
          const merged = {
            ...next[targetKey],
            badges: Array.from(new Set([...(next[targetKey].badges || []), ...(oldSummary.badges || [])])),
            services: Array.from(new Set([...(next[targetKey].services || []), ...(oldSummary.services || [])]))
          };
          next[targetKey] = merged;
        } else {
          next[targetKey] = oldSummary;
        }

        delete next[oldKey];
        return next;
      });

      // Keep local project field metadata aligned so computed summaries continue matching renamed IDs.
      if (selectedContractId) {
        setProjectDataMap((prev) => {
          const current = prev[selectedContractId];
          if (!current?.fields?.length) return prev;

          const nextFields = current.fields.map((projectField: any) => {
            const projectBaseId = String(projectField?.baseId || '');
            const projectBaseName = String(projectField?.baseName || '');
            const projectFieldId = String(projectField?.fieldId || '');
            const projectFieldName = String(projectField?.fieldName || '');

            const sameId = oldBaseId && projectBaseId === oldBaseId;
            const sameName = oldBaseName && projectBaseName === oldBaseName;
            const prefixedId = oldBaseId && projectFieldId.startsWith(`${oldBaseId}.`);
            const prefixedName = oldBaseName && projectFieldName.startsWith(`${oldBaseName}.`);

            if (!sameId && !sameName && !prefixedId && !prefixedName) {
              return projectField;
            }

            return {
              ...projectField,
              baseId: sameId || prefixedId ? newBaseId : projectField.baseId,
              baseName: sameName || prefixedName ? newBaseName : projectField.baseName,
              fieldId: prefixedId ? projectFieldId.replace(`${oldBaseId}.`, `${newBaseId}.`) : projectField.fieldId,
              fieldName: prefixedName ? projectFieldName.replace(`${oldBaseName}.`, `${newBaseName}.`) : projectField.fieldName
            };
          });

          return {
            ...prev,
            [selectedContractId]: {
              ...current,
              fields: nextFields
            }
          };
        });
      }

      if (field?.firestoreId && selectedContract?.clientId) {
        try {
          const fieldRef = doc(db, `users/${selectedContract.clientId}/field_boundaries/${field.firestoreId}`);
          await updateDoc(fieldRef, {
            baseName: fieldDetailsName,
            baseId: fieldDetailsId,
            color: fieldDetailsColor
          });
          
          // Also update allContractFields so the map reflects changes immediately
          setAllContractFields((prev) => prev.map((contractField) => {
            if (contractField.firestoreId === field.firestoreId) {
              return { ...contractField, baseName: fieldDetailsName, baseId: fieldDetailsId, color: fieldDetailsColor };
            }
            return contractField;
          }));
          
          toast.success(t('orders.fieldUpdateSuccess'));
        } catch (error) {
          console.error('Failed to update field in Firebase:', error);
          toast.error(t('orders.fieldUpdateFailed'));
        }
      }
    } else if (fieldDetailsKey.startsWith('d-')) {
      const id = fieldDetailsKey.replace('d-', '');
      setDrawnFields((prev) => prev.map((field) => (
        field.id === id
          ? { ...field, baseName: fieldDetailsName, baseId: fieldDetailsId, color: fieldDetailsColor }
          : field
      )));
      setDraftDrawnFields((prev) => prev.map((field) => (
        field.id === id
          ? { ...field, baseName: fieldDetailsName, baseId: fieldDetailsId, color: fieldDetailsColor }
          : field
      )));
    }
    setFieldDetailsOpen(false);
  }, [fieldDetailsKey, fieldDetailsName, fieldDetailsId, fieldDetailsColor, uploadedFields, selectedContract?.clientId, db, t]);

  useEffect(() => {
    if (!selectedFieldKey || fieldsSidebarCollapsed) return;
    const el = fieldItemRefs.current[selectedFieldKey];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedFieldKey, fieldsSidebarCollapsed]);

  const handleSignOut = useCallback(async () => {
    await logout();
    setShowUserMenu(false);
  }, [logout]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const insideOwnerDropdown = ownerDropdownRef.current?.contains(targetNode) ?? false;
      const insideContractDropdown = contractDropdownRef.current?.contains(targetNode) ?? false;
      const insideSelectorPanel = headerSelectorPanelRef.current?.contains(targetNode) ?? false;

      if (!insideOwnerDropdown && !insideSelectorPanel) {
        setShowOwnersDropdown(false);
      }
      if (!insideContractDropdown && !insideSelectorPanel) {
        setShowContractsDropdown(false);
      }
    };

    if (showOwnersDropdown || showContractsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOwnersDropdown, showContractsDropdown]);

  useEffect(() => {
    if (!showOwnersDropdown && !showContractsDropdown && !showUserMenu) return;
    closeStatusMenus();
  }, [closeStatusMenus, showContractsDropdown, showOwnersDropdown, showUserMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const insideControls = headerStatusControlsRef.current?.contains(targetNode);
      const insidePanel = headerStatusPanelRef.current?.contains(targetNode);
      if (!insideControls && !insidePanel) {
        closeStatusMenus();
      }
    };

    if (openFilterMenu || showHeaderMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [closeStatusMenus, openFilterMenu, showHeaderMenu]);

  useEffect(() => {
    if (!selectedContractId && !draftOverrideId) return;
    closeStatusMenus();
  }, [closeStatusMenus, draftOverrideId, selectedContractId]);

  useEffect(() => {
    if (!showSettingsModal || !user?.uid) return;
    setProfileLoading(true);
    userProfileService.getProfile(user.uid)
      .then(async (profile) => {
        if (profile) {
          setProfileDraft(profile);
          return;
        }

        const baseProfile = {
          uid: user.uid,
          email: user.email || '',
          country: 'Germany'
        };
        setProfileDraft(baseProfile);
        await userProfileService.upsertProfile(baseProfile);
      })
      .catch(() => {
        setProfileDraft({
          uid: user.uid,
          email: user.email || '',
          country: 'Germany'
        });
      })
      .finally(() => setProfileLoading(false));
  }, [showSettingsModal, user?.uid, user?.email]);

  const updateProfileDraft = useCallback((key: keyof UserProfile, value: string) => {
    setProfileDraft((prev) => ({
      ...(prev || { uid: user?.uid || '', email: user?.email || '' }),
      [key]: value
    }));
  }, [user?.uid, user?.email]);

  const handleSaveProfile = useCallback(async () => {
    if (!user?.uid || !profileDraft) return;
    const requiredFields: Array<keyof UserProfile> = ['firstName', 'lastName', 'street', 'postalCode', 'city', 'federalState'];
    const hasMissing = requiredFields.some((field) => !profileDraft[field]);
    if (hasMissing) {
      toast.error(t('orders.settings.requiredFields'));
      return;
    }

    setProfileSaving(true);
    try {
      const payload: Partial<UserProfile> & { uid: string; email: string } = {
        uid: user.uid,
        email: profileDraft.email || user.email || ''
      };
      if (profileDraft.customerNumber) payload.customerNumber = profileDraft.customerNumber;
      if (profileDraft.firstName) payload.firstName = profileDraft.firstName;
      if (profileDraft.lastName) payload.lastName = profileDraft.lastName;
      if (profileDraft.company) payload.company = profileDraft.company;
      if (profileDraft.street) payload.street = profileDraft.street;
      if (profileDraft.postalCode) payload.postalCode = profileDraft.postalCode;
      if (profileDraft.city) payload.city = profileDraft.city;
      if (profileDraft.phone) payload.phone = profileDraft.phone;
      if (profileDraft.country) payload.country = profileDraft.country;
      if (profileDraft.federalState) payload.federalState = profileDraft.federalState;

      await userProfileService.upsertProfile(payload);
      toast.success(t('orders.settings.savedSuccess'));
      setShowSettingsModal(false);
    } catch (error: any) {
      toast.error(t('orders.settings.saveFailed'));
    } finally {
      setProfileSaving(false);
    }
  }, [profileDraft, t, user?.uid, user?.email]);

  const wizardSteps = [
    {
      step: 1,
      label: t('orders.wizard.steps.step1Label'),
      description: t('orders.wizard.steps.step1Desc')
    },
    {
      step: 2,
      label: t('orders.wizard.steps.step2Label'),
      description: t('orders.wizard.steps.step2Desc')
    },
    {
      step: 3,
      label: t('orders.wizard.steps.step3Label'),
      description: t('orders.wizard.steps.step3Desc')
    },
    {
      step: 4,
      label: t('orders.wizard.steps.step4Label'),
      description: t('orders.wizard.steps.step4Desc')
    },
    {
      step: 5,
      label: t('orders.wizard.steps.step5Label'),
      description: t('orders.wizard.steps.step5Desc')
    },
    {
      step: 6,
      label: t('orders.wizard.steps.step6Label'),
      description: t('orders.wizard.steps.step6Desc')
    }
  ];

  const getContinueLabel = useCallback((step: number) => {
    if (step === 1) return t('orders.wizard.continueToStep2');
    if (step === 2) return t('orders.wizard.continueToStep3');
    if (step === 3) return t('orders.wizard.continueToStep4');
    if (step === 4) return t('orders.wizard.continueToStep5');
    if (step === 5) return t('orders.wizard.continueToStep6');
    return '';
  }, [t]);

  const canContinueStep = useMemo(() => {
    if (selectedStep === 1) return stepReadiness.step1Ready;
    if (selectedStep === 2) return stepReadiness.step2Ready;
    if (selectedStep === 3) return stepReadiness.step3Ready;
    if (selectedStep === 4) return stepReadiness.step4Ready;
    if (selectedStep === 5) return stepReadiness.step5Ready;
    return false;
  }, [selectedStep, stepReadiness]);
  const canSubmitStep = useMemo(() => stepReadiness.step6Ready, [stepReadiness.step6Ready]);

  const filterButtons = [
    { key: 'submitted' as const, label: t('orders.filters.submitted') },
    { key: 'in_progress' as const, label: t('orders.filters.inProgress') },
    { key: 'completed' as const, label: t('orders.filters.completed') },
  ];

  const colorClasses: Record<OrderFilter, string> = {
    submitted: 'bg-blue-500/20 border-blue-500/40 text-blue-900 dark:text-blue-100',
    in_progress: 'bg-orange-500/20 border-orange-500/40 text-orange-900 dark:text-orange-100',
    completed: 'bg-green-500/20 border-green-500/40 text-green-900 dark:text-green-100'
  };

  const statusLabels: Record<OrderFilter, string> = {
    submitted: t('orders.filters.submitted'),
    in_progress: t('orders.filters.inProgress'),
    completed: t('orders.filters.completed')
  };

  const confirmationQuips = useMemo(() => ([
    t('orders.humor.confirmationQuips.0'),
    t('orders.humor.confirmationQuips.1'),
    t('orders.humor.confirmationQuips.2'),
    t('orders.humor.confirmationQuips.3'),
    t('orders.humor.confirmationQuips.4')
  ]), [t]);
  const nextConfirmationQuip = useCallback(() => {
    const list = confirmationQuips.length ? confirmationQuips : ['Well, that happened.'];
    const index = confirmationQuipIndexRef.current % list.length;
    confirmationQuipIndexRef.current += 1;
    return list[index];
  }, [confirmationQuips]);

  const userDisplayName = useMemo(() => {
    const firstName = profileDraft?.firstName?.trim() || '';
    const lastName = profileDraft?.lastName?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    const company = profileDraft?.company?.trim();
    if (company) return company;
    const displayName = user?.displayName?.trim();
    if (displayName) return displayName;
    const email = user?.email?.trim() || '';
    return email ? email.split('@')[0] : '';
  }, [profileDraft?.firstName, profileDraft?.lastName, profileDraft?.company, user?.displayName, user?.email]);

  const activeOwnerId = useMemo(() => {
    if (!isAdmin) return user?.uid || null;
    return selectedOwnerId || selectedContract?.clientId || null;
  }, [isAdmin, selectedOwnerId, selectedContract?.clientId, user?.uid]);

  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => {
      const status = contractStatusMap[contract.id] || 'submitted';
      return status === activeFilter;
    });
  }, [contracts, contractStatusMap, activeFilter]);

  const ownerScopedContracts = useMemo(() => {
    if (isAdmin) {
      if (!activeOwnerId) return contracts;
      return contracts.filter((contract) => contract.clientId === activeOwnerId);
    }
    return contracts.filter((contract) => contract.clientId === (user?.uid || ''));
  }, [contracts, activeOwnerId, isAdmin, user?.uid]);

  const contractsDropdownOptions = useMemo(() => {
    if (isAdmin) {
      if (!selectedOwnerId) return contracts;
      return contracts.filter((contract) => contract.clientId === selectedOwnerId);
    }
    const ownerId = user?.uid || '';
    return contracts.filter((contract) => contract.clientId === ownerId);
  }, [contracts, isAdmin, selectedOwnerId, user?.uid]);

  const statusCounts = useMemo(() => {
    return ownerScopedContracts.reduce<Record<OrderFilter, number>>((acc, contract) => {
      const status = contractStatusMap[contract.id] || 'submitted';
      acc[status] += 1;
      return acc;
    }, { submitted: 0, in_progress: 0, completed: 0 });
  }, [ownerScopedContracts, contractStatusMap]);

  const openCompactHeaderSelector = showOwnersDropdown
    ? 'owners'
    : showContractsDropdown
      ? 'contracts'
      : null;

  const openHeaderMenuContracts = useMemo(() => {
    if (!openFilterMenu) return [] as ContractEntry[];
    return ownerScopedContracts.filter(
      (contract) => (contractStatusMap[contract.id] || 'submitted') === openFilterMenu
    );
  }, [contractStatusMap, openFilterMenu, ownerScopedContracts]);

  const handleMarkContractComplete = useCallback(async (contract: ContractEntry) => {
    if (!isAdmin || !contract.clientId) return;
    try {
      const confirmed = await showConfirmation(
        t('orders.markCompleteConfirmTitle'),
        t('orders.markCompleteConfirmMessage', { name: contract.name }) || `Mark "${contract.name}" as completed?`,
        {
          type: 'warning',
          confirmText: t('orders.markComplete'),
          cancelText: t('common.cancel')
        }
      );
      if (!confirmed) return;
      const completedAt = new Date().toISOString();
      const completedBy = user?.uid || null;
      await updateDoc(doc(db, `users/${contract.clientId}/projects/${contract.id}`), {
        status: 'completed',
        completedAt,
        completedBy
      });
      setContracts((prev) => prev.map((entry) => (
        entry.id === contract.id
          ? { ...entry, status: 'completed', completedAt, completedBy: user?.uid }
          : entry
      )));
      setContractStatusMap((prev) => ({ ...prev, [contract.id]: 'completed' }));
      setProjectDataMap((prev) => ({
        ...prev,
        [contract.id]: {
          ...(prev[contract.id] || {}),
          status: 'completed',
          completedAt,
          completedBy
        }
      }));
      toast.success(t('orders.markCompleteSuccess'));
    } catch (error) {
      console.error('Failed to mark contract complete:', error);
      toast.error(t('orders.markCompleteFailed'));
    }
  }, [db, isAdmin, user?.uid, t, showConfirmation]);

  const handleMarkContractInProgress = useCallback(async (contract: ContractEntry) => {
    if (!isAdmin || !contract.clientId) return;
    try {
      const confirmed = await showConfirmation(
        t('orders.markInProgressConfirmTitle'),
        t('orders.markInProgressConfirmMessage', { name: contract.name }) || `Move "${contract.name}" back to in progress?`,
        {
          type: 'warning',
          confirmText: t('orders.markInProgress'),
          cancelText: t('common.cancel')
        }
      );
      if (!confirmed) return;
      console.log('🔄 Updating contract status to in_progress:', contract.id);
      await updateDoc(doc(db, `users/${contract.clientId}/projects/${contract.id}`), {
        status: 'in_progress',
        completedAt: deleteField(),
        completedBy: deleteField()
      });
      console.log('✅ Firebase updated successfully');
      setContracts((prev) => prev.map((entry) => {
        if (entry.id === contract.id) {
          const updated = { ...entry, status: 'in_progress' };
          delete updated.completedAt;
          delete updated.completedBy;
          return updated;
        }
        return entry;
      }));
      setContractStatusMap((prev) => ({ ...prev, [contract.id]: 'in_progress' }));
      setProjectDataMap((prev) => {
        const updated = { ...(prev[contract.id] || {}), status: 'in_progress' };
        delete updated.completedAt;
        delete updated.completedBy;
        return { ...prev, [contract.id]: updated };
      });
      toast.success(t('orders.markInProgressSuccess'));
    } catch (error) {
      console.error('Failed to mark contract in progress:', error);
      toast.error(t('orders.markInProgressFailed'));
    }
  }, [db, isAdmin, t, showConfirmation]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!selectedOwnerId || !selectedContractId) return;
    const contract = contracts.find((entry) => entry.id === selectedContractId);
    if (contract?.clientId && contract.clientId !== selectedOwnerId) {
      setSelectedContractId(null);
      setUploadedFields([]);
      setTracks([]);
    }
  }, [isAdmin, selectedOwnerId, selectedContractId, contracts]);

  // Compute field summaries from stored project data when a contract is selected
  // This ensures badges show even when the wizard isn't mounted
  useEffect(() => {
    if (!selectedContractId) {
      setFieldSummaries({});
      return;
    }
    // If wizard is active, it will compute summaries via onFieldSummariesChange
    if (showStepModal) return;

    const data = projectDataMap[selectedContractId];
    const persistedSummaries = data?.fieldSummaries;
    if ((!data?.fields?.length) && persistedSummaries && typeof persistedSummaries === 'object') {
      const normalized: Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }> = {};
      Object.entries(persistedSummaries as Record<string, any>).forEach(([key, entry]) => {
        if (!key || !entry || typeof entry !== 'object') return;
        const rawStatus = String((entry as any).status || 'mixed');
        const status: 'pending' | 'completed' | 'skipped' | 'mixed' = (
          rawStatus === 'pending' || rawStatus === 'completed' || rawStatus === 'skipped' || rawStatus === 'mixed'
            ? rawStatus
            : 'mixed'
        );
        normalized[key] = {
          status,
          badges: Array.isArray((entry as any).badges) ? (entry as any).badges.filter((item: any) => typeof item === 'string') : [],
          services: Array.isArray((entry as any).services) ? (entry as any).services.filter((item: any) => typeof item === 'string') : []
        };
      });
      setFieldSummaries(normalized);
      return;
    }

    if (!data?.fields?.length) {
      setFieldSummaries({});
      return;
    }

    const summaryMap: Record<string, { statuses: Array<string>; badges: Set<string>; services: Set<string> }> = {};
    const globalParams = data.parameters;
    const globalServices: string[] = data.serviceSelection?.services || [];

    const resolveParameterBadges = (params: any) => {
      if (!params) return [] as string[];
      const badges: string[] = [];
      if (params.landUseType) badges.push(`LU ${params.landUseType}`);
      if (params.traceElements) badges.push('Trace');
      if (params.organicMatter) badges.push('OM');
      if (params.cnRatio) badges.push('C/N');
      if (params.potassiumFixation) badges.push('K Fix');
      if (params.calcium) badges.push('Ca');
      if (params.cecEffective) badges.push('CEC eff');
      if (params.cecPotential) badges.push('CEC pot');
      if (params.particleSizeDistribution) badges.push('PSD');
      if (params.phosphorusReleaseRate) badges.push('P rel');
      return badges;
    };

    const resolveServiceLabels = (services: string[]) =>
      services.map((s: string) => {
        if (s === 'basic_nutrients') return t('orders.wizard.serviceBasic');
        if (s === 'nmin') return t('orders.wizard.serviceNmin');
        if (s === 'nematodes') return t('orders.wizard.serviceNematodes');
        return s;
      });

    (data.fields as any[]).forEach((field: any) => {
      const key = field.baseId || field.baseName || field.fieldId;
      if (!key) return;
      if (!summaryMap[key]) {
        summaryMap[key] = { statuses: [], badges: new Set(), services: new Set() };
      }
      summaryMap[key].statuses.push(field.status || 'pending');
      const params = field.parameters || globalParams;
      resolveParameterBadges(params).forEach((b: string) => summaryMap[key].badges.add(b));
      const services = field.services?.length ? field.services : globalServices;
      resolveServiceLabels(services).forEach((l: string) => summaryMap[key].services.add(l));
    });

    const summaries: Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }> = {};
    Object.entries(summaryMap).forEach(([key, entry]) => {
      const statuses = entry.statuses;
      const allCompleted = statuses.every((s) => s === 'completed');
      const allSkipped = statuses.every((s) => s === 'skipped');
      const allPending = statuses.every((s) => s === 'pending');
      let status: 'pending' | 'completed' | 'skipped' | 'mixed' = 'mixed';
      if (allCompleted) status = 'completed';
      else if (allSkipped) status = 'skipped';
      else if (allPending) status = 'pending';
      summaries[key] = {
        status,
        badges: Array.from(entry.badges),
        services: Array.from(entry.services)
      };
    });

    setFieldSummaries(summaries);
  }, [selectedContractId, projectDataMap, showStepModal, t]);

  const showRightSidebar = Boolean(
    !showStepModal || selectedStep === 4 || selectedStep === 5
  );

  const mapFieldBoundaries = useMemo(() => {
    const visibleFields = activeOwnerId
      ? allContractFields.filter((field) => field.clientId === activeOwnerId)
      : allContractFields;

    const contractBoundaries = visibleFields.map((field) => {
      const isActive = Boolean(selectedContractId && field.projectId === selectedContractId);
      return {
        id: field.firestoreId || field.baseId,
        name: field.baseName,
        project_id: field.projectId,
        geometry_type: field.geometry.type,
        coordinates: field.geometry.coordinates,
        color: field.color ?? '#3B82F6',
        properties: {
          baseId: field.baseId,
          areaHa: field.areaHa,
          isActive,
          showLabel: isActive
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    if (!uploadedFields.length || !showStepModal) {
      return contractBoundaries;
    }

    const uploadedKeys = new Set(
      uploadedFields
        .map((field) => (field.baseId || field.baseName || '').trim().toLowerCase())
        .filter((value) => value.length > 0)
    );

    const filteredContracts = uploadedKeys.size
      ? contractBoundaries.filter((field) => {
          const key = String(field.properties?.baseId || field.name || '').trim().toLowerCase();
          return !uploadedKeys.has(key);
        })
      : contractBoundaries;

    const uploadedBoundaries = uploadedFields.map((field, index) => ({
      id: field.firestoreId || (index + 1),
      name: field.baseName,
      project_id: draftOverrideId || selectedContractId || 'draft',
      geometry_type: field.geometry.type,
      coordinates: field.geometry.coordinates,
      color: field.color ?? '#3B82F6',
      properties: {
        baseId: field.baseId,
        areaHa: field.areaHa,
        isActive: true,
        showLabel: true
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    return [...filteredContracts, ...uploadedBoundaries];
  }, [activeOwnerId, allContractFields, selectedContractId, uploadedFields, draftOverrideId, showStepModal]);

  const selectedBoundaryIds = useMemo(() => (
    selectedFieldKeys
      .map(key => combinedFields.find(field => field.key === key))
      .filter((field): field is typeof combinedFields[number] => Boolean(field && field.source === 'uploaded'))
      .map(field => field.boundaryId)
  ), [selectedFieldKeys, combinedFields]);

  const selectedDrawnIds = useMemo(() => (
    selectedFieldKeys
      .filter(key => key.startsWith('d-'))
      .map(key => key.replace('d-', ''))
  ), [selectedFieldKeys]);

  const canMapEdit = isAdmin || showStepModal || Boolean(draftOverrideId);
  const showCompactFieldPanel = showRightSidebar && combinedFields.length > 0;
  const showCompactFieldPanelExpanded = showCompactFieldPanel && !compactFieldPanelCollapsed;
  const compactFieldStepActive = showCompactFieldPanelExpanded && showStepModal && (selectedStep === 4 || selectedStep === 5);
  const wizardContentMaxHeightClass = compactFieldStepActive
    ? 'max-h-[17.5rem] sm:max-h-[19.5rem] lg:max-h-[19rem] xl:max-h-[calc(100vh-19rem)]'
    : showCompactFieldPanelExpanded
      ? 'max-h-[38vh] sm:max-h-[42vh] lg:max-h-[42vh] xl:max-h-[calc(100vh-19rem)]'
      : 'max-h-[calc(100vh-10.5rem)] sm:max-h-[calc(100vh-11.25rem)] xl:max-h-[calc(100vh-19rem)]';
  const wizardContentMaxHeightStyle = useMemo(() => {
    if (!viewportHeightPx) return undefined;

    if (compactFieldStepActive) {
      return { maxHeight: '17.5rem' };
    }

    if (showCompactFieldPanelExpanded) {
      return { maxHeight: `${Math.max(260, Math.round(viewportHeightPx * 0.38))}px` };
    }

    return { maxHeight: `${Math.max(280, viewportHeightPx - 168)}px` };
  }, [viewportHeightPx, compactFieldStepActive, showCompactFieldPanelExpanded]);
  const compactFieldPanelHeightClass = showStepModal
    ? 'h-[7.75rem] sm:h-[8rem] lg:h-[8.5rem]'
    : 'h-[8rem] sm:h-[8.25rem] lg:h-[8.75rem]';

  useEffect(() => {
    if (!showCompactFieldPanel) {
      setCompactFieldPanelCollapsed(false);
    }
  }, [showCompactFieldPanel]);

  const renderFieldCards = useCallback((includeRefs: boolean, compact = false) => (
    combinedFields.map((field) => (
      <div
        key={field.key}
        onClick={(event) => {
          const isMulti = event.ctrlKey || event.metaKey;
          selectFieldKey(field.key, isMulti);
          if (field.source === 'uploaded') {
            setFocusedBoundaryId(field.boundaryId);
            setFocusedDrawnFieldId(null);
          } else {
            setFocusedDrawnFieldId(field.drawnId);
            setFocusedBoundaryId(null);
          }
          if (showStepModal && (selectedStep === 4 || selectedStep === 5)) {
            const baseId = field.baseId || field.baseName;
            if (baseId) {
              setMapSelectionEvent({ baseId, ctrlKey: isMulti, timestamp: Date.now() });
            }
          }
        }}
        ref={includeRefs ? ((el) => {
          fieldItemRefs.current[field.key] = el;
        }) : undefined}
        className={`${compact ? 'h-auto min-h-full min-w-[11.5rem] max-w-[11.5rem] sm:min-w-[12.5rem] sm:max-w-[12.5rem] p-1.5 sm:p-2 snap-start overflow-hidden' : 'p-3'} rounded-lg border cursor-pointer transition-all ${
          selectedFieldKeys.includes(field.key)
            ? 'bg-blue-500/20 dark:bg-blue-500/30 border-blue-500/40 ring-1 ring-blue-500/50'
            : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/50 dark:border-gray-700/50 hover:bg-white dark:hover:bg-gray-800'
        }`}
      >
        {(() => {
          const summaryKey = field.baseId || field.baseName;
          const summary = summaryKey ? fieldSummaries[summaryKey] : undefined;
          const summaryStatus = summary?.status;
          const sampleCount = field.source === 'uploaded'
            ? (fieldSampleCountByBoundaryId[String(field.boundaryId)] || 0)
            : 0;
          const status: 'pending' | 'completed' | 'skipped' | 'mixed' | undefined =
            field.source === 'uploaded'
              ? (
                sampleCount > fieldCompletionSampleThreshold
                  ? 'completed'
                  : (summaryStatus === 'skipped' ? 'skipped' : 'pending')
              )
              : summaryStatus;
          const landUseBadge = summary?.badges?.find((badge) => badge.startsWith('LU '));
          const landUseValue = landUseBadge ? landUseBadge.slice(3).trim() : '';
          const otherBadges = summary?.badges?.filter((badge) => badge !== landUseBadge) || [];
          return (
            <div className={`${compact ? 'mb-0.5 space-y-0.5' : 'mb-2 space-y-2'}`}>
              {status && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} uppercase tracking-wide text-gray-500 dark:text-gray-400`}>{t('orders.statusLabel')}</span>
                  <span
                    className={`${compact ? 'text-[9px] px-1.5' : 'text-[11px] px-2'} py-0.5 rounded-full font-semibold ${
                      status === 'completed'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : status === 'skipped'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                        : status === 'pending'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {t(`orders.status.${status}`, { defaultValue: status })}
                  </span>
                  {landUseValue && (
                    <span className={`${compact ? 'text-[9px] px-1.5' : 'text-[11px] px-2'} py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200`}>
                      {t('orders.landUseBadge', { value: landUseValue }) || `Land use ${landUseValue}`}
                    </span>
                  )}
                </div>
              )}
              {(((summary?.services?.length ?? 0) > 0) || otherBadges.length > 0) && (
                <div className="flex flex-wrap items-center gap-1">
                  {summary?.services?.map((label) => (
                    <span
                      key={`${field.key}-${label}`}
                      className={`${compact ? 'text-[8px] px-1.5' : 'text-[10px] px-2'} py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200`}
                    >
                      {label}
                    </span>
                  ))}
                  {otherBadges.map((badge) => (
                    <span
                      key={`${field.key}-${badge}`}
                      className={`${compact ? 'text-[9px] px-1.5' : 'text-[11px] px-2'} py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200`}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div className={`flex items-start ${compact ? 'gap-1.5' : 'gap-2'}`}>
          <div
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} rounded border-2 border-white flex-shrink-0 mt-0.5`}
            style={{
              backgroundColor: field.source === 'uploaded' && (fieldSampleCountByBoundaryId[String(field.boundaryId)] || 0) > 0
                ? '#FF1493'
                : (field.color ?? '#3B82F6')
            }}
          />
          <div className="flex-1 min-w-0">
            <div className={`${compact ? 'text-[11px] sm:text-[12px] leading-4' : 'text-sm'} font-medium text-gray-900 dark:text-white truncate`}>
              {field.baseName}
            </div>
            <div className={`${compact ? 'text-[8px] sm:text-[9px] leading-3.5' : 'text-xs'} text-gray-600 dark:text-gray-400 space-y-0`}>
              <div>{t('orders.fieldIdLabel', { id: field.baseId }) || `ID: ${field.baseId}`}</div>
              <div>{t('orders.fieldAreaLabel', { area: field.areaHa }) || `Area: ${field.areaHa} ha`}</div>
              {field.source === 'uploaded' && (
                <div className={`${compact ? 'text-[9px] sm:text-[10px]' : 'text-xs'} font-semibold ${(fieldSampleCountByBoundaryId[String(field.boundaryId)] || 0) > 0 ? 'text-pink-600 dark:text-pink-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {fieldSampleCountByBoundaryId[String(field.boundaryId)] || 0} samples
                </div>
              )}
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                openFieldDetails(field.key);
              }}
              title={t('common.edit')}
              aria-label={t('common.edit')}
              className={compact
                ? 'ml-auto flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-gray-200/60 dark:border-gray-700/60 bg-white/90 dark:bg-gray-900/85 text-blue-700 dark:text-blue-200 shadow-sm transition-colors hover:bg-white dark:hover:bg-gray-900 touch-manipulation shrink-0'
                : 'ml-auto rounded-lg border border-gray-200/50 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/80 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-200 shadow-sm hover:bg-white dark:hover:bg-gray-900'
              }
            >
              {compact ? <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : t('common.edit')}
            </button>
          )}
        </div>
      </div>
    ))
  ), [
    combinedFields,
    fieldCompletionSampleThreshold,
    fieldSampleCountByBoundaryId,
    fieldSummaries,
    isAdmin,
    openFieldDetails,
    selectFieldKey,
    selectedFieldKeys,
    selectedStep,
    showStepModal,
    t,
  ]);

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div
        className="mobile-web-safe-shell relative bg-gray-50 dark:bg-gray-900"
        style={viewportHeightPx ? { minHeight: `${viewportHeightPx}px`, height: `${viewportHeightPx}px` } : undefined}
      >
        {/* Map view - full screen */}
        <div className="absolute inset-0">
          {/* Debug: Log what we're sending to the map */}
          {mapFieldBoundaries.length > 0 && tracks.length > 0 && console.log('DEBUG MAP DATA:', {
            firstFieldId: mapFieldBoundaries[0].id,
            firstTrackFieldBoundaryId: tracks[0].field_boundary_id,
            fieldsCount: mapFieldBoundaries.length,
            tracksCount: tracks.length
          })}
          <OrdersMapView
            currentPosition={null}
            tracks={tracks}
            fieldBoundaries={mapFieldBoundaries}
            drawnFields={previewDrawnFields.map((field) => ({ id: field.id, geometry: field.geometry, color: field.color, baseName: field.baseName, baseId: field.baseId, areaHa: field.areaHa }))}
            focusedBoundaryId={focusedBoundaryId}
            focusedDrawnFieldId={focusedDrawnFieldId}
            selectedBoundaryIds={selectedBoundaryIds}
            selectedDrawnIds={selectedDrawnIds}
            gridOverlayEnabled={showStepModal && selectedStep === 4 && gridPreviewEnabled}
            gridOverlaySizeHa={gridPreviewSizeHa}
            layoutSyncToken={mapLayoutSyncToken}
            disableSelectionFocus={showStepModal && selectedStep === 5}
            isTracking={false}
            isSidebarCollapsed={false}
            onFieldClick={(fieldId, source, multiSelect) => {
              const isMulti = Boolean(multiSelect);
              if (source === 'drawn') {
                selectFieldKey(`d-${fieldId}`, isMulti);
                const drawn = previewDrawnFields.find((field) => field.id === String(fieldId));
                const baseId = drawn?.baseId;
                if (baseId) {
                  setMapSelectionEvent({ baseId, ctrlKey: isMulti, timestamp: Date.now() });
                }
              } else {
                selectFieldKey(`u-${fieldId}`, isMulti);
                const boundary = mapFieldBoundaries.find((item) => String(item.id) === String(fieldId));
                const baseId = boundary?.properties?.baseId || boundary?.name;
                if (baseId) {
                  setMapSelectionEvent({ baseId, ctrlKey: isMulti, timestamp: Date.now() });
                }
              }
            }}
            onMapClick={handleMapBackgroundClick}
            onFieldEditRequest={handleFieldEditRequest}
            onFieldShapeAction={handleFieldShapeAction}
            disableHoverEditPopup={fieldDetailsOpen || !canMapEdit}
            drawingMode={drawingMode}
            onDrawingComplete={({ id, geometry }) => {
              const simplifiedGeometry = simplifyGeometryForStorage(geometry as any, 1200);
              const areaHa = Number((area({ type: 'Feature', geometry: simplifiedGeometry as any, properties: {} }) / 10000).toFixed(2));
              
              // If we have a backup field (from recreate mode), use its metadata
              if (editingFieldBackup) {
                const recreatedField: DrawnField = {
                  id,
                  baseId: editingFieldBackup.baseId,
                  baseName: editingFieldBackup.baseName,
                  areaHa,
                  geometry: simplifiedGeometry,
                  color: editingFieldBackup.color ?? '#3B82F6'
                };
                if (editingFieldSourceRef.current === 'draft') {
                  setDraftDrawnFields((prev) => [...prev, recreatedField]);
                } else {
                  setDrawnFields((prev) => [...prev, recreatedField]);
                }
                setDrawingMode(null);
                setEditingFieldBackup(null);
                editingFieldSourceRef.current = null;
                return;
              }
              
              // Otherwise create a new field with default values
              setDraftDrawnFields((prev) => {
                const nextIndex = drawnFieldsCountRef.current + prev.length + 1;
                const nextField: DrawnField = {
                  id,
                  baseId: `D${nextIndex}`,
                  baseName: t('orders.drawnFieldDefaultName', { index: nextIndex }) || `Drawn Field ${nextIndex}`,
                  areaHa,
                  geometry: simplifiedGeometry,
                  color: '#3B82F6'
                };
                return [...prev, nextField];
              });
            }}
            onDrawingEdited={({ id, geometry }) => {
              const simplifiedGeometry = simplifyGeometryForStorage(geometry as any, 1200);
              const nextAreaHa = Number((area({ type: 'Feature', geometry: simplifiedGeometry as any, properties: {} }) / 10000).toFixed(2));
              setDrawnFields((prev) => prev.map((field) => (field.id === id ? { ...field, geometry: simplifiedGeometry, areaHa: nextAreaHa } : field)));
              setDraftDrawnFields((prev) => prev.map((field) => (field.id === id ? { ...field, geometry: simplifiedGeometry, areaHa: nextAreaHa } : field)));
            }}
            onDrawingDeleted={(ids) => {
              if (!ids.length) return;
              const idSet = new Set(ids);
              setDrawnFields((prev) => prev.filter((field) => !idSet.has(field.id)));
              setDraftDrawnFields((prev) => prev.filter((field) => !idSet.has(field.id)));
            }}
          />
        </div>

        {/* Header with filter buttons - overlay */}
        <header className="absolute top-3 left-3 right-3 sm:top-4 sm:left-4 sm:right-4 rounded-xl shadow-2xl overflow-visible backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50 z-[5002]">
          <div className="px-3 sm:px-4 h-14 sm:h-16 flex items-center">
            <div className="flex items-center justify-between gap-2 sm:gap-4 w-full min-w-0">
              {/* Left side - App icon and controls */}
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <a
                  href="https://www.techbyp.com"
                  target="_blank"
                  rel="noreferrer"
                  className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/80 shadow-sm flex items-center justify-center overflow-hidden shrink-0"
                  aria-label="Techbyp"
                >
                  <img src="/app-logo.png" alt="Techbyp" className="h-8 w-8 sm:h-9 sm:w-9 object-contain" />
                </a>
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={handleNewOrder}
                    className="glass-panel glass-panel-light dark:glass-panel-dark h-10 w-10 lg:w-auto lg:px-4 rounded-xl text-sm font-semibold text-gray-900 dark:text-white hover:bg-blue-600/20 dark:hover:bg-blue-500/20 transition-all flex items-center justify-center gap-2 shrink-0"
                    title={t('orders.newContract')}
                    aria-label={t('orders.newContract')}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden lg:inline">{t('orders.newContract')}</span>
                  </button>
                  
                  {isAdmin && userOptions.length > 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/70 px-1.5 sm:px-2 py-1 min-w-0">
                      {/* Users dropdown */}
                      <div className="relative" ref={ownerDropdownRef}>
                        <button
                          onClick={() => {
                            setShowOwnersDropdown((prev) => !prev);
                            setShowContractsDropdown(false);
                          }}
                          className="glass-panel glass-panel-light dark:glass-panel-dark h-10 w-10 xl:w-auto xl:max-w-[12rem] xl:px-4 rounded-xl text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-600/20 dark:hover:bg-gray-500/20 transition-all flex items-center justify-center xl:justify-start gap-2 shrink-0"
                          title={selectedOwnerButtonLabel}
                          aria-label={selectedOwnerButtonLabel}
                        >
                          <User className="w-4 h-4 xl:hidden" />
                          <span className="hidden xl:inline truncate">{selectedOwnerButtonLabel}</span>
                          <ChevronDown className="hidden xl:block w-4 h-4 shrink-0" />
                        </button>

                        {showOwnersDropdown && (
                          <div className="hidden xl:block absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                            {userOptions.map((option) => (
                              <div
                                key={option.id}
                                className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                              >
                                <button
                                  onClick={() => {
                                    setSelectedOwnerId(option.id || null);
                                    setShowOwnersDropdown(false);
                                  }}
                                  className="w-full text-left text-sm text-gray-900 dark:text-white truncate"
                                  title={`${option.label}${option.id && option.id === user?.uid ? ` ${t('orders.userYou')}` : ''}`}
                                >
                                  {option.label}{option.id && option.id === user?.uid ? ` ${t('orders.userYou')}` : ''}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Contracts dropdown */}
                      <div className="relative" ref={contractDropdownRef}>
                        <button
                          onClick={() => {
                            setShowContractsDropdown(!showContractsDropdown);
                            setShowOwnersDropdown(false);
                          }}
                          className="glass-panel glass-panel-light dark:glass-panel-dark h-10 w-10 xl:w-auto xl:max-w-[14rem] xl:px-4 rounded-xl text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-600/20 dark:hover:bg-gray-500/20 transition-all flex items-center justify-center xl:justify-start gap-2 min-w-0 shrink-0"
                          title={selectedContractButtonLabel}
                          aria-label={selectedContractButtonLabel}
                        >
                          <FileText className="w-4 h-4 xl:hidden" />
                          <span className="hidden xl:inline truncate">{selectedContractButtonLabel}</span>
                          <ChevronDown className="hidden xl:block w-4 h-4 shrink-0" />
                        </button>
                        
                        {showContractsDropdown && (
                          <div className="hidden xl:block absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-max">
                            {contractsLoading ? (
                              <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
                            ) : contractsDropdownOptions.length > 0 ? (
                              contractsDropdownOptions.map((contract) => (
                                <div
                                  key={contract.id}
                                  className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  <button
                                    onClick={() => {
                                      setSelectedContractId(contract.id);
                                      setDraftOverrideId(null);
                                      setDraftOverrideName(null);
                                      setShowContractsDropdown(false);
                                      if (isAdmin && contract.clientId) {
                                        setSelectedOwnerId(contract.clientId);
                                      }
                                    }}
                                    className="flex-1 text-left text-sm text-gray-900 dark:text-white"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span>{contract.name}</span>
                                      {isAdmin && !selectedOwnerId && contract.clientId && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          ({ownerLabelById.get(contract.clientId) || contract.clientId})
                                        </span>
                                      )}
                                      <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        {statusLabels[contractStatusMap[contract.id] || 'submitted']}
                                      </span>
                                    </div>
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setShowContractsDropdown(false);
                                      handleDeleteContract(contract);
                                    }}
                                    className="p-2 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50/60 dark:hover:bg-red-900/20"
                                    title={t('orders.deleteContract')}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t('orders.noContracts')}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="relative" ref={contractDropdownRef}>
                      <button
                        onClick={() => {
                          setShowContractsDropdown(!showContractsDropdown);
                          setShowOwnersDropdown(false);
                        }}
                        className="glass-panel glass-panel-light dark:glass-panel-dark h-10 w-10 xl:w-auto xl:max-w-[14rem] xl:px-4 rounded-xl text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-600/20 dark:hover:bg-gray-500/20 transition-all flex items-center justify-center xl:justify-start gap-2 min-w-0 shrink-0"
                        title={selectedContractButtonLabel}
                        aria-label={selectedContractButtonLabel}
                      >
                        <FileText className="w-4 h-4 xl:hidden" />
                        <span className="hidden xl:inline truncate">{selectedContractButtonLabel}</span>
                        <ChevronDown className="hidden xl:block w-4 h-4 shrink-0" />
                      </button>
                      
                      {showContractsDropdown && (
                        <div className="hidden xl:block absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-max">
                          {contractsLoading ? (
                            <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
                          ) : contractsDropdownOptions.length > 0 ? (
                            contractsDropdownOptions.map((contract) => (
                              <div
                                key={contract.id}
                                className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                              >
                                <button
                                  onClick={() => {
                                    setSelectedContractId(contract.id);
                                    setDraftOverrideId(null);
                                    setDraftOverrideName(null);
                                    setShowContractsDropdown(false);
                                  }}
                                  className="flex-1 text-left text-sm text-gray-900 dark:text-white"
                                >
                                  <div className="flex items-center gap-2">
                                    <span>{contract.name}</span>
                                    {isAdmin && !selectedOwnerId && contract.clientId && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        ({ownerLabelById.get(contract.clientId) || contract.clientId})
                                      </span>
                                    )}
                                    <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                      {statusLabels[contractStatusMap[contract.id] || 'submitted']}
                                    </span>
                                  </div>
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setShowContractsDropdown(false);
                                    handleDeleteContract(contract);
                                  }}
                                  className="p-2 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50/60 dark:hover:bg-red-900/20"
                                  title={t('orders.deleteContract')}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t('orders.noContracts')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right side - Filter buttons and User menu */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0" ref={headerStatusControlsRef}>
                <div className="header-status-filters flex-wrap gap-2 justify-end">
                  {filterButtons.map(({ key, label }) => {
                    const isActive = activeFilter === key;
                    const contractsForStatus = ownerScopedContracts.filter((contract) => (contractStatusMap[contract.id] || 'submitted') === key);
                    return (
                      <div key={key} className="relative">
                        <button
                          onClick={() => {
                            setActiveFilter(key);
                            setOpenFilterMenu((prev) => (prev === key ? null : key));
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border inline-flex items-center gap-2 ${colorClasses[key]} ${
                            isActive
                              ? 'opacity-100 scale-105'
                              : 'opacity-70 hover:opacity-90'
                          }`}
                        >
                          <span>{label}</span>
                          <span className="min-w-[1.5rem] text-center rounded-full bg-white/70 dark:bg-gray-900/60 px-1.5 py-0.5 text-[10px] font-semibold">
                            {statusCounts[key] || 0}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openFilterMenu === key ? 'rotate-180' : ''}`} />
                        </button>
                        {openFilterMenu === key && (
                          <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-[16rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-[5001] overflow-hidden">
                            {contractsForStatus.length === 0 ? (
                              <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                                {t('orders.noContractsInStatus')}
                              </div>
                            ) : (
                              contractsForStatus.map((contract) => (
                                <div key={contract.id} className="flex min-w-0 items-center justify-between gap-2 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800">
                                  <button
                                    onClick={() => handleSelectContract(contract)}
                                    className="min-w-0 flex-1 text-left text-xs text-gray-900 dark:text-white"
                                  >
                                    <div className="font-semibold truncate">{contract.name}</div>
                                    <div className="truncate text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                      {statusLabels[contractStatusMap[contract.id] || 'submitted']}
                                    </div>
                                  </button>
                                  {isAdmin && (contractStatusMap[contract.id] || 'submitted') !== 'completed' && (
                                    <button
                                      onClick={() => handleMarkContractComplete(contract)}
                                      className="shrink-0 text-[10px] uppercase tracking-wide text-green-700 dark:text-green-300 hover:text-green-800"
                                    >
                                      {t('orders.markComplete')}
                                    </button>
                                  )}
                                  {isAdmin && (contractStatusMap[contract.id] || 'submitted') === 'completed' && (
                                    <button
                                      onClick={() => handleMarkContractInProgress(contract)}
                                      className="shrink-0 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 hover:text-amber-800"
                                    >
                                      {t('orders.markInProgress')}
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const next = !showHeaderMenu;
                      setShowHeaderMenu(next);
                      setOpenFilterMenu(null);
                      setShowUserMenu(false);
                      setShowOwnersDropdown(false);
                      setShowContractsDropdown(false);
                    }}
                    className="header-status-burger glass-panel glass-panel-light dark:glass-panel-dark items-center justify-center w-10 h-10 rounded-xl text-gray-900 dark:text-white hover:bg-gray-200/20 dark:hover:bg-gray-700/20 transition-all"
                    title={t('common.menu')}
                    aria-expanded={showHeaderMenu}
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => navigate('/admin')}
                      className="glass-panel glass-panel-light dark:glass-panel-dark flex items-center justify-center w-10 h-10 rounded-xl text-emerald-700 dark:text-emerald-200 hover:bg-emerald-600/20 dark:hover:bg-emerald-500/20 transition-all"
                      title={t('admin.controls')}
                    >
                      <ShieldCheck className="w-5 h-5" />
                    </button>
                  )}
                  <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => {
                      const next = !showUserMenu;
                      if (next) {
                        closeStatusMenus();
                      }
                      setShowUserMenu(next);
                    }}
                    className="glass-panel glass-panel-light dark:glass-panel-dark flex items-center justify-center w-10 h-10 rounded-xl text-gray-900 dark:text-white hover:bg-gray-200/20 dark:hover:bg-gray-700/20 transition-all"
                    title={user?.email || (t('orders.userMenu'))}
                  >
                    <User className="w-5 h-5" />
                  </button>

                  {/* User dropdown menu */}
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-1rem))] sm:w-64 max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain rounded-xl shadow-xl backdrop-blur-2xl bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50 z-[5001]">
                      <div className="px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50">
                        <div className="text-sm font-extrabold uppercase tracking-[0.2em] text-white">
                          {userDisplayName}
                        </div>
                        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {user?.email}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {isAdmin
                            ? (t('orders.userRoleAdminPrivileges'))
                            : (t('orders.userRoleUser'))}
                        </div>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => {
                            setShowUserMenu(false);
                            setShowSettingsModal(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          {t('common.settings')}
                        </button>
                        <div className="px-4 py-3 border-t border-gray-200/50 dark:border-gray-700/50">
                          <div className="space-y-3">
                            <div>
                              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                                {t('orders.dropdown.language')}
                              </div>
                              <select
                                value={language}
                                onChange={(event) => changeLanguage(event.target.value)}
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100"
                              >
                                <option value="en">{t('orders.dropdown.languageEnglish')}</option>
                                <option value="de">{t('orders.dropdown.languageGerman')}</option>
                              </select>
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                                {t('orders.dropdown.theme')}
                              </div>
                              <select
                                value={isDarkMode ? 'dark' : 'light'}
                                onChange={(event) => {
                                  const next = event.target.value === 'dark';
                                  if (next !== isDarkMode) {
                                    toggleDarkMode();
                                  }
                                }}
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100"
                              >
                                <option value="light">{t('orders.dropdown.themeLight')}</option>
                                <option value="dark">{t('orders.dropdown.themeDark')}</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          {t('auth.signOut')}
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {openCompactHeaderSelector && (
            <div ref={headerSelectorPanelRef} className="xl:hidden absolute top-full left-4 right-4 mt-2 z-[5001]">
              <div className="flex justify-center">
                <div className="w-full max-w-[18rem] rounded-xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50">
                  {openCompactHeaderSelector === 'owners' ? (
                    <div className="max-h-[min(18rem,55vh)] overflow-y-auto py-1.5">
                      {userOptions.map((option) => (
                        <div
                          key={option.id}
                          className="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <button
                            onClick={() => {
                              setSelectedOwnerId(option.id || null);
                              setShowOwnersDropdown(false);
                            }}
                            className="w-full rounded-lg px-2 py-2 text-left text-sm text-gray-900 dark:text-white truncate"
                            title={`${option.label}${option.id && option.id === user?.uid ? ` ${t('orders.userYou')}` : ''}`}
                          >
                            {option.label}{option.id && option.id === user?.uid ? ` ${t('orders.userYou')}` : ''}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-[min(20rem,60vh)] overflow-y-auto py-1.5">
                      {contractsLoading ? (
                        <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
                      ) : contractsDropdownOptions.length > 0 ? (
                        contractsDropdownOptions.map((contract) => (
                          <div
                            key={contract.id}
                            className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <button
                              onClick={() => {
                                setSelectedContractId(contract.id);
                                setDraftOverrideId(null);
                                setDraftOverrideName(null);
                                setShowContractsDropdown(false);
                                if (isAdmin && contract.clientId) {
                                  setSelectedOwnerId(contract.clientId);
                                }
                              }}
                              className="min-w-0 flex-1 text-left text-sm text-gray-900 dark:text-white"
                            >
                              <div className="truncate font-medium">{contract.name}</div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {isAdmin && !selectedOwnerId && contract.clientId && (
                                  <span className="text-xs normal-case tracking-normal">
                                    {ownerLabelById.get(contract.clientId) || contract.clientId}
                                  </span>
                                )}
                                <span>{statusLabels[contractStatusMap[contract.id] || 'submitted']}</span>
                              </div>
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setShowContractsDropdown(false);
                                handleDeleteContract(contract);
                              }}
                              className="shrink-0 p-2 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50/60 dark:hover:bg-red-900/20"
                              title={t('orders.deleteContract')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{t('orders.noContracts')}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {showHeaderMenu && (
            <div ref={headerStatusPanelRef} className="header-status-burger-panel absolute top-full left-4 right-4 mt-2 rounded-xl shadow-2xl overflow-visible backdrop-blur-2xl bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50 z-[5001]">
              <div className="p-3 flex flex-col gap-3">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                  {filterButtons.map(({ key, label }) => {
                    const isActive = activeFilter === key;
                    return (
                      <div key={key}>
                        <button
                          onClick={() => {
                            setActiveFilter(key);
                            setOpenFilterMenu((prev) => (prev === key ? null : key));
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border inline-flex items-center gap-2 ${colorClasses[key]} ${
                            isActive
                              ? 'opacity-100 scale-105'
                              : 'opacity-70 hover:opacity-90'
                          }`}
                        >
                          <span>{label}</span>
                          <span className="min-w-[1.5rem] text-center rounded-full bg-white/70 dark:bg-gray-900/60 px-1.5 py-0.5 text-[10px] font-semibold">
                            {statusCounts[key] || 0}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openFilterMenu === key ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                  </div>
                  {openFilterMenu && (
                    <div className="w-full flex justify-center">
                      <div className="w-full max-w-[16rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-[5001] overflow-hidden">
                        {openHeaderMenuContracts.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                            {t('orders.noContractsInStatus')}
                          </div>
                        ) : (
                          openHeaderMenuContracts.map((contract) => (
                            <div key={contract.id} className="flex min-w-0 items-center justify-between gap-2 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800">
                              <button
                                onClick={() => handleSelectContract(contract)}
                                className="min-w-0 flex-1 text-left text-xs text-gray-900 dark:text-white"
                              >
                                <div className="font-semibold truncate">{contract.name}</div>
                                <div className="truncate text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                  {statusLabels[contractStatusMap[contract.id] || 'submitted']}
                                </div>
                              </button>
                              {isAdmin && (contractStatusMap[contract.id] || 'submitted') !== 'completed' && (
                                <button
                                  onClick={() => handleMarkContractComplete(contract)}
                                  className="shrink-0 text-[10px] uppercase tracking-wide text-green-700 dark:text-green-300 hover:text-green-800"
                                >
                                  {t('orders.markComplete')}
                                </button>
                              )}
                              {isAdmin && (contractStatusMap[contract.id] || 'submitted') === 'completed' && (
                                <button
                                  onClick={() => handleMarkContractInProgress(contract)}
                                  className="shrink-0 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 hover:text-amber-800"
                                >
                                  {t('orders.markInProgress')}
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </header>

        {(showSidebar || showStepModal || showCompactFieldPanel) && (
          <div className="pointer-events-none absolute top-20 left-3 right-3 bottom-16 sm:top-[5.5rem] sm:left-4 sm:right-4 sm:bottom-20 xl:left-4 xl:right-auto xl:bottom-auto z-[3999] flex items-start gap-2 sm:gap-3">
            {showSidebar && (
              <div className={`pointer-events-auto flex shrink-0 flex-col gap-2 sm:gap-3 ${selectedStep === 3 ? 'w-20 sm:w-24 xl:w-[8rem]' : 'w-11 sm:w-12 xl:w-14'}`}>
                <div className="rounded-xl shadow-2xl overflow-visible backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50 animate-slide-down">
                  <div className="p-2 max-h-[60vh] overflow-y-auto scrollbar-modern">
                    {wizardSteps.map(({ step }, index) => {
                      const isActive = selectedStep === step && showStepModal;
                      const isComplete = step < selectedStep;
                      const isLast = index === wizardSteps.length - 1;
                      return (
                        <div key={step} className="flex flex-col items-center relative">
                          <button
                            onClick={() => handleOpenStep(step)}
                            className="w-full flex items-center justify-center py-1 transition-colors"
                            aria-current={isActive ? 'step' : undefined}
                          >
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                                isActive
                                  ? 'bg-blue-600 text-white ring-2 ring-blue-300/70'
                                  : isComplete
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                  : 'bg-gray-200/70 text-gray-700 dark:bg-gray-800/70 dark:text-gray-300'
                              }`}
                            >
                              {step}
                            </div>
                          </button>
                          {!isLast && (
                            <div
                              className={`w-[2px] h-5 ${
                                isComplete
                                  ? 'bg-green-400/80 dark:bg-green-400/70'
                                  : 'bg-gray-300/70 dark:bg-gray-700/70'
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {selectedStep === 3 && (
                  <div className="rounded-xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50">
                    <div className="px-2 py-2 border-b border-gray-200/50 dark:border-gray-700/50">
                      <div className="text-[11px] font-semibold text-gray-900 dark:text-white text-center leading-tight whitespace-normal">
                        {t('orders.controlsShort')}
                      </div>
                    </div>

                    <div className="p-2 space-y-1.5">
                      <button
                        onClick={() => {
                          const next = drawingMode === 'polygon' ? null : 'polygon';
                          setDrawingMode(next);
                          if (next) setShowStepModal(false);
                        }}
                        className={`w-full flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-center transition-colors ${
                          drawingMode === 'polygon'
                            ? 'bg-blue-500/20 dark:bg-blue-500/30 text-blue-900 dark:text-blue-100 border border-blue-500/40'
                            : 'bg-gray-100/50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                        }`}
                        title={t('orders.drawPolygon')}
                        aria-label={t('orders.drawPolygon')}
                      >
                        <Pentagon className="h-5 w-5 shrink-0" />
                        <span className="max-w-full text-[10px] font-medium leading-tight sm:text-[11px]">
                          {t('orders.polygonShort')}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          const next = drawingMode === 'rectangle' ? null : 'rectangle';
                          setDrawingMode(next);
                          if (next) setShowStepModal(false);
                        }}
                        className={`w-full flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-center transition-colors ${
                          drawingMode === 'rectangle'
                            ? 'bg-blue-500/20 dark:bg-blue-500/30 text-blue-900 dark:text-blue-100 border border-blue-500/40'
                            : 'bg-gray-100/50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                        }`}
                        title={t('orders.drawRectangle')}
                        aria-label={t('orders.drawRectangle')}
                      >
                        <Square className="h-5 w-5 shrink-0" />
                        <span className="max-w-full text-[10px] font-medium leading-tight sm:text-[11px]">
                          {t('orders.rectangleShort')}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="min-w-0 flex flex-1 flex-col gap-2 sm:gap-3 xl:flex-none xl:w-[38rem]">
              {selectedStep === 3 && (isDrawingSession || draftDrawnFields.length > 0) && (
                <div className="pointer-events-auto">
                  <div className="flex flex-wrap items-center gap-2 rounded-full shadow-2xl backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50 px-2 py-1">
                    <button
                      onClick={() => {
                        if (draftDrawnFields.length) {
                          setDrawnFields((prev) => [...prev, ...draftDrawnFields]);
                          setDraftDrawnFields([]);
                        }
                        setDrawingMode(null);
                        setStep3Collapsed(false);
                        setShowStepModal(true);
                      }}
                      className="px-4 py-2 rounded-full bg-green-500/80 text-green-950 dark:text-green-100 text-sm font-semibold shadow-md hover:bg-green-500"
                    >
                      {t('orders.drawingAccept')}
                    </button>
                    <button
                      onClick={() => {
                        setDraftDrawnFields([]);
                        if (editingFieldBackup) {
                          setDrawnFields((prev) => [...prev, editingFieldBackup]);
                          setEditingFieldBackup(null);
                        }
                        setDrawingMode(null);
                        setStep3Collapsed(false);
                        setShowStepModal(true);
                      }}
                      className="px-4 py-2 rounded-full bg-red-500/80 text-red-950 dark:text-red-100 text-sm font-semibold shadow-md hover:bg-red-500"
                    >
                      {t('orders.drawingCancel')}
                    </button>
                  </div>
                </div>
              )}

              {showStepModal && (
                <div className="pointer-events-auto w-full rounded-xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50 animate-slide-down">
                  <div
                    className="flex items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 xl:px-6 py-2 sm:py-2.5 xl:py-4 border-b border-gray-200/50 dark:border-gray-700/50 cursor-pointer"
                    onClick={() => setWizardPanelCollapsed((prev) => !prev)}
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] sm:text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 leading-none">
                        {t('orders.wizard.stepLabel', { step: selectedStep }) || `Step ${selectedStep}`}
                      </div>
                      <div className="mt-0.5 text-sm sm:text-base xl:text-lg font-semibold text-gray-900 dark:text-white truncate leading-tight">
                        {wizardSteps[selectedStep - 1]?.label}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setWizardPanelCollapsed((prev) => !prev)}
                        className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/80 dark:bg-gray-900/70 text-gray-600 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800/80 flex items-center justify-center"
                        title={wizardPanelCollapsed ? (t('common.expand')) : (t('common.collapse'))}
                        aria-label={wizardPanelCollapsed ? (t('common.expand')) : (t('common.collapse'))}
                      >
                        <ChevronDown className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${wizardPanelCollapsed ? 'rotate-180' : ''}`} />
                      </button>
                      {selectedStep < 6 && (
                        <button
                          onClick={() => setSelectedStep(selectedStep + 1)}
                          disabled={!canContinueStep}
                          className={`h-8 w-8 sm:h-9 sm:w-9 xl:w-auto xl:px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                            canContinueStep
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                          }`}
                          title={getContinueLabel(selectedStep)}
                          aria-label={getContinueLabel(selectedStep)}
                        >
                          <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 xl:hidden" />
                          <span className="hidden xl:inline">{getContinueLabel(selectedStep)}</span>
                        </button>
                      )}
                      {selectedStep === 6 && (
                        <button
                          onClick={() => submitOrderRef.current?.()}
                          disabled={!canSubmitStep || isSubmittingOrder}
                          className={`h-8 w-8 sm:h-9 sm:w-9 xl:w-auto xl:px-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                            canSubmitStep && !isSubmittingOrder
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                          }`}
                          title={t('orders.wizard.submitOrder')}
                          aria-label={t('orders.wizard.submitOrder')}
                        >
                          <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 xl:hidden" />
                          <span className="hidden xl:inline">{t('orders.wizard.submitOrder')}</span>
                        </button>
                      )}
                      {draftOverrideId && (
                        <button
                          onClick={handleDiscardContract}
                          disabled={selectedStep === 6 && isSubmittingOrder}
                          className={`h-8 w-8 sm:h-9 sm:w-9 xl:w-auto xl:px-3 rounded-lg border border-red-200 text-red-600 bg-white/80 dark:bg-gray-900/80 dark:border-red-900/60 dark:text-red-300 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                            selectedStep === 6 && isSubmittingOrder
                              ? 'opacity-60 cursor-not-allowed'
                              : 'hover:bg-red-50/60 dark:hover:bg-red-900/30'
                          }`}
                          title={t('orders.discard')}
                          aria-label={t('orders.discard')}
                        >
                          <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 xl:hidden" />
                          <span className="hidden xl:inline">{t('orders.discard')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {!wizardPanelCollapsed && (
                    <div ref={stepContentRef} className={`overflow-y-auto ${wizardContentMaxHeightClass} p-2.5 sm:p-3.5 lg:p-5 xl:p-6 scrollbar-modern`} style={wizardContentMaxHeightStyle}>
                      <OrderWizard 
                        initialStep={selectedStep} 
                        singleStepMode={true}
                        onComplete={handleOrderComplete}
                        onFieldsLoaded={handleFieldsLoaded}
                        onStepChange={handleWizardStepChange}
                        externalDrawnFields={drawnFields}
                        onExternalDrawnFieldsChange={setDrawnFields}
                        externalSourceFields={wizardSourceFields}
                        step3Collapsed={step3Collapsed}
                        onStep3CollapsedChange={setStep3Collapsed}
                        draftId={draftOverrideId || selectedContractId || undefined}
                        draftName={draftOverrideName || selectedContract?.name}
                        deferProjectCreation={Boolean(draftOverrideId)}
                        ownerIdOverride={userRole === 'admin'
                          ? (draftOverrideId
                            ? (newContractOwnerId || selectedOwnerId || undefined)
                            : (selectedContract?.clientId || selectedOwnerId || undefined))
                          : undefined}
                        onSubmitHandlerChange={(handler) => {
                          submitOrderRef.current = handler;
                        }}
                        onSubmitStateChange={setIsSubmittingOrder}
                        mapSelectionEvent={mapSelectionEvent}
                        onFieldFocusRequest={handleWizardFieldFocus}
                        onClearSelectionRequest={handleMapBackgroundClick}
                        onStepReadinessChange={setStepReadiness}
                        onFieldSummariesChange={setFieldSummaries}
                        onGridPreviewChange={({ enabled, sizeHa }) => {
                          setGridPreviewEnabled(enabled);
                          setGridPreviewSizeHa(sizeHa);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

            </div>

            {showCompactFieldPanelExpanded && (
              <div className="pointer-events-auto xl:hidden absolute bottom-0 left-0 right-0 rounded-xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50">
                <div className={`px-2 pb-2 pt-2 sm:px-3 sm:pb-2.5 sm:pt-2.5 overflow-x-auto overflow-y-hidden ${compactFieldPanelHeightClass} scrollbar-modern`}>
                  <div className="flex h-full items-start gap-1.5 pr-1 snap-x snap-mandatory">
                    {renderFieldCards(false, true)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {showCompactFieldPanel && (
          <button
            type="button"
            onClick={() => setCompactFieldPanelCollapsed((prev) => !prev)}
            className="pointer-events-auto xl:hidden absolute right-2 bottom-2 sm:right-3 sm:bottom-3 z-[4002] h-11 w-11 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/85 dark:bg-gray-900/85 shadow-xl backdrop-blur-xl flex items-center justify-center text-gray-700 dark:text-gray-200"
            title={`${compactFieldPanelCollapsed ? t('common.expand') : t('common.collapse')} ${t('orders.fieldBoundaries')}`}
            aria-label={`${compactFieldPanelCollapsed ? t('common.expand') : t('common.collapse')} ${t('orders.fieldBoundaries')}`}
          >
            <FileText className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-blue-600 text-white text-[9px] font-semibold leading-[1.1rem] text-center">
              {combinedFields.length}
            </span>
            <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-white dark:bg-gray-900 border border-gray-200/70 dark:border-gray-700/70 flex items-center justify-center transition-transform ${compactFieldPanelCollapsed ? 'rotate-180' : ''}`}>
              <ChevronDown className="h-3 w-3" />
            </span>
          </button>
        )}

        {/* Right sidebar - Fields list (desktop) */}
        {showRightSidebar && combinedFields.length > 0 && (
          <div
            className={`hidden xl:block absolute top-[6rem] right-4 rounded-xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70 border border-gray-200/50 dark:border-gray-700/50 z-[4000] max-h-[calc(100vh-8.5rem)] transition-all duration-300 ${
              fieldsSidebarCollapsed ? 'w-12' : 'w-72'
            }`}
          >
            <div className="px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between gap-2">
              <div className={fieldsSidebarCollapsed ? 'hidden' : 'block'}>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('orders.fieldBoundaries')}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {combinedFields.length} {t('orders.fields')}
                </div>
              </div>
              <button
                onClick={() => setFieldsSidebarCollapsed((prev) => !prev)}
                className="ml-auto p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
                title={fieldsSidebarCollapsed ? (t('common.expand')) : (t('common.collapse'))}
              >
                {fieldsSidebarCollapsed ? '«' : '»'}
              </button>
            </div>
            {!fieldsSidebarCollapsed && (
              <div ref={fieldsListRef} className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-10rem)] scrollbar-modern">
                {renderFieldCards(true)}
              </div>
            )}
          </div>
        )}

        {fieldDetailsOpen && (
          <div className="absolute inset-0 z-[5000] flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('orders.fieldDetailsTitle')}
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {fieldDetailsName || (t('orders.fieldLabel'))}
                  </div>
                </div>
                <button
                  onClick={() => setFieldDetailsOpen(false)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid gap-3">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {t('orders.fieldNameLabel')}
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    value={fieldDetailsName}
                    onChange={(e) => setFieldDetailsName(e.target.value)}
                  />
                </div>
                <div className="grid gap-3">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {t('orders.fieldIdLabelShort')}
                  </label>
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    value={fieldDetailsId}
                    onChange={(e) => setFieldDetailsId(e.target.value)}
                  />
                </div>
                <div className="grid gap-3">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {t('orders.fieldColorLabel')}
                  </label>
                  <div className="flex justify-center">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/60 p-2">
                      <div className="inline-grid grid-cols-12 gap-2">
                        {colorPresets.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setFieldDetailsColor(preset)}
                            className={`h-7 w-7 rounded-md border shadow-sm ${
                              fieldDetailsColor.toLowerCase() === preset.toLowerCase()
                                ? 'ring-2 ring-blue-500 border-white'
                                : 'border-gray-300 dark:border-gray-700'
                            }`}
                            style={{ backgroundColor: preset }}
                            aria-label={preset}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <button
                  onClick={() => setFieldDetailsOpen(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveFieldDetails}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showSettingsModal && (
          <div className="fixed inset-0 z-[6000] overflow-y-auto bg-black/30 backdrop-blur-sm p-3 sm:p-4">
            <div className="mx-auto my-3 sm:my-6 flex w-full max-w-xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] flex-col rounded-xl shadow-2xl overflow-hidden bg-white/95 dark:bg-gray-900/95 border border-gray-200/50 dark:border-gray-700/50">
              <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('orders.settings.title')}
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {t('orders.settings.userDetailsTitle')}
                  </div>
                </div>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('orders.settings.email')}</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{user?.email || '-'}</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('orders.settings.userId')}</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white break-all">{user?.uid || '-'}</div>
                  </div>
                </div>

                {profileLoading ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {t('orders.settings.loadingProfile')}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.customerNumber')}
                        </label>
                        <input
                          value={profileDraft?.customerNumber || ''}
                          onChange={(event) => updateProfileDraft('customerNumber', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.companyOptional')}
                        </label>
                        <input
                          value={profileDraft?.company || ''}
                          onChange={(event) => updateProfileDraft('company', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.firstName')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={profileDraft?.firstName || ''}
                          onChange={(event) => updateProfileDraft('firstName', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.lastName')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={profileDraft?.lastName || ''}
                          onChange={(event) => updateProfileDraft('lastName', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.phone')}
                        </label>
                        <input
                          value={profileDraft?.phone || ''}
                          onChange={(event) => updateProfileDraft('phone', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.country')}
                        </label>
                        <input
                          value={profileDraft?.country || ''}
                          onChange={(event) => updateProfileDraft('country', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.street')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={profileDraft?.street || ''}
                          onChange={(event) => updateProfileDraft('street', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.postalCode')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={profileDraft?.postalCode || ''}
                          onChange={(event) => updateProfileDraft('postalCode', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.city')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={profileDraft?.city || ''}
                          onChange={(event) => updateProfileDraft('city', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {t('orders.wizard.federalState')} <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={profileDraft?.federalState || ''}
                          onChange={(event) => updateProfileDraft('federalState', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                        >
                          <option value="">{t('orders.settings.selectState')}</option>
                          {federalStates.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('orders.settings.requiredHint')}
                    </div>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('orders.settings.cancel')}
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving || profileLoading}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {profileSaving ? (t('orders.settings.saving')) : (t('orders.settings.save'))}
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewContractModal && (
          <div className="absolute inset-0 z-[6500] flex items-start justify-center overflow-y-auto bg-black/30 px-4 pb-4 pt-[5.75rem] backdrop-blur-sm sm:items-center sm:px-4 sm:py-4">
            <div className="mx-auto flex w-full max-w-[26rem] max-h-[calc(100%-6.5rem)] flex-col rounded-xl border border-gray-200/50 bg-white/95 shadow-2xl overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/95 sm:max-h-[min(42rem,calc(100%-2rem))] sm:max-w-md">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('orders.newContract')}
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {t('orders.nameContractHeading')}
                  </div>
                </div>
                <button
                  onClick={closeNewContractModal}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {t('orders.contractNameLabel')}
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  value={newContractName}
                  onChange={(event) => setNewContractName(event.target.value)}
                  placeholder={t('orders.contractNamePlaceholder')}
                />
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    {t('orders.contractLabLabel')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-center">
                    <button
                      type="button"
                      onClick={() => setNewContractLabProvider('agrolab')}
                      className={`rounded-lg border px-3 py-3 transition-all ${
                        newContractLabProvider === 'agrolab'
                          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/50 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('orders.labOptionAgrolab')}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewContractLabProvider('lufa_nrw')}
                      className={`rounded-lg border px-3 py-3 transition-all ${
                        newContractLabProvider === 'lufa_nrw'
                          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/50 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('orders.labOptionLufaNrw')}
                      </div>
                    </button>
                  </div>
                </div>
                {newContractLabProvider === 'lufa_nrw' && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {t('orders.contractLufaScopeLabel')}
                    </label>
                    <select
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                      value={newContractLufaScope}
                      onChange={(event) => setNewContractLufaScope(event.target.value as LufaStandarduntersuchungsumfang)}
                    >
                      <option value="DED">{t('orders.lufaScopeDed')}</option>
                      <option value="Nmin">{t('orders.lufaScopeNmin')}</option>
                    </select>
                  </div>
                )}
                {userRole === 'admin' && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {t('orders.contractOwnerLabel')}
                    </label>
                    <select
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                      value={newContractOwnerId}
                      onChange={(event) => setNewContractOwnerId(event.target.value)}
                      disabled={userOptions.length === 0}
                    >
                      <option value="">
                        {userOptions.length > 0
                          ? (t('orders.selectUserPlaceholder'))
                          : (t('orders.noUsersAvailable'))}
                      </option>
                      {userOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col-reverse items-stretch justify-end gap-2 border-t border-gray-200/50 px-5 py-4 dark:border-gray-700/50 sm:flex-row sm:items-center">
                <button
                  onClick={closeNewContractModal}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 sm:w-auto"
                  disabled={isCreatingContract}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreateContract}
                  disabled={isCreatingContract || !newContractName.trim() || !newContractLabProvider}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
                >
                  {isCreatingContract ? (t('orders.creatingContract')) : (t('orders.createContract'))}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirmTarget && (
          <div className="absolute inset-0 z-[7000] flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50">
              <div className="px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('orders.confirmDeleteShapeTitle')}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('orders.confirmDeleteShapeHeading')}
                </div>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">
                {t('orders.confirmDeleteShapeMessage')}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <button
                  onClick={() => setDeleteConfirmTarget(null)}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleConfirmDeleteShape}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {editModeMenu && (showStepModal || draftOverrideId) && (
          <div className="absolute inset-0 z-[7000] flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50">
              <div className="px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('orders.editShapeTitle')}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('orders.editShapeHeading')}
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <button
                  onClick={handleEditVertices}
                  className="w-full px-4 py-3 rounded-lg border-2 border-blue-500 bg-blue-50/80 dark:bg-blue-900/30 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors text-left"
                >
                  <div className="font-bold">{t('orders.editVertices')}</div>
                  <div className="text-xs font-normal mt-1 text-blue-600 dark:text-blue-400">
                    {t('orders.editVerticesDesc')}
                  </div>
                </button>
                <button
                  onClick={handleRecreateField}
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white/80 dark:bg-gray-800/80 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="font-bold">{t('orders.recreateField')}</div>
                  <div className="text-xs font-normal mt-1 text-gray-600 dark:text-gray-400">
                    {t('orders.recreateFieldDesc')}
                  </div>
                </button>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <button
                  onClick={() => setEditModeMenu(null)}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {drawingMode === 'edit' && editingFieldBackup && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[4500] flex items-center gap-3 px-5 py-3 rounded-full shadow-2xl bg-white/90 dark:bg-gray-900/90 border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-2xl">
            <button
              onClick={handleCancelEdit}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleUpdateEdit}
              className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
            >
              {t('orders.updateShape')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
