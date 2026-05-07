'use client'

const API_URL_STORAGE_KEY = 'rayzen_api_url'
const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101'

function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function shouldUseLocalDefault(): boolean {
  if (typeof window === 'undefined') return true

  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function getApiUrl(): string {
  if (typeof window === 'undefined') return normalizeApiUrl(DEFAULT_API_URL)

  const stored = window.localStorage.getItem(API_URL_STORAGE_KEY)
  if (stored && stored.trim()) return normalizeApiUrl(stored)
  return shouldUseLocalDefault() ? normalizeApiUrl(DEFAULT_API_URL) : ''
}

export function setApiUrl(value: string): string {
  const fallback = shouldUseLocalDefault() ? DEFAULT_API_URL : ''
  const normalized = normalizeApiUrl(value || fallback)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(API_URL_STORAGE_KEY, normalized)
  }
  return normalized
}

export function getApiUrlInputDefault(): string {
  return getApiUrl()
}

export const API_URL = {
  [Symbol.toPrimitive]: () => getApiUrl(),
  toString: () => getApiUrl(),
} as unknown as string
