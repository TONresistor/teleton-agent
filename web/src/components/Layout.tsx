import { Link, Outlet, useLocation } from 'react-router-dom';
import { logout } from '../lib/api';

export function Layout() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  return (
    <div className="container">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/logo_dark.png" alt="Teleton" style={{ height: '64px' }} />
        </div>
        <nav>
          <Link to="/" className={isActive('/') ? 'active' : ''}>
            Dashboard
          </Link>
          <Link to="/tools" className={isActive('/tools') ? 'active' : ''}>
            Tools
          </Link>
          <Link to="/plugins" className={isActive('/plugins') ? 'active' : ''}>
            Plugins
          </Link>
          <Link to="/soul" className={isActive('/soul') ? 'active' : ''}>
            Soul
          </Link>
          <Link to="/memory" className={isActive('/memory') ? 'active' : ''}>
            Memory
          </Link>
          <Link to="/logs" className={isActive('/logs') ? 'active' : ''}>
            Logs
          </Link>
          <Link to="/workspace" className={isActive('/workspace') ? 'active' : ''}>
            Workspace
          </Link>
          <Link to="/tasks" className={isActive('/tasks') ? 'active' : ''}>
            Tasks
          </Link>
          <Link to="/mcp" className={isActive('/mcp') ? 'active' : ''}>
            MCP
          </Link>
          <Link to="/config" className={isActive('/config') ? 'active' : ''}>
            Config
          </Link>
        </nav>
        <div style={{ marginTop: 'auto', padding: '14px' }}>
          <button
            onClick={handleLogout}
            style={{ width: '100%', opacity: 0.7, fontSize: '13px' }}
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
