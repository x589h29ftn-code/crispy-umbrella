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

export function IconRotateLeft({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

export function IconRotateRight({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

export function IconDuplicate({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 4H6a2 2 0 0 0-2 2v10" />
    </svg>
  )
}

export function IconTrash({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7h16M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6.5 7l1 12.2A1.8 1.8 0 0 0 9.3 20.8h5.4a1.8 1.8 0 0 0 1.8-1.6L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconUndo({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12" />
    </svg>
  )
}

export function IconRedo({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12" />
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

export function IconCalendar({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
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

export function IconHighlighter({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.5 17.5L4 20l2.5-5.5L15.5 5.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8z" />
      <path d="M13.5 7.5l3 3" />
    </svg>
  )
}

export function IconType({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6" />
    </svg>
  )
}

export function IconPrinter({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 8V3.5h10V8M7 17H4.5a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H17" />
      <rect x="7" y="14.5" width="10" height="6" rx="1" />
    </svg>
  )
}

export function IconCopy({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5H6a2 2 0 0 0-2 2v9" />
    </svg>
  )
}

export function IconUnderline({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6.5 4v7a5.5 5.5 0 0 0 11 0V4M5 20.5h14" />
    </svg>
  )
}

export function IconStrike({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 6.5c.8-1.7 2.6-2.5 5-2.5 2.9 0 4.6 1.3 5 3M17 15.5c0 2.8-2.2 4.5-5 4.5-2.6 0-4.4-1-5-3M4 12h16" />
    </svg>
  )
}

export function IconGridView({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  )
}

export function IconTab({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h17M9 5v4.5" />
    </svg>
  )
}

export function IconComment({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.33-3.9-.92L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z" />
    </svg>
  )
}

export function IconRedact({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <rect x="6.5" y="10" width="11" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconEditText({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7V4.5h11V7M9.5 4.5v12M7 16.5h5" />
      <path d="M14.5 19.5l6-6-2-2-6 6-.6 2.6z" />
    </svg>
  )
}

export function IconFilePlus({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M13 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" />
      <path d="M13 3.5V9h5.5M12 12.5v5M9.5 15h5" />
    </svg>
  )
}

export function IconSearch({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  )
}

export function IconPen({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 20c4-1 4.5-2.2 5-4.5.4-1.8 1.6-2.8 3-2.5s2 1.7 1.5 3c-.8 2.2.5 3 2.5 2s3-2.5 4-5c1.2-3-.5-6.5-3.5-7.5S10 6 8.5 9 4 20 4 20z" />
    </svg>
  )
}

export function IconEraser({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7.5 20l-4-4a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1L11.5 20z" />
      <path d="M6.5 11l6.5 6.5M7.5 20H20" />
    </svg>
  )
}

export function IconCursor({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5.5 3.5l14 6.5-6 2-2 6z" />
    </svg>
  )
}

export function IconDownload({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 4v10M7 9.5l5 5 5-5" />
      <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

export function IconArchive({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1" />
      <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
    </svg>
  )
}

export function IconChevronDown({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 9l7 7 7-7" />
    </svg>
  )
}

export function IconPanelLeft({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
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

export function IconShapes({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M8.5 3.5l4.5 7.5H4z" />
      <circle cx="16.5" cy="16" r="4.5" />
      <rect x="3.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </svg>
  )
}
