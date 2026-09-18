import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

/**
 * ── A identidade do Rayzen, uma só, lida do disco ────────────────────────────
 *
 * Até 14/09 havia duas: `rayzen.config.json → identity.personality` no orquestrador V1 (que é
 * quem responde no Telegram e na web) e `SOUL.md` no Hermes. Tom, vocabulário e regras
 * diferentes no mesmo produto — perguntado "quem é você?" pelo Telegram, o Rayzen respondia
 * "Sou Rayzen-AI, o agente operacional principal da plataforma", enquanto o Hermes dizia "Sou o
 * Rayzen, assistente pessoal de IA de Marcelo".
 *
 * Pior que a divergência de tom: a `personality` mandava *"sempre que possível, apresentar
 * resultado em formato operacional: decisão, plano, checklist…"*. Convivia com "não inventa
 * fatos", mas **proibição abstrata perde para instrução concreta** — o modelo preenchia o
 * formulário, e daí saíram um `decision_log.db`, um watchdog de `buildkitd` que não existe e uma
 * branch `release/R3.b` que nunca existiu.
 *
 * Fonte única em `core/identity/rayzen.soul.md`, alcançada pelos dois runtimes: a api a copia
 * para a imagem, o Hermes a monta por bind `:ro`. Um arquivo, dois leitores — melhor que as
 * cópias anti-drift de `memory-ranking.const.ts`, que existem só porque lá não há um caminho
 * comum.
 */

/** Onde o arquivo mora, a partir da raiz do repositório. */
export const CAMINHO_SOUL = join('core', 'identity', 'rayzen.soul.md')

/**
 * O processo roda com cwd diferente conforme o ambiente: `/app` no container (o CMD faz
 * `cd /app` antes do `node`), e `apps/api` em desenvolvimento. Subir a partir de `__dirname`
 * cobre os dois sem depender de quem chamou.
 */
function candidatos(): string[] {
  const deCwd = resolve(process.cwd(), CAMINHO_SOUL)
  const subindo = Array.from({ length: 6 }, (_, i) =>
    resolve(__dirname, ...Array(i + 1).fill('..'), CAMINHO_SOUL),
  )
  return [deCwd, ...subindo]
}

let cache: string | null = null

/**
 * Lê o SOUL uma vez e guarda. Devolve `''` quando não encontra — quem chama decide, e o
 * `OrchestratorService` avisa alto em vez de seguir calado com identidade vazia: identidade que
 * some sem ninguém notar é o mesmo modo de falha do `TELEGRAM_API_TOKEN` que nunca existiu.
 */
export function carregarSoul(): string {
  if (cache !== null) return cache

  for (const caminho of candidatos()) {
    if (existsSync(caminho)) {
      cache = readFileSync(caminho, 'utf8').trim()
      return cache
    }
  }

  cache = ''
  return cache
}

/** Só para teste — o cache é proposital em produção. */
export function limparCacheDoSoul(): void {
  cache = null
}
