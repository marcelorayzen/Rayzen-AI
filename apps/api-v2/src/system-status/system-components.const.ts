/**
 * Catálogo dos ciclos que rodam sozinhos.
 *
 * Existe porque o Rayzen não representava sistema **em execução** em lugar nenhum:
 * Goal Graph, painéis e `nextSteps` mostram o que falta, nunca o que está de pé.
 * A única forma de saber quais ciclos existem era ler o `CLAUDE.md`.
 *
 * **Por que const e não auto-registro.** Se a lista fosse construída a partir de
 * quem bate, um ciclo que nunca sobe simplesmente não apareceria — e some do
 * painel exatamente o caso que mais importa detectar. A declaração é o que
 * transforma ausência em "nunca bateu". Mesmo padrão de `INVARIANTES` e
 * `TASK_TYPES`, e mesma razão de `GET /v2/invariants/catalogo` existir: a UI
 * precisa listar antes da primeira execução.
 *
 * O preço é uma lista para manter — o tipo de fonte dupla que causou o drift
 * `whitelist.ts` ↔ `ExecutionService`. Aceito conscientemente: aqui a lista é a
 * *expectativa*, não uma cópia do comportamento. Divergir dela é o sinal, não o bug.
 */

export type ComponenteId =
  | 'invariants' | 'catalog-sync' | 'qa-scientist' | 'guardian' | 'memory-backfill'
  | 'auto-checkpoint' | 'deploy-drift' | 'panorama' | 'handoff-reconciliation' | 'catalog-drift' | 'backup-verificado' | 'limpeza-workspaces' | 'rotinas'

export interface ComponenteDoSistema {
  id:          ComponenteId
  titulo:      string
  onde:        'api-v2' | 'api' | 'agent'
  /** De quanto em quanto tempo o ciclo executa. Informativo — não é o que decide "atrasado". */
  tickMs:      number
  /**
   * De quanto em quanto tempo o componente **reporta**. Diferente do tick de
   * propósito: o Guardian executa a cada 30s, e bater junto seriam ~2.880
   * requisições/dia só para dizer "estou aqui".
   */
  beatEveryMs: number
  /**
   * Folga antes de considerar atrasado. Explícita por componente porque a
   * tolerância **não é proporcional**: 33s num ciclo de 30s é jitter de
   * scheduler; 26h num ciclo de 24h já é sinal real. Um multiplicador global
   * erraria nas duas pontas.
   */
  graceMs:     number
  desligarCom: string | null
}

const MIN = 60_000
const HORA = 60 * MIN

export const COMPONENTES: readonly ComponenteDoSistema[] = [
  {
    id:          'invariants',
    titulo:      'Invariantes — o estado bate com o que deveria ser?',
    onde:        'api-v2',
    tickMs:      30 * MIN,
    beatEveryMs: 30 * MIN,
    graceMs:     20 * MIN,
    desligarCom: 'INVARIANTS_CYCLE_ENABLED=false',
  },
  {
    id:          'catalog-sync',
    titulo:      'Sync do catálogo — projeto novo entra sozinho na V2',
    onde:        'api-v2',
    tickMs:      6 * HORA,
    beatEveryMs: 6 * HORA,
    graceMs:     2 * HORA,
    desligarCom: 'CATALOG_SYNC_ENABLED=false',
  },
  {
    id:          'qa-scientist',
    titulo:      'QA Scientist — sinal, hipótese, experimento, gate',
    onde:        'api-v2',
    tickMs:      24 * HORA,
    beatEveryMs: 24 * HORA,
    graceMs:     2 * HORA,
    desligarCom: null,
  },
  {
    id:          'auto-checkpoint',
    titulo:      'Auto-checkpoint — síntese e documentos do que foi feito',
    // Roda na **V1**, o único assim. Bate por HTTP em `POST /v2/system/heartbeat`,
    // igual ao Guardian — a V1 não escreve no schema `v2`, e não é para começar.
    //
    // Entrou em 2026-09-06 porque ele era o **maior consumidor de LLM da plataforma**
    // e não aparecia em painel nenhum: se parasse, ninguém saberia. Mesmo silêncio que
    // deixou o agent desktop 28h fora no dia anterior.
    onde:        'api',
    tickMs:      10 * MIN,
    beatEveryMs: 10 * MIN,
    // Folga de um tick inteiro: a varredura percorre todos os projetos `active` e
    // sincroniza uma síntese por projeto, então um ciclo carregado atrasa o próximo.
    graceMs:     10 * MIN,
    desligarCom: 'SMART_CHECKPOINT_ENABLED=false',
  },
  {
    id:          'handoff-reconciliation',
    titulo:      'Reconciliacao de handoff — o efeito esta mesmo la?',
    // Roda na **V1**, como o auto-checkpoint, e bate por HTTP pelo mesmo contrato.
    //
    // `reconciling` e estado de passagem: sem alguem para resolve-lo o envelope fica ali para
    // sempre, dizendo "estou verificando" sobre algo que ninguem verifica — a forma exata das
    // tres tarefas presas em `processing` desde 17/06 que o A05 consertou.
    onde:        'api',
    tickMs:      1 * MIN,
    beatEveryMs: 1 * MIN,
    // Folga de um tick: cada envelope parado custa uma ida ao agent, e uma varredura com
    // varios deles empurra a proxima.
    graceMs:     1 * MIN,
    desligarCom: 'HANDOFF_RECONCILIATION_ENABLED=false',
  },
  {
    id:          'memory-backfill',
    titulo:      'Backfill de memória — aprendizado ganha ciclo de vida',
    onde:        'api-v2',
    tickMs:      15 * MIN,
    beatEveryMs: 15 * MIN,
    graceMs:     10 * MIN,
    desligarCom: 'MEMORY_BACKFILL_ENABLED=false',
  },
  {
    id:          'guardian',
    titulo:      'Guardian — risco da mudança antes do push',
    onde:        'agent',
    tickMs:      30_000,
    // Roda no agent desktop, processo separado: bate por HTTP em
    // `POST /v2/system/heartbeat`. Consequência assumida — o que o painel mede é
    // "última notícia", não "vivo". Como todo o produto do Guardian trafega pelo
    // mesmo canal, silêncio aqui significa valor entregue zero de qualquer forma.
    beatEveryMs: 5 * MIN,
    graceMs:     15 * MIN,
    desligarCom: 'AGENT_GUARDIAN_ENABLED=false',
  },
  {
    id:          'panorama',
    titulo:      'Panorama — a V1 continua de pé?',
    onde:        'api-v2',
    tickMs:      5 * MIN,
    // Existe porque NADA ficava vermelho quando a api V1 caía: os quatro invariantes que a sondam
    // devolvem "inconclusivo = ok" quando ela cala, e os outros não dependem dela. V1 fora com o
    // Postgres de pé deixava 18 de 18 verdes — ver `panorama/alerta-de-panorama.ts`.
    //
    // 5 min é o ritmo do `deploy-drift`, que observa uma falha da mesma família.
    beatEveryMs: 5 * MIN,
    graceMs:     15 * MIN,
    desligarCom: 'PANORAMA_CYCLE_ENABLED=false',
  },
  {
    id:          'deploy-drift',
    titulo:      'Deploy trocou o container — imagem no ar é a construída',
    onde:        'agent',
    tickMs:      5 * MIN,
    // Roda no agent-SERVER, não no desktop: é o único com `docker.sock` e o repositório
    // montado. O `api-v2` não tem nenhum dos dois de propósito, e dar-lhe o socket
    // trocaria um sensor por escalada de privilégio.
    //
    // Existe porque "build feito, troca não" aconteceu duas vezes — 17/08 e 10/09 — e as
    // duas com o mesmo disfarce: `docker compose ps` mostrando tudo `Up (healthy)` com o
    // código velho no ar.
    beatEveryMs: 5 * MIN,
    graceMs:     15 * MIN,
    desligarCom: 'AGENT_DEPLOY_DRIFT_ENABLED=false',
  },
  {
    id:          'catalog-drift',
    titulo:      'Catálogo de ações em dia com o código — divergência vira proposta',
    onde:        'agent',
    tickMs:      6 * 60 * MIN,
    // S2 (15/11): o primeiro sinal que vira PROPOSTA em vez de alerta. Divergiu, envia um
    // envelope de sessão (um toque no Hub) que regenera e commita só `docs/agent-actions.md`.
    // No agent-server pelo mesmo motivo do `deploy-drift`: repositório montado, só leitura.
    beatEveryMs: 6 * 60 * MIN,
    graceMs:     2 * 60 * MIN,
    desligarCom: 'AGENT_CATALOG_DRIFT_ENABLED=false',
  },
  {
    id:          'backup-verificado',
    titulo:      'Backup verificado diário (Postgres, Redis, Hermes) com restauração de prova',
    onde:        'agent',
    tickMs:      24 * 60 * MIN,
    // Cron do HOST às 06:15 (`infra/backup/scheduled-backup.sh`), não um processo do Rayzen —
    // `onde: 'agent'` é o mais próximo do catálogo: bate de fora, com AGENT_TOKEN.
    //
    // Entrou em 15/11/2026: o backup falhou todo dia de 14/10 a 15/11 (sockets do `hermes
    // gateway` abortavam a cópia) e o resultado só existia em `latest-run.env`, que ninguém lia.
    // 33 dias sem backup, painel verde.
    beatEveryMs: 24 * 60 * MIN,
    graceMs:     6 * 60 * MIN,
    desligarCom: 'remover a linha do crontab do servidor',
  },
  {
    id:          'limpeza-workspaces',
    titulo:      'Pastas de sessão em ~/workspaces — apagadas após merge, PR fechado ou 24 h sem PR',
    onde:        'agent',
    tickMs:      60 * MIN,
    // 17/11: decisão do Marcelo. Roda no agent-server (o único com a sandbox). O detalhe traz
    // `{ vistas, apagadas, mantidas, inconclusivas }` — PR aberto e GitHub sem resposta MANTÊM.
    beatEveryMs: 60 * MIN,
    graceMs:     30 * MIN,
    desligarCom: 'AGENT_LIMPEZA_WORKSPACES_ENABLED=false',
  },
  {
    id:          'rotinas',
    titulo:      'Rotinas — dispara as de agenda e propõe sessões para aprovação',
    // G6, fatia 5 (21/11). Roda na V1 e bate por HTTP, como o auto-checkpoint. Só CRIA envelopes:
    // a sessão continua precisando do toque do Marcelo. O detalhe traz varridas e disparadas,
    // para "vivo e sem nada vencido" não se confundir com "parado".
    onde:        'api',
    tickMs:      MIN,
    beatEveryMs: MIN,
    graceMs:     2 * MIN,
    desligarCom: 'ROTINAS_CYCLE_ENABLED=false',
  },
] as const

export const COMPONENTE_POR_ID = new Map(COMPONENTES.map((c) => [c.id, c]))
