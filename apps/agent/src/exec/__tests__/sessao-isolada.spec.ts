import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  modoIsoladoLigado, prerequisitos, caminhoDoScript, caminhoDoWorkspace,
  instrucoesDeBundle, lerDesde,
} from '../sessao-isolada'

/**
 * A Fase 4-B move a sessão supervisionada para a conta `RayzenExec`. Estes testes protegem as
 * decisões que a MEDIÇÃO de 11/09 produziu — cada uma delas contraria uma intuição razoável,
 * e por isso voltaria sozinha numa refatoração distraída.
 */
describe('sessão isolada — o interruptor', () => {
  /**
   * Só `'true'` liga. Qualquer outro valor deixa no regime local, que é o que funciona hoje.
   * Ligar por engano não é um detalhe: com a conta indisponível a sessão para, por desenho.
   */
  it.each([
    ['true', true], ['false', false], ['1', false], ['TRUE', false], [undefined, false],
  ])('AGENT_SESSAO_ISOLADA=%s → %s', (valor, esperado) => {
    expect(modoIsoladoLigado({ AGENT_SESSAO_ISOLADA: valor } as NodeJS.ProcessEnv)).toBe(esperado)
  })
})

describe('sessão isolada — pré-requisitos', () => {
  /**
   * Devolve a LISTA, não um booleano. "A conta não está pronta" não diz qual dos seis
   * requisitos faltou, e quem lê a mensagem é quem vai consertar — mesmo motivo pelo qual os
   * invariantes do sistema carregam `detalhe`.
   */
  it('devolve os problemas nomeados, não um sim/não', () => {
    const problemas = prerequisitos('projeto-que-nao-existe')
    expect(Array.isArray(problemas)).toBe(true)
    if (problemas.length > 0) {
      expect(problemas.join(' ')).toMatch(/ausente|Windows/)
    }
  })

  it('aponta o workspace que faltou pelo caminho completo', () => {
    const problemas = prerequisitos('projeto-que-nao-existe')
    const esperado = caminhoDoWorkspace('projeto-que-nao-existe')
    expect(problemas.some((p) => p.includes(esperado)) || process.platform !== 'win32').toBe(true)
  })

  /**
   * Os dois `.ps1` são parte do caminho de execução, não anexo de documentação: sem eles a
   * sessão isolada não roda. Resolvidos a partir do módulo, nunca do cwd — o agent roda de
   * vários diretórios.
   */
  it.each(['sessao-isolada-lancar', 'sessao-isolada-runner'] as const)(
    'o script %s existe onde o módulo o procura',
    (nome) => expect(readFileSync(caminhoDoScript(nome), 'utf8').length).toBeGreaterThan(0),
  )
})

describe('sessão isolada — leitura do log ao vivo', () => {
  /**
   * O streaming do log atravessa uma fronteira de CONTA: quem escreve é `RayzenExec`, quem lê
   * é o dono. Medido em 11/09 que a leitura funciona (10 tamanhos distintos, zero erro de
   * compartilhamento); o que estes testes guardam é a aritmética do deslocamento, que é onde
   * um erro silencioso duplicaria ou engoliria pedaço de saída.
   */
  const dir = mkdtempSync(join(tmpdir(), 'rayzen-log-'))
  const log = join(dir, 'sessao.log')

  it('lê só o que apareceu desde a última leitura', () => {
    writeFileSync(log, 'primeira\n', 'utf8')
    const a = lerDesde(log, 0)
    expect(a.texto).toBe('primeira\n')

    appendFileSync(log, 'segunda\n', 'utf8')
    const b = lerDesde(log, a.fim)
    expect(b.texto).toBe('segunda\n')      // nunca repete o que já entregou
    expect(b.fim).toBeGreaterThan(a.fim)
  })

  it('sem novidade devolve vazio e não move o deslocamento', () => {
    const a = lerDesde(log, 0)
    const b = lerDesde(log, a.fim)
    expect(b.texto).toBe('')
    expect(b.fim).toBe(a.fim)
  })

  /**
   * Arquivo ausente é o estado NORMAL no começo: a conta ainda não criou o log. Lançar aqui
   * derrubaria a sessão por uma corrida de milissegundos.
   */
  it('arquivo que ainda não existe não é erro', () => {
    expect(lerDesde(join(dir, 'nao-existe.log'), 0)).toEqual({ texto: '', fim: 0 })
  })
})

describe('sessão isolada — como o trabalho volta', () => {
  const base = 'c50a957aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const bundle = 'C:\\RayzenExec\\outbox\\rayzen-ai-20260911-1200.bundle'
  const texto = instrucoesDeBundle(bundle, 3, base)

  it.each([
    ['verificar antes de trazer', /git bundle verify/],
    ['buscar para uma ref isolada', /git fetch .* HEAD:refs\/rayzenexec\//],
    ['ver o que mudou', /git diff c50a957/],
    ['descartar', /git update-ref -d/],
  ])('traz o comando para %s', (_rotulo, padrao) => expect(texto).toMatch(padrao))

  /**
   * O contrato é *revisa e traz*, nunca automático. Um `git merge` nestas instruções seria o
   * plano virando outra coisa em silêncio.
   */
  it('não sugere merge em lugar nenhum', () => {
    expect(texto).not.toMatch(/git merge/)
  })

  it('diz que a árvore de quem revisa não foi tocada', () => {
    expect(texto).toMatch(/Nada foi escrito no seu diretório de trabalho/)
  })

  /**
   * Zero commit não é erro — a sessão pode terminar sem produzir código. O que seria erro é
   * prometer um bundle que não existe.
   */
  it('sem commit, diz isso em vez de apontar para um bundle vazio', () => {
    const vazio = instrucoesDeBundle(null, 0, base)
    expect(vazio).toMatch(/não produziu commit/)
    expect(vazio).not.toMatch(/git fetch/)
  })
})

describe('sessão isolada — o que os .ps1 não podem voltar a fazer', () => {
  /**
   * Asserção sobre o CÓDIGO, com os comentários fora.
   *
   * A primeira versão destes testes reprovou duas vezes na própria documentação: o script
   * explica por que NÃO usa `Tee-Object` e por que NÃO adiciona `safe.directory`, e a busca
   * ingênua achava a citação. É a mesma armadilha já registrada em
   * `supervised-session-permissoes.spec.ts`.
   *
   * Tirar o comentário também torna a asserção POSITIVA honesta: um comentário citando
   * `& claude @argumentos` deixa de bastar para provar que a chamada existe.
   */
  const soCodigo = (texto: string) =>
    texto.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')

  const runner  = soCodigo(readFileSync(caminhoDoScript('sessao-isolada-runner'), 'utf8'))
  const lancar  = soCodigo(readFileSync(caminhoDoScript('sessao-isolada-lancar'), 'utf8'))

  /**
   * `Tee-Object` do PowerShell 5.1 não aceita `-Encoding` e grava UTF-16. Anexado a um log
   * UTF-8, produz um arquivo com duas codificações dentro: ele CRESCE normalmente, a leitura
   * ao vivo funciona, e nenhuma linha casa com o que se espera. Custou uma rodada inteira de
   * medição em 11/09 — a sonda acusou "0 de 8 linhas" com o arquivo cheio.
   */
  it('o runner não usa Tee-Object — ele grava UTF-16 e corrompe o log', () => {
    expect(runner).not.toMatch(/Tee-Object/)
    expect(runner).toMatch(/Add-Content -LiteralPath \$Log .* -Encoding utf8/)
  })

  /**
   * O prompt é texto de terceiro por definição. Ele entra por ARQUIVO e chega ao `claude` como
   * um elemento de array — nunca dentro de uma string de comando. É a mesma regra de
   * `executar-helper.ts`: tira-se o texto do caminho em vez de escapá-lo melhor.
   */
  it('o prompt chega por arquivo e vai por splat, nunca montado numa linha de comando', () => {
    expect(runner).toMatch(/Get-Content -LiteralPath \(Join-Path \$Trabalho 'prompt\.txt'\) -Raw -Encoding UTF8/)
    expect(runner).toMatch(/& claude @argumentos/)
  })

  it('nenhum dos dois usa -Command, que receberia texto para interpretar', () => {
    expect(lancar).not.toMatch(/'-Command'/)
    expect(lancar).toMatch(/'-File'/)
  })

  /**
   * As listas de ferramentas têm o TypeScript como fonte única. Uma cópia dentro do `.ps1` é
   * duas listas divergindo — o mesmo defeito de `taskTypes` duplicado entre QA Scientist e
   * invariantes, em que um valida contra uma lista e o outro roda contra outra.
   */
  it('o runner não carrega cópia própria das listas de ferramentas', () => {
    expect(runner).not.toMatch(/Bash\(git push/)
    expect(runner).not.toMatch(/--dangerously-skip-permissions/)
    expect(runner).toMatch(/permitidas\.txt/)
    expect(runner).toMatch(/negadas\.txt/)
  })

  /**
   * `git` recusa operar na árvore da outra conta com *dubious ownership*, e a sugestão dele —
   * `safe.directory` — desfaria parte do isolamento: um `.git/config` escrito pela conta
   * passaria a ser executado com a identidade de quem revisa.
   */
  it('nenhum dos dois adiciona safe.directory para calar o git', () => {
    expect(runner).not.toMatch(/safe\.directory/)
    expect(lancar).not.toMatch(/safe\.directory/)
  })

  /**
   * `Start-Process -Credential -Wait` devolve ACESSO NEGADO ao monitorar processo de outra
   * conta — e devolve DEPOIS de o trabalho ter sido feito (medido em 09/09). Esperar pelo
   * mecanismo dá falso negativo; esperar pelo resultado, não.
   */
  it('o lançador espera pela marca, nunca por -Wait', () => {
    expect(lancar).not.toMatch(/-Wait/)
    expect(lancar).toMatch(/\$Marca/)
  })

  /**
   * `Write-Error` sob `$ErrorActionPreference = 'Stop'` **encerra o script na hora**: o
   * `exit <código>` escrito depois nunca roda, e o processo sai sempre com 1. Medido em
   * 11/09 validando a recusa de canal aberto — a guarda funcionava, o código declarado era
   * ficção. Mesma família do `%PAUSA% & exit /b 1` do autostart, em que o `rem` comia o
   * `exit` da própria linha.
   */
  it('o lançador não usa Write-Error, que mataria o código de saída que ele declara', () => {
    expect(lancar).not.toMatch(/Write-Error/)
    expect(lancar).toMatch(/function Parar/)
  })

  /**
   * O canal público leva o prompt da sessão e um bundle de 21 MB com o repositório privado.
   * A conferência é por SID porque `BUILTIN\Usuários` tem outro nome em cada idioma do
   * Windows — e um script que depende do idioma passa verde na máquina errada.
   */
  it('o lançador recusa canal aberto, conferindo por SID e não por nome', () => {
    expect(lancar).toMatch(/S-1-5-32-545/)   // Usuários
    expect(lancar).toMatch(/S-1-1-0/)        // Todos
    expect(lancar).toMatch(/SecurityIdentifier/)
    expect(lancar).not.toMatch(/-contains 'BUILTIN/)
  })

  /** O bundle é incremental de propósito: um completo aplicaria mesmo com as bases divergidas. */
  it('a entrega é incremental, não um bundle completo', () => {
    expect(runner).toMatch(/bundle create \$destino "\$base\.\.HEAD"/)
  })

  /**
   * `git clean -x` apagaria `node_modules` a cada preparação de sessão. `-fd` limpa sobra de
   * sessão anterior sem transformar cada início em uma reinstalação de dependências.
   */
  it('a limpeza de workspace não leva node_modules junto', () => {
    expect(runner).toMatch(/git clean -fd\b/)
    expect(runner).not.toMatch(/git clean -fdx/)
  })
})

describe('supervised-session — o modo isolado falha fechado', () => {
  const fonte = readFileSync(join(__dirname, '..', '..', 'actions', 'supervised-session.ts'), 'utf8')

  /**
   * Com o modo ligado e a conta indisponível, a sessão PARA. Cair de volta para o usuário do
   * dono desfaria o isolamento exatamente quando ninguém está olhando, e a sessão continuaria
   * reportando sucesso — o formato de mentira que esta casa pagou três vezes num dia (09/09).
   */
  it('pré-requisito ausente encerra a sessão em vez de rodar como o dono', () => {
    const bloco = fonte.match(/const problemas = prerequisitos\(\)[\s\S]{0,400}/)?.[0] ?? ''
    expect(bloco).toMatch(/return \{ ok: false/)
    expect(bloco).not.toMatch(/criarWorktree/)
  })

  /** O worktree é o isolamento do modo LOCAL. Criá-lo no modo isolado seria trabalho em duas árvores. */
  it('o worktree só é criado no regime local', () => {
    // `await`: criarWorktree() virou async na Fase 1 (migrado para executarPrograma()).
    expect(fonte).toMatch(/} else \{[\s\S]{0,300}worktree = await criarWorktree\(base, sessionId\)/)
  })

  /** O diff do card de aprovação não pode vir de `git` rodado pelo dono na árvore da conta. */
  it('no modo isolado o diff vem da conta, não do git do dono', () => {
    expect(fonte).toMatch(/isolado \? diffDaConta : getGitDiff\(cwd,/)
  })

  /**
   * Nos DOIS modos o diff compara contra o HEAD de antes da etapa, nunca contra `HEAD`. Com
   * `Bash(git commit:*)` na lista de permitidas, a sessão commitar é o caminho comum — e
   * contra o próprio commit `git diff HEAD` devolve vazio. O card ficaria em branco
   * exatamente no passo que produziu código. Medido em 11/09.
   */
  it('o diff do card compara contra o início da etapa, não contra HEAD', () => {
    expect(fonte).toMatch(/const headDaEtapa = isolado \? '' : headAtual\(cwd\)/)
    expect(fonte).toMatch(/rodar\(\['diff', '--stat', desde \?\? 'HEAD'\]\)/)
  })

  /** Sessão concluída cujo bundle não atravessou precisa dizer ONDE o trabalho ficou. */
  it('falha na entrega não vira sessão perdida em silêncio', () => {
    expect(fonte).toMatch(/a entrega do bundle falhou/)
  })
})
