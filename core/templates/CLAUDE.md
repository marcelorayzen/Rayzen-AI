# CLAUDE.md — [Nome do Projeto]
> Template JARVIS/RIOM | Versão: 1.0 | Atualizado: 2026-06-15
> Leia este arquivo inteiro antes de qualquer ação.
> Substitua tudo entre [colchetes] pelo contexto real do projeto.

---

## Sistema operacional

Este projeto roda dentro do **Rayzen AI** — sistema operacional pessoal de intenção e execução.  
Claude Code é o motor de inteligência interno. Rayzen governa contexto, memória e aprovações.

---

## Constituição do projeto

Ver: `projects/[id]/SOUL.md`

Resumo obrigatório:
- **Quem sou:** [uma linha]
- **Para que existo:** [uma linha]
- **O que nunca faço:** [lista curta — 3 a 5 itens]

---

## Stack técnico

```
[Framework principal + versão]
[Banco de dados + ORM]
[Autenticação]
[Deploy]
[Outras dependências críticas]
```

---

## ADRs vigentes

| ADR | Decisão | Status |
|-----|---------|--------|
| ADR-001 | [decisão] | Ativo |

---

## Regras de execução (Security Wall)

### Antes de qualquer ação:

1. Verificar se a intenção está clara (5 Vazios preenchidos)
2. Classificar o risco da ação: **low / medium / high**
3. Se **high risk** → parar e declarar ao Marcelo antes de executar
4. Se **medium risk** → executar com log obrigatório
5. Se **low risk** → executar

### Ações PROIBIDAS sem aprovação explícita:

```
✗ Deploy em produção
✗ Apagar arquivos sem backup confirmado
✗ Executar migration em banco de produção
✗ Force push em qualquer branch
✗ Enviar mensagem real (WhatsApp, e-mail)
✗ Alterar variáveis de ambiente de produção
✗ Cobrar pagamento
```

### Ferramentas permitidas neste projeto:

| Ferramenta | Risco padrão | Restrições |
|-----------|-------------|------------|
| filesystem | medium | Sem `../`, sem delete sem backup |
| github | medium | Sem force push em main |
| terminal | high | Apenas local, aprovação para produção |
| litellm | low | Usar sempre via proxy |
| memory-engine | low | Sem dados sensíveis |

---

## Os 5 Vazios — gate pré-execução

Antes de começar, confirmar:

| Vazio | Pergunta | Ok? |
|-------|---------|-----|
| Intenção | O que resolver, em uma frase? | [ ] |
| Contexto | Quais arquivos/módulos/estado são relevantes? | [ ] |
| Regra | Quais limites e permissões se aplicam? | [ ] |
| Canal | De onde vem o input? Para onde vai o output? | [ ] |
| Medição | Como sabemos que deu certo? | [ ] |

Se qualquer campo estiver vazio → perguntar ao Marcelo antes de executar.

---

## Memória por escopo

| Escopo | TTL | Usar para |
|--------|-----|-----------|
| session | até fechar | Contexto desta execução, rascunhos |
| short_term | 7 dias | Decisões técnicas recentes, bugs ativos |
| long_term | permanente | ADRs aprovados, padrões, arquitetura |

---

## Formato de resposta esperado

- Artefato primeiro, explicação depois (se necessária)
- Se criar arquivo: mostrar caminho completo
- Se alterar banco: mostrar migration completa
- Se houver risco: declarar antes de executar
- Ao fechar sessão: executar `summarize_session`

---

## Estado atual do projeto

[Copiar do SOUL.md ou do último session summary gerado pelo Rayzen]

---

## Critério de sucesso desta sessão

> Preencher antes de cada sessão — o que "deu certo" significa aqui?

[ ] [Critério 1]  
[ ] [Critério 2]  
[ ] [Critério 3]

---

## Referências

- SOUL.md do projeto: `projects/[id]/SOUL.md`
- Security Wall: `core/safety/security-wall.md`
- RIOM completo: importado na Brain do Rayzen (slug: `blueprint-rayzen-intent-operating-model-riom`)
- Catálogo de serviços e agentes: `core/services/` e `core/agents/`
