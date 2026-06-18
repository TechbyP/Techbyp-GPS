/**
 * Laboratory Export Service
 * Exports soil sample data in formats required by German laboratories
 * Supports: LUFA, SGS Agrolab, and generic CSV formats
 */

import type { GpsSample } from '../types';
import * as XLSX from 'xlsx';

export interface LaboratoryExportOptions {
  laboratory: 'LUFA' | 'SGS' | 'Agrolab' | 'Generic';
  format: 'CSV' | 'XLSX' | 'XML';
  includeMetadata?: boolean;
  customerNumber?: string;
  samplerNumber?: string;
  bundesland?: string;
}

export interface ExportResult {
  success: boolean;
  filename: string;
  data?: Blob;
  error?: string;
  validationErrors?: string[];
}

/**
 * Validate sample data for laboratory export
 */
export function validateSampleForExport(sample: GpsSample, laboratory: string): string[] {
  const errors: string[] = [];

  // Common required fields
  if (!sample.latitude || !sample.longitude) {
    errors.push(`Sample ${sample.name || sample.id}: Missing GPS coordinates`);
  }

  if (!sample.cadastral_district) {
    errors.push(`Sample ${sample.name || sample.id}: Missing cadastral district (Gemarkung) - legally required`);
  }

  if (!sample.land_use) {
    errors.push(`Sample ${sample.name || sample.id}: Missing land use type`);
  }

  if (!sample.depth_from_cm || !sample.depth_to_cm) {
    errors.push(`Sample ${sample.name || sample.id}: Missing depth range (from/to)`);
  }

  // Laboratory-specific validation
  switch (laboratory) {
    case 'LUFA':
      if (!sample.field_name) {
        errors.push(`Sample ${sample.name || sample.id}: Missing field name (required by LUFA)`);
      }
      if (!sample.current_crop) {
        errors.push(`Sample ${sample.name || sample.id}: Missing current crop information`);
      }
      break;

    case 'Agrolab':
      if (!sample.container_id) {
        errors.push(`Sample ${sample.name || sample.id}: Missing container barcode (required by Agrolab)`);
      }
      if (!sample.analysis_package) {
        errors.push(`Sample ${sample.name || sample.id}: Missing analysis package selection`);
      }
      break;

    case 'SGS':
      if (!sample.laboratory_customer_id) {
        errors.push(`Sample ${sample.name || sample.id}: Missing customer ID (required by SGS)`);
      }
      break;
  }

  return errors;
}

/**
 * Generate Agrolab CSV format
 * Based on the CSV template in mattze/Muster csv. für Laborauftrag.csv
 */
function generateAgrolabCSV(samples: GpsSample[], options: LaboratoryExportOptions): string {
  const lines: string[] = [];

  // Header section (Z lines)
  lines.push('Z;Beauftragtes Labor;Labor;Probenart,BNS;Version;Paketdienst-Tracking;;Datum;Speichername;lab-interne Info');
  lines.push(`A;;Agrolab;B;01. ${new Date().toLocaleDateString('de-DE')};;;${new Date().toISOString().split('T')[0]};Export-${Date.now()};`);

  // Customer information (B line)
  lines.push('Z;ldw. Betrieb;Kundennummer AL;Kundennummer Kd;Name;Vorname;Straße Nr.;PLZ;Ort;e-mail;Telefon;Land;Bundesland;MWSt - VAT-No.;Rechnungsnehmer;Ortsteil');
  lines.push(`B;;;;${options.customerNumber || ''};;;;;;;;Deutschland;${options.bundesland || 'Niedersachsen'};;;`);

  // Sample header (H line structure)
  lines.push('Z;Proben und Untersuchung;lfd.Nr. /GPS;Tütenbarcode;Schlagnr.;Teilschlagnr.;Schlagname;Erweiterung Schlagname;Schlaggröße [ha];Proben-Fläche [ha];Nutzung [A/W/R/O/H/U];Erntereste abg. [j/n];Transport-tracking-nr.;Bodenart;Humusklasse;Standard pH/P/K/Mg');

  // Sample data (H lines)
  samples.forEach((sample, index) => {
    const parts = [
      'H',
      '',
      (index + 1).toString(), // lfd.Nr
      sample.container_id || '',
      sample.field_id || '',
      sample.parcel_id || '',
      sample.field_name || '',
      '',
      '', // field size
      '', // sample area
      mapLandUseToCode(sample.land_use),
      '', // crop residues
      '',
      sample.soil_type || '',
      '',
      'x' // Standard analysis checkbox
    ];
    lines.push(parts.join(';'));
  });

  return lines.join('\n');
}

/**
 * Generate LUFA CSV format
 */
function generateLUFACSV(samples: GpsSample[], _options: LaboratoryExportOptions): string {
  const headers = [
    'Probennummer',
    'Schlagname',
    'Gemarkung',
    'Flurstück',
    'Nutzung',
    'Bodenart',
    'Tiefe_von_cm',
    'Tiefe_bis_cm',
    'GPS_Breite',
    'GPS_Länge',
    'Kultur_aktuell',
    'Kultur_vorjahr',
    'Probenahme_Datum',
    'Probenehmer',
    'Analyseparameter',
    'Bemerkungen'
  ];

  const rows = samples.map(sample => [
    sample.name || sample.id,
    sample.field_name || '',
    sample.cadastral_district || '',
    sample.parcel_id || '',
    sample.land_use || '',
    sample.soil_type || '',
    sample.depth_from_cm || '',
    sample.depth_to_cm || '',
    sample.latitude.toFixed(6),
    sample.longitude.toFixed(6),
    sample.current_crop || '',
    sample.previous_crop || '',
    sample.sampling_date || sample.created_at.split('T')[0],
    sample.operator || '',
    sample.analysis_parameters?.join(';') || '',
    sample.notes || ''
  ]);

  return [headers, ...rows].map(row => row.join(';')).join('\n');
}

/**
 * Generate generic CSV format for any laboratory
 */
function generateGenericCSV(samples: GpsSample[]): string {
  const headers = [
    'Sample_ID',
    'Sample_Number',
    'Field_Name',
    'Cadastral_District',
    'Parcel_ID',
    'Land_Use',
    'Soil_Type',
    'Horizon',
    'Depth_From_cm',
    'Depth_To_cm',
    'Latitude',
    'Longitude',
    'Accuracy_m',
    'Current_Crop',
    'Previous_Crop',
    'Sampling_Date',
    'Operator',
    'Container_ID',
    'Laboratory',
    'Analysis_Package',
    'Analysis_Parameters',
    'Notes'
  ];

  const rows = samples.map(sample => [
    sample.id,
    sample.sample_number,
    sample.field_name || '',
    sample.cadastral_district || '',
    sample.parcel_id || '',
    sample.land_use || '',
    sample.soil_type || '',
    sample.horizon || '',
    sample.depth_from_cm || '',
    sample.depth_to_cm || '',
    sample.latitude.toFixed(6),
    sample.longitude.toFixed(6),
    sample.device_accuracy_m || '',
    sample.current_crop || '',
    sample.previous_crop || '',
    sample.sampling_date || sample.created_at.split('T')[0],
    sample.operator || '',
    sample.container_id || '',
    sample.laboratory_name || '',
    sample.analysis_package || '',
    sample.analysis_parameters?.join(';') || '',
    sample.notes || ''
  ]);

  return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
}

/**
 * Generate XLSX format
 */
function generateXLSX(samples: GpsSample[], options: LaboratoryExportOptions): ArrayBuffer {
  let csvData: string;
  
  switch (options.laboratory) {
    case 'Agrolab':
      csvData = generateAgrolabCSV(samples, options);
      break;
    case 'LUFA':
      csvData = generateLUFACSV(samples, options);
      break;
    default:
      csvData = generateGenericCSV(samples);
  }

  // Convert CSV to XLSX using xlsx library
  const ws = XLSX.utils.aoa_to_sheet(
    csvData.split('\n').map(line => line.split(/[,;]/))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Samples');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

/**
 * Map land use type to laboratory code
 */
function mapLandUseToCode(landUse?: string): string {
  const mapping: Record<string, string> = {
    'Acker': 'A',
    'Grünland': 'W',
    'Obstbau': 'O',
    'Spargel': 'S',
    'Rasen': 'R',
    'Gehölze': 'F',
    'Untergrund': 'U',
    'Sonstiges': 'X'
  };
  return mapping[landUse || ''] || '';
}

/**
 * Main export function
 */
export async function exportSamplesToLaboratory(
  samples: GpsSample[],
  options: LaboratoryExportOptions
): Promise<ExportResult> {
  try {
    // Validate all samples
    const validationErrors: string[] = [];
    samples.forEach(sample => {
      const errors = validateSampleForExport(sample, options.laboratory);
      validationErrors.push(...errors);
    });

    if (validationErrors.length > 0) {
      return {
        success: false,
        filename: '',
        validationErrors
      };
    }

    // Generate export data
    let data: Blob;
    let filename: string;

    const timestamp = new Date().toISOString().split('T')[0];
    const labPrefix = options.laboratory.toLowerCase();

    if (options.format === 'XLSX') {
      const buffer = generateXLSX(samples, options);
      data = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      filename = `${labPrefix}_export_${timestamp}.xlsx`;
    } else if (options.format === 'CSV') {
      let csvContent: string;
      switch (options.laboratory) {
        case 'Agrolab':
          csvContent = generateAgrolabCSV(samples, options);
          break;
        case 'LUFA':
          csvContent = generateLUFACSV(samples, options);
          break;
        default:
          csvContent = generateGenericCSV(samples);
      }
      data = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      filename = `${labPrefix}_export_${timestamp}.csv`;
    } else {
      return {
        success: false,
        filename: '',
        error: 'XML format not yet implemented'
      };
    }

    return {
      success: true,
      filename,
      data
    };

  } catch (error: any) {
    return {
      success: false,
      filename: '',
      error: error.message || 'Export failed'
    };
  }
}

/**
 * Download export file
 */
export function downloadExport(result: ExportResult) {
  if (!result.success || !result.data) {
    throw new Error(result.error || 'No data to download');
  }

  const url = URL.createObjectURL(result.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Log export activity for compliance tracking
 */
export async function logExportActivity(
  exportResult: ExportResult,
  samples: GpsSample[],
  options: LaboratoryExportOptions,
  userId: string
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    user_id: userId,
    laboratory: options.laboratory,
    format: options.format,
    sample_count: samples.length,
    success: exportResult.success,
    filename: exportResult.filename,
    validation_errors: exportResult.validationErrors,
    error: exportResult.error
  };

  // Store in local storage for now
  // TODO: Implement proper export log service with Firebase/database storage
  const logs = JSON.parse(localStorage.getItem('laboratory_export_logs') || '[]');
  logs.push(logEntry);
  localStorage.setItem('laboratory_export_logs', JSON.stringify(logs.slice(-100))); // Keep last 100

  return logEntry;
}
