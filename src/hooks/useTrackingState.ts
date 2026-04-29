import { useState, useCallback, useRef } from 'react';
import { GpsTrack, GpsPosition } from '../types';
import { hybridDB } from '../services/hybridDatabase';
import { useTracks } from './useTracks';

interface TrackingStateOptions {
  onTrackingStarted?: (track: GpsTrack) => void;
  onTrackingStopped?: () => void;
  onSampleAdded?: (sampleNumber: number) => void;
  onError?: (error: string) => void;
}

export function useTrackingState(options: TrackingStateOptions = {}) {
  const [isStartingTracking, setIsStartingTracking] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<GpsTrack | null>(null);
  const lastSavedPosition = useRef<GpsPosition | null>(null);
  
  const { tracks, setTracks, loadTracks } = useTracks();

  // Helper to calculate distance between two points (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }, []);

  const saveGpsPoint = useCallback(async (position: GpsPosition) => {
    if (!position || !currentTrack) {
      return;
    }

    // Throttling: Check if moved at least 2 meters or if it's the first point
    if (lastSavedPosition.current) {
      const dist = calculateDistance(
        lastSavedPosition.current.latitude,
        lastSavedPosition.current.longitude,
        position.latitude,
        position.longitude
      );
      if (dist < 2) {
        return;
      }
    }
    
    try {
      await hybridDB.addGpsPoint(
        currentTrack.id.toString(),
        position.latitude,
        position.longitude,
        position.altitude,
        position.accuracy
      );

      lastSavedPosition.current = position;
      
      // Update tracks state directly without database refresh
      const newPoint = {
        id: Date.now(),
        track_id: currentTrack.id,
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        accuracy: position.accuracy,
        timestamp: new Date().toISOString()
      };
      
      setTracks(prev => prev.map(t => 
        t.id === currentTrack.id 
          ? { ...t, gps_points: [...(t.gps_points || []), newPoint] }
          : t
      ));
    } catch (error) {
      console.error('Error saving GPS point:', error);
      options.onError?.('Failed to save GPS point');
    }
  }, [currentTrack, calculateDistance, setTracks, options.onError]);

  const startTracking = useCallback(async (
    projectId: string | number,
    trackName?: string,
    fieldBoundaryId?: number
  ) => {
    setIsStartingTracking(true);
    
    try {
      // Use sequential number instead of timestamp for default name
      const name = trackName || `Track ${tracks.length + 1}`;
      const newTrack = await hybridDB.createTrack(
        projectId.toString(), 
        name, 
        fieldBoundaryId?.toString()
      );
      
      setCurrentTrack(newTrack);
      setSampleCount(0);
      lastSavedPosition.current = null;
      
      // Add the new track to the tracks list with empty points
      const trackDetail = { ...newTrack, gps_points: [], samples: [] };
      setTracks(prev => [...prev, trackDetail]);
      
      options.onTrackingStarted?.(newTrack);
      return newTrack;
    } catch (error) {
      console.error('Error starting track:', error);
      options.onError?.('Failed to start tracking');
      throw error;
    } finally {
      setIsStartingTracking(false);
    }
  }, [setTracks, options.onTrackingStarted, options.onError]);

  const stopTracking = useCallback(async (projectId?: string | number) => {
    if (!currentTrack) return;

    try {
      setCurrentTrack(null);
      lastSavedPosition.current = null;
      setSampleCount(0);
      
      if (projectId) {
        await loadTracks(projectId.toString());
      }
      
      options.onTrackingStopped?.();
    } catch (error) {
      console.error('Error stopping track:', error);
      options.onError?.('Failed to stop tracking');
    }
  }, [currentTrack, loadTracks, options.onTrackingStopped, options.onError]);

  const addSample = useCallback(async (position: GpsPosition, sampleName?: string) => {
    if (!currentTrack || !position) return;

    const newSampleNumber = sampleCount + 1;
    setIsAddingSample(true);
    
    try {
      const name = sampleName || `Sample #${newSampleNumber}`;
      
      await hybridDB.addSample(
        currentTrack.id.toString(),
        position.latitude,
        position.longitude,
        name
      );
      
      setSampleCount(newSampleNumber);
      
      // Update tracks state directly
      const newSample = {
        id: Date.now(),
        track_id: currentTrack.id.toString(),
        latitude: position.latitude,
        longitude: position.longitude,
        name,
        sample_number: newSampleNumber,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
      
      setTracks(prev => prev.map(t => 
        t.id === currentTrack.id 
          ? { ...t, samples: [...(t.samples || []), newSample] }
          : t
      ));
      
      options.onSampleAdded?.(newSampleNumber);
      return newSample;
    } catch (error) {
      console.error('Error adding sample:', error);
      options.onError?.('Failed to add sample');
      throw error;
    } finally {
      setIsAddingSample(false);
    }
  }, [currentTrack, sampleCount, setTracks, options.onSampleAdded, options.onError]);

  const deleteTrack = useCallback(async (trackId: number) => {
    try {
      await hybridDB.deleteTrack(trackId.toString());
      setTracks(prev => prev.filter(t => t !== null && t.id !== trackId));
    } catch (error) {
      console.error('Error deleting track:', error);
      options.onError?.('Failed to delete track');
      throw error;
    }
  }, [setTracks, options.onError]);

  const assignTrack = useCallback(async (trackId: number, fieldBoundaryId: number | null) => {
    try {
      await hybridDB.updateTrack(trackId.toString(), { 
        field_boundary_id: fieldBoundaryId ? fieldBoundaryId.toString() : null 
      });
      
      // Update local track state
      setTracks(prev => prev.map(t => 
        t.id === trackId 
          ? { ...t, field_boundary_id: fieldBoundaryId?.toString() || null }
          : t
      ));
    } catch (error) {
      console.error('Error assigning track:', error);
      options.onError?.('Failed to assign track');
      throw error;
    }
  }, [setTracks, options.onError]);

  return {
    // State
    tracks,
    currentTrack,
    sampleCount,
    isStartingTracking,
    isAddingSample,
    
    // Actions
    startTracking,
    stopTracking,
    addSample,
    saveGpsPoint,
    deleteTrack,
    assignTrack,
    loadTracks,
    
    // Utils
    calculateDistance
  };
}