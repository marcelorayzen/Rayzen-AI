/**
 * Em que isolamento cada efeito roda — declarado por tipo de efeito, nunca escolhido por quem
 * pede.
 *
 * ── Por que não vem no envelope ─────────────────────────────────────────────
 * Se o produtor (web, Hermes, missão) declarasse o próprio isolamento, a entrada escolheria a
 * própria proteção. É a lição do A08 na forma mais direta: o gate depende do que se pede, não
 * de quem pede. Isolamento é propriedade do que o efeito FAZ.
 *
 * ── Por que não há default nem heurística ───────────────────────────────────
 * Mesma disciplina das estratégias de `executarPrograma()`, que são "declaradas por
 * capability, sem default nem heurística". Um default aqui significaria que todo efeito novo
 * herdaria silenciosamente a proteção de outro — e o teste abaixo exige que a lista cubra
 * TODAS as ações declaradas em `ACTION_ROLE`, então efeito novo sem decisão não compila o
 * teste, em vez de escorregar para o valor conveniente.
 *
 * ── A lista descreve o que É, não o que seria bom ───────────────────────────
 * `worktree` aparece só onde o isolamento de fato acontece hoje: `run_command`, pelo
 * `decidir()` (Item A.3), e `supervised_session`, pela própria sessão. As ações de git tocam
 * um checkout existente e **não** são isoladas hoje — declará-las `worktree` afirmaria uma
 * proteção que não existe, que é pior que declarar a ausência dela.
 */
export type IsolamentoDoEfeito = 'nenhum' | 'worktree'

export const ISOLAMENTO_POR_EFEITO: Readonly<Record<string, IsolamentoDoEfeito>> = {
  // ── isolados de verdade ──
  run_command: 'worktree',
  supervised_session: 'worktree',

  // ── sem isolamento ──
  //
  // `create_project_folder` é o caso que explica a regra: ele CRIA o checkout. Não existe
  // repositório de onde tirar um worktree, e o resultado precisa ficar no lugar real — abrir
  // o VS Code ali é o objetivo. Isolar exigiria um segundo efeito para copiar de volta.
  create_project_folder: 'nenhum',
  open_app: 'nenhum',
  open_url: 'nenhum',
  open_vscode: 'nenhum',
  // cria um worktree persistente para REVISÃO — o worktree é o produto, não um isolamento.
  open_delivery: 'nenhum',
  project_list_files: 'nenhum',
  project_read_file: 'nenhum',
  list_dir: 'nenhum',
  file_search: 'nenhum',
  organize_downloads: 'nenhum',
  get_system_info: 'nenhum',
  screenshot: 'nenhum',
  notify: 'nenhum',
  clipboard_read: 'nenhum',
  clipboard_write: 'nenhum',
  git_status: 'nenhum',
  git_log: 'nenhum',
  git_branch: 'nenhum',
  git_commit: 'nenhum',
  run_tests: 'nenhum',
  inspect_schema: 'nenhum',
  read_emails: 'nenhum',
  send_email: 'nenhum',
  get_calendar: 'nenhum',
  parse_test_report: 'nenhum',
  capture_test_failure: 'nenhum',
  docker_ps: 'nenhum',
  docker_start: 'nenhum',
  docker_stop: 'nenhum',
  docker_logs: 'nenhum',
  restart_api: 'nenhum',
  file_read: 'nenhum',
  file_write: 'nenhum',
  file_delete: 'nenhum',
  git_diff: 'nenhum',
  git_add: 'nenhum',
  git_pull: 'nenhum',
  git_push: 'nenhum',
  prisma_generate: 'nenhum',
  prisma_migrate: 'nenhum',
  run_graphify: 'nenhum',
  graphify_sync: 'nenhum',
  guardian_analyze: 'nenhum',
  browse_and_screenshot: 'nenhum',
  get_qa_summary: 'nenhum',
}

/**
 * `undefined` para efeito desconhecido — nunca `'nenhum'`.
 *
 * Ausência não é permissão: quem chama precisa poder distinguir "declarado sem isolamento" de
 * "ninguém decidiu", e tratar o segundo como erro em vez de como o valor mais conveniente.
 */
export function isolamentoDoEfeito(actionKey: string): IsolamentoDoEfeito | undefined {
  return ISOLAMENTO_POR_EFEITO[actionKey.replace(/^jarvis:/, '')]
}
