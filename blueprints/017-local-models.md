# 013 — Local Models

## Visão Geral

Modelos locais via Ollama são o Tier 0 do AI Router: **custo zero**, sem latência de rede, sem dependência de API externa. A estratégia é usar modelos locais para tarefas simples e repetitivas — classificação, resumo curto, extração de entidades — reservando modelos cloud apenas quando necessário.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `docker-compose.yml` → `ollama` service | Ollama já está no stack, porta `11434`, volume `ollama_data` |
| `infra/litellm/config.yaml` | LiteLLM já suporta Ollama como provider — mas **não está configurado nos aliases** |

**Status atual:** Ollama roda no stack mas nenhum módulo o usa. `gpt-4o-mini` vai para Groq, nunca para Ollama.

---

## Gaps

- Adicionar Ollama como tier 0 nos aliases do LiteLLM
- Script de setup: quais modelos baixar automaticamente no primeiro boot
- Health check do Ollama integrado ao AI Router (`/v2/ai/models/health`)
- Benchmark de qualidade por task type: registrar quando Ollama é suficiente vs. insuficiente
- Fallback automático: se Ollama offline → Tier 1 (Groq)
- Gestão de modelos: listar, baixar, remover modelos via API

---

## Modelos recomendados por task type

| Task Type | Modelo local sugerido | Fallback cloud |
|---|---|---|
| `classify` | `llama3.2:3b` | `groq/llama-3.1-8b` |
| `summarize` | `llama3.2:3b` | `groq/llama-3.1-8b` |
| `extract_entities` | `llama3.2:3b` | `groq/llama-3.1-8b` |
| `generate_code` | `qwen2.5-coder:7b` | `groq/llama-3.3-70b` |
| `embed` | Jina API (externo) | — |
| `analyze` | `llama3.1:8b` | `groq/llama-3.3-70b` |
| `strategic` | Não usar local | `claude-sonnet-4-6` |

---

## Interface / Endpoints

```
GET  /v2/models/local              # Lista modelos locais instalados
POST /v2/models/local/pull         # Baixa modelo (ollama pull)
DELETE /v2/models/local/:name      # Remove modelo
GET  /v2/models/local/health       # Ollama online? Latência?
POST /v2/models/local/benchmark    # Testa modelo em task type específico
```

---

## Configuração LiteLLM a adicionar

```yaml
# infra/litellm/config.yaml — adicionar tier 0
model_list:
  - model_name: gpt-local-classify
    litellm_params:
      model: ollama/llama3.2:3b
      api_base: http://ollama:11434
      fallbacks: ["groq/llama-3.1-8b-instant"]

  - model_name: gpt-local-code
    litellm_params:
      model: ollama/qwen2.5-coder:7b
      api_base: http://ollama:11434
      fallbacks: ["groq/llama-3.3-70b-versatile"]
```

---

## Dependências

- **003 — AI Router**: consume modelos locais como Tier 0 e Tier 1
- **009 — Cost Controller**: custo = 0 para locais, mas registra uso para benchmark

---

## Fase de Implementação

**Fase 2** — junto com AI Router.

Ordem:
1. Atualizar `infra/litellm/config.yaml` com aliases de modelos locais
2. Health check endpoint para Ollama
3. Script de boot que faz `ollama pull` dos modelos base
4. Integração no AI Router como Tier 0
5. Benchmark system para medir qualidade por task type (Fase 4)
