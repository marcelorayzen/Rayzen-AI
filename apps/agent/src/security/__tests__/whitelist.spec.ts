import { ALLOWED_ACTIONS } from '../whitelist'

describe('whitelist — ALLOWED_ACTIONS', () => {
  // O tamanho exato é intencional: adicionar uma ação exige atualizar este teste,
  // forçando revisão consciente da whitelist (o arquivo mais crítico do agent).
  it('contém exatamente 44 ações', () => {
    expect(ALLOWED_ACTIONS.size).toBe(44)
  })

  it('aceita todas as ações jarvis: documentadas', () => {
    const expected = [
      'jarvis:open_app', 'jarvis:open_url', 'jarvis:open_vscode', 'jarvis:browse_and_screenshot',
      'jarvis:list_dir', 'jarvis:file_search', 'jarvis:file_read', 'jarvis:file_write', 'jarvis:file_delete',
      'jarvis:organize_downloads', 'jarvis:create_project_folder',
      'jarvis:get_system_info', 'jarvis:screenshot', 'jarvis:notify', 'jarvis:clipboard_read', 'jarvis:clipboard_write',
      'jarvis:git_status', 'jarvis:git_log', 'jarvis:git_diff', 'jarvis:git_branch',
      'jarvis:git_add', 'jarvis:git_commit', 'jarvis:git_pull', 'jarvis:git_push',
      'jarvis:run_command', 'jarvis:run_tests', 'jarvis:inspect_schema',
      'jarvis:parse_test_report', 'jarvis:get_qa_summary', 'jarvis:get_data_quality', 'jarvis:capture_test_failure',
      'jarvis:prisma_generate', 'jarvis:prisma_migrate',
      'jarvis:docker_ps', 'jarvis:docker_start', 'jarvis:docker_stop', 'jarvis:docker_logs',
      'jarvis:restart_api',
      'jarvis:read_emails', 'jarvis:send_email', 'jarvis:get_calendar',
      'jarvis:run_graphify', 'jarvis:graphify_sync',
      'jarvis:supervised_session',
    ]
    expect(expected).toHaveLength(ALLOWED_ACTIONS.size) // lista documenta 100% da whitelist
    for (const action of expected) {
      expect(ALLOWED_ACTIONS.has(action)).toBe(true)
    }
  })

  it('rejeita ações arbitrárias não whitelistadas', () => {
    const malicious = [
      'jarvis:exec',
      'jarvis:spawn',
      'jarvis:rm_rf',
      'jarvis:delete_all',
      'jarvis:run_script',
      'system:shutdown',
      'admin:drop_db',
      '',
      'jarvis:', // prefixo sem ação
    ]
    for (const action of malicious) {
      expect(ALLOWED_ACTIONS.has(action)).toBe(false)
    }
  })

  it('rejeita ações com espaços ou casing diferente', () => {
    expect(ALLOWED_ACTIONS.has('jarvis:Run_Command')).toBe(false)
    expect(ALLOWED_ACTIONS.has('JARVIS:run_command')).toBe(false)
    expect(ALLOWED_ACTIONS.has('jarvis:run_command ')).toBe(false)
    expect(ALLOWED_ACTIONS.has(' jarvis:run_command')).toBe(false)
  })
})
