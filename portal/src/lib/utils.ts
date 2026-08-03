import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const DATE_FMT = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

const DATE_ONLY = new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })

export function formatDateTime(d: Date | string | number | null | undefined): string {
  if (!d) return '-'
  return DATE_FMT.format(new Date(d))
}

export function formatDate(d: Date | string | number | null | undefined): string {
  if (!d) return '-'
  return DATE_ONLY.format(new Date(d))
}

export function daysSince(d: Date | string | number | null | undefined): number | null {
  if (!d) return null
  const ms = Date.now() - new Date(d).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
