import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

interface ShellProps {
  sidebar: ReactNode;
  children?: ReactNode;
}

export function Shell({ sidebar, children }: ShellProps) {
  return (
    <div className="container">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/logo_dark.png" alt="Teleton" style={{ height: '64px' }} />
        </div>
        {sidebar}
      </aside>
      <main className="main">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
