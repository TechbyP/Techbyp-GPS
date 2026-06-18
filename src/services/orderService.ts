import { collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { OrderDraft } from '../types';
import { getFieldBarcodeList } from '../utils/orderBarcodes';

// Helper to get the collection path for a user's projects
const getProjectsCollectionPath = (uid: string): string => {
  return `users/${uid}/projects`;
};

const MAX_FIELDS_TO_PERSIST = 200;

const summarizeFields = (fields: any[]) => {
  const summary: Record<string, { total: number; completed: number; pending: number; skipped: number }> = {};
  fields.forEach((field) => {
    const key = String(field?.baseId || field?.baseName || field?.fieldId || 'unknown');
    if (!summary[key]) {
      summary[key] = { total: 0, completed: 0, pending: 0, skipped: 0 };
    }
    summary[key].total += 1;
    const status = field?.status;
    if (status === 'completed') summary[key].completed += 1;
    else if (status === 'skipped') summary[key].skipped += 1;
    else summary[key].pending += 1;
  });
  return summary;
};

const buildParameterBadges = (params: any): string[] => {
  if (!params) return [];
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

const buildServiceLabels = (services: string[]): string[] => (
  services.map((service) => {
    if (service === 'basic_nutrients') return 'Basic Nutrients';
    if (service === 'nmin') return 'NMIN';
    if (service === 'nematodes') return 'Nematodes';
    return service;
  })
);

const buildFieldSummariesForPersistence = (draft: OrderDraft) => {
  const fields = Array.isArray(draft.fields) ? draft.fields : [];
  const globalParams = draft.parameters;
  const globalServices = draft.serviceSelection?.services || [];

  const summaryMap: Record<string, { statuses: string[]; badges: Set<string>; services: Set<string> }> = {};

  fields.forEach((field: any) => {
    const key = String(field?.baseId || field?.baseName || field?.fieldId || '').trim();
    if (!key) return;
    if (!summaryMap[key]) {
      summaryMap[key] = { statuses: [], badges: new Set<string>(), services: new Set<string>() };
    }

    summaryMap[key].statuses.push(field?.status || 'pending');

    const params = field?.parameters || globalParams;
    buildParameterBadges(params).forEach((badge) => summaryMap[key].badges.add(badge));

    const services = Array.isArray(field?.services) && field.services.length ? field.services : globalServices;
    buildServiceLabels(services).forEach((label) => summaryMap[key].services.add(label));
  });

  const summaries: Record<string, { status: 'pending' | 'completed' | 'skipped' | 'mixed'; badges: string[]; services: string[] }> = {};
  Object.entries(summaryMap).forEach(([key, entry]) => {
    const allCompleted = entry.statuses.length > 0 && entry.statuses.every((status) => status === 'completed');
    const allSkipped = entry.statuses.length > 0 && entry.statuses.every((status) => status === 'skipped');
    const allPending = entry.statuses.length > 0 && entry.statuses.every((status) => status === 'pending');

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

  return summaries;
};

const compactField = (field: any) => {
  const barcodes = getFieldBarcodeList(field);

  return {
    fieldId: field?.fieldId,
    fieldName: field?.fieldName,
    baseId: field?.baseId,
    baseName: field?.baseName,
    areaHa: field?.areaHa,
    status: field?.status,
    samplingDepthCm: field?.samplingDepthCm,
    services: Array.isArray(field?.services) ? field.services : undefined,
    parameters: field?.parameters,
    cropYield: field?.cropYield,
    labAttributes: field?.labAttributes,
    transportTracking: field?.transportTracking,
    soilType: field?.soilType,
    humusClass: field?.humusClass,
    barcode: barcodes[0],
    barcodes,
    sampleCount: field?.sampleCount,
    notSampleable: field?.notSampleable,
    note: field?.note,
    samplingCell: field?.samplingCell,
    exportMapping: field?.exportMapping
  };
};

// Helper to serialize drafts for Firestore (avoid large geometry payloads)
const serializeForFirestore = (draft: OrderDraft): any => {
  const serialized = { ...draft };
  
  // Keep sourceFields metadata but omit geometry to stay under Firestore 1 MiB limit
  if (serialized.sourceFields) {
    serialized.sourceFields = serialized.sourceFields.map(field => ({
      ...field,
      geometry: null
    }));
  }

  const rawFields = Array.isArray(serialized.fields) ? serialized.fields : [];
  serialized.fieldCount = rawFields.length;
  serialized.fieldSummary = summarizeFields(rawFields);
  serialized.fieldSummaries = buildFieldSummariesForPersistence(draft);

  if (rawFields.length > MAX_FIELDS_TO_PERSIST) {
    serialized.fields = [];
  } else {
    serialized.fields = rawFields.map(compactField);
  }

  // If payload is still too large, enforce minimal representation.
  const estimatedSize = JSON.stringify(serialized).length;
  if (estimatedSize > 900_000) {
    serialized.fields = [];
  }
  
  return serialized;
};

const removeUndefinedDeep = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map(item => removeUndefinedDeep(item))
      .filter(item => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, val]) => {
      const cleaned = removeUndefinedDeep(val);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {} as Record<string, any>);
  }
  return value === undefined ? undefined : value;
};

// Helper to deserialize drafts from Firestore
const deserializeFromFirestore = (data: any): OrderDraft => {
  const deserialized = { ...data };
  
  // Geometry is intentionally omitted from Firestore drafts
  if (deserialized.sourceFields) {
    deserialized.sourceFields = deserialized.sourceFields.map((field: any) => ({
      ...field,
      geometry: null
    }));
  }
  
  return deserialized as OrderDraft;
};

export const orderService = {
  async upsertDraft(draft: OrderDraft, uid: string) {
    const collectionPath = getProjectsCollectionPath(uid);
    const ref = doc(collection(db, collectionPath), draft.id);
    const snapshot = await getDoc(ref);
    const serializedDraft = serializeForFirestore(draft);
    const payload = removeUndefinedDeep({
      ...serializedDraft,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp(),
    });

    if (snapshot.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, removeUndefinedDeep({
        ...payload,
        createdAtServer: serverTimestamp(),
      }));
    }
  },

  async getDraft(id: string, uid: string) {
    const collectionPath = getProjectsCollectionPath(uid);
    const ref = doc(collection(db, collectionPath), id);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    
    return deserializeFromFirestore(snapshot.data());
  },

  async submitDraft(id: string, uid: string) {
    const collectionPath = getProjectsCollectionPath(uid);
    const ref = doc(collection(db, collectionPath), id);
    await updateDoc(ref, {
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    });
  }
};
