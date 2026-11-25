/**
 * Alçada — quanto custa aprovar cada efeito de envelope (S1, decidido por Marcelo em 15/11:
 * "mais autonomia para o Rayzen, e eu vendo o que ele fez").
 *
 * Até aqui todo envelope pedia o código do autenticador, do `open_url` ao `prisma_migrate`.
 * Gate que custa o mesmo para tudo é gate que se aprende a aprovar sem ler, a lição do Guardian
 * de 13/08 no outro sentido.
 *
 * | nível      | custo                                   | o que fica registrado |
 * |------------|-----------------------------------------|-----------------------|
 * | `autonomo` | nenhum: aprovado pela política ao enviar | envelope + aprovação com `createdByType: 'policy'` |
 * | `propoe`   | um toque de uma pessoa logada no Hub      | aprovação com o principal humano |
 * | `critico`  | pessoa logada **e** código do autenticador | aprovação com principal `totp:` |
 *
 * O quarto nível, **intocável**, não está nesta tabela de propósito: é o que não tem ação
 * nenhuma que o faça (ler segredo, mexer no gate, publicar repositório, deploy direto). Ver
 * `docs/ALCADA.md`. Nada intocável pode ser proposto porque não existe efeito para propor.
 *
 * ── De onde vem o nível ──────────────────────────────────────────────────────
 * Do risco canônico (`apps/api-v2/src/skill-engine/skill-registry.ts`), com uma regra só:
 * **a alçada pode ser mais rígida que o risco, nunca mais frouxa** — salvo as exceções nomeadas
 * em `EXCECOES_ABAIXO_DO_PISO`. `high` é `critico`;
 * `medium` é no mínimo `propoe`. `alcada.spec.ts` lê o registro como texto e reprova se alguma
 * ação ficar abaixo do piso — divergir aqui não daria erro, daria um `high` com um toque.
 *
 * Os casos mais rígidos que o risco, e por quê:
 * - `run_command`: `medium` no registro, mas texto livre é RED no agent desde a Fase 5.
 * - `read_emails`, `clipboard_read`, `get_calendar`: risco `none` para a máquina, mas o
 *   resultado volta ao Hub, que está na internet — é dado pessoal saindo, não efeito local.
 *
 * ── Desconhecido é crítico ───────────────────────────────────────────────────
 * `alcadaDoEfeito()` devolve `critico` para ação fora da tabela, nunca `autonomo`. Ausência
 * virar permissão é a família do `isNoise` e do gate que dependia de `missionId`.
 */
export type NivelDeAlcada = 'autonomo' | 'propoe' | 'critico'

/**
 * As únicas ações autorizadas a ficar abaixo do piso do risco — cada uma com o motivo e quem
 * decidiu. O teste aceita exatamente esta lista: uma ação nova abaixo do piso reprova até
 * entrar aqui, com nome e data.
 */
export const EXCECOES_ABAIXO_DO_PISO: Readonly<Record<string, string>> = {
  supervised_session:
    'Marcelo, 15/11/2026, "pelo menos por enquanto": a sessão roda isolada e PARA no diff final — ' +
    'só vira PR em rascunho depois de uma segunda aprovação humana desse diff. O código no ' +
    'envio cobrava duas vezes a mesma revisão.',
}

export const ALCADA_POR_EFEITO: Readonly<Record<string, NivelDeAlcada>> = {
  // ── crítico: pessoa + código ──
  file_delete: 'critico',
  prisma_migrate: 'critico',
  restart_api: 'critico',
  send_email: 'critico',
  run_command: 'critico',

  // ── propõe: um toque ──
  // ABAIXO DO PISO, por decisão (ver EXCECOES_ABAIXO_DO_PISO): risco high, mas um toque.
  supervised_session: 'propoe',
  create_project_folder: 'propoe',
  docker_start: 'propoe',
  docker_stop: 'propoe',
  file_write: 'propoe',
  git_commit: 'propoe',
  git_pull: 'propoe',
  git_push: 'propoe',
  open_delivery: 'propoe',
  organize_downloads: 'propoe',
  read_emails: 'propoe',
  clipboard_read: 'propoe',
  get_calendar: 'propoe',

  // ── autônomo: só registro ──
  browse_and_screenshot: 'autonomo',
  git_add: 'autonomo',
  git_branch: 'autonomo',
  graphify_sync: 'autonomo',
  open_app: 'autonomo',
  open_url: 'autonomo',
  prisma_generate: 'autonomo',
  run_graphify: 'autonomo',
  run_tests: 'autonomo',
  capture_test_failure: 'autonomo',
  clipboard_write: 'autonomo',
  docker_logs: 'autonomo',
  docker_ps: 'autonomo',
  file_read: 'autonomo',
  file_search: 'autonomo',
  get_qa_summary: 'autonomo',
  get_system_info: 'autonomo',
  git_diff: 'autonomo',
  git_log: 'autonomo',
  git_status: 'autonomo',
  guardian_analyze: 'autonomo',
  inspect_schema: 'autonomo',
  list_dir: 'autonomo',
  notify: 'autonomo',
  open_vscode: 'autonomo',
  project_list_files: 'autonomo',
  project_read_file: 'autonomo',
  parse_test_report: 'autonomo',
  screenshot: 'autonomo',
}

/** Desconhecido vira `critico` — o nível mais caro, nunca o mais conveniente. */
export function alcadaDoEfeito(actionKey: string): NivelDeAlcada {
  return ALCADA_POR_EFEITO[actionKey.replace(/^jarvis:/, '')] ?? 'critico'
}

const ORDEM: Record<NivelDeAlcada, number> = { autonomo: 0, propoe: 1, critico: 2 }

/** O envelope custa o nível do efeito mais caro — hoje é um efeito por envelope, mas a regra não depende disso. */
export function alcadaDoEnvelope(efeitos: { actionKey: string }[]): NivelDeAlcada {
  if (efeitos.length === 0) return 'critico'
  return efeitos.map((e) => alcadaDoEfeito(e.actionKey))
    .reduce((a, b) => (ORDEM[b] > ORDEM[a] ? b : a))
}
