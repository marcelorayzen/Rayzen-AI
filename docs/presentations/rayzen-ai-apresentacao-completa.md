# Rayzen AI — apresentação completa atualizada

## Slide 1 — Capa
### Rayzen AI
**Plataforma de inteligência operacional para projetos de tecnologia**

Transformando trabalho disperso em contexto estruturado, rastreável e reutilizável.

**Palavras-chave visuais:**  
memória · eventos · agents · documentação · evidências

---

## Slide 2 — O problema
### Durante o desenvolvimento, muita informação essencial se perde

- Decisões ficam presas em conversas.
- Regras de negócio aparecem em comentários soltos.
- Erros resolvidos não viram aprendizado.
- Documentação envelhece rápido.
- Projetos pausados ficam difíceis de retomar.
- Evidências de teste se perdem fora do contexto do projeto.

**Pergunta central:**  
Como criar um assistente que não apenas responda, mas acompanhe a evolução real de um projeto?

---

## Slide 3 — A solução
### Uma plataforma centrada em projeto

**Captura** o que acontece.  
**Organiza** o conteúdo.  
**Sintetiza** o contexto.  
**Recomenda** ações.

Cada conversa, documento, decisão, execução, evidência e recomendação fica ligada a um projeto específico.

O Rayzen AI deixa de tratar interações como eventos isolados e cria uma memória contínua por projeto.

---

## Slide 4 — O que foi desenvolvido
### Módulos trabalhando juntos em torno do projeto

**Interface web**  
Projetos, sessões, chat, memória, recomendações, documentação, health score, QA e evidências.

**API modular**  
NestJS com orquestração, memória, execução, documentos, voz, projetos, eventos, síntese, QA e integrações.

**Agents por papel**  
- **Desktop Agent:** ações locais no computador, como screenshot, VS Code, clipboard e testes.  
- **Server Agent:** operações da stack hospedada, como logs, Docker e restart da API.

**Camada de IA**  
LiteLLM, modelos por finalidade, embeddings, classificação, síntese e geração.

---

## Slide 5 — Arquitetura operacional
### Frontend, API, infraestrutura e agents distribuídos por função

**Frontend — Next.js**  
Experiência visual, seleção de projeto, chat, timeline, documentos, QA, evidências e configurações.

**API central — NestJS + Fastify**  
Núcleo de orquestração, regras, memória, filas, documentos, QA, evidências e integrações.

**Infraestrutura hospedada em VPS**  
PostgreSQL + pgvector  
Redis + BullMQ  
LiteLLM  
API + Web + Agent server

**Execução distribuída**  
Desktop Agent no PC de trabalho  
Server Agent na VPS

**Mensagem-chave:**  
O Rayzen separa contexto, operação local e infraestrutura remota sem misturar projetos.

---

## Slide 6 — Orchestrator
### O cérebro do roteamento

**Fluxo principal**
1. Recebe a mensagem do usuário.
2. Valida a entrada.
3. Classifica a intenção.
4. Seleciona o fluxo adequado.
5. Seleciona o modelo correto.
6. Roteia para memória, execução, documentação, QA ou chat.

**Exemplos de destinos**
- Memória: busca em documentos e embeddings.
- Execução: tarefas autorizadas via Agent.
- Documentação: síntese, relatórios e artefatos.
- QA: testes, falhas e evidências.

---

## Slide 7 — IA, LiteLLM e MCP
### Modelos especializados e ambiente local exposto como ferramentas

**Modelos por função**
- Classificação: baixa temperatura e saída estruturada.
- Chat: flexibilidade.
- Conteúdo: criatividade.
- Síntese e documentação: consistência.
- Embeddings: busca semântica.

**LiteLLM**  
Proxy para desacoplar o código dos providers, trocar modelos e centralizar configuração.

**MCP e ferramentas locais**  
Servidor MCP próprio dentro do Agent, expondo capacidades locais de forma controlada para clientes compatíveis.

**Evolução recente**  
O Agent deixou de ser único: hoje há separação entre execução local e operação da infraestrutura hospedada.

---

## Slide 8 — Hooks, watcher e Event Log
### Captura automática gera rastreabilidade por projeto

**Fontes capturadas**
- Claude Code via hook.
- Codex, VS Code e terminal comum via workspace watcher.
- Arquivos alterados.
- Comandos executados.
- Fim de sessão.
- Checkpoints e sínteses.
- Evidências visuais.

**Organização**
Cada evento é associado ao projeto correto e passa a compor a timeline de trabalho.

**Mensagem final:**  
Eventos reais deixam de se perder e viram matéria-prima para memória, retomada e documentação. O hook do Claude captura detalhes internos da sessão; o watcher agnóstico captura alterações reais do workspace.

---

## Slide 9 — Memória e Brain
### Busca semântica com PostgreSQL + pgvector

**Pipeline**
Conteúdos → chunks → embeddings → busca semântica

**Fontes**
- documentos;
- conversas;
- URLs;
- arquivos;
- históricos técnicos;
- registros do projeto.

**Na prática:**  
uma memória técnica pessoal por projeto, capaz de recuperar contexto mesmo quando as palavras mudam.

---

## Slide 10 — Documentação viva e retomada
### Documentos gerados a partir do histórico real

**Documentação viva**
- estado atual do projeto;
- log de decisões;
- próximas ações;
- diário de trabalho;
- resumo de sessão;
- evidências de teste.

**Estado estruturado**
Objetivo, estágio, bloqueios, decisões, riscos, próximos passos e nível de saúde.

**Retomada**
Brief com onde parei, o que foi decidido, pendências e próximo melhor passo.

**Novo avanço**
Capturas feitas durante testes agora alimentam automaticamente a documentação de evidências do projeto.

---

## Slide 11 — Health Score, recomendações e Work Modes
### O sistema começa a acompanhar o projeto de forma proativa

**Health Score 0–100**
- atividade recente;
- documentação atualizada;
- foco;
- bloqueios;
- clareza dos próximos passos.

**Recomendações proativas**
- projeto parado;
- docs desatualizadas;
- bloqueios recorrentes;
- próximos passos sem ação;
- divergência entre objetivo e eventos.

**Work Modes**
implementation · debugging · architecture · study · review

Cada modo muda o foco da síntese e o peso dos eventos.

---

## Slide 12 — Agents por papel
### Execução controlada, distribuída e segura

**Desktop Agent**
Roda no computador de trabalho e executa ações locais:
- screenshot;
- abrir apps;
- clipboard;
- inspeções;
- testes locais.

**Server Agent**
Roda na VPS e executa ações da stack hospedada:
- leitura de logs;
- operações Docker;
- restart de serviços.

**Proteções**
Whitelist, path traversal bloqueado, diretórios sensíveis protegidos e confirmação antes de ações de maior risco.

**Mensagem-chave:**  
A VPS não controla diretamente o PC; cada Agent atua apenas no papel autorizado.

---

## Slide 13 — Integrações e geração de documentos
### O Rayzen conversa com ferramentas reais de trabalho

**Documentos**
PDF e DOCX a partir de prompts e dados estruturados: contratos, propostas, relatórios, orçamentos e docs técnicas.

**Voz**
Texto para áudio e transcrição para registrar ideias com menor atrito.

**Notion + Obsidian**
Cria, busca, acrescenta e sincroniza artefatos em ferramentas de conhecimento.

**Git-aware context**
Relaciona eventos, commits, branch, arquivos alterados e decisões.

---

## Slide 14 — Rayzen Graph e Goal Graph
### Do histórico para um mapa vivo do projeto

**Elementos conectados**
Projeto · metas · decisões · eventos · riscos · documentos

**Goal Graph**
Compara estado atual × estado desejado:
- onde estou;
- o que falta;
- bloqueios;
- riscos;
- próximo melhor passo.

---

## Slide 15 — Evidências e documentação de testes
### Do screenshot solto ao artefato rastreável

**Exemplo**
“tire um print da tela: teste de API 52”

**O Desktop Agent**
- salva a imagem na pasta correta do projeto;
- usa o texto como descrição;
- gera um nome de arquivo legível;
- envia a evidência para a API.

**O Rayzen**
- organiza por projeto;
- classifica a evidência;
- exibe na interface web;
- alimenta a documentação de testes.

**Categorias automáticas**
- testes de API;
- testes manuais;
- bugs encontrados;
- evidências de correção;
- gerais.

---

## Slide 16 — Valor do projeto
### IA como ferramenta operacional, não pergunta isolada

**Organização**
Centraliza ideias, decisões, documentos, problemas, eventos e próximos passos por projeto.

**Produtividade**
Reduz tempo perdido lembrando contexto, procurando informação e recriando documentação.

**Qualidade**
Ajuda a revisar fluxos, mapear riscos, manter rastreabilidade e documentar decisões.

**Continuidade**
Permite retomar um projeto com muito menos fricção, mesmo após pausas ou troca de ambiente.

---

## Slide 17 — Valor para QA e desenvolvimento
### Menos atrito, mais evidência, mais rastreabilidade

**Para QA**
- registrar testes e falhas com contexto;
- capturar screenshots por projeto;
- classificar evidências automaticamente;
- consolidar documentação de testes;
- acompanhar histórico e padrões de falha;
- evoluir para vínculo entre evidência, execução e caso específico.

**Para desenvolvimento**
- recuperar contexto com rapidez;
- lembrar decisões;
- analisar código e eventos;
- executar ações autorizadas;
- organizar backlog;
- documentar o que foi feito com base no trabalho real.

---

## Slide 18 — Evolução recente
### De assistente inteligente para plataforma operacional

**Antes**
- backend e banco dependentes do notebook;
- Agent único;
- prints locais sem fluxo documental completo;
- maior dependência de contexto manual.

**Agora**
- stack centralizada em VPS;
- Web, API, banco, Redis e LiteLLM hospedados;
- Agents separados por papel;
- projetos isolados por identidade própria;
- evidências integradas à documentação de QA;
- operação mais estável, retomável e auditável.

---

## Slide 19 — Como foi desenvolvido e aprendizados
### Monorepo TypeScript com arquitetura modular

Next.js · NestJS · Fastify · Node.js Agent · PostgreSQL · Prisma · pgvector · Redis · BullMQ · LiteLLM · Puppeteer · DOCX · Notion · Obsidian · Git Hooks

**Aprendizado central**
O maior desafio não é chamar um modelo.  
É montar o contexto correto, validar a entrada, controlar a saída, armazenar memória e transformar resposta em ação útil.

**Mensagem-chave:**  
Sem arquitetura, IA vira só chat.  
Com arquitetura, vira plataforma.

---

## Slide 20 — Encerramento
### Rayzen AI

Uma camada de amplificação para pensar melhor, organizar melhor, testar melhor, documentar melhor e executar com mais clareza.

Não é apenas um chatbot.  
É uma plataforma de inteligência operacional para transformar projetos em sistemas vivos, rastreáveis e evolutivos.
