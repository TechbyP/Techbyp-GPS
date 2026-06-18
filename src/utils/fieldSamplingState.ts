import type {
  GpsFieldBoundary,
  GpsFieldBoundaryProperties,
  GpsFieldSamplingStatus,
} from '../types';

export type BoundarySamplingState = {
  status: GpsFieldSamplingStatus;
  locked: boolean;
  completedAt?: string;
  completedBy?: string;
};

const defaultBoundarySamplingState: BoundarySamplingState = {
  status: 'pending',
  locked: false,
};

export const getBoundarySamplingState = (
  boundary?: Pick<GpsFieldBoundary, 'properties'> | null,
): BoundarySamplingState => {
  const properties = boundary?.properties;
  if (!properties || typeof properties !== 'object') {
    return defaultBoundarySamplingState;
  }

  const rawStatus = properties.sampling_status;
  const status: GpsFieldSamplingStatus = rawStatus === 'completed' || rawStatus === 'in_progress'
    ? rawStatus
    : 'pending';
  const locked = Boolean(properties.sampling_locked || status === 'completed');

  return {
    status,
    locked,
    completedAt: properties.sampling_completed_at,
    completedBy: properties.sampling_completed_by,
  };
};

export const deriveBoundarySamplingStatus = (
  sampleCount: number,
  boundary?: Pick<GpsFieldBoundary, 'properties'> | null,
): GpsFieldSamplingStatus => {
  const state = getBoundarySamplingState(boundary);
  if (state.status === 'completed') {
    return 'completed';
  }

  return sampleCount > 0 ? 'in_progress' : 'pending';
};

export const isBoundarySamplingLocked = (
  boundary?: Pick<GpsFieldBoundary, 'properties'> | null,
): boolean => getBoundarySamplingState(boundary).locked;

export const buildBoundarySamplingProperties = (
  existingProperties: GpsFieldBoundaryProperties | undefined,
  nextState: BoundarySamplingState,
): GpsFieldBoundaryProperties => {
  const nextProperties: GpsFieldBoundaryProperties = {
    ...(existingProperties || {}),
    sampling_status: nextState.status,
    sampling_locked: nextState.locked,
  };

  if (nextState.completedAt) {
    nextProperties.sampling_completed_at = nextState.completedAt;
  } else {
    delete nextProperties.sampling_completed_at;
  }

  if (nextState.completedBy) {
    nextProperties.sampling_completed_by = nextState.completedBy;
  } else {
    delete nextProperties.sampling_completed_by;
  }

  return nextProperties;
};