import { request } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { beatComponente } from './system-heartbeat-client'

/**
 * "Build feito, troca não" — o deploy que constrói a imagem e não recria o container.
 *
 * ## A falha, duas vezes com 24 dias de intervalo
 *
 * **2026-08-17:** imagens `api` e `api-v2` construídas com o código novo (02:07 e 00:47
 * UTC) e os containers continuavam os de 16/08 17:13. **2026-09-10:** o mesmo — imagens
 * de 03:24, containers de 25 horas antes.
 *
 * O sintoma é o pior possível: **produção em código velho com tudo `Up (healthy)`**.
 * `docker compose ps` mostra os três saudáveis, o painel fica verde, os invariantes
 * passam, e o código que você acabou de empurrar simplesmente não está no ar.
 *
 * ## A causa, medida em 10/09
 *
 * `triggerRemoteBuild()` em `rayzen-mcp-http.mjs` roda o deploy por SSH com
 * `execFile(..., { timeout: 600_000 })`. Quando o build é **frio** — qualquer commit que
 * toque `package.json` invalida a camada de dependências — os 10 minutos estouram durante
 * o build. O `execFile` mata o cliente SSH; o **daemon do Docker continua** e termina as
 * imagens sozinho, mas o `up -d` que viria depois nunca executa.
 *
 * Por isso a assinatura é sempre a mesma: imagem nova, container velho, nenhum erro
 * visível. O log do `mcp-http` registrava `[webhook] build remoto falhou` — num log de
 * container que ninguém lê.
 *
 * ## Por que este sensor vive no agent-server, e não nos invariantes
 *
 * O `api-v2` é deliberadamente isolado: **sem socket do Docker, sem mounts, sem `.git`,
 * sem `git`, sem label de commit**. Ele não tem como responder "o container roda a imagem
 * atual?" — e dar-lhe o socket seria trocar um sensor por escalada de privilégio, já que
 * acesso ao socket é root no host.
 *
 * O `agent-server` já tem os dois acessos, concedidos para outra finalidade e auditados:
 * `docker.sock` (rw) e o repositório montado **read-only**. Este sensor usa o que já
 * existe e não pede nada novo.
 *
 * ## Por que não no `pnpm check:local`
 *
 * Seria mais barato e roda só quando alguém manda — e a lição desta casa é que **sensor
 * que só liga quando alguém olha não é sensor**. Foi assim que o relógio do servidor
 * derrapou 8h43m em 14/08 sem ninguém saber: o check existia e o watcher estava parado.
 */

/** Serviços que o webhook constrói — são exatamente os que podem ficar para trás. */
const SERVICOS = ['api', 'api-v2', 'web'] as const

const DOCKER_SOCK = '/var/run/docker.sock'
const TICK_MS     = 5 * 60 * 1000

export interface DeriveDeDeploy {
  servico:   string
  container: string | null
  imagem:    string | null
  divergiu:  boolean
}

/**
 * Chama a API do Docker pelo socket unix. Sem dependência nova: `http.request` aceita
 * `socketPath`, e o daemon fala HTTP/1.1 comum.
 */
function docker<T>(caminho: string, timeoutMs = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    const req = request(
      { socketPath: DOCKER_SOCK, path: caminho, method: 'GET', timeout: timeoutMs },
      (res) => {
        let corpo = ''
        res.on('data', (c) => { corpo += c })
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null)
          try { resolve(JSON.parse(corpo) as T) } catch { resolve(null) }
        })
      },
    )
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

/** SHA do `main` no repositório montado — o commit que DEVERIA estar no ar. */
export function headDoRepo(raiz: string): string | null {
  const ref = join(raiz, '.git', 'refs', 'heads', 'main')
  if (!existsSync(ref)) return null
  try {
    const sha = readFileSync(ref, 'utf8').trim()
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : null
  } catch {
    return null
  }
}

/**
 * Compara, para cada serviço, a imagem que o container está RODANDO com a imagem que
 * existe hoje sob aquele nome.
 *
 * `null` em qualquer um dos lados devolve `divergiu: false` de propósito: não conseguir
 * medir não é o mesmo que estar errado. Mesma distinção estrutural dos invariantes —
 * inconclusivo nunca vira falha, senão o painel aprende a mentir na direção oposta.
 */
export async function medirDeriva(projeto = 'rayzen-ai'): Promise<DeriveDeDeploy[]> {
  const saida: DeriveDeDeploy[] = []

  for (const servico of SERVICOS) {
    const container = await docker<{ Image?: string }>(`/containers/${projeto}-${servico}-1/json`)
    const imagem    = await docker<{ Id?: string }>(`/images/${projeto}-${servico}/json`)

    const idContainer = container?.Image ?? null
    const idImagem    = imagem?.Id ?? null

    saida.push({
      servico,
      container: idContainer,
      imagem:    idImagem,
      divergiu:  Boolean(idContainer && idImagem && idContainer !== idImagem),
    })
  }

  return saida
}

/**
 * Uma rodada: mede e reporta.
 *
 * O `detalhe` traz `{ divergentes, servicos, head }` porque um contador de execuções não
 * é medida de trabalho — foi o que fez o QA Scientist bater `ok` por dias sem produzir
 * nada. Aqui, "3 serviços conferidos, 0 divergentes" é saudável e distinguível de "não
 * consegui conferir nenhum".
 */
export async function rodarUmaVez(raiz = process.env.AGENT_PROJECT_ROOT ?? ''): Promise<void> {
  let ok = false
  let erro: string | undefined
  let detalhe: Record<string, unknown> = {}

  try {
    const medidas     = await medirDeriva()
    const divergentes = medidas.filter((m) => m.divergiu)
    const medidos     = medidas.filter((m) => m.container && m.imagem)

    detalhe = {
      servicos:    medidos.length,
      divergentes: divergentes.length,
      head:        raiz ? headDoRepo(raiz) : null,
      quais:       divergentes.map((d) => d.servico),
    }

    if (divergentes.length > 0) {
      // `ok: false` com detalhe, e NÃO uma exceção: o ciclo rodou e mediu certo. O que
      // está errado é o mundo, não o sensor — a distinção aparece no painel.
      erro = `deploy não trocou o container: ${divergentes.map((d) => d.servico).join(', ')}`
    } else {
      ok = true
    }
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
  } finally {
    // `finally` porque um ciclo que lança antes de reportar fica idêntico a um que nunca
    // subiu — a regra do catálogo de componentes desta casa.
    await beatComponente('deploy-drift', { ok, erro, detalhe })
  }
}

/**
 * Só sobe no `agent-server`: o desktop não tem `docker.sock` nem o repositório do
 * servidor, e bateria "inconclusivo" para sempre.
 */
export function startDeployDriftSensor(): void {
  if (process.env.AGENT_ROLE !== 'server') return
  if (process.env.AGENT_DEPLOY_DRIFT_ENABLED === 'false') return
  if (!existsSync(DOCKER_SOCK)) {
    console.log('[deploy-drift] sem /var/run/docker.sock — sensor não sobe')
    return
  }

  console.log('[deploy-drift] sensor ativo — imagem vs container a cada 5 min')
  setInterval(() => { void rodarUmaVez() }, TICK_MS)
  void rodarUmaVez()
}
