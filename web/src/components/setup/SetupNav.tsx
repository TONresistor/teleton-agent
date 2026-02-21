import { STEPS, useSetup } from './SetupContext';

export function SetupNav() {
  const { step } = useSetup();

  return (
    <div className="step-indicator">
      {STEPS.map((s, idx) => {
        const completed = idx < step;
        const active = idx === step;

        return (
          <div key={s.id} className="step-cell">
            <div className="step-cell-top">
              <div className={`step-dot${active ? ' active' : ''}${completed ? ' completed' : ''}`}>
                {completed ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`step-line${completed ? ' completed' : ''}`} />
              )}
            </div>
            <div className={`step-label${active ? ' active' : ''}${completed ? ' completed' : ''}`}>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
