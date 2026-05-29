# ADR-016 — Knowledge Engine

**Status:** Aprovado  
**Data:** 2026-05-29  
**Origem:** Estudo do projeto Understand Anything + análise da V2

---

## Contexto

Durante o estudo da arquitetura V2, identificamos que o Memory Engine resolve o problema de *recuperação de fatos* (o que foi feito, qual é o status, quais foram as decisões), mas não resolve o problema de *navegação de relações* (como os módulos se conectam, qual o impacto de uma mudança, quais regras dependem de quais entidades).

Projetos como Understand Anything demonstraram que representar conhecimento como grafo — em vez de texto indexado por vetor — reduz significativamente o consumo de tokens e melhora a qualidade das respostas para perguntas que envolvem relações entre componentes.

---

## Problema

Sem um Knowledge Engine:

- Para responder "o que é impactado se eu adicionar Delivery ao VB Ferragens?", o sistema precisa carregar grandes quantidades de contexto textual e pedir para a IA inferir as relações.
- ADRs existem como documentos, mas não como grafo navegável — não é possível perguntar "quais módulos são afetados pelo ADR-003?".
- A análise de impacto de mudanças é cara (muitos tokens) e imprecisa.

---

## Decisão

Adicionar o **Knowledge Engine** como novo componente da arquitetura V2.

O Knowledge Engine **não substitui** o Memory Engine nem o Context Engine. Ele é uma camada adicional especializada em conhecimento estruturado por relações.

```
Memory Engine   → armazena fatos
                  "última tarefa do VB Ferragens foi o catálogo, status: em andamento"

Knowledge Engine → armazena relações
                   "Produto → Categoria → Estoque → Pedido → Cliente"
                   "ADR-001 → impacta → módulo Administração → impacta → módulo Pedidos"
```

---

## Posicionamento na arquitetura

```
Antes:
Mission Engine → Context Engine → Memory Engine → Skills → Execução

Depois:
Mission Engine → Context Engine → Memory Engine → Knowledge Engine → Skills → Execução
```

O Knowledge Engine é consultado após a memória e antes das skills — enriquece o contexto com relações estruturadas sem precisar carregar documentos inteiros.

---

## Estrutura interna

```
apps/api-v2/src/knowledge/
├── graph-builder/         # Extrai relações de código, docs e ADRs
├── graph-storage/         # Persiste o grafo (Neo4j ou pgvector com adjacência)
├── graph-query/           # Interface de consulta por relação
├── impact-analyzer/       # "o que muda se eu alterar X?"
└── relationship-extractor/ # LLM-assisted extraction de relações de texto
```

---

## Skills criadas a partir deste ADR

| Skill | Input | Output |
|---|---|---|
| `skill-project-understanding` | código, docs, ADRs, specs | mapa do projeto: módulos, dependências, regras, fluxos |
| `skill-impact-analysis` | proposta de mudança | módulos impactados, regras afetadas, arquivos estimados |

---

## Consequências

**Positivas:**
- Análise de impacto estruturada e barata (grafo vs. LLM com contexto grande)
- Navegação de projetos sem carregar documentos completos
- Menor consumo de tokens nas consultas de relacionamento
- Base para aproveitamento melhor de modelos com raciocínio (Opus 4.8+)

**Trade-offs:**
- Necessidade de manter o grafo atualizado quando código/docs mudam
- Complexidade adicional de infraestrutura (storage de grafo)
- Custo de extração inicial das relações (LLM-assisted)

**Mitigação do trade-off:** O Graph Builder pode ser executado incrementalmente — só re-extrai quando arquivos relevantes mudam (similar ao `graphify update .` já existente no projeto).

---

## Alternativas consideradas e rejeitadas

**Remover Memory Engine e Context Engine, substituir por grafo puro:**  
Rejeitado. Memória textual e grafos de conhecimento têm papéis complementares. Fatos operacionais (status de tarefa, timeline de eventos) são mais naturais em forma textual. Relações estruturais são mais naturais em grafo.

**Expandir o Memory Engine para incluir relações:**  
Rejeitado. Misturaria responsabilidades distintas e aumentaria complexidade do componente sem ganho de clareza.

---

## Relação com trabalho existente

O projeto já possui `graphify` (gera grafo de código via AST) e `graph/` module (goal graph visual). O Knowledge Engine é uma evolução dessas ideias para o domínio de conhecimento de projeto — não de código apenas.
