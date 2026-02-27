interface PillBarProps {
  tabs: Array<{ id: string; label: string }>;
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function PillBar({ tabs, activeTab, onTabChange }: PillBarProps) {
  return (
    <div className="pill-bar">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={t.id === activeTab ? "active" : undefined}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
