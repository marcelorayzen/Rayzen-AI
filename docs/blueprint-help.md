# Rayzen Blueprint — Guia de uso

O Blueprint é a entrada formal de planejamento do Rayzen AI. Transforma qualquer ideia ou plano externo em Wiki, Brain, eventos e backlog do projeto.

---

## Fluxo completo

```
Ideia bruta
    ↓
ChatGPT / Claude → Blueprint Markdown  (usando docs/templates/blueprint-intake.md)
    ↓
Claude Code (VS Code) → rayzen_blueprint_preview  (validar sem salvar)
    ↓
Claude Code (VS Code) → rayzen_blueprint_import_markdown  (importar)
    ↓
Rayzen salva em:
  ├── Wiki        (páginas por seção)
  ├── Brain       (conteúdo indexado com embedding)
  ├── Events      (decisões e problemas detectados)
  └── ProjectState (backlog + nextSteps)
```

---

## 1. Como pedir estruturação

Use o template em `docs/templates/blueprint-intake.md` no ChatGPT ou Claude externo.

**Regra:** sempre inclua frases que o parser reconhece:
- `Decidimos usar X porque Y` → vira evento de decisão
- `Problema: X` / `Blocker: X` → vira evento de problema
- `Implementar X` / `Criar X` / `Adicionar X` → vira nextStep e item de backlog

---

## 2. Como validar com preview

No Claude Code, antes de importar:

```
Use rayzen_blueprint_preview com este Markdown.

title: "Nome do Blueprint"
markdown: """
[MARKDOWN AQUI]
"""
```

O preview retorna sem salvar nada:
- `detectedSections` — seções que virarão páginas Wiki
- `suggestedWikiPages` — slugs que serão criados
- `suggestedEvents` — decisões e problemas detectados
- `suggestedNextSteps` — tarefas que vão pro backlog
- `risks` — avisos sobre estrutura fraca ou muitos problemas

---

## 3. Como importar com MCP

Após validar o preview:

```
Use rayzen_blueprint_import_markdown para importar este Blueprint no projeto atual.

title: "Nome do Blueprint"
markdown: """
[MARKDOWN AQUI]
"""
```

Para sobrescrever uma Wiki já existente:

```
Use rayzen_blueprint_import_markdown com overwriteWiki: true.
```

Para importar sem indexar no Brain (mais rápido):

```
Use rayzen_blueprint_import com indexInBrain: false.
```

---

## 4. Como conferir o que foi criado

Após o import, verifique no painel do Rayzen (`http://<VPS_IP>:3100`):

| O que verificar | Onde |
|---|---|
| Páginas Wiki criadas | Painel Wiki → buscar `blueprint-` |
| Conteúdo indexado | Painel Brain → buscar pelo título |
| Decisões e problemas | Painel Atividade → filtrar por `decision` / `problem` |
| Backlog e nextSteps | Painel Grafo → aba Estado atual |

Ou via MCP no Claude Code:

```
rayzen_get_wiki("blueprint-nome-do-plano")
rayzen_get_state()
rayzen_get_events(intent: "decision")
```

---

## 5. Tools MCP disponíveis

| Tool | O que faz |
|---|---|
| `rayzen_blueprint_preview` | Analisa sem salvar — mostra o que será criado |
| `rayzen_blueprint_import` | Importa com controle fino de cada opção |
| `rayzen_blueprint_import_markdown` | Atalho com todas as opções ativas — uso mais comum |

### Parâmetros do import completo

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `saveToWiki` | `true` | Cria páginas Wiki |
| `indexInBrain` | `true` | Indexa com embedding (requer Jina API) |
| `updateProjectState` | `true` | Atualiza backlog e nextSteps |
| `createEvents` | `true` | Registra decisões e problemas como eventos |
| `generateNextSteps` | `true` | Extrai tarefas para o planning |
| `overwriteWiki` | `false` | Sobrescreve Wiki se já existir |
| `source` | `claude` | Origem: `chatgpt` `claude` `manual` `github` `notion` |
| `mode` | — | Contexto: `architecture` `implementation` `debugging` `review` `study` |

---

## 6. Endpoints REST (uso direto)

```bash
# Preview
POST http://<VPS_IP>:3101/blueprint/preview
Content-Type: application/json
{ "title": "...", "content": "...", "format": "markdown" }

# Import
POST http://<VPS_IP>:3101/blueprint/import
Authorization: Bearer <TOKEN>
{ "projectId": "...", "source": "claude", "title": "...", "content": "...", "format": "markdown" }

# Import via URL do projeto
POST http://<VPS_IP>:3101/projects/:projectId/blueprint/import
Authorization: Bearer <TOKEN>
{ "source": "claude", "title": "...", "content": "...", "format": "markdown" }
```

---

## 7. Comando mental

```
Ideia bruta → Blueprint Markdown → Preview → Import → Rayzen
```
