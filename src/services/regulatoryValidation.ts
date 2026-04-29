/**
 * Regulatory Validation Service
 * Validates soil sample data according to German federal and state regulations
 * Supports configurable validation rules based on Bundesland and laboratory requirements
 */

import type { GpsSample, Bundesland } from '../types';

export interface ValidationRule {
  field: keyof GpsSample;
  required: boolean;
  bundesland?: Bundesland[];
  laboratory?: string[];
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Base validation rules required by all German laboratories
 */
const BASE_GERMAN_RULES: ValidationRule[] = [
  {
    field: 'latitude',
    required: true,
    message: 'GPS latitude coordinate is required'
  },
  {
    field: 'longitude',
    required: true,
    message: 'GPS longitude coordinate is required'
  },
  {
    field: 'cadastral_district',
    required: true,
    message: 'Cadastral district (Gemarkung) is legally required in Germany'
  },
  {
    field: 'land_use',
    required: true,
    message: 'Land use type (Nutzung) is required'
  },
  {
    field: 'depth_from_cm',
    required: true,
    message: 'Sampling depth range (from) is required'
  },
  {
    field: 'depth_to_cm',
    required: true,
    message: 'Sampling depth range (to) is required'
  },
  {
    field: 'sampling_date',
    required: true,
    message: 'Sampling date is required for regulatory compliance'
  },
  {
    field: 'operator',
    required: true,
    message: 'Operator/sampler name is required'
  }
];

/**
 * State-specific validation rules
 */
const BUNDESLAND_RULES: Record<Bundesland, ValidationRule[]> = {
  'Niedersachsen': [
    {
      field: 'soil_type',
      required: true,
      bundesland: ['Niedersachsen'],
      message: 'Soil type (Bodenart) is required in Niedersachsen'
    },
    {
      field: 'field_name',
      required: true,
      bundesland: ['Niedersachsen'],
      message: 'Field name (Schlagname) is required in Niedersachsen'
    }
  ],
  'Bayern': [
    {
      field: 'parcel_id',
      required: true,
      bundesland: ['Bayern'],
      message: 'Parcel ID (Flurstück) is mandatory in Bavaria'
    }
  ],
  'Baden-Württemberg': [],
  'Berlin': [],
  'Brandenburg': [],
  'Bremen': [],
  'Hamburg': [],
  'Hessen': [],
  'Mecklenburg-Vorpommern': [],
  'Nordrhein-Westfalen': [],
  'Rheinland-Pfalz': [],
  'Saarland': [],
  'Sachsen': [],
  'Sachsen-Anhalt': [],
  'Schleswig-Holstein': [],
  'Thüringen': []
};

/**
 * Laboratory-specific validation rules
 */
const LABORATORY_RULES: Record<string, ValidationRule[]> = {
  'LUFA': [
    {
      field: 'field_name',
      required: true,
      laboratory: ['LUFA'],
      message: 'Field name is required by LUFA'
    },
    {
      field: 'current_crop',
      required: true,
      laboratory: ['LUFA'],
      message: 'Current crop information is required by LUFA'
    },
    {
      field: 'horizon',
      required: true,
      laboratory: ['LUFA'],
      message: 'Soil horizon designation is required by LUFA'
    }
  ],
  'Agrolab': [
    {
      field: 'container_id',
      required: true,
      laboratory: ['Agrolab'],
      message: 'Container barcode is required by Agrolab'
    },
    {
      field: 'analysis_package',
      required: true,
      laboratory: ['Agrolab'],
      message: 'Analysis package selection is required by Agrolab'
    }
  ],
  'SGS': [
    {
      field: 'laboratory_customer_id',
      required: true,
      laboratory: ['SGS'],
      message: 'Customer ID is required by SGS'
    },
    {
      field: 'analysis_parameters',
      required: true,
      laboratory: ['SGS'],
      message: 'Analysis parameters must be specified for SGS'
    }
  ]
};

/**
 * Validate a single sample against all applicable rules
 */
export function validateSample(
  sample: GpsSample,
  bundesland?: Bundesland,
  laboratory?: string
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Apply base German rules
  for (const rule of BASE_GERMAN_RULES) {
    if (rule.required) {
      const value = sample[rule.field];
      if (value === undefined || value === null || value === '') {
        errors.push({
          field: rule.field,
          message: rule.message,
          severity: 'error'
        });
      }
    }
  }

  // Apply Bundesland-specific rules
  if (bundesland && BUNDESLAND_RULES[bundesland]) {
    for (const rule of BUNDESLAND_RULES[bundesland]) {
      if (rule.required) {
        const value = sample[rule.field];
        if (value === undefined || value === null || value === '') {
          errors.push({
            field: rule.field,
            message: rule.message,
            severity: 'error'
          });
        }
      }
    }
  }

  // Apply laboratory-specific rules
  if (laboratory && LABORATORY_RULES[laboratory]) {
    for (const rule of LABORATORY_RULES[laboratory]) {
      if (rule.required) {
        const value = sample[rule.field];
        if (value === undefined || value === null || value === '') {
          errors.push({
            field: rule.field,
            message: rule.message,
            severity: 'error'
          });
        }
      }
    }
  }

  // Additional logical validations
  if (sample.depth_from_cm && sample.depth_to_cm) {
    if (sample.depth_from_cm >= sample.depth_to_cm) {
      errors.push({
        field: 'depth_to_cm',
        message: 'Depth "to" must be greater than depth "from"',
        severity: 'error'
      });
    }
  }

  if (sample.device_accuracy_m && sample.device_accuracy_m > 10) {
    warnings.push({
      field: 'device_accuracy_m',
      message: 'GPS accuracy is > 10m - sample location may be imprecise'
    });
  }

  if (!sample.analysis_parameters || sample.analysis_parameters.length === 0) {
    warnings.push({
      field: 'analysis_parameters',
      message: 'No analysis parameters specified - laboratory may reject sample'
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate multiple samples at once
 */
export function validateSampleBatch(
  samples: GpsSample[],
  bundesland?: Bundesland,
  laboratory?: string
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  for (const sample of samples) {
    const sampleId = sample.id.toString();
    results[sampleId] = validateSample(sample, bundesland, laboratory);
  }

  return results;
}

/**
 * Get mandatory fields for a given configuration
 */
export function getMandatoryFields(
  bundesland?: Bundesland,
  laboratory?: string
): string[] {
  const mandatory = new Set<string>();

  // Add base required fields
  BASE_GERMAN_RULES.forEach(rule => {
    if (rule.required) {
      mandatory.add(rule.field);
    }
  });

  // Add Bundesland-specific required fields
  if (bundesland && BUNDESLAND_RULES[bundesland]) {
    BUNDESLAND_RULES[bundesland].forEach(rule => {
      if (rule.required) {
        mandatory.add(rule.field);
      }
    });
  }

  // Add laboratory-specific required fields
  if (laboratory && LABORATORY_RULES[laboratory]) {
    LABORATORY_RULES[laboratory].forEach(rule => {
      if (rule.required) {
        mandatory.add(rule.field);
      }
    });
  }

  return Array.from(mandatory);
}

/**
 * Check if sample is complete for export
 */
export function isSampleExportReady(
  sample: GpsSample,
  bundesland?: Bundesland,
  laboratory?: string
): boolean {
  const result = validateSample(sample, bundesland, laboratory);
  return result.valid;
}

/**
 * Get validation summary for a batch of samples
 */
export function getValidationSummary(
  samples: GpsSample[],
  bundesland?: Bundesland,
  laboratory?: string
): {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
} {
  let valid = 0;
  let invalid = 0;
  let warningsCount = 0;

  for (const sample of samples) {
    const result = validateSample(sample, bundesland, laboratory);
    if (result.valid) {
      valid++;
    } else {
      invalid++;
    }
    warningsCount += result.warnings.length;
  }

  return {
    total: samples.length,
    valid,
    invalid,
    warnings: warningsCount
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return 'Sample data is complete and valid';
  }

  const errorMessages = result.errors.map(err => `• ${err.message}`);
  const warningMessages = result.warnings.map(warn => `⚠ ${warn.message}`);

  return [...errorMessages, ...warningMessages].join('\n');
}
