import type { PbsConfig, PbsProfile } from '../types';

export type PbsProfileDefinition = {
  profile: PbsProfile;
  label: string;
  profileCode: string;
  version: string;
  usesDistributor: boolean;
  requiresNminType: boolean;
  supportsMultipleBarcodes: boolean;
  includesAnzahlPnStellen: boolean;
};

const PBS_PROFILE_DEFINITIONS: Record<PbsProfile, PbsProfileDefinition> = {
  boden: {
    profile: 'boden',
    label: 'PBS Boden',
    profileCode: '',
    version: '1.05',
    usesDistributor: false,
    requiresNminType: false,
    supportsMultipleBarcodes: false,
    includesAnzahlPnStellen: false,
  },
  nmin: {
    profile: 'nmin',
    label: 'PBS Nmin',
    profileCode: 'N',
    version: '1.04',
    usesDistributor: true,
    requiresNminType: true,
    supportsMultipleBarcodes: false,
    includesAnzahlPnStellen: false,
  },
  n306090: {
    profile: 'n306090',
    label: 'PBS N306090',
    profileCode: 'N306090',
    version: '1.04',
    usesDistributor: true,
    requiresNminType: true,
    supportsMultipleBarcodes: true,
    includesAnzahlPnStellen: true,
  },
};

export const PBS_NMIN_TYPE_OPTIONS = [
  'Nmin Standard',
  'Tiefenprofil 1:1',
  'Tiefenprofil 1:4',
] as const;

export const getPbsProfileDefinition = (profile?: PbsProfile | null): PbsProfileDefinition => (
  PBS_PROFILE_DEFINITIONS[profile || 'boden'] || PBS_PROFILE_DEFINITIONS.boden
);

export const createDefaultPbsConfig = (profile: PbsProfile = 'boden'): PbsConfig => ({
  profile,
  customerNumberAgrolab: '',
  billingCustomerNumber: '',
  distributor: '',
  nminType: getPbsProfileDefinition(profile).requiresNminType ? PBS_NMIN_TYPE_OPTIONS[0] : '',
  pn030: '',
  pn060: '',
  pn090: '',
  pn0x: '',
  anzahlPnStellen: '',
});

export const normalizePbsConfig = (value?: Partial<PbsConfig> | null): PbsConfig => {
  const profile = value?.profile || 'boden';
  return {
    ...createDefaultPbsConfig(profile),
    ...(value || {}),
    profile,
  };
};