import { Link, useLocation } from 'react-router-dom';
import { Shell } from './Shell';
import { AgentControl } from './AgentControl';
import { logout } from '../lib/api';

function DashboardNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  return (
    <>
      <nav>
        <Link to="/" className={isActive('/') ? 'active' : ''}>Dashboard</Link>
        <Link to="/tools" className={isActive('/tools') ? 'active' : ''}>Tools</Link>
        <Link to="/plugins" className={isActive('/plugins') ? 'active' : ''}>Plugins</Link>
        <Link to="/soul" className={isActive('/soul') ? 'active' : ''}>Soul</Link>
        <Link to="/memory" className={isActive('/memory') ? 'active' : ''}>Memory</Link>
        <Link to="/logs" className={isActive('/logs') ? 'active' : ''}>Logs</Link>
        <Link to="/workspace" className={isActive('/workspace') ? 'active' : ''}>Workspace</Link>
        <Link to="/tasks" className={isActive('/tasks') ? 'active' : ''}>Tasks</Link>
        <Link to="/mcp" className={isActive('/mcp') ? 'active' : ''}>MCP</Link>
        <Link to="/config" className={isActive('/config') ? 'active' : ''}>Config</Link>
      </nav>
      <div style={{ marginTop: 'auto' }}>
        <AgentControl />
        <div style={{ padding: '0 12px 14px' }}>
          <button
            onClick={handleLogout}
            style={{ width: '100%', opacity: 0.7, fontSize: '13px' }}
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}

export function Layout() {
  return <Shell sidebar={<DashboardNav />} />;
}
