# Plano de estudo — segurança aplicada ao Rayzen

> Escrito em 2026-08-15. Cada bloco parte de algo **medido neste sistema**, não de um currículo
> genérico. O laboratório é o próprio Rayzen: ele tem autenticação, sandbox de execução remota,
> proxy de LLM, agente com acesso ao filesystem e um túnel para a internet. Superfície de sobra.
>
> O ângulo é deliberado: você é QA. Segurança ofensiva e teste automatizado são a mesma
> disciplina com objetivos diferentes — ambos procuram o caso que o autor não imaginou. É o
> caminho mais curto entre o que você já sabe e o que quer aprender.

> **Mecânica do ciclo purple team** (red/blue/purple/green/white, alvos e ordem de execução):
> [`purple-team.md`](purple-team.md). Este documento traz **o que estudar**; aquele traz
> **como exercitar** contra o sistema.

## Onde o sistema está hoje (medido em 2026-08-15)

| Área | Estado |
|---|---|
| Borda HTTP | `helmet` ✅ · `ValidationPipe` com `whitelist: true` ✅ · CORS configurado ✅ · **rate limiting ausente** |
| Autenticação | dois modelos: `JwtAuthGuard` (só assinatura) e `AgentTokenGuard` (comparação byte a byte) |
| Revogação de token | **não existe** — emitir token novo não invalida o anterior |
| Sandbox do agent | whitelist de ações, bloqueio de path traversal, `dryRun` em risco médio/alto |
| Dependências | **0 critical · 28 high · 37 moderate · 11 low** (era 15 high em 02/08 — regrediu) |
| Testes tocando segurança | 17 specs |
| Segredos | `pnpm scan:secrets` gera `docs/security/data-inventory.md` — ninguém lê o resultado |

---

## Bloco 1 — Modelagem de ameaça do que você já construiu

**Por que primeiro:** sem isto, os blocos seguintes viram lista de ferramentas. Modelagem é o que
transforma "sei usar o Burp" em "sei o que procurar".

**Estudar:** STRIDE, trust boundaries, e a diferença entre *asset*, *ameaça* e *vulnerabilidade*.
Fonte curta e boa: OWASP Threat Modeling Cheat Sheet.

**Exercício:** desenhar as fronteiras de confiança do Rayzen. Ele tem pelo menos cinco:
navegador→API, API→agent desktop, agent→filesystem do seu PC, API→LiteLLM→provedores externos,
e internet→Cloudflare Tunnel→Caddy. Para cada uma: o que atravessa, quem valida, e o que acontece
se o lado de lá mentir.

**Prova de que funcionou:** um documento que aponte pelo menos uma fronteira onde a validação é
mais fraca do que você supunha. (Palpite: `AgentTokenGuard` dá acesso total às rotas do agent com
um único segredo compartilhado, sem escopo por ação.)

---

## Bloco 2 — Autenticação e sessão, com um caso real na mão

**Por que agora:** você já tem um achado concreto desta semana para dissecar — a rotação de token
de 15/08 revelou que **não existe revogação** e que dois guards validam de formas diferentes.

**Estudar:** JWT (assinatura vs. criptografia, `exp`/`iat`/`jti`), por que blacklist é difícil em
sistema stateless, refresh tokens, e o padrão *token binding*. Depois: OWASP ASVS capítulos 2 e 3
— é checklist, não teoria, e serve como régua.

**Exercício no Rayzen:** projetar (não necessariamente implementar) revogação. As perguntas reais:
onde guardar a denylist sem transformar cada request numa consulta ao banco? `jti` + Redis com TTL
igual ao `exp` resolve? O que acontece com o agent desktop, que compara byte a byte e não valida
JWT nenhum?

**Prova:** um ADR curto propondo o modelo, com o custo por request estimado. Se a conclusão for
"não vale a pena para um sistema de um usuário", isso também é um resultado — e passa a ser decisão
registrada em vez de lacuna.

---

## Bloco 3 — A superfície mais perigosa: o agent

**Por que:** é o único componente que executa comando arbitrário na sua máquina. Toda a segurança
dele mora em `apps/agent/src/security/whitelist.ts` e em alguns `if`.

**Estudar:** command injection, path traversal (incluindo as variantes que o `..` ingênuo não pega —
encoding duplo, symlink, UNC no Windows), TOCTOU, e o princípio de menor privilégio aplicado a
executores remotos.

**Exercício:** escrever specs **adversariais** contra a whitelist. Não "o caminho feliz funciona",
mas "o que acontece com `..%2f`, com `\\?\C:\`, com um symlink apontando para fora do sandbox,
com um nome de arquivo contendo `;` ou `$()`". Você é QA — este é literalmente teste de fronteira,
só que o oráculo é "não deve acontecer nada".

**Prova:** pelo menos um caso adversarial que passe hoje e não deveria. Se nenhum passar, a
whitelist é mais sólida do que parece — e você terá 20 testes novos provando isso.

---

## Bloco 4 — Cadeia de suprimentos

**Por que:** 28 vulnerabilidades `high` nas dependências, contra 15 em 02/08. Regrediu, e ninguém
percebeu — porque `pnpm audit` não roda no CI.

**Estudar:** como um advisory nasce (CVE, GHSA), a diferença entre vulnerabilidade *alcançável* e
*presente* (a maioria dos `high` transitivos nunca é atingível pelo seu código), SBOM, e ataques
de typosquatting/dependency confusion.

**Exercício:** triar as 28. Para cada uma: é dependência direta ou transitiva? O caminho vulnerável
é alcançável a partir do seu código? Existe versão corrigida sem quebrar o `peerDep`? O resultado
esperado não é "zerar", é **saber quais importam** — provavelmente 3 ou 4.

**Prova:** um `pnpm audit --audit-level=high` no CI que passe, com as exceções justificadas por
escrito. Hoje o único gate é lint e teste.

---

## Bloco 5 — Segurança específica de sistemas com LLM

**Por que:** é o que o mercado ainda não sabe fazer, e você tem um sistema que faz tudo que é
arriscado: injeta contexto de fontes variadas no prompt, dá ferramentas ao modelo, e executa o
que ele decide.

**Estudar:** OWASP Top 10 for LLM Applications. Os que te tocam de verdade: **prompt injection
indireta** (LLM01) — um arquivo do repositório com instruções embutidas entra no seu contexto
via hook; **excessive agency** (LLM06) — o specialist decide chamar `jarvis:*`; e
**sensitive information disclosure** (LLM02) — o que vai no prompt vai para o Groq.

**Exercício:** injeção indireta no seu próprio sistema. Coloque num arquivo do repo um comentário
com instruções endereçadas ao assistente, e veja se ele sobrevive à indexação, ao
`rayzen_get_context` e chega ao modelo com força suficiente para mudar comportamento. É um teste
que você pode rodar em 20 minutos e o resultado é informativo dos dois jeitos.

**Prova:** uma nota registrando se a injeção funcionou, e onde ela teria sido barrada. Se
funcionou, o Bloco 1 ganha uma fronteira nova.

---

## O que este plano deliberadamente não inclui

- **Certificação** (Security+, OSCP). Não porque não valha — mas porque estudar para prova e
  estudar sobre um sistema real são atividades diferentes, e a segunda é a que consolida.
- **Pentest de terceiros.** Sem autorização por escrito, não se testa sistema que não é seu.
  O Rayzen é seu; qualquer coisa fora dele exige escopo formal.
- **Infraestrutura de rede.** O Cloudflare Tunnel elimina port forwarding e é hoje a parte menos
  frágil do conjunto. Estudar firewall antes de estudar o agent seria começar pelo lado forte.

## Ordem sugerida e por quê

1 → 3 → 5 → 2 → 4.

O bloco 1 dá o mapa. O 3 é onde está o risco real e onde sua habilidade de QA rende mais rápido.
O 5 é o diferencial de mercado. O 2 é teórico e o achado já está na mão, então pode esperar.
O 4 é o mais chato e o mais mecânico — deixa por último, mas não pule: é o único que hoje está
regredindo sozinho.

---

## Manutenção deste plano

Cada bloco produz um artefato que **entra no repositório** — ADR, spec, nota, ou gate de CI. Plano
de estudo sem artefato vira intenção, e o `docs/FROZEN.md` deste projeto existe justamente porque
intenção acumulada não avisa quando parou.
