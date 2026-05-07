export const ALLOWED_ACTIONS = new Set([
  // Apps e navegação
  'jarvis:open_app',
  'jarvis:open_url',
  'jarvis:open_vscode',

  // Arquivos e diretórios
  'jarvis:list_dir',
  'jarvis:file_search',
  'jarvis:organize_downloads',
  'jarvis:create_project_folder',

  // Sistema
  'jarvis:get_system_info',
  'jarvis:screenshot',
  'jarvis:notify',
  'jarvis:clipboard_read',
  'jarvis:clipboard_write',

  // Git
  'jarvis:git_status',
  'jarvis:git_log',
  'jarvis:git_branch',
  'jarvis:git_commit',

  // Terminal
  'jarvis:run_command',
  'jarvis:run_tests',
  'jarvis:inspect_schema',

  // Docker
  'jarvis:docker_ps',
  'jarvis:docker_start',
  'jarvis:docker_stop',

  // Infraestrutura do notebook
  'jarvis:restart_api',

  // Outlook
  'jarvis:read_emails',
  'jarvis:send_email',
  'jarvis:get_calendar',
])
