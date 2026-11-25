# Deploy — {{nome}}

## Onde roda

{{ambiente, provedor, domínio}}

## Como publica

1. {{passo}} — exige aprovação humana: {{sim/não}}
2. {{…}}

**Reversão:** {{como voltar à versão anterior}}

## Verificação depois de publicar

{{o que conferir: versão no ar, saúde, smoke — "build verde" não é deploy confirmado}}

## Workflow de qualidade

`.github/workflows/quality.yml` roda a verificação mínima em todo push e PR:

```yaml
name: quality
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: {{instalar, ex.: npm ci}}
      - run: {{verificação, ex.: npm run check}}
```
