import open from 'open'

const ALLOWED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'github.com',
  'google.com',
  'notion.so',
  'gmail.com',
  'outlook.com',
  'linkedin.com',
  'spotify.com',
]

export async function openUrl(payload: { url: string }) {
  let { url } = payload

  // Garante protocolo https
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }

  const parsed = new URL(url)
  const hostname = parsed.hostname.replace(/^www\./, '')

  const allowed = ALLOWED_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith('.' + d),
  )

  if (!allowed) {
    throw new Error(`Domínio não permitido: ${hostname}. Permitidos: ${ALLOWED_DOMAINS.join(', ')}`)
  }

  await open(url)
  return { opened: url }
}
