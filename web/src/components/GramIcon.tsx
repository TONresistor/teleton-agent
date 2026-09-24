import gramLogo from '../assets/gram-logo.svg';

export function GramIcon({ className }: { className?: string }) {
  return <img className={className} src={gramLogo} alt="" aria-hidden="true" />;
}
