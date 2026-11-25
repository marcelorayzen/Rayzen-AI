# {{nome do projeto}} — guia para o Claude Code

> O contrato de trabalho é o [`AGENTS.md`](AGENTS.md) — leia primeiro; ele vale aqui também.
> Notas pessoais e operacionais: `CLAUDE.local.md` (fora do git).

## Contexto em uma frase

{{o que o projeto é e para quem}}

## Onde está cada coisa

| quer saber | onde |
|---|---|
| estado atual e o que vem | `docs/ESTADO-DO-PROJETO.md` · `docs/BACKLOG.md` |
| produto, problema e escopo | `PRODUCT.md` |
| arquitetura e decisões | `docs/ARQUITETURA.md` · `docs/decisions/` |
| como se valida | `docs/QUALIDADE.md` |

## Comandos

```bash
{{instalar}}
{{rodar}}
{{verificação mínima}}
```

## Rayzen

O projeto está registrado no Rayzen ({{projectId}}); hooks e MCP vêm de `.mcp.json` e
`.claude/settings.json`. Decisão tomada pela pessoa → `rayzen_add_event(type: 'decision')`.
