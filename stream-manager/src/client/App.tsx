import React from 'react';

export function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>Stream Manager</h1>
        <div className="user-menu loading">Loading...</div>
      </header>
      <main className="main">
        <div className="dashboard">
          <div className="loading-spinner">Loading streams...</div>
        </div>
      </main>
    </div>
  );
}
