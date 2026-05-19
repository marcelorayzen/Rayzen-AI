# Política de Segurança

## Versões suportadas

Apenas a branch `main` recebe correções de segurança.

| Branch / Versão | Suportada |
|---|---|
| `main` | ✅ |
| Branches de feature | ❌ |
| Releases antigas | ❌ |

---

## Reportando uma vulnerabilidade

**NÃO abra uma issue pública** para reportar vulnerabilidades de segurança.

Envie um e-mail para **marcelo.rayzen@live.com** com:

1. Descrição da vulnerabilidade
2. Passos para reproduzir
3. Impacto potencial
4. Sugestão de correção (se tiver)

**SLA de resposta:**
- Triagem inicial: até 72 horas
- Atualização de status: a cada 7 dias até resolução
- Correção e disclosure: coordenado com o reportante

---

## O que está no escopo

- Injeção de prompt no `OrchestratorService` ou `ValidationService`
- Bypass da `whitelist.ts` do PC Agent
- Path traversal em ações do Agent (`list_dir`, `file_search`, `run_command`)
- Vazamento de variáveis de ambiente ou chaves de API via endpoints
- Vulnerabilidades de autenticação JWT
- SQL injection via Prisma raw queries (`$queryRaw`, `$executeRaw`)
- XSS no frontend (Next.js)

---

## O que NÃO está no escopo

- A infraestrutura da VPS Azure (servidor pessoal, fora do escopo deste repositório)
- Credenciais pessoais armazenadas em `.env` (nunca devem ser commitadas)
- Serviços de terceiros (OpenAI, Groq, Jina, Notion)
- Issues de disponibilidade ou performance sem impacto de segurança

---

## Boas práticas do projeto

- Variáveis de ambiente nunca são commitadas (`.env` está no `.gitignore`)
- O arquivo `.env.example` contém apenas placeholders, sem valores reais
- Toda ação do PC Agent passa pela `whitelist.ts` antes de ser executada
- Ações de risco médio/alto usam `dryRun: true` por padrão
- Todas as chamadas LLM passam pelo `ValidationService` antes do processamento
