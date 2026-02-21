interface Step {
  id: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="step-indicator">
      {steps.map((step, idx) => {
        const completed = idx < current;
        const active = idx === current;
        const isLast = idx === steps.length - 1;

        return (
          <div key={step.id} className="step-cell" style={isLast ? { flex: '0 0 auto' } : undefined}>
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
              {!isLast && <div className={`step-line${completed ? ' completed' : ''}`} />}
            </div>
            <span className={`step-label${active ? ' active' : ''}${completed ? ' completed' : ''}`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
