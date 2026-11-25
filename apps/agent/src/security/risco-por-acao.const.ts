export type RiscoDeAcao = 'none' | 'low' | 'medium' | 'high'

/**
 * O risco de cada ação do agent — a mesma classificação que a V2 declara, aqui para poder ser
 * APLICADA no despacho.
 *
 * ── Por que existia um flanco ────────────────────────────────────────────────
 * `consumirAprovacao()` era chamado só pelo `decidir()`, que cobre `run_command`. Medido em
 * 24/09: as cinco ações `high` — `file_delete`, `send_email`, `prisma_migrate`, `restart_api`
 * e `supervised_session` — chegavam ao `executeTask` com whitelist e role-policy, e mais nada.
 * O motor de skills da V2 as barra desde o conserto do A08, mas essa é UMA porta: tarefa
 * enfileirada direto no agent nunca passava por ela.
 *
 * É a forma exata do A08, do outro lado da fronteira: a autorização dependia da porta escolhida
 * em vez do risco da ação.
 *
 * ── Por que uma cópia, e por que ela não pode divergir ───────────────────────
 * A classificação canônica mora em `apps/api-v2/src/skill-engine/skill-registry.ts`, junto com
 * nome, categoria e schema — é de lá que sai `docs/agent-actions.md`. O agent não importa da
 * api-v2 (apps separados, sem dependência entre eles), então a tabela é duplicada, como
 * `memory-ranking.const.ts` e `event-derived-text.const.ts` já são. `risco-por-acao.spec.ts`
 * lê o registro da V2 como TEXTO e reprova se as duas discordarem em qualquer ação.
 *
 * Divergir aqui não daria erro: daria uma ação `high` na V2 executando sem gate no agent, que
 * é exatamente o defeito que esta tabela existe para fechar.
 *
 * ── Ação desconhecida não é ação sem risco ───────────────────────────────────
 * `riscoDaAcao()` devolve `undefined` para quem não está na tabela, e quem chama trata isso
 * como "não sei" — nunca como `none`. Ausência virar permissão é a família de defeito que esta
 * casa já pagou caro (o `isNoise` classificando por campo, o gate que dependia de `missionId`).
 */
export const RISCO_POR_ACAO: Readonly<Record<string, RiscoDeAcao>> = {
  // ── high ──
  'jarvis:file_delete': 'high',
  'jarvis:prisma_migrate': 'high',
  'jarvis:restart_api': 'high',
  'jarvis:send_email': 'high',
  'jarvis:supervised_session': 'high',
  // ── medium ──
  'jarvis:create_project_folder': 'medium',
  'jarvis:docker_start': 'medium',
  'jarvis:docker_stop': 'medium',
  'jarvis:file_write': 'medium',
  'jarvis:git_commit': 'medium',
  'jarvis:git_pull': 'medium',
  // fetch de um ref + worktree numa pasta nova: mesma classe de git_pull/create_project_folder.
  'jarvis:open_delivery': 'medium',
  'jarvis:git_push': 'medium',
  'jarvis:organize_downloads': 'medium',
  'jarvis:run_command': 'medium',
  // ── low ──
  'jarvis:browse_and_screenshot': 'low',
  'jarvis:git_add': 'low',
  'jarvis:git_branch': 'low',
  'jarvis:graphify_sync': 'low',
  'jarvis:open_app': 'low',
  'jarvis:open_url': 'low',
  'jarvis:prisma_generate': 'low',
  'jarvis:run_graphify': 'low',
  'jarvis:run_tests': 'low',
  // ── none ──
  'jarvis:capture_test_failure': 'none',
  'jarvis:clipboard_read': 'none',
  'jarvis:clipboard_write': 'none',
  'jarvis:docker_logs': 'none',
  'jarvis:docker_ps': 'none',
  'jarvis:file_read': 'none',
  'jarvis:file_search': 'none',
  'jarvis:get_calendar': 'none',
  'jarvis:get_qa_summary': 'none',
  'jarvis:get_system_info': 'none',
  'jarvis:git_diff': 'none',
  'jarvis:git_log': 'none',
  'jarvis:git_status': 'none',
  'jarvis:guardian_analyze': 'none',
  'jarvis:inspect_schema': 'none',
  'jarvis:list_dir': 'none',
  'jarvis:notify': 'none',
  'jarvis:open_vscode': 'none',
  // Só leitura, presa ao checkout do projeto, segredo recusado pelo nome (item 3, 12/11).
  'jarvis:project_list_files': 'none',
  'jarvis:project_read_file': 'none',
  'jarvis:parse_test_report': 'none',
  'jarvis:read_emails': 'none',
  'jarvis:screenshot': 'none',
}

/** `undefined` = não classificada. Quem chama decide o que fazer com o desconhecido. */
export function riscoDaAcao(actionKey: string): RiscoDeAcao | undefined {
  return RISCO_POR_ACAO[actionKey]
}

/**
 * Só `high` interpõe uma pessoa, e o limiar é o mesmo do `run_command` (`exigeAprovacao`).
 *
 * `medium` fica de fora pela lição do Guardian: até 13/08 qualquer nível acima de `low` abria
 * gate, e como um service sem spec já valia o limiar de medium, todo service tocado virava um
 * pedido de aprovação. Gate que dispara sempre é gate que alguém desliga.
 */
export function exigeAprovacaoHumana(risco: RiscoDeAcao | undefined): boolean {
  return risco === 'high'
}
