# Client Discovery Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Mapear o problema do cliente em intenção estruturada, escopo claro e IntentContract pronto para execução — sem assumir requisito não confirmado.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `client_discovery` | Mapear problema, requisitos, dores, escopo |
| `classify_intent` | Classificar intenção a partir de input bruto |
| `create_architecture` | Propor arquitetura inicial após discovery |

---

## Agentes

- **business-agent** (primário) — conduz discovery, estrutura problema e escopo

---

## Skills utilizadas

- `classify_intent` — classifica intenção bruta do cliente
- `retrieve_project_context` — busca histórico de reuniões e dores registradas
- `generate_execution_plan` — monta plano de desenvolvimento a partir do discovery
- `generate_documentation` — gera proposta, spec ou escopo formal

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| memory-engine | Buscar histórico do cliente, indexar novo contexto | low |
| filesystem | Salvar proposta, spec, escopo | low |
| litellm | Estruturar e sintetizar problema | low |

---

## Os 5 Vazios aplicados ao Discovery

Antes de gerar qualquer proposta ou IntentContract:

| Vazio | Pergunta para o cliente |
|---|---|
| Intenção | "Qual é o único problema que você quer resolver?" |
| Contexto | "O que já foi tentado? O que existe hoje?" |
| Regra | "O que não pode ser feito? Quais restrições?" |
| Canal | "Como o usuário vai interagir com a solução?" |
| Medição | "Como você vai saber que funcionou?" |

Se qualquer vazio estiver vazio → **perguntar antes de propor**.

---

## Critérios de sucesso

- [ ] Problema nomeado com precisão (uma frase)
- [ ] Público definido com necessidades específicas
- [ ] Escopo recortado (o que entra / o que não entra)
- [ ] IntentContract gerado com successCriteria preenchidos
- [ ] SOUL.md do projeto gerado ou atualizado

---

## Limites

```
✗ Não assumir requisito não confirmado pelo cliente
✗ Não propor solução sem entender o problema
✗ Não gerar escopo sem critério de sucesso definido
✗ Não criar proposta com custo ou prazo inventado
```

---

## Métricas

- Taxa de projetos com SOUL.md gerado no discovery
- Taxa de IntentContracts com successCriteria preenchidos
- Revisões de escopo após kick-off (indica discovery incompleto)
