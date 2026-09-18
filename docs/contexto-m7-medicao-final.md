# m7 — re-medição da composição do contexto

> Fecha a meta **"O contexto injetado é o melhor que o Rayzen consegue"**.
> Mesmos 3 projetos, mesma consulta e mesmo modo do baseline de 17/08 (m1).
> Medido em **2026-08-20T23:10Z**, contra produção, depois do deploy de m4/m5/m6.

## Volume

| projeto | baseline (17/08) | agora | |
|---|---:|---:|---|
| Rayzen AI (ativo) | 3.800 | **3.114** | −18% |
| Commerce | 2.371 | **1.889** | −20% |
| banco-imob (85d parado) | **4.200** | **2.874** | **−32%** |

**O critério m4 é visível na ordenação.** Antes, o projeto morto era o que mais recebia
contexto. Agora a ordem é Rayzen AI (3.114) → banco-imob (2.874) → Commerce (1.889): quem
está sendo trabalhado recebe mais.

## Composição, por fatia do orçamento

| seção | Rayzen AI | Commerce | banco-imob |
|---|---|---|---|
| `memory_relevant` | 50% → **58,4%** | 30% → **35,6%** | 49% → **70,3%** |
| `recent_events` | 22% → 28,4% | 38% → 45,1% | 30% → **5,0%** |
| `policy_constraints` | 10% → **3,1%** | 15% → **5,1%** | 9% → **3,3%** |
| `planning` | 14% → 0% | 10% → 2,6% | 7% → 10,2% |
| `project_state` | 2% → 2,5% | 7% → 6,0% | 5% → 7,5% |
| `knowledge_graph` | 3% → 4,0% | ausente | ausente |

## O que mudou, e o que não

**Conseguido.** `policy_constraints` caiu de 9–15% para 3–5% em todos (m5: filtrar por quem
faz cumprir, 349 → 96 chars). `recent_events` do projeto parado desabou de 30% para 5% (m4:
janela de 30 dias — os 9 eventos de maio saíram). E o `knowledge_graph` parou de sortear
caminho de arquivo quando a consulta não casa: medido com uma consulta não-correspondente,
a seção agora fica **ausente** em vez de servir 15 caminhos sem relação com a tarefa (m6).

**Não conseguido, e é o achado que sobra.** `memory_relevant` **cresceu como fatia em todos
os três** — 50→58% no Rayzen AI, 49→**70%** no banco-imob. Em valor absoluto ela não mudou:
1.819 e 2.020 chars, os mesmos do baseline. Cresceu porque **todo o resto encolheu**.

Isso não contradiz a meta, mas redefine onde ela continua aberta. A meta pedia densidade, e
a densidade melhorou: saiu texto que não mudava decisão nenhuma. Só que a seção que já era
a maior agora é ainda mais dominante, e **ela nunca foi tocada** — m2 e m3 trataram
classificação e lixo indexado, não o tamanho nem a ordenação.

> **O próximo ciclo tem alvo único e óbvio: `memory_relevant`.** Ela é 58–70% do orçamento,
> e no banco-imob são 2.020 chars de trechos de código de um projeto parado há 85 dias,
> escolhidos por cosseno puro. Cortar 20% dela vale mais que tudo que m4/m5/m6 somaram.

## Método

Reproduzível — mesma chamada dos três:

```bash
curl -X POST http://127.0.0.1:3103/v2/context/surgical \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","task":"implementar cache de sessao no modulo de autenticacao","mode":"implementation"}'
```

> **Cuidado ao repetir:** essa consulta **casa** com nós `file` (`cache.service.ts`), então o
> efeito do m6 **não aparece** nela. Para ver o m6 é preciso uma consulta que não corresponda
> a nenhum nó — foi assim que se mediu "ausente em vez de 15 caminhos".
