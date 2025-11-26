import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Schedules } from '../../../src/client/pages/Schedules';
import { Schedule } from '../../../src/client/types';

// Mock the hooks
vi.mock('../../../src/client/hooks/useSchedules', () => ({
  useSchedules: vi.fn(),
  useScheduleControl: vi.fn(),
  useDeleteSchedule: vi.fn()
}));

// Mock the CapabilityGate to always render children
vi.mock('../../../src/client/components/CapabilityGate', () => ({
  CapabilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

// Mock the ConfirmDialog
vi.mock('../../../src/client/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ onConfirm, onCancel, title, message }: {
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    message: string;
  }) => (
    <div data-testid="confirm-dialog">
      <div>{title}</div>
      <div>{message}</div>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}));

import {
  useSchedules,
  useScheduleControl,
  useDeleteSchedule
} from '../../../src/client/hooks/useSchedules';

const mockSchedules: Schedule[] = [
  {
    id: 'schedule-1',
    name: 'Morning Start',
    description: 'Start streams in the morning',
    enabled: true,
    targetType: 'stream',
    targetId: 'stream-123',
    action: 'start',
    cronExpression: '0 9 * * *',
    timezone: 'America/New_York',
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    lastRun: new Date(Date.now() - 86400000).toISOString(),
    lastRunResult: 'success',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdBy: 'admin'
  },
  {
    id: 'schedule-2',
    name: 'Evening Stop',
    enabled: false,
    targetType: 'group',
    targetId: 'group-456',
    action: 'stop',
    cronExpression: '0 22 * * *',
    timezone: 'UTC',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    createdBy: 'admin'
  }
];

const mockUseSchedules = useSchedules as ReturnType<typeof vi.fn>;
const mockUseScheduleControl = useScheduleControl as ReturnType<typeof vi.fn>;
const mockUseDeleteSchedule = useDeleteSchedule as ReturnType<typeof vi.fn>;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('Schedules Page', () => {
  const mockOnBack = vi.fn();
  const mockOnEdit = vi.fn();
  const mockOnCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseSchedules.mockReturnValue({
      data: { schedules: mockSchedules, total: 2 },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    mockUseScheduleControl.mockReturnValue({
      trigger: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      enable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      disable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
    });

    mockUseDeleteSchedule.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false
    });
  });

  it('should render schedule list', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('Schedules (2)')).toBeInTheDocument();
    expect(screen.getByText('Morning Start')).toBeInTheDocument();
    expect(screen.getByText('Evening Stop')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    mockUseSchedules.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
  });

  it('should show error state', () => {
    mockUseSchedules.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Failed to load'),
      refetch: vi.fn()
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText(/Error loading schedules/)).toBeInTheDocument();
  });

  it('should show empty state', () => {
    mockUseSchedules.mockReturnValue({
      data: { schedules: [], total: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('No schedules configured.')).toBeInTheDocument();
  });

  it('should call onBack when back button clicked', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    fireEvent.click(screen.getByText('Back'));
    expect(mockOnBack).toHaveBeenCalled();
  });

  it('should call onCreate when new schedule button clicked', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    fireEvent.click(screen.getByText('New Schedule'));
    expect(mockOnCreate).toHaveBeenCalled();
  });

  it('should display enabled/disabled status badges', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('should display target type badges', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('stream')).toBeInTheDocument();
    expect(screen.getByText('group')).toBeInTheDocument();
  });

  it('should display action badges', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.getByText('stop')).toBeInTheDocument();
  });

  it('should display cron expressions', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
    expect(screen.getByText('0 22 * * *')).toBeInTheDocument();
  });

  it('should display last run result badge', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('Never run')).toBeInTheDocument();
  });

  it('should trigger schedule when Run button clicked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({});
    mockUseScheduleControl.mockReturnValue({
      trigger: { mutateAsync: mockTrigger, isPending: false },
      enable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      disable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    const runButtons = screen.getAllByText('Run');
    fireEvent.click(runButtons[0]);

    await waitFor(() => {
      expect(mockTrigger).toHaveBeenCalledWith('schedule-1');
    });
  });

  it('should enable schedule when Enable button clicked', async () => {
    const mockEnable = vi.fn().mockResolvedValue({});
    mockUseScheduleControl.mockReturnValue({
      trigger: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      enable: { mutateAsync: mockEnable, isPending: false },
      disable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    // The second schedule is disabled, so it should have an Enable button
    const enableButton = screen.getByText('Enable');
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(mockEnable).toHaveBeenCalledWith('schedule-2');
    });
  });

  it('should disable schedule when Disable button clicked', async () => {
    const mockDisable = vi.fn().mockResolvedValue({});
    mockUseScheduleControl.mockReturnValue({
      trigger: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      enable: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      disable: { mutateAsync: mockDisable, isPending: false }
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    // The first schedule is enabled, so it should have a Disable button
    const disableButton = screen.getByText('Disable');
    fireEvent.click(disableButton);

    await waitFor(() => {
      expect(mockDisable).toHaveBeenCalledWith('schedule-1');
    });
  });

  it('should call onEdit when Edit button clicked', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    const editButtons = screen.getAllByText('Edit');
    fireEvent.click(editButtons[0]);

    expect(mockOnEdit).toHaveBeenCalledWith('schedule-1');
  });

  it('should show confirm dialog when Delete button clicked', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
  });

  it('should delete schedule when confirmed', async () => {
    const mockDelete = vi.fn().mockResolvedValue({});
    mockUseDeleteSchedule.mockReturnValue({
      mutateAsync: mockDelete,
      isPending: false
    });

    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    const confirmButton = screen.getByText('Confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('schedule-1');
    });
  });

  it('should close confirm dialog when cancelled', () => {
    renderWithProviders(
      <Schedules onBack={mockOnBack} onEdit={mockOnEdit} onCreate={mockOnCreate} />
    );

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });
});
