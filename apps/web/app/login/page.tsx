'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setApiUrl, getApiUrl } from '../../lib/api-url'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const router = useRouter()

  // Switch to glow-pulse after the scanline finishes (0.3s delay + 2.5s sweep + 0.1s buffer)
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 2900)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError('')
    const resolvedApiUrl = setApiUrl(getApiUrl())

    try {
      const res = await fetch(`${resolvedApiUrl}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })
      if (res.status === 401) { setError('Senha incorreta'); return }
      if (!res.ok)            { setError('Erro ao conectar com a API'); return }

      const { token } = await res.json() as { token: string }
      localStorage.setItem('rayzen_token', token)
      document.cookie = `rayzen_token=${token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`
      router.push('/')
    } catch {
      setError('Erro ao conectar com a API')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-root">
      {/* Hero image */}
      <div className={`login-hero${done ? ' login-hero--done' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rayzen.animado.png" alt="Rayzen AI" />
      </div>

      {/* Scanline sweep */}
      <div className="login-scanline" aria-hidden="true" />

      {/* Bottom vignette so form is always readable */}
      <div className="login-vignette" aria-hidden="true" />

      {/* Login form — always interactive, floats above animations */}
      <div className="login-form-wrap">
        <p className="login-subtitle">Acesso pessoal</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            autoFocus
            className="login-input"
          />
          {error && <p className="login-error">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="login-btn"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}
