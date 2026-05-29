# 021 — Vault Engine

## Visão Geral

O Vault Engine é a camada de segredos do Rayzen. Segredos nunca são armazenados em texto puro — não em arquivos markdown, não em contexto de LLM, não em logs, não em memória de projeto. Eles existem exclusivamente dentro do Vault, criptografados com AES-256, e são acessados por referência via URI.

```
Correto:    database: vault://vb-ferragens/supabase
Incorreto:  database: password: MinhaSenha123
```

Esta separação resolve um problema estrutural: qualquer sistema que passa segredos pelo contexto do LLM os expõe a logs, artefatos de sessão, checkpoints e potencialmente ao próprio modelo. O Vault Engine torna isso impossível por design.

---

## Motivação — Problema Real

Durante o desenvolvimento do Rayzen AI, um commit expôs um endereço IP diretamente no código. Isso demonstra que proteções baseadas em processo ("não commitar segredos") são insuficientes. A arquitetura precisa tornar o vazamento estruturalmente impossível.

O Vault Engine resolve isso ao nível de arquitetura:
- O modelo nunca recebe o valor do segredo, apenas confirma "credencial disponível"
- Skills recebem valores resolvidos em runtime, fora do contexto LLM
- Obsidian/wiki/documentação só contêm referências `vault://`, nunca valores

---

## Dois tipos de vault

```
Rayzen
├── Knowledge Vault (Obsidian)   ← conhecimento em markdown
│   └── arquitetura, roadmap, ADRs, decisões
│
└── Secure Vault (Vault Engine)  ← segredos criptografados
    └── keys, tokens, passwords, conexões
```

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `.env` files | Armazenam segredos — sem criptografia, vão para shell, podem ser logados |
| `hook.config.mjs` | Contém `apiToken` em texto puro — exposto se o arquivo vazar |
| `infra/litellm/config.yaml` | Referencia env vars — melhor que hardcode, mas ainda texto puro em memória |

**Status V1:** Sem vault. Segredos em `.env`, config files e ocasionalmente em código (causa do incidente de IP).

---

## Gaps

- Armazenamento criptografado (AES-256 + master key do ambiente)
- URI scheme `vault://project/secret` para referência sem exposição
- Resolução de referências no Skill Engine antes da execução (nunca antes)
- CLI para gerenciar segredos (`rayzen vault set`, `get`, `list`, `rotate`)
- Audit trail: quem acessou qual segredo e quando
- Regra de validação: bloquear qualquer skill input que contenha padrões de segredo (regex para API keys, tokens, passwords)
- Integração com Obsidian: documentos podem referenciar `vault://` mas nunca o valor

---

## Interface / Endpoints

```
POST   /v2/vault/:project/secrets      # Adiciona ou atualiza segredo
GET    /v2/vault/:project/secrets      # Lista nomes dos segredos (nunca valores)
DELETE /v2/vault/:project/secrets/:key # Remove segredo
POST   /v2/vault/resolve               # Resolve referências vault:// (uso interno)
GET    /v2/vault/:project/audit        # Log de acessos
POST   /v2/vault/scan                  # Escaneia projeto em busca de segredos expostos
```

**Regra:** `GET /v2/vault/:project/secrets` retorna apenas **nomes** — nunca valores. Valores só são acessados internamente pelo `VaultResolverService`, nunca expostos via HTTP.

---

## Modelo de Dados

```typescript
// Armazenamento em disco: vault/{project}.enc (AES-256)
// Master key: variável de ambiente VAULT_MASTER_KEY

interface VaultEntry {
  key:       string       // ex: 'supabase', 'vercel', 'telegram'
  value:     string       // criptografado em repouso
  createdAt: Date
  updatedAt: Date
  rotation?: Date         // próxima rotação sugerida
}

interface VaultFile {
  projectSlug: string
  entries:     VaultEntry[]
  version:     number
}

// Audit log (Prisma)
model VaultAccessLog {
  id          String   @id @default(uuid())
  projectSlug String
  key         String
  accessor    String   // 'skill-engine' | 'mission-engine' | 'cli'
  missionId   String?
  stepId      String?
  accessedAt  DateTime @default(now())
}

// URI de referência — nunca o valor
type VaultRef = `vault://${string}/${string}`
// Exemplo: "vault://vb-ferragens/supabase"
```

---

## Regra fundamental

```
Nenhum segredo pode ser armazenado em:
  ✗ contexto de LLM
  ✗ memória de projeto (Memory Engine)
  ✗ arquivos markdown / Obsidian
  ✗ logs de execução
  ✗ artefatos de checkpoint
  ✗ código fonte ou configs versionadas

Segredos existem APENAS dentro do Vault Engine
e são acessados POR REFERÊNCIA.
```

---

## Fluxo de uso

### 1. Usuário define segredo
```bash
# CLI
rayzen vault set vb-ferragens/supabase "postgresql://..."
rayzen vault set vb-ferragens/vercel "tok_..."
```

### 2. Obsidian/wiki referencia sem expor
```yaml
---
project: VB Ferragens
database: vault://vb-ferragens/supabase
deploy:   vault://vb-ferragens/vercel
---
```

### 3. Usuário pede missão
```
Usuário: Faça deploy do VB Ferragens.

Rayzen (Mission Engine): Missão criada. Step: deploy.
Rayzen (Skill Engine):   Resolvendo credenciais...
  vault://vb-ferragens/vercel → [RESOLVIDO — não logado]
Rayzen (ao usuário):     Deploy autorizado. Executando.
```

### 4. O modelo só vê
```
Credencial 'vercel' disponível para projeto vb-ferragens.
```

Nunca: `tok_abc123...`

---

## Scanner de segredos expostos

O `VaultScanService` verifica proativamente:

```typescript
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{32,}/,          // OpenAI keys
  /gsk_[a-zA-Z0-9]{32,}/,         // Groq keys
  /eyJ[a-zA-Z0-9_-]{20,}/,        // JWT tokens
  /postgresql:\/\/[^@]+@[^\s]+/,  // connection strings
  /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/, // IPs públicos
  /-----BEGIN [A-Z ]+ KEY-----/,  // chaves privadas
]

// Roda antes de qualquer commit (hook) e antes de indexar no Memory Engine
```

---

## Criptografia

```typescript
// AES-256-GCM — autenticado, evita adulteração
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const MASTER_KEY = Buffer.from(process.env.VAULT_MASTER_KEY!, 'hex') // 32 bytes

function encrypt(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, MASTER_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(stored: string): string {
  const buf = Buffer.from(stored, 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv(ALGORITHM, MASTER_KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
```

---

## Estrutura de arquivos

```
vault/                        # gitignored, nunca versionado
  ├── vb-ferragens.enc
  ├── rayzen-ai.enc
  └── banco-imob.enc

.gitignore:
  vault/*.enc
  .env
  .env.*
  !.env.example
```

---

## Dependências

- **001 — Mission Engine**: missões que precisam de credenciais declaram `vault://` nos steps
- **006 — Skill Engine**: resolve referências `vault://` no input antes de executar skill (fora do contexto LLM)
- **004 — Memory Engine**: scanner bloqueia indexação de chunks contendo segredos detectados
- **013 — Observability**: audit trail de acessos ao vault
- **014 — Human Approval Gates**: acesso a segredos de alto risco requer aprovação

---

## Fase de Implementação

**Fase 2** — deve existir antes das skills começarem a usar credenciais reais.

Ordem:
1. `VaultService` — encrypt/decrypt com AES-256-GCM
2. Armazenamento em `vault/*.enc` (gitignored)
3. `VaultResolverService` — resolve `vault://` refs no input de skills
4. CLI básico: `set`, `get` (retorna apenas se existe), `list`, `delete`
5. `VaultScanService` — scanner de padrões de segredo
6. Audit log (`VaultAccessLog` model)
7. Hook pré-commit: escaneia staged files (Fase 3)
8. Integração com Memory Engine: bloqueia indexação de segredos detectados
