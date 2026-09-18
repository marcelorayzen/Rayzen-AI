# Purple team no Rayzen — ciclo, alvos e o que já está fechado

> Funde o blueprint de purple team (escrito semanas atrás) com o estado medido em **2026-08-15**.
> O método daquele blueprint continua certo; seis das premissas dele venceram. Este documento
> mantém o ciclo e troca os alvos.
>
> Complementa [`plano-estudo.md`](plano-estudo.md), que traz os blocos de estudo. Aqui está a
> mecânica: quem ataca, quem observa, e como os dois se encontram.

## O ciclo, em uma frase cada

- **Red** — tentar contornar controle, não confirmar que ele funciona. A diferença é a mentalidade:
  teste de QA pergunta "faz o que promete?", red team pergunta "o que consigo fazer que não estava previsto?"
- **Blue** — ter visibilidade de que algo aconteceu, e capacidade de responder. Log passivo que
  ninguém lê é meio caminho
- **Purple** — não é time, é a prática de fechar o ciclo: red ataca, blue detecta (ou não), e o
  gap vira decisão registrada
- **Green** — melhorar a infraestrutura a partir do que red e blue acharam (ex.: dependências)
- **White** — quem arbitra o que é risco aceitável. Em projeto solo, é você — e vale escrever,
  senão vira suposição

---

## O que já está fechado (medido, não presumido)

O blueprint original mirava dois alvos. **Os dois já foram resolvidos**, e a verificação levou
minutos — vale mais que a suposição de que continuavam abertos:

| Alvo do blueprint | Estado em 2026-08-15 |
|---|---|
| Drift de role-policy entre `ExecutionService` e `whitelist.ts` | **Resolvido.** Comparei as duas fontes: **44 ações em cada, zero divergência** |
| "Nunca ter ADR" sobre isso | **ADR-001 a ADR-004** existem, exatamente sobre role-policy |
| Upgrade NestJS 11 pendente | `@nestjs/core ^11.0.0` nos dois apps |
| 3 vulnerabilidades `high` | Hoje são **28** (eram 15 em 02/08) — o alvo mudou de tamanho, não de natureza |

Outras premissas que envelheceram: 33 ações (são 44), 239 testes (são 592), e o
`apps/catalog-guardian` (saiu do monorepo em 05/08).

---

## O que a investigação de hoje corrigiu

O blueprint afirma: *"o `agent_audit_logs` já é blue team (toda execução persistida)"*.

À primeira vista isso parecia falso — **449 linhas, última em 2026-06-26, zero em 30 dias**. Um
gravador parado invalidaria o ciclo purple inteiro: não dá para dizer "não fui detectado" se o
detector está desligado.

**Estava certo, e eu estava errado.** O teste: despachei `git_status` pelo caminho real
(`api-v2 → POST /execution/dispatch → fila BullMQ → agent desktop`). Resultado `HTTP 201` com
saída legítima, job novo na fila com status `done`, e o audit log foi de **449 para 450**.

O silêncio era **ausência de tarefa**, não gravador quebrado. Nenhuma ação `jarvis:*` foi
despachada entre 26/06 e hoje, porque o executor de missões está congelado por decisão de produto.
A última linha de audit é **um segundo depois** do último job da fila — o gravador acompanhou até
o fim e depois não teve mais o que gravar.

> Lição do próprio exercício: "tabela sem linha nova" tem pelo menos duas causas — o escritor
> quebrou, ou não houve o que escrever. Elas se parecem e exigem respostas opostas. Verificar
> custa um despacho de teste.

---

## O gap real de visibilidade

O `agent_audit_logs` cobre bem **uma** superfície: execução de ação do agent. Registra `action`,
`command`, `risk`, `dry_run`, `duration_ms`, `status`, `result`, `error`, `workspace`, `hostname`,
`target_role`. Para a superfície mais perigosa do sistema, é bom.

**O que nenhuma tabela registra hoje:**

| Superfície | Visibilidade |
|---|---|
| Falha de autenticação (`401`) | nenhuma — só o log do container, que rotaciona |
| Acesso a rotas da API | nenhuma — sem audit de request |
| Chamadas de tool via MCP | nenhuma |
| Chamadas LLM | Langfuse (desde 14/08, e só a partir daí) |

Consequência para purple team: um red team que sondar autenticação, tentar path traversal por uma
rota, ou injetar prompt via arquivo indexado **não deixa rastro em lugar nenhum**. O ciclo fecharia
com "blue não detectou" — mas sem saber se o ataque foi furtivo ou se ninguém estava ouvindo.

**Este é o alvo blue de maior valor hoje**, e é mais barato que parece: os 401 já passam por um
guard único (`AgentTokenGuard`) e as rotas por um `JwtAuthGuard`. Um audit de tentativa recusada
sai de dois lugares.

---

## Ordem sugerida

| # | Fase | O quê | Vem de |
|---|---|---|---|
| 1 | 🔵 blue | Audit de tentativa de autenticação recusada — hoje 401 não deixa rastro | achado de 15/08 |
| 2 | 🟣 purple | **Teste anti-drift**: um spec que lê `whitelist.ts` e o mapa do `ExecutionService` e falha se divergirem. Verificado: **não existe**. As duas concordam hoje por disciplina, não por garantia | blueprint — a parte que sobrevive |
| 3 | 🔴 red | Specs adversariais contra a whitelist: `..%2f`, `\\?\C:\`, symlink, `;`, `$()` | plano de estudo, bloco 3 |
| 4 | 🟣 purple | Rodar o red do passo 3 e conferir o que apareceu no audit log — o primeiro ciclo fechado de verdade | fusão |
| 5 | 🔴 red | Injeção indireta: arquivo do repo com instruções → hook → contexto → modelo | plano de estudo, bloco 5 |
| 6 | 🟢 green | Triar as 28 `high` por **exploitabilidade no modelo real** (single-user, atrás do túnel), não por CVSS. Fechar com `pnpm audit --audit-level=high` no CI | blueprint + plano |
| 7 | ⚪ white | Apetite de risco escrito. Começado: seção "Lacunas conhecidas" no `SECURITY.md` | blueprint |

O passo 2 é o mais barato e o de melhor relação custo-benefício: impede a volta de um problema que
já custou trabalho uma vez.

---

## Sobre a referência OWASP do blueprint original

O blueprint mapeia tudo contra um "OWASP Top 10 for Agentic Applications (ASI01–ASI10)". **Não
consigo confirmar essa taxonomia** — conheço o OWASP Top 10 for LLM Applications, esse específico
não. Não estou afirmando que não exista; estou registrando que não verifiquei, e que vale checar
na fonte antes de usar como referência formal em material público.

A lógica do mapeamento se sustenta sem a sigla: uso indevido de ferramenta no agent, abuso de
privilégio na política, cadeia de suprimentos nas dependências, envenenamento de contexto na
memória. São riscos reais deste sistema, tenham o nome que tiverem.

---

## Nota de método

O blueprint original não estava errado — estava **vencido**. Foi escrito com dados corretos na
época e envelheceu em silêncio, que é exatamente o modo de falha que este projeto coleciona:
*nada dá erro, tudo parece sólido, e a premissa não vale mais*.

Vale para este documento também. Ele tem data no topo por isso.
