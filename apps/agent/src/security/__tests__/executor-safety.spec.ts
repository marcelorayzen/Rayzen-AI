import { ALLOWED_ACTIONS } from '../whitelist'
import { isActionAllowedForRole } from '../../role-policy'

// Tests whitelist + role-policy directly — avoids importing executor.ts which
// transitively imports ESM-only packages (open, etc.) incompatible with Jest/CJS transform.

describe('ALLOWED_ACTIONS + isActionAllowedForRole — enforcement matrix', () => {
  it('rejeita ação não whitelistada independentemente do role', () => {
    const malicious = ['jarvis:exec', 'jarvis:spawn', 'jarvis:rm_rf', 'system:shutdown', 'admin:drop_db']
    for (const action of malicious) {
      expect(ALLOWED_ACTIONS.has(action)).toBe(false)
    }
  })

  it('desktop não pode executar ações de servidor (docker, restart_api)', () => {
    const serverOnly = ['jarvis:docker_ps', 'jarvis:docker_start', 'jarvis:docker_stop', 'jarvis:docker_logs', 'jarvis:restart_api']
    for (const action of serverOnly) {
      expect(isActionAllowedForRole('desktop', action)).toBe(false)
    }
  })

  it('server não pode executar ações de desktop (screenshot, clipboard, git_commit)', () => {
    const desktopOnly = ['jarvis:screenshot', 'jarvis:clipboard_read', 'jarvis:git_commit', 'jarvis:open_app', 'jarvis:notify']
    for (const action of desktopOnly) {
      expect(isActionAllowedForRole('server', action)).toBe(false)
    }
  })

  it('server pode executar suas ações autorizadas', () => {
    expect(isActionAllowedForRole('server', 'jarvis:docker_ps')).toBe(true)
    expect(isActionAllowedForRole('server', 'jarvis:restart_api')).toBe(true)
    expect(isActionAllowedForRole('server', 'jarvis:docker_logs')).toBe(true)
    expect(isActionAllowedForRole('server', 'jarvis:get_data_quality')).toBe(true)
  })

  it('desktop pode executar suas ações autorizadas', () => {
    expect(isActionAllowedForRole('desktop', 'jarvis:screenshot')).toBe(true)
    expect(isActionAllowedForRole('desktop', 'jarvis:run_tests')).toBe(true)
    expect(isActionAllowedForRole('desktop', 'jarvis:git_status')).toBe(true)
    expect(isActionAllowedForRole('desktop', 'jarvis:parse_test_report')).toBe(true)
  })

  it('ações de risco alto/médio estão na whitelist mas não executam sem dryRun validado', () => {
    // Garante que estão presentes — o runtime valida dryRun
    const risky = ['jarvis:git_commit', 'jarvis:docker_stop', 'jarvis:organize_downloads', 'jarvis:send_email']
    for (const action of risky) {
      expect(ALLOWED_ACTIONS.has(action)).toBe(true)
    }
  })

  it('graphify_sync está disponível apenas para desktop', () => {
    expect(isActionAllowedForRole('desktop', 'jarvis:run_graphify')).toBe(true)
    expect(isActionAllowedForRole('server', 'jarvis:run_graphify')).toBe(false)
  })
})
