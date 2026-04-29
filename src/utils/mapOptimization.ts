// Optimization utilities for high-performance map rendering
import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Hook to only render markers within current viewport
 * Significantly reduces DOM elements for large datasets
 */
export function useViewportFilter() {
  const map = useMap();
  const [bounds, setBounds] = useState(map.getBounds());

  useEffect(() => {
    // Update less frequently for performance - debounce
    let timeoutId: NodeJS.Timeout;
    const debouncedUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setBounds(map.getBounds());
      }, 250);
    };

    map.on('moveend', debouncedUpdate);
    map.on('zoomend', debouncedUpdate);

    return () => {
      map.off('moveend', debouncedUpdate);
      map.off('zoomend', debouncedUpdate);
      clearTimeout(timeoutId);
    };
  }, [map]);

  const isInViewport = (lat: number, lng: number): boolean => {
    return bounds.contains([lat, lng]);
  };

  const isPolygonInViewport = (coordinates: number[][][]): boolean => {
    try {
      const ring = coordinates[0];
      if (!ring || ring.length === 0) return false;
      
      // Check if any corner is in bounds (quick check)
      return ring.some(coord => bounds.contains([coord[1], coord[0]]));
    } catch {
      return false;
    }
  };

  return { bounds, isInViewport, isPolygonInViewport, zoom: map.getZoom() };
}

/**
 * Optimize sample rendering based on zoom level
 * At low zoom: show 1 sample per 5, medium: 1 per 3, high: show all
 */
export function getSampleVisibilityFilter(zoom: number): (index: number) => boolean {
  if (zoom >= 16) {
    return () => true; // Show all samples at high zoom
  } else if (zoom >= 13) {
    return (index: number) => index % 3 === 0; // Show 1 in 3
  } else if (zoom >= 10) {
    return (index: number) => index % 5 === 0; // Show 1 in 5
  } else {
    return () => false; // Hide all samples at very low zoom
  }
}

/**
 * Cluster markers to reduce DOM elements
 */
export function clusterMarkers(
  positions: [number, number][],
  clusterRadius: number = 50
): Array<{ positions: [number, number][]; center: [number, number] }> {
  if (positions.length === 0) return [];

  const clusters: Array<{ positions: [number, number][]; center: [number, number] }> = [];
  const used = new Set<number>();

  for (let i = 0; i < positions.length; i++) {
    if (used.has(i)) continue;

    const cluster = [positions[i]];
    used.add(i);

    // Simple distance-based clustering
    for (let j = i + 1; j < positions.length; j++) {
      if (used.has(j)) continue;

      const dist = Math.sqrt(
        Math.pow(positions[i][0] - positions[j][0], 2) +
        Math.pow(positions[i][1] - positions[j][1], 2)
      );

      if (dist < clusterRadius * 0.001) { // Rough conversion to degrees
        cluster.push(positions[j]);
        used.add(j);
      }
    }

    // Calculate center
    const center: [number, number] = [
      cluster.reduce((sum, p) => sum + p[0], 0) / cluster.length,
      cluster.reduce((sum, p) => sum + p[1], 0) / cluster.length,
    ];

    clusters.push({ positions: cluster, center });
  }

  return clusters;
}

/**
 * Virtualized sample list - only render visible samples in sidebar
 */
export function useSampleVirtualization(totalSamples: number, containerHeight: number) {
  const itemHeight = 40; // pixels per sample
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const [scrollOffset, setScrollOffset] = useState(0);

  const startIndex = Math.floor(scrollOffset / itemHeight);
  const endIndex = Math.min(startIndex + visibleCount + 1, totalSamples);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollOffset(e.currentTarget.scrollTop);
  };

  return {
    visibleRange: [startIndex, endIndex],
    offsetY: startIndex * itemHeight,
    handleScroll,
    containerHeight: containerHeight + 200, // Add buffer
  };
}
