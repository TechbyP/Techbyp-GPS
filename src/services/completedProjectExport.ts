import * as XLSX from 'xlsx';
import shpwrite from '@mapbox/shp-write';
import type { GpsFieldBoundaryProperties, GpsFieldSample, OrderDraft, OrderLabProvider } from '../types';
import { generateAgrolabCsv } from './labExportAgrolab';
import { generatePbsCsv } from './labExportPbs';
import {
  buildLufaPartyFromSource,
  buildLufaPreparedOrderGroups,
  getLufaPartyDisplayName,
  normalizeLufaImportConfig,
  resolveLufaParties,
} from '../utils/lufa';
import { getBoundaryBarcodeList, getFieldBarcodeList, normalizeBarcodeList } from '../utils/orderBarcodes';
import type { GeoJSONGeometry } from '../utils/geometryUtils';

type FieldSummaryEntry = {
  status: 'pending' | 'completed' | 'skipped' | 'mixed';
  badges: string[];
  services: string[];
};

type ExportBoundary = {
  firestoreId?: string;
  baseId: string;
  baseName: string;
  areaHa: number;
  geometry?: GeoJSONGeometry;
  properties?: GpsFieldBoundaryProperties;
  labAttributes?: Record<string, string>;
  samplingCell?: {
    cellIndex?: number;
    parentBaseId?: string;
    parentBaseName?: string;
  };
  exportMapping?: {
    sampleKey?: string;
    sampleDisplayName?: string;
    sourceBaseId?: string;
    sourceBaseName?: string;
  };
};

type CompletedProjectWorkbookOptions = {
  contractId: string;
  contractName: string;
  contractStatus?: string | null;
  clientId?: string | null;
  language?: string | null;
  labProvider?: OrderLabProvider | null;
  projectData?: (Partial<OrderDraft> & Record<string, any>) | null;
  boundaries?: ExportBoundary[];
  fieldSamples?: GpsFieldSample[];
  fieldSampleCountByBoundaryId?: Record<string, number>;
  fieldSummaries?: Record<string, FieldSummaryEntry>;
  trackCount?: number;
  translateServiceLabel?: (serviceKey: string) => string;
};

type ShapeFeature = {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: Record<string, string | number>;
};

type ShapeFeatureCollection = {
  type: 'FeatureCollection';
  features: ShapeFeature[];
};

type OrderDraftField = NonNullable<OrderDraft['fields']>[number];

type WorkbookLabels = {
  yes: string;
  providers: Record<'agrolab' | 'lufa_nrw' | 'pbs' | 'documentation_only', string>;
  sheets: {
    overview: string;
    fields: string;
    agrolab: string;
    pbs: string;
    lufa: string;
    lufaResults: string;
    documentation: string;
  };
  statuses: Record<'draft' | 'submitted' | 'in_progress' | 'completed' | 'pending' | 'skipped' | 'mixed', string>;
  overview: {
    contract: string;
    contractId: string;
    clientId: string;
    status: string;
    labProvider: string;
    exportedAt: string;
    fieldRows: string;
    boundaryCount: string;
    fieldSampleCount: string;
    trackCount: string;
    cropPlan: string;
    customerName: string;
    customerNumber: string;
    samplerNo: string;
    samplingDate: string;
    labProjectId: string;
    labProjectName: string;
  };
  fields: {
    row: string;
    sampleKey: string;
    sampleName: string;
    baseId: string;
    baseName: string;
    status: string;
    areaHa: string;
    services: string;
    summaryBadges: string;
    samplingDepthCm: string;
    crop: string;
    yield: string;
    gpsDocumentation: string;
    barcode: string;
    barcodeList: string;
    barcodeCount: string;
    soilType: string;
    humusClass: string;
    landUse: string;
    traceElements: string;
    organicMatter: string;
    cnRatio: string;
    potassiumFixation: string;
    calcium: string;
    cecEffective: string;
    cecPotential: string;
    particleSizeDistribution: string;
    phosphorusReleaseRate: string;
    samplingCell: string;
    labAttributes: string;
    fieldSampleCount: string;
  };
  lufa: {
    fallbackTitle: string;
    workbookTitle: string;
    client: string;
    costBearer: string;
    copy1: string;
    copy2: string;
    signature: string;
    optional: string;
    date: string;
    foreignId: string;
    appointment: string;
    actionCode: string;
    soilType: string;
    daybookNo: string;
    bagNo: string;
    sampleDescription: string;
    abbreviation: string;
    layer: string;
    sampleNumber: string;
    scope: string;
    nminScope: string;
    dedScope: string;
  };
  lufaResults: {
    orderNumber: string;
    scope: string;
    reportDate: string;
    sampleNumber: string;
    foreignId: string;
    piafKennung: string;
    bagNumber: string;
    fieldName: string;
    barcode: string;
    parameterCode: string;
    parameterName: string;
    result: string;
    unit: string;
    method: string;
    external: string;
  };
  documentation: {
    fallbackTitle: string;
    subtitle: string;
    customer: string;
    date: string;
    project: string;
    gridSize: string;
    services: string;
    cropPlan: string;
    fieldId: string;
    fieldName: string;
    barcode: string;
    barcodeList: string;
    areaHa: string;
    status: string;
    landUse: string;
    crop: string;
    yield: string;
    depth: string;
    samples: string;
    summary: string;
    notes: string;
  };
};

type CompiledFieldRow = {
  rowNumber: number;
  sampleKey: string;
  sampleName: string;
  baseId: string;
  baseName: string;
  status: string;
  areaHa: number | string;
  services: string[];
  serviceLabels: string;
  summaryBadges: string;
  samplingDepthCm: string;
  crop: string;
  yieldValue: string;
  includeGpsDocumentation: string;
  barcode: string;
  barcodes: string[];
  barcodeList: string;
  barcodeCount: number;
  soilType: string;
  humusClass: string;
  landUseType: string;
  traceElements: string;
  organicMatter: string;
  cnRatio: string;
  potassiumFixation: string;
  calcium: string;
  cecEffective: string;
  cecPotential: string;
  particleSizeDistribution: string;
  phosphorusReleaseRate: string;
  samplingCell: string;
  labAttributes: string;
  sampleCount: number | string;
};

const sanitizeFileName = (value: string): string => (
  value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const WGS84_PRJ = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

const normalizeKey = (value: unknown): string => String(value || '').trim().toLowerCase();

const isOrderDraftFieldStatus = (value: unknown): value is OrderDraftField['status'] => (
  value === 'pending' || value === 'completed' || value === 'skipped'
);

const toZipBlobPart = (value: string | number[] | ArrayBuffer | Uint8Array): BlobPart => {
  if (typeof value === 'string' || value instanceof ArrayBuffer) {
    return value;
  }

  const view = Array.isArray(value) ? Uint8Array.from(value) : value;
  return Uint8Array.from(view).buffer;
};

const toStringValue = (value: unknown): string => {
  if (value == null) return '';
  return String(value).trim();
};

const isGermanLanguage = (language?: string | null): boolean => String(language || '').toLowerCase().startsWith('de');

const getLocaleForLanguage = (language?: string | null): string => (isGermanLanguage(language) ? 'de-DE' : 'en-US');

const WORKBOOK_LABELS: Record<'en' | 'de', WorkbookLabels> = {
  en: {
    yes: 'Yes',
    providers: {
      agrolab: 'Agrolab',
      lufa_nrw: 'LUFA NRW',
      pbs: 'PBS',
      documentation_only: 'Documentation only',
    },
    sheets: {
      overview: 'Overview',
      fields: 'Fields',
      agrolab: 'Agrolab Order',
      pbs: 'PBS Order',
      lufa: 'LUFA Begleitschein',
      lufaResults: 'LUFA Results',
      documentation: 'Documentation',
    },
    statuses: {
      draft: 'Draft',
      submitted: 'Submitted',
      in_progress: 'In Progress',
      completed: 'Completed',
      pending: 'Pending',
      skipped: 'Skipped',
      mixed: 'Mixed',
    },
    overview: {
      contract: 'Contract',
      contractId: 'Contract ID',
      clientId: 'Client ID',
      status: 'Status',
      labProvider: 'Lab provider',
      exportedAt: 'Exported at',
      fieldRows: 'Field rows',
      boundaryCount: 'Boundary count',
      fieldSampleCount: 'Field sample count',
      trackCount: 'Track count',
      cropPlan: 'Crop plan',
      customerName: 'Customer name',
      customerNumber: 'Customer number',
      samplerNo: 'Sampler No.',
      samplingDate: 'Sampling date',
      labProjectId: 'Lab project ID',
      labProjectName: 'Lab project name',
    },
    fields: {
      row: 'Row',
      sampleKey: 'Sample Key',
      sampleName: 'Sample Name',
      baseId: 'Base ID',
      baseName: 'Base Name',
      status: 'Status',
      areaHa: 'Area (ha)',
      services: 'Services',
      summaryBadges: 'Summary badges',
      samplingDepthCm: 'Sampling depth (cm)',
      crop: 'Crop',
      yield: 'Yield',
      gpsDocumentation: 'GPS documentation',
      barcode: 'Barcode',
      barcodeList: 'Bag codes',
      barcodeCount: 'Bag code count',
      soilType: 'Soil type',
      humusClass: 'Humus class',
      landUse: 'Land use',
      traceElements: 'Trace elements',
      organicMatter: 'Organic matter',
      cnRatio: 'C/N ratio',
      potassiumFixation: 'Potassium fixation',
      calcium: 'Calcium',
      cecEffective: 'CEC effective',
      cecPotential: 'CEC potential',
      particleSizeDistribution: 'Particle size distribution',
      phosphorusReleaseRate: 'Phosphorus release rate',
      samplingCell: 'Sampling cell',
      labAttributes: 'Lab attributes',
      fieldSampleCount: 'Field sample count',
    },
    lufa: {
      fallbackTitle: 'Cover sheet',
      workbookTitle: 'Investigation order for LUFA Nordrhein-Westfalen',
      client: 'Client:',
      costBearer: 'Cost bearer:',
      copy1: 'Copy 1:',
      copy2: 'Copy 2:',
      signature: 'Signature:',
      optional: 'optional',
      date: 'Date',
      foreignId: 'External ID:',
      appointment: 'Appointment:',
      actionCode: 'Action code:',
      soilType: 'Soil type:',
      daybookNo: 'Daybook No.',
      bagNo: 'Bag No.',
      sampleDescription: 'Sample description',
      abbreviation: 'Abbreviation',
      layer: 'Layer',
      sampleNumber: 'Sample number',
      scope: 'Scope',
      nminScope: 'Nmin, Smin / BO',
      dedScope: 'DED / BO',
    },
    lufaResults: {
      orderNumber: 'Order number',
      scope: 'Scope',
      reportDate: 'Report date',
      sampleNumber: 'Sample number',
      foreignId: 'External ID',
      piafKennung: 'PIAF ID',
      bagNumber: 'Bag number',
      fieldName: 'Matched field',
      barcode: 'Matched barcode',
      parameterCode: 'Parameter code',
      parameterName: 'Parameter',
      result: 'Result',
      unit: 'Unit',
      method: 'Method',
      external: 'External',
    },
    documentation: {
      fallbackTitle: 'Documentation export',
      subtitle: 'Documentation export for completed project',
      customer: 'Customer:',
      date: 'Date:',
      project: 'Project:',
      gridSize: 'Grid size:',
      services: 'Services:',
      cropPlan: 'Crop plan:',
      fieldId: 'Field ID',
      fieldName: 'Field name',
      barcode: 'Primary barcode',
      barcodeList: 'Bag codes',
      areaHa: 'Area (ha)',
      status: 'Status',
      landUse: 'Land use',
      crop: 'Crop',
      yield: 'Yield',
      depth: 'Depth',
      samples: 'Samples',
      summary: 'Summary',
      notes: 'Notes',
    },
  },
  de: {
    yes: 'Ja',
    providers: {
      agrolab: 'Agrolab',
      lufa_nrw: 'LUFA NRW',
      pbs: 'PBS',
      documentation_only: 'Nur Dokumentation',
    },
    sheets: {
      overview: 'Uebersicht',
      fields: 'Felder',
      agrolab: 'Agrolab Auftrag',
      pbs: 'PBS Auftrag',
      lufa: 'LUFA Begleitschein',
      lufaResults: 'LUFA Ergebnisse',
      documentation: 'Dokumentation',
    },
    statuses: {
      draft: 'Entwurf',
      submitted: 'Eingereicht',
      in_progress: 'In Bearbeitung',
      completed: 'Abgeschlossen',
      pending: 'Ausstehend',
      skipped: 'Uebersprungen',
      mixed: 'Gemischt',
    },
    overview: {
      contract: 'Auftrag',
      contractId: 'Auftrags-ID',
      clientId: 'Kunden-ID',
      status: 'Status',
      labProvider: 'Labor',
      exportedAt: 'Exportiert am',
      fieldRows: 'Feldzeilen',
      boundaryCount: 'Anzahl Feldgrenzen',
      fieldSampleCount: 'Anzahl Proben',
      trackCount: 'Anzahl Tracks',
      cropPlan: 'Fruchtfolge',
      customerName: 'Kundenname',
      customerNumber: 'Kundennummer',
      samplerNo: 'Probenehmer-Nr.',
      samplingDate: 'Probenahmedatum',
      labProjectId: 'Labor-Projekt-ID',
      labProjectName: 'Labor-Projektname',
    },
    fields: {
      row: 'Zeile',
      sampleKey: 'Proben-Schluessel',
      sampleName: 'Probenname',
      baseId: 'Basis-ID',
      baseName: 'Basisname',
      status: 'Status',
      areaHa: 'Flaeche (ha)',
      services: 'Leistungen',
      summaryBadges: 'Zusammenfassung',
      samplingDepthCm: 'Probentiefe (cm)',
      crop: 'Frucht',
      yield: 'Ertrag',
      gpsDocumentation: 'GPS-Dokumentation',
      barcode: 'Barcode',
      barcodeList: 'Beutelcodes',
      barcodeCount: 'Anzahl Beutelcodes',
      soilType: 'Bodenart',
      humusClass: 'Humusklasse',
      landUse: 'Nutzung',
      traceElements: 'Spurenelemente',
      organicMatter: 'Humusgehalt',
      cnRatio: 'C/N-Verhaeltnis',
      potassiumFixation: 'Kali-Fixierung',
      calcium: 'Calcium',
      cecEffective: 'KAK eff',
      cecPotential: 'KAK pot',
      particleSizeDistribution: 'Korngroessenverteilung',
      phosphorusReleaseRate: 'P-Freisetzungsrate',
      samplingCell: 'Teilflaeche',
      labAttributes: 'Laborattribute',
      fieldSampleCount: 'Anzahl Feldproben',
    },
    lufa: {
      fallbackTitle: 'Begleitschein',
      workbookTitle: 'Untersuchungsauftrag fuer LUFA Nordrhein-Westfalen',
      client: 'Auftraggeber:',
      costBearer: 'Kostentraeger:',
      copy1: 'Durchschrift 1:',
      copy2: 'Durchschrift 2:',
      signature: 'Unterschrift:',
      optional: 'optional',
      date: 'Datum',
      foreignId: 'Fremdkennung:',
      appointment: 'Termin:',
      actionCode: 'Aktionscode:',
      soilType: 'Bodenart:',
      daybookNo: 'Tagebuch-Nr.',
      bagNo: 'Beutel-Nr.',
      sampleDescription: 'Probenbezeichnung',
      abbreviation: 'Kuerzel',
      layer: 'Schicht',
      sampleNumber: 'Probenummer',
      scope: 'Untersuchungsumfang',
      nminScope: 'Nmin, Smin / BO',
      dedScope: 'DED / BO',
    },
    lufaResults: {
      orderNumber: 'Auftragsnummer',
      scope: 'Umfang',
      reportDate: 'Berichtsdatum',
      sampleNumber: 'Probenummer',
      foreignId: 'Fremdkennung',
      piafKennung: 'PIAF-Kennung',
      bagNumber: 'Beutelnummer',
      fieldName: 'Zugeordnetes Feld',
      barcode: 'Zugeordneter Barcode',
      parameterCode: 'Parametercode',
      parameterName: 'Parameter',
      result: 'Ergebnis',
      unit: 'Einheit',
      method: 'Methode',
      external: 'Extern',
    },
    documentation: {
      fallbackTitle: 'Dokumentationsexport',
      subtitle: 'Dokumentationsexport fuer abgeschlossenen Auftrag',
      customer: 'Kunde:',
      date: 'Datum:',
      project: 'Auftrag:',
      gridSize: 'Rastergroesse:',
      services: 'Leistungen:',
      cropPlan: 'Fruchtfolge:',
      fieldId: 'Feld-ID',
      fieldName: 'Feldname',
      barcode: 'Primärer Barcode',
      barcodeList: 'Beutelcodes',
      areaHa: 'Flaeche (ha)',
      status: 'Status',
      landUse: 'Nutzung',
      crop: 'Frucht',
      yield: 'Ertrag',
      depth: 'Tiefe',
      samples: 'Proben',
      summary: 'Zusammenfassung',
      notes: 'Notizen',
    },
  },
};

const getWorkbookLabels = (language?: string | null): WorkbookLabels => (
  isGermanLanguage(language) ? WORKBOOK_LABELS.de : WORKBOOK_LABELS.en
);

const boolLabel = (value: unknown, truthyLabel: string): string => (value ? truthyLabel : '');

const joinList = (values: unknown[], separator = ', '): string => (
  values
    .map((value) => toStringValue(value))
    .filter((value) => value.length > 0)
    .join(separator)
);

const formatProviderLabel = (labProvider?: OrderLabProvider | null, language?: string | null): string => {
  const labels = getWorkbookLabels(language);
  if (labProvider === 'lufa_nrw') return labels.providers.lufa_nrw;
  if (labProvider === 'pbs') return labels.providers.pbs;
  if (labProvider === 'documentation_only') return labels.providers.documentation_only;
  return labels.providers.agrolab;
};

const formatTimestamp = (date: Date, language?: string | null): string => (
  new Intl.DateTimeFormat(getLocaleForLanguage(language), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
);

const formatDateValue = (value?: string, language?: string | null): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(getLocaleForLanguage(language));
    }
  }
  return value;
};

const translateStatus = (status: unknown, language?: string | null): string => {
  const normalized = toStringValue(status).toLowerCase() as keyof WorkbookLabels['statuses'];
  const labels = getWorkbookLabels(language);
  return labels.statuses[normalized] || toStringValue(status);
};

const normalizeTemplateLabel = (value: string): string => (
  value
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const AGROLAB_TEMPLATE_TRANSLATIONS_EN: Record<string, string> = {
  'Beauftragtes Labor': 'Assigned laboratory',
  'Labor': 'Laboratory',
  'Probenart,BNS': 'Sample type, BNS',
  'Datum': 'Date',
  'Speichername': 'Storage name',
  'lab-interne Info': 'Lab internal info',
  'ldw. Betrieb': 'Farm business',
  'Kundennummer AL': 'Customer no. AL',
  'Kundennummer Kd': 'Customer no.',
  'Straße Nr.': 'Street no.',
  'PLZ': 'Postal code',
  'Ort': 'City',
  'Telefon': 'Phone',
  'Land': 'Country',
  'Bundesland': 'Federal state',
  'MWSt - VAT-No.': 'VAT No.',
  'Rechnungsnehmer': 'Billing recipient',
  'Ortsteil': 'District',
  'Rechnungsnehmer (falls abweichend)': 'Billing recipient (if different)',
  'Auftragsebene': 'Order level',
  'Projekt AL': 'Project AL',
  'A-Name': 'Project name',
  'NICHT-Trocken': 'Not dry',
  'schwer': 'Heavy',
  '1 Auftrag/Schlag': '1 order/field',
  'Postbefund': 'Postal report',
  'Postrechnung': 'Postal invoice',
  'e-mail(s) (,-getrennt)': 'Email(s) (comma-separated)',
  'Probenahme': 'Sampling',
  'ProbenehmerNo.': 'Sampler no.',
  'WerberNo': 'Advertiser no.',
  'PN-AuftragsNr': 'Sampling order no.',
  'Preisliste': 'Price list',
  'Probenahmedatum': 'Sampling date',
  'PN-Preis/Probe': 'Price/sample',
  'PN-Preis/ha': 'Price/ha',
  'Fahrtkosten': 'Travel cost',
  'Fahrtkosten/km': 'Travel cost/km',
  'AnzahlProben': 'Sample count',
  'für Düngeempfehlung': 'For fertilizer recommendation',
  'Frucht1': 'Crop 1',
  'Frucht2': 'Crop 2',
  'Frucht3': 'Crop 3',
  'Frucht4': 'Crop 4',
  'Frucht5': 'Crop 5',
  'Frucht6': 'Crop 6',
  'Frucht7': 'Crop 7',
  'Ertrag1': 'Yield 1',
  'Ertrag2': 'Yield 2',
  'Ertrag3': 'Yield 3',
  'Ertrag4': 'Yield 4',
  'Ertrag5': 'Yield 5',
  'Ertrag6': 'Yield 6',
  'Ertrag7': 'Yield 7',
  'Proben und Untersuchung': 'Samples and analysis',
  'lfd.Nr. /GPS': 'Running no. / GPS',
  'Tütenbarcode': 'Bag barcode',
  'Schlagnr.': 'Field no.',
  'Teilschlagnr.': 'Subfield no.',
  'Schlagname': 'Field name',
  'Erweiterung Schlagname': 'Field name extension',
  'Schlag-größe [ha]': 'Field size [ha]',
  'Proben- Fläche [ha]': 'Sample area [ha]',
  'Nutzung [A/W/R/O/H/U]': 'Land use [A/W/R/O/H/U]',
  'Ernte-reste abg. [j/n]': 'Crop residues removed [y/n]',
  'Transport- tracking-nr.': 'Transport tracking no.',
  'Bodenart': 'Soil type',
  'Humusklasse': 'Humus class',
  'Standard pH/P/K/Mg': 'Standard pH/P/K/Mg',
  'Spuren CAT Na,Mn,Cu,B,Zn': 'Trace elements CAT Na,Mn,Cu,B,Zn',
  'Humusgehalt': 'Organic matter',
  'C/N-Verhältnis': 'C/N ratio',
  'Kali-Fixierung': 'Potassium fixation',
  'KAK eff': 'CEC effective',
  'KAK pot': 'CEC potential',
  'Korngrößen-verteilung': 'Particle size distribution',
  'P-Freisetzungs-rate': 'Phosphorus release rate',
  's. Codeliste': 'See code list',
  's. Codeliste 1': 'See code list 1',
  's. Codeliste2': 'See code list 2',
  'LOT. BARCODE': 'Lot barcode',
};

const translateAgrolabCellValue = (value: string, language?: string | null): string => {
  if (isGermanLanguage(language)) return value;
  const normalized = normalizeTemplateLabel(value);
  return AGROLAB_TEMPLATE_TRANSLATIONS_EN[normalized] || value;
};

const buildCropPlanLabel = (projectData?: (Partial<OrderDraft> & Record<string, any>) | null): string => {
  const crops = Array.isArray(projectData?.cropYield?.crops)
    ? projectData.cropYield.crops
    : [];

  return crops
    .map((entry: any) => {
      const crop = toStringValue(entry?.crop);
      const yieldValue = toStringValue(entry?.yield);
      if (!crop && !yieldValue) return '';
      if (!yieldValue) return crop;
      if (!crop) return yieldValue;
      return `${crop} (${yieldValue})`;
    })
    .filter((value: string) => value.length > 0)
    .join(', ');
};

const buildBoundaryLookup = (boundaries: ExportBoundary[]): Map<string, ExportBoundary> => {
  const lookup = new Map<string, ExportBoundary>();

  boundaries.forEach((boundary) => {
    [
      boundary.baseId,
      boundary.baseName,
      boundary.exportMapping?.sourceBaseId,
      boundary.exportMapping?.sourceBaseName,
      boundary.samplingCell?.parentBaseId,
      boundary.samplingCell?.parentBaseName,
    ].forEach((candidate) => {
      const key = normalizeKey(candidate);
      if (!key || lookup.has(key)) return;
      lookup.set(key, boundary);
    });
  });

  return lookup;
};

const getServicesForField = (
  field: Record<string, any>,
  projectData?: (Partial<OrderDraft> & Record<string, any>) | null,
): string[] => {
  if (Array.isArray(field.services) && field.services.length > 0) {
    return field.services.filter((service) => typeof service === 'string');
  }

  if (Array.isArray(projectData?.serviceSelection?.services)) {
    return projectData.serviceSelection.services.filter((service: unknown) => typeof service === 'string');
  }

  return [];
};

const getParametersForField = (
  field: Record<string, any>,
  projectData?: (Partial<OrderDraft> & Record<string, any>) | null,
): Record<string, any> => {
  if (field.parameters && typeof field.parameters === 'object') {
    return field.parameters;
  }

  if (projectData?.parameters && typeof projectData.parameters === 'object') {
    return projectData.parameters;
  }

  return {};
};

const findMatchingBoundary = (
  field: Record<string, any>,
  boundaryLookup: Map<string, ExportBoundary>,
): ExportBoundary | undefined => {
  const candidates = [
    field.exportMapping?.sourceBaseId,
    field.exportMapping?.sourceBaseName,
    field.samplingCell?.parentBaseId,
    field.samplingCell?.parentBaseName,
    field.baseId,
    field.baseName,
    field.fieldName,
    field.fieldId,
  ];

  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    if (!key) continue;
    const boundary = boundaryLookup.get(key);
    if (boundary) return boundary;
  }

  return undefined;
};

const collectFieldIdentityCandidates = (...sources: Array<Record<string, any> | null | undefined>): string[] => {
  const candidates: string[] = [];

  const appendCandidate = (value: unknown) => {
    const normalized = toStringValue(value);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  sources.forEach((source) => {
    if (!source) return;

    appendCandidate(source.baseId);
    appendCandidate(source.baseName);
    appendCandidate(source.sampleKey);
    appendCandidate(source.sampleName);
    appendCandidate(source.fieldId);
    appendCandidate(source.fieldName);
    appendCandidate(source.exportMapping?.sampleKey);
    appendCandidate(source.exportMapping?.sampleDisplayName);
    appendCandidate(source.exportMapping?.sourceBaseId);
    appendCandidate(source.exportMapping?.sourceBaseName);
    appendCandidate(source.samplingCell?.parentBaseId);
    appendCandidate(source.samplingCell?.parentBaseName);
  });

  return candidates;
};

const getBarcodeAssignmentCodes = (entry: unknown): string[] => {
  if (entry && typeof entry === 'object') {
    return normalizeBarcodeList(getFieldBarcodeList(entry as Record<string, any>));
  }

  return normalizeBarcodeList(entry);
};

const resolveFieldBarcodes = (
  projectData: (Partial<OrderDraft> & Record<string, any>) | null | undefined,
  field: Record<string, any>,
  boundary?: ExportBoundary,
): string[] => {
  const collected = normalizeBarcodeList(getFieldBarcodeList(field));
  const assignments = projectData?.fieldBarcodeAssignments;

  if (assignments && typeof assignments === 'object') {
    const assignmentLookup = new Map<string, string[]>();

    Object.entries(assignments as Record<string, unknown>).forEach(([key, entry]) => {
      const normalizedKey = normalizeKey(key);
      const codes = getBarcodeAssignmentCodes(entry);
      if (!normalizedKey || !codes.length) return;

      const existing = assignmentLookup.get(normalizedKey) || [];
      assignmentLookup.set(normalizedKey, normalizeBarcodeList([...existing, ...codes]));
    });

    collectFieldIdentityCandidates(field, boundary)
      .map((candidate) => normalizeKey(candidate))
      .filter((candidate) => candidate.length > 0)
      .forEach((candidate) => {
        const codes = assignmentLookup.get(candidate) || [];
        codes.forEach((code) => {
        if (!collected.includes(code)) {
          collected.push(code);
        }
      });
      });
  }

  normalizeBarcodeList(getBoundaryBarcodeList(boundary?.properties)).forEach((code) => {
    if (!collected.includes(code)) {
      collected.push(code);
    }
  });

  return collected;
};

const findMatchingProjectField = (
  boundary: ExportBoundary,
  persistedFields: Array<Record<string, any>>,
): Record<string, any> | undefined => {
  const boundaryKeys = new Set(
    collectFieldIdentityCandidates(boundary)
      .map((candidate) => normalizeKey(candidate))
      .filter((candidate) => candidate.length > 0),
  );

  return persistedFields.find((field) => (
    collectFieldIdentityCandidates(field)
      .map((candidate) => normalizeKey(candidate))
      .some((candidate) => boundaryKeys.has(candidate))
  ));
};

const isPolygonGeometry = (geometry: GeoJSONGeometry | undefined): geometry is GeoJSONGeometry => (
  Boolean(geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'))
);

const toNumberValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const findMatchingCompiledField = (
  boundary: ExportBoundary,
  compiledFields: CompiledFieldRow[],
): CompiledFieldRow | undefined => {
  const boundaryKeys = new Set(
    collectFieldIdentityCandidates(boundary)
      .map((candidate) => normalizeKey(candidate))
      .filter((candidate) => candidate.length > 0),
  );

  return compiledFields.find((field) => (
    collectFieldIdentityCandidates(field as unknown as Record<string, any>)
      .map((candidate) => normalizeKey(candidate))
      .some((candidate) => boundaryKeys.has(candidate))
  ));
};

const buildShapeExportFeatureCollection = (options: CompletedProjectWorkbookOptions): ShapeFeatureCollection => {
  const projectData = options.projectData || {};
  const persistedFields = Array.isArray(projectData.fields) ? projectData.fields : [];
  const translateServiceLabel = options.translateServiceLabel || ((serviceKey: string) => serviceKey);
  const providerLabel = formatProviderLabel(options.labProvider || projectData.labProvider, options.language);
  const compiledFields = compileProjectFields(options);
  const features: ShapeFeature[] = (options.boundaries || []).flatMap((boundary) => {
    if (!isPolygonGeometry(boundary.geometry)) {
      return [];
    }

    const compiledField = findMatchingCompiledField(boundary, compiledFields);
    const matchedField = findMatchingProjectField(boundary, persistedFields);
    const fieldSource = matchedField || boundary;
    const services = getServicesForField(fieldSource, projectData);
    const parameters = getParametersForField(fieldSource, projectData);
    const summary = options.fieldSummaries?.[boundary.baseId] || options.fieldSummaries?.[boundary.baseName];
    const barcodes = resolveFieldBarcodes(projectData, fieldSource, boundary);
    const sampleKey = toStringValue(
      matchedField?.exportMapping?.sampleKey
      || boundary.exportMapping?.sampleKey
      || matchedField?.fieldId
      || boundary.baseId,
    );
    const sampleName = toStringValue(
      matchedField?.exportMapping?.sampleDisplayName
      || boundary.exportMapping?.sampleDisplayName
      || matchedField?.fieldName
      || boundary.baseName,
    );

    return [{
      type: 'Feature',
      geometry: boundary.geometry,
      properties: {
        cont_id: toStringValue(options.contractId),
        cont_name: toStringValue(options.contractName),
        client_id: toStringValue(options.clientId),
        cont_stat: toStringValue(options.contractStatus),
        provider: providerLabel,
        bnd_id: toStringValue(boundary.firestoreId),
        row_no: compiledField?.rowNumber || 0,
        field_id: toStringValue(compiledField?.sampleKey || matchedField?.fieldId || sampleKey || boundary.baseId),
        field_nm: toStringValue(compiledField?.sampleName || matchedField?.fieldName || sampleName || boundary.baseName),
        base_id: toStringValue(compiledField?.baseId || boundary.baseId),
        base_name: toStringValue(compiledField?.baseName || boundary.baseName),
        sample_key: toStringValue(compiledField?.sampleKey || sampleKey),
        sample_nm: toStringValue(compiledField?.sampleName || sampleName),
        status: toStringValue(
          compiledField?.status || translateStatus(
            matchedField?.status || summary?.status || boundary.properties?.sampling_status || 'pending',
            options.language,
          ),
        ),
        area_ha: toNumberValue(compiledField?.areaHa ?? boundary.areaHa),
        services: toStringValue(compiledField?.serviceLabels || joinList(services.map((service) => translateServiceLabel(service)))),
        badges: toStringValue(compiledField?.summaryBadges || joinList(summary?.badges || [])),
        barcode: toStringValue(compiledField?.barcode || barcodes[0]),
        barcodes: toStringValue(compiledField?.barcodeList || joinList(barcodes, ' | ')),
        bc_count: compiledField?.barcodeCount ?? barcodes.length,
        samp_cnt: toNumberValue(
          compiledField?.sampleCount
          ?? (boundary.firestoreId ? options.fieldSampleCountByBoundaryId?.[String(boundary.firestoreId)] : 0),
        ),
        samp_dep: toStringValue(compiledField?.samplingDepthCm),
        crop: toStringValue(compiledField?.crop),
        yield: toStringValue(compiledField?.yieldValue),
        gps_doc: toStringValue(compiledField?.includeGpsDocumentation),
        soil_type: toStringValue(compiledField?.soilType || matchedField?.soilType),
        humus_cls: toStringValue(compiledField?.humusClass || matchedField?.humusClass),
        land_use: toStringValue(compiledField?.landUseType || parameters.landUseType),
        trace_el: toStringValue(compiledField?.traceElements),
        org_mat: toStringValue(compiledField?.organicMatter),
        cn_ratio: toStringValue(compiledField?.cnRatio),
        k_fix: toStringValue(compiledField?.potassiumFixation),
        calcium: toStringValue(compiledField?.calcium),
        cec_eff: toStringValue(compiledField?.cecEffective),
        cec_pot: toStringValue(compiledField?.cecPotential),
        psd: toStringValue(compiledField?.particleSizeDistribution),
        p_rel: toStringValue(compiledField?.phosphorusReleaseRate),
        samp_cell: toStringValue(compiledField?.samplingCell),
        lab_attrs: toStringValue(compiledField?.labAttributes || buildLabAttributesLabel(matchedField?.labAttributes || boundary.labAttributes)),
      },
    }];
  });

  return {
    type: 'FeatureCollection',
    features,
  };
};

const downloadBlob = (blob: Blob, fileName: string): string => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return fileName;
};

const buildLabAttributesLabel = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';

  return Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => {
      const normalizedValue = toStringValue(entryValue);
      if (!normalizedValue) return '';
      return `${key}: ${normalizedValue}`;
    })
    .filter((entry) => entry.length > 0)
    .join(', ');
};

const compileProjectFields = (options: CompletedProjectWorkbookOptions): CompiledFieldRow[] => {
  const projectData = options.projectData || {};
  const boundaries = options.boundaries || [];
  const boundaryLookup = buildBoundaryLookup(boundaries);
  const translateServiceLabel = options.translateServiceLabel || ((serviceKey: string) => serviceKey);
  const labels = getWorkbookLabels(options.language);
  const includeGpsDocumentation = boolLabel(projectData?.serviceSelection?.includeGpsDocumentation, labels.yes);
  const persistedFields = Array.isArray(projectData?.fields) ? projectData.fields : [];

  if (persistedFields.length > 0) {
    return persistedFields.map((rawField: any, index: number) => {
      const field = rawField && typeof rawField === 'object' ? rawField : {};
      const boundary = findMatchingBoundary(field, boundaryLookup);
      const services = getServicesForField(field, projectData);
      const parameters = getParametersForField(field, projectData);
      const summaryKey = toStringValue(field.baseId || field.baseName || field.fieldId || boundary?.baseId || boundary?.baseName);
      const summary = summaryKey ? options.fieldSummaries?.[summaryKey] : undefined;
      const sampleKey = toStringValue(field.exportMapping?.sampleKey || field.fieldId || field.baseId || boundary?.baseId || `field_${index + 1}`);
      const sampleName = toStringValue(field.exportMapping?.sampleDisplayName || field.fieldName || field.baseName || boundary?.baseName || sampleKey);
      const crop = toStringValue(field.cropYield?.crop);
      const yieldValue = toStringValue(field.cropYield?.yield);
      const barcodes = resolveFieldBarcodes(projectData, field, boundary);
      const sampleCount = boundary?.firestoreId
        ? (options.fieldSampleCountByBoundaryId?.[String(boundary.firestoreId)] || 0)
        : '';

      return {
        rowNumber: index + 1,
        sampleKey,
        sampleName,
        baseId: toStringValue(field.baseId || boundary?.baseId || field.fieldId || sampleKey),
        baseName: toStringValue(field.baseName || boundary?.baseName || field.fieldName || sampleName),
        status: translateStatus(field.status || summary?.status || boundary?.properties?.sampling_status || 'pending', options.language),
        areaHa: field.areaHa ?? boundary?.areaHa ?? '',
        services,
        serviceLabels: joinList(services.map((service) => translateServiceLabel(service))),
        summaryBadges: joinList(summary?.badges || []),
        samplingDepthCm: toStringValue(field.samplingDepthCm),
        crop,
        yieldValue,
        includeGpsDocumentation,
        barcode: toStringValue(barcodes[0]),
        barcodes,
        barcodeList: joinList(barcodes),
        barcodeCount: barcodes.length,
        soilType: toStringValue(field.soilType),
        humusClass: toStringValue(field.humusClass),
        landUseType: toStringValue(parameters.landUseType),
        traceElements: boolLabel(parameters.traceElements, labels.yes),
        organicMatter: boolLabel(parameters.organicMatter, labels.yes),
        cnRatio: boolLabel(parameters.cnRatio, labels.yes),
        potassiumFixation: boolLabel(parameters.potassiumFixation, labels.yes),
        calcium: boolLabel(parameters.calcium, labels.yes),
        cecEffective: boolLabel(parameters.cecEffective, labels.yes),
        cecPotential: boolLabel(parameters.cecPotential, labels.yes),
        particleSizeDistribution: boolLabel(parameters.particleSizeDistribution, labels.yes),
        phosphorusReleaseRate: boolLabel(parameters.phosphorusReleaseRate, labels.yes),
        samplingCell: toStringValue(field.samplingCell?.cellIndex),
        labAttributes: buildLabAttributesLabel(field.labAttributes || boundary?.labAttributes),
        sampleCount,
      };
    });
  }

  return boundaries.map((boundary, index) => {
    const summary = options.fieldSummaries?.[boundary.baseId] || options.fieldSummaries?.[boundary.baseName];
    const services = Array.isArray(projectData?.serviceSelection?.services)
      ? projectData.serviceSelection.services.filter((service: unknown) => typeof service === 'string')
      : [];
    const parameters = (projectData?.parameters && typeof projectData.parameters === 'object'
      ? projectData.parameters
      : {}) as Record<string, any>;
    const barcodes = resolveFieldBarcodes(projectData, boundary, boundary);

    return {
      rowNumber: index + 1,
      sampleKey: toStringValue(boundary.exportMapping?.sampleKey || boundary.baseId || `field_${index + 1}`),
      sampleName: toStringValue(boundary.exportMapping?.sampleDisplayName || boundary.baseName || boundary.baseId),
      baseId: toStringValue(boundary.baseId || `field_${index + 1}`),
      baseName: toStringValue(boundary.baseName || boundary.baseId || `Field ${index + 1}`),
      status: translateStatus(summary?.status || boundary.properties?.sampling_status || 'pending', options.language),
      areaHa: boundary.areaHa ?? '',
      services,
      serviceLabels: joinList(services.map((service: string) => translateServiceLabel(service))),
      summaryBadges: joinList(summary?.badges || []),
      samplingDepthCm: '',
      crop: '',
      yieldValue: '',
      includeGpsDocumentation,
      barcode: toStringValue(barcodes[0]),
      barcodes,
      barcodeList: joinList(barcodes),
      barcodeCount: barcodes.length,
      soilType: '',
      humusClass: '',
      landUseType: toStringValue(parameters.landUseType),
      traceElements: boolLabel(parameters.traceElements, labels.yes),
      organicMatter: boolLabel(parameters.organicMatter, labels.yes),
      cnRatio: boolLabel(parameters.cnRatio, labels.yes),
      potassiumFixation: boolLabel(parameters.potassiumFixation, labels.yes),
      calcium: boolLabel(parameters.calcium, labels.yes),
      cecEffective: boolLabel(parameters.cecEffective, labels.yes),
      cecPotential: boolLabel(parameters.cecPotential, labels.yes),
      particleSizeDistribution: boolLabel(parameters.particleSizeDistribution, labels.yes),
      phosphorusReleaseRate: boolLabel(parameters.phosphorusReleaseRate, labels.yes),
      samplingCell: toStringValue(boundary.samplingCell?.cellIndex),
      labAttributes: buildLabAttributesLabel(boundary.labAttributes),
      sampleCount: boundary.firestoreId
        ? (options.fieldSampleCountByBoundaryId?.[String(boundary.firestoreId)] || 0)
        : '',
    };
  });
};

const buildOverviewSheetRows = (options: CompletedProjectWorkbookOptions, compiledFields: CompiledFieldRow[]) => {
  const projectData = options.projectData || {};
  const labMeta = projectData.labMeta || {};
  const samplingDetails = projectData.samplingDetails || {};
  const customerProfile = projectData.customerProfile || {};
  const labels = getWorkbookLabels(options.language);

  return [
    { Label: labels.overview.contract, Value: options.contractName },
    { Label: labels.overview.contractId, Value: options.contractId },
    { Label: labels.overview.clientId, Value: toStringValue(options.clientId) },
    { Label: labels.overview.status, Value: translateStatus(options.contractStatus || projectData.status || 'completed', options.language) },
    { Label: labels.overview.labProvider, Value: formatProviderLabel(options.labProvider || projectData.labProvider, options.language) },
    { Label: labels.overview.exportedAt, Value: formatTimestamp(new Date(), options.language) },
    { Label: labels.overview.fieldRows, Value: compiledFields.length },
    { Label: labels.overview.boundaryCount, Value: (options.boundaries || []).length },
    { Label: labels.overview.fieldSampleCount, Value: (options.fieldSamples || []).length },
    { Label: labels.overview.trackCount, Value: options.trackCount || 0 },
    { Label: labels.overview.cropPlan, Value: buildCropPlanLabel(projectData) },
    { Label: labels.overview.customerName, Value: joinList([customerProfile.firstName, customerProfile.lastName], ' ') },
    { Label: labels.overview.customerNumber, Value: toStringValue(customerProfile.customerNumber) },
    { Label: labels.overview.samplerNo, Value: toStringValue(samplingDetails.samplerNo) },
    { Label: labels.overview.samplingDate, Value: formatDateValue(toStringValue(samplingDetails.samplingDate), options.language) },
    { Label: labels.overview.labProjectId, Value: toStringValue(labMeta.projectId) },
    { Label: labels.overview.labProjectName, Value: toStringValue(labMeta.projectName) },
  ];
};

const createEmptyRow = (size: number = 23): Array<string | number> => Array.from({ length: size }, () => '');

const setCell = (row: Array<string | number>, columnIndex: number, value: string | number) => {
  row[columnIndex] = value;
};

const buildDisplayName = (source?: { company?: string; firstName?: string; lastName?: string; name?: string }) => {
  const company = toStringValue(source?.company || source?.name);
  const person = joinList([source?.firstName, source?.lastName], ' ');
  if (company && person) return `${company}, ${person}`;
  return company || person;
};

const findPersistedFieldForCompiledField = (
  compiledField: CompiledFieldRow,
  persistedFields: Array<Record<string, any>>,
): Record<string, any> | undefined => {
  const compiledKeys = new Set(
    collectFieldIdentityCandidates(compiledField as unknown as Record<string, any>)
      .map((candidate) => normalizeKey(candidate))
      .filter((candidate) => candidate.length > 0),
  );

  return persistedFields.find((field) => (
    collectFieldIdentityCandidates(field)
      .map((candidate) => normalizeKey(candidate))
      .some((candidate) => compiledKeys.has(candidate))
  ));
};

const buildExportDraft = (
  options: CompletedProjectWorkbookOptions,
  compiledFields: CompiledFieldRow[],
): OrderDraft => {
  const projectData = options.projectData || {};
  const projectServiceSelection = (
    projectData.serviceSelection && typeof projectData.serviceSelection === 'object'
      ? projectData.serviceSelection
      : undefined
  ) as OrderDraft['serviceSelection'] | undefined;
  const now = new Date().toISOString();
  const persistedFields = Array.isArray(projectData.fields) ? projectData.fields : [];
  const fields = compiledFields.map((field) => {
    const persistedField = findPersistedFieldForCompiledField(field, persistedFields);
    const resolvedStatus: OrderDraftField['status'] = isOrderDraftFieldStatus(persistedField?.status)
      ? persistedField.status
      : isOrderDraftFieldStatus(field.status)
        ? field.status
        : 'pending';

    return {
      ...(persistedField || {}),
      fieldId: field.sampleKey,
      fieldName: field.sampleName,
      status: resolvedStatus,
      areaHa: typeof field.areaHa === 'number' ? field.areaHa : Number(field.areaHa || 0),
      baseId: field.baseId,
      baseName: field.baseName,
      services: field.services as Array<'basic_nutrients' | 'nmin' | 'nematodes'>,
      samplingDepthCm: field.samplingDepthCm || persistedField?.samplingDepthCm || undefined,
      soilType: field.soilType || persistedField?.soilType || undefined,
      humusClass: field.humusClass || persistedField?.humusClass || undefined,
      barcode: field.barcode || undefined,
      barcodes: field.barcodes.length ? field.barcodes : undefined,
      cropYield: (field.crop || field.yieldValue)
        ? { crops: [{ crop: field.crop || '', yield: field.yieldValue || '' }] }
        : persistedField?.cropYield,
      samplingCell: field.samplingCell
        ? {
            ...(persistedField?.samplingCell || {}),
            parentBaseId: field.baseId,
            parentBaseName: field.baseName,
            cellIndex: Number(field.samplingCell) || 1,
            row: persistedField?.samplingCell?.row || 0,
            column: persistedField?.samplingCell?.column || 0,
            gridSizeHa: ((persistedField?.samplingCell?.gridSizeHa || projectData.gridSizeHa || 5) as 3 | 5),
          }
        : persistedField?.samplingCell,
      exportMapping: {
        ...(persistedField?.exportMapping || {}),
        sampleKey: field.sampleKey,
        sampleDisplayName: field.sampleName,
        sourceBaseId: field.baseId,
        sourceBaseName: field.baseName,
      },
    };
  });

  return {
    id: options.contractId,
    name: options.contractName,
    status: (options.contractStatus as OrderDraft['status']) || 'completed',
    createdAt: projectData.createdAt || now,
    updatedAt: projectData.updatedAt || now,
    ownerId: options.clientId || projectData.ownerId || 'export',
    labProvider: (options.labProvider || projectData.labProvider || 'agrolab') as OrderLabProvider,
    consent: projectData.consent || {
      dataProtectionAccepted: false,
      dataProcessingAccepted: false,
      digitalDocsOnlyAccepted: false,
      termsAccepted: false,
    },
    serviceSelection: projectServiceSelection || {
      services: Array.from(new Set(compiledFields.flatMap((field) => field.services))) as Array<'basic_nutrients' | 'nmin' | 'nematodes'>,
      includeGpsDocumentation: Boolean((projectServiceSelection as Record<string, any> | undefined)?.includeGpsDocumentation),
    },
    customerProfile: projectData.customerProfile,
    billingRecipient: projectData.billingRecipient || { isDifferent: false },
    cropYield: projectData.cropYield || { crops: [] },
    labMeta: projectData.labMeta,
    samplingDetails: projectData.samplingDetails,
    lufaImport: projectData.lufaImport,
    pbsConfig: projectData.pbsConfig,
    lufaResults: projectData.lufaResults,
    gridSizeHa: projectData.gridSizeHa,
    parameters: projectData.parameters || { standardPackage: true },
    sourceFields: Array.isArray(projectData.sourceFields) ? projectData.sourceFields : undefined,
    fieldBarcodeAssignments: projectData.fieldBarcodeAssignments,
    fields,
  };
};

const buildFieldSheetRows = (compiledFields: CompiledFieldRow[], language?: string | null) => {
  const labels = getWorkbookLabels(language);
  return compiledFields.map((field) => ({
    [labels.fields.row]: field.rowNumber,
    [labels.fields.sampleKey]: field.sampleKey,
    [labels.fields.sampleName]: field.sampleName,
    [labels.fields.baseId]: field.baseId,
    [labels.fields.baseName]: field.baseName,
    [labels.fields.status]: field.status,
    [labels.fields.areaHa]: field.areaHa,
    [labels.fields.services]: field.serviceLabels,
    [labels.fields.summaryBadges]: field.summaryBadges,
    [labels.fields.samplingDepthCm]: field.samplingDepthCm,
    [labels.fields.crop]: field.crop,
    [labels.fields.yield]: field.yieldValue,
    [labels.fields.gpsDocumentation]: field.includeGpsDocumentation,
    [labels.fields.barcode]: field.barcode,
    [labels.fields.barcodeList]: field.barcodeList,
    [labels.fields.barcodeCount]: field.barcodeCount,
    [labels.fields.soilType]: field.soilType,
    [labels.fields.humusClass]: field.humusClass,
    [labels.fields.landUse]: field.landUseType,
    [labels.fields.traceElements]: field.traceElements,
    [labels.fields.organicMatter]: field.organicMatter,
    [labels.fields.cnRatio]: field.cnRatio,
    [labels.fields.potassiumFixation]: field.potassiumFixation,
    [labels.fields.calcium]: field.calcium,
    [labels.fields.cecEffective]: field.cecEffective,
    [labels.fields.cecPotential]: field.cecPotential,
    [labels.fields.particleSizeDistribution]: field.particleSizeDistribution,
    [labels.fields.phosphorusReleaseRate]: field.phosphorusReleaseRate,
    [labels.fields.samplingCell]: field.samplingCell,
    [labels.fields.labAttributes]: field.labAttributes,
    [labels.fields.fieldSampleCount]: field.sampleCount,
  }));
};

const buildAgrolabSheetAoa = (
  compiledFields: CompiledFieldRow[],
  options: CompletedProjectWorkbookOptions,
) => generateAgrolabCsv(buildExportDraft(options, compiledFields))
  .trimEnd()
  .split(/\r?\n/)
  .map((line) => line.split(';').map((cell) => translateAgrolabCellValue(cell, options.language)));

const buildLufaBegleitscheinAoa = (
  compiledFields: CompiledFieldRow[],
  options: CompletedProjectWorkbookOptions,
) => {
  const projectData = options.projectData || {};
  const exportDraft = buildExportDraft(options, compiledFields);
  const lufaImport = normalizeLufaImportConfig(exportDraft.lufaImport);
  const parties = resolveLufaParties(exportDraft);
  const groups = buildLufaPreparedOrderGroups(exportDraft);
  const labels = getWorkbookLabels(options.language);
  const rows: Array<Array<string | number>> = [];
  const customerProfile = (projectData.customerProfile || {}) as Record<string, unknown>;
  const customerCopy = buildLufaPartyFromSource(customerProfile, parties.kundeAdrnr);
  const copy1 = parties.durchschriftenempfaenger[0] || null;
  const copy2 = parties.durchschriftenempfaenger[1] || customerCopy;
  const soilTypes = joinList(Array.from(new Set(compiledFields.map((field) => field.soilType).filter(Boolean))));
  const dateValue = formatDateValue(projectData.samplingDetails?.samplingDate || projectData.labMeta?.orderDate || new Date().toISOString().slice(0, 10), options.language);
  const firstProbe = groups[0]?.probes[0] || null;

  const row1 = createEmptyRow();
  setCell(row1, 7, options.contractName || labels.lufa.fallbackTitle);
  rows.push(row1);

  const row2 = createEmptyRow();
  setCell(row2, 7, labels.lufa.workbookTitle);
  rows.push(row2);

  const row3 = createEmptyRow();
  setCell(row3, 0, labels.lufa.client);
  setCell(row3, 2, toStringValue(parties.auftraggeber.adrnr));
  setCell(row3, 5, getLufaPartyDisplayName(parties.auftraggeber));
  setCell(row3, 14, labels.lufa.signature);
  setCell(row3, 16, labels.lufa.optional);
  setCell(row3, 20, labels.lufa.date);
  setCell(row3, 21, dateValue || labels.lufa.optional);
  rows.push(row3);

  const row4 = createEmptyRow();
  setCell(row4, 0, labels.lufa.costBearer);
  setCell(row4, 2, toStringValue(parties.kostentraeger.adrnr));
  setCell(row4, 5, getLufaPartyDisplayName(parties.kostentraeger));
  setCell(row4, 14, labels.lufa.foreignId);
  setCell(row4, 16, firstProbe?.fremdkennung || options.contractId);
  rows.push(row4);

  const row5 = createEmptyRow();
  setCell(row5, 0, labels.lufa.copy1);
  setCell(row5, 2, toStringValue(copy1?.adrnr));
  setCell(row5, 5, getLufaPartyDisplayName(copy1));
  setCell(row5, 14, labels.lufa.appointment);
  setCell(row5, 16, dateValue || labels.lufa.optional);
  setCell(row5, 17, labels.lufa.optional);
  rows.push(row5);

  const row6 = createEmptyRow();
  setCell(row6, 0, labels.lufa.copy2);
  setCell(row6, 2, toStringValue(copy2?.adrnr || parties.kundeAdrnr));
  setCell(row6, 5, getLufaPartyDisplayName(copy2));
  setCell(row6, 14, labels.lufa.actionCode);
  setCell(row6, 16, toStringValue(lufaImport.actionCode) || labels.lufa.optional);
  setCell(row6, 19, labels.lufa.soilType);
  setCell(row6, 20, soilTypes);
  rows.push(row6);

  const headerRow = createEmptyRow();
  setCell(headerRow, 0, labels.lufa.daybookNo);
  setCell(headerRow, 3, labels.lufa.bagNo);
  setCell(headerRow, 5, labels.lufa.sampleDescription);
  setCell(headerRow, 11, labels.lufa.abbreviation);
  setCell(headerRow, 13, labels.lufa.layer);
  setCell(headerRow, 14, labels.lufa.sampleNumber);
  setCell(headerRow, 17, labels.lufa.scope);
  rows.push(headerRow);

  groups.forEach((group) => {
    group.probes.forEach((probe) => {
      const displayRow = createEmptyRow();
      setCell(displayRow, 0, probe.layerIndex === 1 ? group.groupIndex : '');
      setCell(displayRow, 3, probe.bagNumber);
      setCell(displayRow, 5, group.sampleName);
      setCell(displayRow, 11, probe.kuerzel);
      setCell(displayRow, 12, probe.layerIndex);
      setCell(displayRow, 13, probe.depthLabel);
      setCell(displayRow, 14, probe.fremdkennung);
      setCell(displayRow, 17, probe.scope === 'Nmin' ? labels.lufa.nminScope : labels.lufa.dedScope);
      rows.push(displayRow);
    });

    if (group.scope === 'Nmin') {
      rows.push(createEmptyRow());
    }
  });

  return rows;
};

const buildLufaResultSheetRows = (options: CompletedProjectWorkbookOptions): Array<Record<string, unknown>> => {
  const lufaResults = options.projectData?.lufaResults as NonNullable<OrderDraft['lufaResults']> | undefined;
  if (!lufaResults?.orders?.length) {
    return [];
  }

  const labels = getWorkbookLabels(options.language);
  const rows: Array<Record<string, unknown>> = [];

  lufaResults.orders.forEach((order) => {
    order.probes.forEach((probe) => {
      if (probe.parameters.length === 0) {
        rows.push({
          [labels.lufaResults.orderNumber]: order.orderNumber,
          [labels.lufaResults.scope]: order.scope,
          [labels.lufaResults.reportDate]: order.reportedAt,
          [labels.lufaResults.sampleNumber]: probe.sampleNumber,
          [labels.lufaResults.foreignId]: probe.foreignId,
          [labels.lufaResults.piafKennung]: probe.piafKennung,
          [labels.lufaResults.bagNumber]: probe.bagNumber,
          [labels.lufaResults.fieldName]: probe.matchedFieldName,
          [labels.lufaResults.barcode]: probe.matchedBarcode,
          [labels.lufaResults.parameterCode]: '',
          [labels.lufaResults.parameterName]: '',
          [labels.lufaResults.result]: '',
          [labels.lufaResults.unit]: '',
          [labels.lufaResults.method]: '',
          [labels.lufaResults.external]: '',
        });
        return;
      }

      probe.parameters.forEach((parameter) => {
        rows.push({
          [labels.lufaResults.orderNumber]: order.orderNumber,
          [labels.lufaResults.scope]: order.scope,
          [labels.lufaResults.reportDate]: order.reportedAt,
          [labels.lufaResults.sampleNumber]: probe.sampleNumber,
          [labels.lufaResults.foreignId]: probe.foreignId,
          [labels.lufaResults.piafKennung]: probe.piafKennung,
          [labels.lufaResults.bagNumber]: probe.bagNumber,
          [labels.lufaResults.fieldName]: probe.matchedFieldName,
          [labels.lufaResults.barcode]: probe.matchedBarcode,
          [labels.lufaResults.parameterCode]: parameter.code,
          [labels.lufaResults.parameterName]: parameter.name,
          [labels.lufaResults.result]: parameter.result,
          [labels.lufaResults.unit]: parameter.unit,
          [labels.lufaResults.method]: parameter.method,
          [labels.lufaResults.external]: parameter.external ? labels.yes : '',
        });
      });
    });
  });

  return rows;
};

const buildDocumentationSheetAoa = (
  compiledFields: CompiledFieldRow[],
  options: CompletedProjectWorkbookOptions,
) => {
  const projectData = options.projectData || {};
  const customerProfile = projectData.customerProfile || {};
  const labels = getWorkbookLabels(options.language);
  const rows: Array<Array<string | number>> = [];
  const cropPlan = buildCropPlanLabel(projectData);

  const row1 = createEmptyRow(12);
  setCell(row1, 4, options.contractName || labels.documentation.fallbackTitle);
  rows.push(row1);

  const row2 = createEmptyRow(12);
  setCell(row2, 4, labels.documentation.subtitle);
  rows.push(row2);

  const row3 = createEmptyRow(12);
  setCell(row3, 0, labels.documentation.customer);
  setCell(row3, 2, toStringValue(customerProfile.customerNumber));
  setCell(row3, 4, buildDisplayName(customerProfile));
  setCell(row3, 8, labels.documentation.date);
  setCell(row3, 9, formatDateValue(projectData.samplingDetails?.samplingDate || projectData.labMeta?.orderDate || new Date().toISOString().slice(0, 10), options.language));
  rows.push(row3);

  const row4 = createEmptyRow(12);
  setCell(row4, 0, labels.documentation.project);
  setCell(row4, 2, options.contractId);
  setCell(row4, 4, options.contractName);
  setCell(row4, 8, labels.documentation.gridSize);
  setCell(row4, 9, toStringValue(projectData.gridSizeHa ? `${projectData.gridSizeHa} ha` : ''));
  rows.push(row4);

  const row5 = createEmptyRow(12);
  setCell(row5, 0, labels.documentation.services);
  setCell(row5, 2, joinList(Array.from(new Set(compiledFields.map((field) => field.serviceLabels).filter(Boolean)))));
  setCell(row5, 8, labels.documentation.cropPlan);
  setCell(row5, 9, cropPlan);
  rows.push(row5);

  rows.push(createEmptyRow(12));

  rows.push([
    labels.documentation.fieldId,
    labels.documentation.fieldName,
    labels.documentation.barcode,
    labels.documentation.barcodeList,
    labels.documentation.areaHa,
    labels.documentation.status,
    labels.documentation.services,
    labels.documentation.landUse,
    labels.documentation.crop,
    labels.documentation.yield,
    labels.documentation.depth,
    labels.documentation.samples,
    labels.documentation.summary,
    labels.documentation.notes,
  ]);

  compiledFields.forEach((field) => {
    const notes = joinList([
      field.labAttributes,
    ]);

    rows.push([
      field.sampleKey,
      field.sampleName,
      field.barcode,
      field.barcodeList,
      field.areaHa,
      field.status,
      field.serviceLabels,
      field.landUseType,
      field.crop,
      field.yieldValue,
      field.samplingDepthCm,
      field.sampleCount,
      field.summaryBadges,
      notes,
    ]);
  });

  return rows;
};

type ProviderSheetContent = {
  name: string;
  rows?: Array<Record<string, unknown>>;
  aoa?: Array<Array<string | number>>;
};

const buildProviderSheet = (
  compiledFields: CompiledFieldRow[],
  options: CompletedProjectWorkbookOptions,
): ProviderSheetContent => {
  const labProvider = options.labProvider || options.projectData?.labProvider || 'agrolab';
  const labels = getWorkbookLabels(options.language);

  if (labProvider === 'lufa_nrw') {
    return {
      name: labels.sheets.lufa,
      aoa: buildLufaBegleitscheinAoa(compiledFields, options),
    };
  }

  if (labProvider === 'pbs') {
    return {
      name: labels.sheets.pbs,
      aoa: generatePbsCsv(buildExportDraft(options, compiledFields))
        .trimEnd()
        .split(/\r?\n/)
        .map((line) => line.split(';').map((cell) => translateAgrolabCellValue(cell, options.language))),
    };
  }

  if (labProvider === 'documentation_only') {
    return {
      name: labels.sheets.documentation,
      aoa: buildDocumentationSheetAoa(compiledFields, options),
    };
  }

  return {
    name: labels.sheets.agrolab,
    aoa: buildAgrolabSheetAoa(compiledFields, options),
  };
};

const autosizeColumns = (sheet: XLSX.WorkSheet, rows: Array<Record<string, unknown>>) => {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  sheet['!cols'] = headers.map((header) => {
    const widestValue = rows.reduce((max, row) => {
      const valueLength = toStringValue(row[header]).length;
      return Math.max(max, valueLength);
    }, header.length);

    return { wch: Math.min(Math.max(widestValue + 2, 12), 36) };
  });
};

const autosizeAoaColumns = (sheet: XLSX.WorkSheet, aoa: Array<Array<string | number>>) => {
  const maxColumns = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  sheet['!cols'] = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const widestValue = aoa.reduce((max, row) => {
      const valueLength = toStringValue(row[columnIndex]).length;
      return Math.max(max, valueLength);
    }, 10);

    return { wch: Math.min(Math.max(widestValue + 2, 10), 40) };
  });
};

const appendJsonSheet = (workbook: XLSX.WorkBook, name: string, rows: Array<Record<string, unknown>>) => {
  const normalizedRows = rows.length > 0 ? rows : [{ Message: 'No rows available' }];
  const sheet = XLSX.utils.json_to_sheet(normalizedRows);
  autosizeColumns(sheet, normalizedRows);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
};

const appendAoaSheet = (workbook: XLSX.WorkBook, name: string, aoa: Array<Array<string | number>>) => {
  const normalizedRows = aoa.length > 0 ? aoa : [['No rows available']];
  const sheet = XLSX.utils.aoa_to_sheet(normalizedRows);
  autosizeAoaColumns(sheet, normalizedRows);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
};

export const downloadCompletedProjectWorkbook = (options: CompletedProjectWorkbookOptions): string => {
  const workbook = XLSX.utils.book_new();
  const compiledFields = compileProjectFields(options);
  const overviewRows = buildOverviewSheetRows(options, compiledFields);
  const fieldRows = buildFieldSheetRows(compiledFields, options.language);
  const providerSheet = buildProviderSheet(compiledFields, options);
  const lufaResultRows = buildLufaResultSheetRows(options);
  const labels = getWorkbookLabels(options.language);

  if (providerSheet.aoa) {
    appendAoaSheet(workbook, providerSheet.name, providerSheet.aoa);
  } else {
    appendJsonSheet(workbook, providerSheet.name, providerSheet.rows || []);
  }
  if (lufaResultRows.length > 0) {
    appendJsonSheet(workbook, labels.sheets.lufaResults, lufaResultRows);
  }
  appendJsonSheet(workbook, labels.sheets.overview, overviewRows);
  appendJsonSheet(workbook, labels.sheets.fields, fieldRows);

  const fileDate = new Date().toISOString().slice(0, 10);
  const providerLabel = formatProviderLabel(options.labProvider || options.projectData?.labProvider, options.language).toLowerCase().replace(/\s+/g, '_');
  const fileName = `${sanitizeFileName(options.contractName) || 'project'}_${providerLabel}_${fileDate}.xlsx`;
  const output = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return downloadBlob(blob, fileName);
};

export const downloadCompletedProjectShapes = async (options: CompletedProjectWorkbookOptions): Promise<string> => {
  const featureCollection = buildShapeExportFeatureCollection(options);
  if (featureCollection.features.length === 0) {
    throw new Error('No polygon boundaries available for shapes export');
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  const providerLabel = formatProviderLabel(options.labProvider || options.projectData?.labProvider, options.language).toLowerCase().replace(/\s+/g, '_');
  const fileRoot = `${sanitizeFileName(options.contractName) || 'project'}_${providerLabel}_${fileDate}`;
  const zipOutput = await shpwrite.zip(featureCollection, {
    folder: fileRoot,
    filename: fileRoot,
    outputType: 'blob',
    compression: 'STORE',
    prj: WGS84_PRJ,
    types: {
      polygon: 'fields',
    },
  });

  const blob = zipOutput instanceof Blob
    ? zipOutput
    : new Blob([toZipBlobPart(zipOutput)], { type: 'application/zip' });

  return downloadBlob(blob, `${fileRoot}.zip`);
};