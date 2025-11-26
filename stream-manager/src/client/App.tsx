import React, { useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { UserMenu } from './components/UserMenu';
import { Dashboard } from './components/Dashboard';
import { StreamDetail } from './components/StreamDetail';
import { AuditLog } from './components/AuditLog';
import { CapabilityGate } from './components/CapabilityGate';
import { CreateStream } from './pages/CreateStream';
import { EditStream } from './pages/EditStream';
import { UserManagement } from './pages/UserManagement';
import { Compositors } from './pages/Compositors';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './hooks/useAuth';
import { StreamContainer } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false
    }
  }
});

type View = 'dashboard' | 'stream' | 'audit' | 'create-stream' | 'edit-stream' | 'users' | 'compositors';

function AppContent() {
  const [view, setView] = useState<View>('dashboard');
  const [selectedStream, setSelectedStream] = useState<StreamContainer | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const { hasCapability } = useAuth();

  const {
    connected,
    streams,
    healthStatuses,
    logs,
    error,
    subscribeLogs,
    unsubscribeLogs
  } = useWebSocket({
    onStreamsUpdate: () => setLastUpdated(new Date().toISOString())
  });

  const handleStreamClick = useCallback((stream: StreamContainer) => {
    setSelectedStream(stream);
    setView('stream');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStream(null);
    setView('dashboard');
  }, []);

  const handleAuditClick = useCallback(() => {
    setView('audit');
  }, []);

  const handleUsersClick = useCallback(() => {
    setView('users');
  }, []);

  const handleCompositorsClick = useCallback(() => {
    setView('compositors');
  }, []);

  const handleCreateClick = useCallback(() => {
    setView('create-stream');
  }, []);

  const handleStreamCreated = useCallback((configId: string, containerId?: string) => {
    if (containerId) {
      // If container was created, go to stream detail
      const stream = streams.find(s => s.id === containerId);
      if (stream) {
        setSelectedStream(stream);
        setView('stream');
        return;
      }
    }
    // Otherwise go back to dashboard
    setView('dashboard');
  }, [streams]);

  const handleEditStream = useCallback((configId: string) => {
    setSelectedConfigId(configId);
    setView('edit-stream');
  }, []);

  const handleStreamDeleted = useCallback(() => {
    setSelectedConfigId(null);
    setView('dashboard');
  }, []);

  const handleStreamDeployed = useCallback((containerId: string) => {
    const stream = streams.find(s => s.id === containerId);
    if (stream) {
      setSelectedStream(stream);
      setView('stream');
    } else {
      setView('dashboard');
    }
  }, [streams]);

  const handleSubscribe = useCallback(() => {
    if (selectedStream) {
      subscribeLogs(selectedStream.id);
    }
  }, [selectedStream, subscribeLogs]);

  const handleUnsubscribe = useCallback(() => {
    if (selectedStream) {
      unsubscribeLogs(selectedStream.id);
    }
  }, [selectedStream, unsubscribeLogs]);

  const renderContent = () => {
    switch (view) {
      case 'stream':
        return selectedStream ? (
          <StreamDetail
            streamId={selectedStream.id}
            wsLogs={logs.get(selectedStream.id)}
            wsHealth={healthStatuses.get(selectedStream.id)}
            onSubscribe={handleSubscribe}
            onUnsubscribe={handleUnsubscribe}
            onBack={handleBack}
          />
        ) : null;
      case 'audit':
        return <AuditLog onBack={handleBack} />;
      case 'users':
        return <UserManagement onBack={handleBack} />;
      case 'compositors':
        return <Compositors onBack={handleBack} />;
      case 'create-stream':
        return (
          <CreateStream
            onBack={handleBack}
            onCreated={handleStreamCreated}
          />
        );
      case 'edit-stream':
        return selectedConfigId ? (
          <EditStream
            configId={selectedConfigId}
            onBack={handleBack}
            onDeleted={handleStreamDeleted}
            onDeployed={handleStreamDeployed}
          />
        ) : null;
      default:
        return (
          <Dashboard
            streams={streams}
            healthStatuses={healthStatuses}
            loading={!connected && streams.length === 0}
            error={error}
            connected={connected}
            lastUpdated={lastUpdated}
            onStreamClick={handleStreamClick}
          />
        );
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 onClick={() => setView('dashboard')} style={{ cursor: 'pointer' }}>Stream Manager</h1>
        <nav className="nav">
          <CapabilityGate require="streams:create">
            <button
              className={`nav-button ${view === 'create-stream' ? 'active' : ''}`}
              onClick={handleCreateClick}
            >
              New Stream
            </button>
          </CapabilityGate>
          <CapabilityGate require="audit:read">
            <button
              className={`nav-button ${view === 'audit' ? 'active' : ''}`}
              onClick={handleAuditClick}
            >
              Audit Log
            </button>
          </CapabilityGate>
          <CapabilityGate require="users:list">
            <button
              className={`nav-button ${view === 'users' ? 'active' : ''}`}
              onClick={handleUsersClick}
            >
              Users
            </button>
          </CapabilityGate>
          <CapabilityGate require="compositors:list">
            <button
              className={`nav-button ${view === 'compositors' ? 'active' : ''}`}
              onClick={handleCompositorsClick}
            >
              Compositors
            </button>
          </CapabilityGate>
        </nav>
        <UserMenu />
      </header>
      <main className="main">
        {renderContent()}
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}
