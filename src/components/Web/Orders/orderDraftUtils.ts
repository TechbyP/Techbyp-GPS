import type {
  LufaImportConfig,
  LufaStandarduntersuchungsumfang,
  OrderDraft,
  OrderLabProvider,
  OrderServiceType
} from '../../../types';

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

export const getDefaultCrops = () => Array.from({ length: 7 }, () => ({ crop: '', yield: '' }));

type CreateOrderDraftOptions = {
  labProvider?: OrderLabProvider;
  lufaScope?: LufaStandarduntersuchungsumfang;
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

export const createOrderDraft = (
  ownerId: string,
  id: string,
  name?: string,
  options?: CreateOrderDraftOptions
): OrderDraft => {
  const now = new Date().toISOString();
  const todayIso = new Date().toISOString().slice(0, 10);
  const labProvider = options?.labProvider || 'agrolab';
  const lufaScope = options?.lufaScope || 'DED';

  return {
    id,
    name: name || 'New Contract',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ownerId,
    labProvider,
    consent: { ...defaultConsent },
    serviceSelection: { ...defaultServiceSelection },
    cropYield: { crops: getDefaultCrops() },
    labMeta: {
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
    },
    samplingDetails: {
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
    },
    lufaImport: createDefaultLufaImport(lufaScope),
    gridSizeHa: 5,
    sourceFields: [],
    fields: []
  };
};
