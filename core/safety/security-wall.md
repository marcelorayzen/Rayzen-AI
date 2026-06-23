# Security Wall — Rayzen AI
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Baseado em: JARVIS Security Layer + LGPD

---

## Princípio

Segurança é arquitetura, não checklist.  
Todo agente, toda ferramenta, toda ação tem risco classificado antes de executar.  
Alto risco sem aprovação humana explícita = bloqueado, sempre.

---

## Taxonomia de risco por ação

### Low risk — executa automaticamente

| Ação | Ferramenta | Observação |
|------|-----------|------------|
| Ler arquivos locais | filesystem | Sem restrição |
| Resumir contexto / memória | memory-engine | Sem restrição |
| Classificar intenção | litellm | Sem restrição |
| Gerar plano de execução | litellm | Sem restrição |
| Criar documentação (.md) | filesystem | Sem restrição |
| Buscar memória semântica | pgvector | Sem restrição |
| Listar diretório | filesystem | Sem `../` |
| Consultar API externa (leitura) | http | GET apenas |
| Indexar conteúdo na Brain | memory-engine | Sem dados sensíveis |

### Medium risk — executa com log obrigatório

| Ação | Ferramenta | Log |
|------|-----------|-----|
| Alterar arquivo local | filesystem | path + diff |
| Criar teste automatizado | filesystem | path |
| Rodar testes (local apenas) | terminal | comando + resultado |
| Criar branch | github | branch name |
| Abrir Pull Request | github | PR url |
| Chamar API externa (escrita) | http | endpoint + payload |
| Instalar dependência | npm/pnpm | pacote + versão |
| Criar migration de banco (draft) | prisma | arquivo gerado |

### High risk — aprovação humana obrigatória + log + rollback plan

| Ação | Ferramenta | Justificativa |
|------|-----------|---------------|
| Deploy (qualquer ambiente) | terminal/docker | Irreversível em produção |
| Apagar arquivo | filesystem | Perda permanente sem backup |
| Executar migration em produção | prisma | Risco de perda de dados |
| Alterar variáveis de ambiente de produção | .env / docker | Quebra imediata do sistema |
| Force push em qualquer branch | github | Reescreve histórico |
| Enviar mensagem real (WhatsApp, e-mail) | n8n / api | Ação visível ao usuário final |
| Cobrar pagamento | api | Impacto financeiro |
| Alterar banco de produção diretamente | SQL | Sem rollback automático |
| Rodar script destrutivo (rm -rf, DROP) | terminal | Irreversível |
| Revogar token / credencial | auth | Quebra acesso imediato |

---

## Controle de acesso por ambiente

| Ação | local | staging | production |
|------|-------|---------|------------|
| Ler arquivos | ✓ | ✓ | ✓ (read-only) |
| Escrever arquivos | ✓ | ✓ | ✗ (aprovação) |
| Executar testes | ✓ | ✓ | ✗ |
| Deploy automático | ✗ | ✓ (CI) | ✗ (manual) |
| Migration de banco | ✓ | ✓ (staging DB) | ✗ (aprovação + backup) |
| Acesso a dados reais de cliente | ✗ | ✗ | ✓ (log obrigatório) |

---

## Proteção de dados (LGPD)

**Dados sensíveis — nunca guardar em memória sem política:**
- Senhas, tokens, secrets, API keys
- CPF, e-mail, telefone de clientes finais
- Dados financeiros (valores de pedidos, cartões)
- Credenciais de acesso (SSH, banco de produção)

**Política de retenção por escopo:**

| Escopo | TTL | Conteúdo permitido |
|--------|-----|-------------------|
| session | até fechar sessão | Estado intermediário, rascunhos |
| short_term | 7 dias | Decisões técnicas recentes, bugs |
| long_term | permanente | ADRs, arquitetura, padrões aprovados |

**Campo `shouldNotStore: true`** — marcar explicitamente o que não deve ser indexado na Brain.

---

## Protocolo de aprovação humana

Quando uma ação High Risk é detectada:

1. **Parar** — não executar
2. **Declarar** — mostrar ao Marcelo: ação solicitada, risco, impacto esperado
3. **Aguardar** — confirmação explícita ("sim, pode" ou aprovação via ApprovalGate no Rayzen)
4. **Executar** — com log registrado
5. **Rollback plan** — documentar como desfazer antes de executar

---

## Ações permanentemente proibidas (sem exceção)

```
✗ force push em main ou qualquer branch protegida
✗ DROP DATABASE em qualquer ambiente
✗ rm -rf sem escopo explícito e backup confirmado
✗ Guardar senha/token em memória/brain/wiki
✗ Expor dados de cliente em logs ou contexto
✗ Deploy automático em produção sem CI/CD aprovado
✗ Contornar SecurityWall por eficiência ou urgência
```

---

## Referências

- RIOM v1.0 — seção 10 (Security Wall)
- JARVIS Method — módulo 2.6 (Muros de Segurança como Arquitetura)
- LGPD — Lei 13.709/2018
- `docs/security/data-inventory.md` (gerado por `pnpm scan:secrets`)
- `apps/agent/src/security/whitelist.ts` (44 ações permitidas ao agent desktop)
