'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiUrlInputDefault, setApiUrl } from '../../lib/api-url'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [apiUrl, setApiUrlInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setApiUrlInput(getApiUrlInputDefault())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || !apiUrl.trim()) return
    setLoading(true)
    setError('')
    const resolvedApiUrl = setApiUrl(apiUrl)

    try {
      const res = await fetch(`${resolvedApiUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ password }),
      })

      if (res.status === 401) {
        setError('Senha incorreta')
        return
      }
      if (!res.ok) {
        setError('Erro ao conectar com a API')
        return
      }

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
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100">Rayzen AI</h1>
          <p className="text-zinc-500 text-sm mt-1">Acesso pessoal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrlInput(e.target.value)}
            placeholder="https://api-seu-rayzen.ngrok-free.app"
            className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-600"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            autoFocus
            className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-600"
          />

          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim() || !apiUrl.trim()}
            className="w-full bg-zinc-100 text-zinc-900 rounded-xl py-3 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}
