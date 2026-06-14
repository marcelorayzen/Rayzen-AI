'use client'

import { useState } from 'react'

interface HelpSection {
  id: string
  label: string
  icon: string
  description: string
  tips: Array<{ title: string; body: string }>
  commands?: Array<{ label: string; cmd: string }>
}

const SECTIONS: HelpSection[] = [
  {
    id: 'overview',
    label: 'Visão geral',
    icon: '◈',
    description: 'Rayzen é seu parceiro de IA pessoal — gerencia memória, missões e contexto enquanto você usa o Claude Code para executar.',
    tips: [
      { title: 'Fluxo básico', body: 'Selecione um projeto → converse no chat → crie missões → feche o loop com Checkpoint.' },
      { title: 'Duas gerações', body: 'V1 (chat, brain, QA) está em uso diário. V2 (missões, router, context broker) está em adoção.' },
      { title: 'Hook automático', body: 'O hook do Claude Code injeta contexto do projeto em cada sessão. Não é necessário chamar rayzen_get_resume() manualmente.' },
      { title: 'Papéis', body: 'Rayzen = context broker + memória. Claude Code = executor. Agent desktop = browser/terminal/git.' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: '💬',
    description: 'Converse com o assistente Rayzen diretamente. O contexto do projeto é injetado automaticamente.',
    tips: [
      { title: 'Modos de trabalho', body: 'Selecione o WorkMode (implementation, debugging, review…) para filtrar o contexto injetado pelo Context Broker.' },
      { title: 'Sessões', body: 'Cada conversa tem uma sessão com ID. Use a sidebar para carregar sessões anteriores ou iniciar um novo chat.' },
      { title: 'Síntese', body: 'Clique em "Sintetizar" para transformar a sessão atual em um artefato de decisões/next-steps salvo no Brain.' },
      { title: 'Retomar sessão', body: 'Copie os comandos rayzen_get_resume() no painel ? para retomar o contexto em uma nova sessão do Claude Code.' },
    ],
    commands: [
      { label: '📁 Novo projeto completo', cmd: 'crie o projeto |nome| brief:\n|descreva a ideia aqui|' },
      { label: '📁 Novo projeto simples', cmd: 'crie o projeto |nome|' },
      { label: '🧪 Rodar testes', cmd: 'rode os testes do projeto |nome|' },
      { label: '📸 Capturar falhas', cmd: 'capture as falhas do projeto |nome|' },
      { label: '🖥️ Info do sistema', cmd: 'qual o status do PC' },
      { label: '📂 Git status', cmd: 'git status do projeto |nome|' },
      { label: '🔄 Reiniciar API', cmd: 'restart api' },
      { label: '🐳 Status Docker', cmd: 'lista os containers docker' },
    ],
  },
  {
    id: 'missions',
    label: 'Missões',
    icon: '◇',
    description: 'Missões são objetivos estruturados com steps planejados pelo Router V2. O Workflow DAG executa com Specialists.',
    tips: [
      { title: 'Criar missão', body: 'Descreva o objetivo em linguagem natural. O Router classifica, planeja os steps e associa um Specialist.' },
      { title: 'Approval Gates', body: 'Steps de risco alto geram gates de aprovação. Acesse via /work-panel ou aqui mesmo no modal de missões.' },
      { title: 'Completar', body: 'POST /v2/missions/:id/complete gera uma síntese LLM + índice no Brain + próximo passo sugerido.' },
      { title: 'Resultado', body: 'Após completar, o "próximo passo" é ancorado nos nextSteps do ProjectState — não apenas na sugestão do LLM.' },
      { title: 'NL → Mission', body: 'Use POST /v2/chat/to-mission para converter um objetivo em missão sem passar por sessão de chat.' },
    ],
  },
  {
    id: 'brain',
    label: 'Brain / Memória',
    icon: '🧠',
    description: 'O Brain indexa documentos com embeddings (pgvector). A busca semântica alimenta o Context Broker.',
    tips: [
      { title: 'Indexar fontes', body: 'Importe GitHub (via token), Notion (integration token) ou URL diretamente no wizard de novo projeto ou no painel de importação.' },
      { title: 'Classes de memória', body: 'inbox → working → consolidated → archive. Filtre no painel de atividade para focar no que importa.' },
      { title: 'Busca semântica', body: 'Use o campo de busca no painel Brain. Retorna documentos por similaridade de embedding, não por keyword.' },
      { title: 'Quick Capture', body: 'Atalho ✦ → registra decisões, ideias, problemas e referências como eventos no timeline do projeto.' },
      { title: 'Conversation turns', body: 'Cada fim de sessão do Claude Code persiste o último turn de assistant no Brain automaticamente (hook Stop).' },
    ],
  },
  {
    id: 'goals',
    label: 'Goals / KPIs',
    icon: '🎯',
    description: 'Defina metas com critérios de sucesso e KPIs. O Rayzen usa para orientar o Gap Analysis.',
    tips: [
      { title: 'Criar meta', body: 'No grafo, clique em "+ goal". Defina título, prazo e critérios de sucesso. Critérios marcados como done avançam o progresso.' },
      { title: 'KPIs', body: 'Associe KPIs a uma meta. KPIs com auto-tracking são calculados automaticamente pelo engine de eventos.' },
      { title: 'Gap Analysis', body: 'O grafo mostra gaps entre a situação atual (ProjectState) e os critérios de sucesso não atingidos.' },
      { title: 'Histórico', body: 'Metas achievadas ficam no histórico com progresso registrado. Útil para retrospectiva.' },
    ],
  },
  {
    id: 'qa',
    label: 'QA',
    icon: '🧪',
    description: 'Dashboard de qualidade: runs, evidências, tendências e catálogo de assets de dados.',
    tips: [
      { title: 'Runs', body: 'Cada execução de testes gera um test run com métricas (passed/failed/skipped). Selecione um run para ver o detalhe.' },
      { title: 'Evidências', body: 'Screenshots e arquivos capturados durante testes ficam vinculados a runs. Filtre por status de vínculo.' },
      { title: 'Tendência', body: 'O gráfico de tendência mostra evolução de passed/failed nos últimos runs. Badge verde/vermelho no HUD reflete o estado atual.' },
      { title: 'Data Quality', body: 'O DQ Score agrega profiling dos assets do catálogo. Use POST /data-catalog/:id/profile para atualizar.' },
      { title: 'Catálogo', body: 'Assets registrados via hook PostToolUse do Claude Code aparecem aqui com schema e métricas de qualidade.' },
    ],
  },
  {
    id: 'checkpoint',
    label: 'Checkpoint',
    icon: '⟳',
    description: 'O checkpoint fecha o loop de uma sessão: gera síntese, atualiza o ProjectState e popula o Brain.',
    tips: [
      { title: 'Quando usar', body: 'Ao final de uma sessão com código real modificado. Não é necessário para bate-papos ou explorações.' },
      { title: 'O que gera', body: 'Artefato com summary, decisions[], next_steps[] e learnings[]. Fica no painel de síntese.' },
      { title: 'MCP manual', body: 'No Claude Code: rayzen_checkpoint() → fecha o loop (state + docs + Universe). Síntese via MCP é mais rica.' },
      { title: 'Frequência', body: 'Um checkpoint por sessão de trabalho significativa. Evite múltiplos checkpoints na mesma sessão.' },
    ],
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    icon: '▣',
    description: 'Importe planos externos (Markdown, YAML) para o Rayzen. O Blueprint Engine analisa e popula Wiki + eventos + next steps.',
    tips: [
      { title: 'Templates', body: 'Use os templates pré-definidos para planos de feature, arquitetura ou sprint. Edite e importe.' },
      { title: 'Upload manual', body: 'Cole o conteúdo do plano no campo de upload. O preview mostra seções detectadas antes de confirmar.' },
      { title: 'Histórico', body: 'Planos importados ficam no histórico com as páginas Wiki e eventos gerados.' },
      { title: 'MCP', body: 'No Claude Code: rayzen_blueprint_import_markdown() importa diretamente da conversa.' },
    ],
  },
  {
    id: 'context-broker',
    label: 'Context Broker',
    icon: '⟨⟩',
    description: 'POST /v2/context/surgical monta um pacote de contexto cirúrgico pronto para injetar no Claude.',
    tips: [
      { title: 'Modos', body: 'implementation · debugging · review · architecture · study. Cada modo inclui seções diferentes.' },
      { title: 'readyToInject', body: 'O campo readyToInject é o texto completo formatado para colar como contexto no início de uma sessão.' },
      { title: 'MCP', body: 'No Claude Code: rayzen_get_context(mode, query) — substitui grep amplo e retorna contexto cirúrgico.' },
      { title: 'Sections', body: 'project_state · planning · policy_constraints · knowledge_graph · memory_relevant · recent_events.' },
    ],
  },
]

interface HelpPanelProps {
  onFillInput?: (cmd: string) => void
  projectId?: string | null
}

export function HelpPanel({ onFillInput, projectId }: HelpPanelProps) {
  const [activeSection, setActiveSection] = useState('overview')
  const [resumeCopied, setResumeCopied] = useState(false)

  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden text-xs">
      <div className="flex">
        {/* Sidebar */}
        <nav className="w-32 shrink-0 border-r border-zinc-800 py-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                activeSection === s.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <span className="shrink-0 text-[11px]">{s.icon}</span>
              <span className="truncate text-[10px] font-medium">{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 overflow-y-auto max-h-80">
          <p className="text-zinc-400 leading-relaxed mb-3">{section.description}</p>

          {/* Resume kit — only on overview/chat when projectId exists */}
          {activeSection === 'chat' && projectId && (
            <div className="mb-3 border border-zinc-800 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Retomar sessão no Claude Code</span>
                <button
                  onClick={() => {
                    const kit = `rayzen_get_resume(projectId: ${projectId})\nrayzen_get_goal(projectId: ${projectId})`
                    void navigator.clipboard?.writeText(kit)
                    setResumeCopied(true)
                    setTimeout(() => setResumeCopied(false), 1500)
                  }}
                  className="text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {resumeCopied ? 'copiado ✓' : 'copiar'}
                </button>
              </div>
              <pre className="text-[10px] font-mono text-zinc-500 bg-zinc-950 rounded p-1.5 whitespace-pre-wrap">
                {`rayzen_get_resume(projectId: ${projectId})\nrayzen_get_goal(projectId: ${projectId})`}
              </pre>
            </div>
          )}

          {/* Tips */}
          <div className="space-y-2 mb-3">
            {section.tips.map((tip) => (
              <div key={tip.title} className="rounded-lg bg-zinc-800/50 px-2.5 py-2">
                <p className="text-[10px] font-semibold text-zinc-300 mb-0.5">{tip.title}</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed">{tip.body}</p>
              </div>
            ))}
          </div>

          {/* Quick commands */}
          {section.commands && onFillInput && (
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Comandos rápidos</p>
              <div className="grid grid-cols-2 gap-1">
                {section.commands.map(({ label, cmd }) => (
                  <button
                    key={label}
                    onClick={() => onFillInput(cmd.replace(/\|/g, ''))}
                    className="text-left text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 px-2 py-1.5 rounded-lg transition-colors truncate text-[10px]"
                    title={cmd.replace(/\|/g, '')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-700 mt-2">Clique para preencher o input. Edite os campos antes de enviar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
