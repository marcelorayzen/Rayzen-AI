import {
  EstadoDoHandoff, TRANSICOES, podeTransicionar, ehFinal, ESTADOS_FINAIS,
  hashDoConteudo, chaveDeIdempotencia, ConteudoDoHandoff,
} from '../handoff.const'

const base: ConteudoDoHandoff = {
  name: 'Projeto X',
  brief: 'Um sistema para medir o que hoje é palpite.',
  template: 'rayzen',
  root: 'C:/Users/dev/Projects',
  efeitos: [{ actionKey: 'jarvis:create_project_folder', payload: { name: 'Projeto X', template: 'rayzen' } }],
}

describe('máquina de estados do handoff', () => {
  it('o caminho feliz atravessa do rascunho ao concluído', () => {
    const caminho: EstadoDoHandoff[] = [
      'draft', 'awaiting_approval', 'approved', 'queued', 'claimed', 'executing', 'reconciling', 'completed',
    ]
    for (let i = 0; i < caminho.length - 1; i++) {
      expect({ de: caminho[i], para: caminho[i + 1], ok: podeTransicionar(caminho[i], caminho[i + 1]) })
        .toEqual({ de: caminho[i], para: caminho[i + 1], ok: true })
    }
  })

  /**
   * O pulo que o envelope existe para impedir: sair do rascunho direto para a fila seria
   * executar o que ninguém aprovou.
   */
  it('não dá para enfileirar sem passar pela aprovação', () => {
    expect(podeTransicionar('draft', 'queued')).toBe(false)
    expect(podeTransicionar('awaiting_approval', 'queued')).toBe(false)
    expect(podeTransicionar('draft', 'completed')).toBe(false)
  })

  /**
   * `effect_unknown` NÃO é final — a lição da Fase 1. O caminho de saída dele é reconciliação
   * humana; tratá-lo como fim devolveria a tarefa órfã que a matriz de crash existe para negar.
   */
  it('effect_unknown continua tendo para onde ir', () => {
    expect(ehFinal('effect_unknown')).toBe(false)
    expect(TRANSICOES.effect_unknown.length).toBeGreaterThan(0)
    expect(podeTransicionar('effect_unknown', 'compensated')).toBe(true)
    expect(podeTransicionar('effect_unknown', 'completed')).toBe(true)
  })

  it('estado final não transiciona para lugar nenhum', () => {
    for (const final of ESTADOS_FINAIS) {
      expect({ final, saidas: TRANSICOES[final] }).toEqual({ final, saidas: [] })
    }
  })

  /** Cancelar é legítimo enquanto nada foi executado, e deixa de ser depois. */
  it('cancelar vale até a fila, não depois de reivindicado', () => {
    expect(podeTransicionar('queued', 'cancelled')).toBe(true)
    expect(podeTransicionar('claimed', 'cancelled')).toBe(false)
    expect(podeTransicionar('executing', 'cancelled')).toBe(false)
  })

  /** Voltar ao rascunho é permitido — e é justamente o que sobe a versão e invalida o aceite. */
  it('uma revisão pedida volta para rascunho', () => {
    expect(podeTransicionar('awaiting_approval', 'draft')).toBe(true)
  })
})

describe('hashDoConteudo — o que foi aprovado é o que vai rodar', () => {
  it('ordem de chave no payload não muda o envelope', () => {
    const outro: ConteudoDoHandoff = {
      ...base,
      efeitos: [{ actionKey: 'jarvis:create_project_folder', payload: { template: 'rayzen', name: 'Projeto X' } }],
    }
    expect(hashDoConteudo(outro)).toBe(hashDoConteudo(base))
  })

  it.each([
    ['name', { name: 'Outro' }],
    ['brief', { brief: 'outro brief' }],
    ['template', { template: 'node' }],
    ['root', { root: 'C:/Users/dev/Documents' }],
  ])('mudar %s muda o hash', (_campo, patch) => {
    expect(hashDoConteudo({ ...base, ...patch } as ConteudoDoHandoff)).not.toBe(hashDoConteudo(base))
  })

  /**
   * O caso que o hash existe para pegar: aprovar um efeito e materializar outro. Sem isto, o
   * envelope seria um rótulo sobre um payload trocável.
   */
  it('trocar o efeito depois do aceite muda o hash', () => {
    const trocado: ConteudoDoHandoff = {
      ...base,
      efeitos: [{ actionKey: 'jarvis:file_delete', payload: { path: 'C:/x' } }],
    }
    expect(hashDoConteudo(trocado)).not.toBe(hashDoConteudo(base))
  })

  it('mudar um argumento DENTRO do efeito muda o hash', () => {
    const outro: ConteudoDoHandoff = {
      ...base,
      efeitos: [{ actionKey: 'jarvis:create_project_folder', payload: { name: 'Projeto X', template: 'python' } }],
    }
    expect(hashDoConteudo(outro)).not.toBe(hashDoConteudo(base))
  })
})

describe('chaveDeIdempotencia', () => {
  /** Reentrega do mesmo envelope é replay; é o "repetição não duplica pasta ou registro". */
  it('o mesmo handoff na mesma versão dá a mesma chave', () => {
    expect(chaveDeIdempotencia('h1', 1)).toBe(chaveDeIdempotencia('h1', 1))
  })

  /**
   * Envelope editado é outro pedido. Reaproveitar a chave faria o broker devolver replay da
   * execução anterior, e a edição nunca aconteceria — sem erro nenhum.
   */
  it('versão nova dá chave nova', () => {
    expect(chaveDeIdempotencia('h1', 2)).not.toBe(chaveDeIdempotencia('h1', 1))
  })

  it('handoffs diferentes nunca colidem', () => {
    expect(chaveDeIdempotencia('h1', 1)).not.toBe(chaveDeIdempotencia('h2', 1))
  })
})
