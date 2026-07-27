import { ReactNode } from 'react';
import { Outlet } from 'react-router';

interface ShellProps {
  sidebar: ReactNode;
  children?: ReactNode;
  topRight?: ReactNode;
}

const SIDEBAR_WIDTH = 260;
const SIDEBAR_MARGIN = 12;

export function Shell({ sidebar, children, topRight }: ShellProps) {
  return (
    <div
      className="container"
      style={{ position: 'relative', alignItems: 'stretch' }}
    >
      {topRight && <div className="shell-topright">{topRight}</div>}
      {/* Floating glass sidebar */}
      <aside
        className="sidebar"
        style={{
          width: `${SIDEBAR_WIDTH}px`,
          flexShrink: 0,
          position: 'sticky',
          top: `${SIDEBAR_MARGIN}px`,
          height: `calc(100vh - ${SIDEBAR_MARGIN * 2}px)`,
          margin: `${SIDEBAR_MARGIN}px 0 ${SIDEBAR_MARGIN}px ${SIDEBAR_MARGIN}px`,
          borderRadius: 'var(--radius-card)',
          background: 'var(--bg-secondary)',
          backdropFilter: 'blur(40px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.4)',
          border: '1px solid var(--border-glass)',
          // Reset styles that come from .sidebar CSS class
          borderRight: 'none',
          padding: '14px 10px',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div className="sidebar-brand">
          <img src="/logo_dark.png" alt="Teleton" style={{ height: '72px' }} />
        </div>
        {sidebar}
      </aside>

      {/* Main content — offset to account for sidebar + its margins */}
      <main
        className="main"
        style={{ marginLeft: 0 }}
      >
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
