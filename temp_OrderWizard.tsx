import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import shp from 'shpjs';
import area from '@turf/area';
import { CheckCircle, Circle, FileText, ShieldCheck, Truck, UserCircle, Upload, ChevronRight } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { OrderDraft, OrderServiceType } from '../../../types';
import { orderService } from '../../../services/orderService';
import { generateAgrolabCsv } from '../../../services/labExportAgrolab';
import { orderExportService } from '../../../services/orderExportService';
import { userProfileService } from '../../../services/userProfileService';
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

const newDraft = (ownerId: string, id: string): OrderDraft => {
  const now = new Date().toISOString();
  return {
    id,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ownerId,
    consent: { ...defaultConsent },
    serviceSelection: { ...defaultServiceSelection },
    cropYield: { crops: [...defaultCrops] },
    gridSizeHa: 5,
    sourceFields: [],
    fields: []
  };
};

export default function OrderWizard({ 
  initialStep = 1, 
  singleStepMode = false,
  onComplete,
  onFieldsLoaded,
  externalDrawnFields,
  onExternalDrawnFieldsChange,
  step3Collapsed,
  onStep3CollapsedChange,
  onStepChange
}: { 
  initialStep?: number;
  singleStepMode?: boolean;
  onComplete?: () => void;
  onFieldsLoaded?: (fields: Array<{baseId: string; baseName: string; areaHa: number; geometry: any}>) => void;
  externalDrawnFields?: DrawnField[];
  onExternalDrawnFieldsChange?: (fields: DrawnField[]) => void;
  step3Collapsed?: boolean;
  onStep3CollapsedChange?: (collapsed: boolean) => void;
  onStepChange?: (step: number) => void;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(true);
  const [uploadedSourceFields, setUploadedSourceFields] = useState<NonNullable<OrderDraft['sourceFields']>>([]);
  const [drawnFields, setDrawnFields] = useState<DrawnField[]>([]);
  const [uploadCollapsed, setUploadCollapsed] = useState(false);
  const [internalStep3Collapsed, setInternalStep3Collapsed] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoadingShapefile, setIsLoadingShapefile] = useState(false);

  const goToStep = (step: number) => {
    setCurrentStep(step);
    onStepChange?.(step);
  };

  const steps = [
    {
      id: 1,
      label: t('orders.wizard.steps.step1Label') || 'Consent & Service',
      description: t('orders.wizard.steps.step1Desc') || 'Required agreements + service selection',
      icon: ShieldCheck
    },
    {
      id: 2,
      label: t('orders.wizard.steps.step2Label') || 'Customer & Billing',
      description: t('orders.wizard.steps.step2Desc') || 'Auto-filled profile + billing recipient',
      icon: UserCircle
    },
    {
      id: 3,
      label: t('orders.wizard.steps.step3Label') || 'Field Upload',
      description: t('orders.wizard.steps.step3Desc') || 'Upload shapefile and preview',
      icon: FileText
    },
    {
      id: 4,
      label: t('orders.wizard.steps.step4Label') || 'Crops & Grid',
      description: t('orders.wizard.steps.step4Desc') || 'Yield details + grid size',
      icon: Truck
    },
    {
      id: 5,
      label: t('orders.wizard.steps.step5Label') || 'Field Review',
      description: t('orders.wizard.steps.step5Desc') || 'Assign parameters per field',
      icon: Circle
    },
    {
      id: 6,
      label: t('orders.wizard.steps.step6Label') || 'Parameters',
      description: t('orders.wizard.steps.step6Desc') || 'Land use + lab parameters',
      icon: CheckCircle
    }
  ];

  const statusLabel = (status: string) => t(`orders.status.${status}`, status);

  const resolvedDrawnFields = externalDrawnFields || drawnFields;
  const draftId = useMemo(() => (user?.uid ? `draft_${user.uid}` : 'draft_local'), [user && user.uid]);
  const storageKey = useMemo(() => `order_draft_${draftId}`, [draftId]);

  // Update current step when initialStep prop changes
  useEffect(() => {
    setCurrentStep(initialStep);
    onStepChange?.(initialStep);
  }, [initialStep]);

  useEffect(() => {
    if (externalDrawnFields) {
      applySourceFields(uploadedSourceFields, externalDrawnFields);
    }
  }, [externalDrawnFields, uploadedSourceFields]);

  const loadDraft = useCallback(async () => {
    if (!user?.uid) return;

    const local = localStorage.getItem(storageKey);
    if (local) {
      setDraft(JSON.parse(local));
      return;
    }
    if (user?.uid) {
      const remote = await orderService.getDraft(draftId, user.uid);
      if (remote) {
        setDraft(remote);
        setUploadedSourceFields(remote.sourceFields || []);
      } else {
        const fresh = newDraft(user.uid, draftId);
        
        // Auto-populate customer profile from user profile
        try {
          const userProfile = await userProfileService.getProfile(user.uid);
          if (userProfile) {
            fresh.customerProfile = {
              customerNumber: userProfile.customerNumber,
              firstName: userProfile.firstName,
              lastName: userProfile.lastName,
              company: userProfile.company,
              street: userProfile.street,
              postalCode: userProfile.postalCode,
              city: userProfile.city,
              phone: userProfile.phone,
              email: userProfile.email || user.email || undefined,
              country: userProfile.country,
              federalState: userProfile.federalState
            };
          } else {
            // Fallback: at least populate email
            fresh.customerProfile = {
              email: user.email || undefined
            };
          }
        } catch (error) {
          console.error(t('orders.wizard.logs.profileLoadFailed') || 'Failed to load user profile:', error);
          // Fallback: at least populate email
          fresh.customerProfile = {
            email: user.email || undefined
          };
        }
        
        setDraft(fresh);
        localStorage.setItem(storageKey, JSON.stringify(fresh));
      }
    }
  }, [storageKey, user?.uid, user?.email, draftId, t]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!draft) return;
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);

  useEffect(() => {
    if (!draft?.fields?.length) return;
    if (!selectedFieldId) {
      setSelectedFieldId(draft.fields[0].fieldId);
    }
  }, [draft && draft.fields, selectedFieldId]);

  // Auto-apply parameters to all fields when "Apply to all" is checked
  useEffect(() => {
    if (!draft || !applyToAll || !draft.parameters || !draft.fields?.length) return;
    
    // Check if parameters are sufficiently configured
    if (!draft.parameters.landUseType) return;
    
    // Check if all fields are already completed - if so, no need to update
    const allCompleted = draft.fields.every(field => field.status === 'completed');
    if (allCompleted) return;
    
    // Apply parameters to all fields
    const updatedFields = draft.fields.map(field => ({
      ...field,
      parameters: draft.parameters,
      status: 'completed' as const
    }));
    
    setDraft({
      ...draft,
      fields: updatedFields
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
  const parametersReady = Boolean(draft?.parameters?.landUseType);

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

  const handleShapefileLoad = async () => {
    if (!draft || !selectedFile) return;
    setIsLoadingShapefile(true);
    let geo: any;
    try {
      const buffer = await selectedFile.arrayBuffer();
      geo = await shp(buffer);
      
      if (!geo) {
        throw new Error(t('orders.wizard.shapefileNoData') || 'No data returned from shapefile');
      }
    } catch (error) {
      console.error(t('orders.wizard.logs.shapefileParseFailed') || 'Failed to parse shapefile:', error);
      const message = error instanceof Error ? error.message : (t('common.unknownError') || 'Unknown error');
      alert(t('orders.wizard.shapefileError', { message }) || `Failed to parse shapefile: ${message}. Please ensure the file is a valid ZIP containing shapefile components (.shp, .shx, .dbf).`);
      setIsLoadingShapefile(false);
      setSelectedFile(null);
      return;
    }
    
    try {
      const featureCollections = Array.isArray(geo) ? geo : [geo];
      const features = featureCollections.flatMap(collection => (collection?.features || []));
      
      if (features.length === 0) {
        throw new Error(t('orders.wizard.shapefileNoFeatures') || 'No features found in shapefile');
      }
      
      const polygonFeatures = features.filter(feature => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
      });

      if (polygonFeatures.length === 0) {
        throw new Error(t('orders.wizard.shapefileNoPolygons') || 'No polygon or multipolygon features found in shapefile');
      }

      const sourceFields = polygonFeatures.map((feature, index) => {
        const props = (feature?.properties as Record<string, any>) || {};
        const baseId = resolveFieldValue(props, ['Schlagnr', 'SCHLAGNR', 'field_id', 'FieldID', 'ID', 'id', 'FID'], `F${index + 1}`);
        const baseName = resolveFieldValue(props, ['Schlagname', 'SCHLAGNAME', 'name', 'NAME', 'field_name', 'FieldName'], baseId);
        const areaHa = Number((area(feature) / 10000).toFixed(2));
        return { baseId, baseName, areaHa, geometry: feature.geometry };
      });

      setUploadedSourceFields(sourceFields);
      applySourceFields(sourceFields, resolvedDrawnFields, {
        shapefileUpload: {
          fileName: selectedFile.name,
          uploadedAt: new Date().toISOString()
        }
      });
      setUploadCollapsed(true);
      if (onStep3CollapsedChange) {
        onStep3CollapsedChange(true);
      } else {
        setInternalStep3Collapsed(true);
      }
      setIsLoadingShapefile(false);
      
      // Notify parent component about loaded fields
      if (onFieldsLoaded) {
        onFieldsLoaded(sourceFields);
      }
    } catch (error) {
      console.error(t('orders.wizard.logs.shapefileProcessFailed') || 'Failed to process shapefile features:', error);
      const message = error instanceof Error ? error.message : (t('common.unknownError') || 'Unknown error');
      alert(t('orders.wizard.shapefileProcessError', { message }) || `Failed to process shapefile: ${message}`);
      setIsLoadingShapefile(false);
    }
  };

  const toggleService = (service: OrderServiceType) => {
    if (!draft) return;
    const exists = draft.serviceSelection.services.includes(service);
    const services = exists
      ? draft.serviceSelection.services.filter(item => item !== service)
      : [...draft.serviceSelection.services, service];

    setDraft({
      ...draft,
      serviceSelection: {
        ...draft.serviceSelection,
        services
      }
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

  const updateCrop = (index: number, key: 'crop' | 'yield', value: string) => {
    if (!draft) return;
    const crops = draft.cropYield?.crops?.length ? [...draft.cropYield.crops] : [...defaultCrops];
    crops[index] = { ...crops[index], [key]: value };
    setDraft({
      ...draft,
      cropYield: { crops }
    });
  };

  const resolveFieldValue = (props: Record<string, any> | undefined, keys: string[], fallback: string) => {
    if (!props) return fallback;
    for (const key of keys) {
      const value = props[key];
      if (value != null && String(value).trim().length > 0) return String(value).trim();
    }
    return fallback;
  };

  const buildFieldsFromSource = (sourceFields: NonNullable<OrderDraft['sourceFields']>, gridSize: 3 | 5) => {
    return sourceFields.flatMap(source => {
      const splitCount = Math.max(1, Math.ceil(source.areaHa / gridSize));
      return Array.from({ length: splitCount }, (_, index) => {
        const suffix = index + 1;
        return {
          fieldId: `${source.baseId}.${suffix}`,
          fieldName: `${source.baseName}.${suffix}`,
          status: 'pending' as const,
          areaHa: Number((source.areaHa / splitCount).toFixed(2)),
          baseId: source.baseId,
          baseName: source.baseName
        };
      });
    });
  };

  const mapDrawnFields = (fields: DrawnField[]) =>
    fields.map(field => ({
      baseId: field.baseId,
      baseName: field.baseName,
      areaHa: field.areaHa,
      geometry: field.geometry
    }));

  const applySourceFields = (
    uploaded: NonNullable<OrderDraft['sourceFields']>,
    drawn: DrawnField[],
    patch?: Partial<OrderDraft>
  ) => {
    if (!draft) return;
    const combined = [...(uploaded || []), ...mapDrawnFields(drawn)];
    const gridSize = draft.gridSizeHa || 5;
    const fields = combined.length ? buildFieldsFromSource(combined, gridSize) : [];

    setDraft({
      ...draft,
      ...patch,
      sourceFields: combined,
      fields
    });
  };

  const updateDrawnFields = (next: DrawnField[]) => {
    if (externalDrawnFields && onExternalDrawnFieldsChange) {
      onExternalDrawnFieldsChange(next);
    } else {
      setDrawnFields(next);
    }
    applySourceFields(uploadedSourceFields, next);
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

  const updateParameters = (key: keyof NonNullable<OrderDraft['parameters']>, value: boolean | string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      parameters: {
        ...draft.parameters,
        standardPackage: true,
        [key]: value
      }
    });
  };

  const applyParametersToFields = () => {
    if (!draft || !draft.parameters || !draft.fields?.length) return;
    const updatedFields = draft.fields.map(field => {
      if (applyToAll || field.fieldId === selectedFieldId) {
        return {
          ...field,
          parameters: draft.parameters,
          status: 'completed' as const
        };
      }
      return field;
    });
    setDraft({
      ...draft,
      fields: updatedFields
    });
  };

  const downloadCsv = () => {
    if (!draft) return;
    const csv = generateAgrolabCsv(draft);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lab_export_${draft.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    if (user?.uid) {
      const logId = `export_${draft.id}_${Date.now()}`;
      orderExportService.createExportLog({
        id: logId,
        orderId: draft.id,
        templateId: 'agrolab',
        templateVersion: '2024.01',
        status: 'generated',
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
        fileName: `lab_export_${draft.id}.csv`
      }).catch(error => console.error(t('orders.wizard.logs.exportLogFailed') || 'Failed to log export:', error));
    }
  };

  const submitOrder = async () => {
    if (!draft || !user?.uid) return;
    if (!canContinue || !fieldsReady || !parametersReady || !allFieldsCompleted) return;

    try {
      const updated = {
        ...draft,
        status: 'submitted' as const,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setDraft(updated);
      console.log('[OrderWizard] Submitting order:', { draftId: draft.id, userId: user.uid, collectionPath: `users/${user.uid}/projects` });
      
      if (user?.uid) {
        console.log('[OrderWizard] Upserting draft...');
        await orderService.upsertDraft(updated, user.uid);
        console.log('[OrderWizard] Draft upserted successfully');
        
        console.log('[OrderWizard] Submitting draft...');
        await orderService.submitDraft(draft.id, user.uid);
        console.log('[OrderWizard] Draft submitted successfully');
      }
      
      // Call completion callback if provided
      if (onComplete) {
        onComplete();
      }
      alert(t('orders.wizard.submitSuccess') || 'Order submitted successfully!');
    } catch (error) {
      console.error('[OrderWizard] Submit error:', error);
      const message = error instanceof Error ? error.message : (t('common.unknownError') || 'Unknown error');
      alert(t('orders.wizard.submitError', { message }) || `Failed to submit order: ${message}`);
    }
  };

  const saveDraft = async () => {
    if (!draft || !user?.uid) return;
    setIsSaving(true);
    try {
      console.log('[OrderWizard] Saving draft:', { draftId: draft.id, userId: user.uid });
      await orderService.upsertDraft({
        ...draft,
        updatedAt: new Date().toISOString()
      }, user.uid);
      console.log('[OrderWizard] Draft saved successfully');
    } catch (error) {
      console.error('[OrderWizard] Save error:', error);
      const message = error instanceof Error ? error.message : (t('common.unknownError') || 'Unknown error');
      alert(t('orders.wizard.saveError', { message }) || `Failed to save draft: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full py-10 text-sm text-gray-500">
        {t('orders.wizard.loadingDraft') || 'Loading draft...'}
      </div>
    );
  }

  return (
    <div className={`w-full ${singleStepMode ? 'max-w-4xl' : 'max-w-6xl'} mx-auto px-3 sm:px-4 pb-10 sm:pb-12`}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {!singleStepMode && (
          <aside className="lg:w-72 w-full">
            <div className="glass-panel glass-panel-light dark:glass-panel-dark border border-gray-200/60 dark:border-gray-700/50 p-3 sm:p-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.title') || 'Order Wizard'}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{t('orders.wizard.subtitle') || 'Soil Sampling Order'}</div>
              </div>
              <div className="space-y-3 max-h-[320px] sm:max-h-none overflow-y-auto pr-1">
                {steps.map(step => {
                  const Icon = step.icon;
                  const isActive = step.id === currentStep;
                  const isComplete = step.id < currentStep;
                  return (
                    <button
                      key={step.id}
                      className={`w-full flex items-start gap-3 p-2.5 sm:p-3 rounded-xl text-left transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-lg'
                          : 'bg-white/80 dark:bg-gray-900/60 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => goToStep(step.id)}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-blue-500'}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{step.label}</div>
                        <div className={`text-xs ${isActive ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                          {step.description}
                        </div>
                      </div>
                      {isComplete && <CheckCircle className="w-4 h-4 text-green-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        <section className="flex-1">
            {currentStep === 1 && (
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <div className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.stepLabel', { step: 1 }) || 'Step 1'}</div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('orders.wizard.step1Title') || 'Consent & Service Selection'}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.step1Description') || 'Confirm required agreements and choose the sampling package.'}
                  </p>
                </div>

                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
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
                        {service === 'basic_nutrients' && (t('orders.wizard.serviceBasic') || 'Basic Nutrients')}
                        {service === 'nmin' && (t('orders.wizard.serviceNmin') || 'NMIN')}
                        {service === 'nematodes' && (t('orders.wizard.serviceNematodes') || 'Nematodes')}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {service === 'basic_nutrients' && (t('orders.wizard.serviceBasicDesc') || 'Standard nutrient package (pH, P, K, Mg).')}
                        {service === 'nmin' && (t('orders.wizard.serviceNminDesc') || 'Nmin soil analysis workflow.')}
                        {service === 'nematodes' && (t('orders.wizard.serviceNematodesDesc') || 'Nematode analysis workflow.')}
                      </div>
                    </button>
                  ))}
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={draft.serviceSelection.includeGpsDocumentation}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        serviceSelection: {
                          ...draft.serviceSelection,
                          includeGpsDocumentation: !draft.serviceSelection.includeGpsDocumentation
                        }
                      })
                    }
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.gpsDocTitle') || 'GPS Documentation (optional)'}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">{t('orders.wizard.gpsDocDesc') || 'Adds GPS documentation to the order (configurable pricing).'}</div>
                  </div>
                </label>

                <div className="space-y-3">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.requiredAgreements') || 'Required agreements'}</div>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={draft.consent.dataProtectionAccepted} onChange={() => updateConsent('dataProtectionAccepted')} />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.consentDataProtection') || 'I agree to data protection and privacy policy.'}</span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={draft.consent.dataProcessingAccepted} onChange={() => updateConsent('dataProcessingAccepted')} />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.consentDataProcessing') || 'I agree to data processing for this order.'}</span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={draft.consent.digitalDocsOnlyAccepted} onChange={() => updateConsent('digitalDocsOnlyAccepted')} />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.consentDigitalDocs') || 'I accept digital documents only (no paper delivery).'}</span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={draft.consent.termsAccepted} onChange={() => updateConsent('termsAccepted')} />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.consentTerms') || 'I accept the Terms & Conditions (AGB).'}</span>
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    onClick={saveDraft}
                    disabled={isSaving}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {isSaving ? (t('orders.wizard.saving') || 'Saving...') : (t('orders.wizard.saveDraft') || 'Save Draft')}
                  </button>
                  <button
                    onClick={() => goToStep(2)}
                    disabled={!canContinue}
                    className={`w-full sm:w-auto text-center px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                      canContinue
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                    }`}
                  >
                    {t('orders.wizard.continueToStep2') || 'Continue to Step 2'}
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <div className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.stepLabel', { step: 2 }) || 'Step 2'}</div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('orders.wizard.step2Title') || 'Customer & Billing'}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.step2Description') || 'Customer details are auto-filled from the profile when available.'}
                  </p>
                </div>

                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.customerNumber') || 'Customer number'}
                    value={draft.customerProfile?.customerNumber || ''}
                    onChange={(e) => updateCustomer('customerNumber', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.companyOptional') || 'Company (optional)'}
                    value={draft.customerProfile?.company || ''}
                    onChange={(e) => updateCustomer('company', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.firstName') || 'First name'}
                    value={draft.customerProfile?.firstName || ''}
                    onChange={(e) => updateCustomer('firstName', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.lastName') || 'Last name'}
                    value={draft.customerProfile?.lastName || ''}
                    onChange={(e) => updateCustomer('lastName', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.street') || 'Street + No.'}
                    value={draft.customerProfile?.street || ''}
                    onChange={(e) => updateCustomer('street', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.postalCode') || 'Postal code'}
                    value={draft.customerProfile?.postalCode || ''}
                    onChange={(e) => updateCustomer('postalCode', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.city') || 'City'}
                    value={draft.customerProfile?.city || ''}
                    onChange={(e) => updateCustomer('city', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.email') || 'Email'}
                    value={draft.customerProfile?.email || ''}
                    onChange={(e) => updateCustomer('email', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.phone') || 'Phone'}
                    value={draft.customerProfile?.phone || ''}
                    onChange={(e) => updateCustomer('phone', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.country') || 'Country'}
                    value={draft.customerProfile?.country || ''}
                    onChange={(e) => updateCustomer('country', e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    placeholder={t('orders.wizard.federalState') || 'Federal state'}
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
                    <span className="text-sm text-gray-700 dark:text-gray-200">{t('orders.wizard.billingDifferent') || 'Billing recipient differs from customer'}</span>
                  </label>

                  {draft.billingRecipient?.isDifferent && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.billingName') || 'Billing name'}
                        value={draft.billingRecipient?.name || ''}
                        onChange={(e) => updateBilling('name', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.firstName') || 'First name'}
                        value={draft.billingRecipient?.firstName || ''}
                        onChange={(e) => updateBilling('firstName', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.street') || 'Street + No.'}
                        value={draft.billingRecipient?.street || ''}
                        onChange={(e) => updateBilling('street', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.postalCode') || 'Postal code'}
                        value={draft.billingRecipient?.postalCode || ''}
                        onChange={(e) => updateBilling('postalCode', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.city') || 'City'}
                        value={draft.billingRecipient?.city || ''}
                        onChange={(e) => updateBilling('city', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder={t('orders.wizard.vatNumber') || 'VAT number'}
                        value={draft.billingRecipient?.vatNumber || ''}
                        onChange={(e) => updateBilling('vatNumber', e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-between">
                  <button
                    onClick={() => goToStep(1)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('orders.wizard.back') || 'Back'}
                  </button>
                  <button
                    onClick={() => goToStep(3)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  >
                    {t('orders.wizard.continueToStep3') || 'Continue to Step 3'}
                  </button>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className={(step3Collapsed ?? internalStep3Collapsed) ? 'flex p-4 sm:p-6' : 'space-y-3 p-4 sm:p-6'}>
                {(step3Collapsed ?? internalStep3Collapsed) ? (
                  <button
                    onClick={() => (onStep3CollapsedChange ? onStep3CollapsedChange(false) : setInternalStep3Collapsed(false))}
                    className="w-fit px-3 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center gap-3 self-start"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.step3Title') || 'Field Upload'}
                      </span>
                      {uploadedSourceFields.length > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                          ✓ {uploadedSourceFields.length}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">›</span>
                  </button>
                ) : (
                  <>
                    {/* Compact header with navigation */}
                    <div className="flex items-center justify-between gap-3 pb-2 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex-1 min-w-0">
                        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {t('orders.wizard.step3Title') || 'Field Upload'}
                        </h1>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => goToStep(2)}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {t('orders.wizard.back') || 'Back'}
                        </button>
                        <button
                          onClick={() => goToStep(4)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                        >
                          {t('orders.wizard.continueToStep4') || 'Continue'}
                        </button>
                      </div>
                    </div>

                    {/* Step 3 collapsible panel */}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => (onStep3CollapsedChange ? onStep3CollapsedChange(true) : setInternalStep3Collapsed(true))}
                        className="w-fit px-3 py-2 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center gap-3 rounded-full self-start m-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {t('orders.wizard.step3Title') || 'Field Upload'}
                          </span>
                          {uploadedSourceFields.length > 0 && (
                            <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                              ✓ {uploadedSourceFields.length}
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400">‹</span>
                      </button>

                      <div className="p-3 space-y-2">

                  {/* Collapsible file upload section */}
                      {!uploadCollapsed ? (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.uploadShapefile') || 'Upload shapefile (ZIP)'}
                      </div>
                      <div className="relative">
                        <input
                          id="shapefile-upload"
                          type="file"
                          accept=".zip,.shp"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                        <label
                          htmlFor="shapefile-upload"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {t('orders.wizard.chooseFile') || 'Choose file'}
                        </label>
                        <span className="ml-3 text-xs text-gray-500 dark:text-gray-400">
                          {selectedFile ? selectedFile.name : (t('orders.wizard.noFileChosen') || 'No file chosen')}
                        </span>
                      </div>
                      {selectedFile && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 text-xs text-gray-700 dark:text-gray-200">
                            <span className="font-semibold">{selectedFile.name}</span>
                          </div>
                          <button
                            onClick={handleShapefileLoad}
                            disabled={isLoadingShapefile}
                            className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                          >
                            {isLoadingShapefile ? (t('common.loading') || 'Loading...') : (t('orders.wizard.load') || 'Load')}
                          </button>
                        </div>
                      )}
                    </div>
                      ) : (
                    <button
                      onClick={() => setUploadCollapsed(false)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Upload className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {t('orders.wizard.uploadShapefile') || 'Upload shapefile'}
                        </span>
                        {uploadedSourceFields.length > 0 && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                            ✓ {uploadedSourceFields.length}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </button>
                      )}

                  {/* Drawn fields list - compact */}
                      {resolvedDrawnFields.length > 0 && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white">
                        {t('orders.wizard.drawnFieldsList') || 'Drawn fields'} ({resolvedDrawnFields.length})
                      </div>
                      <div className="space-y-1">
                        {resolvedDrawnFields.map((field) => (
                          <div key={field.id} className="grid gap-1.5 grid-cols-[1fr_1fr_auto] items-center">
                                <input
                                  className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                              value={field.baseName}
                              onChange={(e) => updateDrawnFieldMeta(field.id, { baseName: e.target.value })}
                              placeholder={t('orders.wizard.drawnFieldName') || 'Name'}
                            />
                            <input
                                  className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-2 py-1 text-xs text-gray-900 dark:text-white"
                              value={field.baseId}
                              onChange={(e) => updateDrawnFieldMeta(field.id, { baseId: e.target.value })}
                              placeholder={t('orders.wizard.drawnFieldId') || 'ID'}
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
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <div className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.stepLabel', { step: 4 }) || 'Step 4'}</div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('orders.wizard.step4Title') || 'Crops & Grid Size'}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.step4Description') || 'Provide crop yields for fertilizer recommendations and choose the grid size.'}
                  </p>
                </div>

                <div className="grid gap-3">
                  {defaultCrops.map((_, index) => (
                    <div key={`crop-${index}`} className="grid gap-3 md:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                        placeholder={t('orders.wizard.cropLabel', { index: index + 1 }) || `Crop ${index + 1}`}
                        value={draft.cropYield?.crops?.[index]?.crop || ''}
                        onChange={(e) => updateCrop(index, 'crop', e.target.value)}
                      />
                      <input
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                        placeholder={t('orders.wizard.yieldLabel', { index: index + 1 }) || `Yield ${index + 1}`}
                        value={draft.cropYield?.crops?.[index]?.yield || ''}
                        onChange={(e) => updateCrop(index, 'yield', e.target.value)}
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.gridSize') || 'Grid size'}</div>
                  <div className="flex gap-3">
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
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {draft.sourceFields?.length
                      ? (t('orders.wizard.baseFieldsLoaded', { count: draft.sourceFields.length }) || `${draft.sourceFields.length} base fields loaded from shapefile.`)
                      : (t('orders.wizard.uploadShapefileHint') || 'Upload a shapefile to auto-split fields.')}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-between">
                  <button
                    onClick={() => goToStep(3)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('orders.wizard.back') || 'Back'}
                  </button>
                  <button
                    onClick={() => goToStep(5)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  >
                    {t('orders.wizard.continueToStep5') || 'Continue to Step 5'}
                  </button>
                </div>
              </div>
            )}

            {currentStep === 5 && (
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <div className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.stepLabel', { step: 5 }) || 'Step 5'}</div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('orders.wizard.step5Title') || 'Field Review'}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.step5Description') || 'Select each field and apply parameters in the next step.'}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-3 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('orders.wizard.fieldsLoaded') || 'Fields loaded'}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {t('orders.wizard.totalFields', { count: draft.fields?.length || 0 }) || `${draft.fields?.length || 0} total`}
                    </span>
                  </div>

                  <div className="grid gap-2 max-h-64 sm:max-h-72 overflow-y-auto pr-1">
                    {(draft.fields || []).map(field => (
                      <button
                        key={field.fieldId}
                        onClick={() => setSelectedFieldId(field.fieldId)}
                        className={`w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-all ${
                          selectedFieldId === field.fieldId
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-900/30'
                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{field.fieldName}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {t('orders.wizard.fieldIdLabel', { id: field.fieldId }) || `ID: ${field.fieldId}`}
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            field.status === 'completed'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : field.status === 'skipped'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          }`}
                        >
                          {statusLabel(field.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-between">
                  <button
                    onClick={() => goToStep(4)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('orders.wizard.back') || 'Back'}
                  </button>
                  <button
                    onClick={() => goToStep(6)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  >
                    {t('orders.wizard.continueToStep6') || 'Continue to Step 6'}
                  </button>
                </div>
              </div>
            )}

            {currentStep === 6 && (
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <div className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('orders.wizard.stepLabel', { step: 6 }) || 'Step 6'}</div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t('orders.wizard.step6Title') || 'Parameters & Land Use'}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('orders.wizard.step6Description') || 'Configure sampling parameters and apply them to all fields or a selected field.'}
                  </p>
                </div>

                {!applyToAll && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
                    {t('orders.wizard.applyingToField', { field: selectedFieldId || (t('orders.wizard.selectFieldStep5') || 'Select a field in Step 5') }) || `Applying to field: ${selectedFieldId || 'Select a field in Step 5'}`}
                  </div>
                )}

                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.landUseType') || 'Land use type'}</div>
                    <select
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 px-3 py-2 text-sm text-gray-900 dark:text-white"
                      value={draft.parameters?.landUseType || ''}
                      onChange={(e) => updateParameters('landUseType', e.target.value)}
                    >
                      <option value="">{t('orders.wizard.selectLandUse') || 'Select land use'}</option>
                      <option value="A">{t('orders.wizard.landUseA') || 'Arable land (A)'}</option>
                      <option value="W">{t('orders.wizard.landUseW') || 'Pasture (W)'}</option>
                      <option value="O">{t('orders.wizard.landUseO') || 'Fruit cultivation (O)'}</option>
                      <option value="S">{t('orders.wizard.landUseS') || 'Asparagus (S)'}</option>
                      <option value="R">{t('orders.wizard.landUseR') || 'Lawn (R)'}</option>
                      <option value="F">{t('orders.wizard.landUseF') || 'Woody plants (F)'}</option>
                      <option value="U">{t('orders.wizard.landUseU') || 'Subsoil (U)'}</option>
                      <option value="X">{t('orders.wizard.landUseX') || 'Other (X)'}</option>
                    </select>
                    <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={draft.parameters?.cropResiduesRemoved || false}
                        onChange={() => updateParameters('cropResiduesRemoved', !(draft.parameters?.cropResiduesRemoved || false))}
                      />
                      {t('orders.wizard.cropResiduesRemoved') || 'Crop residues removed'}
                    </label>
                    <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                      <input type="checkbox" checked={applyToAll} onChange={() => setApplyToAll(!applyToAll)} />
                      {t('orders.wizard.applyToAllFields') || 'Apply to all fields'}
                    </label>
                  </div>

                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 space-y-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{t('orders.wizard.parametersTitle') || 'Parameters (Standard always included)'}</div>
                    {[
                      ['traceElements', t('orders.wizard.paramTraceElements') || 'Trace elements (CAT, Na, Mn, Cu, B, Zn)'],
                      ['organicMatter', t('orders.wizard.paramOrganicMatter') || 'Organic matter'],
                      ['cnRatio', t('orders.wizard.paramCnRatio') || 'C/N ratio'],
                      ['potassiumFixation', t('orders.wizard.paramPotassiumFixation') || 'Potassium fixation'],
                      ['calcium', t('orders.wizard.paramCalcium') || 'Calcium'],
                      ['cecEffective', t('orders.wizard.paramCecEffective') || 'CEC effective'],
                      ['cecPotential', t('orders.wizard.paramCecPotential') || 'CEC potential'],
                      ['particleSizeDistribution', t('orders.wizard.paramParticleSize') || 'Particle size distribution'],
                      ['phosphorusReleaseRate', t('orders.wizard.paramPhosphorusRelease') || 'Phosphorus release rate']
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.parameters?.[key as keyof OrderDraft['parameters']])}
                          onChange={() => updateParameters(key as keyof OrderDraft['parameters'], !draft.parameters?.[key as keyof OrderDraft['parameters']])}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 text-sm text-gray-700 dark:text-gray-200 space-y-2">
                  <div className="font-semibold">{t('orders.wizard.readinessChecks') || 'Readiness checks'}</div>
                  <div className="flex items-center gap-2">
                    <span>{canContinue ? '✅' : '⚠️'}</span>
                    <span>{t('orders.wizard.consentsCompleted') || 'Consents completed'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{fieldsReady ? '✅' : '⚠️'}</span>
                    <span>{t('orders.wizard.fieldsUploaded') || 'Fields uploaded'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{allFieldsCompleted ? '✅' : '⚠️'}</span>
                    <span>{t('orders.wizard.allFieldsConfigured') || 'All fields configured'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{parametersReady ? '✅' : '⚠️'}</span>
                    <span>{t('orders.wizard.landUseSelected') || 'Land use selected'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    onClick={() => goToStep(5)}
                    className="w-full sm:w-auto text-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('orders.wizard.back') || 'Back'}
                  </button>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      onClick={applyParametersToFields}
                      className="w-full sm:w-auto text-center px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
                    >
                      {t('orders.wizard.applyParameters') || 'Apply parameters'}
                    </button>
                    <button
                      onClick={downloadCsv}
                      className="w-full sm:w-auto text-center px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                    >
                      {t('orders.wizard.downloadCsv') || 'Download Agrolab CSV'}
                    </button>
                    <button
                      onClick={submitOrder}
                      disabled={!canContinue || !fieldsReady || !parametersReady || !allFieldsCompleted}
                      className={`w-full sm:w-auto text-center px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                        !canContinue || !fieldsReady || !parametersReady || !allFieldsCompleted
                          ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {t('orders.wizard.submitOrder') || 'Submit Order'}
                    </button>
                  </div>
                </div>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
