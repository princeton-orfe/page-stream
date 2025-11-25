import React, { useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { UserMenu } from './components/UserMenu';
import { Dashboard } from './components/Dashboard';
import { StreamDetail } from './components/StreamDetail';
import { useWebSocket } from './hooks/useWebSocket';
import { StreamContainer } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false
    }
  }
});

function AppContent() {
  const [selectedStream, setSelectedStream] = useState<StreamContainer | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStream(null);
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

  return (
    <div className="app">
      <header className="header">
        <h1>Stream Manager</h1>
        <UserMenu />
      </header>
      <main className="main">
        {selectedStream ? (
          <StreamDetail
            streamId={selectedStream.id}
            wsLogs={logs.get(selectedStream.id)}
            wsHealth={healthStatuses.get(selectedStream.id)}
            onSubscribe={handleSubscribe}
            onUnsubscribe={handleUnsubscribe}
            onBack={handleBack}
          />
        ) : (
          <Dashboard
            streams={streams}
            healthStatuses={healthStatuses}
            loading={!connected && streams.length === 0}
            error={error}
            connected={connected}
            lastUpdated={lastUpdated}
            onStreamClick={handleStreamClick}
          />
        )}
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
