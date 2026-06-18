import type {
  LufaPartyAddress,
  LufaResultImport,
  LufaResultLabel,
  LufaResultOrder,
  LufaResultParameter,
  LufaResultProbe,
  OrderDraft,
} from '../types';
import { buildLufaPreparedOrderGroups } from '../utils/lufa';

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

const getDirectChildren = (element: Element, tagName: string): Element[] => (
  Array.from(element.children).filter((child) => child.tagName === tagName)
);

const getDirectChild = (element: Element, tagName: string): Element | null => (
  getDirectChildren(element, tagName)[0] || null
);

const getDirectText = (element: Element, tagName: string): string => (
  toStringValue(getDirectChild(element, tagName)?.textContent)
);

const parseParty = (element: Element | null): LufaPartyAddress | undefined => {
  if (!element) return undefined;

  const party: LufaPartyAddress = {
    adrnr: getDirectText(element, 'AdrNr') || toStringValue(element.getAttribute('adrnr')),
    name: getDirectText(element, 'Name') || toStringValue(element.getAttribute('name')),
    firstName: toStringValue(element.getAttribute('vorname')),
    street: getDirectText(element, 'Strasse') || toStringValue(element.getAttribute('strasse')),
    postalCode: getDirectText(element, 'PLZ') || toStringValue(element.getAttribute('plz')),
    city: getDirectText(element, 'Ort') || toStringValue(element.getAttribute('ort')),
    country: getDirectText(element, 'Land') || toStringValue(element.getAttribute('land')),
    phone: toStringValue(element.getAttribute('telefon')),
    fax: toStringValue(element.getAttribute('fax')),
    email: toStringValue(element.getAttribute('email')),
  };

  return Object.values(party).some((value) => toStringValue(value).length > 0) ? party : undefined;
};

const parseLabels = (probeElement: Element): LufaResultLabel[] => (
  getDirectChildren(probeElement, 'Kennzeichnung').map((labelElement) => ({
    code: toStringValue(labelElement.getAttribute('knr')) || getDirectText(labelElement, 'Kennung'),
    name: getDirectText(labelElement, 'Bezeichnung') || undefined,
    value: getDirectText(labelElement, 'Wert'),
  })).filter((entry) => entry.code || entry.value)
);

const parseParameters = (probeElement: Element): LufaResultParameter[] => (
  getDirectChildren(probeElement, 'Pruefparameter').map((parameterElement) => ({
    code: toStringValue(parameterElement.getAttribute('untersuchung')) || getDirectText(parameterElement, 'Kennung'),
    name: getDirectText(parameterElement, 'Bezeichnung') || undefined,
    method: getDirectText(parameterElement, 'Methode') || undefined,
    result: getDirectText(parameterElement, 'Ergebnis1') || undefined,
    unit: getDirectText(parameterElement, 'Einheit1') || undefined,
    external: normalizeMatchValue(getDirectText(parameterElement, 'extern')) === 'ja',
  })).filter((entry) => entry.code || entry.name || entry.result)
);

const getLabelValue = (labels: LufaResultLabel[], matcher: (normalizedCode: string) => boolean): string => {
  const match = labels.find((entry) => matcher(normalizeMatchValue(entry.code || entry.name)));
  return toStringValue(match?.value);
};

const buildDraftProbeLookup = (draft: OrderDraft) => {
  const groups = buildLufaPreparedOrderGroups(draft);
  const lookup = new Map<string, { matchedFieldKey: string; matchedFieldName: string; matchedBarcode: string }>();

  groups.forEach((group) => {
    group.probes.forEach((probe) => {
      const entry = {
        matchedFieldKey: probe.baseId || probe.sampleKey,
        matchedFieldName: probe.sampleName || group.sampleName,
        matchedBarcode: probe.assignedBarcode || probe.primaryBarcode,
      };

      [
        probe.fremdkennung,
        probe.piafKennung,
        probe.bagNumber,
        probe.assignedBarcode,
        probe.primaryBarcode,
        probe.sampleKey,
        probe.baseId,
        probe.baseName,
        probe.sampleName,
      ].forEach((candidate) => {
        const normalized = normalizeMatchValue(candidate);
        if (!normalized || lookup.has(normalized)) return;
        lookup.set(normalized, entry);
      });
    });
  });

  return lookup;
};

const matchProbeToDraft = (
  probe: LufaResultProbe,
  lookup: Map<string, { matchedFieldKey: string; matchedFieldName: string; matchedBarcode: string }>,
): Pick<LufaResultProbe, 'matchedFieldKey' | 'matchedFieldName' | 'matchedBarcode'> => {
  const labelCandidates = [
    getLabelValue(probe.labels, (code) => code.includes('piafkennung')),
    getLabelValue(probe.labels, (code) => code.includes('tutennr') || code.includes('beutelnr') || code.includes('bag')),
    getLabelValue(probe.labels, (code) => code.includes('feldbezeichnung') || code.includes('flachenbezeichnung')),
  ];
  const rawCandidates = [
    probe.foreignId,
    probe.piafKennung,
    probe.bagNumber,
    probe.sampleNumber,
    probe.description,
    ...labelCandidates,
  ];

  for (const candidate of rawCandidates) {
    const rawCandidate = toStringValue(candidate);
    const normalized = normalizeMatchValue(candidate);
    if (!normalized) continue;
    const directMatch = lookup.get(normalized);
    if (directMatch) {
      return directMatch;
    }

    const underscorePrefix = rawCandidate.includes('_')
      ? normalizeMatchValue(rawCandidate.split('_')[0])
      : '';
    if (underscorePrefix && lookup.has(underscorePrefix)) {
      return lookup.get(underscorePrefix)!;
    }
  }

  return {};
};

export const parseLufaResultXml = (
  xmlContent: string,
  options: {
    fileName?: string;
    importedAt?: string;
    draft?: OrderDraft;
  } = {},
): LufaResultImport => {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlContent, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid LUFA result XML');
  }

  const root = document.documentElement;
  if (!root || root.tagName !== 'Export') {
    throw new Error('Unsupported LUFA result format');
  }

  const lookup = options.draft ? buildDraftProbeLookup(options.draft) : null;
  let unmatchedProbeCount = 0;

  const orders: LufaResultOrder[] = getDirectChildren(root, 'Auftrag').map((orderElement) => {
    const orderNumber = getDirectText(orderElement, 'Auftragsnummer') || toStringValue(orderElement.getAttribute('anr'));
    const probeElements = getDirectChildren(orderElement, 'Probe');

    const probes: LufaResultProbe[] = probeElements.map((probeElement) => {
      const labels = parseLabels(probeElement);
      const parameters = parseParameters(probeElement);
      const materialElement = getDirectChild(probeElement, 'Material');
      const bagNumber = getLabelValue(labels, (code) => code.includes('tutennr') || code.includes('beutelnr') || code.includes('bag'));
      const piafKennung = getLabelValue(labels, (code) => code.includes('piafkennung'));
      const probe: LufaResultProbe = {
        pnr: toStringValue(probeElement.getAttribute('pnr')) || undefined,
        sampleNumber: getDirectText(probeElement, 'Probenummer') || undefined,
        description: getDirectText(probeElement, 'Bezeichnung') || undefined,
        foreignId: getDirectText(probeElement, 'Fremdkennung') || undefined,
        piafKennung: piafKennung || undefined,
        bagNumber: bagNumber || undefined,
        receivedAt: getDirectText(probeElement, 'Probeneingang') || undefined,
        startedAt: getDirectText(probeElement, 'Pruefbeginn') || undefined,
        completedAt: getDirectText(probeElement, 'Pruefende') || undefined,
        materialCode: materialElement ? getDirectText(materialElement, 'Kennung') || undefined : undefined,
        materialName: materialElement ? getDirectText(materialElement, 'Bezeichnung') || undefined : undefined,
        labels,
        parameters,
      };

      if (lookup) {
        const match = matchProbeToDraft(probe, lookup);
        if (match.matchedFieldKey) {
          probe.matchedFieldKey = match.matchedFieldKey;
          probe.matchedFieldName = match.matchedFieldName;
          probe.matchedBarcode = match.matchedBarcode;
        } else {
          unmatchedProbeCount += 1;
        }
      }

      return probe;
    });

    const samplingElement = getDirectChild(orderElement, 'Probenahme');
    return {
      orderNumber: orderNumber || undefined,
      action: getDirectText(orderElement, 'Aktion') || undefined,
      client: parseParty(getDirectChild(orderElement, 'Auftraggeber')),
      scope: getDirectText(orderElement, 'Pruefgegenstand') || undefined,
      subject: getDirectText(orderElement, 'Pruefbereich') || undefined,
      receivedAt: getDirectText(orderElement, 'Auftragseingang') || undefined,
      reportedAt: getDirectText(orderElement, 'Berichtsdatum') || undefined,
      sampling: samplingElement ? {
        sampler: getDirectText(samplingElement, 'Probenehmer') || undefined,
        location: getDirectText(samplingElement, 'Probenahmeort') || undefined,
        sampledAt: getDirectText(samplingElement, 'Probenahmedatum') || undefined,
      } : undefined,
      probes,
    };
  });

  const probeCount = orders.reduce((sum, order) => sum + order.probes.length, 0);
  return {
    importedAt: options.importedAt || new Date().toISOString(),
    fileName: options.fileName,
    exportDate: toStringValue(root.getAttribute('Exportdatum')) || undefined,
    exportFileName: toStringValue(root.getAttribute('Exportdatei')) || undefined,
    orderCount: orders.length,
    probeCount,
    unmatchedProbeCount: lookup ? unmatchedProbeCount : undefined,
    orders,
  };
};

export const parseLufaResultXmlFile = async (
  file: File,
  draft?: OrderDraft,
): Promise<LufaResultImport> => {
  const buffer = await file.arrayBuffer();
  const xmlContent = decodeXmlBuffer(buffer);
  return parseLufaResultXml(xmlContent, {
    fileName: file.name,
    draft,
  });
};