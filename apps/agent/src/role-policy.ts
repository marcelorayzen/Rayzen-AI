import { AgentRole } from '@rayzen/types'

const DESKTOP_ACTIONS = new Set([
  'jarvis:open_app',
  'jarvis:open_url',
  'jarvis:open_vscode',
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
  'jarvis:get_qa_summary',
  'jarvis:get_data_quality',
  'jarvis:capture_test_failure',
  'jarvis:run_graphify',
])

const SERVER_ACTIONS = new Set([
  'jarvis:docker_ps',
  'jarvis:docker_start',
  'jarvis:docker_stop',
  'jarvis:docker_logs',
  'jarvis:restart_api',
  'jarvis:run_command',
  'jarvis:get_qa_summary',
  'jarvis:get_data_quality',
])

export function isActionAllowedForRole(role: AgentRole, key: string): boolean {
  return role === 'server' ? SERVER_ACTIONS.has(key) : DESKTOP_ACTIONS.has(key)
}
