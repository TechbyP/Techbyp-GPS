import type {
  LufaCopyRecipient,
  LufaImportConfig,
  LufaImportNminLayer,
  LufaPartyAddress,
  LufaStandarduntersuchungsumfang,
  OrderDraft,
} from '../types';
import { getFieldBarcodeList } from './orderBarcodes';

const DEFAULT_LUFA_COUNTRY = 'DE';

export const DEFAULT_LUFA_NMIN_LAYERS: LufaImportNminLayer[] = [
  { depthFromCm: 0, depthToCm: 30 },
  { depthFromCm: 30, depthToCm: 60 },
  { depthFromCm: 60, depthToCm: 90 },
];

const toStringValue = (value: unknown): string => {
  if (value == null) return '';
  return String(value).trim();
};

const normalizeStringRecord = (value: Record<string, unknown> | null | undefined): Record<string, string> => (
  Object.entries(value || {}).reduce<Record<string, string>>((acc, [key, entryValue]) => {
    const normalizedKey = toStringValue(key);
    const normalizedValue = toStringValue(entryValue);
    if (!normalizedKey || !normalizedValue) return acc;
    acc[normalizedKey] = normalizedValue;
    return acc;
  }, {})
);

const normalizeStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((entry) => {
    const next = toStringValue(entry);
    if (!next || seen.has(next)) return;
    seen.add(next);
    normalized.push(next);
  });

  return normalized;
};

const normalizeLayer = (layer: Partial<LufaImportNminLayer> | null | undefined): LufaImportNminLayer => ({
  depthFromCm: Number(layer?.depthFromCm || 0),
  depthToCm: Number(layer?.depthToCm || 0),
});

export const normalizeLufaAdrnr = (value: string): string => (
  value
    .trim()
    .replace(/\\/g, '/')
);

export const createEmptyLufaParty = (): LufaPartyAddress => ({
  adrnr: '',
  name: '',
  firstName: '',
  street: '',
  postalCode: '',
  city: '',
  country: DEFAULT_LUFA_COUNTRY,
  phone: '',
  fax: '',
  email: '',
});

export const createEmptyLufaCopyRecipient = (id: string): LufaCopyRecipient => ({
  id,
  label: '',
  ...createEmptyLufaParty(),
});

export const normalizeLufaParty = (
  value?: Partial<LufaPartyAddress> | null,
  fallback?: Partial<LufaPartyAddress> | null,
): LufaPartyAddress => {
  const merged = {
    ...createEmptyLufaParty(),
    ...(fallback || {}),
    ...(value || {}),
  };

  return {
    adrnr: normalizeLufaAdrnr(toStringValue(merged.adrnr)),
    name: toStringValue(merged.name),
    firstName: toStringValue(merged.firstName),
    street: toStringValue(merged.street),
    postalCode: toStringValue(merged.postalCode),
    city: toStringValue(merged.city),
    country: toStringValue(merged.country) || DEFAULT_LUFA_COUNTRY,
    phone: toStringValue(merged.phone),
    fax: toStringValue(merged.fax),
    email: toStringValue(merged.email),
  };
};

export const hasAnyLufaPartyValue = (value?: Partial<LufaPartyAddress> | null): boolean => {
  const normalized = normalizeLufaParty(value);
  return Boolean(
    normalized.adrnr
    || normalized.name
    || normalized.firstName
    || normalized.street
    || normalized.postalCode
    || normalized.city
    || normalized.country
    || normalized.phone
    || normalized.fax
    || normalized.email,
  );
};

export const isLufaPartyReady = (value?: Partial<LufaPartyAddress> | null): boolean => {
  const normalized = normalizeLufaParty(value);
  if (normalized.adrnr) return true;
  return Boolean(
    normalized.name
    && normalized.street
    && normalized.postalCode
    && normalized.city,
  );
};

export const buildLufaPartyXmlAttributes = (
  value?: Partial<LufaPartyAddress> | null,
): Record<string, string> => {
  const normalized = normalizeLufaParty(value);

  if (normalized.adrnr) {
    return { adrnr: normalized.adrnr };
  }

  const attributes: Record<string, string> = {};
  if (normalized.name) attributes.name = normalized.name;
  if (normalized.firstName) attributes.vorname = normalized.firstName;
  if (normalized.street) attributes.strasse = normalized.street;
  if (normalized.postalCode) attributes.plz = normalized.postalCode;
  if (normalized.city) attributes.ort = normalized.city;
  if (normalized.country) attributes.land = normalized.country;
  if (normalized.phone) attributes.telefon = normalized.phone;
  if (normalized.fax) attributes.fax = normalized.fax;
  if (normalized.email) attributes.email = normalized.email;

  return attributes;
};

export const getLufaPartyDisplayName = (value?: Partial<LufaPartyAddress> | null): string => {
  const normalized = normalizeLufaParty(value);
  const personName = [normalized.name, normalized.firstName].filter(Boolean).join(', ');
  return personName || normalized.adrnr || '';
};

export const buildLufaPartyFromSource = (
  source?: Record<string, unknown> | null,
  adrnr?: string,
): LufaPartyAddress => normalizeLufaParty({
  adrnr: normalizeLufaAdrnr(toStringValue(adrnr || source?.customerNumber)),
  name: toStringValue(source?.company || source?.name || source?.lastName),
  firstName: toStringValue(source?.firstName),
  street: toStringValue(source?.street),
  postalCode: toStringValue(source?.postalCode),
  city: toStringValue(source?.city),
  country: toStringValue(source?.country) || DEFAULT_LUFA_COUNTRY,
  phone: toStringValue(source?.phone),
  email: toStringValue(source?.email),
});

export const resolveLufaParties = (draft: OrderDraft): {
  kundeAdrnr: string;
  auftraggeber: LufaPartyAddress;
  kostentraeger: LufaPartyAddress;
  durchschriftenempfaenger: LufaCopyRecipient[];
} => {
  const config = normalizeLufaImportConfig(draft.lufaImport);
  const customerProfile = (draft.customerProfile || {}) as Record<string, unknown>;
  const billingRecipient = (draft.billingRecipient || {}) as Record<string, unknown>;
  const costBearerSource = draft.billingRecipient?.isDifferent ? billingRecipient : customerProfile;
  const auftraggeberFallback = buildLufaPartyFromSource(
    customerProfile,
    config.auftraggeberAdrnr || config.kundeAdrnr || toStringValue(customerProfile.customerNumber),
  );
  const kostentraegerFallback = buildLufaPartyFromSource(
    costBearerSource,
    config.kostentraegerAdrnr || config.kundeAdrnr || toStringValue(customerProfile.customerNumber),
  );

  const durchschriftenempfaenger = (config.durchschriftenempfaenger || [])
    .map((entry, index) => ({
      id: entry.id || `copy_${index + 1}`,
      label: entry.label,
      ...normalizeLufaParty(entry),
    }))
    .filter((entry) => hasAnyLufaPartyValue(entry));

  if (!durchschriftenempfaenger.length) {
    const fallbackCopy = buildLufaPartyFromSource(
      customerProfile,
      config.durchschriftenempfaengerAdrnr || config.kundeAdrnr || toStringValue(customerProfile.customerNumber),
    );
    if (hasAnyLufaPartyValue(fallbackCopy)) {
      durchschriftenempfaenger.push({
        id: 'copy_1',
        ...fallbackCopy,
      });
    }
  }

  return {
    kundeAdrnr: normalizeLufaAdrnr(
      config.kundeAdrnr || toStringValue(customerProfile.customerNumber),
    ),
    auftraggeber: hasAnyLufaPartyValue(config.auftraggeber)
      ? normalizeLufaParty(config.auftraggeber)
      : auftraggeberFallback,
    kostentraeger: hasAnyLufaPartyValue(config.kostentraeger)
      ? normalizeLufaParty(config.kostentraeger)
      : kostentraegerFallback,
    durchschriftenempfaenger,
  };
};

export const createDefaultLufaImport = (
  scope: LufaStandarduntersuchungsumfang = 'DED',
): LufaImportConfig => ({
  standarduntersuchungsumfang: scope,
  kundeAdrnr: '',
  auftraggeberAdrnr: '',
  kostentraegerAdrnr: '',
  durchschriftenempfaengerAdrnr: '',
  auftraggeber: createEmptyLufaParty(),
  kostentraeger: createEmptyLufaParty(),
  durchschriftenempfaenger: [
    createEmptyLufaCopyRecipient('copy_1'),
    createEmptyLufaCopyRecipient('copy_2'),
  ],
  defaultKennzeichnung: {
    Objekt: 'BO',
    Gruppenart: scope === 'Nmin' ? 'A' : 'AB',
  },
  defaultKennzeichnungKurz: {},
  zusatzpruefparameter: [],
  nminLayers: DEFAULT_LUFA_NMIN_LAYERS.map((layer) => ({ ...layer })),
  dateFormatHint: 'YYYYMMDD_HH24MISS',
  actionCode: '',
});

export const normalizeLufaCopyRecipients = (
  values?: LufaCopyRecipient[] | null,
  legacyAdrnr?: string,
): LufaCopyRecipient[] => {
  const source = Array.isArray(values) && values.length > 0
    ? values
    : [
        {
          id: 'copy_1',
          adrnr: normalizeLufaAdrnr(toStringValue(legacyAdrnr)),
        },
        {
          id: 'copy_2',
        },
      ];

  return source.map((entry, index) => ({
    id: toStringValue(entry?.id) || `copy_${index + 1}`,
    label: toStringValue(entry?.label),
    ...normalizeLufaParty(entry),
  }));
};

export const normalizeLufaImportConfig = (
  value?: LufaImportConfig | null,
): LufaImportConfig => {
  const scope = value?.standarduntersuchungsumfang || 'DED';
  const defaults = createDefaultLufaImport(scope);
  const auftraggeber = normalizeLufaParty(value?.auftraggeber, { adrnr: value?.auftraggeberAdrnr });
  const kostentraeger = normalizeLufaParty(value?.kostentraeger, { adrnr: value?.kostentraegerAdrnr });
  const durchschriftenempfaenger = normalizeLufaCopyRecipients(
    value?.durchschriftenempfaenger,
    value?.durchschriftenempfaengerAdrnr,
  );
  const nminLayers = Array.isArray(value?.nminLayers) && value.nminLayers.length > 0
    ? value.nminLayers.map((layer) => normalizeLayer(layer))
    : defaults.nminLayers || [];

  return {
    ...defaults,
    ...(value || {}),
    standarduntersuchungsumfang: scope,
    kundeAdrnr: normalizeLufaAdrnr(toStringValue(value?.kundeAdrnr)),
    auftraggeberAdrnr: auftraggeber.adrnr,
    kostentraegerAdrnr: kostentraeger.adrnr,
    durchschriftenempfaengerAdrnr: durchschriftenempfaenger[0]?.adrnr || '',
    auftraggeber,
    kostentraeger,
    durchschriftenempfaenger,
    defaultKennzeichnung: {
      ...(defaults.defaultKennzeichnung || {}),
      ...normalizeStringRecord(value?.defaultKennzeichnung as Record<string, unknown> | undefined),
    },
    defaultKennzeichnungKurz: normalizeStringRecord(
      value?.defaultKennzeichnungKurz as Record<string, unknown> | undefined,
    ),
    zusatzpruefparameter: normalizeStringList(value?.zusatzpruefparameter),
    nminLayers,
    dateFormatHint: value?.dateFormatHint || defaults.dateFormatHint,
    actionCode: toStringValue(value?.actionCode),
  };
};

type LufaProbeSeed = {
  sampleKey: string;
  sampleName: string;
  baseId: string;
  baseName: string;
  samplingDepthCm: string;
  soilType: string;
  barcodes: string[];
};

export type LufaPreparedLabel = {
  element: string;
  wertlang: string;
  wertkurz?: string;
};

export type LufaPreparedProbe = {
  scope: LufaStandarduntersuchungsumfang;
  groupIndex: number;
  groupCount: number;
  layerIndex: number;
  layerCount: number;
  sampleKey: string;
  sampleName: string;
  baseId: string;
  baseName: string;
  soilType: string;
  primaryBarcode: string;
  assignedBarcode: string;
  bagNumber: string;
  piafKennung: string;
  fremdkennung: string;
  kuerzel: string;
  depthFromCm?: number;
  depthToCm?: number;
  depthLabel: string;
  labels: LufaPreparedLabel[];
};

export type LufaPreparedOrderGroup = {
  scope: LufaStandarduntersuchungsumfang;
  groupIndex: number;
  groupCount: number;
  sampleKey: string;
  sampleName: string;
  baseId: string;
  baseName: string;
  primaryBarcode: string;
  probes: LufaPreparedProbe[];
};

const parseDepthRange = (value: string): { depthFromCm?: number; depthToCm?: number; depthLabel: string } => {
  const normalized = toStringValue(value);
  const rangeMatch = normalized.match(/(\d+)\s*[-/]\s*(\d+)/);
  if (rangeMatch) {
    return {
      depthFromCm: Number(rangeMatch[1]),
      depthToCm: Number(rangeMatch[2]),
      depthLabel: `${Number(rangeMatch[1])}-${Number(rangeMatch[2])}`,
    };
  }

  const singleMatch = normalized.match(/(\d+)/);
  if (singleMatch) {
    const depthToCm = Number(singleMatch[1]);
    return {
      depthFromCm: 0,
      depthToCm,
      depthLabel: `0-${depthToCm}`,
    };
  }

  return {
    depthFromCm: 0,
    depthToCm: 30,
    depthLabel: '0-30',
  };
};

const buildLufaProbeSeeds = (draft: OrderDraft): LufaProbeSeed[] => {
  if (Array.isArray(draft.fields) && draft.fields.length > 0) {
    return draft.fields.map((field, index) => ({
      sampleKey: toStringValue(field.exportMapping?.sampleKey)
        || toStringValue(field.fieldId)
        || toStringValue(field.baseId)
        || `field_${index + 1}`,
      sampleName: toStringValue(field.exportMapping?.sampleDisplayName)
        || toStringValue(field.fieldName)
        || toStringValue(field.baseName)
        || toStringValue(field.fieldId)
        || `Field ${index + 1}`,
      baseId: toStringValue(field.exportMapping?.sourceBaseId)
        || toStringValue(field.samplingCell?.parentBaseId)
        || toStringValue(field.baseId)
        || toStringValue(field.fieldId)
        || `field_${index + 1}`,
      baseName: toStringValue(field.exportMapping?.sourceBaseName)
        || toStringValue(field.samplingCell?.parentBaseName)
        || toStringValue(field.baseName)
        || toStringValue(field.fieldName)
        || toStringValue(field.fieldId)
        || `Field ${index + 1}`,
      samplingDepthCm: toStringValue(field.samplingDepthCm),
      soilType: toStringValue(field.soilType),
      barcodes: getFieldBarcodeList(field),
    }));
  }

  if (Array.isArray(draft.sourceFields) && draft.sourceFields.length > 0) {
    return draft.sourceFields.map((field, index) => ({
      sampleKey: toStringValue(field.baseId) || `field_${index + 1}`,
      sampleName: toStringValue(field.baseName) || toStringValue(field.baseId) || `Field ${index + 1}`,
      baseId: toStringValue(field.baseId) || `field_${index + 1}`,
      baseName: toStringValue(field.baseName) || toStringValue(field.baseId) || `Field ${index + 1}`,
      samplingDepthCm: '',
      soilType: '',
      barcodes: [],
    }));
  }

  return [];
};

const buildPreparedLabel = (
  element: string,
  wertlang: string,
  wertkurz?: string,
): LufaPreparedLabel | null => {
  const normalizedElement = toStringValue(element);
  const normalizedLong = toStringValue(wertlang);
  const normalizedShort = toStringValue(wertkurz);
  if (!normalizedElement || !normalizedLong) return null;
  return normalizedShort
    ? { element: normalizedElement, wertlang: normalizedLong, wertkurz: normalizedShort }
    : { element: normalizedElement, wertlang: normalizedLong };
};

export const buildLufaPreparedOrderGroups = (draft: OrderDraft): LufaPreparedOrderGroup[] => {
  const seeds = buildLufaProbeSeeds(draft);
  const config = normalizeLufaImportConfig(draft.lufaImport);
  const scope = config.standarduntersuchungsumfang || 'DED';
  const defaultLabels = config.defaultKennzeichnung || {};
  const shortLabels = config.defaultKennzeichnungKurz || {};
  const groupCount = seeds.length;
  const resolvedSerie = toStringValue(defaultLabels.Serie) || toStringValue(draft.name) || 'Order';
  const resolvedTermin = toStringValue(defaultLabels.Termin)
    || toStringValue(draft.samplingDetails?.samplingDate)
    || toStringValue(draft.labMeta?.orderDate)
    || new Date().toISOString().slice(0, 10);
  const resolvedOrtFallback = toStringValue(defaultLabels.Ort);
  const resolvedBezeichnungOverride = toStringValue(defaultLabels.Bezeichnung);
  const resolvedWdh = toStringValue(defaultLabels.Wdh) || '1';
  const resolvedGruppenart = toStringValue(defaultLabels.Gruppenart) || (scope === 'Nmin' ? 'A' : 'AB');
  const resolvedObjekt = toStringValue(defaultLabels.Objekt) || 'BO';

  return seeds.map((seed, groupIndex) => {
    const primaryBarcode = seed.barcodes[0] || seed.sampleKey;
    const layers = scope === 'Nmin'
      ? (config.nminLayers || DEFAULT_LUFA_NMIN_LAYERS)
      : [parseDepthRange(seed.samplingDepthCm)];

    const probes = layers.map((layer, index) => {
      const depthFromCm = 'depthFromCm' in layer ? Number(layer.depthFromCm) : Number(layer.depthFromCm || 0);
      const depthToCm = 'depthToCm' in layer ? Number(layer.depthToCm) : Number(layer.depthToCm || 0);
      const depthLabel = 'depthLabel' in layer && typeof layer.depthLabel === 'string'
        ? toStringValue(layer.depthLabel)
        : `${depthFromCm}-${depthToCm}`;
      const assignedBarcode = scope === 'Nmin'
        ? (seed.barcodes[index] || primaryBarcode)
        : primaryBarcode;
      const bagNumber = assignedBarcode || primaryBarcode || seed.sampleKey;
      const needsLayerSuffix = scope === 'Nmin' && (!seed.barcodes[index] || seed.barcodes.length < layers.length);
      const fremdkennung = needsLayerSuffix
        ? `${bagNumber}_${depthLabel}`
        : bagNumber;
      const piafKennung = primaryBarcode || bagNumber || seed.sampleKey;
      const kuerzel = toStringValue(defaultLabels.Kürzel)
        || (scope === 'Nmin' ? `${groupIndex + 1}/*` : `${groupIndex + 1}/${groupCount}/*`);
      const labels = new Map<string, LufaPreparedLabel>();

      const addLabel = (element: string, wertlang: string, wertkurz?: string) => {
        const prepared = buildPreparedLabel(element, wertlang, wertkurz);
        if (!prepared) return;
        labels.set(prepared.element, prepared);
      };

      addLabel('piafKennung', piafKennung, shortLabels.piafKennung);
      addLabel('Ort', resolvedOrtFallback || seed.baseName, shortLabels.Ort);
      addLabel('Serie', resolvedSerie, shortLabels.Serie);
      addLabel('Termin', resolvedTermin, shortLabels.Termin);
      addLabel('Bezeichnung', resolvedBezeichnungOverride || seed.sampleName, shortLabels.Bezeichnung);
      if (scope === 'Nmin') {
        addLabel('Gruppe', String(groupIndex + 1), shortLabels.Gruppe);
        addLabel('Nr', String(index + 1), shortLabels.Nr);
        addLabel('Schicht von', String(depthFromCm), shortLabels['Schicht von']);
        addLabel('Schicht bis', String(depthToCm), shortLabels['Schicht bis']);
        addLabel('Schicht', depthLabel, shortLabels.Schicht);
      } else {
        addLabel('Schicht von', String(depthFromCm), shortLabels['Schicht von']);
      }
      addLabel('Wdh', resolvedWdh, shortLabels.Wdh);
      addLabel('Kürzel', kuerzel, shortLabels.Kürzel || kuerzel);
      addLabel('Gruppenart', resolvedGruppenart, shortLabels.Gruppenart);
      addLabel('Objekt', resolvedObjekt, shortLabels.Objekt);

      Object.entries(defaultLabels).forEach(([key, value]) => {
        if (labels.has(key)) return;
        addLabel(key, value, shortLabels[key]);
      });

      return {
        scope,
        groupIndex: groupIndex + 1,
        groupCount,
        layerIndex: index + 1,
        layerCount: layers.length,
        sampleKey: seed.sampleKey,
        sampleName: seed.sampleName,
        baseId: seed.baseId,
        baseName: seed.baseName,
        soilType: seed.soilType,
        primaryBarcode,
        assignedBarcode,
        bagNumber,
        piafKennung,
        fremdkennung,
        kuerzel,
        depthFromCm,
        depthToCm,
        depthLabel,
        labels: Array.from(labels.values()),
      } satisfies LufaPreparedProbe;
    });

    return {
      scope,
      groupIndex: groupIndex + 1,
      groupCount,
      sampleKey: seed.sampleKey,
      sampleName: seed.sampleName,
      baseId: seed.baseId,
      baseName: seed.baseName,
      primaryBarcode,
      probes,
    } satisfies LufaPreparedOrderGroup;
  });
};