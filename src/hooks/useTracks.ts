import { useCallback, useState } from 'react';
import { hybridDB } from '../services/hybridDatabase';
import type { GpsTrack, GpsTrackDetail } from '../types';

export function useTracks() {
  const [tracks, setTracks] = useState<GpsTrackDetail[]>([]);
  const [currentTrack, setCurrentTrack] = useState<GpsTrack | null>(null);
  const [sampleCount, setSampleCount] = useState(0);

  const loadTracks = useCallback(async (projectId?: string | number | null) => {
    if (!projectId) {
      setTracks([]);
      setCurrentTrack(null);
      setSampleCount(0);
      return [] as GpsTrackDetail[];
    }

    const list = await hybridDB.getTracks(projectId.toString());
    const tracksList = Array.isArray(list) ? list : [];

    const alreadyDetailed = tracksList.every((track: any) => (
      Array.isArray(track?.gps_points) && Array.isArray(track?.samples)
    ));

    let valid: GpsTrackDetail[];
    if (alreadyDetailed) {
      valid = tracksList.filter(Boolean) as GpsTrackDetail[];
    } else {
      const details: Array<GpsTrackDetail | null> = [];
      const batchSize = 6;

      for (let index = 0; index < tracksList.length; index += batchSize) {
        const batch = tracksList.slice(index, index + batchSize);
        const batchDetails = await Promise.all(
          batch.map(async (track: any) => {
            try {
              return await hybridDB.getTrack(track.id);
            } catch {
              return null;
            }
          })
        );
        details.push(...(batchDetails as Array<GpsTrackDetail | null>));
      }

      valid = details.filter(Boolean) as GpsTrackDetail[];
    }
    
    setTracks(valid);

    const active = (valid.find(t => (t as any)?.is_active) || valid[0]) as GpsTrack | undefined;
    setCurrentTrack(active || null);
    const activeSampleCount = active && (active as any).samples ? (active as any).samples.length : 0;
    setSampleCount(activeSampleCount);
    return valid;
  }, []);

  const refreshTrack = useCallback(async (trackId: string | number) => {
    try {
      const detail = await hybridDB.getTrack(trackId as string);
      if (detail) {
        setTracks(prev => prev.map(t => (t && t.id === trackId ? detail : t)).filter(Boolean) as GpsTrackDetail[]);
        // Also update currentTrack if it's the same track to show samples on map
        setCurrentTrack(prev => (prev && prev.id === trackId ? detail : prev));
        // Update sample count for sidebar
        if (detail.id === trackId) {
          setSampleCount(detail.samples?.length ?? 0);
        }
      }
      return detail as GpsTrackDetail | null;
    } catch (error) {
      console.error('[useTracks] Error refreshing track:', error);
      return null;
    }
  }, []);

  return {
    tracks,
    setTracks,
    currentTrack,
    setCurrentTrack,
    sampleCount,
    setSampleCount,
    loadTracks,
    refreshTrack,
  } as const;
}
