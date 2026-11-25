## Tipo de mudança
- [ ] feature
- [ ] refactor
- [ ] fix
- [ ] security
- [ ] docs

## Área afetada
- [ ] apps/api
- [ ] apps/web
- [ ] apps/agent
- [ ] packages/types
- [ ] docs

## Contratos
- [ ] Impacto em `packages/types` revisado
- [ ] Impacto no contrato API ↔ agent revisado (se aplicável)
- [ ] Comportamento externo preservado — ou breaking change documentado abaixo

## Segurança (marcar se aplicável)
- [ ] Nenhuma nova action do agent sem entrada em `whitelist.ts`
- [ ] `run_command` ou action de risco revisada
- [ ] Input validation mantida ou reforçada

## Qualidade
- [ ] `pnpm typecheck` — zero erros
- [ ] Testes adicionados ou atualizados
- [ ] `pnpm test` passando

## Notas
<!-- Breaking changes, decisões relevantes, contexto que não está no código -->
