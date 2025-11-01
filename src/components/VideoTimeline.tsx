import React, { useState, useRef, useEffect, useCallback } from 'react';

interface VideoTimelineProps {
  duration: number;
  startTime: number;
  endTime: number;
  onTimeChange: (start: number, end: number) => void;
  currentTime?: number;
}

export const VideoTimeline: React.FC<VideoTimelineProps> = ({
  duration,
  startTime,
  endTime,
  onTimeChange,
  currentTime = 0,
}) => {
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'selection' | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);

  const startPercent = (startTime / duration) * 100;
  const endPercent = (endTime / duration) * 100;
  const currentPercent = (currentTime / duration) * 100;

  const handleMouseDown = (e: React.MouseEvent, type: 'start' | 'end' | 'selection') => {
    e.stopPropagation();
    setIsDragging(type);
    
    if (type === 'selection' && timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickPercent = (clickX / rect.width) * 100;
      setDragOffset(clickPercent - startPercent);
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    const time = (percent / 100) * duration;

    if (isDragging === 'start') {
      const newStart = Math.max(0, Math.min(time, endTime - 0.1));
      onTimeChange(newStart, endTime);
    } else if (isDragging === 'end') {
      const newEnd = Math.min(duration, Math.max(time, startTime + 0.1));
      onTimeChange(startTime, newEnd);
    } else if (isDragging === 'selection') {
      const selectionWidth = endTime - startTime;
      const newStartPercent = percent - dragOffset;
      const newStart = (newStartPercent / 100) * duration;
      const clampedStart = Math.max(0, Math.min(newStart, duration - selectionWidth));
      onTimeChange(clampedStart, clampedStart + selectionWidth);
    }
  }, [isDragging, duration, endTime, startTime, dragOffset, onTimeChange]);

  const handleMouseUp = () => {
    setIsDragging(null);
    setDragOffset(0);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, startTime, endTime, dragOffset, handleMouseMove]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-400">
        <span>Start: {formatTime(startTime)}</span>
        <span>Duration: {formatTime(endTime - startTime)}</span>
        <span>End: {formatTime(endTime)}</span>
      </div>
      
      <div ref={timelineRef} className="timeline-track relative">
        {/* Background track */}
        <div className="absolute inset-0 bg-gray-700 rounded-lg" />
        
        {/* Current time indicator */}
        {currentTime > 0 && (
          <div
            className="absolute top-0 w-0.5 h-full bg-red-500 z-20"
            style={{ left: `${currentPercent}%` }}
          />
        )}
        
        {/* Selection area */}
        <div
          className="timeline-selection"
          style={{
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'selection')}
        >
          {/* Start handle */}
          <div
            className="timeline-handle left-0 rounded-l"
            onMouseDown={(e) => handleMouseDown(e, 'start')}
          />
          
          {/* End handle */}
          <div
            className="timeline-handle right-0 rounded-r"
            onMouseDown={(e) => handleMouseDown(e, 'end')}
          />
        </div>
        
        {/* Time markers */}
        <div className="absolute inset-0 flex justify-between px-2 items-center pointer-events-none">
          {[...Array(11)].map((_, i) => (
            <div key={i} className="w-px h-3 bg-gray-500" />
          ))}
        </div>
      </div>
      
      <div className="flex justify-between text-xs text-gray-500">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
