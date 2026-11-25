import open from 'open'

const ALLOWED_APPS = ['code', 'chrome', 'firefox', 'notion', 'slack']

export async function openApp(payload: { app: string }) {
  const app = payload.app.toLowerCase()
  if (!ALLOWED_APPS.includes(app)) throw new Error(`App nao permitido: ${app}`)
  await open(app)
  return { opened: app }
}
