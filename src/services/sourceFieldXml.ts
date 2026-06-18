import type { OrderDraft } from '../types';

type SourceFields = NonNullable<OrderDraft['sourceFields']>;

type SourceFieldXmlRecord = {
  joinKeys: string[];
  landUseCode: string;
  landUseLabel?: string;
};

export type SourceFieldXmlImportResult = {
  sourceFields: SourceFields;
  fileName?: string;
  recordCount: number;
  matchedRecordCount: number;
  matchedFieldCount: number;
  unmatchedRecordCount: number;
};

const toStringValue = (value: unknown): string => {
  if (value == null) return '';
  return String(value).trim();
};

const normalizeMatchValue = (value: unknown): string => (
  toStringValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
);

const normalizeEncodingLabel = (value: string): string => {
  const normalized = value.toLowerCase().replace(/_/g, '-');
  if (normalized === 'iso8859-15') return 'iso-8859-15';
  if (normalized === 'iso8859-1' || normalized === 'latin1') return 'iso-8859-1';
  return normalized;
};

const detectXmlEncoding = (bytes: Uint8Array): string => {
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  const match = header.match(/encoding=["']([^"']+)["']/i);
  return normalizeEncodingLabel(match?.[1] || 'utf-8');
};

const decodeXmlBuffer = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const encoding = detectXmlEncoding(bytes);

  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch (error) {
    if (encoding !== 'utf-8') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    throw error;
  }
};

const getDirectChildrenByTagNames = (element: Element, tagNames: string[]): Element[] => {
  const normalizedTagNames = new Set(tagNames.map((tagName) => tagName.toLowerCase()));
  return Array.from(element.children).filter((child) => normalizedTagNames.has(child.tagName.toLowerCase()));
};

const getDirectChildText = (element: Element, tagNames: string[]): string => {
  const child = getDirectChildrenByTagNames(element, tagNames)[0] || null;
  return toStringValue(child?.textContent);
};

const collectNormalizedKeys = (values: unknown[]): string[] => {
  const keys = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeMatchValue(value);
    if (normalized) {
      keys.add(normalized);
    }
  });
  return Array.from(keys);
};

const normalizeLandUseCode = (value: unknown): string => {
  const normalized = toStringValue(value);
  if (!normalized) return '';

  const upper = normalized.toUpperCase();
  const compact = upper.replace(/[^A-Z]/g, '');

  if (compact === 'ACKERLAND' || compact === 'ACKER') return 'A';
  if (compact === 'WEIDELAND' || compact === 'WEIDE' || compact === 'PASTURE') return 'W';
  if (compact === 'GRUNLAND' || compact === 'GRUENLAND' || compact === 'GRASSLAND' || compact === 'LAWN') return 'R';
  if (compact === 'OBSTBAU' || compact === 'OBST') return 'O';
  if (compact === 'SPARGEL') return 'S';
  if (compact === 'GEHOLZE' || compact === 'GEHOELZE' || compact === 'WOOD' || compact === 'WOODYPLANTS') return 'F';
  if (compact === 'UNTERBODEN' || compact === 'SUBSOIL') return 'U';
  if (compact === 'SONSTIGES' || compact === 'OTHER') return 'X';
  if (/^[AWROSFUX]$/.test(upper)) return upper;

  return upper;
};

const getAllElementsByTagName = (root: Element, tagName: string): Element[] => (
  Array.from(root.getElementsByTagName(tagName))
);

const parseProbeLabels = (probeElement: Element): Array<{ key: string; value: string }> => {
  const labels: Array<{ key: string; value: string }> = [];

  getDirectChildrenByTagNames(probeElement, ['Kennzeichnung']).forEach((labelElement) => {
    const key = toStringValue(labelElement.getAttribute('knr'))
      || getDirectChildText(labelElement, ['Kennung'])
      || getDirectChildText(labelElement, ['Bezeichnung']);
    const value = getDirectChildText(labelElement, ['Wert']);
    if (key && value) {
      labels.push({ key, value });
    }
  });

  getDirectChildrenByTagNames(probeElement, ['kennzeichnung_probe']).forEach((labelElement) => {
    const key = toStringValue(labelElement.getAttribute('element'));
    const value = toStringValue(labelElement.getAttribute('wertlang'))
      || toStringValue(labelElement.getAttribute('wertkurz'))
      || toStringValue(labelElement.textContent);
    if (key && value) {
      labels.push({ key, value });
    }
  });

  return labels;
};

const getLabelValue = (
  labels: Array<{ key: string; value: string }>,
  matcher: (normalizedKey: string) => boolean,
): string => {
  const match = labels.find((entry) => matcher(normalizeMatchValue(entry.key)));
  return toStringValue(match?.value);
};

const parseSourceFieldXml = (xmlContent: string): SourceFieldXmlRecord[] => {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlContent, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid XML file');
  }

  const root = document.documentElement;
  if (!root) {
    throw new Error('Unsupported XML field classification format');
  }

  const probeElements = [
    ...getAllElementsByTagName(root, 'Probe'),
    ...getAllElementsByTagName(root, 'probe'),
  ];

  const records = probeElements.map((probeElement) => {
    const labels = parseProbeLabels(probeElement);

    const landUseCode = normalizeLandUseCode(
      getLabelValue(labels, (key) => key.includes('nutzungscode') || key.includes('landusecode'))
      || getLabelValue(labels, (key) => key === 'nutzung' || key === 'landuse')
    );
    const landUseLabel = getLabelValue(labels, (key) => key === 'nutzung' || key === 'landuse') || undefined;

    const foreignId = getDirectChildText(probeElement, ['Fremdkennung']) || toStringValue(probeElement.getAttribute('fremdkennung'));
    const sampleNumber = getDirectChildText(probeElement, ['Probenummer']);
    const sampleDescription = getDirectChildText(probeElement, ['Bezeichnung']);
    const piafKennung = getLabelValue(labels, (key) => key.includes('piafkennung'));
    const fieldName = getLabelValue(labels, (key) => key.includes('flachenbezeichnung') || key.includes('feldbezeichnung') || key.includes('schlagname'));
    const schlagNr = getLabelValue(labels, (key) => key.includes('schlagnummer') || key.includes('schlagnr'));
    const teilschlag = getLabelValue(labels, (key) => key.includes('teilschlag'));
    const flik = getLabelValue(labels, (key) => key === 'flik');
    const regNr = getLabelValue(labels, (key) => key === 'regnr');
    const objektId = getLabelValue(labels, (key) => key.includes('objektid'));
    const bagNumber = getLabelValue(labels, (key) => key.includes('tutennr') || key.includes('beutelnr') || key.includes('bag'));

    return {
      joinKeys: collectNormalizedKeys([
        foreignId,
        sampleNumber,
        sampleDescription,
        piafKennung,
        fieldName,
        schlagNr,
        teilschlag,
        flik,
        regNr,
        objektId,
        bagNumber,
        `${schlagNr}.${teilschlag}`,
        `${flik}.${teilschlag}`,
      ]),
      landUseCode,
      landUseLabel,
    };
  }).filter((record) => record.landUseCode && record.joinKeys.length > 0);

  if (!records.length) {
    throw new Error('No land use entries found in XML');
  }

  return records;
};

const buildSourceFieldMatchKeys = (field: SourceFields[number]): string[] => {
  const rawPropertyValues = Object.values(field.importMeta?.rawProperties || {});
  return collectNormalizedKeys([
    ...(field.importMeta?.joinKeys || []),
    field.baseId,
    field.baseName,
    field.exportMapping?.sampleKey,
    field.exportMapping?.sampleDisplayName,
    field.exportMapping?.sourceBaseId,
    field.exportMapping?.sourceBaseName,
    ...rawPropertyValues,
  ]);
};

export const applySourceFieldXmlImport = async (
  sourceFields: SourceFields,
  file: File,
): Promise<SourceFieldXmlImportResult> => {
  const xmlContent = decodeXmlBuffer(await file.arrayBuffer());
  const records = parseSourceFieldXml(xmlContent);

  const nextFields = sourceFields.map((field) => ({
    ...field,
    importMeta: field.importMeta
      ? {
        ...field.importMeta,
        rawProperties: field.importMeta.rawProperties
          ? { ...field.importMeta.rawProperties }
          : undefined,
        joinKeys: field.importMeta.joinKeys ? [...field.importMeta.joinKeys] : undefined,
      }
      : undefined,
  }));

  const lookup = new Map<string, number>();
  nextFields.forEach((field, index) => {
    buildSourceFieldMatchKeys(field).forEach((matchKey) => {
      if (!lookup.has(matchKey)) {
        lookup.set(matchKey, index);
      }
    });
  });

  const matchedFields = new Set<number>();
  let matchedRecordCount = 0;
  let unmatchedRecordCount = 0;

  records.forEach((record) => {
    const matchIndex = record.joinKeys
      .map((joinKey) => lookup.get(joinKey))
      .find((index): index is number => index != null);

    if (matchIndex == null) {
      unmatchedRecordCount += 1;
      return;
    }

    matchedRecordCount += 1;
    matchedFields.add(matchIndex);

    const field = nextFields[matchIndex];
    field.importMeta = {
      ...(field.importMeta || {}),
      sourceType: field.importMeta?.sourceType || 'xml',
      joinKeys: collectNormalizedKeys([
        ...(field.importMeta?.joinKeys || []),
        ...record.joinKeys,
      ]),
      landUseCode: record.landUseCode,
      landUseLabel: record.landUseLabel || field.importMeta?.landUseLabel,
    };
  });

  return {
    sourceFields: nextFields,
    fileName: file.name,
    recordCount: records.length,
    matchedRecordCount,
    matchedFieldCount: matchedFields.size,
    unmatchedRecordCount,
  };
};