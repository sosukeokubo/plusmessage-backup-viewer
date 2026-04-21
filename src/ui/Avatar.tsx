import type { ResolvedContact } from '../util/contactResolver';

interface Props {
  contact: ResolvedContact;
  size?: number;
}

export function Avatar({ contact, size = 40 }: Props) {
  const bg =
    contact.kind === 'named'
      ? 'var(--accent-weak)'
      : contact.kind === 'group'
        ? 'var(--bg-sunken)'
        : contact.kind === 'phone'
          ? 'var(--bubble-in)'
          : 'var(--bg-sunken)';
  const fg = contact.kind === 'named' ? 'var(--accent)' : 'var(--text-muted)';

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.45),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {contact.avatarInitial}
    </span>
  );
}
