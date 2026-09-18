import { AgentRole } from '@rayzen/types'

const DESKTOP_ACTIONS = new Set([
  'jarvis:open_app',
  'jarvis:open_url',
  'jarvis:open_vscode',
  'jarvis:browse_and_screenshot',
  'jarvis:list_dir',
  'jarvis:file_search',
  'jarvis:organize_downloads',
  'jarvis:create_project_folder',
  'jarvis:get_system_info',
  'jarvis:screenshot',
  'jarvis:notify',
  'jarvis:clipboard_read',
  'jarvis:clipboard_write',
  'jarvis:git_status',
  'jarvis:git_log',
  'jarvis:git_branch',
  'jarvis:git_commit',
  'jarvis:run_command',
  'jarvis:run_tests',
  'jarvis:inspect_schema',
  'jarvis:read_emails',
  'jarvis:send_email',
  'jarvis:get_calendar',
  'jarvis:parse_test_report',
  'jarvis:capture_test_failure',
  'jarvis:run_graphify',
  'jarvis:graphify_sync',
  'jarvis:guardian_analyze',
  'jarvis:supervised_session',
  'jarvis:file_read',
  'jarvis:file_write',
  'jarvis:file_delete',
  'jarvis:git_diff',
  'jarvis:git_add',
  'jarvis:git_pull',
  'jarvis:git_push',
  'jarvis:prisma_generate',
  'jarvis:prisma_migrate',
])

const SERVER_ACTIONS = new Set([
  'jarvis:docker_ps',
  'jarvis:docker_start',
  'jarvis:docker_stop',
  'jarvis:docker_logs',
  'jarvis:restart_api',
  'jarvis:run_command',
  'jarvis:get_qa_summary',
])

export function isActionAllowedForRole(role: AgentRole, key: string): boolean {
  return role === 'server' ? SERVER_ACTIONS.has(key) : DESKTOP_ACTIONS.has(key)
}

/**
 * Escopo por role das capabilities da Fase 2 (`docs/plano-execucao-tipada.md`) — mesmo
 * padrão AND de `isActionAllowedForRole`, testado em `composicao-de-camadas.spec.ts`: estar
 * em `ALLOWED_CAPABILITIES` (security/whitelist.ts) não basta, e estar aqui sem estar lá
 * também não. As duas listas precisam concordar, cada uma por um motivo diferente — a
 * primeira diz "isso existe", esta diz "para este papel".
 *
 * `docker.*` entra nos dois papéis porque as ações típadas equivalentes já migradas na
 * Fase 1 (`jarvis:docker_ps`, `docker_logs`) também estão nos dois — um role que já podia
 * ler status/log de container continua podendo, só que agora com mais forma (`images`,
 * `inspect`, `compose ps/logs/config`).
 */
const DESKTOP_CAPABILITIES = new Set([
  'docker.images', 'docker.stats', 'docker.inspect',
  'docker.compose_ps', 'docker.compose_logs', 'docker.compose_config',
])

const SERVER_CAPABILITIES = new Set([
  'docker.images', 'docker.stats', 'docker.inspect',
  'docker.compose_ps', 'docker.compose_logs', 'docker.compose_config',
])

export function isCapabilityAllowedForRole(role: AgentRole, capabilityId: string): boolean {
  return role === 'server' ? SERVER_CAPABILITIES.has(capabilityId) : DESKTOP_CAPABILITIES.has(capabilityId)
}
