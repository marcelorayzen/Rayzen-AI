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
      : 'rayzen'
    const nameMatch = prompt.match(/(?:chamado|projeto|project|criar|crie|novo)\s+([a-zA-Z0-9_\- ]+?)(?:\s+com|\s+usando|\s+em|\s+brief|$)/i)
    const name = nameMatch ? nameMatch[1].trim() : 'novo-projeto'
    // Extrai brief se fornecido entre aspas ou após "brief:"
    const briefMatch = prompt.match(/brief[:\s]+["']?(.+?)["']?$/is) ?? prompt.match(/ideia[:\s]+["']?(.+?)["']?$/is)
    const brief = briefMatch ? briefMatch[1].trim() : undefined
    return { name, template, brief, openVscode: true, dryRun: false }
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

  if (action === 'docker_logs') {
    const nameMatch = prompt.match(/(?:container|servi[çc]o|logs?)\s+([a-zA-Z0-9_\-]+)/i)
    const tailMatch = prompt.match(/(?:ultim[oa]s?|tail)\s+(\d+)/i)
    return { name: nameMatch ? nameMatch[1] : '', tail: tailMatch ? parseInt(tailMatch[1]) : 100 }
  }

  if (action === 'screenshot') {
    const descriptionMatch = prompt.match(/:\s*(.+?)\s*$/)
    const description = descriptionMatch?.[1]?.trim()
    return description
      ? { description, label: toEvidenceLabel(description), category: classifyEvidenceDescription(description) }
      : {}
  }

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

  if (action === 'get_data_quality') {
    const isScore = /score|pontuação|nota/i.test(prompt)
    const isHistory = /histórico|historico|tendência|tendencia|evolução/i.test(prompt)
    const isRules = /regra|regras|rule|rules|contrato/i.test(prompt)
    const datasetMatch = prompt.match(/(?:dataset|tabela|table|conjunto)\s+([a-zA-Z0-9_]+)/i)
    const daysMatch = prompt.match(/(\d+)\s*dia/i)
    return {
      type: isHistory ? 'history' : isScore ? 'score' : isRules ? 'rules' : 'summary',
      dataset: datasetMatch ? datasetMatch[1] : undefined,
      days: daysMatch ? parseInt(daysMatch[1]) : undefined,
    }
  }

  if (action === 'get_qa_summary') {
    const isFlaky = /flaky|intermitente/i.test(prompt)
    const isTrend = /tendência|tendencia|trend|histórico|historico|evolução/i.test(prompt)
    const isPatterns = /padrão|padrao|pattern|falha.*(mais|frequent)|frequent/i.test(prompt)
    const daysMatch = prompt.match(/(\d+)\s*dia/i)
    return {
      type: isFlaky ? 'flaky' : isTrend ? 'trend' : isPatterns ? 'patterns' : 'summary',
      days: daysMatch ? parseInt(daysMatch[1]) : undefined,
    }
  }

  if (action === 'parse_test_report') {
    const pathMatch = prompt.match(/(?:relatório|relatorio|report|arquivo|xml|json|caminho|path)\s+[""']?([^\s""']+(?:\.xml|\.json))[""']?/i)
      ?? prompt.match(/([A-Za-z]:[\\\/][^\s]+(?:\.xml|\.json))/i)
    const isAllure = /allure/i.test(prompt)
    const isJunit = /junit|testng|selenium/i.test(prompt)
    return {
      reportPath: pathMatch?.[1] ?? '',
      format: isAllure ? 'allure' : isJunit ? 'junit' : 'auto',
    }
  }

  if (action === 'restart_api') {
    const dryRun = /dry.?run|simula|teste|testar/i.test(prompt)
    return { dryRun }
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

function toEvidenceLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'screenshot'
}

function classifyEvidenceDescription(value: string): 'api_test' | 'manual_test' | 'bug' | 'fix' | 'general' {
  const text = value.toLowerCase()
  if (/\b(api|endpoint|postman|newman|request|response)\b/.test(text)) return 'api_test'
  if (/\b(bug|erro|falha|quebra|defeito)\b/.test(text)) return 'bug'
  if (/\b(corre[cç][aã]o|corrigido|fix|ajuste resolvido)\b/.test(text)) return 'fix'
  if (/\b(teste|valida[cç][aã]o|fluxo manual|manual)\b/.test(text)) return 'manual_test'
  return 'general'
}
