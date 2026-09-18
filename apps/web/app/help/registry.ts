/**
 * Conteúdo de ajuda por tela.
 *
 * Escrito a partir da auditoria de 2026-08-05, não do que se pretendia construir:
 * onde algo é manual, diz que é manual; onde um painel fica vazio por não haver dado,
 * diz isso em vez de deixar o usuário achar que quebrou. Texto que afirma capacidade
 * inexistente é pior que ausência de ajuda — foi assim que o HelpPanel antigo passou
 * meses dizendo que o "DQ Score agrega profiling dos assets", coisa que nunca ocorreu.
 *
 * Regra ao editar: se a frase não puder ser verificada abrindo a tela ou o banco,
 * ela não entra.
 */

export interface HelpNote {
  title: string
  body: string
}

export interface HelpTopic {
  /** Chave da tela — casada com a rota ou com o id do modal */
  id: string
  label: string
  /** Uma frase: o que esta tela faz. */
  summary: string
  /** Como operar, o que os números significam, o que é manual. */
  notes: HelpNote[]
  /** Comandos MCP relacionados, coláveis no Claude Code. */
  mcp?: string[]
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  home: {
    id: 'home',
    label: 'Chat',
    summary: 'Conversa com o assistente, com o contexto do projeto ativo injetado automaticamente.',
    notes: [
      { title: 'Modo de trabalho', body: 'O seletor de modo (implementation, debugging, review…) decide quais seções do contexto entram. Trocar o modo muda o que o assistente enxerga, não só o tom.' },
      { title: 'Sessões', body: 'Cada conversa tem um ID. A barra lateral carrega sessões anteriores; "novo chat" começa uma sessão limpa.' },
      { title: 'Síntese ≠ checkpoint', body: 'Sintetizar resume a conversa atual. Checkpoint fecha o loop: atualiza ProjectState e planejamento. Só o checkpoint move o estado do projeto.' },
      { title: 'O projeto ativo importa', body: 'Quase tudo no header opera sobre o projeto selecionado. Se um painel vier vazio, confira o seletor antes de suspeitar de bug.' },
    ],
    mcp: ['rayzen_get_context(projectId, mode, query)', 'rayzen_checkpoint(projectId)'],
  },

  guardian: {
    id: 'guardian',
    label: 'Guardian',
    summary: 'Risco das mudanças em andamento: score, arquivos sem teste e aprovações pendentes.',
    notes: [
      { title: 'De onde vem o relatório', body: 'O workspace-watcher detecta mudanças a cada 30s e chama /v2/guardian/analyze. O score é determinístico (RISK_SCORE_TABLE), não sai de LLM.' },
      { title: 'Níveis', body: 'low (0-29) não gera gate · medium (30-59) e high (60-84) geram gate pendente · critical (85+) é bloqueado automaticamente.' },
      { title: 'Aprovações pendentes', body: 'Gates criados pelo Guardian não pertencem a nenhuma missão, então não aparecem na tela de missões — é aqui que se resolvem. Um gate não decidido expira sozinho e vira rejeitado, o que deixa o histórico de auditoria mentindo sobre o que você aceitou.' },
      { title: 'Override', body: 'Só relatórios critical podem ser sobrescritos, e o motivo fica registrado no relatório.' },
    ],
    mcp: ['rayzen_guardian_status(projectId)', 'rayzen_guardian_analyze(projectId, changedFiles)'],
  },

  qa: {
    id: 'qa',
    label: 'QA Dashboard',
    summary: 'Resultado dos testes do repositório: último run, tendência de 30 dias e histórico.',
    notes: [
      { title: 'O número é do monorepo inteiro', body: 'Um run consolida api, api-v2 e agent. Antes só o apps/api era enviado, e 225 parecia ser "os testes do projeto" quando era menos da metade.' },
      { title: 'Quem alimenta', body: 'O CI roda `pnpm qa:ingest` a cada push na main. Dá pra rodar na mão também — `pnpm qa:ingest --dry-run` mostra o total sem enviar nada.' },
      { title: 'Se o número parar de atualizar', body: 'O job do CI fica vermelho. A causa mais comum é o secret RAYZEN_AGENT_TOKEN divergir do AGENT_TOKEN do servidor: o endpoint compara string exata, não valida JWT.' },
      { title: 'Detalhe do run vazio', body: 'O detalhe mostra falhas e evidências. Com a suíte 100% verde e sem evidências capturadas, não há o que exibir — é o estado correto, não um erro.' },
    ],
  },

  catalog: {
    id: 'catalog',
    label: 'Catalog',
    summary: 'Seus projetos como assets formais: owner, proveniência e tags.',
    notes: [
      { title: 'Um projeto por repositório', body: 'O repoSlug é o que liga um projeto ao repo em disco. É por ele que o hook do Claude Code descobre sozinho em qual projeto registrar os eventos.' },
      { title: 'Se os eventos caírem no projeto errado', body: 'Corrija o repoSlug do projeto aqui — nunca fixe um projectId no hook.config.mjs, que é compartilhado por todos os repositórios da máquina.' },
      { title: 'Proveniência', body: 'Indica se o projeto foi criado manualmente, importado ou derivado de um blueprint.' },
    ],
    mcp: ['rayzen_list_projects()', 'rayzen_create_project(name, description)'],
  },

  missions: {
    id: 'missions',
    label: 'Missões',
    summary: 'Objetivos estruturados em steps, executados pelo Workflow DAG com Specialists.',
    notes: [
      { title: 'Como nasce', body: 'Você descreve o objetivo em linguagem natural; o Router V2 classifica, planeja os steps e associa um Specialist a cada um.' },
      { title: 'Executores', body: 'Step com executor `ai` roda no Specialist. `human` significa que você ou o Claude Code executam — não é a UI que trava, é uma etapa manual mesmo.' },
      { title: 'Gates dentro da missão', body: 'Steps de risco alto pausam a missão num approval gate. Aprovar retoma o DAG do ponto em que parou.' },
      { title: 'Completar', body: 'Completar a missão gera síntese, indexa no Brain e ancora o próximo passo no ProjectState.' },
    ],
  },

  goals: {
    id: 'goals',
    label: 'Metas e Grafo',
    summary: 'Meta ativa com critérios de sucesso, KPIs e a distância entre o estado atual e o alvo.',
    notes: [
      { title: 'A meta ativa define o objetivo', body: 'O objetivo do projeto é derivado da meta ativa. Enquanto ela não fechar, o objetivo não muda — mesmo com todos os critérios concluídos.' },
      { title: 'Fechar é manual, por escolha', body: 'O Rayzen não marca meta como conquistada sozinho. Quando os critérios chegam a 100%, aparece uma faixa aqui e um aviso no Claude Code; o clique é seu.' },
      { title: 'Critérios movem o progresso', body: 'Marcar critério é o que faz a barra andar. O checkpoint propõe critérios possivelmente concluídos, mas quem confirma é você.' },
      { title: 'Uma meta ativa por vez', body: 'Criar uma nova meta pausa a anterior. Se a anterior estava concluída, feche antes — pausada e concluída contam diferente no histórico.' },
    ],
    mcp: ['rayzen_get_goal(projectId)', 'rayzen_create_goal(projectId, title, successCriteria)'],
  },

  brain: {
    id: 'brain',
    label: 'Brain / Memória',
    summary: 'Busca semântica sobre tudo que foi indexado: documentos, wiki, código e aprendizados.',
    notes: [
      { title: 'Busca por significado', body: 'A busca é por similaridade de embedding, não por palavra-chave. Perguntar "como faço deploy" acha o runbook mesmo sem a palavra "deploy" nele.' },
      { title: 'Escopo por projeto', body: 'A busca filtra pelo projeto ativo. Conteúdo indexado sem projeto fica invisível aqui — era o caso de 238 documentos até o backfill de 06/ago.' },
      { title: 'Write-back', body: 'Aprendizados capturados com rayzen_capture_learning voltam a aparecer sozinhos no contexto da próxima sessão em que o problema surgir.' },
    ],
    mcp: ['rayzen_search_memory(projectId, query)', 'rayzen_capture_learning(projectId, title, problem, solution)'],
  },

  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    summary: 'Traz um plano externo (Markdown ou JSON) para dentro do Rayzen: wiki, Brain, eventos e backlog.',
    notes: [
      { title: 'Sempre pré-visualize', body: 'O preview mostra as seções detectadas e o que seria criado, sem gravar nada. É a forma barata de descobrir que o Markdown não está no formato esperado.' },
      { title: 'Projeto certo desde o início', body: 'O import grava wiki, documentos e eventos no projeto informado. Importar sem projeto explícito já causou um blueprint inteiro cair no projeto errado (incidente Urna, 03/ago).' },
      { title: 'Ideia nova', body: 'Se o plano não pertence a nenhum projeto existente, crie o projeto primeiro — o import não cria.' },
    ],
    mcp: ['rayzen_blueprint_preview(title, content, format)', 'rayzen_blueprint_import_markdown(projectId, title, markdown)'],
  },

  synthesis: {
    id: 'synthesis',
    label: 'Síntese e Checkpoint',
    summary: 'Transforma atividade bruta em decisões, próximos passos e aprendizados.',
    notes: [
      { title: 'Quando vale', body: 'Ao fim de uma sessão com código real modificado. Conversa exploratória não precisa.' },
      { title: 'Por que o plano parece atrasado sem isso', body: 'O hook registra eventos brutos, mas comandos de diagnóstico são filtrados como ruído na síntese. Trabalho feito só via terminal, sem decisão registrada nem checkpoint, não chega ao ProjectState — e a próxima sessão recebe os mesmos próximos passos de antes.' },
      { title: 'Checkpoint pelo MCP é mais rico', body: 'Chamado do Claude Code, ele tem o contexto da sessão inteira e ainda propõe critérios de meta concluídos.' },
    ],
    mcp: ['rayzen_checkpoint(projectId)'],
  },

  workpanel: {
    id: 'workpanel',
    label: 'Work Panel',
    summary: 'Execução assistida: despacha tarefas para o agent desktop e acompanha missões em andamento.',
    notes: [
      { title: 'Depende do agent rodando', body: 'Ações jarvis:* precisam do agent desktop ativo na máquina. Sem ele a tarefa fica pendente até dar timeout — não é falha da missão.' },
      { title: 'Whitelist', body: 'O agent só executa ações da whitelist (44 hoje). Fora dela, a ação é rejeitada silenciosamente por design.' },
      { title: 'Desktop vs server', body: 'Cada ação tem um role alvo. Screenshot e browser rodam no desktop; docker e restart rodam no servidor.' },
    ],
    mcp: ['rayzen_agent_task(action, payload)'],
  },

  discovery: {
    id: 'discovery',
    label: 'Discovery',
    summary: 'Entrevista guiada que transforma uma ideia crua em blueprint e projeto.',
    notes: [
      { title: 'Para ideias sem forma', body: 'Use quando ainda não há plano. Se o plano já existe escrito, o caminho mais curto é o Blueprint.' },
      { title: 'Saída', body: 'Gera um blueprint e, ao confirmar, o projeto correspondente — daí em diante o trabalho segue no Work Panel.' },
    ],
  },

  settings: {
    id: 'settings',
    label: 'Configurações',
    summary: 'Preferências da plataforma e chaves de integração.',
    notes: [
      { title: 'Tokens vivem em vários lugares', body: 'O AGENT_TOKEN existe em cópias: .env do servidor, arquivos locais do agent, widget e o secret do GitHub. Rotacionar num lugar só quebra os outros em silêncio.' },
      { title: 'Diagnóstico', body: 'GET /infra/health mostra postgres, redis, litellm, api-v2, MCP, validade do JWT e último contato do agent desktop.' },
    ],
  },
}

/** Fallback quando a tela ainda não tem verbete. */
export const HELP_FALLBACK: HelpTopic = {
  id: 'unknown',
  label: 'Ajuda',
  summary: 'Esta tela ainda não tem verbete de ajuda.',
  notes: [
    { title: 'Contribuir', body: 'O conteúdo fica em apps/web/app/help/registry.ts, uma entrada por tela.' },
  ],
}

export function getHelpTopic(id: string): HelpTopic {
  return HELP_TOPICS[id] ?? HELP_FALLBACK
}
