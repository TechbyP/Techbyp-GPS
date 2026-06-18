import templateCsv from '../assets/templates/agrolab-template.csv?raw';
import { OrderDraft } from '../types';
import { getFieldBarcodeList } from '../utils/orderBarcodes';

const formatDate = (date: Date) => {
  return date.toLocaleDateString('de-DE');
};

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
  const idx = header.findIndex(col => col.trim() === columnName.trim());
  if (idx >= 0) {
    row[idx] = value;
  }
};

export const generateAgrolabCsv = (draft: OrderDraft) => {
  const lines = templateCsv.trimEnd().split(/\r?\n/).map(line => line.split(';'));
  const headerByCode: Record<string, string[]> = {};
  const rowIndexByCode: Record<string, number> = {};
  let hHeaderIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i][0] === 'Z' && lines[i + 1] && lines[i + 1][0] !== 'Z') {
      const nextCode = lines[i + 1][0];
      headerByCode[nextCode] = lines[i];
      rowIndexByCode[nextCode] = i + 1;
    }
    if (lines[i][0] === 'Z' && lines[i][1]?.startsWith('Proben und Untersuchung')) {
      headerByCode.H = lines[i];
      hHeaderIndex = i;
    }
    if (lines[i][0] === 'E' && !headerByCode.E) {
      headerByCode.E = lines[i];
      rowIndexByCode.E = i;
    }
  }

  const customer = draft.customerProfile || {};
  const billing = draft.billingRecipient || { isDifferent: false };
  const fields = draft.fields || [];
  const labMeta = draft.labMeta || {};
  const sampling = draft.samplingDetails || {};

  if (rowIndexByCode.A != null && headerByCode.A) {
    const row = lines[rowIndexByCode.A];
    setValue(row, headerByCode.A, 'Beauftragtes Labor', labMeta.assignedLab || '');
    setValue(row, headerByCode.A, 'Labor', labMeta.labName || '');
    setValue(row, headerByCode.A, 'Probenart,BNS', labMeta.sampleTypeBns || '');
    setValue(row, headerByCode.A, 'Version', normalizeDateValue(sampling.samplingDate || labMeta.version));
    setValue(row, headerByCode.A, 'Paketdienst-Tracking', labMeta.trackingNumber || '');
    setValue(row, headerByCode.A, 'Datum', normalizeDateValue(labMeta.orderDate));
    setValue(row, headerByCode.A, 'Speichername', labMeta.storageName || '');
  }

  if (rowIndexByCode.B != null && headerByCode.B) {
    const row = lines[rowIndexByCode.B];
    setValue(row, headerByCode.B, 'Kundennummer AL', customer.customerNumber || '');
    setValue(row, headerByCode.B, 'Name', customer.lastName || '');
    setValue(row, headerByCode.B, 'Vorname', customer.firstName || '');
    setValue(row, headerByCode.B, 'Straße Nr.', customer.street || '');
    setValue(row, headerByCode.B, 'PLZ', customer.postalCode || '');
    setValue(row, headerByCode.B, 'Ort', customer.city || '');
    setValue(row, headerByCode.B, 'e-mail', customer.email || '');
    setValue(row, headerByCode.B, 'Telefon', customer.phone || '');
    setValue(row, headerByCode.B, 'Land', customer.country || 'Deutschland');
    setValue(row, headerByCode.B, 'Bundesland', customer.federalState || '');
  }

  if (rowIndexByCode.C != null && headerByCode.C) {
    const row = lines[rowIndexByCode.C];
    if (billing.isDifferent) {
      setValue(row, headerByCode.C, 'Name', billing.name || '');
      setValue(row, headerByCode.C, 'Vorname', billing.firstName || '');
      setValue(row, headerByCode.C, 'Straße Nr.', billing.street || '');
      setValue(row, headerByCode.C, 'PLZ', billing.postalCode || '');
      setValue(row, headerByCode.C, 'Ort', billing.city || '');
      setValue(row, headerByCode.C, 'MWSt - VAT-No.', billing.vatNumber || '');
    }
  }

  if (rowIndexByCode.D != null && headerByCode.D) {
    const row = lines[rowIndexByCode.D];
    setValue(row, headerByCode.D, 'Projekt AL', labMeta.projectId || '');
    setValue(row, headerByCode.D, 'A-Name', labMeta.projectName || `${customer.lastName || 'Order'}, ${customer.city || ''}`.trim());
    setValue(row, headerByCode.D, 'CAL/DL', labMeta.calDl ? 'x' : '');
    setValue(row, headerByCode.D, 'NICHT-Trocken', labMeta.notDry ? 'x' : '');
    setValue(row, headerByCode.D, 'schwer', labMeta.heavy ? 'x' : '');
    setValue(row, headerByCode.D, '1 Auftrag/Schlag', labMeta.oneOrderPerField ? 'x' : '');
    setValue(row, headerByCode.D, 'Postbefund', labMeta.postReport ? 'x' : '');
    setValue(row, headerByCode.D, 'Postrechnung', labMeta.postInvoice ? 'x' : '');
  }

  if (rowIndexByCode.E != null && headerByCode.E) {
    const row = lines[rowIndexByCode.E];
    setValue(row, headerByCode.E, 'e-mail(s) (,-getrennt)', labMeta.contactEmails || '');
  }

  if (rowIndexByCode.F != null && headerByCode.F) {
    const row = lines[rowIndexByCode.F];
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
  }

  if (rowIndexByCode.G != null && headerByCode.G) {
    const row = lines[rowIndexByCode.G];
    const crops = draft.cropYield?.crops || [];
    crops.forEach((item, index) => {
      setValue(row, headerByCode.G, `Frucht${index + 1}`, item.crop || '');
      setValue(row, headerByCode.G, `Ertrag${index + 1}`, item.yield || '');
    });
  }

  if (hHeaderIndex >= 0 && headerByCode.H) {
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
      const primaryBarcode = getFieldBarcodeList(field)[0];
      const suffix = field.samplingCell?.cellIndex
        ? String(field.samplingCell.cellIndex)
        : (exportSampleKey.split('.').pop() || '');

      setValue(row, hHeader, 'lfd.Nr. /GPS', exportSampleKey);
      if (primaryBarcode) {
        setValue(row, hHeader, 'Tütenbarcode', primaryBarcode);
        setValue(row, hHeader, 'LOT. BARCODE', primaryBarcode);
      }
      setValue(row, hHeader, 'Schlagnr.', exportSourceBaseId);
      setValue(row, hHeader, 'Teilschlagnr.', suffix);
      setValue(row, hHeader, 'Schlagname', exportSampleName);
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

      return row;
    });

    lines.splice(hHeaderIndex + 1, lines.length - (hHeaderIndex + 1), ...hRows);
  }

  return lines.map(row => row.join(';')).join('\n');
};
