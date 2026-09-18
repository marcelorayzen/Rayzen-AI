import 'dotenv/config'
import { poll } from './poller'
import { startWorkspaceWatcher } from './workspace-watcher'
import { startDeployDriftSensor } from './deploy-drift-sensor'

const INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 3000)
const ROLE = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'

console.log(`Rayzen ${ROLE} Agent iniciado`)
console.log(`Polling a cada ${INTERVAL_MS}ms → ${process.env.AGENT_API_URL}`)

// Inicia o loop de polling
setInterval(poll, INTERVAL_MS)
poll() // primeira execução imediata

// Captura agnostica de atividade do workspace.
// Complementa hooks especificos como Claude Code e tambem cobre Codex, VS Code e terminal comum.
startWorkspaceWatcher()

// "Build feito, troca nao": o deploy constroi a imagem e nao recria o container, e tudo
// fica `Up (healthy)` com o codigo velho no ar. Aconteceu em 17/08 e de novo em 10/09.
// So sobe no agent-server, unico que tem docker.sock e o repositorio montado.
startDeployDriftSensor()
