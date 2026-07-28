#!/usr/bin/env python3
"""
Popula um sandbox OpenMetadata com os domains/usuários/tabelas/glossário/
lineage que golden-dataset.yaml espera — domínios vendas/marketing/produto/
financeiro/rh, perfis geral/financeiro/rh/steward.

Idempotente — todas as chamadas usam PUT (create-or-update nativo do OMD,
confirmado empiricamente: POST em entidade existente devolve 409, PUT com o
mesmo payload atualiza e devolve 200/201 com o mesmo id). Rodar de novo não
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

Cobertura de conceitos do golden dataset (roadmap item 2): além do seed
mínimo do item 1 (5 tabelas, 5 domains, 4 usuários), este script adiciona
5 tabelas novas, 1 glossário com 7 termos, owners de tabela/domínio, uma
tag Tier e lineage multi-hop — mapeado caso a caso nos comentários abaixo
pra rastrear exatamente qual caso do golden dataset cada peça de dado
sustenta. Casos de PROCESSO (PRO-001..004) ficam de fora de propósito —
são perguntas sobre política institucional, não metadado de catálogo;
exigiriam um documento de governança real, não uma tabela ou glossário.
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
    # owner/expert = OWN-002 ("com quem eu falo pra pedir acesso ao dominio financeiro")
    {"name": "financeiro", "displayName": "Financeiro", "description": "Dominio de Financeiro", "owner_user": "financeiro"},
    # owner/expert = OWN-003 ("quem e o data steward de RH")
    {"name": "rh", "displayName": "Recursos Humanos", "description": "Dominio de Recursos Humanos", "owner_user": "rh"},
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

GLOSSARY_NAME = "termos_de_negocio"

GLOSSARY_TERMS = [
    # SEM-003: "o que e considerado venda bruta aqui?"
    {"name": "venda_bruta", "displayName": "Venda Bruta",
     "description": "Valor total das vendas antes de deducoes, devolucoes ou impostos."},
    # SEM-005: "o que quer dizer PMR nas tabelas de credito?" — sigla interna, o
    # agente precisa resolver por aqui, nao por conhecimento generico de mercado.
    {"name": "pmr", "displayName": "PMR",
     "description": "Prazo Medio de Recebimento — numero medio de dias entre a venda e o recebimento efetivo do valor pelo cliente."},
    # SEM-002: "qual a diferenca entre cliente_ativo e cliente_vigente?" — dois
    # termos proximos, propositalmente distintos.
    {"name": "cliente_ativo", "displayName": "Cliente Ativo",
     "description": "Cliente com pelo menos uma compra nos ultimos 90 dias."},
    {"name": "cliente_vigente", "displayName": "Cliente Vigente",
     "description": "Cliente com contrato ou acordo comercial ainda dentro do prazo de vigencia, independente de ter comprado recentemente."},
    # SEM-006: "cliente e consumidor sao a mesma coisa nas nossas bases?" — uso
    # inconsistente de proposito, pra testar se o agente inventa equivalencia.
    {"name": "cliente", "displayName": "Cliente",
     "description": "Pessoa ou empresa com relacionamento comercial formalizado (contrato ou cadastro) com a organizacao."},
    {"name": "consumidor", "displayName": "Consumidor",
     "description": "Termo usado de forma inconsistente nas bases — em alguns relatorios de marketing e sinonimo de cliente, em outros inclui visitantes sem relacionamento formal. Nao ha padronizacao registrada."},
    # DESC-008: "tem dado de churn em algum lugar?" — mapeia o termo em ingles
    # pro equivalente em portugues que o catalogo usa.
    {"name": "churn", "displayName": "Churn (Evasao)",
     "description": "Termo em ingles para evasao ou cancelamento de clientes. Ver tabela clientes_cancelamentos."},
]

TABLES = [
    {
        "name": "pedidos",
        "description": "Pedidos de venda consolidados por cliente e regiao",
        "domains": ["vendas"],
        "owner_user": "steward",  # OWN-001: "quem e o owner da tabela de pedidos?"
        "columns": [
            {"name": "id_pedido", "dataType": "BIGINT", "description": "Identificador do pedido"},
            {"name": "regiao", "dataType": "VARCHAR", "dataLength": 50, "description": "Regiao geografica da venda"},
            {"name": "valor_total", "dataType": "DECIMAL", "description": "Valor total do pedido, sem detalhamento de imposto documentado"},
            # SEM-001: "o que significa a coluna status_flag na tabela de pedidos?"
            {"name": "status_flag", "dataType": "INT", "description": "Codigo de status do pedido: 1=pendente, 2=processando, 3=entregue, 4=cancelado"},
        ],
    },
    {
        "name": "clientes",
        "description": "Cadastro de clientes ativos, tabela consolidada e curada",
        "domains": ["vendas"],
        # QUA-003: "qual o nivel de qualidade esperado dessa base?"
        "tags": [{"tagFQN": "Certification.Gold"}, {"tagFQN": "Tier.Tier1"}],
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
            # LIN-001: "de onde vem o campo receita_liquida?" — origem via lineage
            # em contas_a_receber, nao so descricao.
            {"name": "receita_liquida", "dataType": "DECIMAL", "description": "Receita liquida do periodo, apos deducoes — originada de contas_a_receber"},
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
    # ---- novas tabelas (roadmap item 2) ----
    {
        # LIN-002/003/004: "se eu mudar a tabela de produtos, o que quebra?" —
        # precisa existir uma tabela "produtos" de verdade, upstream de estoque.
        "name": "produtos",
        "description": "Cadastro mestre de produtos — fonte de origem para estoque e pedidos",
        "domains": ["produto"],
        "columns": [
            {"name": "id_produto", "dataType": "BIGINT", "description": "Identificador do produto"},
            {"name": "nome_produto", "dataType": "VARCHAR", "dataLength": 200, "description": "Nome comercial do produto"},
            {"name": "categoria", "dataType": "VARCHAR", "dataLength": 100, "description": "Categoria do produto"},
        ],
    },
    {
        # DESC-006: "onde fica o cadastro de fornecedor"
        "name": "cadastro_fornecedores",
        "description": "Cadastro de fornecedores homologados",
        "domains": ["produto"],
        "columns": [
            {"name": "id_fornecedor", "dataType": "BIGINT", "description": "Identificador do fornecedor"},
            {"name": "nome_fornecedor", "dataType": "VARCHAR", "dataLength": 200, "description": "Razao social do fornecedor"},
            {"name": "contato", "dataType": "VARCHAR", "dataLength": 200, "description": "Contato comercial principal"},
        ],
    },
    {
        # DESC-003: "quais bases tem informacao de contrato?" — nome da tabela
        # nao contem "contrato" de proposito, testa busca por descricao.
        "name": "acordos_comerciais",
        "description": "Registro de contratos e acordos comerciais firmados com clientes, incluindo vigencia e condicoes",
        "domains": ["vendas"],
        "columns": [
            {"name": "id_acordo", "dataType": "BIGINT", "description": "Identificador do acordo"},
            {"name": "id_cliente", "dataType": "BIGINT", "description": "Cliente vinculado ao acordo"},
            {"name": "vigencia_fim", "dataType": "DATE", "description": "Data de encerramento da vigencia do contrato"},
        ],
    },
    {
        # DESC-008: "tem dado de churn em algum lugar?"
        "name": "clientes_cancelamentos",
        "description": "Registro de clientes que cancelaram ou evadiram do servico (churn)",
        "domains": ["vendas"],
        "columns": [
            {"name": "id_cliente", "dataType": "BIGINT", "description": "Cliente que cancelou"},
            {"name": "data_cancelamento", "dataType": "DATE", "description": "Data do cancelamento"},
            {"name": "motivo", "dataType": "VARCHAR", "dataLength": 200, "description": "Motivo informado do cancelamento"},
        ],
    },
    {
        # SEM-005: "PMR nas tabelas de credito" — precisa existir uma tabela de
        # credito/recebiveis de verdade com uma coluna de PMR.
        "name": "contas_a_receber",
        "description": "Contas a receber de clientes, com prazo medio de recebimento (PMR)",
        "domains": ["financeiro"],
        "columns": [
            {"name": "id_conta", "dataType": "BIGINT", "description": "Identificador da conta a receber"},
            {"name": "valor", "dataType": "DECIMAL", "description": "Valor em aberto"},
            {"name": "pmr_dias", "dataType": "INT", "description": "Prazo medio de recebimento em dias — ver glossario PMR"},
        ],
    },
]

# (source, target) — testa lineage multi-hop (LIN-001/002/003/004)
LINEAGE_EDGES = [
    ("produtos", "estoque"),
    ("estoque", "pedidos"),
    ("contas_a_receber", "fin_faturamento_mensal"),
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


def get(base_url: str, token: str, path: str) -> dict:
    return _request("GET", f"{base_url}{path}", token)


def owner_ref(user_id: str) -> list[dict]:
    return [{"id": user_id, "type": "user"}]


def seed(base_url: str, token: str) -> None:
    print(f"Semeando sandbox em {base_url}...")

    for d in DOMAINS:
        payload = {"name": d["name"], "displayName": d["displayName"], "description": d["description"], "domainType": "Aggregate"}
        put(base_url, token, "/v1/domains", payload)
    print(f"  domains: {len(DOMAINS)} ok")

    for u in USERS:
        put(base_url, token, "/v1/users", u)
    print(f"  users: {len(USERS)} ok")

    # resolve ids de usuario uma vez — precisos pra owners de tabela/domain
    user_ids = {u["name"]: get(base_url, token, f"/v1/users/name/{u['name']}")["id"] for u in USERS}

    for d in DOMAINS:
        if "owner_user" in d:
            put(base_url, token, "/v1/domains", {
                "name": d["name"], "displayName": d["displayName"], "description": d["description"],
                "domainType": "Aggregate", "owners": owner_ref(user_ids[d["owner_user"]]),
            })
    print("  domain owners: ok")

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

    put(base_url, token, "/v1/glossaries", {
        "name": GLOSSARY_NAME,
        "displayName": "Termos de Negocio",
        "description": "Glossario de negocio do Catalog Guardian",
    })
    for term in GLOSSARY_TERMS:
        put(base_url, token, "/v1/glossaryTerms", {**term, "glossary": GLOSSARY_NAME})
    print(f"  glossario: 1 + {len(GLOSSARY_TERMS)} termos ok")

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
        if "owner_user" in t:
            payload["owners"] = owner_ref(user_ids[t["owner_user"]])
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
