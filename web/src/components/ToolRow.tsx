import { ToolInfo } from '../lib/api';

interface ToolRowProps {
  tool: ToolInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
}

export function ToolRow({ tool, updating, onToggle, onScope }: ToolRowProps) {
  return (
    <div
      className="tool-row"
      style={{
        opacity: tool.enabled ? 1 : 0.5,
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: '10px',
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="tool-name">{tool.name}</div>
        <div className="tool-desc">{tool.description}</div>
      </div>

      <div className={`scope-seg${!tool.enabled || updating === tool.name ? ' disabled' : ''}`}>
        {(['always', 'dm-only', 'group-only', 'admin-only'] as const).map((s) => (
          <button
            key={s}
            className={tool.scope === s ? 'active' : ''}
            disabled={!tool.enabled || updating === tool.name}
            onClick={() => onScope(tool.name, s)}
          >
            {s === 'always' ? 'All' : s === 'dm-only' ? 'DM' : s === 'group-only' ? 'Group' : 'Admin'}
          </button>
        ))}
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={tool.enabled}
          onChange={() => onToggle(tool.name, tool.enabled)}
          disabled={updating === tool.name}
        />
        <span className="toggle-track" />
        <span className="toggle-thumb" />
      </label>
    </div>
  );
}
