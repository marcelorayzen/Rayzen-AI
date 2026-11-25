import { readFileSync } from 'fs'
import { join } from 'path'
import { carregarSoul, CAMINHO_SOUL } from '../soul'

/**
 * ── Uma identidade, dois runtimes (14/09) ────────────────────────────────────
 *
 * Perguntado "quem é você?" pelo Telegram, o Rayzen respondeu *"Sou Rayzen-AI, o agente
 * operacional principal da plataforma"* — que **não é** o SOUL aprovado horas antes. Havia duas
 * identidades vivendo em paralelo:
 *
 *  - `rayzen.config.json` → `identity.personality`, usada pelo orquestrador V1 (Telegram e web)
 *  - `infra/hermes/SOUL.md`, usada pelo Hermes
 *
 * Tom, vocabulário e regras diferentes, no mesmo produto. E a do config tinha uma instrução que
 * **empurra para inventar**: *"Sempre que possível, apresentar resultado em formato operacional:
 * decisão, plano, checklist…"*. Ela convive com *"não inventa fatos"*, mas proibição abstrata
 * perde para instrução concreta — o modelo preenche o formulário, e daí saíram `decision_log.db`,
 * um watchdog de `buildkitd` que não existe e a branch `release/R3.b` que nunca existiu.
 *
 * Fonte única em `core/identity/rayzen.soul.md`: o orquestrador lê do disco, o Hermes monta o
 * mesmo arquivo por bind `:ro`. Duplicar o texto garantiria drift — é a lição de
 * `memory-ranking.const.ts` e de `event-derived-text.const.ts`, só que aqui dá para ter UMA
 * cópia de verdade, porque os dois consumidores alcançam o mesmo arquivo.
 */
describe('identidade única — o SOUL é a fonte do system prompt', () => {
  it('o arquivo de identidade existe no caminho canônico', () => {
    expect(CAMINHO_SOUL).toMatch(/core[\\/]identity[\\/]rayzen\.soul\.md$/)
  })

  it('carrega o SOUL do disco', () => {
    const soul = carregarSoul()
    expect(soul).toBeTruthy()
    expect(soul.length).toBeGreaterThan(1000)
  })

  it('é a identidade do Rayzen, não a do agente operacional antigo', () => {
    const soul = carregarSoul()
    expect(soul).toMatch(/Sou o Rayzen/)
    expect(soul).not.toMatch(/agente operacional principal/)
  })

  /**
   * As três frases que têm lastro em código (A01, A02, A04) precisam sobreviver a qualquer
   * edição do texto — são elas que o sistema de fato sustenta.
   */
  it('mantém as regras que o mecanismo sustenta', () => {
    const soul = carregarSoul()
    expect(soul).toMatch(/Sil[êe]ncio n[ãa]o [ée] consentimento/i)
    expect(soul).toMatch(/Preservo trabalho em andamento/i)
    expect(soul).toMatch(/resultados diferentes/i)
  })

  /**
   * O defeito que a unificação existe para matar: nada no SOUL pode mandar produzir formato
   * operacional "sempre que possível", senão o modelo volta a preencher seções sem base.
   */
  it('NÃO manda produzir plano/checklist por padrão', () => {
    const soul = carregarSoul()
    expect(soul).not.toMatch(/sempre que poss[íi]vel.{0,60}(formato operacional|checklist)/i)
  })

  it('o resultado é cacheado — não relê o disco a cada mensagem', () => {
    expect(carregarSoul()).toBe(carregarSoul())
  })
})

/**
 * ── O caminho `system` negava capacidade que a plataforma tem (15/09) ────────
 *
 * `MODULE_ROLE_SUFFIXES` dava contexto a `jarvis`, `brain`, `doc` e `content`, e **nada** a
 * `system` — que é justamente onde caem "o que você pode fazer", saudações e qualquer coisa que o
 * classificador não reconheceu como execução.
 *
 * Resultado medido no primeiro teste real pelo Telegram: uma mensagem depois de OFERECER a
 * captura de tela, o Rayzen respondeu *"não consigo capturar ou enviar imagens da tela"* e, na
 * pergunta seguinte, descreveu uma interface inventada — com tabela de elementos e menção a
 * "ChatGPT". Sem sufixo, o modelo responde como o modelo base: uma IA sem braços.
 *
 * É o espelho do defeito do classificador, que lista `"me notifica daqui 10 min"` entre os
 * exemplos sem existir agendador. Um promete o que não há; o outro nega o que há. Os dois são
 * inventar fato sobre si mesmo, e o SOUL proíbe os dois com a mesma frase.
 */
describe('o prompt do caminho `system` não deixa o modelo negar o executor', () => {
  const fonte = readFileSync(join(__dirname, '..', 'orchestrator.service.ts'), 'utf8')
  const sufixo = /^\s*system:\s*'(.*)',$/m.exec(fonte)?.[1] ?? ''

  it('existe um sufixo para `system`', () => {
    expect(sufixo.length).toBeGreaterThan(100)
  })

  it('diz que existe executor local e proíbe negar a capacidade', () => {
    expect(sufixo).toMatch(/executor local/i)
    expect(sufixo).toMatch(/nunca afirme que n[aã]o tem capacidade/i)
  })

  it('proíbe descrever estado que não recebeu — foi a segunda resposta inventada', () => {
    expect(sufixo).toMatch(/nunca descreva uma tela, arquivo ou estado/i)
  })

  /**
   * Enumerar ações aqui criaria uma segunda lista, divergente da do classificador. Esta casa já
   * teve `SAFE_ROOTS` em quatro versões; a regra que sobrou é não duplicar lista viva.
   */
  it('não enumera ações — a lista vive no prompt do classificador', () => {
    expect(sufixo).not.toMatch(/get_system_info|screenshot|git_status|docker_ps/)
  })
})

/**
 * ── A fonte única precisa continuar ligada depois de editada (15/09) ─────────
 *
 * O bind era de ARQUIVO:
 *
 *     ../../core/identity/rayzen.soul.md:/home/hermes/.hermes/SOUL.md:ro
 *
 * Bind de arquivo aponta para o **inode**, e `git pull` troca o inode — medido no servidor com um
 * repositório temporário: `97273` antes, `97299` depois. A unificação de identidade feita em
 * 14/09 estava correta e quebraria na PRIMEIRA manutenção: do deploy seguinte em diante o Hermes
 * leria o conteúdo antigo, sem erro e sem aviso.
 *
 * Isso é pior que não ter unificado — passa a existir a crença de que há uma fonte só. Por isso o
 * teste, e não só o conserto: o arranjo por arquivo é o que *parece* certo ao ler o compose.
 */
describe('o SOUL chega ao Hermes por caminho, não por inode', () => {
  const compose = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'hermes', 'docker-compose.hermes.yml'),
    'utf8',
  )

  it('não monta o arquivo de identidade diretamente', () => {
    expect(compose).not.toMatch(/rayzen\.soul\.md:/)
  })

  it('não monta o config.yaml diretamente', () => {
    expect(compose).not.toMatch(/\.\/config\.yaml:/)
  })

  it('monta o DIRETÓRIO da identidade', () => {
    expect(compose).toMatch(/\.\.\/\.\.\/core\/identity:.*:ro/)
  })

  /** Sem o entrypoint, o diretório está montado e `$HERMES_HOME/SOUL.md` não existe. */
  it('o entrypoint refaz os links e recusa subir sem eles', () => {
    const entrypoint = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'hermes', 'entrypoint.sh'),
      'utf8',
    )
    expect(entrypoint).toMatch(/ln -sfn .*rayzen\.soul\.md/)
    expect(entrypoint).toMatch(/exit 1/)
  })
})

/**
 * ── Nenhum sufixo pode AFIRMAR um fato que o sistema não verificou (16/09) ───
 *
 * O sufixo de `jarvis` dizia *"Contexto desta resposta: executei uma tarefa local no PC"*, e
 * nenhum código conferia se alguma execução havia acontecido. Estava morto — todos os caminhos do
 * ramo `jarvis` retornam antes do `getSystemPrompt` — mas morto e falso é pior que vivo e falso:
 * ninguém corrige o que nunca vê falhar.
 *
 * E a forma que o tornaria vivo existe ao lado: o ramo `content` tem `catch { /* fallback para
 * chat normal *\/ }` e cai no chat **carregando o rótulo do módulo**. Um `catch` igual no ramo
 * `jarvis` faria o modelo receber "executei uma tarefa" logo depois de falhar em executá-la.
 *
 * A regra que sobra: sufixo descreve **estilo e escopo da resposta**, nunca afirma que algo
 * aconteceu. Quem sabe se aconteceu é quem executou — e aquele caminho monta prompt próprio.
 */
describe('sufixos de módulo não afirmam fato não verificado', () => {
  const fonte = readFileSync(join(__dirname, '..', 'orchestrator.service.ts'), 'utf8')
  const mapa  = /const MODULE_ROLE_SUFFIXES[\s\S]*?\n}\n/.exec(fonte)?.[0] ?? ''

  /** Só as linhas de valor do mapa — comentários citam a frase removida, e devem citar. */
  const sufixos = [...mapa.matchAll(/^\s{2}(\w+):\s+'(.*)',$/gm)].map((m) => ({ modulo: m[1], texto: m[2] }))

  it('encontra o mapa e seus sufixos', () => {
    expect(sufixos.length).toBeGreaterThan(1)
    expect(sufixos.map((s) => s.modulo)).toContain('system')
  })

  it('nenhum sufixo afirma que uma ação foi executada', () => {
    for (const { modulo, texto } of sufixos) {
      expect(`${modulo}: ${texto}`).not.toMatch(/\bexecutei\b|\bexecutou\b|\brodei\b|\bfiz\b|\bconclu[íi]\b/i)
    }
  })

  it('o sufixo do jarvis não voltou', () => {
    expect(sufixos.find((s) => s.modulo === 'jarvis')).toBeUndefined()
  })
})

/**
 * ── `USER.md` é semente, e a distinção importa ───────────────────────────────
 *
 * Três arquivos chegam ao Hermes e **dois mecanismos diferentes**, de propósito:
 *
 * | arquivo | mecanismo | por quê |
 * |---|---|---|
 * | `SOUL.md` | link para o diretório montado | fonte única — o repositório manda |
 * | `config.yaml` | link | idem |
 * | `USER.md` | **cópia sem sobrescrever** | o Hermes ESCREVE nele |
 *
 * `memory.write_approval: true` deixa as escritas em estágio, revisáveis por `/memory pending`.
 * Um link `:ro` quebraria esse caminho; um `cp` que sobrescreve apagaria, a cada recriação de
 * container, tudo o que o Hermes tivesse aprendido.
 *
 * Sem semente, `USER.md` simplesmente não existia — conferido no container em 15/09. O Hermes
 * começava sem saber nada sobre Marcelo, e caderno vazio convida a preencher, que é o defeito que
 * este dia inteiro existiu para fechar.
 */
describe('USER.md é semeado sem sobrescrever o que o Hermes aprendeu', () => {
  const RAIZ = join(__dirname, '..', '..', '..', '..', '..', '..')
  const entrypoint = readFileSync(join(RAIZ, 'infra', 'hermes', 'entrypoint.sh'), 'utf8')
  const seed       = readFileSync(join(RAIZ, 'core', 'identity', 'USER.md'), 'utf8')

  it('a semente existe e tem conteúdo curado', () => {
    expect(seed.length).toBeGreaterThan(1000)
    expect(seed).toMatch(/Marcelo Rayzen/)
  })

  it('não sobrescreve: copia só quando o arquivo ainda não existe', () => {
    expect(entrypoint).toMatch(/if \[ ! -e "\$MEMORIAS\/USER\.md" \]/)
  })

  it('USER.md NÃO é link — o Hermes precisa poder escrever', () => {
    expect(entrypoint).not.toMatch(/ln -sfn .*USER\.md/)
  })

  /**
   * A parte que mais importa do conteúdo: a lacuna precisa ficar visível. Um caderno que só
   * afirma convida o modelo a completar o resto.
   */
  it('declara o que NÃO se sabe, em vez de só afirmar', () => {
    expect(seed).toMatch(/O que eu n[ãa]o sei sobre ele/i)
    expect(seed).toMatch(/dizer o que falta — n[ãa]o completar/i)
  })

  it('separa caderno pessoal de fato canônico de projeto', () => {
    expect(seed).toMatch(/n[ãa]o mora fato can[ôo]nico de projeto/i)
    expect(seed).toMatch(/rayzen_get_state|rayzen_get_context/)
  })

  it('marca o projeto de cliente como cliente', () => {
    expect(seed).toMatch(/VB Ferragens[\s\S]{0,80}cliente/i)
  })
})
