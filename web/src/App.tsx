import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import React, { useEffect, useState, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Setup } from './pages/Setup';
import { SetupLayout } from './components/setup/SetupLayout';
import { checkAuth, login } from './lib/api';
import { logStore } from './lib/log-store';

const Dashboard = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Tools = React.lazy(() => import('./pages/Tools').then(m => ({ default: m.Tools })));
const Plugins = React.lazy(() => import('./pages/Plugins').then(m => ({ default: m.Plugins })));
const Soul = React.lazy(() => import('./pages/Soul').then(m => ({ default: m.Soul })));
const Memory = React.lazy(() => import('./pages/Memory').then(m => ({ default: m.Memory })));
const Workspace = React.lazy(() => import('./pages/Workspace').then(m => ({ default: m.Workspace })));
const Tasks = React.lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const Mcp = React.lazy(() => import('./pages/Mcp').then(m => ({ default: m.Mcp })));
const Config = React.lazy(() => import('./pages/Config').then(m => ({ default: m.Config })));
const Hooks = React.lazy(() => import('./pages/Hooks').then(m => ({ default: m.Hooks })));
const Logs = React.lazy(() => import('./pages/Logs').then(m => ({ default: m.Logs })));
const Conversations = React.lazy(() => import('./pages/Conversations').then(m => ({ default: m.Conversations })));
const Wallet = React.lazy(() => import('./pages/Wallet').then(m => ({ default: m.Wallet })));
const Gocoon = React.lazy(() => import('./pages/Gocoon').then(m => ({ default: m.Gocoon })));

function App() {
  // Setup route bypasses auth entirely
  if (window.location.pathname.startsWith('/setup')) {
    return (
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/setup" element={<SetupLayout />}>
              <Route index element={<Setup />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    // Check for token exchange (from setup launch flow)
    const params = new URLSearchParams(window.location.search);
    const exchangeToken = params.get('token');
    if (window.location.pathname === '/auth/exchange' && exchangeToken) {
      login(exchangeToken).then((success) => {
        if (success) {
          window.location.href = '/';
        } else {
          setLoading(false);
          setLoginError('Token exchange failed');
        }
      });
      return;
    }

    // Check if we already have a valid session cookie
    checkAuth().then((valid) => {
      setIsAuthenticated(valid);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      logStore.connect();
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    const token = tokenInput.trim();
    if (!token) return;

    setLoginError('');
    const success = await login(token);
    if (success) {
      setIsAuthenticated(true);
    } else {
      setLoginError('Invalid token');
    }
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>Teleton</h1>
          <p>Enter your authentication token to access the dashboard.</p>
          <div className="form-group">
            <label>Token</label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Paste token from config..."
              style={{ width: '100%' }}
            />
          </div>
          {loginError && (
            <div className="alert error" style={{ marginBottom: '1rem' }}>
              {loginError}
            </div>
          )}
          <button onClick={handleLogin} style={{ width: '100%' }}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <RoutedContent />
    </BrowserRouter>
  );
}

// Keyed by pathname so a crashed page's error boundary clears on navigation
// (otherwise a broken route traps the user until manual "Try Again").
function RoutedContent() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<div className="loading">Loading...</div>}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="tools" element={<Tools />} />
            <Route path="plugins" element={<Plugins />} />
            <Route path="soul" element={<Soul />} />
            <Route path="memory" element={<Memory />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="gocoon" element={<Gocoon />} />
            <Route path="workspace" element={<Workspace />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="mcp" element={<Mcp />} />
            <Route path="config" element={<Config />} />
            <Route path="hooks" element={<Hooks />} />
            <Route path="logs" element={<Logs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </Suspense>
      </ErrorBoundary>
  );
}

export default App;
