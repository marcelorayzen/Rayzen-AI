import { createServer, Server } from 'node:net'
import { InvariantsService } from '../invariants.service'

/**
 * ── O sensor que faltava quando o Redis estava aberto ────────────────────────
 *
 * Medido em 16/09, de dentro do container do Hermes e **sem credencial nenhuma**:
 *
 *     PING          -> +PONG
 *     SCAN bull:*   -> bull:agent-tasks:<uuid> ... (31 chaves)
 *
 * `bull:agent-tasks` é a fila que o agent **desktop** reivindica e executa na máquina do Marcelo.
 * Quem alcança o Redis sem senha pode enfileirar um job — contornando inteiramente o escopo
 * somente-leitura do `MCP_TOKEN_HERMES`.
 *
 * Nenhum sensor perguntava isso. `infra_health` conferia se o Redis **responde**, que era
 * exatamente o sintoma de estar aberto: o painel ficava verde *porque* o furo existia.
 *
 * ── Por que um servidor de verdade no teste ─────────────────────────────────
 *
 * Um mock que devolve a string que eu escolher testaria o meu `if`, não o protocolo. O check abre
 * socket e lê bytes; o teste sobe um servidor TCP que fala as duas respostas reais do Redis
 * (`+PONG` e `-NOAUTH ...`) e confere que cada uma leva ao veredito certo — incluindo o caso em
 * que ninguém atende, que é **inconclusivo**, nunca aprovação.
 */
describe('redis_exige_senha', () => {
  let servidor: Server | null = null

  /** Sobe um Redis de mentira que responde sempre a mesma linha. */
  function servidorQueResponde(linha: string): Promise<number> {
    return new Promise((resolve) => {
      servidor = createServer((socket) => {
        socket.on('data', () => socket.write(linha))
      })
      servidor.listen(0, '127.0.0.1', () => resolve((servidor!.address() as { port: number }).port))
    })
  }

  function checar(porta: number) {
    process.env.REDIS_URL = `redis://127.0.0.1:${porta}`
    const service = new InvariantsService({} as never, {} as never, {} as never, {} as never)
    return (service as unknown as {
      redisExigeSenha: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).redisExigeSenha()
  }

  afterEach(() => {
    servidor?.close()
    servidor = null
    delete process.env.REDIS_URL
  })

  it('`-NOAUTH` é o estado correto — a porta está trancada', async () => {
    const r = await checar(await servidorQueResponde('-NOAUTH Authentication required.\r\n'))
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/exige autentica/i)
  })

  it('`+PONG` sem senha é FALHA, e o detalhe diz o que está exposto', async () => {
    const r = await checar(await servidorQueResponde('+PONG\r\n'))
    expect(r.ok).toBe(false)
    expect(r.detalhe).toMatch(/SEM autentica/i)
    // O que importa não é "redis aberto" — é o que isso alcança.
    expect(r.detalhe).toMatch(/bull:agent-tasks/)
    expect(r.detalhe).toMatch(/agent desktop/i)
  })

  it('a correção diz o comando que confirma o conserto', async () => {
    const r = await checar(await servidorQueResponde('+PONG\r\n'))
    expect(r.correcao).toMatch(/REDIS_PASSWORD/)
    expect(r.correcao).toMatch(/NOAUTH/)
  })

  /**
   * Não conseguir conectar não prova nada sobre a senha — pode ser rede, DNS interno ou container
   * reiniciando. Sensor que não consegue medir nunca condena nem absolve.
   */
  it('porta fechada é INCONCLUSIVO, não aprovação nem falha', async () => {
    // Porta alta sem ninguém escutando: conexão recusada de imediato.
    const r = await checar(59_999)
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/inconclusivo/i)
    expect(r.detalhe).not.toMatch(/exige autentica/i)
  })

  it('resposta que não se sabe ler também é inconclusiva', async () => {
    const r = await checar(await servidorQueResponde('-ERR alguma outra coisa\r\n'))
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/inconclusivo/i)
  })
})
