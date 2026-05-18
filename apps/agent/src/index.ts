import 'dotenv/config'
import { poll } from './poller'

const INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 3000)
const ROLE = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'

console.log(`Rayzen ${ROLE} Agent iniciado`)
console.log(`Polling a cada ${INTERVAL_MS}ms → ${process.env.AGENT_API_URL}`)

// Inicia o loop de polling
setInterval(poll, INTERVAL_MS)
poll() // primeira execução imediata
