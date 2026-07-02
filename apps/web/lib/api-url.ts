'use client'

const API_URL_STORAGE_KEY = 'rayzen_api_url'
const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101'
// V2 roda sob prefixo /v2. Em produção a base já é api.rayzen.com.br → `${base}/v2`
// resolve via Caddy. Localmente o V1 é :3101 e o V2 :3103 — daí o override dedicado.
const DEFAULT_API_V2_URL = process.env.NEXT_PUBLIC_API_V2_URL ?? ''

function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

// Cache em memória — getApiUrl() é chamado em toda coerção de API_URL/V2_URL (cada fetch).
// Ler localStorage a cada chamada era desperdício; invalidamos só quando setApiUrl muda.
let cachedApiUrl: string | null = null

export function getApiUrl(): string {
  if (typeof window === 'undefined') return normalizeApiUrl(DEFAULT_API_URL)
  if (cachedApiUrl !== null) return cachedApiUrl

  const stored = window.localStorage.getItem(API_URL_STORAGE_KEY)
  cachedApiUrl = (stored && stored.trim()) ? normalizeApiUrl(stored) : normalizeApiUrl(DEFAULT_API_URL)
  return cachedApiUrl
}

export function setApiUrl(value: string): string {
  const normalized = normalizeApiUrl(value || DEFAULT_API_URL)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(API_URL_STORAGE_KEY, normalized)
  }
  cachedApiUrl = normalized
  return normalized
}

export function getApiUrlInputDefault(): string {
  return getApiUrl()
}

// Base da API V2 (sob /v2). Override explícito > `${baseV1}/v2`.
export function getV2Url(): string {
  if (DEFAULT_API_V2_URL.trim()) return normalizeApiUrl(DEFAULT_API_V2_URL)
  return `${getApiUrl()}/v2`
}

export const API_URL = {
  [Symbol.toPrimitive]: () => getApiUrl(),
  toString: () => getApiUrl(),
} as unknown as string

export const V2_URL = {
  [Symbol.toPrimitive]: () => getV2Url(),
  toString: () => getV2Url(),
} as unknown as string
