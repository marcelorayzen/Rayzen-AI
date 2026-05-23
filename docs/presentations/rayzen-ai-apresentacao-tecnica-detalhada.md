# Rayzen AI — apresentação técnica detalhada

> Versão pensada para demonstrar o projeto a um PO, recrutador técnico, tech lead ou pessoa de produto com alguma familiaridade em tecnologia.
>
> Objetivo: mostrar que o Rayzen AI não é apenas um chatbot, mas uma plataforma operacional com arquitetura, contexto por projeto, automação controlada, documentação viva e rastreabilidade de QA.

---

## Slide 1 — Capa

### Rayzen AI
**Plataforma de inteligência operacional para projetos de tecnologia**

Memória por projeto, execução segura, documentação viva e evidências de QA em um único fluxo.

**Subtítulo sugerido:**  
Um sistema para transformar trabalho técnico disperso em contexto rastreável, reutilizável e acionável.

**Fala sugerida:**  
O Rayzen AI nasceu para resolver um problema comum em desenvolvimento: muito do que acontece em um projeto fica espalhado em conversas, terminais, prints, documentos e decisões não registradas. A proposta é centralizar esse contexto e permitir que ele seja usado para retomada, documentação, QA e execução assistida.

---

## Slide 2 — Problema real

### Projetos perdem conhecimento operacional todos os dias

Durante o desenvolvimento, informações importantes ficam dispersas:

- decisões técnicas em chats;
- comandos executados no terminal;
- erros resolvidos sem registro;
- prints de teste fora do contexto;
- documentação que não acompanha o código;
- troca constante entre projetos, ambientes e ferramentas.

**Consequência:**  
retomar um projeto exige reconstruir mentalmente o histórico, entender o que mudou, lembrar decisões e procurar evidências.

**Fala sugerida:**  
O problema não é falta de ferramenta. É excesso de informação sem organização operacional. Git registra código, mas não registra bem o raciocínio, os testes manuais, os prints, as decisões e o contexto de retomada.

---

## Slide 3 — Proposta de solução

### Uma camada operacional centrada no projeto

O Rayzen AI atua como uma camada entre o usuário, o projeto e as ferramentas de trabalho.

Ele foi desenhado para:

- capturar eventos reais do trabalho;
- associar tudo ao projeto correto;
- organizar memória técnica;
- gerar documentação viva;
- apoiar QA com evidências;
- executar ações autorizadas via Agents;
- ajudar na retomada e nos próximos passos.

**Mensagem-chave:**  
O projeto deixa de ser apenas um repositório de código e passa a ter uma memória operacional própria.

---

## Slide 4 — Visão de produto

### O que o Rayzen entrega para o usuário

**Para desenvolvimento**
- recuperação rápida de contexto;
- histórico de decisões;
- apoio em análise de código;
- execução assistida de tarefas;
- documentação baseada no trabalho real.

**Para QA**
- registro de evidências por projeto;
- organização de screenshots;
- documentação de testes;
- rastreabilidade de falhas;
- base para análise de padrões.

**Para gestão do projeto**
- estado atual;
- bloqueios;
- riscos;
- próximos passos;
- health score e recomendações.

**Fala sugerida:**  
Para um PO, o valor está em visibilidade e continuidade. Para desenvolvimento, está em não perder contexto. Para QA, está na rastreabilidade. A mesma base de eventos alimenta todos esses usos.

---

## Slide 5 — Arquitetura geral

### Frontend, API, infraestrutura e Agents

**Frontend — Next.js**
- chat;
- seleção de projeto;
- documentação;
- evidências;
- QA;
- configurações.

**API — NestJS + Fastify**
- orquestração;
- memória;
- execução;
- documentos;
- eventos;
- projetos;
- QA;
- evidências.

**Infraestrutura**
- PostgreSQL + pgvector;
- Redis + BullMQ;
- LiteLLM;
- Docker Compose;
- VPS Ubuntu.

**Agents**
- Desktop Agent no PC de trabalho;
- Server Agent na VPS.

**Fala sugerida:**  
A arquitetura separa três responsabilidades: experiência do usuário, núcleo de orquestração e execução. O ponto importante é que a execução não é livre: ela passa por fila, permissões e papel do Agent.

---

## Slide 6 — Fluxo de uma mensagem

### Como uma solicitação vira ação ou conhecimento

1. Usuário envia uma mensagem no chat.
2. A API valida a entrada.
3. O Orchestrator classifica a intenção.
4. O sistema escolhe o módulo responsável.
5. A resposta pode virar:
   - busca de memória;
   - execução via Agent;
   - geração de documento;
   - criação de evidência;
   - síntese;
   - recomendação.

**Exemplo:**  
“tire um print da tela: teste de API 52”

Esse comando vira:
- tarefa para o Desktop Agent;
- arquivo salvo no projeto correto;
- evidência enviada para a API;
- registro na interface;
- item na documentação de testes.

---

## Slide 7 — Orchestrator

### O núcleo de decisão da plataforma

O Orchestrator é responsável por transformar intenção em fluxo técnico.

Ele precisa decidir:

- qual módulo deve responder;
- se a mensagem é chat, memória, documento, execução ou QA;
- se existe confirmação pendente;
- qual payload será enviado;
- qual modelo deve ser usado;
- como devolver a resposta ao usuário.

**Por que isso importa:**  
sem uma camada de orquestração, o sistema vira apenas uma chamada direta a um modelo. Com orquestração, a IA passa a operar sobre regras, módulos e contexto.

---

## Slide 8 — Memória e Brain

### Busca semântica aplicada ao contexto do projeto

O Rayzen usa memória semântica para recuperar informações mesmo quando a pergunta não usa as mesmas palavras do documento original.

**Pipeline**

1. documentos, conversas e eventos entram no sistema;
2. o conteúdo é dividido em chunks;
3. embeddings são gerados;
4. vetores são armazenados no PostgreSQL com pgvector;
5. consultas futuras recuperam o contexto relevante.

**Resultado prático:**  
o usuário pode perguntar “onde parei?”, “qual foi a decisão sobre Docker?” ou “quais problemas tivemos no login?” e o sistema busca contexto no histórico real.

---

## Slide 8A — Captura de atividade

### Claude hook + workspace watcher

O Rayzen possui dois caminhos de captura:

**Claude hook**
- registra eventos ricos do Claude Code;
- captura uso de ferramentas, arquivos lidos/editados e fim de sessão;
- depende do hook configurado no Claude.

**Workspace watcher**
- roda no Desktop Agent;
- observa repositórios Git configurados;
- detecta mudanças feitas por Codex, VS Code, terminal comum ou outras ferramentas;
- associa a atividade ao projeto correto pelo `repoSlug`.

**Mensagem-chave:**  
o Rayzen não deve depender de uma única ferramenta. O Claude fornece captura detalhada; o watcher garante captura operacional agnóstica.

---

## Slide 9 — Documentação viva

### Documentação gerada a partir de eventos reais

O sistema gera e atualiza artefatos como:

- diário do projeto;
- estado atual;
- resumo de sessão;
- decisões;
- próximos passos;
- documentação técnica;
- evidências de teste.

**Diferença para documentação tradicional:**  
ela não depende apenas de escrita manual depois do trabalho. Ela nasce dos eventos, conversas, capturas e ações realizadas durante o fluxo.

**Fala sugerida:**  
A documentação viva reduz o custo de manter histórico. Ela não substitui a revisão humana, mas entrega uma base atualizada para ser refinada.

---

## Slide 10 — Agents por papel

### Execução distribuída com limite de responsabilidade

O Rayzen usa dois papéis de Agent.

**Desktop Agent**
Roda no PC de trabalho e executa ações locais:

- tirar screenshot;
- interagir com área de trabalho;
- abrir ferramentas;
- apoiar testes locais;
- salvar evidências no diretório correto.

**Server Agent**
Roda na VPS e executa ações da infraestrutura:

- ler logs;
- consultar Docker;
- reiniciar serviços;
- apoiar operação do ambiente hospedado.

**Decisão arquitetural:**  
a VPS não deve controlar diretamente a máquina local. Cada Agent tem escopo próprio.

---

## Slide 11 — Segurança operacional

### Automação com guardrails

Como o sistema executa ações reais, segurança é parte da arquitetura.

**Proteções aplicadas**

- whitelist de ações permitidas;
- bloqueio de path traversal;
- separação por diretórios seguros;
- confirmação para ações de maior risco;
- divisão entre Agent desktop e Agent server;
- ausência de execução livre de comandos arbitrários como padrão;
- headers HTTP via Helmet v11 (CSP, HSTS 1 ano, X-Frame-Options, noSniff);
- senha com argon2id e comparação em tempo constante (`timingSafeEqual`);
- CORS restrito por whitelist de origens via `CORS_ORIGINS`;
- Agent Audit Log — toda execução registrada em `agent_audit_logs` com actor, módulo, ação, risco, dryRun, duração e status; consultável via `GET /tasks/audit`.

**Por que isso importa para produto:**  
a automação precisa ser útil sem virar risco operacional. O usuário mantém controle sobre ações sensíveis.

---

## Slide 12 — Evidências de QA

### Screenshots deixam de ser arquivos soltos

Um dos avanços recentes foi transformar prints em artefatos rastreáveis.

**Fluxo**

1. O usuário pede uma captura com descrição.
2. O Agent identifica o projeto ativo.
3. A imagem é salva em uma pasta baseada no `repoSlug`.
4. A descrição vira nome amigável do arquivo.
5. A evidência é enviada para a API.
6. O web exibe a evidência.
7. A documentação de testes é alimentada automaticamente.

**Exemplo de comando**

```text
tire um print da tela: teste de API 52
```

**Resultado**

```text
teste-de-api-52-2026-05-18...
```

---

## Slide 13 — Organização por projeto

### Separação para evitar mistura de contexto

O Rayzen trabalha com uma premissa importante: cada projeto precisa ter identidade própria.

**O que fica separado**

- eventos;
- memória;
- screenshots;
- evidências;
- documentação;
- recomendações;
- estado do projeto.

**Padrão técnico**

- nome de projeto para exibição;
- `repoSlug` para identidade técnica;
- pastas de evidência por projeto;
- documentação gerada dentro do contexto correto.

**Mensagem-chave:**  
sem separação por projeto, a IA pode misturar decisões, evidências e contexto de produtos diferentes.

---

## Slide 14 — QA e rastreabilidade

### Caminho para qualidade baseada em evidências

O Rayzen já possui uma base para apoiar QA:

- execução de testes por Agent;
- captura de falhas;
- ingestão de relatórios;
- evidências visuais;
- classificação automática;
- documentação de evidências;
- dashboard e histórico como direção evolutiva.

**Categorias de evidência**

- testes de API;
- testes manuais;
- bugs encontrados;
- evidências de correção;
- gerais.

**Próximo passo planejado**

1. vincular evidências a um `TestRun`;
2. depois vincular evidências a um caso ou falha específica.

---

## Slide 15 — Stack técnica

### Principais tecnologias utilizadas

**Frontend**
- Next.js;
- React;
- TypeScript.

**Backend**
- NestJS;
- Fastify;
- Prisma;
- PostgreSQL;
- pgvector.

**Infraestrutura**
- Docker;
- Docker Compose;
- Redis;
- BullMQ;
- LiteLLM;
- VPS Ubuntu.

**IA e automação**
- modelos via LiteLLM;
- embeddings;
- MCP;
- Agents em Node.js;
- geração de documentos com Puppeteer/DOCX.

**Observabilidade e qualidade**
- prom-client (Prometheus);
- @fastify/helmet;
- GitHub Actions CI;
- 198 testes automatizados (unitários + E2E).

---

## Slide 16 — Decisões técnicas relevantes

### Algumas escolhas que mostram maturidade do projeto

**LiteLLM como proxy**
Permite trocar providers e modelos sem acoplar o código a um fornecedor.

**PostgreSQL + pgvector**
Evita criar uma stack separada só para busca semântica e mantém memória próxima dos dados do projeto.

**Redis + BullMQ**
Separa requisição web de execução assíncrona e permite que Agents façam polling de tarefas.

**Agents por papel**
Reduz risco e evita que a infraestrutura remota tenha controle amplo sobre o PC.

**Evidências por `repoSlug`**
Garante organização técnica consistente mesmo quando o nome visual do projeto muda.

---

## Slide 17 — Estado atual do sistema

### O que já está funcionando

- Web e API rodando em VPS;
- banco PostgreSQL migrado para o ambiente hospedado;
- Redis, LiteLLM e Docker Compose configurados;
- login e interface web disponíveis;
- Agent server operando junto da stack;
- Desktop Agent executando ações locais;
- screenshots salvos por projeto;
- upload de evidências para API;
- visualização de evidências no web;
- documento de evidências de teste gerado;
- observabilidade Prometheus ativa — HTTP, LLM tokens por módulo/modelo, Agent tasks, queue size;
- Agent Audit Log registrando toda execução;
- 198 testes automatizados com GitHub Actions CI (typecheck, lint, unit, E2E);
- hardening de segurança: Helmet, argon2id, timingSafeEqual, CORS, audit log.

**Leitura técnica:**  
o projeto saiu de um ambiente local/notebook e evoluiu para uma arquitetura operacional mais estável.

---

## Slide 18 — Demonstração sugerida

### Fluxo para apresentar ao vivo

**1. Abrir a interface web**
Mostrar login, seleção de projeto e chat.

**2. Selecionar um projeto**
Explicar que tudo fica associado ao projeto ativo.

**3. Pedir uma captura**

```text
tire um print da tela: teste manual do login
```

**4. Mostrar o resultado**
- resposta no chat;
- evidência na aba de evidências;
- arquivo salvo na pasta correta;
- documentação de teste atualizada.

**5. Mostrar a arquitetura**
Explicar Desktop Agent, Server Agent, API, Redis, Postgres e LiteLLM.

---

## Slide 19 — Valor para um time

### Onde isso se encaixa em um fluxo real

**Para o desenvolvedor**
- reduz perda de contexto;
- apoia análise;
- automatiza tarefas controladas;
- documenta decisões.

**Para QA**
- melhora rastreabilidade;
- centraliza evidências;
- aproxima teste manual e documentação;
- cria base para histórico de falhas.

**Para PO**
- dá visibilidade do estado;
- ajuda a entender bloqueios;
- melhora continuidade;
- reduz dependência de memória individual.

**Para recrutador técnico**
- demonstra capacidade full stack;
- mostra arquitetura com IA aplicada;
- evidencia preocupação com operação, segurança e QA.

---

## Slide 20 — Aprendizados

### O desafio não é só chamar um modelo

Os principais aprendizados do projeto:

- IA precisa de contexto confiável;
- automação precisa de guardrails;
- documentação precisa nascer do fluxo real;
- QA precisa de evidência, não só relato;
- projetos diferentes precisam de separação forte;
- infraestrutura importa para transformar protótipo em sistema utilizável.

**Mensagem-chave:**  
sem arquitetura, IA vira apenas chat. Com arquitetura, vira uma camada operacional.

---

## Slide 21 — Roadmap

### Próximas evoluções planejadas

**QA**
- vincular evidências a `TestRun`;
- vincular evidências a falhas específicas;
- melhorar dashboard de histórico e cobertura.

**Operação**
- configurar domínio e HTTPS (próximo passo prioritário);
- Prometheus já ativo — evoluir para dashboard Grafana.

**Produto**
- melhorar onboarding de novos projetos;
- tornar documentação de testes mais navegável;
- fortalecer recomendações proativas.

**Arquitetura**
- continuar separando responsabilidades;
- evoluir contratos entre módulos;
- conectar Prometheus a um dashboard Grafana.

---

## Slide 22 — Fechamento

### Rayzen AI

O Rayzen AI é uma plataforma de inteligência operacional para projetos técnicos.

Ele combina:

- memória por projeto;
- IA aplicada com orquestração;
- execução segura;
- documentação viva;
- QA com evidências;
- infraestrutura real.

**Frase final sugerida:**  
O objetivo não é substituir o trabalho técnico, mas aumentar a capacidade de lembrar, organizar, testar, documentar e executar com mais clareza.
