import React, { useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { UserMenu } from './components/UserMenu';
import { Dashboard } from './components/Dashboard';
import { StreamDetail } from './components/StreamDetail';
import { AuditLog } from './components/AuditLog';
import { CapabilityGate } from './components/CapabilityGate';
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

type View = 'dashboard' | 'stream' | 'audit';

function AppContent() {
  const [view, setView] = useState<View>('dashboard');
  const [selectedStream, setSelectedStream] = useState<StreamContainer | null>(null);
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
          <CapabilityGate require="audit:read">
            <button
              className={`nav-button ${view === 'audit' ? 'active' : ''}`}
              onClick={handleAuditClick}
            >
              Audit Log
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
