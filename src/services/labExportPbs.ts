import templateCsv from '../assets/templates/agrolab-template.csv?raw';
import type { OrderDraft } from '../types';
import { getFieldBarcodeList } from '../utils/orderBarcodes';
import { getPbsProfileDefinition, normalizePbsConfig } from '../utils/pbs';

const formatDate = (date: Date) => date.toLocaleDateString('de-DE');

const normalizeDateValue = (value: string | undefined) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return formatDate(new Date(`${trimmed}T00:00:00`));
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
};

const setValue = (row: string[], header: string[], columnName: string, value: string) => {
  const idx = header.findIndex((col) => col.trim() === columnName.trim());
  if (idx >= 0) {
    row[idx] = value;
  }
};

const setHeaderIndex = (row: string[], index: number, value: string) => {
  while (row.length <= index) {
    row.push('');
  }
  row[index] = value;
};

const ensureRowLength = (row: string[], size: number) => {
  while (row.length < size) {
    row.push('');
  }
};

const patchPbsHeaders = (lines: string[][], profile: ReturnType<typeof getPbsProfileDefinition>) => {
  const rowIndexByCode: Record<string, number> = {};
  const headerIndexByCode: Record<string, number> = {};

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i][0] === 'Z' && lines[i + 1] && lines[i + 1][0] && lines[i + 1][0].length === 1) {
      const nextCode = lines[i + 1][0];
      headerIndexByCode[nextCode] = i;
      rowIndexByCode[nextCode] = i + 1;
    }

    if (lines[i][0] === 'E' && rowIndexByCode.E == null) {
      rowIndexByCode.E = i;
    }
  }

  const headerD = lines[headerIndexByCode.D];
  const headerF = lines[headerIndexByCode.F];
  const headerH = lines[headerIndexByCode.H];
  const rowE = lines[rowIndexByCode.E];

  if (profile.requiresNminType) {
    setHeaderIndex(headerD, 10, 'Nmin-Typ');
    rowE[1] = 'Auftragsverteiler';
    setHeaderIndex(headerF, 14, 'PN0-30');
    setHeaderIndex(headerF, 15, 'PN0-60');
    setHeaderIndex(headerF, 16, 'PN0-90');
    setHeaderIndex(headerF, 17, 'PN0-x');
    if (profile.includesAnzahlPnStellen) {
      setHeaderIndex(headerF, 18, 'AnzahlPN-Stellen');
    }
  } else {
    rowE[1] = 'e-mail(s) (,-getrennt)';
  }

  if (profile.supportsMultipleBarcodes) {
    setHeaderIndex(headerH, 3, 'Tütenbarcode 1');
    setHeaderIndex(headerH, 4, 'Tütenbarcode 2');
    setHeaderIndex(headerH, 5, 'Tütenbarcode 3');
    setHeaderIndex(headerH, 6, 'Schlagnr.');
    setHeaderIndex(headerH, 7, 'Teilschlagnr.');
    setHeaderIndex(headerH, 8, 'Schlagname');
    setHeaderIndex(headerH, 9, 'Erweiterung Schlagname');
    setHeaderIndex(headerH, 10, 'Schlag-größe [ha]');
    setHeaderIndex(headerH, 11, 'Proben-Fläche [ha]');
    setHeaderIndex(headerH, 12, 'Nutzung [A/W/R/O/H/U]');
    setHeaderIndex(headerH, 13, 'Ernte-reste abg. [j/n]');
    setHeaderIndex(headerH, 14, 'Transport-tracking-nr.');
    setHeaderIndex(headerH, 15, 'Bodenart');
    setHeaderIndex(headerH, 16, 'Humusklasse');
    setHeaderIndex(headerH, 17, 'Standard pH/P/K/Mg');
    setHeaderIndex(headerH, 18, 'Spuren CAT Na,Mn,Cu,B,Zn');
    setHeaderIndex(headerH, 19, 'Humusgehalt');
    setHeaderIndex(headerH, 20, 'C/N-Verhältnis');
    setHeaderIndex(headerH, 21, 'Kali-Fixierung');
    setHeaderIndex(headerH, 22, 'Calcium');
    setHeaderIndex(headerH, 23, 'KAK eff');
    setHeaderIndex(headerH, 24, 'KAK pot');
    setHeaderIndex(headerH, 25, 'Korngrößen-verteilung');
    setHeaderIndex(headerH, 26, 'P-Freisetzungs-rate');
    setHeaderIndex(headerH, 27, 's. Codeliste');
    setHeaderIndex(headerH, 28, 'Nmin 7900');
    setHeaderIndex(headerH, 29, 'Smin-Zusatz 7901 SCHICHT1');
    setHeaderIndex(headerH, 30, 'Smin-Zusatz 7901 SCHICHT1-3');
    setHeaderIndex(headerH, 31, 'Option 1');
    setHeaderIndex(headerH, 32, 'Option 2');
    setHeaderIndex(headerH, 33, 'Option 3');
    setHeaderIndex(headerH, 34, 'DüngEmpf N+S 7990');
    setHeaderIndex(headerH, 35, 'DüngEmpf N 7991');
  }

  return {
    rowIndexByCode,
    headerByCode: {
      A: lines[headerIndexByCode.A],
      B: lines[headerIndexByCode.B],
      C: lines[headerIndexByCode.C],
      D: lines[headerIndexByCode.D],
      E: lines[rowIndexByCode.E],
      F: lines[headerIndexByCode.F],
      G: lines[headerIndexByCode.G],
      H: lines[headerIndexByCode.H],
    } as Record<string, string[]>,
  };
};

export const generatePbsCsv = (draft: OrderDraft) => {
  const pbsConfig = normalizePbsConfig(draft.pbsConfig);
  const profile = getPbsProfileDefinition(pbsConfig.profile);
  const lines = templateCsv.trimEnd().split(/\r?\n/).map((line) => line.split(';'));
  const { headerByCode, rowIndexByCode } = patchPbsHeaders(lines, profile);

  const customer = draft.customerProfile || {};
  const billing = draft.billingRecipient || { isDifferent: false };
  const fields = draft.fields || [];
  const labMeta = draft.labMeta || {};
  const sampling = draft.samplingDetails || {};

  if (rowIndexByCode.A != null && headerByCode.A) {
    const row = lines[rowIndexByCode.A];
    ensureRowLength(row, headerByCode.A.length);
    setValue(row, headerByCode.A, 'Beauftragtes Labor', labMeta.assignedLab || '');
    setValue(row, headerByCode.A, 'Labor', labMeta.labName || '');
    setValue(row, headerByCode.A, 'Probenart,BNS', profile.profileCode || labMeta.sampleTypeBns || '');
    setValue(row, headerByCode.A, 'Version', profile.version);
    setValue(row, headerByCode.A, 'Paketdienst-Tracking', labMeta.trackingNumber || '');
    setValue(row, headerByCode.A, 'Datum', normalizeDateValue(labMeta.orderDate));
    setValue(row, headerByCode.A, 'Speichername', labMeta.storageName || '');
    setValue(row, headerByCode.A, 'lab-interne Info', labMeta.internalInfo || '');
  }

  if (rowIndexByCode.B != null && headerByCode.B) {
    const row = lines[rowIndexByCode.B];
    ensureRowLength(row, headerByCode.B.length);
    setValue(row, headerByCode.B, 'Kundennummer AL', pbsConfig.customerNumberAgrolab || '');
    setValue(row, headerByCode.B, 'Kundennummer Kd', customer.customerNumber || '');
    setValue(row, headerByCode.B, 'Name', customer.lastName || '');
    setValue(row, headerByCode.B, 'Vorname', customer.firstName || '');
    setValue(row, headerByCode.B, 'Straße Nr.', customer.street || '');
    setValue(row, headerByCode.B, 'PLZ', customer.postalCode || '');
    setValue(row, headerByCode.B, 'Ort', customer.city || '');
    setValue(row, headerByCode.B, 'e-mail', customer.email || '');
    setValue(row, headerByCode.B, 'Telefon', customer.phone || '');
    setValue(row, headerByCode.B, 'Land', customer.country || 'Deutschland');
    setValue(row, headerByCode.B, 'Bundesland', customer.federalState || '');
    setValue(row, headerByCode.B, 'MWSt - VAT-No.', billing.vatNumber || '');
  }

  if (rowIndexByCode.C != null && headerByCode.C && billing.isDifferent) {
    const row = lines[rowIndexByCode.C];
    ensureRowLength(row, headerByCode.C.length);
    setValue(row, headerByCode.C, 'Kd.Nr. AL', pbsConfig.customerNumberAgrolab || '');
    setValue(row, headerByCode.C, 'Kd.Nr. Kd', pbsConfig.billingCustomerNumber || '');
    setValue(row, headerByCode.C, 'Name', billing.name || '');
    setValue(row, headerByCode.C, 'Vorname', billing.firstName || '');
    setValue(row, headerByCode.C, 'Straße Nr.', billing.street || '');
    setValue(row, headerByCode.C, 'PLZ', billing.postalCode || '');
    setValue(row, headerByCode.C, 'Ort', billing.city || '');
    setValue(row, headerByCode.C, 'e-mail', customer.email || '');
    setValue(row, headerByCode.C, 'Telefon', customer.phone || '');
    setValue(row, headerByCode.C, 'Land', billing.country || customer.country || 'Deutschland');
    setValue(row, headerByCode.C, 'Bundesland', billing.federalState || customer.federalState || '');
    setValue(row, headerByCode.C, 'MWSt - VAT-No.', billing.vatNumber || '');
  }

  if (rowIndexByCode.D != null && headerByCode.D) {
    const row = lines[rowIndexByCode.D];
    ensureRowLength(row, headerByCode.D.length);
    setValue(row, headerByCode.D, 'Projekt AL', labMeta.projectId || '');
    setValue(row, headerByCode.D, 'A-Name', labMeta.projectName || `${customer.lastName || 'Order'}, ${customer.city || ''}`.trim());
    setValue(row, headerByCode.D, 'CAL/DL', labMeta.calDl ? 'x' : '');
    setValue(row, headerByCode.D, 'NICHT-Trocken', labMeta.notDry ? 'x' : '');
    setValue(row, headerByCode.D, 'schwer', labMeta.heavy ? 'x' : '');
    setValue(row, headerByCode.D, '1 Auftrag/Schlag', labMeta.oneOrderPerField ? 'x' : '');
    setValue(row, headerByCode.D, 'Postbefund', labMeta.postReport ? 'x' : '');
    setValue(row, headerByCode.D, 'Postrechnung', labMeta.postInvoice ? 'x' : '');
    if (profile.requiresNminType) {
      setValue(row, headerByCode.D, 'Nmin-Typ', pbsConfig.nminType || '');
    }
  }

  if (rowIndexByCode.E != null && headerByCode.E) {
    const row = lines[rowIndexByCode.E];
    const targetValue = profile.usesDistributor
      ? (pbsConfig.distributor || '')
      : (labMeta.contactEmails || '');
    if (row.length < 2) row.push('');
    row[1] = targetValue;
  }

  if (rowIndexByCode.F != null && headerByCode.F) {
    const row = lines[rowIndexByCode.F];
    ensureRowLength(row, headerByCode.F.length);
    setValue(row, headerByCode.F, 'ProbenehmerNo.', sampling.samplerNo || '');
    setValue(row, headerByCode.F, 'WerberNo', sampling.advertiserNo || '');
    setValue(row, headerByCode.F, 'PN-AuftragsNr', sampling.samplingOrderNo || '');
    setValue(row, headerByCode.F, 'Preisliste', sampling.priceList || '');
    setValue(row, headerByCode.F, 'Probenahmedatum', normalizeDateValue(sampling.samplingDate));
    setValue(row, headerByCode.F, 'PN-Preis/Probe', sampling.pricePerSample || '');
    setValue(row, headerByCode.F, 'PN-Preis/ha', sampling.pricePerHa || '');
    setValue(row, headerByCode.F, 'ha', sampling.totalAreaHa || '');
    setValue(row, headerByCode.F, 'Fahrtkosten', sampling.travelCost || '');
    setValue(row, headerByCode.F, 'Fahrtkosten/km', sampling.travelCostPerKm || '');
    setValue(row, headerByCode.F, 'km', sampling.km || '');
    setValue(row, headerByCode.F, 'AnzahlProben', sampling.sampleCount || '');
    if (profile.requiresNminType) {
      setValue(row, headerByCode.F, 'PN0-30', pbsConfig.pn030 || '');
      setValue(row, headerByCode.F, 'PN0-60', pbsConfig.pn060 || '');
      setValue(row, headerByCode.F, 'PN0-90', pbsConfig.pn090 || '');
      setValue(row, headerByCode.F, 'PN0-x', pbsConfig.pn0x || '');
      if (profile.includesAnzahlPnStellen) {
        setValue(row, headerByCode.F, 'AnzahlPN-Stellen', pbsConfig.anzahlPnStellen || '');
      }
    }
  }

  if (rowIndexByCode.G != null && headerByCode.G) {
    const row = lines[rowIndexByCode.G];
    ensureRowLength(row, headerByCode.G.length);
    const crops = draft.cropYield?.crops || [];
    crops.forEach((item, index) => {
      setValue(row, headerByCode.G, `Frucht${index + 1}`, item.crop || '');
      setValue(row, headerByCode.G, `Ertrag${index + 1}`, item.yield || '');
    });
  }

  const hHeader = headerByCode.H;
  const hRows = fields.map((field) => {
    const row = Array(hHeader.length).fill('');
    row[0] = 'H';
    const exportSampleKey = field.exportMapping?.sampleKey || field.fieldId;
    const exportSampleName = field.exportMapping?.sampleDisplayName || field.fieldName || field.fieldId;
    const exportSourceBaseId = field.exportMapping?.sourceBaseId
      || field.samplingCell?.parentBaseId
      || field.baseId
      || field.fieldId;
    const barcodes = getFieldBarcodeList(field);
    const suffix = field.samplingCell?.cellIndex
      ? String(field.samplingCell.cellIndex)
      : (exportSampleKey.split('.').pop() || '');

    setValue(row, hHeader, 'lfd.Nr. /GPS', exportSampleKey);
    if (profile.supportsMultipleBarcodes) {
      setValue(row, hHeader, 'Tütenbarcode 1', barcodes[0] || '');
      setValue(row, hHeader, 'Tütenbarcode 2', barcodes[1] || '');
      setValue(row, hHeader, 'Tütenbarcode 3', barcodes[2] || '');
    } else if (barcodes[0]) {
      setValue(row, hHeader, 'Tütenbarcode', barcodes[0]);
    }
    setValue(row, hHeader, 'Schlagnr.', exportSourceBaseId);
    setValue(row, hHeader, 'Teilschlagnr.', suffix);
    setValue(row, hHeader, 'Schlagname', exportSampleName);
    setValue(row, hHeader, 'Erweiterung Schlagname', suffix ? String(suffix) : '');
    setValue(row, hHeader, 'Schlag-größe [ha]', field.areaHa ? String(field.areaHa) : '');
    setValue(row, hHeader, 'Proben-Fläche [ha]', field.areaHa ? String(field.areaHa) : '');

    const params = (field.parameters || draft.parameters || { standardPackage: true }) as NonNullable<OrderDraft['parameters']>;
    if (params.landUseType) {
      setValue(row, hHeader, 'Nutzung [A/W/R/O/H/U]', String(params.landUseType));
    }
    if (params.cropResiduesRemoved != null) {
      setValue(row, hHeader, 'Ernte-reste abg. [j/n]', params.cropResiduesRemoved ? 'j' : 'n');
    }
    if (field.transportTracking) {
      setValue(row, hHeader, 'Transport-tracking-nr.', field.transportTracking);
    }
    if (field.soilType) {
      setValue(row, hHeader, 'Bodenart', field.soilType);
    }
    if (field.humusClass) {
      setValue(row, hHeader, 'Humusklasse', field.humusClass);
    }

    if (profile.profile === 'boden') {
      setValue(row, hHeader, 'Standard pH/P/K/Mg', 'x');
      if (params.traceElements) setValue(row, hHeader, 'Spuren CAT Na,Mn,Cu,B,Zn', 'x');
      if (params.organicMatter) setValue(row, hHeader, 'Humusgehalt', 'x');
      if (params.cnRatio) setValue(row, hHeader, 'C/N-Verhältnis', 'x');
      if (params.potassiumFixation) setValue(row, hHeader, 'Kali-Fixierung', 'x');
      if (params.calcium) setValue(row, hHeader, 'Calcium', 'x');
      if (params.cecEffective) setValue(row, hHeader, 'KAK eff', 'x');
      if (params.cecPotential) setValue(row, hHeader, 'KAK pot', 'x');
      if (params.particleSizeDistribution) setValue(row, hHeader, 'Korngrößen-verteilung', 'x');
      if (params.phosphorusReleaseRate) setValue(row, hHeader, 'P-Freisetzungs-rate', 'x');
    } else if (profile.profile === 'nmin') {
      if (pbsConfig.nminType === 'Tiefenprofil 1:1') {
        setValue(row, hHeader, 'Nmin TP 1:1 7940', 'x');
      } else if (pbsConfig.nminType === 'Tiefenprofil 1:4') {
        setValue(row, hHeader, 'Nmin TP 1:4 7920', 'x');
      } else {
        setValue(row, hHeader, 'Nmin 7900', 'x');
      }
    } else if (profile.profile === 'n306090') {
      setValue(row, hHeader, 'Nmin 7900', 'x');
    }

    return row;
  });

  const hHeaderIndex = lines.findIndex((row, index) => row[0] === 'Z' && lines[index + 1] && lines[index + 1][0] === 'H');
  if (hHeaderIndex >= 0) {
    lines.splice(hHeaderIndex + 1, lines.length - (hHeaderIndex + 1), ...hRows);
  }

  return lines.map((row) => row.join(';')).join('\n');
};