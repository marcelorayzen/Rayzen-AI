import { Task } from '@rayzen/types'
import { ALLOWED_ACTIONS } from './security/whitelist'
import { openApp } from './actions/open-app'
import { openUrl } from './actions/open-url'
import { openVscode } from './actions/open-vscode'
import { listDir } from './actions/list-dir'
import { fileSearch } from './actions/file-search'
import { fileRead, fileWrite, fileDelete } from './actions/file-ops'
import { organizeDownloads } from './actions/organize-downloads'
import { createProjectFolder, SpecData } from './actions/create-project-folder'
import { getSystemInfo } from './actions/get-system-info'
import { takeScreenshot } from './actions/screenshot'
import { notify } from './actions/notify'
import { clipboardRead, clipboardWrite } from './actions/clipboard'
import { gitStatus, gitLog, gitDiff, gitBranch, gitAdd, gitCommit, gitPull, gitPush } from './actions/git'
import { runCommand } from './actions/terminal'
import { runTests } from './actions/run-tests'
import { inspectSchema } from './actions/inspect-schema'
import { dockerPs, dockerStart, dockerStop, dockerLogs } from './actions/docker'
import { readEmails, sendEmail } from './actions/outlook'
import { getCalendar } from './actions/outlook-calendar'
import { restartApi } from './actions/restart-api'
import { parseTestReport } from './actions/parse-test-report'
import { getQaSummary } from './actions/get-qa-summary'
import { getDataQuality } from './actions/get-data-quality'
import { captureTestFailure } from './actions/capture-test-failure'
import { runGraphify_action } from './actions/run-graphify'
import { graphifySync } from './actions/graphify-sync'
import { supervisedSession } from './actions/supervised-session'
import { prismaGenerate, prismaMigrate } from './actions/prisma'
import { browseAndScreenshot } from './actions/browse-screenshot'
import { isActionAllowedForRole } from './role-policy'
import { AgentRole } from '@rayzen/types'

export async function executeTask(task: Task): Promise<unknown> {
  const key = `${task.module}:${task.action}`

  if (!ALLOWED_ACTIONS.has(key)) {
    throw new Error(`Ação não permitida: ${key}`)
  }
  const role: AgentRole = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'
  if (!isActionAllowedForRole(role, key)) {
    throw new Error(`Ação ${key} não permitida para o agente ${role}`)
  }

  const p = task.payload as Record<string, unknown>

  switch (key) {
    // Apps e navegação
    case 'jarvis:open_app':             return openApp(p as { app: string })
    case 'jarvis:open_url':             return openUrl(p as { url: string })
    case 'jarvis:open_vscode':          return openVscode(p as { path?: string })
    case 'jarvis:browse_and_screenshot': return browseAndScreenshot(p as { url: string; label?: string; waitMs?: number; projectName?: string })

    // Arquivos
    case 'jarvis:list_dir':    return listDir(p as { path: string })
    case 'jarvis:file_search': return fileSearch(p as { query: string; path?: string })
    case 'jarvis:file_read':   return fileRead(p as { path: string; lines?: { start: number; end?: number } })
    case 'jarvis:file_write':  return fileWrite(p as { path: string; content: string; dryRun?: boolean })
    case 'jarvis:file_delete': return fileDelete(p as { path: string; dryRun?: boolean })
    case 'jarvis:organize_downloads':    return organizeDownloads(p as { path: string; dryRun?: boolean })
    case 'jarvis:create_project_folder': return createProjectFolder(p as { name: string; root?: string; template?: 'blank' | 'node' | 'nextjs' | 'python' | 'rayzen'; brief?: string; spec?: SpecData; openVscode?: boolean; dryRun?: boolean })

    // Sistema
    case 'jarvis:get_system_info': return getSystemInfo()
    case 'jarvis:screenshot':      return takeScreenshot(p as { projectName?: string; projectFolder?: string; label?: string })
    case 'jarvis:notify':          return notify(p as { title: string; message: string })
    case 'jarvis:clipboard_read':  return clipboardRead()
    case 'jarvis:clipboard_write': return clipboardWrite(p as { text: string })

    // Git
    case 'jarvis:git_status':  return gitStatus(p as { path: string })
    case 'jarvis:git_log':     return gitLog(p as { path: string; limit?: number })
    case 'jarvis:git_diff':    return gitDiff(p as { path: string; staged?: boolean; file?: string })
    case 'jarvis:git_branch':  return gitBranch(p as { path: string; name?: string; dryRun?: boolean })
    case 'jarvis:git_add':     return gitAdd(p as { path: string; files: string[]; dryRun?: boolean })
    case 'jarvis:git_commit':  return gitCommit(p as { path: string; message: string; files?: string[]; dryRun?: boolean })
    case 'jarvis:git_pull':    return gitPull(p as { path: string; rebase?: boolean; dryRun?: boolean })
    case 'jarvis:git_push':    return gitPush(p as { path: string; branch?: string; dryRun?: boolean })

    // Terminal inteligente
    case 'jarvis:run_command': return runCommand(p as { command: string; path?: string; dryRun?: boolean; force?: boolean })

    // Testes e QA
    case 'jarvis:run_tests':      return runTests(p as { projectPath?: string; runner?: 'jest' | 'vitest' | 'playwright' | 'maven' | 'gradle' | 'pytest' | 'newman'; coverage?: boolean; filter?: string; collectionPath?: string; environment?: string })
    case 'jarvis:inspect_schema': return inspectSchema(p as { projectPath?: string })
    case 'jarvis:parse_test_report':    return parseTestReport(p as { reportPath: string; format?: 'junit' | 'allure' | 'auto'; projectId?: string; branch?: string; commitHash?: string })
    case 'jarvis:get_qa_summary':       return getQaSummary(p as { projectId?: string; type?: 'summary' | 'patterns' | 'flaky' | 'trend'; days?: number; runs?: number })
    case 'jarvis:get_data_quality':     return getDataQuality(p as { projectId?: string; dataset?: string; type?: 'summary' | 'score' | 'history' | 'rules' | 'results'; ruleId?: string; days?: number })
    case 'jarvis:capture_test_failure': return captureTestFailure(p as { projectPath?: string; reportDir?: string; screenshotDir?: string; projectId?: string; takeScreenshotOnFailure?: boolean })

    // Prisma
    case 'jarvis:prisma_generate': return prismaGenerate(p as { projectPath: string; schema?: string; dryRun?: boolean })
    case 'jarvis:prisma_migrate':  return prismaMigrate(p as { projectPath: string; mode: 'deploy' | 'status'; schema?: string; dryRun?: boolean })

    // Docker
    case 'jarvis:docker_ps':    return dockerPs()
    case 'jarvis:docker_start': return dockerStart(p as { name: string; dryRun?: boolean })
    case 'jarvis:docker_stop':  return dockerStop(p as { name: string; dryRun?: boolean })
    case 'jarvis:docker_logs':  return dockerLogs(p as { name: string; tail?: number })

    // Outlook
    case 'jarvis:read_emails':  return readEmails(p as { limit?: number })
    case 'jarvis:send_email':   return sendEmail(p as { to: string; subject: string; body: string; dryRun?: boolean })
    case 'jarvis:get_calendar': return getCalendar(p as { days?: number })

    // Infraestrutura
    case 'jarvis:restart_api': return restartApi(p as { dryRun?: boolean })

    // Graphify
    case 'jarvis:run_graphify':  return runGraphify_action(p as { projectPath?: string; projectId?: string; dryRun?: boolean })
    case 'jarvis:graphify_sync': return graphifySync(p as { cwd?: string })

    // Supervisor
    case 'jarvis:supervised_session': return supervisedSession(p as { sessionId: string; prompt: string; projectPath?: string; previewOutputPath?: string })

    default:
      throw new Error(`Handler não implementado: ${key}`)
  }
}
