import React, { useState, useCallback } from 'react';
import { useAuditLog, useAuditActions, getExportUrl, AuditEntry } from '../hooks/useAuditLog';

interface Props {
  onBack: () => void;
}

const PAGE_SIZE = 25;

export function AuditLog({ onBack }: Props) {
  const [filters, setFilters] = useState<{
    action: string;
    userId: string;
    since: string;
  }>({
    action: '',
    userId: '',
    since: ''
  });
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch } = useAuditLog({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    action: filters.action || undefined,
    userId: filters.userId || undefined,
    since: filters.since || undefined
  });

  const { data: actionsData } = useAuditActions();

  const handleFilterChange = useCallback((field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setPage(0);
  }, []);

  const handleExport = useCallback(() => {
    const url = getExportUrl({
      action: filters.action || undefined,
      userId: filters.userId || undefined,
      since: filters.since || undefined
    });
    window.open(url, '_blank');
  }, [filters]);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const formatAction = (action: string) => {
    return action.replace(':', ' ').replace(/_/g, ' ');
  };

  const getResultClass = (result: string) => {
    return result === 'success' ? 'result-success' : 'result-failure';
  };

  if (isLoading && !data) {
    return (
      <div className="audit-log">
        <div className="audit-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Audit Log</h2>
        </div>
        <div className="loading-spinner">Loading audit log...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="audit-log">
        <div className="audit-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Audit Log</h2>
        </div>
        <div className="error-message">
          Error loading audit log: {error.message}
          <button onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="audit-log">
      <div className="audit-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Audit Log</h2>
        <div className="audit-actions">
          <button className="export-button" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="audit-filters">
        <div className="filter-group">
          <label htmlFor="action-filter">Action</label>
          <select
            id="action-filter"
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
          >
            <option value="">All actions</option>
            {actionsData?.actions.map(action => (
              <option key={action} value={action}>{formatAction(action)}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="user-filter">User ID</label>
          <input
            id="user-filter"
            type="text"
            placeholder="Filter by user..."
            value={filters.userId}
            onChange={(e) => handleFilterChange('userId', e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="since-filter">Since</label>
          <input
            id="since-filter"
            type="datetime-local"
            value={filters.since}
            onChange={(e) => handleFilterChange('since', e.target.value ? new Date(e.target.value).toISOString() : '')}
          />
        </div>
      </div>

      <div className="audit-summary">
        Showing {entries.length} of {total} entries
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>No Audit Entries</h3>
          <p>No audit log entries match your filters.</p>
        </div>
      ) : (
        <div className="audit-table-container">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Result</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: AuditEntry) => (
                <tr key={entry.id} className={getResultClass(entry.result)}>
                  <td className="timestamp">{formatTimestamp(entry.timestamp)}</td>
                  <td className="user" title={entry.userId}>{entry.username}</td>
                  <td className="action">{formatAction(entry.action)}</td>
                  <td className="resource">
                    {entry.resourceType && (
                      <span className="resource-type">{entry.resourceType}</span>
                    )}
                    {entry.resourceId && (
                      <span className="resource-id" title={entry.resourceId}>
                        {entry.resourceId.substring(0, 12)}...
                      </span>
                    )}
                  </td>
                  <td className={`result ${getResultClass(entry.result)}`}>
                    {entry.result}
                    {entry.error && (
                      <span className="error-text" title={entry.error}>!</span>
                    )}
                  </td>
                  <td className="details">
                    {entry.details && (
                      <span title={JSON.stringify(entry.details, null, 2)}>
                        {Object.keys(entry.details).length} fields
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </button>
          <span className="page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={!data?.hasMore}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
