export const ALLOWED_ACTIONS = new Set([
  // Apps e navegação
  'jarvis:open_app',
  'jarvis:open_url',
  'jarvis:open_vscode',
  'jarvis:browse_and_screenshot',

  // Arquivos e diretórios
  'jarvis:list_dir',
  'jarvis:file_search',
  'jarvis:file_read',
  'jarvis:file_write',
  'jarvis:file_delete',
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
  'jarvis:git_diff',
  'jarvis:git_branch',
  'jarvis:git_add',
  'jarvis:git_commit',
  'jarvis:git_pull',
  'jarvis:git_push',

  // Terminal inteligente (regex-based, path-guarded)
  'jarvis:run_command',

  // Testes e QA
  'jarvis:run_tests',
  'jarvis:inspect_schema',
  'jarvis:parse_test_report',
  'jarvis:get_qa_summary',
  'jarvis:get_data_quality',
  'jarvis:capture_test_failure',

  // Prisma
  'jarvis:prisma_generate',
  'jarvis:prisma_migrate',

  // Docker
  'jarvis:docker_ps',
  'jarvis:docker_start',
  'jarvis:docker_stop',
  'jarvis:docker_logs',

  // Infraestrutura do servidor
  'jarvis:restart_api',

  // Outlook
  'jarvis:read_emails',
  'jarvis:send_email',
  'jarvis:get_calendar',

  // Graphify — análise de grafo de código (desktop apenas)
  'jarvis:run_graphify',
  'jarvis:graphify_sync',

  // Guardian — análise proativa de mudanças de código
  'jarvis:guardian_analyze',

  // Supervisor — sessão autônoma Claude Code
  'jarvis:supervised_session',
])
