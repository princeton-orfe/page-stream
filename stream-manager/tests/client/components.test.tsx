import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../../src/client/contexts/AuthContext';
import { UserMenu } from '../../src/client/components/UserMenu';
import { CapabilityGate } from '../../src/client/components/CapabilityGate';
import { HealthIndicator } from '../../src/client/components/HealthIndicator';
import { StreamCard } from '../../src/client/components/StreamCard';
import { LogViewer } from '../../src/client/components/LogViewer';
import { Dashboard } from '../../src/client/components/Dashboard';
import { ConfirmDialog } from '../../src/client/components/ConfirmDialog';
import { AuditLog } from '../../src/client/components/AuditLog';
import { StreamForm, StreamFormData, DEFAULT_FORM_DATA } from '../../src/client/components/StreamForm';
import { CreateStream } from '../../src/client/pages/CreateStream';
import { EditStream } from '../../src/client/pages/EditStream';
import { StreamContainer, HealthStatus } from '../../src/client/types';

// Mock fetch for auth tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false }
  }
});

// Wrapper for components needing auth context
function AuthWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

// Mock auth context for components that need specific capabilities
const mockAuthContext = {
  user: { id: 'test', username: 'testuser', roles: ['viewer'], authSource: 'anonymous' as const },
  capabilities: new Set(['streams:list', 'streams:read']),
  loading: false,
  error: null,
  hasCapability: vi.fn((cap: string) => ['streams:list', 'streams:read'].includes(cap)),
  hasAnyCapability: vi.fn((...caps: string[]) => caps.some(c => ['streams:list', 'streams:read'].includes(c))),
  canControl: false,
  canManage: false,
  canAdmin: false,
  refresh: vi.fn()
};

vi.mock('../../src/client/hooks/useAuth', () => ({
  useAuth: () => mockAuthContext
}));

describe('HealthIndicator', () => {
  it('renders healthy status with green dot', () => {
    const { container } = render(<HealthIndicator health="healthy" />);
    const dot = container.querySelector('.health-dot');
    expect(dot).toHaveClass('healthy');
  });

  it('renders unhealthy status with error styling', () => {
    const { container } = render(<HealthIndicator health="unhealthy" />);
    const dot = container.querySelector('.health-dot');
    expect(dot).toHaveClass('unhealthy');
  });

  it('renders starting status with warning styling', () => {
    const { container } = render(<HealthIndicator health="starting" />);
    const dot = container.querySelector('.health-dot');
    expect(dot).toHaveClass('starting');
  });

  it('renders none status with muted styling', () => {
    const { container } = render(<HealthIndicator health="none" />);
    const dot = container.querySelector('.health-dot');
    expect(dot).toHaveClass('none');
  });

  it('shows retrying state when health status indicates retrying', () => {
    const healthStatus: HealthStatus = {
      timestamp: new Date().toISOString(),
      uptimeSec: 100,
      ingest: 'srt://test',
      protocol: 'SRT',
      restartAttempt: 1,
      lastFfmpegExitCode: 1,
      retrying: true,
      infobarDismissTried: false
    };
    const { container } = render(
      <HealthIndicator health="healthy" healthStatus={healthStatus} />
    );
    const dot = container.querySelector('.health-dot');
    expect(dot).toHaveClass('retrying');
  });

  it('shows label when showLabel is true', () => {
    render(<HealthIndicator health="healthy" showLabel />);
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });
});

// Wrapper for components needing QueryClient only (no auth)
function QueryWrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('StreamCard', () => {
  const mockStream: StreamContainer = {
    id: 'container123',
    name: '/test-stream',
    status: 'running',
    health: 'healthy',
    created: new Date().toISOString(),
    image: 'page-stream:latest',
    labels: {
      'com.page-stream.ingest': 'srt://localhost:9000',
      'com.page-stream.resolution': '1920x1080'
    },
    ports: [{ container: 9000, host: 9000, protocol: 'udp' }]
  };

  it('renders stream name without leading slash', () => {
    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    expect(screen.getByText('test-stream')).toBeInTheDocument();
  });

  it('renders status badge with correct class', () => {
    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    const badge = screen.getByText('running');
    expect(badge).toHaveClass('status-badge', 'running');
  });

  it('shows resolution from labels', () => {
    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    expect(screen.getByText('1920x1080')).toBeInTheDocument();
  });

  it('truncates long ingest URLs', () => {
    const streamWithLongUrl = {
      ...mockStream,
      labels: {
        'com.page-stream.ingest': 'srt://very-long-hostname.example.com:9000?passphrase=secret'
      }
    };
    render(<QueryWrapper><StreamCard stream={streamWithLongUrl} /></QueryWrapper>);
    const truncatedText = screen.getByText(/srt:\/\/very-long-hostname/);
    expect(truncatedText.textContent).toContain('...');
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<QueryWrapper><StreamCard stream={mockStream} onClick={onClick} /></QueryWrapper>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows uptime from health status', () => {
    const healthStatus: HealthStatus = {
      timestamp: new Date().toISOString(),
      uptimeSec: 3700,
      ingest: 'srt://test',
      protocol: 'SRT',
      restartAttempt: 0,
      lastFfmpegExitCode: null,
      retrying: false,
      infobarDismissTried: false
    };
    render(<QueryWrapper><StreamCard stream={mockStream} healthStatus={healthStatus} /></QueryWrapper>);
    expect(screen.getByText('1h 1m')).toBeInTheDocument();
  });

  it('shows stop button for running streams when user has capability', () => {
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:stop', 'streams:start'].includes(cap)
    );
    mockAuthContext.hasAnyCapability.mockImplementation(
      (...caps: string[]) => caps.some(c => ['streams:list', 'streams:read', 'streams:stop', 'streams:start'].includes(c))
    );

    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('shows start button for stopped streams when user has capability', () => {
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:stop', 'streams:start'].includes(cap)
    );
    mockAuthContext.hasAnyCapability.mockImplementation(
      (...caps: string[]) => caps.some(c => ['streams:list', 'streams:read', 'streams:stop', 'streams:start'].includes(c))
    );

    const stoppedStream = { ...mockStream, status: 'stopped' as const };
    render(<QueryWrapper><StreamCard stream={stoppedStream} /></QueryWrapper>);
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('shows refresh button for running streams when user has capability', () => {
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:stop', 'streams:start', 'streams:refresh'].includes(cap)
    );
    mockAuthContext.hasAnyCapability.mockImplementation(
      (...caps: string[]) => caps.some(c => ['streams:list', 'streams:read', 'streams:stop', 'streams:start', 'streams:refresh'].includes(c))
    );

    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('hides control buttons when user lacks capabilities', () => {
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read'].includes(cap)
    );
    mockAuthContext.hasAnyCapability.mockImplementation(
      (...caps: string[]) => caps.some(c => ['streams:list', 'streams:read'].includes(c))
    );

    render(<QueryWrapper><StreamCard stream={mockStream} /></QueryWrapper>);
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
  });
});

describe('LogViewer', () => {
  const mockLogs = [
    '2024-01-01 10:00:00 Starting stream...',
    '2024-01-01 10:00:01 [health] {"uptimeSec": 1}',
    '2024-01-01 10:00:02 Error: connection failed',
    '2024-01-01 10:00:03 Warning: high latency'
  ];

  it('renders all log lines', () => {
    render(<LogViewer logs={mockLogs} />);
    expect(screen.getByText(/Starting stream/)).toBeInTheDocument();
    expect(screen.getByText(/health/)).toBeInTheDocument();
  });

  it('applies health class to health log lines', () => {
    const { container } = render(<LogViewer logs={mockLogs} />);
    const healthLine = container.querySelector('.log-line.health');
    expect(healthLine).toBeInTheDocument();
    expect(healthLine?.textContent).toContain('[health]');
  });

  it('applies error class to error log lines', () => {
    const { container } = render(<LogViewer logs={mockLogs} />);
    const errorLine = container.querySelector('.log-line.error');
    expect(errorLine).toBeInTheDocument();
    expect(errorLine?.textContent).toContain('Error');
  });

  it('applies warn class to warning log lines', () => {
    const { container } = render(<LogViewer logs={mockLogs} />);
    const warnLine = container.querySelector('.log-line.warn');
    expect(warnLine).toBeInTheDocument();
    expect(warnLine?.textContent).toContain('Warning');
  });

  it('filters logs based on search input', () => {
    render(<LogViewer logs={mockLogs} />);
    const filterInput = screen.getByPlaceholderText('Filter logs...');
    fireEvent.change(filterInput, { target: { value: 'health' } });

    expect(screen.getByText(/health/)).toBeInTheDocument();
    expect(screen.queryByText(/Starting stream/)).not.toBeInTheDocument();
  });

  it('shows health-only logs when checkbox is checked', () => {
    render(<LogViewer logs={mockLogs} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(screen.getByText(/health/)).toBeInTheDocument();
    expect(screen.queryByText(/Starting stream/)).not.toBeInTheDocument();
  });

  it('shows empty state when no logs match filter', () => {
    render(<LogViewer logs={mockLogs} />);
    const filterInput = screen.getByPlaceholderText('Filter logs...');
    fireEvent.change(filterInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No logs to display')).toBeInTheDocument();
  });

  it('limits displayed lines to maxLines', () => {
    const manyLogs = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
    const { container } = render(<LogViewer logs={manyLogs} maxLines={50} />);
    const lines = container.querySelectorAll('.log-line');
    expect(lines.length).toBe(50);
  });
});

describe('Dashboard', () => {
  const mockStreams: StreamContainer[] = [
    {
      id: '1',
      name: '/stream-1',
      status: 'running',
      health: 'healthy',
      created: new Date().toISOString(),
      image: 'page-stream:latest',
      labels: {},
      ports: []
    },
    {
      id: '2',
      name: '/stream-2',
      status: 'running',
      health: 'unhealthy',
      created: new Date().toISOString(),
      image: 'page-stream:latest',
      labels: {},
      ports: []
    },
    {
      id: '3',
      name: '/stream-3',
      status: 'stopped',
      health: 'none',
      created: new Date().toISOString(),
      image: 'page-stream:latest',
      labels: {},
      ports: []
    }
  ];

  it('renders loading state when loading with no streams', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={[]}
          healthStatuses={new Map()}
          loading={true}
          error={null}
          connected={false}
          lastUpdated={null}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('Loading streams...')).toBeInTheDocument();
  });

  it('renders error state when error with no streams', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={[]}
          healthStatuses={new Map()}
          loading={false}
          error="Connection failed"
          connected={false}
          lastUpdated={null}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('renders empty state when no streams found', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={[]}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={true}
          lastUpdated={new Date().toISOString()}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('No Streams Found')).toBeInTheDocument();
  });

  it('renders stream cards for each stream', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={mockStreams}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={true}
          lastUpdated={new Date().toISOString()}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('stream-1')).toBeInTheDocument();
    expect(screen.getByText('stream-2')).toBeInTheDocument();
    expect(screen.getByText('stream-3')).toBeInTheDocument();
  });

  it('displays correct statistics', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={mockStreams}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={true}
          lastUpdated={new Date().toISOString()}
        />
      </QueryWrapper>
    );
    // Total: 3, Running: 2, Healthy: 1, Unhealthy: 1
    expect(screen.getByText('3')).toBeInTheDocument(); // Total
    expect(screen.getByText('2')).toBeInTheDocument(); // Running
    const healthyValue = screen.getByText('1', { selector: '.value.healthy' });
    expect(healthyValue).toBeInTheDocument();
    const unhealthyValue = screen.getByText('1', { selector: '.value.unhealthy' });
    expect(unhealthyValue).toBeInTheDocument();
  });

  it('shows connected status indicator', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={mockStreams}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={true}
          lastUpdated={new Date().toISOString()}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows disconnected status indicator', () => {
    render(
      <QueryWrapper>
        <Dashboard
          streams={mockStreams}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={false}
          lastUpdated={new Date().toISOString()}
        />
      </QueryWrapper>
    );
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
  });

  it('calls onStreamClick when stream card is clicked', () => {
    const onStreamClick = vi.fn();
    render(
      <QueryWrapper>
        <Dashboard
          streams={mockStreams}
          healthStatuses={new Map()}
          loading={false}
          error={null}
          connected={true}
          lastUpdated={new Date().toISOString()}
          onStreamClick={onStreamClick}
        />
      </QueryWrapper>
    );
    fireEvent.click(screen.getByText('stream-1'));
    expect(onStreamClick).toHaveBeenCalledWith(mockStreams[0]);
  });
});

describe('CapabilityGate', () => {
  beforeEach(() => {
    // Reset mock for each test
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read'].includes(cap)
    );
    mockAuthContext.hasAnyCapability.mockImplementation(
      (...caps: string[]) => caps.some(c => ['streams:list', 'streams:read'].includes(c))
    );
  });

  it('renders children when user has required capability', () => {
    render(
      <CapabilityGate require="streams:list">
        <div>Protected content</div>
      </CapabilityGate>
    );
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders fallback when user lacks required capability', () => {
    render(
      <CapabilityGate require="streams:delete" fallback={<div>Access denied</div>}>
        <div>Protected content</div>
      </CapabilityGate>
    );
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders nothing when user lacks capability and no fallback', () => {
    const { container } = render(
      <CapabilityGate require="streams:delete">
        <div>Protected content</div>
      </CapabilityGate>
    );
    expect(container.textContent).toBe('');
  });

  it('requires all capabilities in all mode', () => {
    render(
      <CapabilityGate require={['streams:list', 'streams:delete']} mode="all">
        <div>Protected content</div>
      </CapabilityGate>
    );
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('requires any capability in any mode', () => {
    render(
      <CapabilityGate require={['streams:list', 'streams:delete']} mode="any">
        <div>Protected content</div>
      </CapabilityGate>
    );
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});

describe('UserMenu', () => {
  it('renders username and role badge', () => {
    render(<UserMenu />);
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('shows Open Mode indicator for anonymous users', () => {
    render(<UserMenu />);
    expect(screen.getByText('(Open Mode)')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ConfirmDialog {...defaultProps} isOpen={false} />
    );
    expect(container.textContent).toBe('');
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('renders default button labels', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    render(
      <ConfirmDialog {...defaultProps} confirmLabel="Delete" cancelLabel="Go Back" />
    );
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Go Back')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel when dialog content is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('applies danger variant to confirm button', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn).toHaveClass('btn-danger');
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// Mock useAuditLog and useAuditActions hooks
const mockUseAuditLog = vi.fn();
const mockUseAuditActions = vi.fn();

vi.mock('../../src/client/hooks/useAuditLog', () => ({
  useAuditLog: () => mockUseAuditLog(),
  useAuditActions: () => mockUseAuditActions(),
  getExportUrl: () => '/api/audit/export'
}));

describe('AuditLog', () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuditActions.mockReturnValue({
      data: { actions: ['stream:start', 'stream:stop', 'stream:restart'] },
      isLoading: false
    });
    // Prevent window.open calls
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders loading state', () => {
    mockUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);
    expect(screen.getByText('Loading audit log...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    const refetch = vi.fn();
    mockUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to fetch'),
      refetch
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);
    expect(screen.getByText(/Error loading audit log.*Failed to fetch/)).toBeInTheDocument();

    // Click retry button
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders empty state when no entries', () => {
    mockUseAuditLog.mockReturnValue({
      data: { entries: [], total: 0, limit: 25, offset: 0, hasMore: false },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);
    expect(screen.getByText('No Audit Entries')).toBeInTheDocument();
  });

  it('renders audit entries in table', () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: 1,
            timestamp: '2024-01-15T10:30:00Z',
            userId: 'user1',
            username: 'Test User',
            action: 'stream:start',
            resourceType: 'stream',
            resourceId: 'container-12345678',
            result: 'success'
          },
          {
            id: 2,
            timestamp: '2024-01-15T10:35:00Z',
            userId: 'user2',
            username: 'Admin',
            action: 'stream:stop',
            resourceType: 'stream',
            resourceId: 'container-87654321',
            result: 'failure',
            error: 'Container not found'
          }
        ],
        total: 2,
        limit: 25,
        offset: 0,
        hasMore: false
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);

    // Check header
    expect(screen.getByText('Audit Log')).toBeInTheDocument();

    // Check summary
    expect(screen.getByText('Showing 2 of 2 entries')).toBeInTheDocument();

    // Check table has data by verifying entries
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    // These appear in both the action dropdown options and the table, so use getAllByText
    expect(screen.getAllByText('stream start').length).toBeGreaterThan(0);
    expect(screen.getAllByText('stream stop').length).toBeGreaterThan(0);
  });

  it('calls onBack when back button is clicked', () => {
    mockUseAuditLog.mockReturnValue({
      data: { entries: [], total: 0, limit: 25, offset: 0, hasMore: false },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);
    fireEvent.click(screen.getByText('Back'));
    expect(mockOnBack).toHaveBeenCalled();
  });

  it('renders filter controls', () => {
    mockUseAuditLog.mockReturnValue({
      data: { entries: [], total: 0, limit: 25, offset: 0, hasMore: false },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);

    // Check filters exist by testing input elements
    expect(screen.getByLabelText('User ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Since')).toBeInTheDocument();

    // Check action filter dropdown
    const actionSelect = screen.getByRole('combobox');
    expect(actionSelect).toBeInTheDocument();
  });

  it('opens export URL when export button is clicked', () => {
    mockUseAuditLog.mockReturnValue({
      data: { entries: [], total: 0, limit: 25, offset: 0, hasMore: false },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);
    fireEvent.click(screen.getByText('Export CSV'));
    expect(window.open).toHaveBeenCalledWith('/api/audit/export', '_blank');
  });

  it('renders pagination when there are multiple pages', () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: Array(25).fill({
          id: 1,
          timestamp: '2024-01-15T10:30:00Z',
          userId: 'user1',
          username: 'Test User',
          action: 'stream:start',
          result: 'success'
        }),
        total: 50,
        limit: 25,
        offset: 0,
        hasMore: true
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('does not render pagination for single page', () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: [{
          id: 1,
          timestamp: '2024-01-15T10:30:00Z',
          userId: 'user1',
          username: 'Test User',
          action: 'stream:start',
          result: 'success'
        }],
        total: 1,
        limit: 25,
        offset: 0,
        hasMore: false
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<QueryWrapper><AuditLog onBack={mockOnBack} /></QueryWrapper>);

    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });
});

describe('StreamForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:create', 'streams:update'].includes(cap)
    );
  });

  it('renders form tabs', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Encoding')).toBeInTheDocument();
    expect(screen.getByText('Behavior')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('renders basic tab fields by default', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );
    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Page URL *')).toBeInTheDocument();
    expect(screen.getByLabelText('Ingest URL *')).toBeInTheDocument();
  });

  it('switches between tabs', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    // Click on Encoding tab
    fireEvent.click(screen.getByText('Encoding'));
    expect(screen.getByLabelText('Width')).toBeInTheDocument();
    expect(screen.getByLabelText('Height')).toBeInTheDocument();
    expect(screen.getByLabelText('FPS')).toBeInTheDocument();

    // Click on Behavior tab
    fireEvent.click(screen.getByText('Behavior'));
    expect(screen.getByLabelText('Auto Refresh (seconds)')).toBeInTheDocument();
    expect(screen.getByLabelText('Reconnect Attempts')).toBeInTheDocument();

    // Click on Advanced tab
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByLabelText('X11 Display')).toBeInTheDocument();
    expect(screen.getByLabelText('Inject CSS Path')).toBeInTheDocument();
  });

  it('shows validation errors on submit with empty required fields', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('URL is required')).toBeInTheDocument();
    expect(screen.getByText('Ingest URL is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates name format', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const nameInput = screen.getByLabelText('Name *');
    fireEvent.change(nameInput, { target: { value: '-invalid-name' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText(/Name must start with alphanumeric/)).toBeInTheDocument();
  });

  it('validates URL format', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const urlInput = screen.getByLabelText('Page URL *');
    fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText(/URL must be http/)).toBeInTheDocument();
  });

  it('validates ingest URL format', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const ingestInput = screen.getByLabelText('Ingest URL *');
    fireEvent.change(ingestInput, { target: { value: 'http://invalid.com' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText(/Ingest must be srt:\/\/ or rtmp:\/\//)).toBeInTheDocument();
  });

  it('submits form with valid data', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'test-stream' } });
    fireEvent.change(screen.getByLabelText('Page URL *'), { target: { value: 'https://example.com' } });
    fireEvent.change(screen.getByLabelText('Ingest URL *'), { target: { value: 'srt://localhost:9000' } });

    fireEvent.click(screen.getByText('Save'));

    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'test-stream',
      url: 'https://example.com',
      ingest: 'srt://localhost:9000'
    }));
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('pre-fills form with initialData', () => {
    const initialData: Partial<StreamFormData> = {
      name: 'existing-stream',
      url: 'https://test.com',
      ingest: 'rtmp://localhost/live',
      width: 1280,
      height: 720
    };

    render(
      <StreamForm
        initialData={initialData}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByLabelText('Name *')).toHaveValue('existing-stream');
    expect(screen.getByLabelText('Page URL *')).toHaveValue('https://test.com');
    expect(screen.getByLabelText('Ingest URL *')).toHaveValue('rtmp://localhost/live');

    // Check encoding tab values
    fireEvent.click(screen.getByText('Encoding'));
    expect(screen.getByLabelText('Width')).toHaveValue(1280);
    expect(screen.getByLabelText('Height')).toHaveValue(720);
  });

  it('disables form fields when readOnly is true', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        readOnly={true}
      />
    );

    expect(screen.getByLabelText('Name *')).toBeDisabled();
    expect(screen.getByLabelText('Page URL *')).toBeDisabled();
    expect(screen.getByLabelText('Ingest URL *')).toBeDisabled();
  });

  it('shows metadata when provided', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        metadata={{
          createdAt: '2024-01-15T10:00:00Z',
          createdBy: 'admin',
          updatedAt: '2024-01-16T12:00:00Z',
          updatedBy: 'user1'
        }}
      />
    );

    // Go to Advanced tab where metadata is shown
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('Updated By')).toBeInTheDocument();
    expect(screen.getByText('user1')).toBeInTheDocument();
  });

  it('uses custom submit label', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        submitLabel="Create Stream"
      />
    );

    expect(screen.getByText('Create Stream')).toBeInTheDocument();
  });

  it('shows saving state when isSubmitting is true', () => {
    render(
      <StreamForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isSubmitting={true}
      />
    );

    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });
});

// Mock useStreamConfig hooks
const mockUseStreamConfig = vi.fn();
const mockUseCreateStream = vi.fn();
const mockUseUpdateStream = vi.fn();
const mockUseDeleteStream = vi.fn();
const mockUseDeployStream = vi.fn();

vi.mock('../../src/client/hooks/useStreamConfig', () => ({
  useStreamConfig: () => mockUseStreamConfig(),
  useCreateStream: () => mockUseCreateStream(),
  useUpdateStream: () => mockUseUpdateStream(),
  useDeleteStream: () => mockUseDeleteStream(),
  useDeployStream: () => mockUseDeployStream()
}));

// Mock useTemplates hook
const mockUseTemplates = vi.fn();

vi.mock('../../src/client/hooks/useTemplates', () => ({
  useTemplates: () => mockUseTemplates()
}));

describe('CreateStream', () => {
  const mockOnBack = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:create', 'streams:update'].includes(cap)
    );
    mockUseCreateStream.mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    });
    // Mock templates to show the template selector
    mockUseTemplates.mockReturnValue({
      data: {
        templates: [
          {
            id: 'tmpl-1',
            name: 'Basic Web Page',
            description: 'Standard web page streaming',
            category: 'standard',
            config: { width: 1920, height: 1080 },
            builtIn: true
          }
        ],
        total: 1
      },
      isLoading: false,
      error: null
    });
  });

  it('renders template selector first', () => {
    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    expect(screen.getByText('Create New Stream')).toBeInTheDocument();
    expect(screen.getByText('Choose a Template')).toBeInTheDocument();
    expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked from template selector', () => {
    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    fireEvent.click(screen.getByText('Back'));
    expect(mockOnBack).toHaveBeenCalled();
  });

  it('shows access denied when user lacks streams:create capability', () => {
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read'].includes(cap)
    );

    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to create streams.")).toBeInTheDocument();
  });

  it('shows form after clicking Start from Scratch', () => {
    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    // Click "Start from Scratch" to skip template selection
    fireEvent.click(screen.getByText('Start from Scratch'));

    // Now the form should be visible
    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    expect(screen.getByText('Create Stream')).toBeInTheDocument();
  });

  it('calls mutate when form is submitted', () => {
    const mockMutate = vi.fn();
    mockUseCreateStream.mockReturnValue({
      mutate: mockMutate,
      isPending: false
    });

    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    // Skip template selection
    fireEvent.click(screen.getByText('Start from Scratch'));

    // Fill in required fields
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'new-stream' } });
    fireEvent.change(screen.getByLabelText('Page URL *'), { target: { value: 'https://example.com' } });
    fireEvent.change(screen.getByLabelText('Ingest URL *'), { target: { value: 'srt://localhost:9000' } });

    fireEvent.click(screen.getByText('Create Stream'));

    expect(mockMutate).toHaveBeenCalled();
  });

  it('applies selected template when clicking Use Selected Template', () => {
    render(
      <QueryWrapper>
        <CreateStream onBack={mockOnBack} onCreated={mockOnCreated} />
      </QueryWrapper>
    );

    // Select a template
    fireEvent.click(screen.getByText('Basic Web Page'));
    expect(screen.getByText('Selected: Basic Web Page')).toBeInTheDocument();

    // Click "Use Selected Template"
    fireEvent.click(screen.getByText('Use Selected Template'));

    // Now the form should be visible
    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
  });
});

describe('EditStream', () => {
  const mockOnBack = vi.fn();
  const mockOnDeleted = vi.fn();
  const mockOnDeployed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext.hasCapability.mockImplementation(
      (cap: string) => ['streams:list', 'streams:read', 'streams:create', 'streams:update', 'streams:delete', 'streams:start'].includes(cap)
    );
    mockUseUpdateStream.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false
    });
    mockUseDeleteStream.mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    });
    mockUseDeployStream.mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    });
  });

  it('renders loading state', () => {
    mockUseStreamConfig.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    expect(screen.getByText('Loading stream configuration...')).toBeInTheDocument();
  });

  it('renders error state when config not found', () => {
    mockUseStreamConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found')
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('renders edit form with config data', () => {
    mockUseStreamConfig.mockReturnValue({
      data: {
        config: {
          id: 'config-123',
          name: 'test-stream',
          type: 'standard',
          enabled: true,
          url: 'https://example.com',
          ingest: 'srt://localhost:9000',
          width: 1920,
          height: 1080,
          fps: 30,
          cropInfobar: 0,
          preset: 'veryfast',
          videoBitrate: '2500k',
          audioBitrate: '128k',
          format: 'mpegts',
          autoRefreshSeconds: 0,
          reconnectAttempts: 0,
          reconnectInitialDelayMs: 1000,
          reconnectMaxDelayMs: 30000,
          healthIntervalSeconds: 30,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-16T12:00:00Z',
          createdBy: 'admin'
        }
      },
      isLoading: false,
      error: null
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    expect(screen.getByText('Edit Stream: test-stream')).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveValue('test-stream');
    expect(screen.getByLabelText('Page URL *')).toHaveValue('https://example.com');
  });

  it('shows delete button when user has streams:delete capability', () => {
    mockUseStreamConfig.mockReturnValue({
      data: {
        config: {
          id: 'config-123',
          name: 'test-stream',
          type: 'standard',
          enabled: true,
          url: 'https://example.com',
          ingest: 'srt://localhost:9000',
          width: 1920,
          height: 1080,
          fps: 30,
          cropInfobar: 0,
          preset: 'veryfast',
          videoBitrate: '2500k',
          audioBitrate: '128k',
          format: 'mpegts',
          autoRefreshSeconds: 0,
          reconnectAttempts: 0,
          reconnectInitialDelayMs: 1000,
          reconnectMaxDelayMs: 30000,
          healthIntervalSeconds: 30,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-16T12:00:00Z',
          createdBy: 'admin'
        }
      },
      isLoading: false,
      error: null
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows deploy button when user has streams:start capability', () => {
    mockUseStreamConfig.mockReturnValue({
      data: {
        config: {
          id: 'config-123',
          name: 'test-stream',
          type: 'standard',
          enabled: true,
          url: 'https://example.com',
          ingest: 'srt://localhost:9000',
          width: 1920,
          height: 1080,
          fps: 30,
          cropInfobar: 0,
          preset: 'veryfast',
          videoBitrate: '2500k',
          audioBitrate: '128k',
          format: 'mpegts',
          autoRefreshSeconds: 0,
          reconnectAttempts: 0,
          reconnectInitialDelayMs: 1000,
          reconnectMaxDelayMs: 30000,
          healthIntervalSeconds: 30,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-16T12:00:00Z',
          createdBy: 'admin'
        }
      },
      isLoading: false,
      error: null
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('shows delete confirmation dialog when delete is clicked', () => {
    mockUseStreamConfig.mockReturnValue({
      data: {
        config: {
          id: 'config-123',
          name: 'test-stream',
          type: 'standard',
          enabled: true,
          url: 'https://example.com',
          ingest: 'srt://localhost:9000',
          width: 1920,
          height: 1080,
          fps: 30,
          cropInfobar: 0,
          preset: 'veryfast',
          videoBitrate: '2500k',
          audioBitrate: '128k',
          format: 'mpegts',
          autoRefreshSeconds: 0,
          reconnectAttempts: 0,
          reconnectInitialDelayMs: 1000,
          reconnectMaxDelayMs: 30000,
          healthIntervalSeconds: 30,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-16T12:00:00Z',
          createdBy: 'admin'
        }
      },
      isLoading: false,
      error: null
    });

    render(
      <QueryWrapper>
        <EditStream
          configId="config-123"
          onBack={mockOnBack}
          onDeleted={mockOnDeleted}
          onDeployed={mockOnDeployed}
        />
      </QueryWrapper>
    );

    // Click delete button
    fireEvent.click(screen.getByText('Delete'));

    // Check dialog appears
    expect(screen.getByText('Delete Stream')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
  });
});
