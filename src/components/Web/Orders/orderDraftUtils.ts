import type {
  LufaStandarduntersuchungsumfang,
  OrderDraft,
  OrderLabProvider,
  PbsProfile,
  OrderServiceType
} from '../../../types';
import { createDefaultLufaImport } from '../../../utils/lufa';
import { createDefaultPbsConfig, getPbsProfileDefinition } from '../../../utils/pbs';

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
  pbsProfile?: PbsProfile;
};

export const createOrderDraft = (
  ownerId: string,
  id: string,
  name?: string,
  options?: CreateOrderDraftOptions
): OrderDraft => {
  const now = new Date().toISOString();
  const labProvider = options?.labProvider || 'agrolab';
  const lufaScope = options?.lufaScope || 'DED';
  const pbsProfile = options?.pbsProfile || 'boden';
  const pbsProfileDefinition = getPbsProfileDefinition(pbsProfile);
  const defaultServices: OrderServiceType[] = labProvider === 'pbs'
    ? (pbsProfile === 'boden' ? ['basic_nutrients'] : ['nmin'])
    : ['basic_nutrients'];

  return {
    id,
    name: name || 'New Contract',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ownerId,
    labProvider,
    consent: { ...defaultConsent },
    serviceSelection: {
      ...defaultServiceSelection,
      services: defaultServices,
    },
    cropYield: { crops: getDefaultCrops() },
    labMeta: {
      assignedLab: '',
      labName: '',
      sampleTypeBns: '',
      version: '',
      trackingNumber: '',
      orderDate: '',
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
      samplingDate: '',
      pricePerSample: '',
      pricePerHa: '',
      totalAreaHa: '',
      travelCost: '',
      travelCostPerKm: '',
      km: '',
      sampleCount: ''
    },
    pbsConfigEnabled: labProvider === 'pbs' ? pbsProfileDefinition.requiresNminType : false,
    lufaImport: createDefaultLufaImport(lufaScope),
    pbsConfig: labProvider === 'pbs' ? createDefaultPbsConfig(pbsProfile) : undefined,
    gridSizeHa: 5,
    sourceFields: [],
    fields: []
  };
};
