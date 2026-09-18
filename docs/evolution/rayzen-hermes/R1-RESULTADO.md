# R1 — preservar trabalho, decidir de verdade, não mentir sobre o resultado

Data: 13/09/2026 · revisão base: `ae7dc0b` · **preparado localmente, não commitado, não implantado**.

Fecha A01, A02 e A04 da [auditoria de 13/09](../../audits/2026-09-13-jarvis/AUDITORIA.md) no escopo
do caminho supervisionado e do poller. Cada correção tem spec que **falha antes e passa depois** —
e cada spec foi executada vermelha de propósito, pelo motivo certo, antes do conserto.

---

## 1. A01 — a limpeza não destrói mais trabalho não commitado

`apps/agent/src/exec/workspace-isolado.ts`

`git worktree remove --force` apagava alteração *tracked* e arquivo novo sem nada recusar. Sem
`--force`, o git **já recusa** remover um checkout sujo — a trava existia e estava desligada na
mesma linha que o comentário acima dela descrevia como segura.

| antes | depois |
|---|---|
| `git worktree remove --force <dir>`, incondicional | mede `git status --porcelain` no checkout; se houver qualquer coisa, **preserva tudo** e devolve `preservadoPorWip: true` |
| — | `--force` removido: a recusa do git volta a valer como segunda linha |
| — | **não conseguir medir conta como sujo** — a dúvida nunca autoriza a operação irreversível |
| — | checkout que já não existe não bloqueia a limpeza do branch (caso legítimo de worktree removido à mão) |

Preservar, e não commitar automaticamente: commit automático varre para o histórico arquivo que
ninguém revisou — a mesma conveniência que já colocou o `AGENT_TOKEN` num commit de bootstrap
nesta casa.

`instrucoesDeMerge()` passou a dizer **onde** o checkout ficou. Preservar em silêncio trocaria
perda de dados por trabalho esquecido em `tmpdir()` — melhor, mas não é o objetivo.

**Specs** (`exec/__tests__/workspace-isolado.spec.ts`, 2 novas):
- checkout com *tracked* alterado **e** arquivo novo → preservado, bytes conferidos, branch intacto
- **controle:** worktree limpo continua sendo removido — impede "preservar" de virar "nunca limpar"

> Vermelho comportamental confirmado antes do conserto: a primeira execução falhou por tipo
> (`preservadoPorWip` não existia), o que **não prova defeito nenhum**. Só depois de acrescentar o
> campo ao contrato, sem a lógica, a falha passou a ser de comportamento — `Expected: true,
> Received: undefined`, com 7 dos 8 casos já verdes. É a diferença entre um teste que compila e um
> teste que mede.

## 2. A02 — silêncio não aprova, e a resposta oferecida é reconhecida

`apps/agent/src/actions/resposta-aprovacao.ts` (novo) · `actions/supervised-session.ts`

Três defeitos somados, o terceiro não registrado pela auditoria:

| # | defeito | efeito |
|---|---|---|
| 1 | `if (!reply \|\| ...)` | o **silêncio** entrava no ramo APROVOU |
| 2 | `\bpode\b` casa dentro de `"não pode"` | a **negação** aprovava |
| 3 | alternativas são prefixos com `\b` no fim, que nunca fecha entre word chars | `"Aprovado, continue"` e `"Rejeitar e corrigir"` — **as opções que o próprio Telegram oferece** — caíam ambas em "instrução modificada". A rejeição era inalcançável pelos botões apresentados |

`classificarResposta(reply)` devolve `'sem_resposta' | 'aprovado' | 'rejeitado' | 'instrucao'`.
**`sem_resposta` como valor de primeira classe é o ponto inteiro:** enquanto o silêncio era a
ausência de um `else`, ele se comportava como a opção mais permissiva; agora o tipo obriga quem
chama a dizer o que faz com ele.

Regras, em ordem: índice puro (`1`/`2`/`3` — a mensagem já numera as opções, e número é
determinístico) → **negador antes de afirmação** (com negador presente, `aprovado` está fora da
mesa) → rejeição → aprovação → instrução.

No loop, `sem_resposta` **encerra a sessão** com mensagem explícita e o branch nomeado. Nenhuma
etapa nova é executada.

**Spec** (`actions/__tests__/resposta-aprovacao.spec.ts`, 40 casos): silêncio em 5 formas, as 3
opções literais, 5 índices, 7 negações, 9 afirmações, 7 rejeições e 3 instruções livres.
Vermelho contra um stub: **27 falharam, 13 passaram** — o teste discrimina, não aceita qualquer
implementação.

> Extraído para arquivo próprio porque decisão de autorização precisa ser testável sozinha, com
> tabela de casos — não verificada de passagem dentro de um loop de 100 linhas que fala com a API,
> com o Claude e com o git.

## 3. A04 — falha não vira sucesso, ruído não vira conclusão

Dois pontos independentes, mesma família.

**`apps/agent/src/poller.ts`** — `status: 'done'` era incondicional: só exceção lançada virava
`failed`. Ação que devolve `{ ok: false, error }` (o caso normal de quem trata o próprio erro)
era gravada como concluída, e o evento seguinte publicava *"Task concluída"* no contexto futuro.

A comparação é **estrita** (`ok === false`), nunca `!ok`: a maioria das 43 ações não devolve `ok`
nenhum, e tratar ausência como falha mudaria o comportamento de todas elas de graça.

**`actions/supervised-session.ts`** — saída sem marcador do protocolo virava `complete` com
`ok: true` bastando passar de 50 caracteres. Tamanho de texto nunca foi evidência de trabalho
feito. Agora encerra como **indeterminada**, com a última saída anexada e o branch nomeado — o
que foi produzido continua alcançável, não se descarta trabalho.

**Spec** (`__tests__/poller-falha-de-dominio.spec.ts`, 9 casos): `ok:false` com e sem `error`,
ausência de evento de conclusão, `ok:true` ainda sucesso, e **5 casos de controle** (objeto sem
`ok`, string, array, `null`, `undefined`) provando que as ações que nunca declararam `ok` não
mudam de comportamento. Vermelho antes: **3 falharam, 6 passaram**.

---

## 4. Estado

| item | estado |
|---|---|
| `pnpm --filter agent exec tsc --noEmit` | ✅ exit 0 |
| specs novas (A01, A02, A04) | ✅ verdes, todas vermelhas antes pelo motivo certo |
| **suíte completa do agent** | ✅ **48 suites / 629 testes, tudo verde** |
| `docs/exec-paths.md` (anti-drift) | ✅ regenerado — delta é só deslocamento de linha, **0 pontos "montada" preservado** |
| commit / push / deploy | ❌ **nada** — preparado localmente |
| C01, C02, C03 | atendidos no escopo do caminho supervisionado e do poller |

### Achado no caminho: a suíte poluía `~/Projects` e falhava por isso

A primeira execução completa deu **8 suites / 9 testes falhando**, e a causa não era nenhuma das
correções. `workdir.spec.ts` comparava o diretório que `resolverWorkdir()` acha com o que a
fixture da rodada criou — e recebia um **leftover de execução anterior**:

```
Expected: "...\rayzen-workdir-teste-y85Mla"   (criado nesta rodada)
Received: "...\rayzen-workdir-teste-N8N8DE"   (sobra de antes)
```

`~/Projects` tinha **9 fixtures órfãs** de três suites diferentes (`rayzen-workdir-teste-*`,
`rayzen-cmd-isolado-*`, `rayzen-git-fase1-*`), de 11 a 13/09. Como `resolverWorkdir()` varre
`~/Projects` e devolve o primeiro casamento, o resultado dependia de **o que sobrou no disco de
execuções passadas** — falha não-determinística, que muda conforme a ordem e o histórico.

Movidas para o scratchpad da sessão (não apagadas — são reversíveis lá), a suíte passou a
**629/629**.

> **Isto é um defeito real e pré-existente, deixado em aberto de propósito**: consertar a higiene
> das três suites é trabalho fora do bloco R1, e o plano é explícito em registrar em vez de sair
> corrigindo o que se encontra pelo caminho. Mas ele merece atenção própria — é da mesma família
> dos sensores desta casa: um teste cujo resultado depende de lixo acumulado em disco **passa e
> falha pelo motivo errado**, e foi sorte ter falhado agora em vez de mascarar uma regressão
> depois. Fixture de teste não deveria nascer no diretório pessoal de projetos.

## 5. Limites declarados

- **Escopo.** Só `apps/agent`. A03 (despacho desconectado) é R2 e **continua aberto de propósito**:
  ligar o despacho antes destas correções ativaria o caminho onde o silêncio aprovava e a limpeza
  destruía.
- **`type === 'question'`** mantém `[O usuário não respondeu a tempo — use o melhor julgamento
  para continuar]` quando não há resposta. É família parecida, mas **não é autorização de etapa**,
  e o bloco R1 é sobre aprovação. Registrado, não corrigido.
- **Não exercitado ponta a ponta.** As specs usam fixtures git reais e executores simulados.
  Nenhuma sessão supervisionada de verdade rodou: C01–C03 estão atendidos no nível de
  comportamento testado, não de jornada completa. A jornada é I1.
- **Worktree sujo agora ocupa disco** até alguém olhar. Troca aceita e declarada — disco é
  recuperável, trabalho não. Se virar problema, a saída é um comando de limpeza explícito, nunca
  o `--force` de volta. (`hermes worktree` existe como precedente do conceito; o nosso seria
  próprio.)
