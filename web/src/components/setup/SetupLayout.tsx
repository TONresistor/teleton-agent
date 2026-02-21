import { Outlet } from 'react-router-dom';
import { Shell } from '../Shell';
import { SetupProvider } from './SetupContext';
import { SetupNav } from './SetupNav';

const DASHBOARD_LINKS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Tools', path: '/tools' },
  { label: 'Plugins', path: '/plugins' },
  { label: 'Soul', path: '/soul' },
  { label: 'Memory', path: '/memory' },
  { label: 'Logs', path: '/logs' },
  { label: 'Workspace', path: '/workspace' },
  { label: 'Tasks', path: '/tasks' },
  { label: 'MCP', path: '/mcp' },
  { label: 'Config', path: '/config' },
];

function DisabledNav() {
  return (
    <nav>
      {DASHBOARD_LINKS.map((link) => (
        <span key={link.path} className="sidebar-link-disabled">
          {link.label}
        </span>
      ))}
    </nav>
  );
}

function SetupMain() {
  return (
    <>
      <SetupNav />
      <Outlet />
    </>
  );
}

export function SetupLayout() {
  return (
    <SetupProvider>
      <Shell sidebar={<DisabledNav />}>
        <SetupMain />
      </Shell>
    </SetupProvider>
  );
}
