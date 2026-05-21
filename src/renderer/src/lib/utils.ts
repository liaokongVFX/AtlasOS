import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'https://example.com'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^localhost(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`
  if (/^\d+\.\d+\.\d+\.\d+(:|\/|$)/.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}
