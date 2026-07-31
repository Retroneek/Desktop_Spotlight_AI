type IconProps = {
  className?: string;
};

export function CollapseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 3.5 5.5 8l4 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function NewChatIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.6 2.2h2.8l.35 1.52c.35.12.69.27 1 .46l1.42-.67 1.4 2.42-1.06 1.02c.04.19.06.39.06.6s-.02.41-.06.6l1.06 1.02-1.4 2.42-1.42-.67c-.31.19-.65.34-1 .46l-.35 1.52H6.6l-.35-1.52a4.74 4.74 0 0 1-1-.46l-1.42.67-1.4-2.42 1.06-1.02A3.4 3.4 0 0 1 3.43 8c0-.21.02-.41.06-.6L2.43 6.38l1.4-2.42 1.42.67c.31-.19.65-.34 1-.46L6.6 2.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.85" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function AttachIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.9 8.1 9.6 4.4a2.15 2.15 0 1 1 3.05 3.05L7.8 12.3a3.2 3.2 0 1 1-4.55-4.55l5.1-5.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.2 7.8 13.5 2.9l-3.9 10.2-2.1-3.2-5.3-2.1Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M13.45 2.95 7.4 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.3" y="4.7" width="7" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 4.7V3.8A1.5 1.5 0 0 0 9 2.3H4.2a1.5 1.5 0 0 0-1.5 1.5v5.4a1.5 1.5 0 0 0 1.5 1.5h1.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v7.1m0 0 2.7-2.7M8 9.6 5.3 6.9M3 12.5v.7c0 .45.35.8.8.8h8.4c.45 0 .8-.35.8-.8v-.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  );
}

export function RegenerateIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.7 6.3A5.1 5.1 0 1 0 13 9.5M12.7 2.8v3.5H9.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  );
}

export function EditIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.1 11.3-.7 2.3 2.3-.7 7.2-7.2a1.35 1.35 0 0 0-1.9-1.9l-7.2 7.5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
      <path d="m8.9 4.9 2.1 2.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
