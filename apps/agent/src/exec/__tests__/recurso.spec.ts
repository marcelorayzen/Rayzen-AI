import { join } from 'node:path'
import { recursoDaTarefa, comRecurso, recursosOcupados } from '../recurso'

/**
 * ── Posse por tarefa ≠ exclusão por recurso ──────────────────────────────────
 *
 * O A05 fechou a posse da TAREFA (claim atômico, lease renovado). O que ficou aberto é a disputa
 * pela mesma coisa física: `setInterval(poll, 3000)` não espera a volta anterior, então durante
 * uma sessão supervisionada de horas o agent reivindicava outra tarefa a cada 3 segundos, sem
 * teto e sem exclusão.
 *
 * Os testes de sobreposição são escritos para **falhar sem o mecanismo**: registram o instante de
 * entrada e saída de cada trabalho e afirmam que os intervalos não se cruzam. Sem `comRecurso`,
 * eles se cruzam — foi assim que foram validados.
 */
describe('recursoDaTarefa — quem disputa o quê', () => {
  it('ação que escreve num diretório se identifica pelo diretório', () => {
    expect(recursoDaTarefa('jarvis:git_commit', { path: join('C:', 'Projects', 'x') }))
      .toBe(recursoDaTarefa('jarvis:file_write', { path: join('C:', 'Projects', 'x') }))
  })

  it('diretórios diferentes não disputam', () => {
    const a = recursoDaTarefa('jarvis:git_commit', { path: join('C:', 'Projects', 'a') })
    const b = recursoDaTarefa('jarvis:git_commit', { path: join('C:', 'Projects', 'b') })
    expect(a).not.toBe(b)
  })

  /**
   * A mesma pasta escrita de dois jeitos precisa dar a mesma chave, senão a exclusão existe e
   * não exclui. É o mesmo cuidado das `SAFE_ROOTS`: comparação de caminho sem normalizar é
   * comparação de texto.
   */
  it('o mesmo diretório escrito de formas diferentes dá a mesma chave', () => {
    const cru  = recursoDaTarefa('jarvis:run_tests', { projectPath: join(process.cwd(), 'a', '..', 'a') })
    const puro = recursoDaTarefa('jarvis:run_tests', { projectPath: join(process.cwd(), 'a') })
    expect(cru).toBe(puro)
  })

  it('leitura não trava — quem só lê corre livre', () => {
    for (const acao of ['jarvis:list_dir', 'jarvis:file_read', 'jarvis:git_status', 'jarvis:git_log', 'jarvis:git_diff']) {
      expect(recursoDaTarefa(acao, { path: process.cwd() })).toBeNull()
    }
  })

  /**
   * As duas fotografam a TELA, não uma aba. O segundo `open(url)` troca o que está na tela
   * enquanto o primeiro ainda espera para fotografar — a evidência sai do teste errado.
   */
  it('screenshot e browse_and_screenshot disputam a tela', () => {
    expect(recursoDaTarefa('jarvis:screenshot', {})).toBe('tela')
    expect(recursoDaTarefa('jarvis:browse_and_screenshot', { url: 'http://x' })).toBe('tela')
  })

  it('ação que escreve e não disse onde cai no cwd, que é um diretório real e compartilhado', () => {
    expect(recursoDaTarefa('jarvis:git_commit', {}))
      .toBe(recursoDaTarefa('jarvis:run_command', {}))
  })

  it('ação sem recurso identificado corre livre', () => {
    expect(recursoDaTarefa('jarvis:get_system_info', {})).toBeNull()
    expect(recursoDaTarefa('jarvis:docker_ps', {})).toBeNull()
  })
})

describe('comRecurso — mesma chave não se sobrepõe', () => {
  /** Devolve um trabalho que registra quando entrou e quando saiu. */
  function trabalhoDe(janelas: Array<[number, number]>, duracaoMs: number) {
    return async () => {
      const entrou = Date.now()
      await new Promise((r) => setTimeout(r, duracaoMs))
      janelas.push([entrou, Date.now()])
    }
  }

  function houveSobreposicao(janelas: Array<[number, number]>): boolean {
    const ordenadas = [...janelas].sort((a, b) => a[0] - b[0])
    return ordenadas.some(([, fim], i) => i + 1 < ordenadas.length && ordenadas[i + 1][0] < fim)
  }

  it('duas tarefas na mesma chave rodam uma após a outra', async () => {
    const janelas: Array<[number, number]> = []

    await Promise.all([
      comRecurso('dir:/x', trabalhoDe(janelas, 40)),
      comRecurso('dir:/x', trabalhoDe(janelas, 40)),
    ])

    expect(janelas).toHaveLength(2)
    expect(houveSobreposicao(janelas)).toBe(false)
  })

  it('chaves diferentes correm em paralelo — travar demais seria o outro defeito', async () => {
    const janelas: Array<[number, number]> = []

    await Promise.all([
      comRecurso('dir:/a', trabalhoDe(janelas, 40)),
      comRecurso('dir:/b', trabalhoDe(janelas, 40)),
    ])

    expect(houveSobreposicao(janelas)).toBe(true)
  })

  it('chave nula não espera ninguém', async () => {
    const janelas: Array<[number, number]> = []

    await Promise.all([
      comRecurso(null, trabalhoDe(janelas, 40)),
      comRecurso(null, trabalhoDe(janelas, 40)),
    ])

    expect(houveSobreposicao(janelas)).toBe(true)
  })

  /**
   * Um `git_commit` que falha não é motivo para o `run_tests` seguinte nunca rodar — isso
   * transformaria o erro de uma tarefa em paralisia permanente do recurso.
   */
  it('falha de uma não paralisa a fila do recurso', async () => {
    const executou: string[] = []

    const primeira = comRecurso('dir:/x', async () => {
      executou.push('primeira')
      throw new Error('falhou')
    }).catch(() => undefined)

    const segunda = comRecurso('dir:/x', async () => { executou.push('segunda') })

    await Promise.all([primeira, segunda])
    expect(executou).toEqual(['primeira', 'segunda'])
  })

  it('o recurso é liberado ao fim — a fila não vaza', async () => {
    await comRecurso('dir:/efemero', async () => undefined)
    expect(recursosOcupados()).toBe(0)
  })
})
