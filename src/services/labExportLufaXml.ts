import type {
  OrderDraft
} from '../types';
import {
  buildLufaPartyXmlAttributes,
  buildLufaPreparedOrderGroups,
  normalizeLufaImportConfig,
  resolveLufaParties,
} from '../utils/lufa';

export interface LufaImportXmlOptions {
  includeXmlDeclaration?: boolean;
}

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

const formatXmlAttributes = (attributes: Record<string, string>): string => (
  Object.entries(attributes)
    .filter(([, value]) => toStringValue(value).length > 0)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
);

export const buildLufaImportXml = (
  draft: OrderDraft,
  options: LufaImportXmlOptions = {}
): string => {
  const includeDeclaration = options.includeXmlDeclaration !== false;
  const config = normalizeLufaImportConfig(draft.lufaImport);
  const groups = buildLufaPreparedOrderGroups(draft);
  const parties = resolveLufaParties(draft);
  const extraParameters = (config.zusatzpruefparameter || []).filter((value) => toStringValue(value));

  const lines: string[] = [];
  if (includeDeclaration) {
    lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  }

  lines.push('<import>');
  lines.push('  <kundeninformation>');
  lines.push(`    <kunde${formatXmlAttributes(parties.kundeAdrnr ? { adrnr: parties.kundeAdrnr } : {})}/>`);

  groups.forEach((group) => {
    lines.push(`    <auftrag standarduntersuchungsumfang="${escapeXml(group.scope)}">`);
    lines.push(`      <auftraggeber${formatXmlAttributes(buildLufaPartyXmlAttributes(parties.auftraggeber))}/>`);
    lines.push(`      <kostentraeger${formatXmlAttributes(buildLufaPartyXmlAttributes(parties.kostentraeger))}/>`);
    parties.durchschriftenempfaenger.forEach((recipient) => {
      lines.push(`      <durchschriftenempfaenger${formatXmlAttributes(buildLufaPartyXmlAttributes(recipient))}/>`);
    });

    group.probes.forEach((probe) => {
      lines.push(`      <probe fremdkennung="${escapeXml(probe.fremdkennung)}">`);
      probe.labels.forEach((item) => {
        const attributes = {
          element: item.element,
          wertlang: item.wertlang,
          ...(item.wertkurz ? { wertkurz: item.wertkurz } : {}),
        };
        lines.push(`        <kennzeichnung_probe${formatXmlAttributes(attributes)}/>`);
      });
      extraParameters.forEach((kennung) => {
        lines.push(`        <zusatzpruefparameter kennung="${escapeXml(kennung)}"/>`);
      });
      lines.push('      </probe>');
    });
    lines.push('    </auftrag>');
  });
  lines.push('  </kundeninformation>');
  lines.push('</import>');

  return lines.join('\n');
};
