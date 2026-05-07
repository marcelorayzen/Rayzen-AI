import * as os from 'os'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir()

const PATH_KEYWORDS: Record<string, string> = {
  downloads: HOME + '\\Downloads',
  documentos: HOME + '\\Documents',
  documents: HOME + '\\Documents',
  desktop: HOME + '\\Desktop',
  'área de trabalho': HOME + '\\Desktop',
  projetos: HOME + '\\Projects',
  projects: HOME + '\\Projects',
}

export function buildJarvisPayload(action: string, prompt: string): Record<string, unknown> {
  if (action === 'list_dir' || action === 'organize_downloads') {
    const lower = prompt.toLowerCase()
    for (const [keyword, path] of Object.entries(PATH_KEYWORDS)) {
      if (lower.includes(keyword)) {
        return { path, dryRun: action === 'organize_downloads' ? true : undefined }
      }
    }
    return { path: HOME + '\\Downloads' }
  }

  if (action === 'open_app') {
    const apps = ['chrome', 'code', 'firefox', 'notion', 'slack']
    const lower = prompt.toLowerCase()
    const app = apps.find((a) => lower.includes(a)) ?? 'chrome'
    return { app }
  }

  if (action === 'get_system_info') {
    return {}
  }

  if (action === 'open_url') {
    const urlMatch = prompt.match(/https?:\/\/[^\s]+/) ?? prompt.match(/(?:youtube\.com|youtu\.be|github\.com|spotify\.com|notion\.so)[^\s]*/i)
    if (urlMatch) return { url: urlMatch[0] }
    const lower = prompt.toLowerCase()
    if (lower.includes('youtube') || lower.includes('música') || lower.includes('musica') || lower.includes('video')) {
      const query = prompt.replace(/abr[ea]|coloc[ae]|toc[ae]|play|youtube|música|musica|video/gi, '').trim()
      return { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }
    }
    return { url: 'https://www.youtube.com' }
  }

  if (action === 'open_vscode') {
    const lower = prompt.toLowerCase()
    for (const [keyword, path] of Object.entries(PATH_KEYWORDS)) {
      if (lower.includes(keyword)) return { path }
    }
    const match = prompt.match(/(?:abr[ae]|open)\s+(?:o projeto\s+)?(.+?)(?:\s+no vscode|$)/i)
    if (match) return { path: 'C:\\Projects\\' + match[1].trim() }
    return {}
  }

  if (action === 'create_project_folder') {
    const lower = prompt.toLowerCase()
    const template = lower.includes('next') ? 'nextjs'
      : lower.includes('node') || lower.includes('api') ? 'node'
      : lower.includes('python') ? 'python'
      : 'blank'
    const nameMatch = prompt.match(/(?:chamado|projeto|project|criar|crie|novo)\s+([a-zA-Z0-9_\- ]+?)(?:\s+com|\s+usando|\s+em|$)/i)
    const name = nameMatch ? nameMatch[1].trim() : 'novo-projeto'
    return { name, template, openVscode: true, dryRun: false }
  }

  if (action === 'read_emails') {
    const limitMatch = prompt.match(/(\d+)\s*(?:email|e-mail|mensagem)/i)
    return { limit: limitMatch ? parseInt(limitMatch[1]) : 5 }
  }

  if (action === 'send_email') {
    return { prompt, dryRun: false }
  }

  if (action === 'get_calendar') {
    const daysMatch = prompt.match(/(\d+)\s*dia/i)
    return { days: daysMatch ? parseInt(daysMatch[1]) : 1 }
  }

  if (action === 'git_status' || action === 'git_log' || action === 'git_branch' || action === 'git_commit') {
    const projectMatch = prompt.match(/(?:projeto|repo|reposit[oó]rio|project)\s+([a-zA-Z0-9_\-]+)/i)
    const path = projectMatch ? `C:\\Projects\\${projectMatch[1]}` : 'C:\\Projects\\rayzen-ai'
    if (action === 'git_commit') {
      const msgMatch = prompt.match(/(?:commit|mensagem|message)\s+[""']?(.+?)[""']?$/i)
      return { path, message: msgMatch ? msgMatch[1] : prompt, dryRun: false }
    }
    if (action === 'git_branch') {
      const branchMatch = prompt.match(/(?:branch|rama|cria[r]?|criar)\s+([a-zA-Z0-9_\-/]+)/i)
      return { path, name: branchMatch ? branchMatch[1] : undefined }
    }
    return { path, limit: 10 }
  }

  if (action === 'run_command') {
    const lower = prompt.toLowerCase()
    const projectMatch = prompt.match(/(?:no projeto|in|projeto)\s+([a-zA-Z0-9_\-]+)/i)
    const path = projectMatch ? `C:\\Projects\\${projectMatch[1]}` : undefined
    return { command: lower, path }
  }

  if (action === 'docker_ps') return {}

  if (action === 'docker_start' || action === 'docker_stop') {
    const nameMatch = prompt.match(/(?:container|servi[çc]o|start|stop|inicia[r]?|para[r]?)\s+([a-zA-Z0-9_\-]+)/i)
    return { name: nameMatch ? nameMatch[1] : '', dryRun: false }
  }

  if (action === 'screenshot') return {}

  if (action === 'notify') {
    const titleMatch = prompt.match(/(?:título|title|assunto)\s+[""']?(.+?)[""']?(?:\s+mensagem|\s+com|$)/i)
    const msgMatch = prompt.match(/(?:mensagem|message|diz[er]?|fala[r]?)\s+[""']?(.+?)[""']?$/i)
    return {
      title: titleMatch ? titleMatch[1] : 'Rayzen AI',
      message: msgMatch ? msgMatch[1] : prompt,
    }
  }

  if (action === 'clipboard_read') return {}

  if (action === 'clipboard_write') {
    const textMatch = prompt.match(/(?:copiar?|escrever?|colar?|clipboard)\s+[""']?(.+?)[""']?$/i)
    return { text: textMatch ? textMatch[1] : prompt }
  }

  if (action === 'run_tests') {
    const projectMatch = prompt.match(/(?:no projeto|in|projeto)\s+([a-zA-Z0-9_\-]+)/i)
    const projectPath = projectMatch ? `C:\\Projects\\${projectMatch[1]}` : undefined
    const runner = /playwright|e2e|cypress/i.test(prompt) ? 'playwright'
      : /vitest/i.test(prompt) ? 'vitest'
      : 'jest'
    const coverage = /cobertura|coverage|cov/i.test(prompt)
    const filterMatch = prompt.match(/(?:filtro|filter|only|apenas|teste)\s+[""']?(.+?)[""']?$/i)
    return { projectPath, runner, coverage, filter: filterMatch ? filterMatch[1] : undefined }
  }

  if (action === 'restart_api') {
    const branchMatch = prompt.match(/(?:branch|rama|local\/|origin\/)\s*([a-zA-Z0-9_\-/]+)/i)
    const dryRun = /dry.?run|simula|teste|testar/i.test(prompt)
    return { branch: branchMatch ? branchMatch[1] : 'local/marcelo', dryRun }
  }

  if (action === 'inspect_schema') {
    const projectMatch = prompt.match(/(?:no projeto|in|projeto)\s+([a-zA-Z0-9_\-]+)/i)
    const projectPath = projectMatch ? `C:\\Projects\\${projectMatch[1]}` : undefined
    return { projectPath }
  }

  if (action === 'file_search') {
    const queryMatch = prompt.match(/(?:procura[r]?|busca[r]?|encontra[r]?|acha[r]?|find|search)\s+(?:arquivo\s+)?[""']?(.+?)[""']?(?:\s+em|$)/i)
    const pathMatch = prompt.match(/(?:\s+em\s+)(.+?)$/i)
    return {
      query: queryMatch ? queryMatch[1] : prompt,
      path: pathMatch ? pathMatch[1].trim() : undefined,
    }
  }

  return { prompt }
}
