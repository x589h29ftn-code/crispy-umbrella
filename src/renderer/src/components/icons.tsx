interface IconProps {
  size?: number
  className?: string
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function IconMore({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      {[5, 12, 19].map((x) => (
        <circle key={x} cx={x} cy="12" r="1.7" fill="currentColor" />
      ))}
    </svg>
  )
}

export function IconCheck({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12.5l5 5L20 6" />
    </svg>
  )
}

export function IconRotate({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12a8 8 0 1 1 2.5 5.8" />
      <path d="M4 17.5V13h4.5" />
    </svg>
  )
}

export function IconClose({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconPlus({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconMinus({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconHash({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 4L7 20M17 4l-2 16M4 9h16M3.4 15h16" />
    </svg>
  )
}

export function IconStamp({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 14V9a3 3 0 0 1 6 0v5" />
      <rect x="6" y="14" width="12" height="4" rx="1.2" />
      <path d="M4 21h16" />
    </svg>
  )
}

export function IconChevronLeft({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function IconChevronRight({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function IconLock({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function IconSignature({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 17c2-1 3-3 3.5-5C7 9.5 8 8 9 9s.3 3.5-.5 5c1.2-.6 3-2.3 4-3.5 1.3-1.6 2.3-1 2 .5-.3 1.4-.2 2.6 1.5 2 1.2-.4 2-1.2 3-2" />
      <path d="M3 20.5h18" />
    </svg>
  )
}

export function IconGrip({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      {[8, 16].flatMap((x) => [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  )
}

export function IconUpload({ size = 24, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function IconSun({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  )
}

export function IconMoon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
    </svg>
  )
}

export function IconFolderOpen({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 8V6a1.5 1.5 0 0 1 1.5-1.5H9l2 2h8A1.5 1.5 0 0 1 20.5 8" />
      <path d="M3 8h18l-2 10.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18.5z" />
    </svg>
  )
}
