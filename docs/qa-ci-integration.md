# QA CI/CD Integration — Rayzen AI

Envio automático de relatórios de teste para o Rayzen AI a partir de pipelines de CI/CD.
Sem agente local. Sem configuração manual. Um passo extra no pipeline.

## Autenticação

Use o `AGENT_TOKEN` do seu `.env` como secret no CI.
O endpoint valida `Authorization: Bearer <AGENT_TOKEN>`.

**Endpoint:** `POST <RAYZEN_URL>/qa/reports/ingest`

---

## GitHub Actions — Jest / Vitest

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Run tests
        run: npm test -- --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_FILE: test-results/junit.xml
        continue-on-error: true  # não quebra o pipeline se testes falharem

      - name: Send report to Rayzen AI
        if: always()  # roda mesmo se testes falharem
        run: |
          REPORT=$(base64 -w 0 test-results/junit.xml)
          curl -sf -X POST "${{ secrets.RAYZEN_URL }}/qa/reports/ingest" \
            -H "Authorization: Bearer ${{ secrets.RAYZEN_AGENT_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{
              \"projectName\": \"${{ github.event.repository.name }}\",
              \"tool\": \"jest\",
              \"branch\": \"${{ github.ref_name }}\",
              \"commitHash\": \"${{ github.sha }}\",
              \"format\": \"junit\",
              \"reportBase64\": \"$REPORT\"
            }"
```

**Secrets necessários no GitHub:**
- `RAYZEN_URL` — ex: `https://rashida-cabbalistic-lorenzo.ngrok-free.dev`
- `RAYZEN_AGENT_TOKEN` — valor do `AGENT_TOKEN` do seu `.env`

---

## GitHub Actions — Maven / Surefire (Selenium + TestNG)

```yaml
      - name: Run tests
        run: mvn test -Dsurefire.failIfNoSpecifiedTests=false
        continue-on-error: true

      - name: Send Surefire reports to Rayzen AI
        if: always()
        run: |
          # Concatena todos os XMLs do surefire em um único arquivo
          echo '<testsuites>' > combined.xml
          find target/surefire-reports -name 'TEST-*.xml' -exec cat {} \; >> combined.xml
          echo '</testsuites>' >> combined.xml

          REPORT=$(base64 -w 0 combined.xml)
          curl -sf -X POST "${{ secrets.RAYZEN_URL }}/qa/reports/ingest" \
            -H "Authorization: Bearer ${{ secrets.RAYZEN_AGENT_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{
              \"projectName\": \"${{ github.event.repository.name }}\",
              \"tool\": \"selenium\",
              \"branch\": \"${{ github.ref_name }}\",
              \"commitHash\": \"${{ github.sha }}\",
              \"format\": \"junit\",
              \"reportBase64\": \"$REPORT\"
            }"
```

---

## GitHub Actions — Playwright

```yaml
      - name: Run Playwright tests
        run: npx playwright test --reporter=junit
        continue-on-error: true

      - name: Send Playwright report to Rayzen AI
        if: always()
        run: |
          REPORT=$(base64 -w 0 results.xml)
          curl -sf -X POST "${{ secrets.RAYZEN_URL }}/qa/reports/ingest" \
            -H "Authorization: Bearer ${{ secrets.RAYZEN_AGENT_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{
              \"projectName\": \"${{ github.event.repository.name }}\",
              \"tool\": \"playwright\",
              \"branch\": \"${{ github.ref_name }}\",
              \"commitHash\": \"${{ github.sha }}\",
              \"format\": \"junit\",
              \"reportBase64\": \"$REPORT\"
            }"
```

---

## GitLab CI

```yaml
# .gitlab-ci.yml
test:
  stage: test
  script:
    - npm test -- --reporters=jest-junit
  after_script:
    - |
      REPORT=$(base64 -w 0 junit.xml)
      curl -sf -X POST "$RAYZEN_URL/qa/reports/ingest" \
        -H "Authorization: Bearer $RAYZEN_AGENT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
          \"projectName\": \"$CI_PROJECT_NAME\",
          \"tool\": \"jest\",
          \"branch\": \"$CI_COMMIT_REF_NAME\",
          \"commitHash\": \"$CI_COMMIT_SHA\",
          \"format\": \"junit\",
          \"reportBase64\": \"$REPORT\"
        }"
  variables:
    JEST_JUNIT_OUTPUT_FILE: junit.xml
  allow_failure: true
```

**Variables necessárias no GitLab (Settings → CI/CD → Variables):**
- `RAYZEN_URL`
- `RAYZEN_AGENT_TOKEN`

---

## Payload completo da requisição

```json
{
  "projectName": "nome-do-repo",   // auto-resolve para project_id no banco
  "projectId": "uuid-opcional",    // alternativa ao projectName (UUID explícito)
  "tool": "jest",                  // jest | playwright | selenium | testng | cucumber | vitest
  "branch": "main",
  "commitHash": "abc12345",
  "format": "auto",                // auto | junit | allure
  "reportBase64": "<base64>",      // XML ou JSON em base64
  "reportContent": "<xml string>"  // alternativa ao base64 (string direta)
}
```

## Resposta

```json
{
  "id": "uuid-do-test-run",
  "parsed": {
    "tool": "jest",
    "totalTests": 37,
    "passed": 35,
    "failed": 2,
    "skipped": 0,
    "durationMs": 12340,
    "failedCases": [
      {
        "suite": "OrderService",
        "name": "shouldCalculateTotal",
        "message": "Expected 150 but received 0",
        "stacktrace": "..."
      }
    ]
  }
}
```

## Consulta no chat após ingest

Com runs acumulados, você pode perguntar no chat do Rayzen AI:

- *"como estão os testes do projeto X?"*
- *"quais testes falharam mais nos últimos 10 runs?"*
- *"tem algum teste flaky no projeto?"*
- *"mostra a tendência de qualidade dos últimos 30 dias"*
