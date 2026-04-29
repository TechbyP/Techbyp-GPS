import { useCallback, useEffect, useState } from 'react';
import { hybridDB } from '../services/hybridDatabase';
import type { GpsFieldBoundary, GpsProject } from '../types';
import { normalizeBoundaries } from '../utils/boundaries';

export function useBoundaries(selectedProject: GpsProject | null) {
  const [fieldBoundaries, setFieldBoundaries] = useState<GpsFieldBoundary[]>([]);

  const loadFieldBoundaries = useCallback(async () => {
    if (!selectedProject) {
      setFieldBoundaries([]);
      return [] as GpsFieldBoundary[];
    }

    const boundaries = await hybridDB.getFieldBoundaries(selectedProject.id);
    const normalized = normalizeBoundaries(boundaries);
    setFieldBoundaries(normalized);
    return normalized;
  }, [selectedProject]);

  useEffect(() => {
    void loadFieldBoundaries();
  }, [loadFieldBoundaries]);

  return { fieldBoundaries, setFieldBoundaries, loadFieldBoundaries } as const;
}
