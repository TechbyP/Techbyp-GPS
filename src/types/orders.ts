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

export type OrderLabProvider = 'agrolab' | 'lufa_nrw' | 'pbs' | 'documentation_only';
export type LufaStandarduntersuchungsumfang = 'DED' | 'Nmin';
export type PbsProfile = 'boden' | 'nmin' | 'n306090';

export interface LufaImportNminLayer {
  depthFromCm: number;
  depthToCm: number;
}

export interface LufaPartyAddress {
  adrnr?: string;
  name?: string;
  firstName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  phone?: string;
  fax?: string;
  email?: string;
}

export interface LufaCopyRecipient extends LufaPartyAddress {
  id?: string;
  label?: string;
}

export interface LufaResultLabel {
  code: string;
  name?: string;
  value: string;
}

export interface LufaResultParameter {
  code: string;
  name?: string;
  method?: string;
  result?: string;
  unit?: string;
  external?: boolean;
}

export interface LufaResultProbe {
  pnr?: string;
  sampleNumber?: string;
  description?: string;
  foreignId?: string;
  piafKennung?: string;
  bagNumber?: string;
  receivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  materialCode?: string;
  materialName?: string;
  matchedFieldKey?: string;
  matchedFieldName?: string;
  matchedBarcode?: string;
  labels: LufaResultLabel[];
  parameters: LufaResultParameter[];
}

export interface LufaResultOrder {
  orderNumber?: string;
  action?: string;
  client?: LufaPartyAddress;
  scope?: string;
  subject?: string;
  receivedAt?: string;
  reportedAt?: string;
  sampling?: {
    sampler?: string;
    location?: string;
    sampledAt?: string;
  };
  probes: LufaResultProbe[];
}

export interface LufaResultImport {
  importedAt: string;
  fileName?: string;
  exportDate?: string;
  exportFileName?: string;
  orderCount: number;
  probeCount: number;
  unmatchedProbeCount?: number;
  orders: LufaResultOrder[];
}

export interface LufaImportConfig {
  standarduntersuchungsumfang?: LufaStandarduntersuchungsumfang;
  kundeAdrnr?: string;
  auftraggeberAdrnr?: string;
  kostentraegerAdrnr?: string;
  durchschriftenempfaengerAdrnr?: string;
  auftraggeber?: LufaPartyAddress;
  kostentraeger?: LufaPartyAddress;
  durchschriftenempfaenger?: LufaCopyRecipient[];
  defaultKennzeichnung?: Record<string, string>;
  defaultKennzeichnungKurz?: Record<string, string>;
  zusatzpruefparameter?: string[];
  nminLayers?: LufaImportNminLayer[];
  dateFormatHint?: 'YYYYMMDD_HH24MISS' | 'DDMMYYYY_HHMMSS';
  actionCode?: string;
}

export interface PbsConfig {
  profile: PbsProfile;
  customerNumberAgrolab?: string;
  billingCustomerNumber?: string;
  distributor?: string;
  nminType?: string;
  pn030?: string;
  pn060?: string;
  pn090?: string;
  pn0x?: string;
  anzahlPnStellen?: string;
}

export interface SamplingCellMetadata {
  parentBaseId: string;
  parentBaseName: string;
  cellIndex: number;
  row: number;
  column: number;
  gridSizeHa: 3 | 5;
  generatedAt?: string;
}

export interface OrderFieldExportMapping {
  sampleKey: string;
  sampleDisplayName?: string;
  sourceBaseId: string;
  sourceBaseName: string;
}

export interface OrderSourceFieldImportMeta {
  fileName?: string;
  sourceType?: 'shapefile' | 'drawn' | 'xml';
  rawProperties?: Record<string, string>;
  joinKeys?: string[];
  landUseCode?: string;
  landUseLabel?: string;
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
  agrolabMetadataEnabled?: boolean;
  pbsConfigEnabled?: boolean;
  lufaImportEnabled?: boolean;
  lufaImport?: LufaImportConfig;
  pbsConfig?: PbsConfig;
  lufaResults?: LufaResultImport;
  gridSizeHa?: 3 | 5;
  samplingRequirements?: SamplingRequirements;
  sourceFields?: Array<{
    baseId: string;
    baseName: string;
    areaHa: number;
    geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    labAttributes?: Record<string, string>;
    samplingCell?: SamplingCellMetadata;
    exportMapping?: OrderFieldExportMapping;
    importMeta?: OrderSourceFieldImportMeta;
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
    barcodes?: string[];
    sampleCount?: number;
    notSampleable?: boolean;
    note?: string;
    samplingCell?: SamplingCellMetadata;
    exportMapping?: OrderFieldExportMapping;
  }>;
  fieldBarcodeAssignments?: Record<string, {
    barcode?: string;
    barcodes?: string[];
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
