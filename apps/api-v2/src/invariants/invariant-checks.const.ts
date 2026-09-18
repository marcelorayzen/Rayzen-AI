/**
 * Invariantes do sistema — propriedades que, quando quebram, não geram erro nenhum.
 *
 * Cada item desta lista corresponde a uma falha REAL que passou despercebida. O
 * critério para entrar aqui é esse: não "seria bom checar", e sim "isto já quebrou
 * em silêncio e custou tempo para descobrir".
 *
 * Um check é bom quando o `detalhe` responde sozinho "o que exatamente está errado" —
 * quem lê não deveria precisar abrir o banco para entender.
 */

export type Categoria  = 'infra' | 'dado' | 'config'
export type Gravidade  = 'alta' | 'media' | 'baixa'

export interface InvariantResult {
  id:        string
  titulo:    string
  categoria: Categoria
  gravidade: Gravidade
  ok:        boolean
  /** Frase que descreve o que foi MEDIDO, não o que deveria ser. */
  detalhe:   string
  /** Como corrigir — só faz sentido quando ok=false. */
  correcao?: string
}

export const GRAVIDADE_ORDEM: Record<Gravidade | 'ok', number> = {
  ok: 0, baixa: 1, media: 2, alta: 3,
}

/**
 * Catálogo dos invariantes, só para documentação e para a UI saber o que existe
 * mesmo antes da primeira execução. A implementação vive no InvariantsService.
 */
export const INVARIANTES = [
  {
    id:        'relogio_sincronizado',
    titulo:    'Relógio do servidor bate com a realidade',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-08-12 o servidor estava 115 dias atrasado. Nada falhou — só passou a gravar evento, BenchmarkResult e GuardianReport com data errada, e a desalinhar o ciclo de 24h do QA Scientist.',
  },
  {
    id:        'projeto_ativo_no_catalogo',
    titulo:    'Todo projeto V1 ativo está no project_catalog da V2',
    categoria: 'dado' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'O QA Scientist itera project_catalog. O Rayzen AI nunca foi registrado lá, então o ciclo rodava todo dia varrendo outro projeto e logando "no failures" — indistinguível de estar parado.',
  },
  {
    id:        'strategy_com_resultado_tem_fitness',
    titulo:    'Estratégia com BenchmarkResult tem fitnessScore preenchido',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'getActiveStrategy ordena por fitnessScore. Com o campo null a seleção evolutiva não tem o que ranquear, e o baseline do ciclo seguinte volta a zero — o que fazia qualquer rodada parecer uma melhora enorme.',
  },
  {
    id:        'gate_aprovado_foi_aplicado',
    titulo:    'Gate de promoção aprovado resultou em estratégia promovida',
    categoria: 'dado' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Aprovar só mudava o status do gate; nada chamava promote(). O estado "aprovado" ficava indistinguível de "aprovado e aplicado", no banco e na UI.',
  },
  {
    id:        'hipotese_com_tasktype_valido',
    titulo:    'Hipótese tem taskType conhecido ou nulo',
    categoria: 'dado' as Categoria,
    gravidade: 'baixa' as Gravidade,
    porque:    'O modelo copiou o placeholder do schema e gravou "classify|summarize|context_synthesis|null" como taskType. runExperiment busca casos por esse valor, não acha nenhum, e o ciclo desiste calado.',
  },
  {
    id:        'benchmark_set_coerente',
    titulo:    'Casos de benchmark de um taskType têm formato de saída único',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'classify mistura rótulo simples ("deploy") com objeto JSON. Nenhum prompt pontua bem nos dois, então o fitness baixo mede a incoerência do conjunto — e o QA Scientist gera hipótese sobre o alvo errado.',
  },
  {
    id:        'benchmark_case_tem_dono',
    titulo:    'Todo caso de benchmark pertence a um projeto',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'Caso sem projectId não é coletado por ninguém desde que o escopo passou a ser estrito. Antes era o oposto — 46 casos órfãos contavam para TODO projeto do catálogo, o que geraria uma hipótese duplicada por projeto sobre o mesmo fitness.',
  },
  {
    id:        'registro_sem_projeto',
    titulo:    'Evento e documento novos têm projeto dono',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'Em 2026-08-16 havia 236 eventos órfãos acumulados desde maio, invisíveis para toda consulta com escopo de projeto — que é o Rayzen inteiro. Registro nasce órfão quando o hook não resolve o repoSlug, então isto é o sensor de a resolução ter quebrado; e fica órfão porque Event e Document são onDelete: SetNull. O contrato da V1 tem um "Invariante 1 — Documentos sempre têm projectId" que testa um mock local e passou verde o tempo todo.',
  },
  {
    id:        'missao_nao_travada',
    titulo:    'Nenhuma missão ativa parada há muito tempo',
    categoria: 'dado' as Categoria,
    gravidade: 'baixa' as Gravidade,
    porque:    'A missão "Stress Test v3" está active com 1/3 steps desde junho e aparece no contexto injetado de toda sessão, competindo com o trabalho real por atenção.',
  },
  {
    id:        'modelos_llm_respondem',
    titulo:    'Os modelos de LLM declarados ainda respondem',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-08-17 a Groq descontinuou os DOIS modelos configurados (llama-3.3-70b-versatile e llama-3.1-8b-instant). Todo gpt-4o virou 404, o fallback caiu no Anthropic sem crédito, e tudo que usa LLM — inclusive a síntese do ProjectState — passou a devolver 500 em produção. Nenhum invariante, ciclo ou painel acusou, porque todos mediam estado INTERNO: os heartbeats seguiam saudáveis e os invariantes seguiam 8 de 9. Foi descoberto por acaso, disparando um refresh manual para validar outra coisa. Modelo de terceiro é dependência que some sem avisar, e some calada.',
  },
  {
    id:        'historico_serve_conversa',
    titulo:    'O histórico de conversas mostra conversa, não telemetria',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'Em 2026-08-19 o histórico exibia 20 linhas idênticas chamadas "Conversa", e cada uma abria o payload JSON cru de uma chamada interna. conversation_messages guarda DUAS coisas — conversa do usuário e a saída de todo módulo que fala com LLM — e havia 4.459 sessões de telemetria contra 210 reais; a primeira conversa real caía na posição 661 de um corte em 20, então era aritmeticamente impossível uma conversa aparecer. Nada deu erro: o endpoint respondia 200 e a suíte passava, porque o defeito morava na FORMA DO DADO e todo teste da casa mocka o Prisma — o fixture representa o dado que o autor imaginou, nunca o que existe. Este check mede a saída servida, não o mecanismo: se o filtro for removido, invertido ou contornado por outro caminho, o número muda igual.',
  },
  {
    id:        'disco_com_folga',
    titulo:    'O servidor tem disco livre',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-09-05 o disco do H81 estava em 82% (85 GB de 110 GB, 20 GB livres) e o dono relatou que já tinha acontecido antes. A causa não era dado do Rayzen — os dois bancos somam 417 MB. Era o build cache do Docker, com 54,44 GB dos quais 54,37 GB recuperáveis, alimentado por todo push em main que dispara `docker compose up -d --build`. Um `docker builder prune` devolveu 49,2 GB e levou o disco de 82% para 39%. Nada acusava: disco enche em silêncio e só aparece quando um build falha ou o Postgres para de escrever, que é tarde. O check mede a partição raiz vista de dentro do container, que é a mesma do host (verificado: 110G/40G/39% nos dois).',
  },
  {
    id:        'migracoes_aplicadas',
    titulo:    'Toda migração do repositório está aplicada no banco',
    categoria: 'dado' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-08-22 descobriu-se que `20260630000000_policy_exceptions` nunca aplicou — declarava `id`/`rule_id` como UUID contra uma `policy_rules.id` que é TEXT, e o Postgres recusava a FK. Ficou assim 53 dias. Não era contabilidade: `policy-engine.service.ts` chama `findActiveException()` para CADA regra em toda avaliação, então sem a tabela o Prisma lançava e `POST /v2/policy/evaluate` devolvia 500 — o motor de política inteiro estava morto, incluindo o `block` que protege o Brain de conhecimento com trust baixo. Heartbeats saudáveis, invariantes 8 de 9, painel verde; foi achado por acaso. Na V2 o schema real vem de `prisma db push` e `migrate deploy` nunca roda no deploy, então uma migração que falha não deixa rastro NENHUM na tabela `_prisma_migrations` — a única evidência é o diretório ter um nome que o banco não conhece. É exatamente essa comparação que este check faz, e ela teria pego o caso no dia seguinte em vez de dois meses depois.',
  },
  {
    id:        'memoria_relevante_serve_util',
    titulo:    'A memória injetada é do projeto e não é arquivo gerado',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'memory_relevant é a maior seção do contexto injetado — 58% do orçamento no Rayzen AI — e até 2026-08-22 nenhum sensor olhava para o que ela serve. Duas falhas reais mostraram que ela degrada em silêncio, sem erro nenhum: em 2026-08-17 o banco-imob recebeu DOIS trechos de pnpm-lock.yaml em cinco para a consulta "implementar cache de sessão no módulo de autenticação"; e em 2026-08-22 a medição achou 194 documentos de OUTROS repositórios (154 do Commerce, 37 do banco-imob, 3 do VB Ferragens) indexados dentro do Rayzen AI — 15% do acervo, servidos como se fossem conhecimento do projeto. A busca é escopada por projectId, então nada no caminho de consulta acusava: os documentos ESTAVAM no projeto, só não eram dele. O sinal observável é o sourcePath apontar para outro repositório. Este check olha o que foi de fato escolhido para o prompt, não o acervo inteiro — corpus sujo só derruba o invariante quando o lixo chega a ser servido.',
  },
  {
    id:        'segredo_nao_indexado',
    titulo:    'Nenhum arquivo de credencial está indexado no Brain',
    categoria: 'dado' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-09-10 o hook.config.mjs — que guarda o AGENT_TOKEN — estava indexado no Brain, e a busca semântica o serviu COM O JWT COMPLETO EM TEXTO CLARO dentro do memory_relevant de uma sessão real. O arquivo tinha sido fechado por ACL no dia anterior e isso não ajudou em nada: proteger o objeto não protege a cópia que já saiu dele. Nenhum sensor existente fazia essa pergunta — `pnpm scan:secrets` audita o que está VERSIONADO (o .env é gitignored, então passa limpo) e o check de ACL audita quem PODE LER o arquivo (o Brain não é arquivo). A diferença deliberada para o memoria_relevante_serve_util, que é o vizinho mais próximo: aquele olha só o que foi SERVIDO numa consulta-sonda, porque lixo degrada a qualidade na proporção em que aparece; credencial indexada é perigo igual mesmo na consulta em que NÃO aparece, bastando a próxima busca casar — então este olha o acervo inteiro. Só o sourcePath é lido, nunca o conteúdo: o sensor não precisa ver o que denuncia, e carregá-lo o espalharia por mais um processo e mais um log.',
  },
  {
    id:        'telegram_responde',
    titulo:    'O canal do Telegram consegue responder texto livre',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Ate 2026-09-14 o chat livre do Telegram NUNCA funcionou: orchestrate() lia TELEGRAM_API_TOKEN com fallback para string vazia, e essa variavel nao existia em lugar nenhum — nem no .env, nem no compose, nem no container. Todo texto livre saia com Bearer vazio, tomava 401 e virava "erro ao processar mensagem". Passou meses assim porque os COMANDOS funcionavam (nao passam pelo orquestrador), o processo subia saudavel, o long-polling logava "started" e o painel ficava verde — canal quebrado com tudo reportando sucesso. O check sonda GET /infra/telegram, que responde sem enviar mensagem, sem criar conversa e sem gastar LLM: sondar POST /orchestrate de verdade pagaria uma conversa a cada 30 minutos, e sensor caro e sensor que alguem desliga. Chat sem projeto vinculado entra como numero no detalhe mas NAO derruba o check — responder sem contexto e configuracao incompleta, nao canal quebrado, e vermelho permanente e o que se aprende a ignorar.',
  },
  {
    id:        'redis_exige_senha',
    titulo:    'O Redis nao aceita comando sem autenticacao',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Medido em 2026-09-16, de dentro do container do Hermes e SEM credencial nenhuma: PING respondeu +PONG e SCAN bull:* listou 31 chaves de `bull:agent-tasks` — a fila que o agent DESKTOP reivindica e executa na maquina do Marcelo. Quem alcanca o Redis sem senha pode enfileirar um job, e isso contorna inteiramente o escopo somente-leitura do MCP_TOKEN_HERMES. O furo existia desde que o Hermes entrou na rede compartilhada, e nenhum sensor perguntava isso: `infra_health` so conferia se o Redis RESPONDE, que era justamente o sintoma de estar aberto. O check abre um socket e manda PING cru, em vez de ler configuracao: a pergunta e "a porta esta trancada?", nao "o arquivo diz que deveria estar?" — mesma escolha do historico_serve_conversa, que sonda o endpoint e nao o banco. Falha de CONEXAO e inconclusiva, nao falha: quem nao respondeu pode ser a rede, e um sensor que nao consegue medir nunca devolve sucesso nem condena.',
  },
  {
    id:        'embeddings_respondem',
    titulo:    'O provedor de embeddings responde',
    categoria: 'infra' as Categoria,
    gravidade: 'alta' as Gravidade,
    porque:    'Em 2026-09-17 a conta da Jina ficou sem saldo e devolveu HTTP 403 AUTHZ_INSUFFICIENT_BALANCE. Embeddings alimentam indexacao E busca, entao a memoria semantica inteira saiu do ar: /memory/search passou a devolver 500, o memory_relevant do contexto sumiu e o context-engine da V2 comecou a falhar. NADA acusou — foi descoberto por acaso, ao investigar um deploy que falhara por outro motivo no dia anterior. E a mesma historia do modelos_llm_respondem, que nasceu quando a Groq descontinuou dois modelos e toda chamada virou 500 com o painel verde: dependencia de terceiro some sem avisar, e o unico jeito de saber e perguntar. Aquele check sonda o LLM e NAO cobre embeddings — provedor diferente, conta diferente, saldo diferente. Sonda POST /memory/search na V1 em vez de chamar a Jina direto: testa o caminho que o usuario usa de verdade (embed + pgvector), e nao exige a chave dentro da api-v2. Cache de 10min porque o ciclo varre ate 10 projetos por rodada e a pergunta nao e por projeto. Falha SEM status HTTP e inconclusiva, nao falha.',
  },
  {
    id:        'hub_registra_conversa',
    titulo:    'O HUB devolve a conversa ao Rayzen',
    categoria: 'dado' as Categoria,
    gravidade: 'media' as Gravidade,
    porque:    'Ate 18/09 o HUB era um cerebro a parte: memoria propria em state.db e so ferramentas de LEITURA no Rayzen, entao conversa no HUB nao existia em conversation_messages — nem no historico, nem na busca, nem na sintese. O caminho de volta e um hook post_llm_call que POSTa em /sessions/ingest, e a ligacao tem um modo de falha silencioso de cada lado. Deste lado: se HUB_INGEST_TOKEN divergir entre o container da api e o do Hermes, toda ingestao vira 401 e o hook desiste calado (ele sai 0 de proposito, para nunca derrubar o turno) — e a mesma historia do MCP_TOKEN_HERMES, que existia no YAML e nao no .env, deixando o consumidor sem existir por meses. Este check sonda a rota com um corpo sem sessionId (no-op que nao grava) e distingue 204 de 401. LIMITE DECLARADO: ele NAO verifica que o hook esta registrado do lado do Hermes. Sem TTY e sem consentimento, shell_hooks.py loga "not allowlisted — skipped" e o hook nao roda; a api-v2 nao le o state.db nem o allowlist do Hermes, entao essa metade se confere com `hermes hooks list` no container. Um check que medisse o que nao alcanca seria pior que a ausencia dele.',
  },
] as const

export type InvarianteId = typeof INVARIANTES[number]['id']
