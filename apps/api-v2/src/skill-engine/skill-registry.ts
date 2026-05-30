export type SkillCategory =
  | 'filesystem' | 'git' | 'docker' | 'terminal'
  | 'browser' | 'editor' | 'email' | 'calendar'
  | 'ai' | 'document' | 'content' | 'qa'
  | 'data' | 'system' | 'network'

export type SkillRisk = 'none' | 'low' | 'medium' | 'high'
export type SkillRuntime = 'in-process' | 'agent-desktop' | 'agent-server'

export interface SkillDefinition {
  id:           string
  name:         string
  description:  string
  category:     SkillCategory
  risk:         SkillRisk
  runtime:      SkillRuntime
  version:      string
  inputSchema:  Record<string, unknown>
  outputSchema: Record<string, unknown>
  estimatedMs?: number
}

// All 33 V1 agent actions mapped to SkillDefinitions.
// runtime 'agent-desktop' → dispatched to desktop agent via V1 execution API
// runtime 'agent-server'  → dispatched to server agent via V1 execution API
// runtime 'in-process'    → executed directly in api-v2 (not yet implemented, Fase 3)
const SKILL_DEFINITIONS: SkillDefinition[] = [
  { id: 'jarvis:open_app',             name: 'Open Application',      description: 'Opens an application on the desktop',                  category: 'system',     risk: 'low',    runtime: 'agent-desktop', version: '1.0', inputSchema: { app: 'string' }, outputSchema: {} },
  { id: 'jarvis:open_url',             name: 'Open URL',              description: 'Opens a URL in the default browser',                   category: 'browser',    risk: 'low',    runtime: 'agent-desktop', version: '1.0', inputSchema: { url: 'string' }, outputSchema: {} },
  { id: 'jarvis:open_vscode',          name: 'Open VS Code',          description: 'Opens a folder in VS Code',                            category: 'editor',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: {} },
  { id: 'jarvis:list_dir',             name: 'List Directory',        description: 'Lists files in a directory (sandboxed)',               category: 'filesystem', risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: { files: 'array' } },
  { id: 'jarvis:file_search',          name: 'File Search',           description: 'Searches files by name/content',                       category: 'filesystem', risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { query: 'string', path: 'string' }, outputSchema: { matches: 'array' } },
  { id: 'jarvis:organize_downloads',   name: 'Organize Downloads',    description: 'Organizes the Downloads folder',                       category: 'filesystem', risk: 'medium', runtime: 'agent-desktop', version: '1.0', inputSchema: { dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:create_project_folder',name: 'Create Project Folder', description: 'Creates a project folder from a template',             category: 'filesystem', risk: 'low',    runtime: 'agent-desktop', version: '1.0', inputSchema: { name: 'string', template: 'string' }, outputSchema: { path: 'string' } },
  { id: 'jarvis:get_system_info',      name: 'Get System Info',       description: 'Returns CPU, RAM, disk, uptime',                       category: 'system',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: {}, outputSchema: { cpu: 'object', ram: 'object' } },
  { id: 'jarvis:screenshot',           name: 'Screenshot',            description: 'Takes a screenshot and sends to API',                  category: 'system',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: {}, outputSchema: { path: 'string' } },
  { id: 'jarvis:notify',               name: 'Notify',                description: 'Sends a Windows toast notification',                   category: 'system',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { message: 'string' }, outputSchema: {} },
  { id: 'jarvis:clipboard_read',       name: 'Read Clipboard',        description: 'Reads the clipboard content',                          category: 'system',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: {}, outputSchema: { content: 'string' } },
  { id: 'jarvis:clipboard_write',      name: 'Write Clipboard',       description: 'Writes text to the clipboard',                         category: 'system',     risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { content: 'string' }, outputSchema: {} },
  { id: 'jarvis:git_status',           name: 'Git Status',            description: 'Returns git status of a repository',                   category: 'git',        risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: { status: 'string' } },
  { id: 'jarvis:git_log',              name: 'Git Log',               description: 'Returns recent git commits',                           category: 'git',        risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string', limit: 'number' }, outputSchema: { commits: 'array' } },
  { id: 'jarvis:git_branch',           name: 'Git Branch',            description: 'Lists or creates git branches',                        category: 'git',        risk: 'low',    runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: {} },
  { id: 'jarvis:git_commit',           name: 'Git Commit',            description: 'Commits staged changes',                               category: 'git',        risk: 'medium', runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string', message: 'string', dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:run_command',          name: 'Run Command',           description: 'Runs a whitelisted terminal command',                  category: 'terminal',   risk: 'medium', runtime: 'agent-desktop', version: '1.0', inputSchema: { command: 'string' }, outputSchema: { output: 'string' } },
  { id: 'jarvis:run_tests',            name: 'Run Tests',             description: 'Runs jest/vitest/playwright tests',                    category: 'qa',         risk: 'low',    runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: { passed: 'number', failed: 'number' } },
  { id: 'jarvis:inspect_schema',       name: 'Inspect Schema',        description: 'Parses Prisma schema and computes diff',               category: 'data',       risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: {} },
  { id: 'jarvis:docker_ps',            name: 'Docker PS',             description: 'Lists running Docker containers',                      category: 'docker',     risk: 'none',   runtime: 'agent-server',  version: '1.0', inputSchema: {}, outputSchema: { containers: 'array' } },
  { id: 'jarvis:docker_start',         name: 'Docker Start',          description: 'Starts a Docker container',                            category: 'docker',     risk: 'medium', runtime: 'agent-server',  version: '1.0', inputSchema: { container: 'string', dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:docker_stop',          name: 'Docker Stop',           description: 'Stops a Docker container',                             category: 'docker',     risk: 'medium', runtime: 'agent-server',  version: '1.0', inputSchema: { container: 'string', dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:docker_logs',          name: 'Docker Logs',           description: 'Returns container logs',                               category: 'docker',     risk: 'none',   runtime: 'agent-server',  version: '1.0', inputSchema: { container: 'string', lines: 'number' }, outputSchema: { logs: 'string' } },
  { id: 'jarvis:parse_test_report',    name: 'Parse Test Report',     description: 'Parses JUnit XML / Allure JSON test reports',          category: 'qa',         risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { path: 'string' }, outputSchema: {} },
  { id: 'jarvis:get_qa_summary',       name: 'QA Summary',            description: 'Summarizes TestRuns for a project',                    category: 'qa',         risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { projectId: 'string' }, outputSchema: {} },
  { id: 'jarvis:capture_test_failure', name: 'Capture Test Failure',  description: 'Takes screenshot + logs on test failure',              category: 'qa',         risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: {}, outputSchema: {} },
  { id: 'jarvis:read_emails',          name: 'Read Emails',           description: 'Reads emails from Outlook',                            category: 'email',      risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { limit: 'number' }, outputSchema: { emails: 'array' } },
  { id: 'jarvis:send_email',           name: 'Send Email',            description: 'Sends an email via Outlook',                           category: 'email',      risk: 'high',   runtime: 'agent-desktop', version: '1.0', inputSchema: { to: 'string', subject: 'string', body: 'string', dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:get_calendar',         name: 'Get Calendar',          description: 'Returns Outlook calendar events',                      category: 'calendar',   risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { days: 'number' }, outputSchema: { events: 'array' } },
  { id: 'jarvis:restart_api',          name: 'Restart API',           description: 'git pull + build + restart API on server',             category: 'system',     risk: 'high',   runtime: 'agent-server',  version: '1.0', inputSchema: { dryRun: 'boolean' }, outputSchema: {} },
  { id: 'jarvis:get_data_quality',     name: 'Data Quality',          description: 'Returns DQ summary/score/rules for a project',         category: 'data',       risk: 'none',   runtime: 'agent-desktop', version: '1.0', inputSchema: { projectId: 'string' }, outputSchema: {} },
  { id: 'jarvis:run_graphify',         name: 'Run Graphify',          description: 'Updates the knowledge graph and sends report to API',  category: 'system',     risk: 'low',    runtime: 'agent-server',  version: '1.0', inputSchema: {}, outputSchema: {} },
  { id: 'jarvis:graphify_sync',        name: 'Graphify Sync',         description: 'Updates graph + generates architecture summary',       category: 'system',     risk: 'low',    runtime: 'agent-server',  version: '1.0', inputSchema: {}, outputSchema: {} },
]

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>()

  constructor() {
    for (const skill of SKILL_DEFINITIONS) {
      this.skills.set(skill.id, skill)
    }
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id)
  }

  list(category?: SkillCategory): SkillDefinition[] {
    const all = [...this.skills.values()]
    return category ? all.filter((s) => s.category === category) : all
  }

  categories(): SkillCategory[] {
    return [...new Set(this.list().map((s) => s.category))]
  }
}
