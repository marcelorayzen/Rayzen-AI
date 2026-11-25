'use client'

export const TOKEN_KEY = 'rayzen_token'

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'ngrok-skip-browser-warning': 'true',
    ...(extra ?? {}),
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function requestJson<T = unknown>(
  url: string,
  init?: {
    method?: string
    body?: string
    headers?: Record<string, string>
  },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method,
    body: init?.body,
    headers: authHeaders({
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    }),
  })

  if (!res.ok) {
    let body: unknown
    try { body = await res.json() } catch { /* no json body */ }
    const message = (body as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`
    throw new ApiError(res.status, message, body)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return res.text() as unknown as T
}
