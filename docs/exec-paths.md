# Inventário de execução de processos

> **GERADO** por `node scripts/scan-exec-paths.mjs`. Não edite à mão — `--check` roda em teste
> e falha se este arquivo divergir do código.

Fase 0 de [`plano-execucao-tipada.md`](plano-execucao-tipada.md). A coluna que importa é
**montada**: a linha interpola `${}` na string de comando. Chamada com string constante
(`execSync('git status')`) não é risco; o risco nasce quando um valor entra na linha que
alguém vai interpretar.

**36 pontos de execução · 0 com comando montado.**

| arquivo | linha | forma | montada |
|---|---:|---|:---:|
| `apps/agent/src/actions/clipboard.ts` | 9 | `execFileSync` | — |
| `apps/agent/src/actions/get-system-info.ts` | 7 | `execSync` | — |
| `apps/agent/src/actions/supervised-session.ts` | 314 | `execFileSync` | — |
| `apps/agent/src/actions/supervised-session.ts` | 328 | `execFileSync` | — |
| `apps/agent/src/actions/supervised-session.ts` | 352 | `spawn` | — |
| `apps/agent/src/actions/terminal.ts` | 86 | `execSync` | — |
| `apps/agent/src/exec/executar-helper.ts` | 56 | `execFileSync` | — |
| `apps/agent/src/exec/executar-programa.ts` | 119 | `execFileSync` | — |
| `apps/agent/src/exec/executar-programa.ts` | 179 | `spawn` | — |
| `apps/agent/src/exec/sessao-isolada.ts` | 108 | `execFileSync` | — |
| `apps/agent/src/exec/sessao-isolada.ts` | 109 | `execFileSync` | — |
| `apps/agent/src/exec/sessao-isolada.ts` | 182 | `execFile` | — |
| `apps/agent/src/exec/sessao-isolada.ts` | 245 | `execFileSync` | — |
| `apps/agent/src/exec/sessao-isolada.ts` | 252 | `execFileSync` | — |
| `apps/agent/src/exec/workdir.ts` | 56 | `execFileSync` | — |
| `apps/agent/src/hooks/rayzen-hook.mjs` | 106 | `execSync` | — |
| `apps/agent/src/hooks/rayzen-hook.mjs` | 110 | `execSync` | — |
| `apps/agent/src/hooks/rayzen-hook.mjs` | 122 | `execSync` | — |
| `apps/agent/src/hooks/rayzen-hook.mjs` | 380 | `execSync` | — |
| `apps/agent/src/mcp/rayzen-mcp-http.mjs` | 66 | `execFile` | — |
| `apps/agent/src/repo-slug.mjs` | 52 | `execFileSync` | — |
| `apps/agent/src/workspace-watcher.ts` | 86 | `execFileSync` | — |
| `scripts/check-deploy-impact.mjs` | 45 | `execSync` | — |
| `scripts/doctor.mjs` | 116 | `execFileSync` | — |
| `scripts/doctor.mjs` | 137 | `execFileSync` | — |
| `scripts/qa-ingest.mjs` | 81 | `execSync` | — |
| `scripts/qa-ingest.mjs` | 210 | `spawnSync` | — |
| `scripts/rayzen-event.mjs` | 32 | `execSync` | — |
| `scripts/rayzen-init.mjs` | 51 | `execSync` | — |
| `scripts/scan-secrets.mjs` | 55 | `execFileSync` | — |
| `scripts/scan-secrets.mjs` | 68 | `execFileSync` | — |
| `scripts/validar-fase-1a-windows.mjs` | 63 | `execFileSync` | — |
| `scripts/validar-fase-1a-windows.mjs` | 68 | `execFileSync` | — |
| `scripts/validar-fase-1a-windows.mjs` | 126 | `execFileSync` | — |
| `scripts/validar-fase-1a-windows.mjs` | 135 | `execFileSync` | — |
| `scripts/validar-sessao-isolada.mjs` | 28 | `execFileSync` | — |

## Por app

| app | pontos | montados |
|---|---:|---:|
| `apps/agent` | 22 | 0 |
| `scripts` | 14 | 0 |
