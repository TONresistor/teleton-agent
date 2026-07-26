import { Link, useLocation } from 'react-router';
import { Shell } from './Shell';
import { AgentControl, AgentStatusBadge } from './AgentControl';
import { ModeSwitch } from './ModeSwitch';
import { ThemeToggle } from './ThemeToggle';
import { logout } from '../lib/api';
import { CSSProperties, ReactNode } from 'react';

// ── Inline SVG icons (Lucide-style, 18×18, strokeWidth 1.5) ──────────────────

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.968 0C20.644 0 22 1.399 22 3.128v11.744C22 16.6 20.644 18 18.968 18H3.032C1.356 18 0 16.6 0 14.872V3.128C0 1.399 1.356 0 3.032 0h15.936Zm-5.309 1.56H3.032c-.84 0-1.52.702-1.52 1.569v11.743c0 .866.68 1.568 1.52 1.568h10.627V1.56Zm5.309 0h-3.797v14.88h3.797c.84 0 1.52-.701 1.52-1.568V3.128c0-.867-.68-1.569-1.52-1.569Zm0 6.853c.314 0 .57.239.57.587 0 .289-.2.528-.467.578l-.103.01h-2.277l-.102-.01a.588.588 0 0 1-.467-.578c0-.29.2-.528.467-.579l.102-.008h2.277Zm0-2.349c.314 0 .57.239.57.587 0 .29-.2.528-.467.579l-.103.009h-2.277l-.102-.01a.588.588 0 0 1-.467-.578c0-.289.2-.527.467-.578l.102-.009h2.277Zm0-2.348c.314 0 .57.238.57.587 0 .289-.2.527-.467.578l-.103.009h-2.277l-.102-.009a.588.588 0 0 1-.467-.578c0-.29.2-.528.467-.579l.102-.008h2.277Z"/>
    </svg>
  );
}

function IconTools() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconPlugins() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 22" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.764 3.168a.998.998 0 0 1 .35 1.977L22.195 2.688a.998.998 0 0 0-.35-1.977L8.764 3.168Z"/>
      <path d="M4.509 8.925l2.67-.694a.312.312 0 0 0 .33-.554l-.866-3.857a3.1 3.1 0 0 0-.332-.784l-.125-.189c-.762-1.143-1.383-1.92-1.865-2.377a1.5 1.5 0 0 0-.435-.348c.012-.02.024-.039.036-.055.027-.039.044-.056.05-.062a.14.14 0 0 0-.109.043.24.24 0 0 0-.122.011c.006.002.022.007.052.021a.7.7 0 0 1 .077.042c-.07.117-.158.306-.252.593-.22.675-.415 1.706-.564 3.134l-.012.116a3.1 3.1 0 0 0 .047.774l.868 3.84a.312.312 0 0 0 .537.35Z"/>
      <path d="M17.666 19.948a8.6 8.6 0 0 0-1.627-3.507c.016-.9.152-1.685.53-2.414.377-.724.953-1.316 1.718-1.904a7.8 7.8 0 0 1 3.286-1.295.312.312 0 0 0 .22-.24l.007-.152a.244.244 0 0 0-.244-.26H8.636a.244.244 0 0 0-.243.257l.125 4.215a3.5 3.5 0 0 1 1.251 1.332c.298.49.428 1.052.428 1.647 0 .58-.124 1.128-.401 1.614a3.1 3.1 0 0 1-1.108 1.102v-.08a.12.12 0 0 1-.069.12l.069-.04v1.042h-.134a.137.137 0 0 0 .134.137h-.134v-1.137h9.007v1.137a.137.137 0 0 0 .134-.137h-.134v-1.19l.037.036-.034-.035a.12.12 0 0 1-.034-.083v.058l-.03-.03Z"/>
      <path d="M2.59 12.592c1.229.664 2.81 1.133 4.767 1.384a.12.12 0 0 0 .152-.148v-3.412a.244.244 0 0 0-.244-.24H.24a.244.244 0 0 0-.175.406c.8.867 1.642 1.533 2.526 2.01Z"/>
    </svg>
  );
}

function IconSoul() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M22 11c0 6.075-4.925 11-11 11S0 17.075 0 11 4.925 0 11 0s11 4.925 11 11Zm-5.074 5.186c-1.404-1.2-3.378-1.801-5.926-1.801-2.545 0-4.518.598-5.923 1.798a3.4 3.4 0 0 0-.486.486c-.29.32-.271.807.043 1.107.155.152.321.304.446.407A9.96 9.96 0 0 0 11 20.308a9.96 9.96 0 0 0 5.923-2.129c.126-.102.288-.254.443-.403.311-.3.33-.787.043-1.107a3.4 3.4 0 0 0-.483-.483ZM14.385 8.462a3.385 3.385 0 1 1-6.77 0 3.385 3.385 0 0 1 6.77 0Z"/>
    </svg>
  );
}

function IconMemory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function IconConversations() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 0c3.094 0 5.89 1.158 7.89 3.025C20.817 4.821 22 7.273 22 9.978c0 5.511-4.926 9.978-11 9.978-.293 0-.578-.012-.863-.031h-.027a12.4 12.4 0 0 1-1.81-.273c-.163-.035-.347.136-.66.421-.374.343-.93.857-1.848 1.372-1.171.655-2.8.6-3.074.483-.261-.11-.058-.332.297-.718.246-.265.57-.612.86-1.06.714-1.092.417-2.39.097-2.627C1.473 15.696 0 13.12 0 9.978 0 4.467 4.926 0 11 0Zm-5 10.976a.999.999 0 1 0 0 1.995h7a.999.999 0 1 0 0-1.995H6Zm0-3.991a.999.999 0 1 0 0 1.995h10a.999.999 0 1 0 0-1.995H6Z"/>
    </svg>
  );
}

function IconWallet() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 5.236C0 3.403 0 2.487.34 1.787A2.5 2.5 0 0 1 1.7.357C2.367 0 3.24 0 4.984 0h11.058c1.745 0 2.617 0 3.284.357a2.5 2.5 0 0 1 1.36 1.43c.26.536.32 1.2.336 2.304h-5.447c-1.451 0-2.177 0-2.75.25a3.1 3.1 0 0 0-1.686 1.77c-.237.602-.237 1.364-.237 2.889s0 2.287.237 2.889a3.1 3.1 0 0 0 1.686 1.771c.573.249 1.299.249 2.75.249h5.447c-.014 1.105-.075 1.768-.335 2.304a2.5 2.5 0 0 1-1.361 1.43C18.659 18 17.787 18 16.042 18H4.984c-1.745 0-2.617 0-3.284-.357a2.5 2.5 0 0 1-1.36-1.43C0 15.513 0 14.597 0 12.764V5.236Z"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M12.266 8.795c0-1.145 0-1.718.212-2.156a2 2 0 0 1 .85-.894c.417-.222.962-.222 2.053-.222h3.504c1.09 0 1.636 0 2.053.222.366.196.664.51.85.894.213.438.213 1.01.213 2.156v.41c0 1.145 0 1.718-.212 2.155a2 2 0 0 1-.851.894c-.417.223-.962.223-2.053.223h-3.504c-1.09 0-1.636 0-2.053-.223a2 2 0 0 1-.85-.894c-.213-.437-.213-1.01-.213-2.156v-.409Zm4.867.205a1.558 1.558 0 1 1-3.115 0 1.558 1.558 0 0 1 3.115 0Z"/>
    </svg>
  );
}

function IconGocoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </svg>
  );
}

function IconWorkspace() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v1" />
      <rect x="2" y="8" width="20" height="13" rx="2" />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconMCP() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M21.645 4.132A15.45 15.45 0 0 0 11 0C6.915 0 3.189 1.563.355 4.132c-.476.431-.467 1.18-.013 1.636l1.502 1.512A13.28 13.28 0 0 1 11 3.336c3.587 0 6.83 1.508 9.157 3.944l1.502-1.512c.453-.455.462-1.205-.014-1.636Zm-3.399 5.064A11.28 11.28 0 0 0 11 6.076c-2.838 0-5.403 1.195-7.246 3.12l2.193 2.197a7.28 7.28 0 0 1 5.053-2.174c1.982 0 3.771.832 5.054 2.174l2.192-2.197ZM11.803 15.662l2.34-2.348A5.28 5.28 0 0 0 11 11.958a5.28 5.28 0 0 0-3.143 1.356l2.34 2.348a.83.83 0 0 0 1.206 0h.4Z"/>
    </svg>
  );
}

function IconHooks() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.048 10.438c.943 0 1.717.697 1.797 1.587l.004.15v2.088c0 .91-.723 1.656-1.644 1.733L5.048 16H2.884c-.943 0-1.716-.697-1.797-1.586l-.004-.151v-2.088c0-.909.723-1.655 1.644-1.733l.157-.004h2.164Zm7.576 0c.943 0 1.716.697 1.797 1.587l.004.15v2.088c0 .91-.723 1.656-1.645 1.733l-.156.004h-2.165c-.942 0-1.716-.697-1.796-1.586l-.005-.151v-2.088c0-.909.723-1.655 1.644-1.733l.157-.004h2.164Zm7.575 0c.943 0 1.717.697 1.797 1.587l.004.15v2.088c0 .91-.723 1.656-1.644 1.733L20.199 16h-2.164c-.943 0-1.717-.697-1.797-1.586l-.004-.151v-2.088c0-.909.723-1.655 1.644-1.733l.156-.004h2.165ZM5.048 11.825H2.884a.36.36 0 0 0-.355.28l-.008.07v2.088c0 .167.127.31.292.342l.071.008h2.165a.36.36 0 0 0 .355-.281l.008-.07v-2.087a.35.35 0 0 0-.292-.342l-.072-.008Zm7.576 0h-2.165a.36.36 0 0 0-.355.28l-.009.07v2.088c0 .167.127.31.292.342l.072.008h2.164a.36.36 0 0 0 .355-.281l.009-.07v-2.087a.35.35 0 0 0-.292-.342l-.071-.008Zm7.575 0h-2.164a.36.36 0 0 0-.355.28l-.009.07v2.088c0 .167.127.31.292.342l.072.008h2.164a.36.36 0 0 0 .355-.281l.009-.07v-2.087a.35.35 0 0 0-.292-.342l-.072-.008ZM16.953 0c1.53 0 2.786 1.15 2.879 2.606l.004.175v4.175a.72.72 0 0 1-.719.693.72.72 0 0 1-.71-.591l-.009-.102V2.78c0-.725-.575-1.32-1.306-1.386l-.14-.008H6.131c-.753 0-1.37.554-1.437 1.26l-.009.134v3.022l2.02-1.945.09-.074a.72.72 0 0 1 .925.074.67.67 0 0 1 .076.893l-.076.086-3.246 3.131-.089.074a.72.72 0 0 1-.837 0l-.089-.074L.212 4.836l-.076-.085a.67.67 0 0 1 0-.808l.076-.085.089-.074a.72.72 0 0 1 .837 0l.089.074 2.02 1.944V2.781C3.248 1.305 4.44.094 5.949.004L6.131 0h10.822Z"/>
    </svg>
  );
}

function IconLogs() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h5" />
    </svg>
  );
}

function IconConfig() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Nav link item ─────────────────────────────────────────────────────────────

const navLinkBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'background 0.18s ease, color 0.18s ease',
  cursor: 'pointer',
};

const navLinkActive: CSSProperties = {
  ...navLinkBase,
  color: 'var(--text-primary)',
  background: 'var(--border-glass)',
};

const navLinkHoverClass = 'nav-link-hover';

interface NavItemProps {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}

function NavItem({ to, active, icon, label }: NavItemProps) {
  return (
    <Link
      to={to}
      className={`${navLinkHoverClass}${active ? ' active' : ''}`}
      style={active ? navLinkActive : navLinkBase}
    >
      {icon}
      {label}
    </Link>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

function DashboardNav() {
  const location = useLocation();
  const p = location.pathname;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  const items: { to: string; icon: ReactNode; label: string }[] = [
    { to: '/',          icon: <IconDashboard />, label: 'Dashboard' },
    { to: '/tools',     icon: <IconTools />,     label: 'Tools' },
    { to: '/plugins',   icon: <IconPlugins />,   label: 'Plugins' },
    { to: '/soul',      icon: <IconSoul />,      label: 'System Prompt' },
    { to: '/memory',    icon: <IconMemory />,    label: 'Memory' },
    { to: '/conversations', icon: <IconConversations />, label: 'Chats' },
    { to: '/wallet',        icon: <IconWallet />,        label: 'Wallet' },
    { to: '/gocoon',        icon: <IconGocoon />,        label: 'Gocoon' },
    { to: '/workspace', icon: <IconWorkspace />, label: 'Workspace' },
    { to: '/tasks',     icon: <IconTasks />,     label: 'Tasks' },
    { to: '/mcp',       icon: <IconMCP />,       label: 'MCP' },
    { to: '/hooks',     icon: <IconHooks />,     label: 'Hooks' },
    { to: '/logs',      icon: <IconLogs />,      label: 'Logs' },
    { to: '/config',    icon: <IconConfig />,    label: 'Config' },
  ];

  return (
    <>
      {/* Hover styles injected once */}
      <style>{`
        .nav-link-hover:hover:not(.active) {
          color: var(--text-primary) !important;
          background: var(--bg-glass-hover) !important;
        }
        .nav-link-hover svg {
          flex-shrink: 0;
          opacity: 0.7;
          transition: opacity 0.18s ease;
        }
        .nav-link-hover.active svg,
        .nav-link-hover:hover svg {
          opacity: 1;
        }
      `}</style>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {items.map(({ to, icon, label }) => (
          <NavItem key={to} to={to} active={p === to} icon={icon} label={label} />
        ))}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
        <div style={{ marginBottom: '6px' }}>
          <AgentStatusBadge />
        </div>
        <ModeSwitch />
        <div style={{ margin: '6px 0', padding: '0 4px' }}>
          <AgentControl />
        </div>

        <div style={{ padding: '0 4px 4px' }}>
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
  return <Shell sidebar={<DashboardNav />} topRight={<ThemeToggle />} />;
}
