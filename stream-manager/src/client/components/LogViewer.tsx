import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  logs: string[];
  containerId?: string;
  autoScroll?: boolean;
  maxLines?: number;
}

export function LogViewer({ logs, autoScroll: initialAutoScroll = true, maxLines = 500 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(initialAutoScroll);
  const [filter, setFilter] = useState('');
  const [showHealthOnly, setShowHealthOnly] = useState(false);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect user scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const filteredLogs = logs
    .slice(-maxLines)
    .filter((line) => {
      if (showHealthOnly && !line.includes('[health]')) return false;
      if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });

  const getLineClass = (line: string): string => {
    if (line.includes('[health]')) return 'log-line health';
    if (line.toLowerCase().includes('error')) return 'log-line error';
    if (line.toLowerCase().includes('warn')) return 'log-line warn';
    return 'log-line';
  };

  return (
    <div className="log-viewer">
      <div className="log-viewer-header">
        <div className="log-controls">
          <input
            type="text"
            className="log-filter"
            placeholder="Filter logs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="log-toggle">
            <input
              type="checkbox"
              checked={showHealthOnly}
              onChange={(e) => setShowHealthOnly(e.target.checked)}
            />
            Health only
          </label>
        </div>
        <div className="log-status">
          <span className={`auto-scroll-indicator ${autoScroll ? 'active' : ''}`}>
            Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
          </span>
          <span className="log-count">{filteredLogs.length} lines</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="log-viewer-content"
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="log-empty">No logs to display</div>
        ) : (
          filteredLogs.map((line, idx) => (
            <div key={idx} className={getLineClass(line)}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
