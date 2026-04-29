import { useCallback, useState } from 'react';
import { hybridDB } from '../services/hybridDatabase';
import type { GpsFieldSample } from '../types';

export function useFieldSamples() {
  const [fieldSamples, setFieldSamples] = useState<GpsFieldSample[]>([]);

  const loadFieldSamples = useCallback(async (projectId?: string | number | null) => {
    if (!projectId) {
      setFieldSamples([]);
      return [] as GpsFieldSample[];
    }

    const list = await hybridDB.getFieldSamples(projectId.toString());
    const normalized = Array.isArray(list) ? (list.filter(Boolean) as GpsFieldSample[]) : [];
    setFieldSamples(normalized);
    return normalized;
  }, []);

  return {
    fieldSamples,
    setFieldSamples,
    loadFieldSamples,
  } as const;
}
