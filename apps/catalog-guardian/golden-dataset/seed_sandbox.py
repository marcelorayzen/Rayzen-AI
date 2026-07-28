#!/usr/bin/env python3
"""
Popula um sandbox OpenMetadata com os domains/usuários/tabelas/lineage que
golden-dataset.yaml espera (pedidos, estoque, clientes, fin_faturamento_mensal,
rh_folha_pagamento — domínios vendas/marketing/produto/financeiro/rh —
perfis geral/financeiro/rh/steward).

Idempotente — todas as chamadas usam PUT (create-or-update nativo do OMD,
confirmado empiricamente: POST em entidade existente devolve 409, PUT com o
mesmo payload atualiza e devolve 200 com o mesmo id). Rodar de novo não
duplica nada.

Uso:
    OPENMETADATA_TOKEN=<token> python seed_sandbox.py
    python seed_sandbox.py --token <token> --url http://localhost:8585/api

Pré-requisito: sandbox OpenMetadata no ar (ver ../README.md § Sandbox
OpenMetadata) e um token válido — gere um Personal Access Token do admin
logo após o primeiro boot:

    curl -X POST <url>/v1/users/login -H "Content-Type: application/json" \\
      -d '{"email":"admin@open-metadata.org","password":"YWRtaW4="}'
    # copiar accessToken, pegar o id do admin, depois:
    curl -X PUT <url>/v1/users/generateToken/<admin-id> \\
      -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \\
      -d '{"JWTTokenExpiry":"Unlimited"}'

GOTCHA confirmado nesta sessão: gerar um Personal Access Token para o
usuário admin (em vez de um bot dedicado) quebra o login por senha desse
usuário depois (POST /users/login passa a devolver
NullPointerException/"charSequence is null"). O token em si continua
funcionando normalmente — só não dá pra logar de novo por senha depois.
Gere o PAT uma vez, guarde o token (não a senha), e não tente relogar.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DOMAINS = [
    {"name": "vendas", "displayName": "Vendas", "description": "Dominio de vendas"},
    {"name": "marketing", "displayName": "Marketing", "description": "Dominio de Marketing"},
    {"name": "produto", "displayName": "Produto", "description": "Dominio de Produto"},
    {"name": "financeiro", "displayName": "Financeiro", "description": "Dominio de Financeiro"},
    {"name": "rh", "displayName": "Recursos Humanos", "description": "Dominio de Recursos Humanos"},
]

# perfil -> dominios_permitidos, espelhando golden-dataset.yaml § perfis
USERS = [
    {"name": "geral", "email": "geral@demo.local", "domains": ["vendas", "marketing", "produto"]},
    {"name": "financeiro", "email": "financeiro@demo.local", "domains": ["vendas", "financeiro", "produto"]},
    {"name": "rh", "email": "rh@demo.local", "domains": ["rh"]},
    {"name": "steward", "email": "steward@demo.local", "domains": ["vendas", "marketing", "produto", "financeiro", "rh"]},
]

SERVICE_NAME = "catalog_guardian_demo"
DATABASE_NAME = "rayzen_ai"
SCHEMA_NAME = "public"
SCHEMA_FQN = f"{SERVICE_NAME}.{DATABASE_NAME}.{SCHEMA_NAME}"

TABLES = [
    {
        "name": "pedidos",
        "description": "Pedidos de venda consolidados por cliente e regiao",
        "domains": ["vendas"],
        "columns": [
            {"name": "id_pedido", "dataType": "BIGINT", "description": "Identificador do pedido"},
            {"name": "regiao", "dataType": "VARCHAR", "dataLength": 50, "description": "Regiao geografica da venda"},
            {"name": "valor_total", "dataType": "DECIMAL", "description": "Valor total do pedido, sem detalhamento de imposto documentado"},
        ],
    },
    {
        "name": "clientes",
        "description": "Cadastro de clientes ativos, tabela consolidada e curada",
        "domains": ["vendas"],
        "tags": [{"tagFQN": "Certification.Gold"}],
        "columns": [
            {"name": "id_cliente", "dataType": "BIGINT", "description": "Identificador do cliente"},
            {"name": "nome", "dataType": "VARCHAR", "dataLength": 200, "description": "Nome do cliente"},
            {"name": "cpf", "dataType": "VARCHAR", "dataLength": 11, "description": "CPF do cliente", "tags": [{"tagFQN": "PII.Sensitive"}]},
            {"name": "cliente_ativo", "dataType": "BOOLEAN", "description": "Indica se o cliente esta ativo no periodo corrente"},
        ],
    },
    {
        "name": "estoque",
        "description": "Movimentacao de estoque por produto",
        "domains": ["produto"],
        "columns": [
            {"name": "id_produto", "dataType": "BIGINT", "description": "Identificador do produto"},
            {"name": "quantidade", "dataType": "INT", "description": "Quantidade em estoque"},
            {"name": "atualizado_em", "dataType": "TIMESTAMP", "description": "Ultima atualizacao do saldo"},
        ],
    },
    {
        "name": "fin_faturamento_mensal",
        "description": "Faturamento consolidado por mes e regiao, base para relatorio de venda bruta",
        "domains": ["financeiro"],
        "columns": [
            {"name": "mes_referencia", "dataType": "DATE", "description": "Mes de referencia do faturamento"},
            {"name": "valor_bruto", "dataType": "DECIMAL", "description": "Venda bruta do periodo, definicao no glossario Venda Bruta"},
            {"name": "inadimplencia_pct", "dataType": "DECIMAL", "description": "Percentual de inadimplencia do periodo"},
        ],
    },
    {
        "name": "rh_folha_pagamento",
        "description": "Folha de pagamento mensal dos funcionarios",
        "domains": ["rh"],
        "columns": [
            {"name": "id_funcionario", "dataType": "BIGINT", "description": "Identificador do funcionario"},
            {"name": "salario", "dataType": "DECIMAL", "description": "Salario bruto mensal", "tags": [{"tagFQN": "PII.Sensitive"}]},
            {"name": "cpf", "dataType": "VARCHAR", "dataLength": 11, "description": "CPF do funcionario", "tags": [{"tagFQN": "PII.Sensitive"}]},
        ],
    },
]

# (source, target) — testa lineage multi-hop (LIN-002/LIN-003 do golden dataset)
LINEAGE_EDGES = [
    ("estoque", "pedidos"),
]


def _request(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            # PUT /v1/lineage devolve 200 com corpo vazio — sem isso,
            # json.loads("") explode com "Expecting value".
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} -> HTTP {exc.code}: {detail}") from exc


def put(base_url: str, token: str, path: str, payload: dict) -> dict:
    return _request("PUT", f"{base_url}{path}", token, payload)


def seed(base_url: str, token: str) -> None:
    print(f"Semeando sandbox em {base_url}...")

    for d in DOMAINS:
        put(base_url, token, "/v1/domains", {**d, "domainType": "Aggregate"})
    print(f"  domains: {len(DOMAINS)} ok")

    for u in USERS:
        put(base_url, token, "/v1/users", u)
    print(f"  users: {len(USERS)} ok")

    put(base_url, token, "/v1/services/databaseServices", {
        "name": SERVICE_NAME,
        "serviceType": "CustomDatabase",
        "connection": {"config": {
            "type": "CustomDatabase",
            "sourcePythonClass": "metadata.ingestion.source.database.customdatabase.metadata.CustomDatabaseSource",
        }},
    })
    put(base_url, token, "/v1/databases", {
        "name": DATABASE_NAME,
        "service": SERVICE_NAME,
        "description": "Base demo do Catalog Guardian",
    })
    put(base_url, token, "/v1/databaseSchemas", {
        "name": SCHEMA_NAME,
        "database": f"{SERVICE_NAME}.{DATABASE_NAME}",
        "description": "Schema demo",
    })
    print("  service/database/schema: ok")

    table_ids: dict[str, str] = {}
    for t in TABLES:
        payload = {
            "name": t["name"],
            "databaseSchema": SCHEMA_FQN,
            "description": t["description"],
            "domains": t["domains"],
            "columns": t["columns"],
        }
        if "tags" in t:
            payload["tags"] = t["tags"]
        result = put(base_url, token, "/v1/tables", payload)
        table_ids[t["name"]] = result["id"]
    print(f"  tables: {len(TABLES)} ok")

    for source_name, target_name in LINEAGE_EDGES:
        put(base_url, token, "/v1/lineage", {
            "edge": {
                "fromEntity": {"id": table_ids[source_name], "type": "table"},
                "toEntity": {"id": table_ids[target_name], "type": "table"},
            }
        })
    print(f"  lineage edges: {len(LINEAGE_EDGES)} ok")

    print("Seed concluido.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("OPENMETADATA_URL", "http://localhost:8585/api"))
    ap.add_argument("--token", default=os.environ.get("OPENMETADATA_TOKEN", ""))
    args = ap.parse_args()

    if not args.token:
        print("Erro: informe --token ou defina OPENMETADATA_TOKEN. Ver docstring deste arquivo.", file=sys.stderr)
        return 1

    try:
        seed(args.url, args.token)
    except RuntimeError as exc:
        print(f"Seed falhou: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
