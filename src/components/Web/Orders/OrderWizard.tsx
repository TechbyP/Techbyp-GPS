import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import shp from 'shpjs';
import area from '@turf/area';
import { CheckCircle, Circle, FileText, ShieldCheck, Truck, UserCircle, Upload, ChevronRight } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../ui/ConfirmationProvider';
import {
  LufaImportConfig,
  LufaStandarduntersuchungsumfang,
  OrderDraft,
  OrderServiceType
} from '../../../types';
import { generateAgrolabCsv } from '../../../services/labExportAgrolab';
import { buildLufaImportXml } from '../../../services/labExportLufaXml';
import { orderExportService } from '../../../services/orderExportService';
import { orderService } from '../../../services/orderService';
import { firebaseGPS } from '../../../services/firebaseSync';
import { userProfileService } from '../../../services/userProfileService';
import { buildBalancedSamplingCells } from '../../../utils/fieldPartitioning';
import type { UserProfile } from '../../../services/userProfileService';
import type { DrawnField } from './types';


const defaultConsent = {
  dataProtectionAccepted: false,
  dataProcessingAccepted: false,
  digitalDocsOnlyAccepted: false,
  termsAccepted: false
};

const defaultServiceSelection = {
  services: ['basic_nutrients'] as OrderServiceType[],
  includeGpsDocumentation: false
};

const defaultCrops = Array.from({ length: 7 }, () => ({ crop: '', yield: '' }));

const createDefaultLabMeta = (): NonNullable<OrderDraft['labMeta']> => {
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    assignedLab: '',
    labName: '',
    sampleTypeBns: '',
    version: '',
    trackingNumber: '',
    orderDate: todayIso,
    storageName: '',
    internalInfo: '',
    projectId: '',
    projectName: '',
    calDl: false,
    notDry: false,
    heavy: false,
    oneOrderPerField: false,
    postReport: false,
    postInvoice: false,
    contactEmails: ''
  };
};

const createDefaultSamplingDetails = (): NonNullable<OrderDraft['samplingDetails']> => {
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    samplerNo: '',
    advertiserNo: '',
    samplingOrderNo: '',
    priceList: '',
    samplingDate: todayIso,
    pricePerSample: '',
    pricePerHa: '',
    totalAreaHa: '',
    travelCost: '',
    travelCostPerKm: '',
    km: '',
    sampleCount: ''
  };
};

const createDefaultLufaImport = (
  scope: LufaStandarduntersuchungsumfang = 'DED'
): LufaImportConfig => ({
  standarduntersuchungsumfang: scope,
  kundeAdrnr: '',
  auftraggeberAdrnr: '',
  kostentraegerAdrnr: '',
  durchschriftenempfaengerAdrnr: '',
  defaultKennzeichnung: {
    Objekt: 'BO',
    Gruppenart: scope === 'Nmin' ? 'A' : 'AB'
  },
  zusatzpruefparameter: [],
  nminLayers: [
    { depthFromCm: 0, depthToCm: 30 },
    { depthFromCm: 30, depthToCm: 60 },
    { depthFromCm: 60, depthToCm: 90 }
  ],
  dateFormatHint: 'YYYYMMDD_HH24MISS'
});

const normalizeDraftLabConfig = (value: OrderDraft): OrderDraft => {
  const labProvider = value.labProvider || 'agrolab';
  const scope = value.lufaImport?.standarduntersuchungsumfang || 'DED';
  const defaults = createDefaultLufaImport(scope);
  const defaultLabMeta = createDefaultLabMeta();
  const defaultSamplingDetails = createDefaultSamplingDetails();
  const mergedLufaImport = {
    ...defaults,
    ...(value.lufaImport || {}),
    standarduntersuchungsumfang: scope,
    nminLayers: value.lufaImport?.nminLayers?.length
      ? value.lufaImport.nminLayers
      : defaults.nminLayers
  };
  const mergedLabMeta = {
    ...defaultLabMeta,
    ...(value.labMeta || {})
  };
  const mergedSamplingDetails = {
    ...defaultSamplingDetails,
    ...(value.samplingDetails || {})
  };
  const lufaImportEnabled = typeof value.lufaImportEnabled === 'boolean'
    ? value.lufaImportEnabled
    : LUFA_ADRNR_KEYS.some((key) => String(mergedLufaImport[key] || '').trim().length > 0);
  const agrolabMetadataEnabled = typeof value.agrolabMetadataEnabled === 'boolean'
    ? value.agrolabMetadataEnabled
    : (
      AGROLAB_REQUIRED_LAB_META_KEYS.some((key) => String(value.labMeta?.[key] || '').trim().length > 0)
      || AGROLAB_REQUIRED_SAMPLING_KEYS.some((key) => String(value.samplingDetails?.[key] || '').trim().length > 0)
      || Boolean((value.fields || []).some((field) => (
        String(field.transportTracking || '').trim().length > 0
        || String(field.soilType || '').trim().length > 0
        || String(field.humusClass || '').trim().length > 0
      )))
    );

  return {
    ...value,
    labProvider,
    agrolabMetadataEnabled,
    lufaImportEnabled,
    labMeta: mergedLabMeta,
    samplingDetails: mergedSamplingDetails,
    lufaImport: mergedLufaImport
  };
};

type LufaAdrnrKey = 'kundeAdrnr' | 'auftraggeberAdrnr' | 'kostentraegerAdrnr' | 'durchschriftenempfaengerAdrnr';

const LUFA_ADRNR_KEYS: LufaAdrnrKey[] = [
  'kundeAdrnr',
  'auftraggeberAdrnr',
  'kostentraegerAdrnr',
  'durchschriftenempfaengerAdrnr'
];

const AGROLAB_REQUIRED_LAB_META_KEYS: Array<keyof NonNullable<OrderDraft['labMeta']>> = [
  'assignedLab',
  'labName',
  'sampleTypeBns',
  'version',
  'trackingNumber',
  'storageName',
  'internalInfo',
  'projectId',
  'projectName',
  'contactEmails'
];

const AGROLAB_REQUIRED_SAMPLING_KEYS: Array<keyof NonNullable<OrderDraft['samplingDetails']>> = [
  'samplerNo',
  'advertiserNo',
  'samplingOrderNo',
  'priceList',
  'pricePerSample',
  'pricePerHa',
  'totalAreaHa',
  'travelCost',
  'travelCostPerKm',
  'km',
  'sampleCount'
];

// Accept client-provided ADRNR values as-is; only require non-empty values.
// Normalize backslash to slash to reduce keyboard-related input mistakes.

const normalizeLufaAdrnr = (value: string): string => (
  value
    .trim()
    .replace(/\\/g, '/')
);

const isValidLufaAdrnr = (value: string | undefined): boolean => (
  normalizeLufaAdrnr(String(value || '')).length > 0
);

const sanitizeFileName = (value: string): string => (
  value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const normalizeCrops = (crops?: Array<{ crop?: string; yield?: string }>) => (
  Array.from({ length: defaultCrops.length }, (_, index) => ({
    crop: crops?.[index]?.crop || '',
    yield: crops?.[index]?.yield || ''
  }))
);

const areOrderedValuesEqual = <T,>(left: T[], right: T[]) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const buildSamplingCellSourceFields = (
  sourceFields: NonNullable<OrderDraft['sourceFields']>,
  gridSizeHa: 3 | 5,
  maxTotalCells: number = 5000
): NonNullable<OrderDraft['sourceFields']> => {
  const generatedAt = new Date().toISOString();
  let remainingCellBudget = maxTotalCells;

  const nextFields: NonNullable<OrderDraft['sourceFields']> = [];

  sourceFields.forEach((source) => {
    if (source.samplingCell) {
      nextFields.push(source);
      return;
    }

    const geometry = source.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
      nextFields.push(source);
      return;
    }

    if (remainingCellBudget <= 0) {
      nextFields.push(source);
      return;
    }

    const parentBaseId = source.samplingCell?.parentBaseId || source.baseId;
    const parentBaseName = source.samplingCell?.parentBaseName || source.baseName;

    const balancedCells = buildBalancedSamplingCells(
      geometry,
      gridSizeHa,
      Math.min(remainingCellBudget, 120)
    );

    if (!balancedCells.length) {
      nextFields.push(source);
      return;
    }

    balancedCells.forEach((cell) => {
      if (remainingCellBudget <= 0) return;
      remainingCellBudget -= 1;

      const cellBaseId = `${parentBaseId}.${cell.index}`;
      const cellBaseName = `${parentBaseName}.${cell.index}`;
      const samplingCell = {
        parentBaseId,
        parentBaseName,
        cellIndex: cell.index,
        row: cell.row,
        column: cell.column,
        gridSizeHa,
        generatedAt,
      };

      nextFields.push({
        baseId: cellBaseId,
        baseName: cellBaseName,
        areaHa: Number(cell.areaHa.toFixed(2)),
        geometry: cell.geometry,
        labAttributes: source.labAttributes,
        samplingCell,
        exportMapping: {
          sampleKey: cellBaseId,
          sampleDisplayName: cellBaseName,
          sourceBaseId: parentBaseId,
          sourceBaseName: parentBaseName,
        },
      });
    });
  });

  return nextFields;
};

const newDraft = (ownerId: string, id: string, name?: string): OrderDraft => {
  const now = new Date().toISOString();
  return {
    id,
    name: name || 'New Contract',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ownerId,
    labProvider: 'agrolab',
    consent: { ...defaultConsent },
    serviceSelection: { ...defaultServiceSelection },
    cropYield: { crops: [...defaultCrops] },
    labMeta: createDefaultLabMeta(),
    samplingDetails: createDefaultSamplingDetails(),
    agrolabMetadataEnabled: false,
    lufaImportEnabled: false,
    lufaImport: createDefaultLufaImport('DED'),
    gridSizeHa: 5,
    sourceFields: [],
    fields: []
  };
};

const hasNonEmptyText = (value?: string): boolean => (
  typeof value === 'string' && value.trim().length > 0
);

const CUSTOMER_PROFILE_KEYS: Array<keyof NonNullable<OrderDraft['customerProfile']>> = [
  'customerNumber',
  'firstName',
  'lastName',
  'company',
  'street',
  'postalCode',
  'city',
  'phone',
  'email',
  'country',
  'federalState'
];

const BILLING_RECIPIENT_TEXT_KEYS: Array<'name' | 'firstName' | 'street' | 'postalCode' | 'city' | 'country' | 'federalState'> = [
  'name',
  'firstName',
  'street',
  'postalCode',
  'city',
  'country',
  'federalState'
];

const withUserProfileDefaults = (
  source: OrderDraft,
  userProfile: UserProfile | null,
  fallbackEmail?: string
): OrderDraft => {
  const customerDefaults: Partial<NonNullable<OrderDraft['customerProfile']>> = {
    customerNumber: userProfile?.customerNumber,
    firstName: userProfile?.firstName,
    lastName: userProfile?.lastName,
    company: userProfile?.company,
    street: userProfile?.street,
    postalCode: userProfile?.postalCode,
    city: userProfile?.city,
    phone: userProfile?.phone,
    email: userProfile?.email || fallbackEmail,
    country: userProfile?.country,
    federalState: userProfile?.federalState
  };

  const billingDefaults: Partial<NonNullable<OrderDraft['billingRecipient']>> = {
    name: userProfile?.company || userProfile?.lastName,
    firstName: userProfile?.firstName,
    street: userProfile?.street,
    postalCode: userProfile?.postalCode,
    city: userProfile?.city,
    country: userProfile?.country,
    federalState: userProfile?.federalState
  };

  const nextCustomer: NonNullable<OrderDraft['customerProfile']> = {
    ...(source.customerProfile || {})
  };
  let customerChanged = false;
  for (const key of CUSTOMER_PROFILE_KEYS) {
    const currentValue = nextCustomer[key];
    const defaultValue = customerDefaults[key];
    if (hasNonEmptyText(currentValue) || !hasNonEmptyText(defaultValue)) continue;
    nextCustomer[key] = defaultValue.trim();
    customerChanged = true;
  }

  const nextBilling: NonNullable<OrderDraft['billingRecipient']> = {
    isDifferent: source.billingRecipient?.isDifferent || false,
    ...(source.billingRecipient || {})
  };
  let billingChanged = false;
  for (const key of BILLING_RECIPIENT_TEXT_KEYS) {
    const currentValue = nextBilling[key];
    const defaultValue = billingDefaults[key];
    if (hasNonEmptyText(currentValue) || !hasNonEmptyText(defaultValue)) continue;
    nextBilling[key] = defaultValue.trim();
    billingChanged = true;
  }

  if (!customerChanged && !billingChanged) {
    return source;
  }

  return {
    ...source,
    ...(customerChanged ? { customerProfile: nextCustomer } : {}),
    ...(billingChanged ? { billingRecipient: nextBilling } : {})
  };
};

export default function OrderWizard({ 
  initialStep = 1, 
  singleStepMode = false,
  onComplete,
  onFieldsLoaded,
  externalDrawnFields,
  onExternalDrawnFieldsChange,
  externalSourceFields,
  step3Collapsed,
  onStep3CollapsedChange,
  onStepChange,
  mapSelectionEvent,
  onFieldFocusRequest,
  onClearSelectionRequest,
  onFieldSummariesChange,
  draftId,
  draftName,
  deferProjectCreation,
  ownerIdOverride,
  onSubmitHandlerChange,
  onSubmitStateChange,
  onStepReadinessChange,
  onGridPreviewChange
}: { 
  initialStep?: number;
  singleStepMode?: boolean;
  onComplete?: () => void;
  onFieldsLoaded?: (fields: NonNullable<OrderDraft['sourceFields']>) => void;
  externalDrawnFields?: DrawnField[];
  onExternalDrawnFieldsChange?: (fields: DrawnField[]) => void;
  externalSourceFields?: NonNullable<OrderDraft['sourceFields']>;
  step3Collapsed?: boolean;
  onStep3CollapsedChange?: (collapsed: boolean) => void;
  onStepChange?: (step: number) => void;
  mapSelectionEvent?: { baseId: string; ctrlKey: boolean; timestamp: number } | null;
  onFieldFocusRequest?: (baseId: string) => void;
  onClearSelectionRequest?: () => void;
  onFieldSummariesChange?: (summaries: Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }>) => void;
  draftId?: string;
  draftName?: string;
  deferProjectCreation?: boolean;
  ownerIdOverride?: string;
  onSubmitHandlerChange?: (handler: (() => void) | null) => void;
  onSubmitStateChange?: (isSubmitting: boolean) => void;
  onStepReadinessChange?: (state: {
    step1Ready: boolean;
    step2Ready: boolean;
    step3Ready: boolean;
    step4Ready: boolean;
    step5Ready: boolean;
    step6Ready: boolean;
  }) => void;
  onGridPreviewChange?: (state: {
    enabled: boolean;
    sizeHa: 3 | 5;
  }) => void;
}) {
  const { user } = useAuth();
  const { showConfirmation } = useConfirmation();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(true);
  const [fieldServiceSelection, setFieldServiceSelection] = useState<OrderServiceType[]>(defaultServiceSelection.services);
  const [uploadedSourceFields, setUploadedSourceFields] = useState<NonNullable<OrderDraft['sourceFields']>>([]);
  const [drawnFields, setDrawnFields] = useState<DrawnField[]>([]);
  const [uploadCollapsed, setUploadCollapsed] = useState(false);
  const [internalStep3Collapsed, setInternalStep3Collapsed] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadedArchives, setUploadedArchives] = useState<Array<{ id: string; name: string; fields: NonNullable<OrderDraft['sourceFields']> }>>([]);
  const [isLoadingShapefile, setIsLoadingShapefile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConvertingSamplingCells, setIsConvertingSamplingCells] = useState(false);
  const [showGridPreview, setShowGridPreview] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastStepReadinessRef = useRef<{
    step1Ready: boolean;
    step2Ready: boolean;
    step3Ready: boolean;
    step4Ready: boolean;
    step5Ready: boolean;
    step6Ready: boolean;
  } | null>(null);
  const lastFieldSummariesSignatureRef = useRef<string>('');
  const lastProcessedMapSelectionTsRef = useRef<number | null>(null);
  const onStepChangeRef = useRef(onStepChange);
  const onFieldSummariesChangeRef = useRef(onFieldSummariesChange);
  const onSubmitHandlerChangeRef = useRef(onSubmitHandlerChange);
  const onSubmitStateChangeRef = useRef(onSubmitStateChange);
  const onStepReadinessChangeRef = useRef(onStepReadinessChange);
  const onGridPreviewChangeRef = useRef(onGridPreviewChange);

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
    onFieldSummariesChangeRef.current = onFieldSummariesChange;
    onSubmitHandlerChangeRef.current = onSubmitHandlerChange;
    onSubmitStateChangeRef.current = onSubmitStateChange;
    onStepReadinessChangeRef.current = onStepReadinessChange;
    onGridPreviewChangeRef.current = onGridPreviewChange;
  }, [onFieldSummariesChange, onGridPreviewChange, onStepChange, onStepReadinessChange, onSubmitHandlerChange, onSubmitStateChange]);

  const goToStep = (step: number) => {
    setCurrentStep(step);
    onStepChangeRef.current?.(step);
  };

  const steps = [
    {
      id: 1,
      label: t('orders.wizard.steps.step1Label'),
      description: t('orders.wizard.steps.step1Desc'),
      icon: ShieldCheck
    },
    {
      id: 2,
      label: t('orders.wizard.steps.step2Label'),
      description: t('orders.wizard.steps.step2Desc'),
      icon: UserCircle
    },
    {
      id: 3,
      label: t('orders.wizard.steps.step3Label'),
      description: t('orders.wizard.steps.step3Desc'),
      icon: FileText
    },
    {
      id: 4,
      label: t('orders.wizard.steps.step4Label'),
      description: t('orders.wizard.steps.step4Desc'),
      icon: Truck
    },
    {
      id: 5,
      label: t('orders.wizard.steps.step5Label'),
      description: t('orders.wizard.steps.step5Desc'),
      icon: Circle
    },
    {
      id: 6,
      label: t('orders.wizard.steps.step6Label'),
      description: t('orders.wizard.steps.step6Desc'),
      icon: CheckCircle
    }
  ];

  const statusLabel = (status: string) => t(`orders.status.${status}`, { defaultValue: status });

  const resolvedDrawnFields = externalDrawnFields || drawnFields;
  const resolvedOwnerId = ownerIdOverride || user?.uid || '';
  const resolvedDraftId = useMemo(() => (
    draftId || (resolvedOwnerId ? `draft_${resolvedOwnerId}` : 'draft_local')
  ), [draftId, resolvedOwnerId]);
  const storageKey = useMemo(() => `order_draft_${resolvedDraftId}`, [resolvedDraftId]);
  const previousOwnerRef = useRef<string | null>(null);
  const previousStorageKeyRef = useRef<string | null>(null);
  const sessionStorageKey = useMemo(() => `order_draft_session_${resolvedDraftId}`, [resolvedDraftId]);

  const pruneDraftCache = useCallback((keepKey?: string) => {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (!key.startsWith('order_draft_')) continue;
      if (keepKey && key === keepKey) continue;
      keysToRemove.push(key);
    }

    if (keysToRemove.length <= 3) return;

    keysToRemove
      .sort((a, b) => b.localeCompare(a))
      .slice(2)
      .forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch {
        }
      });
  }, []);

  const persistDraftCache = useCallback((key: string, serialized: string) => {
    try {
      localStorage.setItem(key, serialized);
      try {
        sessionStorage.removeItem(sessionStorageKey);
      } catch {
      }
      return;
    } catch (error) {
      pruneDraftCache(key);
      try {
        localStorage.setItem(key, serialized);
        try {
          sessionStorage.removeItem(sessionStorageKey);
        } catch {
        }
        return;
      } catch {
      }

      try {
        sessionStorage.setItem(sessionStorageKey, serialized);
      } catch {
      }

      console.warn('[OrderWizard] Draft cache moved to sessionStorage due storage quota');
    }
  }, [pruneDraftCache, sessionStorageKey]);

  const serializeDraftForStorage = useCallback((value: OrderDraft) => {
    const compactSourceFields = (value.sourceFields || []).map((field) => ({
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      geometry: null,
      labAttributes: field.labAttributes,
      samplingCell: field.samplingCell,
      exportMapping: field.exportMapping
    }));
    const compactFields = (value.fields || []).map((field) => ({
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      status: field.status,
      samplingDepthCm: field.samplingDepthCm,
      services: field.services,
      parameters: field.parameters,
      cropYield: field.cropYield,
      labAttributes: field.labAttributes,
      samplingCell: field.samplingCell,
      exportMapping: field.exportMapping
    }));
    return JSON.stringify({
      ...value,
      sourceFields: compactSourceFields,
      fields: compactFields
    });
  }, []);

  // Update current step when initialStep prop changes
  useEffect(() => {
    setCurrentStep(initialStep);
    onStepChangeRef.current?.(initialStep);
  }, [initialStep]);

  useEffect(() => {
    if (!resolvedOwnerId) return;

    const previousOwner = previousOwnerRef.current;
    const previousStorageKey = previousStorageKeyRef.current;

    if (previousOwner && previousOwner !== resolvedOwnerId) {
      try {
        if (previousStorageKey) {
          localStorage.removeItem(previousStorageKey);
        }
        localStorage.removeItem(storageKey);
        sessionStorage.removeItem(sessionStorageKey);
      } catch (error) {
        console.warn('[OrderWizard] Failed to clear cached draft on owner change:', error);
      }
      setDraft(null);
      setUploadedSourceFields([]);
      setUploadedArchives([]);
    }

    previousOwnerRef.current = resolvedOwnerId;
    previousStorageKeyRef.current = storageKey;
  }, [resolvedOwnerId, storageKey, sessionStorageKey]);

  useEffect(() => {
    if (!externalDrawnFields) return;
    const baseUploaded = externalSourceFields?.length ? externalSourceFields : uploadedSourceFields;
    applySourceFields(baseUploaded, externalDrawnFields);
  }, [externalDrawnFields, uploadedSourceFields, externalSourceFields]);

  useEffect(() => {
    if (!externalSourceFields) return;
    setUploadedSourceFields(prev => {
      const toSimpleSignature = (items: NonNullable<OrderDraft['sourceFields']>) => (
        items.map((field) => [
          field.baseId || '',
          field.baseName || '',
          Number(field.areaHa || 0).toFixed(4),
          field.geometry?.type || 'none'
        ].join('|')).join('||')
      );
      const prevSignature = toSimpleSignature(prev);
      const nextSignature = toSimpleSignature(externalSourceFields);
      return prevSignature === nextSignature ? prev : externalSourceFields;
    });
    applySourceFields(externalSourceFields, resolvedDrawnFields);
  }, [externalSourceFields, resolvedDrawnFields]);

  useEffect(() => {
    if (externalSourceFields) return;
    if (!draft?.sourceFields?.length) return;
    setUploadedSourceFields(prev => {
      if (prev.length > 0) return prev;
      return draft.sourceFields || [];
    });
  }, [draft?.sourceFields, externalSourceFields]);

  const loadDraft = useCallback(async () => {
    if (!resolvedOwnerId) return;

    const local = localStorage.getItem(storageKey) || sessionStorage.getItem(sessionStorageKey);
    if (local) {
      setDraft(normalizeDraftLabConfig(JSON.parse(local)));
      return;
    }
    if (resolvedOwnerId) {
      const remote = await orderService.getDraft(resolvedDraftId, resolvedOwnerId);
      if (remote) {
        const normalizedRemote = normalizeDraftLabConfig(remote);
        setDraft(normalizedRemote);
        setUploadedSourceFields(normalizedRemote.sourceFields || []);
      } else {
        const fresh = normalizeDraftLabConfig(newDraft(resolvedOwnerId, resolvedDraftId, draftName));

        setDraft(fresh);
        persistDraftCache(storageKey, serializeDraftForStorage(fresh));
      }
    }
  }, [storageKey, sessionStorageKey, resolvedOwnerId, resolvedDraftId, draftName, serializeDraftForStorage, persistDraftCache]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!draft || !resolvedOwnerId) return;

    let cancelled = false;
    const currentDraftId = draft.id;

    const hydrateProfileDefaults = async () => {
      const fallbackEmail = resolvedOwnerId === user?.uid ? (user?.email || undefined) : undefined;
      try {
        const userProfile = await userProfileService.getProfile(resolvedOwnerId);
        if (cancelled) return;
        setDraft(prev => {
          if (!prev || prev.id !== currentDraftId) return prev;
          return withUserProfileDefaults(prev, userProfile, fallbackEmail);
        });
      } catch (error) {
        console.error(t('orders.wizard.logs.profileLoadFailed'), error);
        if (cancelled || !fallbackEmail) return;
        setDraft(prev => {
          if (!prev || prev.id !== currentDraftId) return prev;
          return withUserProfileDefaults(prev, null, fallbackEmail);
        });
      }
    };

    hydrateProfileDefaults();

    return () => {
      cancelled = true;
    };
  }, [draft?.id, resolvedOwnerId, user?.uid, user?.email, t]);

  useEffect(() => {
    setUploadedArchives([]);
    setSelectedFiles([]);
    setUploadCollapsed(false);
  }, [resolvedDraftId]);

  useEffect(() => {
    if (!draft || !draftName) return;
    if (draft.name && draft.name.trim().length > 0) return;
    setDraft(prev => (prev ? { ...prev, name: draftName } : prev));
  }, [draft, draftName]);

  useEffect(() => {
    if (!draft) return;
    persistDraftCache(storageKey, serializeDraftForStorage(draft));
  }, [draft, storageKey, serializeDraftForStorage, persistDraftCache]);

  useEffect(() => {
    if (!draft?.fields?.length) return;
    if (applyToAll) {
      if (selectedFieldIds.length) {
        setSelectedFieldIds([]);
      }
      if (activeFieldId) {
        setActiveFieldId(null);
      }
      return;
    }
    if (!activeFieldId) {
      setActiveFieldId(draft.fields[0].fieldId);
    }
    if (!selectedFieldIds.length) {
      setSelectedFieldIds([draft.fields[0].fieldId]);
    }
  }, [draft?.fields, activeFieldId, selectedFieldIds.length, applyToAll]);

  // Auto-apply parameters to all fields when "Apply to all" is checked
  useEffect(() => {
    if (!applyToAll) return;
    setDraft(prev => {
      if (!prev || !prev.parameters || !prev.fields?.length) return prev;
      if (!prev.parameters.landUseType) return prev;
      const allCompleted = prev.fields.every(field => field.status === 'completed');
      if (allCompleted) return prev;
      const updatedFields = prev.fields.map(field => ({
        ...field,
        parameters: prev.parameters,
        status: 'completed' as const
      }));
      return {
        ...prev,
        fields: updatedFields
      };
    });
  }, [applyToAll, draft?.parameters?.landUseType]);


  const canContinue = Boolean(
    draft?.consent.dataProtectionAccepted &&
    draft?.consent.dataProcessingAccepted &&
    draft?.consent.digitalDocsOnlyAccepted &&
    draft?.consent.termsAccepted
  );

  const fieldsReady = Boolean(draft?.fields?.length);
  const allFieldsCompleted = Boolean(draft?.fields?.length && draft.fields.every(field => field.status === 'completed'));
  const parametersReady = Boolean(
    draft?.fields?.length
    && draft.fields.every((field) => String(field.parameters?.landUseType || draft.parameters?.landUseType || '').trim().length > 0)
  );
  const isLufaLab = draft?.labProvider === 'lufa_nrw';
  const agrolabMetadataEnabled = Boolean(draft?.agrolabMetadataEnabled);
  const lufaImportEnabled = Boolean(draft?.lufaImportEnabled);
  const lufaConfig = useMemo(() => (
    draft?.lufaImport || createDefaultLufaImport('DED')
  ), [draft?.lufaImport]);

  const lufaAdrnrValidation = useMemo(() => {
    if (!isLufaLab || !lufaImportEnabled) {
      return { ready: true, invalidKeys: [] as string[] };
    }

    const checks: Array<[LufaAdrnrKey, string | undefined]> = LUFA_ADRNR_KEYS.map((key) => [
      key,
      lufaConfig[key]
    ]);

    const invalidKeys = checks
      .filter(([, value]) => !isValidLufaAdrnr(value))
      .map(([key]) => key);

    return {
      ready: invalidKeys.length === 0,
      invalidKeys
    };
  }, [isLufaLab, lufaImportEnabled, lufaConfig.kundeAdrnr, lufaConfig.auftraggeberAdrnr, lufaConfig.kostentraegerAdrnr, lufaConfig.durchschriftenempfaengerAdrnr]);

  const lufaNminLayerValidation = useMemo(() => {
    if (!isLufaLab || !lufaImportEnabled || lufaConfig.standarduntersuchungsumfang !== 'Nmin') {
      return { ready: true, reason: '' };
    }

    const layers = lufaConfig.nminLayers || [];
    if (!layers.length) {
      return { ready: false, reason: 'empty' };
    }

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const from = Number(layer.depthFromCm);
      const to = Number(layer.depthToCm);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return { ready: false, reason: 'invalid-range' };
      }
      if (index > 0) {
        const previous = layers[index - 1];
        if (from < Number(previous.depthToCm)) {
          return { ready: false, reason: 'overlap' };
        }
      }
    }

    return { ready: true, reason: '' };
  }, [isLufaLab, lufaImportEnabled, lufaConfig.standarduntersuchungsumfang, lufaConfig.nminLayers]);

  const evaluateAgrolabReadiness = useCallback((value: OrderDraft | null | undefined) => {
    const labMeta = {
      ...createDefaultLabMeta(),
      ...(value?.labMeta || {})
    };
    const samplingDetails = {
      ...createDefaultSamplingDetails(),
      ...(value?.samplingDetails || {})
    };
    const fields = value?.fields || [];

    const labMetaReady = AGROLAB_REQUIRED_LAB_META_KEYS.every((key) => String(labMeta[key] || '').trim().length > 0);
    const samplingReady = AGROLAB_REQUIRED_SAMPLING_KEYS.every((key) => String(samplingDetails[key] || '').trim().length > 0);
    const fieldMetaReady = Boolean(
      fields.length && fields.every((field) => (
        String(field.transportTracking || '').trim().length > 0
        && String(field.soilType || '').trim().length > 0
        && String(field.humusClass || '').trim().length > 0
      ))
    );

    return {
      labMetaReady,
      samplingReady,
      fieldMetaReady,
      ready: labMetaReady && samplingReady && fieldMetaReady
    };
  }, []);

  const agrolabReadiness = useMemo(() => (
    agrolabMetadataEnabled
      ? evaluateAgrolabReadiness(draft)
      : {
        labMetaReady: true,
        samplingReady: true,
        fieldMetaReady: true,
        ready: true
      }
  ), [draft, evaluateAgrolabReadiness, agrolabMetadataEnabled]);

  // LUFA import config is optional in the current flow.
  const labConfigReady = isLufaLab
    ? true
    : agrolabReadiness.ready;
  const submitReady = canContinue && fieldsReady && parametersReady && allFieldsCompleted && labConfigReady;

  const agrolabLabMeta = useMemo(() => ({
    ...createDefaultLabMeta(),
    ...(draft?.labMeta || {})
  }), [draft?.labMeta]);

  const agrolabSamplingDetails = useMemo(() => ({
    ...createDefaultSamplingDetails(),
    ...(draft?.samplingDetails || {})
  }), [draft?.samplingDetails]);

  const updateLufaImport = useCallback((patch: Partial<NonNullable<OrderDraft['lufaImport']>>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const current = prev.lufaImport || createDefaultLufaImport('DED');
      return {
        ...prev,
        lufaImport: {
          ...current,
          ...patch
        }
      };
    });
  }, []);

  const setLufaImportConfigEnabled = useCallback((enabled: boolean) => {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lufaImportEnabled: enabled
      };
    });
  }, []);

  const setAgrolabMetadataConfigEnabled = useCallback((enabled: boolean) => {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        agrolabMetadataEnabled: enabled
      };
    });
  }, []);

  const updateLufaKennzeichnungValue = useCallback((key: string, value: string) => {
    const nextDefaults = {
      ...(lufaConfig.defaultKennzeichnung || {}),
      [key]: value
    };
    updateLufaImport({ defaultKennzeichnung: nextDefaults });
  }, [lufaConfig.defaultKennzeichnung, updateLufaImport]);

  const updateLufaNminLayer = useCallback((index: number, key: 'depthFromCm' | 'depthToCm', value: number) => {
    const layers = [...(lufaConfig.nminLayers || [])];
    if (!layers[index]) return;
    layers[index] = {
      ...layers[index],
      [key]: value
    };
    updateLufaImport({ nminLayers: layers });
  }, [lufaConfig.nminLayers, updateLufaImport]);

  const addLufaNminLayer = useCallback(() => {
    const layers = [...(lufaConfig.nminLayers || [])];
    const lastTo = layers.length ? Number(layers[layers.length - 1].depthToCm) : 0;
    layers.push({ depthFromCm: lastTo, depthToCm: lastTo + 30 });
    updateLufaImport({ nminLayers: layers });
  }, [lufaConfig.nminLayers, updateLufaImport]);

  const removeLufaNminLayer = useCallback((index: number) => {
    const layers = [...(lufaConfig.nminLayers || [])];
    if (layers.length <= 1) return;
    layers.splice(index, 1);
    updateLufaImport({ nminLayers: layers });
  }, [lufaConfig.nminLayers, updateLufaImport]);

  const downloadTextFile = useCallback((fileName: string, content: string, mimeType: string) => {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName) || 'export.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const createExportLog = useCallback(async (
    templateId: string,
    templateVersion: string,
    fileName: string,
    status: 'generated' | 'error' = 'generated'
  ) => {
    if (!user?.uid || !draft?.id) return;
    const logId = `${draft.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await orderExportService.createExportLog({
      id: logId,
      orderId: draft.id,
      templateId,
      templateVersion,
      status,
      createdAt: new Date().toISOString(),
      createdBy: user.uid,
      fileName
    });
  }, [user?.uid, draft?.id]);

  const downloadAgrolabCsv = useCallback(async (targetDraft?: OrderDraft) => {
    const draftForExport = targetDraft || draft;
    if (!draftForExport) return;

    const agrolabCheck = evaluateAgrolabReadiness(draftForExport);
    const shouldValidateAgrolabMetadata = Boolean(draftForExport.agrolabMetadataEnabled);
    if (shouldValidateAgrolabMetadata && !agrolabCheck.ready) {
      await showConfirmation(
        t('orders.wizard.agrolabValidationTitle'),
        t('orders.wizard.agrolabValidationBeforeExport'),
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true
        }
      );
      return;
    }

    const fileName = `${draftForExport.id || 'order'}_agrolab.csv`;
    try {
      const csv = generateAgrolabCsv(draftForExport);
      downloadTextFile(fileName, csv, 'text/csv;charset=utf-8');
      await createExportLog('agrolab-csv', 'v1', fileName, 'generated');
    } catch (error) {
      await createExportLog('agrolab-csv', 'v1', fileName, 'error');
      const message = error instanceof Error ? error.message : (t('common.unknownError'));
      await showConfirmation(
        t('orders.wizard.submitErrorTitle'),
        t('orders.wizard.submitError', { message }) || `Failed to generate Agrolab CSV: ${message}`,
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true
        }
      );
    }
  }, [draft, evaluateAgrolabReadiness, createExportLog, downloadTextFile, showConfirmation, t]);

  const downloadLufaXml = useCallback(async (targetDraft?: OrderDraft) => {
    const draftForExport = targetDraft || draft;
    if (!draftForExport) return;

    const labIsLufa = draftForExport.labProvider === 'lufa_nrw';
    const config = draftForExport.lufaImport || createDefaultLufaImport('DED');
    if (labIsLufa && draftForExport.lufaImportEnabled) {
      const requiredAdrnrValues = [
        config.kundeAdrnr,
        config.auftraggeberAdrnr,
        config.kostentraegerAdrnr,
        config.durchschriftenempfaengerAdrnr
      ];
      const adrnrReady = requiredAdrnrValues.every((value) => isValidLufaAdrnr(value));
      const layers = config.nminLayers || [];
      const nminLayersReady = config.standarduntersuchungsumfang !== 'Nmin' || (
        layers.length > 0 && layers.every((layer) => Number(layer.depthToCm) > Number(layer.depthFromCm))
      );
      if (!adrnrReady || !nminLayersReady) {
        await showConfirmation(
          t('orders.wizard.lufaValidationTitle'),
          t('orders.wizard.lufaValidationBeforeExport'),
          {
            type: 'warning',
            confirmText: t('common.ok'),
            hideCancel: true
          }
        );
        return;
      }
    }

    const fileName = `${draftForExport.id || 'order'}_lufa_import.xml`;
    try {
      const xml = buildLufaImportXml(draftForExport);
      downloadTextFile(fileName, xml, 'application/xml;charset=utf-8');
      await createExportLog('lufa-stdxml-import', 'v1', fileName, 'generated');
    } catch (error) {
      await createExportLog('lufa-stdxml-import', 'v1', fileName, 'error');
      const message = error instanceof Error ? error.message : (t('common.unknownError'));
      await showConfirmation(
        t('orders.wizard.submitErrorTitle'),
        t('orders.wizard.submitError', { message }) || `Failed to generate LUFA XML: ${message}`,
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true
        }
      );
    }
  }, [draft, createExportLog, downloadTextFile, showConfirmation, t]);

  const updateCustomer = (key: keyof NonNullable<OrderDraft['customerProfile']>, value: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      customerProfile: {
        ...draft.customerProfile,
        [key]: value
      }
    });
  };

  const updateBilling = (key: keyof NonNullable<OrderDraft['billingRecipient']>, value: string | boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      billingRecipient: {
        ...(draft.billingRecipient || { isDifferent: false }),
        [key]: value
      }
    });
  };

  const updatePricing = (key: keyof NonNullable<OrderDraft['pricing']>, value: number | string | undefined) => {
    if (!draft) return;
    setDraft({
      ...draft,
      pricing: {
        ...draft.pricing,
        [key]: value
      }
    });
  };

  const updateLabMeta = (
    key: keyof NonNullable<OrderDraft['labMeta']>,
    value: string | boolean
  ) => {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        labMeta: {
          ...createDefaultLabMeta(),
          ...(prev.labMeta || {}),
          [key]: value
        }
      };
    });
  };

  const updateSamplingDetails = (
    key: keyof NonNullable<OrderDraft['samplingDetails']>,
    value: string
  ) => {
    setDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        samplingDetails: {
          ...createDefaultSamplingDetails(),
          ...(prev.samplingDetails || {}),
          [key]: value
        }
      };
    });
  };


  const updateFieldSamplingDepth = (fieldId: string, depth: string) => {
    if (!draft || !draft.fields?.length) return;
    setDraft({
      ...draft,
      fields: draft.fields.map(field => (field.fieldId === fieldId ? { ...field, samplingDepthCm: depth } : field))
    });
  };

  const updateFieldMeta = (fieldId: string, patch: Partial<NonNullable<OrderDraft['fields']>[number]>) => {
    setDraft(prev => {
      if (!prev || !prev.fields?.length) return prev;
      return {
        ...prev,
        fields: prev.fields.map(field => (field.fieldId === fieldId ? { ...field, ...patch } : field))
      };
    });
  };

  const updateFieldServices = (services: OrderServiceType[]) => {
    setDraft(prev => {
      if (!prev || !prev.fields?.length) return prev;
      const targetIds = new Set(getSelectedFieldIds());
      const shouldApplyAll = applyToAll;
      if (!shouldApplyAll && targetIds.size === 0) {
        return prev;
      }
      const nextParameters = buildParametersForServices(services, prev.parameters);
      const depthOptions = getDepthOptionsForServices(services);
      const defaultDepth = depthOptions.includes('0-30/30-60/60-90')
        ? '0-30/30-60/60-90'
        : depthOptions[0];
      let hasChanged = false;
      const nextFields = prev.fields.map(field => {
        const shouldUpdate = shouldApplyAll || targetIds.has(field.fieldId);
        if (!shouldUpdate) return field;
        const nextField = {
          ...field,
          services,
          parameters: nextParameters,
          samplingDepthCm: defaultDepth || field.samplingDepthCm,
          status: 'completed' as const
        };
        if (JSON.stringify(field) !== JSON.stringify(nextField)) {
          hasChanged = true;
        }
        return nextField;
      });

      if (!hasChanged && (!shouldApplyAll || JSON.stringify(prev.parameters || {}) === JSON.stringify(nextParameters))) {
        return prev;
      }

      return {
        ...prev,
        ...(shouldApplyAll ? { parameters: nextParameters } : {}),
        fields: nextFields
      };
    });
  };

  function resolveFieldValue(props: Record<string, any> | undefined, keys: string[], fallback: string) {
    if (!props) return fallback;
    for (const key of keys) {
      const value = props[key];
      if (value != null && String(value).trim().length > 0) return String(value).trim();
    }
    return fallback;
  }

  const parseShapefileFile = useCallback(async (file: File) => {
    let geo: any;
    try {
      const buffer = await file.arrayBuffer();
      geo = await shp(buffer);
      if (!geo) {
        throw new Error(t('orders.wizard.shapefileNoData'));
      }
    } catch (error) {
      console.error(t('orders.wizard.logs.shapefileParseFailed'), error);
      const message = error instanceof Error ? error.message : (t('common.unknownError'));
      alert(t('orders.wizard.shapefileError', { message }) || `Failed to parse shapefile: ${message}. Please ensure the file is a valid ZIP containing shapefile components (.shp, .shx, .dbf).`);
      return null;
    }

    const featureCollections = Array.isArray(geo) ? geo : [geo];
    const features = featureCollections.flatMap(collection => (collection?.features || []));

    if (features.length === 0) {
      alert(t('orders.wizard.shapefileNoFeatures'));
      return null;
    }

    const polygonFeatures = features.filter(feature => {
      const type = feature?.geometry?.type;
      return type === 'Polygon' || type === 'MultiPolygon';
    });

    if (polygonFeatures.length === 0) {
      alert(t('orders.wizard.shapefileNoPolygons'));
      return null;
    }

    const sourceFields = polygonFeatures.map((feature, index) => {
      const props = (feature?.properties as Record<string, any>) || {};
      const baseId = resolveFieldValue(props, ['Schlagnr', 'SCHLAGNR', 'field_id', 'FieldID', 'ID', 'id', 'FID'], `F${index + 1}`);
      const baseName = resolveFieldValue(props, ['Schlagname', 'SCHLAGNAME', 'name', 'NAME', 'field_name', 'FieldName'], baseId);
      const areaHa = Number((area(feature) / 10000).toFixed(2));
      return { baseId, baseName, areaHa, geometry: feature.geometry };
    });

    return sourceFields;
  }, [t]);

  const applyUploadedArchives = useCallback((archives: Array<{ id: string; name: string; fields: NonNullable<OrderDraft['sourceFields']> }>) => {
    if (!draft) return;
    const combined = archives.flatMap((archive) => archive.fields);
    setUploadedSourceFields(combined);
    applySourceFields(combined, resolvedDrawnFields, combined.length ? {
      shapefileUpload: {
        fileName: archives.map((archive) => archive.name).join(', '),
        uploadedAt: new Date().toISOString()
      }
    } : {
      shapefileUpload: undefined
    });
    onFieldsLoaded?.(combined);
  }, [applySourceFields, draft, onFieldsLoaded, resolvedDrawnFields]);

  useEffect(() => {
    if (uploadedArchives.length > 0) return;
    const persistedFileName = draft?.shapefileUpload?.fileName?.trim();
    if (!persistedFileName) return;

    const persistedFields =
      (externalSourceFields?.length ? externalSourceFields : null)
      || (uploadedSourceFields.length ? uploadedSourceFields : null)
      || (draft?.sourceFields?.length ? draft.sourceFields : null);

    if (!persistedFields?.length) return;

    setUploadedArchives([
      {
        id: `restored_${resolvedDraftId}`,
        name: persistedFileName,
        fields: persistedFields
      }
    ]);
  }, [
    uploadedArchives.length,
    draft?.shapefileUpload?.fileName,
    draft?.sourceFields,
    externalSourceFields,
    uploadedSourceFields,
    resolvedDraftId
  ]);

  const loadSelectedFiles = async () => {
    if (!draft || !selectedFiles.length) return;
    setIsLoadingShapefile(true);
    try {
      const parsedArchives: Array<{ id: string; name: string; fields: NonNullable<OrderDraft['sourceFields']> }> = [];
      for (const file of selectedFiles) {
        const fields = await parseShapefileFile(file);
        if (!fields) continue;
        parsedArchives.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          fields
        });
      }

      if (parsedArchives.length) {
        const nextArchives = [...uploadedArchives, ...parsedArchives];
        setUploadedArchives(nextArchives);
        applyUploadedArchives(nextArchives);
        setUploadCollapsed(false);
      } else {
        alert(t('orders.wizard.shapefileNoData'));
      }
    } finally {
      setIsLoadingShapefile(false);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeSelectedFile = (targetIndex: number) => {
    setSelectedFiles(prev => prev.filter((_, index) => index !== targetIndex));
  };

  const removeUploadedArchive = (archiveId: string) => {
    const nextArchives = uploadedArchives.filter((archive) => archive.id !== archiveId);
    setUploadedArchives(nextArchives);
    applyUploadedArchives(nextArchives);
  };

  const clearUploadedArchives = () => {
    setUploadedArchives([]);
    setSelectedFiles([]);
    applyUploadedArchives([]);
  };

  const toggleService = (service: OrderServiceType) => {
    setDraft(prev => {
      if (!prev) return prev;
      const exists = prev.serviceSelection.services.includes(service);
      const services = exists
        ? prev.serviceSelection.services.filter(item => item !== service)
        : [...prev.serviceSelection.services, service];
      return {
        ...prev,
        serviceSelection: {
          ...prev.serviceSelection,
          services
        },
        parameters: buildParametersForServices(services, prev.parameters)
      };
    });
  };

  const updateConsent = (key: keyof OrderDraft['consent']) => {
    if (!draft) return;
    setDraft({
      ...draft,
      consent: {
        ...draft.consent,
        [key]: !draft.consent[key]
      }
    });
  };

  const updateFieldCrop = (fieldId: string, index: number, key: 'crop' | 'yield', value: string) => {
    setDraft(prev => {
      if (!prev || !prev.fields?.length) return prev;
      const legacyCrops = prev.cropYield?.crops;
      return {
        ...prev,
        fields: prev.fields.map(field => {
          if (field.fieldId !== fieldId) return field;
          const crops = normalizeCrops(field.cropYield?.crops || legacyCrops);
          crops[index] = { ...crops[index], [key]: value };
          return {
            ...field,
            cropYield: { crops }
          };
        })
      };
    });
  };

  const buildFieldsFromSource = (sourceFields: NonNullable<OrderDraft['sourceFields']>, gridSize: 3 | 5) => {
    return sourceFields.flatMap(source => {
      if (source.samplingCell) {
        return [{
          fieldId: source.baseId,
          fieldName: source.baseName,
          status: 'pending' as const,
          areaHa: Number(source.areaHa || 0),
          baseId: source.baseId,
          baseName: source.baseName,
          labAttributes: source.labAttributes,
          samplingCell: source.samplingCell,
          exportMapping: source.exportMapping,
        }];
      }

      const splitCount = Math.max(1, Math.ceil(source.areaHa / gridSize));
      return Array.from({ length: splitCount }, (_, index) => {
        const suffix = index + 1;
        const fieldId = `${source.baseId}.${suffix}`;
        const fieldName = `${source.baseName}.${suffix}`;
        return {
          fieldId,
          fieldName,
          status: 'pending' as const,
          areaHa: Number((source.areaHa / splitCount).toFixed(2)),
          baseId: source.baseId,
          baseName: source.baseName,
          labAttributes: source.labAttributes,
          exportMapping: {
            sampleKey: fieldId,
            sampleDisplayName: fieldName,
            sourceBaseId: source.baseId,
            sourceBaseName: source.baseName,
          },
        };
      });
    });
  };

  const toggleFieldSelection = (fieldId: string, multiSelect: boolean, baseId?: string) => {
    if (applyToAll) {
      setApplyToAll(false);
    }
    setActiveFieldId(fieldId);
    if (baseId) {
      onFieldFocusRequest?.(baseId);
    }
    setSelectedFieldIds((prev) => {
      if (!multiSelect) {
        return [fieldId];
      }
      if (prev.includes(fieldId)) {
        return prev.filter(id => id !== fieldId);
      }
      return [...prev, fieldId];
    });
  };

  const resolveParameterBadges = useCallback((params?: OrderDraft['parameters']) => {
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
  }, []);

  const serviceParameterKeys = useMemo<Array<keyof NonNullable<OrderDraft['parameters']>>>(() => ([
    'traceElements',
    'organicMatter',
    'cnRatio',
    'potassiumFixation',
    'calcium',
    'cecEffective',
    'cecPotential',
    'particleSizeDistribution',
    'phosphorusReleaseRate'
  ]), []);

  const buildParametersForServices = useCallback((services: OrderServiceType[], base?: OrderDraft['parameters']) => {
    const hasBasic = services.includes('basic_nutrients');
    return {
      landUseType: base?.landUseType,
      cropResiduesRemoved: base?.cropResiduesRemoved,
      standardPackage: true,
      traceElements: false,
      organicMatter: hasBasic,
      cnRatio: hasBasic,
      potassiumFixation: hasBasic,
      calcium: hasBasic,
      cecEffective: hasBasic,
      cecPotential: hasBasic,
      particleSizeDistribution: hasBasic,
      phosphorusReleaseRate: hasBasic
    };
  }, []);

  const areServiceParametersAligned = useCallback((current: OrderDraft['parameters'] | undefined, next: OrderDraft['parameters']) => {
    if (!current) return false;
    return serviceParameterKeys.every(key => Boolean(current[key]) === Boolean(next[key]));
  }, [serviceParameterKeys]);

  const resolveServiceLabels = useCallback((services: OrderServiceType[]) => (
    services.map(service => {
      if (service === 'basic_nutrients') return t('orders.wizard.serviceBasic');
      if (service === 'nmin') return t('orders.wizard.serviceNmin');
      if (service === 'nematodes') return t('orders.wizard.serviceNematodes');
      return service;
    })
  ), [t]);

  const mapDrawnFields = (fields: DrawnField[]) =>
    fields.map(field => ({
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      geometry: field.geometry
    }));

  const buildGeometrySignature = useCallback((geometry: any) => {
    if (!geometry || typeof geometry !== 'object') return 'none';
    const type = String(geometry.type || 'unknown');
    let pointCount = 0;
    let branchCount = 0;

    const walk = (node: any) => {
      if (!Array.isArray(node)) return;
      if (!node.length) return;
      if (typeof node[0] === 'number') {
        pointCount += 1;
        return;
      }
      branchCount += 1;
      node.forEach(walk);
    };

    walk(geometry.coordinates);
    return `${type}:${branchCount}:${pointCount}`;
  }, []);

  const buildSourceSignature = useCallback((fields: NonNullable<OrderDraft['sourceFields']>) => (
    fields.map((field) => [
      field.baseId || '',
      field.baseName || '',
      Number(field.areaHa || 0).toFixed(4),
      buildGeometrySignature(field.geometry)
    ].join('|')).join('||')
  ), [buildGeometrySignature]);

  const buildFieldSignature = useCallback((fields: NonNullable<OrderDraft['fields']>) => (
    fields.map((field) => [
      field.fieldId,
      field.baseId || '',
      field.baseName || '',
      Number(field.areaHa || 0).toFixed(4),
      field.status || 'pending',
      field.samplingDepthCm || ''
    ].join('|')).join('||')
  ), []);

  const resolvedUploadedFields = useMemo(() => (
    externalSourceFields?.length
      ? externalSourceFields
      : uploadedSourceFields
  ), [externalSourceFields, uploadedSourceFields]);

  const resolvedSourceFields = useMemo(() => (
    [...resolvedUploadedFields, ...mapDrawnFields(resolvedDrawnFields)]
  ), [resolvedUploadedFields, resolvedDrawnFields]);

  const mergeFieldsFromSource = useCallback((
    sourceFields: NonNullable<OrderDraft['sourceFields']>,
    existingFields: NonNullable<OrderDraft['fields']> | undefined,
    gridSize: 3 | 5
  ) => {
    const nextFields = buildFieldsFromSource(sourceFields, gridSize);
    if (!existingFields?.length) return nextFields;

    const existingFieldMap = new Map(existingFields.map((field) => [field.fieldId, field]));
    return nextFields.map((field) => {
      const existing = existingFieldMap.get(field.fieldId);
      return existing ? { ...field, ...existing } : field;
    });
  }, []);

  const rebuildFieldsFromSource = useCallback((sourceFields: NonNullable<OrderDraft['sourceFields']>) => {
    return mergeFieldsFromSource(sourceFields, draft?.fields, draft?.gridSizeHa || 5);
  }, [draft?.fields, draft?.gridSizeHa, mergeFieldsFromSource]);

  const getResolvedFields = useCallback(() => (
    draft?.fields?.length
      ? draft.fields
      : (resolvedSourceFields.length ? buildFieldsFromSource(resolvedSourceFields, draft?.gridSizeHa || 5) : [])
  ), [draft?.fields, draft?.gridSizeHa, resolvedSourceFields]);


  const serviceDepthOptions = useMemo(() => {
    const services = draft?.serviceSelection?.services || [];
    const options = new Set<string>();
    if (services.includes('basic_nutrients')) {
      options.add('0-30');
      options.add('30-60');
      options.add('60-90');
      options.add('0-30/30-60/60-90');
    }
    if (services.includes('nmin') || services.includes('nematodes')) {
      options.add('0-30');
    }
    return Array.from(options);
  }, [draft?.serviceSelection?.services]);

  const derivedDraftParameters = useMemo(() => (
    buildParametersForServices(draft?.serviceSelection?.services || [], draft?.parameters)
  ), [draft?.serviceSelection?.services, draft?.parameters, buildParametersForServices]);

  const selectedStep4Field = useMemo(() => {
    if (applyToAll || !activeFieldId || !draft?.fields?.length) return null;
    return draft.fields.find(field => field.fieldId === activeFieldId) || null;
  }, [applyToAll, activeFieldId, draft?.fields]);

  const selectedStep4FieldCrops = useMemo(() => {
    if (!selectedStep4Field) return normalizeCrops();
    return normalizeCrops(selectedStep4Field.cropYield?.crops || draft?.cropYield?.crops);
  }, [selectedStep4Field, draft?.cropYield?.crops]);

  const getDepthOptionsForServices = useCallback((services: OrderServiceType[]) => {
    const options = new Set<string>();
    if (services.includes('basic_nutrients')) {
      options.add('0-30');
      options.add('30-60');
      options.add('60-90');
      options.add('0-30/30-60/60-90');
    }
    if (services.includes('nmin') || services.includes('nematodes')) {
      options.add('0-30');
    }
    return Array.from(options);
  }, []);


  const buildFieldSummaries = useCallback(() => {
    if (!draft?.fields?.length) {
      if (lastFieldSummariesSignatureRef.current === '{}') {
        return;
      }
      lastFieldSummariesSignatureRef.current = '{}';
      onFieldSummariesChangeRef.current?.({});
      return;
    }

    const summaryMap: Record<string, { statuses: Array<'pending' | 'completed' | 'skipped'>; badges: Set<string>; services: Set<string> }> = {};

    draft.fields.forEach(field => {
      const key = field.baseId || field.baseName || field.fieldId;
      if (!key) return;
      if (!summaryMap[key]) {
        summaryMap[key] = { statuses: [], badges: new Set(), services: new Set() };
      }
      summaryMap[key].statuses.push(field.status);
      const params = field.parameters || draft.parameters;
      resolveParameterBadges(params || undefined).forEach(badge => summaryMap[key].badges.add(badge));
      const services = field.services?.length ? field.services : (draft.serviceSelection.services || []);
      resolveServiceLabels(services).forEach(label => summaryMap[key].services.add(label));
    });

    const summaries: Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }> = {};
    Object.entries(summaryMap).forEach(([key, entry]) => {
      const statuses = entry.statuses;
      const allCompleted = statuses.every(status => status === 'completed');
      const allSkipped = statuses.every(status => status === 'skipped');
      const allPending = statuses.every(status => status === 'pending');
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

    const summarySignature = JSON.stringify(summaries);
    if (lastFieldSummariesSignatureRef.current === summarySignature) {
      return;
    }
    lastFieldSummariesSignatureRef.current = summarySignature;
    onFieldSummariesChangeRef.current?.(summaries);
  }, [
    draft?.fields,
    draft?.parameters,
    draft?.serviceSelection?.services,
    resolveParameterBadges,
    resolveServiceLabels
  ]);

  useEffect(() => {
    if (!draft) return;
    const services = draft.serviceSelection?.services || [];
    const nextParameters = buildParametersForServices(services, draft.parameters);
    if (!areServiceParametersAligned(draft.parameters, nextParameters)) {
      setDraft(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          parameters: nextParameters
        };
      });
    }
  }, [draft?.serviceSelection?.services, buildParametersForServices, areServiceParametersAligned]);

  useEffect(() => {
    buildFieldSummaries();
  }, [buildFieldSummaries]);

  useEffect(() => {
    if (!draft) return;
    let nextFieldServiceSelection: OrderServiceType[];

    if (applyToAll) {
      nextFieldServiceSelection = draft.serviceSelection.services || [];
    } else if (selectedFieldIds.length === 0) {
      nextFieldServiceSelection = [];
    } else if ((!activeFieldId && selectedFieldIds.length) || !draft.fields?.length) {
      const fallbackId = selectedFieldIds[0];
      const fallbackField = draft.fields?.find(field => field.fieldId === fallbackId);
      if (fallbackField?.services?.length) {
        nextFieldServiceSelection = fallbackField.services;
      } else {
        nextFieldServiceSelection = draft.serviceSelection.services || [];
      }
    } else {
      const activeField = draft.fields.find(field => field.fieldId === activeFieldId);
      nextFieldServiceSelection = activeField?.services?.length
        ? activeField.services
        : (draft.serviceSelection.services || []);
    }

    setFieldServiceSelection((prev) => (
      areOrderedValuesEqual(prev, nextFieldServiceSelection) ? prev : nextFieldServiceSelection
    ));
  }, [activeFieldId, applyToAll, draft?.fields, draft?.serviceSelection?.services, selectedFieldIds]);

  useEffect(() => {
    if (!selectedFieldIds.length) return;
    if (!activeFieldId || !selectedFieldIds.includes(activeFieldId)) {
      setActiveFieldId(selectedFieldIds[0]);
    }
  }, [selectedFieldIds, activeFieldId]);

  useEffect(() => {
    onGridPreviewChangeRef.current?.({
      enabled: showGridPreview,
      sizeHa: draft?.gridSizeHa || 5,
    });
  }, [showGridPreview, draft?.gridSizeHa]);

  const step1Ready = Boolean(draft?.serviceSelection?.services?.length);
  const step2Ready = Boolean(
    draft?.customerProfile?.firstName?.trim()
    && draft?.customerProfile?.lastName?.trim()
    && draft?.customerProfile?.email?.trim()
  );
  const step3Ready = Boolean(resolvedSourceFields.length || uploadedSourceFields.length || draft?.sourceFields?.length);
  const step4Ready = Boolean(draft?.gridSizeHa);
  const step5Ready = fieldsReady && parametersReady && allFieldsCompleted;
  const samplingCellCount = useMemo(() => (
    (draft?.sourceFields || []).filter((field) => Boolean(field.samplingCell)).length
  ), [draft?.sourceFields]);
  const compactStepSectionClass = singleStepMode ? 'space-y-2.5 p-1.5 sm:p-2.5' : 'space-y-3 p-3 sm:p-4';
  const compactStepSectionLooseClass = singleStepMode ? 'space-y-3 p-1.5 sm:p-2.5' : 'space-y-6 p-3 sm:p-4';

  useEffect(() => {
    const nextReadiness = {
      step1Ready,
      step2Ready,
      step3Ready,
      step4Ready,
      step5Ready,
      step6Ready: submitReady
    };

    const previousReadiness = lastStepReadinessRef.current;
    if (
      previousReadiness
      && previousReadiness.step1Ready === nextReadiness.step1Ready
      && previousReadiness.step2Ready === nextReadiness.step2Ready
      && previousReadiness.step3Ready === nextReadiness.step3Ready
      && previousReadiness.step4Ready === nextReadiness.step4Ready
      && previousReadiness.step5Ready === nextReadiness.step5Ready
      && previousReadiness.step6Ready === nextReadiness.step6Ready
    ) {
      return;
    }

    lastStepReadinessRef.current = nextReadiness;
    onStepReadinessChangeRef.current?.(nextReadiness);
  }, [step1Ready, step2Ready, step3Ready, step4Ready, step5Ready, submitReady]);

  const getSelectedFieldIds = useCallback(() => {
    const resolvedIds = getResolvedFields().map((field) => field.fieldId);
    const resolvedIdSet = new Set(resolvedIds);
    if (applyToAll) {
      return resolvedIds;
    }
    return selectedFieldIds.filter((id) => resolvedIdSet.has(id));
  }, [applyToAll, getResolvedFields, selectedFieldIds]);

  const switchToAllScope = useCallback(() => {
    setApplyToAll(true);
    setSelectedFieldIds([]);
    setActiveFieldId(null);
    onClearSelectionRequest?.();
  }, [onClearSelectionRequest]);

  const switchToSelectedScope = useCallback(() => {
    const resolvedIds = getResolvedFields().map(field => field.fieldId);
    const preservedSelection = selectedFieldIds.filter((id) => resolvedIds.includes(id));
    const fallbackId = (activeFieldId && resolvedIds.includes(activeFieldId))
      ? activeFieldId
      : (selectedFieldIds.find(id => resolvedIds.includes(id)) || resolvedIds[0] || null);

    setApplyToAll(false);
    if (!fallbackId) {
      setSelectedFieldIds([]);
      setActiveFieldId(null);
      return;
    }

    setSelectedFieldIds(preservedSelection.length ? preservedSelection : [fallbackId]);
    setActiveFieldId(fallbackId);
  }, [activeFieldId, selectedFieldIds, getResolvedFields]);

  useEffect(() => {
    if (!applyToAll) return;
    if (selectedFieldIds.length) {
      setSelectedFieldIds([]);
    }
    if (activeFieldId) {
      setActiveFieldId(null);
    }
  }, [applyToAll, selectedFieldIds.length, activeFieldId]);

  useEffect(() => {
    if (applyToAll) return;
    if (currentStep !== 5) return;
    const fields = getResolvedFields();
    if (!fields.length) return;
    if (!selectedFieldIds.length) {
      setSelectedFieldIds([fields[0].fieldId]);
    }
    if (!activeFieldId || !fields.some(field => field.fieldId === activeFieldId)) {
      setActiveFieldId(fields[0].fieldId);
    }
  }, [currentStep, getResolvedFields, selectedFieldIds.length, activeFieldId, applyToAll]);

  useEffect(() => {
    if (!mapSelectionEvent || !draft?.fields?.length) return;
    if (currentStep !== 4 && currentStep !== 5) return;

    // Process each map selection event exactly once. Without this guard,
    // field updates can re-trigger this effect and toggle the selection back/forth.
    if (lastProcessedMapSelectionTsRef.current === mapSelectionEvent.timestamp) {
      return;
    }
    lastProcessedMapSelectionTsRef.current = mapSelectionEvent.timestamp;

    const normalizeKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const target = normalizeKey(mapSelectionEvent.baseId);
    const matchingIds = draft.fields
      .filter(field => (
        (field.baseId && normalizeKey(field.baseId) === target)
        || (field.baseName && normalizeKey(field.baseName) === target)
        || (field.fieldId && field.fieldId.startsWith(`${String(mapSelectionEvent.baseId).trim()}.`))
      ))
      .map(field => field.fieldId);
    if (!matchingIds.length) return;
    const wasApplyToAll = applyToAll;
    if (applyToAll) {
      setApplyToAll(false);
    }
    setSelectedFieldIds(prev => {
      const baseSelection = wasApplyToAll ? [] : prev;
      if (mapSelectionEvent.ctrlKey) {
        const next = new Set(baseSelection);
        const allSelected = matchingIds.every(id => next.has(id));
        if (allSelected) {
          matchingIds.forEach(id => next.delete(id));
        } else {
          matchingIds.forEach(id => next.add(id));
        }
        return Array.from(next);
      }
      return matchingIds;
    });
    setActiveFieldId(matchingIds[0]);
  }, [mapSelectionEvent, currentStep, draft?.fields, applyToAll]);

  useEffect(() => {
    if (!draft) return;
    const services = draft.serviceSelection?.services || [];
    if (!services.length) return;

    const nextSampling = { ...(draft.samplingRequirements || {}) };
    let samplingChanged = false;

    if (services.includes('basic_nutrients')) {
      if (nextSampling.depthFrom !== 0 || nextSampling.depthTo !== 90) {
        nextSampling.depthFrom = 0;
        nextSampling.depthTo = 90;
        samplingChanged = true;
      }
      if (!nextSampling.notes) {
        nextSampling.notes = 'Depths: 0-30, 30-60, 60-90 cm';
        samplingChanged = true;
      }
    } else if (services.includes('nmin') || services.includes('nematodes')) {
      if (nextSampling.depthFrom !== 0 || nextSampling.depthTo !== 30) {
        nextSampling.depthFrom = 0;
        nextSampling.depthTo = 30;
        samplingChanged = true;
      }
      if (!nextSampling.notes) {
        nextSampling.notes = 'Depth: 0-30 cm';
        samplingChanged = true;
      }
    }

    let fieldsChanged = false;
    let nextFields = draft.fields || [];
    if (nextFields.length) {
      nextFields = nextFields.map(field => {
        const fieldServices = field.services?.length ? field.services : services;
        const depthOptions = getDepthOptionsForServices(fieldServices);
        if (!depthOptions.length) return field;
        const defaultDepth = depthOptions.includes('0-30/30-60/60-90')
          ? '0-30/30-60/60-90'
          : depthOptions[0];
        if (field.samplingDepthCm && depthOptions.some(option => field.samplingDepthCm?.includes(option))) {
          return field;
        }
        fieldsChanged = true;
        return {
          ...field,
          samplingDepthCm: field.samplingDepthCm || defaultDepth
        };
      });
    }

    if (samplingChanged || fieldsChanged) {
      setDraft({
        ...draft,
        samplingRequirements: samplingChanged ? nextSampling : draft.samplingRequirements,
        fields: fieldsChanged ? nextFields : draft.fields
      });
    }

    if (nextFields.length && serviceDepthOptions.length && !applyToAll && selectedFieldIds.length === 0) {
      const matchingIds = nextFields
        .filter(field => {
          if (!field.samplingDepthCm) return false;
          const fieldServices = field.services?.length ? field.services : services;
          const depthOptions = getDepthOptionsForServices(fieldServices);
          return depthOptions.some(option => field.samplingDepthCm?.includes(option));
        })
        .map(field => field.fieldId);

      if (matchingIds.length) {
        setSelectedFieldIds(prev => {
          if (prev.length === matchingIds.length && prev.every((id, index) => id === matchingIds[index])) {
            return prev;
          }
          return matchingIds;
        });
        if (!activeFieldId) {
          setActiveFieldId(matchingIds[0]);
        }
      }
    }
  }, [draft, serviceDepthOptions, activeFieldId, applyToAll, selectedFieldIds.length, getDepthOptionsForServices]);

  function applySourceFields(
    uploaded: NonNullable<OrderDraft['sourceFields']>,
    drawn: DrawnField[],
    patch?: Partial<OrderDraft>
  ) {
    if (!draft) return;

    const combined = [...(uploaded || []), ...mapDrawnFields(drawn)];
    const fields = combined.length ? rebuildFieldsFromSource(combined) : [];
    const currentSourceSignature = buildSourceSignature(draft.sourceFields || []);
    const nextSourceSignature = buildSourceSignature(combined);
    const currentFieldSignature = buildFieldSignature(draft.fields || []);
    const nextFieldSignature = buildFieldSignature(fields);
    const patchChanged = Boolean(patch) && Object.entries(patch as Record<string, unknown>).some(([key, value]) => {
      const previousValue = (draft as Record<string, unknown>)[key];
      return JSON.stringify(previousValue) !== JSON.stringify(value);
    });

    if (!patchChanged && currentSourceSignature === nextSourceSignature && currentFieldSignature === nextFieldSignature) {
      return;
    }

    setDraft(prev => {
      if (!prev) return prev;
      const mergedFields = combined.length ? mergeFieldsFromSource(combined, prev.fields, prev.gridSizeHa || 5) : [];
      const previousSourceSignature = buildSourceSignature(prev.sourceFields || []);
      const previousFieldSignature = buildFieldSignature(prev.fields || []);
      const mergedFieldSignature = buildFieldSignature(mergedFields);
      const previousPatchChanged = Boolean(patch) && Object.entries(patch as Record<string, unknown>).some(([key, value]) => {
        const previousValue = (prev as Record<string, unknown>)[key];
        return JSON.stringify(previousValue) !== JSON.stringify(value);
      });

      if (!previousPatchChanged && previousSourceSignature === nextSourceSignature && previousFieldSignature === mergedFieldSignature) {
        return prev;
      }

      return {
        ...prev,
        ...(patch || {}),
        sourceFields: combined,
        fields: mergedFields
      };
    });
  }

  useEffect(() => {
    if (!resolvedSourceFields.length) return;
    setDraft(prev => {
      if (!prev) return prev;
      const nextFields = mergeFieldsFromSource(resolvedSourceFields, prev.fields, prev.gridSizeHa || 5);
      const currentSourceSignature = buildSourceSignature(prev.sourceFields || []);
      const nextSourceSignature = buildSourceSignature(resolvedSourceFields);
      const currentFieldSignature = buildFieldSignature(prev.fields || []);
      const nextFieldSignature = buildFieldSignature(nextFields);

      if (currentSourceSignature === nextSourceSignature && currentFieldSignature === nextFieldSignature) {
        return prev;
      }

      return {
        ...prev,
        sourceFields: resolvedSourceFields,
        fields: nextFields
      };
    });
  }, [resolvedSourceFields, mergeFieldsFromSource, buildSourceSignature, buildFieldSignature]);

  const updateDrawnFields = (next: DrawnField[]) => {
    if (externalDrawnFields && onExternalDrawnFieldsChange) {
      onExternalDrawnFieldsChange(next);
    } else {
      setDrawnFields(next);
    }
    applySourceFields(resolvedUploadedFields, next);
  };

  const updateDrawnFieldMeta = (id: string, patch: Partial<DrawnField>) => {
    const base = externalDrawnFields || drawnFields;
    const next = base.map(field => (field.id === id ? { ...field, ...patch } : field));
    updateDrawnFields(next);
  };

  const removeDrawnField = (id: string) => {
    const base = externalDrawnFields || drawnFields;
    updateDrawnFields(base.filter(field => field.id !== id));
  };

  const updateGridSize = (size: 3 | 5) => {
    if (!draft) return;
    const sourceFields = draft.sourceFields || [];
    const fields = sourceFields.length ? buildFieldsFromSource(sourceFields, size) : draft.fields || [];
    setDraft({
      ...draft,
      gridSizeHa: size,
      fields
    });
  };

  const convertToSamplingCells = useCallback(async () => {
    if (!draft) return;

    const sourceFields = draft.sourceFields || [];
    if (!sourceFields.length) {
      await showConfirmation(
        t('orders.wizard.convertCellsMissingSourceTitle') || 'No source fields available',
        t('orders.wizard.convertCellsMissingSourceMessage') || 'Please upload or draw fields first.',
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true,
        }
      );
      return;
    }

    const targetGridSize = draft.gridSizeHa || 5;
    setIsConvertingSamplingCells(true);
    try {
      const convertedSourceFields = buildSamplingCellSourceFields(sourceFields, targetGridSize);
      if (!convertedSourceFields.length) {
        return;
      }

      const previousFields = draft.fields || [];
      const convertedFields = buildFieldsFromSource(convertedSourceFields, targetGridSize).map((field) => {
        const parentBaseId = field.samplingCell?.parentBaseId;
        if (!parentBaseId) return field;

        const templateField = previousFields.find((existing) => (
          existing.baseId === parentBaseId
          || existing.fieldId === parentBaseId
          || existing.fieldId.startsWith(`${parentBaseId}.`)
        ));

        if (!templateField) return field;

        return {
          ...field,
          services: templateField.services || field.services,
          parameters: templateField.parameters || field.parameters,
          samplingDepthCm: templateField.samplingDepthCm || field.samplingDepthCm,
          cropYield: templateField.cropYield || field.cropYield,
          status: templateField.status === 'skipped' ? 'skipped' : field.status,
        };
      });

      setUploadedSourceFields(convertedSourceFields);
      onFieldsLoaded?.(convertedSourceFields);
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          sourceFields: convertedSourceFields,
          fields: convertedFields,
        };
      });

      setApplyToAll(true);
      setSelectedFieldIds([]);
      setActiveFieldId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.unknownError');
      await showConfirmation(
        t('orders.wizard.convertCellsErrorTitle') || 'Could not convert to sampling cells',
        t('orders.wizard.convertCellsErrorMessage', { message }) || `Could not convert to sampling cells: ${message}`,
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true,
        }
      );
    } finally {
      setIsConvertingSamplingCells(false);
    }
  }, [draft, buildFieldsFromSource, onFieldsLoaded, showConfirmation, t]);

  const updateParameters = (key: keyof NonNullable<OrderDraft['parameters']>, value: boolean | string) => {
    setDraft(prev => {
      if (!prev) return prev;
      const nextParameters = {
        ...(prev.parameters || buildParametersForServices(prev.serviceSelection.services || [], prev.parameters)),
        standardPackage: true,
        [key]: value
      };
      if (!prev.fields?.length) {
        return {
          ...prev,
          parameters: nextParameters
        };
      }
      const targetIds = new Set(getSelectedFieldIds());
      const shouldApplyAll = applyToAll;
      if (!shouldApplyAll && targetIds.size === 0) {
        return prev;
      }
      const updatedFields = prev.fields.map(field => (
        shouldApplyAll || targetIds.has(field.fieldId)
          ? {
            ...field,
            parameters: nextParameters,
            status: 'completed' as const
          }
          : field
      ));
      return {
        ...prev,
        ...(shouldApplyAll ? { parameters: nextParameters } : {}),
        fields: updatedFields
      };
    });
  };

  const toggleFieldServiceSelection = (service: OrderServiceType) => {
    if (!applyToAll && selectedFieldIds.length === 0) {
      return;
    }
    setFieldServiceSelection(prev => {
      const next = prev.includes(service)
        ? prev.filter(item => item !== service)
        : [...prev, service];
      updateFieldServices(next);
      return next;
    });
  };

  const derivedParametersForSelection = useMemo(() => (
    buildParametersForServices(fieldServiceSelection, draft?.parameters)
  ), [fieldServiceSelection, draft?.parameters, buildParametersForServices]);

  const parameterSelectionKeys = useMemo<Array<Exclude<keyof NonNullable<OrderDraft['parameters']>, 'standardPackage'>>>(() => ([
    'landUseType',
    'cropResiduesRemoved',
    'traceElements',
    'organicMatter',
    'cnRatio',
    'potassiumFixation',
    'calcium',
    'cecEffective',
    'cecPotential',
    'particleSizeDistribution',
    'phosphorusReleaseRate'
  ]), []);

  const editableParametersForSelection = useMemo(() => {
    const fallbackParameters: NonNullable<OrderDraft['parameters']> = {
      standardPackage: true,
      ...(draft?.parameters || derivedParametersForSelection || { standardPackage: true })
    };

    if (applyToAll) {
      return fallbackParameters;
    }

    const selectedIdSet = new Set(selectedFieldIds);
    let scopedFields = (draft?.fields || []).filter((field) => selectedIdSet.has(field.fieldId));

    if (!scopedFields.length && activeFieldId && draft?.fields?.length) {
      const activeField = draft.fields.find((field) => field.fieldId === activeFieldId);
      if (activeField) {
        scopedFields = [activeField];
      }
    }

    if (!scopedFields.length) {
      return fallbackParameters;
    }

    const merged: NonNullable<OrderDraft['parameters']> = {
      ...fallbackParameters,
      standardPackage: true
    };

    parameterSelectionKeys.forEach((key) => {
      const values = scopedFields.map((field) => (
        field.parameters?.[key] ?? fallbackParameters[key]
      ));
      const firstValue = values[0];
      const allSame = values.every((value) => value === firstValue);
      if (allSame) {
        (merged as Record<string, unknown>)[key] = firstValue;
      } else {
        delete (merged as Record<string, unknown>)[key];
      }
    });

    return merged;
  }, [applyToAll, activeFieldId, draft?.fields, draft?.parameters, derivedParametersForSelection, parameterSelectionKeys, selectedFieldIds]);

  const parameterOptions = useMemo(() => ([
    ['traceElements', t('orders.wizard.paramTraceElements')],
    ['organicMatter', t('orders.wizard.paramOrganicMatter')],
    ['cnRatio', t('orders.wizard.paramCnRatio')],
    ['potassiumFixation', t('orders.wizard.paramPotassiumFixation')],
    ['calcium', t('orders.wizard.paramCalcium')],
    ['cecEffective', t('orders.wizard.paramCecEffective')],
    ['cecPotential', t('orders.wizard.paramCecPotential')],
    ['particleSizeDistribution', t('orders.wizard.paramParticleSize')],
    ['phosphorusReleaseRate', t('orders.wizard.paramPhosphorusRelease')]
  ] as Array<[keyof NonNullable<OrderDraft['parameters']>, string]>), [t]);

  const renderParametersPanel = () => (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {applyToAll
            ? (t('orders.wizard.fieldServicesAllTitle'))
            : (t('orders.wizard.fieldServicesTitle'))
          }
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {t('orders.wizard.fieldServicesHint')}
        </div>
        <div className="inline-flex max-w-full rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-1 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={switchToAllScope}
            className={`min-h-10 min-w-0 flex-1 px-3 sm:px-4 text-xs font-semibold transition-all rounded-full flex items-center justify-center ${
              applyToAll
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100/70 dark:hover:bg-gray-800/70'
            }`}
            title={t('orders.wizard.applyAllFields')}
            aria-label={t('orders.wizard.applyAllFields')}
          >
            <span>{t('orders.wizard.applyAllFields')}</span>
          </button>
          <button
            type="button"
            onClick={switchToSelectedScope}
            className={`min-h-10 min-w-0 flex-1 px-3 sm:px-4 text-xs font-semibold transition-all rounded-full flex items-center justify-center ${
              !applyToAll
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100/70 dark:hover:bg-gray-800/70'
            }`}
            title={t('orders.wizard.applySelectedFields')}
            aria-label={t('orders.wizard.applySelectedFields')}
          >
            <span>{t('orders.wizard.applySelectedFields')}</span>
          </button>
        </div>
        {(applyToAll || selectedFieldIds.length > 0) && draft?.fields?.length ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
            {applyToAll
              ? (t('orders.wizard.applyingToAllFields'))
              : (t('orders.wizard.applyingToField', { field: activeFieldId || selectedFieldIds[0] })
                || `Applying to field: ${activeFieldId || selectedFieldIds[0]}`)
            }
          </div>
        ) : null}
        {!applyToAll && selectedFieldIds.length === 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
            {t('orders.wizard.selectFieldStep6')}
          </div>
        )}
        {!applyToAll && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
            {t('orders.wizard.applyToSelectedHint')}
          </div>
        )}
        <div className="grid gap-2">
          {(['basic_nutrients', 'nmin', 'nematodes'] as OrderServiceType[]).map(service => (
            <label key={service} className={`flex items-center gap-3 text-sm ${!applyToAll && selectedFieldIds.length === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}`}>
              <input
                type="checkbox"
                checked={fieldServiceSelection.includes(service)}
                onChange={() => toggleFieldServiceSelection(service)}
                disabled={!applyToAll && selectedFieldIds.length === 0}
              />
              <span>
                {service === 'basic_nutrients' && (t('orders.wizard.serviceBasic'))}
                {service === 'nmin' && (t('orders.wizard.serviceNmin'))}
                {service === 'nematodes' && (t('orders.wizard.serviceNematodes'))}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('orders.wizard.parametersTitle')}
        </div>
        <div className="grid gap-2">
          {parameterOptions.map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={Boolean(editableParametersForSelection?.[key])}
                onChange={(event) => updateParameters(key, event.target.checked)}
                disabled={!applyToAll && selectedFieldIds.length === 0}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {t('orders.wizard.parametersDerivedHint')}
        </div>
      </div>

    </div>
  );


  const submitOrder = async () => {
    if (!draft || !resolvedOwnerId) return;
    if (isSubmitting) return;
    if (!submitReady) return;

    const confirmed = await showConfirmation(
      t('orders.wizard.submitConfirmTitle'),
      t('orders.wizard.submitConfirmMessage'),
      {
        type: 'warning',
        confirmText: t('orders.wizard.submitConfirmConfirm'),
        cancelText: t('orders.wizard.submitConfirmCancel')
      }
    );

    if (!confirmed) return;

    setIsSubmitting(true);

    try {
      const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const submitStartMs = nowMs();
      const sourceFields = draft.sourceFields || [];
      const submitSessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const buildBoundaryId = (value: string) => value
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
      const hashString = (value: string) => {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
          hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36);
      };
      const createBoundaries = async () => {
        if (!sourceFields.length) return;
        const usedIds = new Set<string>();
        const results = await Promise.all(sourceFields.map((field, index) => {
          if (!field.geometry) return Promise.resolve();
          const name = field.baseName || field.baseId || `Field ${index + 1}`;
          const properties = {
            baseId: field.baseId,
            baseName: field.baseName,
            areaHa: field.areaHa
          };
          const idBase = field.baseId || field.baseName || `${draft.id}_${index + 1}`;
          const safeBase = buildBoundaryId(String(idBase)) || `shape_${index + 1}`;
          const geometryHash = hashString(JSON.stringify(field.geometry));
          let boundaryId = `${safeBase}_${geometryHash}`;
          let dedupeIndex = 1;
          while (usedIds.has(boundaryId)) {
            boundaryId = `${safeBase}_${geometryHash}_${dedupeIndex++}`;
          }
          usedIds.add(boundaryId);
          return firebaseGPS.createFieldBoundary(
            resolvedOwnerId,
            draft.id,
            name,
            field.geometry,
            '#3B82F6',
            properties,
            boundaryId
          );
        }));
        return results.filter(Boolean).length;
      };
      const updated = {
        ...draft,
        status: 'submitted' as const,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setDraft(updated);
      console.log('[OrderWizard] Submitting order:', { draftId: draft.id, userId: resolvedOwnerId, collectionPath: `users/${resolvedOwnerId}/projects` });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orders:submitStarted', {
          detail: {
            projectId: draft.id,
            sessionId: submitSessionId,
            sourceFieldCount: sourceFields.length,
            ts: submitStartMs
          }
        }));
      }
      
      if (resolvedOwnerId) {
        console.log('[OrderWizard] Upserting draft...');
        const upsertStartMs = nowMs();
        await orderService.upsertDraft(updated, resolvedOwnerId);
        console.log('[OrderWizard] Draft upserted successfully');

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orders:draftUpserted', {
            detail: {
              projectId: draft.id,
              sessionId: submitSessionId,
              ts: nowMs(),
              durationMs: nowMs() - upsertStartMs
            }
          }));
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orders:boundariesSyncStarted', {
            detail: {
              projectId: draft.id,
              sessionId: submitSessionId,
              ts: nowMs(),
              sourceFieldCount: sourceFields.length
            }
          }));
        }

        // Don't block UI on potentially heavy geometry uploads.
        // Save/submit feels instant, boundaries continue in background.
        void createBoundaries().then((persistedCount) => {
          console.log('[OrderWizard] Background field boundary sync completed');
          const syncedAt = nowMs();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('orders:boundariesSynced', {
              detail: {
                projectId: draft.id,
                sessionId: submitSessionId,
                persistedCount,
                ts: syncedAt,
                totalDurationMs: syncedAt - submitStartMs
              }
            }));
          }
        }).catch(error => {
          console.warn('[OrderWizard] Background field boundary sync failed:', error);
          const failedAt = nowMs();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('orders:boundariesSyncFailed', {
              detail: {
                projectId: draft.id,
                sessionId: submitSessionId,
                message: error instanceof Error ? error.message : String(error),
                ts: failedAt,
                totalDurationMs: failedAt - submitStartMs
              }
            }));
          }
        });
      }
      
      // Call completion callback if provided
      if (onComplete) {
        onComplete();
      }
      await showConfirmation(
        t('orders.wizard.submitSuccessTitle'),
        t('orders.wizard.submitSuccess'),
        {
          type: 'info',
          confirmText: t('common.ok'),
          hideCancel: true
        }
      );
    } catch (error) {
      console.error('[OrderWizard] Submit error:', error);
      const message = error instanceof Error ? error.message : (t('common.unknownError'));
      await showConfirmation(
        t('orders.wizard.submitErrorTitle'),
        t('orders.wizard.submitError', { message }) || `Failed to submit order: ${message}`,
        {
          type: 'warning',
          confirmText: t('common.ok'),
          hideCancel: true
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const submitHandlerChange = onSubmitHandlerChangeRef.current;
    if (!submitHandlerChange) return;
    submitHandlerChange(() => {
      void submitOrder();
    });
    return () => submitHandlerChange(null);
  }, [submitOrder]);

  useEffect(() => {
    onSubmitStateChangeRef.current?.(isSubmitting);
  }, [isSubmitting]);


  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full py-10 text-sm text-gray-500">
        {t('orders.wizard.loadingDraft')}
      </div>
    );
  }

  return (
    <div className={`w-full ${singleStepMode ? 'max-w-4xl' : 'max-w-6xl'} mx-auto px-3 sm:px-4 pb-10 sm:pb-12`}>
      <div className="flex flex-col gap-6">
        {!singleStepMode && (
          <div className="glass-panel glass-panel-light dark:glass-panel-dark border border-gray-200/60 dark:border-gray-700/50 px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.title')}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{t('orders.wizard.subtitle')}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {steps.map(step => {
                  const isActive = step.id === currentStep;
                  const isComplete = step.id < currentStep;
                  return (
                    <button
                      key={step.id}
                      onClick={() => goToStep(step.id)}
                      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-600 text-white shadow-lg'
                          : 'border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 text-gray-700 dark:text-gray-200 hover:border-blue-300'
                      }`}
                      aria-current={isActive ? 'step' : undefined}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : isComplete
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {step.id}
                      </span>
                      <span className="whitespace-nowrap">{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <section className="flex-1" aria-busy={isSubmitting}>
          <div className={isSubmitting ? 'pointer-events-none opacity-70' : ''}>
            {currentStep === 1 && (
              <div className={compactStepSectionClass}>
                <div className={singleStepMode ? 'hidden' : 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end'}>
                  {!singleStepMode && (
                    <button
                      onClick={() => goToStep(2)}
                      disabled={!step1Ready}
                      className={`w-full sm:w-auto text-center px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                        step1Ready
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                      }`}
                    >
                      {t('orders.wizard.continueToStep2')}
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                  {['basic_nutrients', 'nmin', 'nematodes'].map(service => (
                    <button
                      key={service}
                      onClick={() => toggleService(service as OrderServiceType)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        draft.serviceSelection.services.includes(service as OrderServiceType)
                          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {service === 'basic_nutrients' && (t('orders.wizard.serviceBasic'))}
                        {service === 'nmin' && (t('orders.wizard.serviceNmin'))}
                        {service === 'nematodes' && (t('orders.wizard.serviceNematodes'))}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {service === 'basic_nutrients' && (t('orders.wizard.serviceBasicDesc'))}
                        {service === 'nmin' && (t('orders.wizard.serviceNminDesc'))}
                        {service === 'nematodes' && (t('orders.wizard.serviceNematodesDesc'))}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t('orders.wizard.parametersTitle')}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.parametersDerivedHint')}
                  </div>
                  <div className="grid gap-2">
                    {([
                      ['traceElements', t('orders.wizard.paramTraceElements')],
                      ['organicMatter', t('orders.wizard.paramOrganicMatter')],
                      ['cnRatio', t('orders.wizard.paramCnRatio')],
                      ['potassiumFixation', t('orders.wizard.paramPotassiumFixation')],
                      ['calcium', t('orders.wizard.paramCalcium')],
                      ['cecEffective', t('orders.wizard.paramCecEffective')],
                      ['cecPotential', t('orders.wizard.paramCecPotential')],
                      ['particleSizeDistribution', t('orders.wizard.paramParticleSize')],
                      ['phosphorusReleaseRate', t('orders.wizard.paramPhosphorusRelease')]
                    ] as Array<[keyof NonNullable<OrderDraft['parameters']>, string]>).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={Boolean(derivedDraftParameters[key])}
                          disabled
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.parametersBasicOnly')}
                  </div>
                </div>

                {!singleStepMode && <div />}
              </div>
            )}

            {currentStep === 2 && (
              <div className={compactStepSectionClass}>
                <div className={singleStepMode ? 'hidden' : 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end'}>
                  {!singleStepMode && (
                    <button
                      onClick={() => goToStep(3)}
                      disabled={!step2Ready}
                      className={`w-full sm:w-auto text-center px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                        step2Ready
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                      }`}
                    >
                      {t('orders.wizard.continueToStep3')}
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.customerNumber')}
                    value={draft.customerProfile?.customerNumber || ''}
                    onChange={(e) => updateCustomer('customerNumber', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.companyOptional')}
                    value={draft.customerProfile?.company || ''}
                    onChange={(e) => updateCustomer('company', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.firstName')}
                    value={draft.customerProfile?.firstName || ''}
                    onChange={(e) => updateCustomer('firstName', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.lastName')}
                    value={draft.customerProfile?.lastName || ''}
                    onChange={(e) => updateCustomer('lastName', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.street')}
                    value={draft.customerProfile?.street || ''}
                    onChange={(e) => updateCustomer('street', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.postalCode')}
                    value={draft.customerProfile?.postalCode || ''}
                    onChange={(e) => updateCustomer('postalCode', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.city')}
                    value={draft.customerProfile?.city || ''}
                    onChange={(e) => updateCustomer('city', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.email')}
                    value={draft.customerProfile?.email || ''}
                    onChange={(e) => updateCustomer('email', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.phone')}
                    value={draft.customerProfile?.phone || ''}
                    onChange={(e) => updateCustomer('phone', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.country')}
                    value={draft.customerProfile?.country || ''}
                    onChange={(e) => updateCustomer('country', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.federalState')}
                    value={draft.customerProfile?.federalState || ''}
                    onChange={(e) => updateCustomer('federalState', e.target.value)}
                  />
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 space-y-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={draft.billingRecipient?.isDifferent || false}
                      onChange={() => updateBilling('isDifferent', !(draft.billingRecipient?.isDifferent || false))}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.billingDifferent')}</span>
                  </label>

                  {draft.billingRecipient?.isDifferent && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.billingName')}
                        value={draft.billingRecipient?.name || ''}
                        onChange={(e) => updateBilling('name', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.firstName')}
                        value={draft.billingRecipient?.firstName || ''}
                        onChange={(e) => updateBilling('firstName', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.street')}
                        value={draft.billingRecipient?.street || ''}
                        onChange={(e) => updateBilling('street', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.postalCode')}
                        value={draft.billingRecipient?.postalCode || ''}
                        onChange={(e) => updateBilling('postalCode', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.city')}
                        value={draft.billingRecipient?.city || ''}
                        onChange={(e) => updateBilling('city', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.vatNumber')}
                        value={draft.billingRecipient?.vatNumber || ''}
                        onChange={(e) => updateBilling('vatNumber', e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {!singleStepMode && <div />}
              </div>
            )}

            {currentStep === 3 && (
              <div className={(step3Collapsed ?? internalStep3Collapsed)
                ? `flex ${singleStepMode ? 'p-1.5 sm:p-2.5' : 'p-3 sm:p-4'}`
                : `${singleStepMode ? 'space-y-1.5 p-1.5 sm:p-2.5' : 'space-y-2 p-3 sm:p-4'}`}>
                {(step3Collapsed ?? internalStep3Collapsed) ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => (onStep3CollapsedChange ? onStep3CollapsedChange(false) : setInternalStep3Collapsed(false))}
                      className="h-10 px-4 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center gap-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {t('orders.wizard.step3Title')}
                        </span>
                        {uploadedSourceFields.length > 0 && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                            ✓ {uploadedSourceFields.length}
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">›</span>
                    </button>
                    {(uploadedArchives.length > 0 || uploadedSourceFields.length > 0) && (
                      <button
                        onClick={clearUploadedArchives}
                        className="h-10 px-4 rounded-full border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {t('orders.wizard.removeUploadedFiles')}
                      </button>
                    )}
                    {!singleStepMode && (
                      <button
                        onClick={() => goToStep(4)}
                        disabled={!step3Ready}
                        className={`h-10 w-10 lg:w-auto lg:px-4 rounded-full text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                          step3Ready
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                        }`}
                        title={t('orders.wizard.continueToStep4')}
                        aria-label={t('orders.wizard.continueToStep4')}
                      >
                        <ChevronRight className="w-4 h-4 lg:hidden" />
                        <span className="hidden lg:inline">{t('orders.wizard.continueToStep4')}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Compact header with navigation */}
                    <div className={singleStepMode ? 'hidden' : 'flex items-center justify-end gap-2 pb-2 border-b border-gray-200 dark:border-gray-700'}>
                      <div className="flex gap-2 flex-shrink-0">
                        {!singleStepMode && (
                          <button
                            onClick={() => goToStep(4)}
                            disabled={!step3Ready}
                            className={`h-9 w-9 lg:w-auto lg:px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                              step3Ready
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                            }`}
                            title={t('orders.wizard.continueToStep4')}
                            aria-label={t('orders.wizard.continueToStep4')}
                          >
                            <ChevronRight className="w-4 h-4 lg:hidden" />
                            <span className="hidden lg:inline">{t('orders.wizard.continueToStep4')}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Step 3 collapsible panel */}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2 m-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                          <span className="text-gray-700 dark:text-gray-200">
                            {t('orders.wizard.step3Title')}
                          </span>
                          {uploadedSourceFields.length > 0 && (
                            <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                              ✓ {uploadedSourceFields.length}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] items-start">

                        <div className="space-y-2">

                  {/* Collapsible file upload section */}
                      {!uploadCollapsed ? (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.uploadShapefile')}
                      </div>
                      <div className="relative">
                        <input
                          id="shapefile-upload"
                          type="file"
                          multiple
                          accept=".zip,.shp"
                          ref={fileInputRef}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (!files.length) return;
                            setSelectedFiles(prev => [...prev, ...files]);
                          }}
                          className="hidden"
                        />
                        <label
                          htmlFor="shapefile-upload"
                          className="inline-flex items-center gap-2 h-9 w-9 lg:w-auto lg:px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors justify-center"
                          title={t('orders.wizard.chooseFile')}
                          aria-label={t('orders.wizard.chooseFile')}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span className="hidden lg:inline">{t('orders.wizard.chooseFile')}</span>
                        </label>
                        <span className="ml-3 text-xs text-gray-500 dark:text-gray-400">
                          {selectedFiles.length
                            ? `${selectedFiles.length} file(s) selected`
                            : (t('orders.wizard.noFileChosen'))}
                        </span>
                      </div>
                      {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                          {selectedFiles.map((file, index) => (
                            <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex items-center gap-2">
                              <div className="flex-1 text-xs text-gray-700 dark:text-gray-200">
                                <span className="font-semibold">{file.name}</span>
                              </div>
                              <button
                                onClick={() => removeSelectedFile(index)}
                                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={loadSelectedFiles}
                              disabled={isLoadingShapefile}
                              className="h-10 w-10 lg:w-auto lg:px-5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                              title={isLoadingShapefile ? (t('common.loading')) : (t('orders.wizard.loadSelected'))}
                              aria-label={isLoadingShapefile ? (t('common.loading')) : (t('orders.wizard.loadSelected'))}
                            >
                              <Upload className="w-4 h-4 lg:hidden" />
                              <span className="hidden lg:inline">{isLoadingShapefile ? (t('common.loading')) : (t('orders.wizard.loadSelected'))}</span>
                            </button>
                            <button
                              onClick={() => setSelectedFiles([])}
                              className="h-10 w-10 lg:w-auto lg:px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                              title={t('orders.wizard.clearSelectedFiles')}
                              aria-label={t('orders.wizard.clearSelectedFiles')}
                            >
                              <span className="text-base leading-none lg:hidden">×</span>
                              <span className="hidden lg:inline">{t('orders.wizard.clearSelectedFiles')}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setUploadCollapsed(false)}
                            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                            title={t('orders.wizard.uploadShapefile')}
                          >
                            <div className="flex items-center gap-2">
                              <Upload className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              <span className="hidden lg:inline text-xs font-medium text-gray-700 dark:text-gray-300">
                                {t('orders.wizard.uploadShapefile')}
                              </span>
                              {uploadedSourceFields.length > 0 && (
                                <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                                  ✓ {uploadedSourceFields.length}
                                </span>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          </button>
                          {(uploadedArchives.length > 0 || uploadedSourceFields.length > 0) && (
                            <button
                              onClick={clearUploadedArchives}
                              className="h-9 w-9 lg:w-auto lg:px-3 rounded-full border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                              title={t('orders.wizard.removeUploadedFiles')}
                              aria-label={t('orders.wizard.removeUploadedFiles')}
                            >
                              <span className="text-base leading-none lg:hidden">×</span>
                              <span className="hidden lg:inline">{t('orders.wizard.removeUploadedFiles')}</span>
                            </button>
                          )}
                        </div>
                      )}

                      {uploadedArchives.length > 0 && (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white">
                            {t('orders.wizard.uploadedFiles')} ({uploadedArchives.length})
                          </div>
                          <div className="space-y-1">
                            {uploadedArchives.map((archive) => (
                              <div key={archive.id} className="flex items-center gap-2">
                                <div className="flex-1 text-xs text-gray-700 dark:text-gray-200">
                                  {archive.name}
                                </div>
                                <button
                                  onClick={() => removeUploadedArchive(archive.id)}
                                  className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={clearUploadedArchives}
                            className="h-10 w-10 lg:w-auto lg:px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                            title={t('orders.wizard.removeUploadedFiles')}
                            aria-label={t('orders.wizard.removeUploadedFiles')}
                          >
                            <span className="text-base leading-none lg:hidden">×</span>
                            <span className="hidden lg:inline">{t('orders.wizard.removeUploadedFiles')}</span>
                          </button>
                        </div>
                      )}

                        </div>

                  {/* Drawn fields list - compact */}
                      {resolvedDrawnFields.length > 0 && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.drawnFieldsList')} ({resolvedDrawnFields.length})
                      </div>
                      <div className="space-y-1">
                        {resolvedDrawnFields.map((field) => (
                          <div key={field.id} className="grid gap-1.5 grid-cols-[1fr_1fr_auto] items-center">
                                <input
                                  className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                              value={field.baseName}
                              onChange={(e) => updateDrawnFieldMeta(field.id, { baseName: e.target.value })}
                              placeholder={t('orders.wizard.drawnFieldName')}
                            />
                            <input
                                  className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                              value={field.baseId}
                              onChange={(e) => updateDrawnFieldMeta(field.id, { baseId: e.target.value })}
                              placeholder={t('orders.wizard.drawnFieldId')}
                            />
                            <button
                              onClick={() => removeDrawnField(field.id)}
                              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                      )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {currentStep === 4 && (
              <div className={compactStepSectionClass}>
                <div className={singleStepMode ? 'hidden' : 'flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-end'}>
                  {!singleStepMode && (
                    <button
                      onClick={() => goToStep(5)}
                      disabled={!step4Ready}
                      className={`h-10 w-10 lg:w-auto lg:px-5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        step4Ready
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                      }`}
                      title={t('orders.wizard.continueToStep5')}
                      aria-label={t('orders.wizard.continueToStep5')}
                    >
                      <ChevronRight className="w-4 h-4 lg:hidden" />
                      <span className="hidden lg:inline">{t('orders.wizard.continueToStep5')}</span>
                    </button>
                  )}
                </div>

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] items-start">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.fieldDetailsTitle')}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {t('orders.wizard.fieldDetailsHint')}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.wizard.landUseType')}</div>
                        <select
                          className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                          value={editableParametersForSelection?.landUseType || ''}
                          onChange={(e) => updateParameters('landUseType', e.target.value)}
                        >
                          <option value="">{t('orders.wizard.selectLandUse')}</option>
                          <option value="A">{t('orders.wizard.landUseA')}</option>
                          <option value="W">{t('orders.wizard.landUseW')}</option>
                          <option value="O">{t('orders.wizard.landUseO')}</option>
                          <option value="S">{t('orders.wizard.landUseS')}</option>
                          <option value="R">{t('orders.wizard.landUseR')}</option>
                          <option value="F">{t('orders.wizard.landUseF')}</option>
                          <option value="U">{t('orders.wizard.landUseU')}</option>
                          <option value="X">{t('orders.wizard.landUseX')}</option>
                        </select>
                      </div>

                      <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={editableParametersForSelection?.cropResiduesRemoved || false}
                          onChange={() => updateParameters('cropResiduesRemoved', !(editableParametersForSelection?.cropResiduesRemoved || false))}
                        />
                        {t('orders.wizard.cropResiduesRemoved')}
                      </label>

                      <div>
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('orders.wizard.applyScopeTitle')}</div>
                        <div className="mt-2 inline-flex max-w-full rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-1 shadow-sm overflow-hidden">
                          <button
                            type="button"
                            onClick={switchToAllScope}
                            className={`min-h-10 min-w-0 flex-1 px-3 sm:px-4 text-xs font-semibold transition-all rounded-full flex items-center justify-center ${
                              applyToAll
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100/70 dark:hover:bg-gray-800/70'
                            }`}
                            title={t('orders.wizard.applyAllFields')}
                            aria-label={t('orders.wizard.applyAllFields')}
                          >
                            <span>{t('orders.wizard.applyAllFields')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={switchToSelectedScope}
                            className={`min-h-10 min-w-0 flex-1 px-3 sm:px-4 text-xs font-semibold transition-all rounded-full flex items-center justify-center ${
                              !applyToAll
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100/70 dark:hover:bg-gray-800/70'
                            }`}
                            title={t('orders.wizard.applySelectedFields')}
                            aria-label={t('orders.wizard.applySelectedFields')}
                          >
                            <span>{t('orders.wizard.applySelectedFields')}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {selectedStep4Field && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {(t('orders.wizard.cropLabel', { index: 1 }))} • {selectedStep4Field.fieldName || selectedStep4Field.fieldId}
                      </div>
                      <div className="grid gap-3">
                        {defaultCrops.map((_, index) => (
                          <div key={`crop-${selectedStep4Field.fieldId}-${index}`} className="grid gap-3 md:grid-cols-2">
                            <input
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                              placeholder={t('orders.wizard.cropLabel', { index: index + 1 }) || `Crop ${index + 1}`}
                              value={selectedStep4FieldCrops[index]?.crop || ''}
                              onChange={(e) => updateFieldCrop(selectedStep4Field.fieldId, index, 'crop', e.target.value)}
                            />
                            <input
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                              placeholder={t('orders.wizard.yieldLabel', { index: index + 1 }) || `Yield ${index + 1}`}
                              value={selectedStep4FieldCrops[index]?.yield || ''}
                              onChange={(e) => updateFieldCrop(selectedStep4Field.fieldId, index, 'yield', e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.gridSize')}</div>
                    <div className="flex flex-wrap gap-3">
                      {[3, 5].map(size => (
                        <button
                          key={size}
                          onClick={() => updateGridSize(size as 3 | 5)}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                            draft.gridSizeHa === size
                              ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-blue-300'
                          }`}
                        >
                          {t('orders.wizard.gridButton', { size }) || `${size} ha grid`}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void convertToSamplingCells();
                      }}
                      disabled={isConvertingSamplingCells || !(draft.sourceFields || []).length}
                      className={`h-10 w-10 lg:w-auto lg:min-w-[2.5rem] lg:px-4 rounded-lg border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        isConvertingSamplingCells || !(draft.sourceFields || []).length
                          ? 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed bg-gray-50/60 dark:bg-gray-900/40'
                          : 'border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                      }`}
                      title={isConvertingSamplingCells
                        ? (t('orders.wizard.convertingSamplingCells') || 'Converting to sampling cells...')
                        : (t('orders.wizard.convertToSamplingCells') || 'Convert to sampling cells (optional)')}
                      aria-label={isConvertingSamplingCells
                        ? (t('orders.wizard.convertingSamplingCells') || 'Converting to sampling cells...')
                        : (t('orders.wizard.convertToSamplingCells') || 'Convert to sampling cells (optional)')}
                    >
                      <ChevronRight className="w-4 h-4 lg:hidden" />
                      <span className="hidden lg:inline">
                        {isConvertingSamplingCells
                          ? (t('orders.wizard.convertingSamplingCells') || 'Converting to sampling cells...')
                          : (t('orders.wizard.convertToSamplingCells') || 'Convert to sampling cells (optional)')}
                      </span>
                    </button>
                    {samplingCellCount > 0 && (
                      <div className="text-xs text-green-700 dark:text-green-300">
                        {t('orders.wizard.samplingCellsReady', { count: samplingCellCount }) || `${samplingCellCount} sampling cells generated.`}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={showGridPreview}
                        onChange={() => setShowGridPreview((prev) => !prev)}
                      />
                      {t('orders.wizard.gridPreviewToggle') || 'Show grid overlay preview on map'}
                    </label>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {draft.sourceFields?.length
                        ? (t('orders.wizard.baseFieldsLoaded', { count: draft.sourceFields.length }) || `${draft.sourceFields.length} base fields loaded from shapefile.`)
                        : (t('orders.wizard.uploadShapefileHint'))}
                    </div>
                  </div>

                </div>

                {!singleStepMode && <div />}
              </div>
            )}

            {currentStep === 5 && (
              <div className={compactStepSectionLooseClass}>
                <div className={singleStepMode ? 'hidden' : 'flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-end'}>
                  {!singleStepMode && (
                    <button
                      onClick={() => goToStep(6)}
                      disabled={!step5Ready}
                      className={`h-10 w-10 lg:w-auto lg:px-5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        step5Ready
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                      }`}
                      title={t('orders.wizard.continueToStep6')}
                      aria-label={t('orders.wizard.continueToStep6')}
                    >
                      <ChevronRight className="w-4 h-4 lg:hidden" />
                      <span className="hidden lg:inline">{t('orders.wizard.continueToStep6')}</span>
                    </button>
                  )}
                </div>

                {renderParametersPanel()}
              </div>
            )}

            {currentStep === 6 && (
              <div className={compactStepSectionClass}>
                {!singleStepMode && <div />}

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                  <div className="space-y-4">
                    {!isLufaLab && (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                          <label className="flex items-center gap-3 text-sm font-semibold text-gray-900 dark:text-white">
                            <input
                              type="checkbox"
                              checked={agrolabMetadataEnabled}
                              onChange={(event) => setAgrolabMetadataConfigEnabled(event.target.checked)}
                            />
                            {t('orders.wizard.agrolabMetadataOptionalToggle', { defaultValue: 'Enable Agrolab metadata configuration (optional)' })}
                          </label>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {t('orders.wizard.agrolabMetadataOptionalHint', { defaultValue: 'When disabled, lab metadata, sampling details, and field metadata are optional.' })}
                          </div>
                        </div>

                        {agrolabMetadataEnabled && (
                          <>
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            {t('orders.wizard.labMetaTitle')}
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.assignedLab')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.assignedLab || ''}
                                onChange={(event) => updateLabMeta('assignedLab', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.labName')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.labName || ''}
                                onChange={(event) => updateLabMeta('labName', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.sampleTypeBns')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.sampleTypeBns || ''}
                                onChange={(event) => updateLabMeta('sampleTypeBns', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.version')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.version || ''}
                                onChange={(event) => updateLabMeta('version', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.trackingNumber')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.trackingNumber || ''}
                                onChange={(event) => updateLabMeta('trackingNumber', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.orderDate')}</span>
                              <input
                                type="date"
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.orderDate || ''}
                                onChange={(event) => updateLabMeta('orderDate', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.storageName')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.storageName || ''}
                                onChange={(event) => updateLabMeta('storageName', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.internalInfo')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.internalInfo || ''}
                                onChange={(event) => updateLabMeta('internalInfo', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.projectId')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.projectId || ''}
                                onChange={(event) => updateLabMeta('projectId', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.projectName')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.projectName || ''}
                                onChange={(event) => updateLabMeta('projectName', event.target.value)}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200 md:col-span-2">
                              <span>{t('orders.wizard.contactEmails')}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={agrolabLabMeta.contactEmails || ''}
                                onChange={(event) => updateLabMeta('contactEmails', event.target.value)}
                              />
                            </label>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.calDl)}
                                onChange={() => updateLabMeta('calDl', !agrolabLabMeta.calDl)}
                              />
                              {t('orders.wizard.calDl')}
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.notDry)}
                                onChange={() => updateLabMeta('notDry', !agrolabLabMeta.notDry)}
                              />
                              {t('orders.wizard.notDry')}
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.heavy)}
                                onChange={() => updateLabMeta('heavy', !agrolabLabMeta.heavy)}
                              />
                              {t('orders.wizard.heavy')}
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.oneOrderPerField)}
                                onChange={() => updateLabMeta('oneOrderPerField', !agrolabLabMeta.oneOrderPerField)}
                              />
                              {t('orders.wizard.oneOrderPerField')}
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.postReport)}
                                onChange={() => updateLabMeta('postReport', !agrolabLabMeta.postReport)}
                              />
                              {t('orders.wizard.postReport')}
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                checked={Boolean(agrolabLabMeta.postInvoice)}
                                onChange={() => updateLabMeta('postInvoice', !agrolabLabMeta.postInvoice)}
                              />
                              {t('orders.wizard.postInvoice')}
                            </label>
                          </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            {t('orders.wizard.samplingDetailsTitle')}
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.samplerNo')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.samplerNo || ''} onChange={(event) => updateSamplingDetails('samplerNo', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.advertiserNo')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.advertiserNo || ''} onChange={(event) => updateSamplingDetails('advertiserNo', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.samplingOrderNo')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.samplingOrderNo || ''} onChange={(event) => updateSamplingDetails('samplingOrderNo', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.priceList')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.priceList || ''} onChange={(event) => updateSamplingDetails('priceList', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.samplingDate')}</span>
                              <input type="date" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.samplingDate || ''} onChange={(event) => updateSamplingDetails('samplingDate', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.pricePerSample')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.pricePerSample || ''} onChange={(event) => updateSamplingDetails('pricePerSample', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.pricePerHa')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.pricePerHa || ''} onChange={(event) => updateSamplingDetails('pricePerHa', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.totalAreaHa')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.totalAreaHa || ''} onChange={(event) => updateSamplingDetails('totalAreaHa', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.travelCost')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.travelCost || ''} onChange={(event) => updateSamplingDetails('travelCost', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.travelCostPerKm')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.travelCostPerKm || ''} onChange={(event) => updateSamplingDetails('travelCostPerKm', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.km')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.km || ''} onChange={(event) => updateSamplingDetails('km', event.target.value)} />
                            </label>
                            <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{t('orders.wizard.sampleCount')}</span>
                              <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white" value={agrolabSamplingDetails.sampleCount || ''} onChange={(event) => updateSamplingDetails('sampleCount', event.target.value)} />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            {t('orders.wizard.fieldMetaTitle')}
                          </div>
                          <div className="space-y-2">
                            {(draft.fields || []).map((field) => (
                              <div key={`agrolab-meta-${field.fieldId}`} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                  {field.fieldName || field.fieldId}
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                  <input
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
                                    placeholder={t('orders.wizard.transportTracking')}
                                    value={field.transportTracking || ''}
                                    onChange={(event) => updateFieldMeta(field.fieldId, { transportTracking: event.target.value })}
                                  />
                                  <input
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
                                    placeholder={t('orders.wizard.soilType')}
                                    value={field.soilType || ''}
                                    onChange={(event) => updateFieldMeta(field.fieldId, { soilType: event.target.value })}
                                  />
                                  <input
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
                                    placeholder={t('orders.wizard.humusClass')}
                                    value={field.humusClass || ''}
                                    onChange={(event) => updateFieldMeta(field.fieldId, { humusClass: event.target.value })}
                                  />
                                  <input
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
                                    placeholder={t('orders.wizard.barcodeOptional')}
                                    value={field.barcode || ''}
                                    onChange={(event) => updateFieldMeta(field.fieldId, { barcode: event.target.value })}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    )}

                    {isLufaLab && (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                          <label className="flex items-center gap-3 text-sm font-semibold text-gray-900 dark:text-white">
                            <input
                              type="checkbox"
                              checked={lufaImportEnabled}
                              onChange={(event) => setLufaImportConfigEnabled(event.target.checked)}
                            />
                            {t('orders.wizard.lufaImportConfigOptionalToggle', { defaultValue: 'Enable LUFA import configuration (optional)' })}
                          </label>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {t('orders.wizard.lufaImportConfigOptionalHint', { defaultValue: 'When disabled, LUFA ADRNR and label values are ignored.' })}
                          </div>
                        </div>

                        {lufaImportEnabled && (
                          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">
                              {t('orders.wizard.lufaImportConfigTitle')}
                            </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                            <span>{t('orders.wizard.lufaScopeLabel')}</span>
                            <select
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                              value={lufaConfig.standarduntersuchungsumfang}
                              onChange={(event) => {
                                const nextScope = event.target.value as LufaStandarduntersuchungsumfang;
                                const currentDefaults = lufaConfig.defaultKennzeichnung || {};
                                const nextDefaults = {
                                  ...currentDefaults,
                                  Gruppenart: currentDefaults.Gruppenart
                                    || (nextScope === 'Nmin' ? 'A' : 'AB')
                                };

                                updateLufaImport({
                                  standarduntersuchungsumfang: nextScope,
                                  defaultKennzeichnung: nextDefaults,
                                  nminLayers: nextScope === 'Nmin' && !(lufaConfig.nminLayers || []).length
                                    ? createDefaultLufaImport('Nmin').nminLayers
                                    : lufaConfig.nminLayers
                                });
                              }}
                            >
                              <option value="DED">DED</option>
                              <option value="Nmin">Nmin</option>
                            </select>
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            { key: 'kundeAdrnr' as LufaAdrnrKey, label: t('orders.wizard.lufaKundeAdrnr') },
                            { key: 'auftraggeberAdrnr' as LufaAdrnrKey, label: t('orders.wizard.lufaAuftraggeberAdrnr') },
                            { key: 'kostentraegerAdrnr' as LufaAdrnrKey, label: t('orders.wizard.lufaKostentraegerAdrnr') },
                            { key: 'durchschriftenempfaengerAdrnr' as LufaAdrnrKey, label: t('orders.wizard.lufaDurchschriftAdrnr') }
                          ].map(({ key, label }) => (
                            <label key={key} className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{label}</span>
                              <input
                                className={`w-full rounded-lg border px-3 py-2 text-sm bg-white/80 dark:bg-gray-900/60 text-gray-900 dark:text-white ${
                                  lufaAdrnrValidation.invalidKeys.includes(key)
                                    ? 'border-red-400 dark:border-red-500'
                                    : 'border-gray-200 dark:border-gray-700'
                                }`}
                                value={String(lufaConfig[key] || '')}
                                onChange={(event) => updateLufaImport({ [key]: normalizeLufaAdrnr(event.target.value) } as Partial<NonNullable<OrderDraft['lufaImport']>>)}
                                placeholder="123456/1234"
                              />
                            </label>
                          ))}
                        </div>

                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {t('orders.wizard.lufaAdrnrHint')}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            ['Ort', t('orders.wizard.lufaKennzeichnungOrt')],
                            ['Serie', t('orders.wizard.lufaKennzeichnungSerie')],
                            ['Termin', t('orders.wizard.lufaKennzeichnungTermin')],
                            ['Bezeichnung', t('orders.wizard.lufaKennzeichnungBezeichnung')],
                            ['Gruppenart', t('orders.wizard.lufaKennzeichnungGruppenart')]
                          ].map(([key, label]) => (
                            <label key={key} className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <span>{label}</span>
                              <input
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                value={String((lufaConfig.defaultKennzeichnung || {})[key] || '')}
                                onChange={(event) => updateLufaKennzeichnungValue(key, event.target.value)}
                              />
                            </label>
                          ))}
                        </div>

                        <label className="space-y-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                          <span>{t('orders.wizard.lufaZusatzpruefparameter')}</span>
                          <input
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                            value={(lufaConfig.zusatzpruefparameter || []).join(', ')}
                            onChange={(event) => {
                              const next = event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter(Boolean);
                              updateLufaImport({ zusatzpruefparameter: next });
                            }}
                            placeholder="Ntot, Smin"
                          />
                        </label>

                        {lufaConfig.standarduntersuchungsumfang === 'Nmin' && (
                          <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                {t('orders.wizard.lufaNminLayersTitle')}
                              </div>
                              <button
                                type="button"
                                onClick={addLufaNminLayer}
                                className="h-8 w-8 sm:w-auto sm:px-2 rounded border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                                title={t('orders.wizard.lufaAddLayer')}
                                aria-label={t('orders.wizard.lufaAddLayer')}
                              >
                                <span className="text-sm leading-none sm:hidden">+</span>
                                <span className="hidden sm:inline">{t('orders.wizard.lufaAddLayer')}</span>
                              </button>
                            </div>
                            <div className="space-y-2">
                              {(lufaConfig.nminLayers || []).map((layer, index) => (
                                <div key={`layer-${index}`} className="grid gap-2 [grid-template-columns:1fr_1fr_auto] items-center">
                                  <input
                                    type="number"
                                    min={0}
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                    value={Number(layer.depthFromCm)}
                                    onChange={(event) => updateLufaNminLayer(index, 'depthFromCm', Number(event.target.value))}
                                    aria-label={t('orders.wizard.lufaLayerFrom')}
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                    value={Number(layer.depthToCm)}
                                    onChange={(event) => updateLufaNminLayer(index, 'depthToCm', Number(event.target.value))}
                                    aria-label={t('orders.wizard.lufaLayerTo')}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeLufaNminLayer(index)}
                                    className="h-8 w-8 sm:w-auto sm:px-2 rounded border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                                    title={t('orders.wizard.lufaRemoveLayer')}
                                    aria-label={t('orders.wizard.lufaRemoveLayer')}
                                  >
                                    <span className="text-sm leading-none sm:hidden">×</span>
                                    <span className="hidden sm:inline">{t('orders.wizard.lufaRemoveLayer')}</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {!lufaAdrnrValidation.ready && (
                          <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50/70 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                            {t('orders.wizard.lufaValidationAdrnr')}
                          </div>
                        )}
                        {!lufaNminLayerValidation.ready && (
                          <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50/70 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                            {t('orders.wizard.lufaValidationLayers')}
                          </div>
                        )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.requiredAgreements')}
                      </div>
                      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={draft.consent?.dataProtectionAccepted}
                          onChange={() => updateConsent('dataProtectionAccepted')}
                        />
                        {t('orders.wizard.consentDataProtection')}
                      </label>
                      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={draft.consent?.dataProcessingAccepted}
                          onChange={() => updateConsent('dataProcessingAccepted')}
                        />
                        {t('orders.wizard.consentDataProcessing')}
                      </label>
                      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={draft.consent?.digitalDocsOnlyAccepted}
                          onChange={() => updateConsent('digitalDocsOnlyAccepted')}
                        />
                        {t('orders.wizard.consentDigitalDocs')}
                      </label>
                      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={draft.consent?.termsAccepted}
                          onChange={() => updateConsent('termsAccepted')}
                        />
                        {t('orders.wizard.consentTerms')}
                      </label>
                    </div>

                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 text-sm text-gray-700 dark:text-gray-200 space-y-2">
                      <div className="font-semibold">{t('orders.wizard.readinessChecks')}</div>
                      <div className="flex items-center gap-2">
                        <span>{canContinue ? '✅' : '⚠️'}</span>
                        <span>{t('orders.wizard.consentsCompleted')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{fieldsReady ? '✅' : '⚠️'}</span>
                        <span>{t('orders.wizard.fieldsUploaded')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{allFieldsCompleted ? '✅' : '⚠️'}</span>
                        <span>{t('orders.wizard.allFieldsConfigured')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{parametersReady ? '✅' : '⚠️'}</span>
                        <span>{t('orders.wizard.landUseSelected')}</span>
                      </div>
                      {!isLufaLab && agrolabMetadataEnabled && (
                        <>
                          <div className="flex items-center gap-2">
                            <span>{agrolabReadiness.labMetaReady ? '✅' : '⚠️'}</span>
                            <span>{t('orders.wizard.labMetaComplete')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{agrolabReadiness.samplingReady ? '✅' : '⚠️'}</span>
                            <span>{t('orders.wizard.samplingDetailsComplete')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{agrolabReadiness.fieldMetaReady ? '✅' : '⚠️'}</span>
                            <span>{t('orders.wizard.fieldMetaComplete')}</span>
                          </div>
                        </>
                      )}
                      {!isLufaLab && !agrolabMetadataEnabled && (
                        <div className="flex items-center gap-2">
                          <span>✅</span>
                          <span>{t('orders.wizard.agrolabMetadataOptionalDisabled', { defaultValue: 'Agrolab metadata optional (disabled)' })}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span>{labConfigReady ? '✅' : '⚠️'}</span>
                        <span>{t('orders.wizard.labConfigReady')}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
