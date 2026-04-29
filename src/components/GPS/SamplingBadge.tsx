import React from 'react';
import type { SamplingRequirements } from '../../types/orders';

interface SamplingBadgeProps {
  requirements: SamplingRequirements;
  compact?: boolean;
}

/**
 * Lightweight badge component to display sampling depth requirements
 * Optimized for tablet with React.memo to prevent unnecessary re-renders
 */
const SamplingBadge = React.memo<SamplingBadgeProps>(({ requirements, compact = false }) => {
  if (!requirements) return null;

  // Build depth string (e.g., "0-30 cm" or "30 cm")
  const depthText = requirements.depth || 
    (requirements.depthFrom !== undefined && requirements.depthTo !== undefined 
      ? `${requirements.depthFrom}-${requirements.depthTo} cm`
      : requirements.depthFrom !== undefined 
        ? `${requirements.depthFrom} cm`
        : requirements.depthTo !== undefined 
          ? `${requirements.depthTo} cm`
          : null);

  if (!depthText && !requirements.cores) return null;

  if (compact) {
    // Compact badge for field cards (shows only depth)
    return (
      <div 
        className="absolute top-2 right-2 bg-blue-500/90 text-white text-xs px-2 py-1 rounded shadow-sm backdrop-blur-sm"
        title={requirements.notes || 'Sampling depth'}
      >
        {depthText}
      </div>
    );
  }

  // Full badge for detail views
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700 dark:text-gray-300 bg-blue-50/80 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
      {depthText && (
        <div className="flex items-center gap-1">
          <span className="font-semibold">Depth:</span>
          <span>{depthText}</span>
        </div>
      )}
      {requirements.cores && (
        <div className="flex items-center gap-1">
          <span className="font-semibold">Cores:</span>
          <span>{requirements.cores}</span>
        </div>
      )}
      {requirements.timing && (
        <div className="flex items-center gap-1">
          <span className="font-semibold">Timing:</span>
          <span>{requirements.timing}</span>
        </div>
      )}
    </div>
  );
});

SamplingBadge.displayName = 'SamplingBadge';

export default SamplingBadge;
