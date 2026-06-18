type BarcodeFieldLike = {
  barcode?: unknown;
  barcodes?: unknown;
};

const uniqueCodes = (codes: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];

  codes.forEach((code) => {
    const normalized = String(code || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(normalized);
  });

  return next;
};

export const normalizeBarcode = (value: unknown): string => String(value || '').trim();

export const normalizeBarcodeList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueCodes(value.flatMap((entry) => normalizeBarcodeList(entry)));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.includes(',') || trimmed.includes('\n') || trimmed.includes(';')) {
      return uniqueCodes(trimmed.split(/[\n,;]+/).map((entry) => entry.trim()));
    }

    return [trimmed];
  }

  const normalized = normalizeBarcode(value);
  return normalized ? [normalized] : [];
};

export const getFieldBarcodeList = (field?: BarcodeFieldLike | null): string[] => {
  if (!field) return [];

  const barcodes = normalizeBarcodeList(field.barcodes);
  const primaryBarcode = normalizeBarcode(field.barcode);

  if (primaryBarcode && !barcodes.includes(primaryBarcode)) {
    return [primaryBarcode, ...barcodes];
  }

  return barcodes;
};

export const getBoundaryBarcodeList = (properties?: Record<string, unknown> | null): string[] => {
  if (!properties) return [];

  const barcodeValues = normalizeBarcodeList(properties.barcode_values);
  const barcodeList = normalizeBarcodeList(properties.barcode_list);
  const primaryBarcode = normalizeBarcode(properties.barcode_primary);

  return uniqueCodes([
    ...(primaryBarcode ? [primaryBarcode] : []),
    ...barcodeValues,
    ...barcodeList,
  ]);
};

export const buildBarcodeFieldPatch = (codesInput: unknown): { barcode?: string; barcodes?: string[] } => {
  const barcodes = normalizeBarcodeList(codesInput);
  return {
    barcode: barcodes[0],
    barcodes,
  };
};

export const buildBoundaryBarcodeProperties = (
  properties: Record<string, unknown> | undefined,
  codesInput: unknown,
): Record<string, unknown> => {
  const barcodes = normalizeBarcodeList(codesInput);

  return {
    ...(properties || {}),
    barcode_primary: barcodes[0] || '',
    barcode_count: barcodes.length,
    barcode_list: barcodes.join(', '),
    barcode_values: barcodes,
  };
};

export const setPrimaryBarcodeValue = (codesInput: unknown, nextPrimaryValue: unknown): string[] => {
  const currentCodes = normalizeBarcodeList(codesInput);
  const nextPrimary = normalizeBarcode(nextPrimaryValue);

  if (!nextPrimary) {
    return currentCodes.slice(1);
  }

  return uniqueCodes([nextPrimary, ...currentCodes.slice(1)]);
};