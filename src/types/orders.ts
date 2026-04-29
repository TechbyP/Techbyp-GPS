export type OrderServiceType = 'basic_nutrients' | 'nmin' | 'nematodes';

export interface SamplingRequirements {
  depth?: string;
  depthFrom?: number;
  depthTo?: number;
  cores?: number;
  timing?: string;
  notes?: string;
}

export interface OrderConsent {
  dataProtectionAccepted: boolean;
  dataProcessingAccepted: boolean;
  digitalDocsOnlyAccepted: boolean;
  termsAccepted: boolean;
}

export interface OrderServiceSelection {
  services: OrderServiceType[];
  includeGpsDocumentation: boolean;
}

export interface OrderPricing {
  servicePrices?: Partial<Record<OrderServiceType, number>>;
  gpsDocumentationPrice?: number;
  currency?: string;
}

export interface CustomerProfileSnapshot {
  customerNumber?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
  country?: string;
  federalState?: string;
}

export interface BillingRecipientSnapshot {
  isDifferent: boolean;
  name?: string;
  firstName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  federalState?: string;
  vatNumber?: string;
}

export type OrderLabProvider = 'agrolab' | 'lufa_nrw';
export type LufaStandarduntersuchungsumfang = 'DED' | 'Nmin';

export interface LufaImportNminLayer {
  depthFromCm: number;
  depthToCm: number;
}

export interface LufaImportConfig {
  standarduntersuchungsumfang?: LufaStandarduntersuchungsumfang;
  kundeAdrnr?: string;
  auftraggeberAdrnr?: string;
  kostentraegerAdrnr?: string;
  durchschriftenempfaengerAdrnr?: string;
  defaultKennzeichnung?: Record<string, string>;
  zusatzpruefparameter?: string[];
  nminLayers?: LufaImportNminLayer[];
  dateFormatHint?: 'YYYYMMDD_HH24MISS' | 'DDMMYYYY_HHMMSS';
}

export interface OrderDraft {
  id: string;
  name?: string;
  status: 'draft' | 'submitted' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  completedAt?: string;
  completedBy?: string;
  ownerId: string;
  assignedToId?: string;
  assignedToName?: string;
  assignedAt?: string;
  labProvider?: OrderLabProvider;
  consent: OrderConsent;
  serviceSelection: OrderServiceSelection;
  pricing?: OrderPricing;
  customerProfile?: CustomerProfileSnapshot;
  billingRecipient?: BillingRecipientSnapshot;
  shapefileUpload?: {
    fileName?: string;
    uploadRef?: string;
    uploadedAt?: string;
  };
  cropYield?: {
    crops: Array<{ crop?: string; yield?: string }>;
  };
  labMeta?: {
    assignedLab?: string;
    labName?: string;
    sampleTypeBns?: string;
    version?: string;
    trackingNumber?: string;
    orderDate?: string;
    storageName?: string;
    internalInfo?: string;
    projectId?: string;
    projectName?: string;
    calDl?: boolean;
    notDry?: boolean;
    heavy?: boolean;
    oneOrderPerField?: boolean;
    postReport?: boolean;
    postInvoice?: boolean;
    contactEmails?: string;
  };
  samplingDetails?: {
    samplerNo?: string;
    advertiserNo?: string;
    samplingOrderNo?: string;
    priceList?: string;
    samplingDate?: string;
    pricePerSample?: string;
    pricePerHa?: string;
    totalAreaHa?: string;
    travelCost?: string;
    travelCostPerKm?: string;
    km?: string;
    sampleCount?: string;
  };
  lufaImport?: LufaImportConfig;
  gridSizeHa?: 3 | 5;
  samplingRequirements?: SamplingRequirements;
  sourceFields?: Array<{
    baseId: string;
    baseName: string;
    areaHa: number;
    geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    labAttributes?: Record<string, string>;
  }>;
  fields?: Array<{
    fieldId: string;
    fieldName: string;
    status: 'pending' | 'completed' | 'skipped';
    areaHa?: number;
    baseId?: string;
    baseName?: string;
    parameters?: OrderDraft['parameters'];
    services?: OrderServiceType[];
    samplingDepthCm?: string;
    landUseType?: string;
    cropResiduesRemoved?: boolean;
    soilType?: string;
    humusClass?: string;
    transportTracking?: string;
    cropYield?: {
      crops: Array<{ crop?: string; yield?: string }>;
    };
    labAttributes?: Record<string, string>;
    barcode?: string;
    sampleCount?: number;
    notSampleable?: boolean;
    note?: string;
  }>;
  parameters?: {
    landUseType?: string;
    cropResiduesRemoved?: boolean;
    standardPackage: boolean;
    traceElements?: boolean;
    organicMatter?: boolean;
    cnRatio?: boolean;
    potassiumFixation?: boolean;
    calcium?: boolean;
    cecEffective?: boolean;
    cecPotential?: boolean;
    particleSizeDistribution?: boolean;
    phosphorusReleaseRate?: boolean;
  };
}
