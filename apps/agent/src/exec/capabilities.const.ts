import type { EspecificacaoDeParam } from './validador'
import { validar } from './validador'

/**
 * Fase 2 do plano de execução tipada — capabilities no lugar de `ALLOW_RULES` (regex sobre
 * texto). O chamador manda `{ capability: 'docker.images', params: {} }`, nunca uma linha de
 * comando — o argv é montado por código nosso a partir de valores já validados.
 *
 * ## Por que o primeiro lote é só `docker.*`
 *
 * O plano manda medir uso real antes de migrar (`agent_audit_logs`), e a medição em 11/09
 * achou a tabela morta há 3 meses — sem sinal para ranquear por frequência. O critério que
 * sobra é risco: começar pelas `risk: 'none'` do `ALLOW_RULES` antigo.
 *
 * Mas metade delas é FICÇÃO nesta máquina. Medido em 11/09 (`Get-Command`, a mesma resolução
 * de PATH que `executarPrograma` usa): `grep`, `wc`, `env`, `printenv` **não existem** aqui, e
 * `find` resolve para `C:\Windows\system32\find.exe` — que busca TEXTO dentro de arquivo,
 * não arquivo por nome, o oposto do `find` do Unix que a regra original presumia. A família
 * `fs-read`/`shell-read` do `ALLOW_RULES` era, na prática, um comando que sempre falhava com
 * "não reconhecido" — construir capability para isso seria a mesma imaginação que o plano
 * pede para evitar, só que travestida de tipo.
 *
 * `git-read` (status/log/diff/branch/show) também fica de fora — é REDUNDANTE com as ações
 * tipadas que já existem (`jarvis:git_status`, `git_log`, `git_diff`, `git_branch`), migradas
 * na Fase 1 (achado emergencial de `git.ts`). Duplicar como capability seria dois caminhos
 * para a mesma coisa, um deles sem motivo de existir.
 *
 * O que sobra, medido e real: `docker.exe` existe (`C:\Program Files\Docker\Docker\...`), e
 * `jarvis:docker_ps`/`docker_logs` (Fase 1, `docker.ts`) não cobrem `images`, `stats`,
 * `inspect` nem `compose ps/logs/config` — capability nova para o que falta, não para o que
 * já tem dono.
 */

export interface Capability {
  readonly id: string
  readonly programa: string
  readonly argv: (params: Readonly<Record<string, string | number>>) => string[]
  readonly params: Readonly<Record<string, EspecificacaoDeParam>>
  readonly opcionais?: Readonly<Record<string, true>>
  readonly risco: 'none' | 'low' | 'medium' | 'high'
  readonly descricao: string
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'docker.images', programa: 'docker',
    argv: () => ['images'], params: {}, risco: 'none',
    descricao: 'Lista imagens Docker locais.',
  },
  {
    id: 'docker.stats', programa: 'docker',
    // `--no-stream`: sem isso o comando fica em loop imprimindo a cada intervalo e nunca
    // sai sozinho — o processo-filho precisa terminar para `executarPrograma` resolver.
    argv: () => ['stats', '--no-stream'], params: {}, risco: 'none',
    descricao: 'Uso de CPU/memória dos containers em execução, uma leitura só.',
  },
  {
    id: 'docker.inspect', programa: 'docker',
    argv: (p) => ['inspect', String(p.container)],
    params: { container: { tipo: 'slug' } }, risco: 'none',
    descricao: 'Detalhes de um container ou imagem pelo nome.',
  },
  {
    id: 'docker.compose_ps', programa: 'docker',
    argv: () => ['compose', 'ps'], params: {}, risco: 'none',
    descricao: 'Status dos serviços do docker-compose no diretório atual.',
  },
  {
    id: 'docker.compose_logs', programa: 'docker',
    // `service` opcional: sem ele, `docker compose logs` mostra todos os serviços.
    argv: (p) => {
      const args = ['compose', 'logs', '--tail', '100']
      if (p.service !== undefined) args.push(String(p.service))
      return args
    },
    params: { service: { tipo: 'slug' } },
    opcionais: { service: true },
    risco: 'none',
    descricao: 'Últimas 100 linhas de log de um serviço do docker-compose (ou de todos).',
  },
  {
    id: 'docker.compose_config', programa: 'docker',
    argv: () => ['compose', 'config'], params: {}, risco: 'none',
    descricao: 'Configuração efetiva do docker-compose (após merge de overrides).',
  },
]

export function encontrarCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id)
}

/**
 * Valida TODOS os parâmetros de uma capability contra a declaração dela, e devolve os
 * valores já validados — nunca a string bruta do payload.
 *
 * Parâmetro desconhecido é erro, não é ignorado: um campo a mais no payload que ninguém usa
 * seria exatamente o tipo de superfície muda que este plano existe para eliminar — melhor
 * recusar alto do que aceitar em silêncio algo que não faz nada (ou que um dia passa a fazer).
 */
export function validarParams(
  cap: Capability,
  paramsBrutos: Readonly<Record<string, unknown>>,
): Record<string, string | number> {
  const validados: Record<string, string | number> = {}

  for (const [nome, spec] of Object.entries(cap.params)) {
    const presente = nome in paramsBrutos
    if (!presente) {
      if (cap.opcionais?.[nome]) continue
      throw new Error(`capability "${cap.id}": parâmetro obrigatório "${nome}" ausente.`)
    }
    validados[nome] = validar(spec, paramsBrutos[nome], nome)
  }

  for (const chave of Object.keys(paramsBrutos)) {
    if (!(chave in cap.params)) {
      throw new Error(`capability "${cap.id}": parâmetro desconhecido "${chave}".`)
    }
  }

  return validados
}
