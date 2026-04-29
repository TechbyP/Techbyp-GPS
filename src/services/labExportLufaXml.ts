import type {
  LufaImportConfig,
  LufaImportNminLayer,
  LufaStandarduntersuchungsumfang,
  OrderDraft
} from '../types';

export interface LufaImportXmlOptions {
  includeXmlDeclaration?: boolean;
}

type ProbeSeed = {
  fieldId: string;
  fieldName: string;
  baseId: string;
  baseName: string;
};

type ProbePayload = {
  fremdkennung: string;
  kennzeichnung: Array<{ element: string; wertlang: string }>;
};

type ProbeLabelContext = {
  scope: LufaStandarduntersuchungsumfang;
  groupIndex: number;
  groupCount: number;
  layerIndex: number;
};

const DEFAULT_NMIN_LAYERS: LufaImportNminLayer[] = [
  { depthFromCm: 0, depthToCm: 30 },
  { depthFromCm: 30, depthToCm: 60 },
  { depthFromCm: 60, depthToCm: 90 }
];

const escapeXml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
);

const toStringValue = (value: unknown): string => {
  if (value == null) return '';
  return String(value).trim();
};

const normalizeAdrnrValue = (value: unknown): string => (
  toStringValue(value)
    .replace(/\\/g, '/')
);

const getScope = (config?: LufaImportConfig): LufaStandarduntersuchungsumfang => (
  config?.standarduntersuchungsumfang || 'DED'
);

const getNminLayers = (config?: LufaImportConfig): LufaImportNminLayer[] => (
  config?.nminLayers?.length ? config.nminLayers : DEFAULT_NMIN_LAYERS
);

const buildProbeSeeds = (draft: OrderDraft): ProbeSeed[] => {
  if (Array.isArray(draft.fields) && draft.fields.length > 0) {
    return draft.fields.map((field) => ({
      fieldId: toStringValue(field.fieldId) || toStringValue(field.baseId) || 'field',
      fieldName: toStringValue(field.fieldName) || toStringValue(field.baseName) || toStringValue(field.fieldId),
      baseId: toStringValue(field.baseId) || toStringValue(field.fieldId) || 'field',
      baseName: toStringValue(field.baseName) || toStringValue(field.fieldName) || toStringValue(field.fieldId)
    }));
  }

  if (Array.isArray(draft.sourceFields) && draft.sourceFields.length > 0) {
    return draft.sourceFields.map((field, index) => ({
      fieldId: `${toStringValue(field.baseId) || 'field'}.${index + 1}`,
      fieldName: toStringValue(field.baseName) || toStringValue(field.baseId) || `Field ${index + 1}`,
      baseId: toStringValue(field.baseId) || `field_${index + 1}`,
      baseName: toStringValue(field.baseName) || toStringValue(field.baseId) || `Field ${index + 1}`
    }));
  }

  return [];
};

const makeFremdkennung = (seed: ProbeSeed, index: number, suffix?: string): string => {
  const raw = `${seed.fieldId}_${index + 1}${suffix ? `_${suffix}` : ''}`;
  return raw.replace(/\s+/g, '_');
};

const buildDefaultKennzeichnung = (
  draft: OrderDraft,
  seed: ProbeSeed,
  fremdkennung: string,
  context: ProbeLabelContext,
  layer?: LufaImportNminLayer
): Array<{ element: string; wertlang: string }> => {
  const labels = new Map<string, string>();

  labels.set('piafKennung', fremdkennung);
  labels.set('Ort', seed.baseName);
  labels.set('Serie', toStringValue(draft.name) || 'Order');
  labels.set('Termin', new Date().toISOString().slice(0, 10));
  labels.set('Bezeichnung', seed.fieldName);

  if (layer) {
    labels.set('Schicht von', String(layer.depthFromCm));
    labels.set('Schicht bis', String(layer.depthToCm));
    labels.set('Schicht', `${layer.depthFromCm}-${layer.depthToCm}`);
  } else {
    labels.set('Schicht von', '0');
  }

  labels.set('Wdh', '1');
  if (context.scope === 'Nmin') {
    labels.set('Gruppe', String(context.groupIndex));
    labels.set('Nr', String(context.layerIndex));
    labels.set('Kürzel', `${context.groupIndex}/*`);
  } else {
    labels.set('Kürzel', `${context.groupIndex}/${context.groupCount}/*`);
  }

  const defaultKennzeichnung = draft.lufaImport?.defaultKennzeichnung || {};
  Object.entries(defaultKennzeichnung).forEach(([key, value]) => {
    if (!toStringValue(key) || !toStringValue(value)) return;
    labels.set(key, value);
  });

  return Array.from(labels.entries()).map(([element, wertlang]) => ({ element, wertlang }));
};

const buildProbePayloads = (draft: OrderDraft): ProbePayload[] => {
  const seeds = buildProbeSeeds(draft);
  const scope = getScope(draft.lufaImport);

  if (scope !== 'Nmin') {
    return seeds.map((seed, index) => {
      const fremdkennung = makeFremdkennung(seed, index);
      return {
        fremdkennung,
        kennzeichnung: buildDefaultKennzeichnung(draft, seed, fremdkennung, {
          scope,
          groupIndex: index + 1,
          groupCount: seeds.length,
          layerIndex: 1
        })
      };
    });
  }

  const layers = getNminLayers(draft.lufaImport);
  const probes: ProbePayload[] = [];
  seeds.forEach((seed, seedIndex) => {
    layers.forEach((layer, layerIndex) => {
      const fremdkennung = makeFremdkennung(seed, seedIndex, `${layer.depthFromCm}-${layer.depthToCm}-${layerIndex + 1}`);
      probes.push({
        fremdkennung,
        kennzeichnung: buildDefaultKennzeichnung(draft, seed, fremdkennung, {
          scope,
          groupIndex: seedIndex + 1,
          groupCount: seeds.length,
          layerIndex: layerIndex + 1
        }, layer)
      });
    });
  });
  return probes;
};

export const buildLufaImportXml = (
  draft: OrderDraft,
  options: LufaImportXmlOptions = {}
): string => {
  const includeDeclaration = options.includeXmlDeclaration !== false;
  const scope = getScope(draft.lufaImport);
  const probes = buildProbePayloads(draft);
  const kundeAdrnr = normalizeAdrnrValue(draft.lufaImport?.kundeAdrnr);
  const auftraggeberAdrnr = normalizeAdrnrValue(draft.lufaImport?.auftraggeberAdrnr);
  const kostentraegerAdrnr = normalizeAdrnrValue(draft.lufaImport?.kostentraegerAdrnr);
  const durchschriftAdrnr = normalizeAdrnrValue(draft.lufaImport?.durchschriftenempfaengerAdrnr);
  const extraParameters = (draft.lufaImport?.zusatzpruefparameter || []).filter((value) => toStringValue(value));

  const lines: string[] = [];
  if (includeDeclaration) {
    lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  }

  lines.push('<import>');
  lines.push('  <kundeninformation>');
  lines.push(`    <kunde adrnr="${escapeXml(kundeAdrnr)}"/>`);
  lines.push(`    <auftrag standarduntersuchungsumfang="${escapeXml(scope)}">`);
  lines.push(`      <auftraggeber adrnr="${escapeXml(auftraggeberAdrnr)}"/>`);
  lines.push(`      <kostentraeger adrnr="${escapeXml(kostentraegerAdrnr)}"/>`);
  lines.push(`      <durchschriftenempfaenger adrnr="${escapeXml(durchschriftAdrnr)}"/>`);

  probes.forEach((probe) => {
    lines.push(`      <probe fremdkennung="${escapeXml(probe.fremdkennung)}">`);
    probe.kennzeichnung.forEach((item) => {
      lines.push(
        `        <kennzeichnung_probe element="${escapeXml(item.element)}" wertlang="${escapeXml(item.wertlang)}"/>`
      );
    });
    extraParameters.forEach((kennung) => {
      lines.push(`        <zusatzpruefparameter kennung="${escapeXml(kennung)}"/>`);
    });
    lines.push('      </probe>');
  });

  lines.push('    </auftrag>');
  lines.push('  </kundeninformation>');
  lines.push('</import>');

  return lines.join('\n');
};
