#!/usr/bin/env python3
"""
Popula um Unity Catalog OSS local (docker compose do próprio repo
unitycatalog/unitycatalog, servidor em :8080) com um punhado de
catalogs/schemas/tables de prova — NÃO é o golden dataset completo.

Escopo desta Fase 6 é smoke test (decisão confirmada com o dono do
projeto): provar que o CatalogAdapter funciona contra um catálogo fonte
bem diferente do OMD (namespace de 3 níveis, grant direto
principal->privilege), não replicar os 50 casos do golden-dataset.yaml.

Pré-requisito: criar os diretórios de storage dentro do container antes de
rodar (EXTERNAL table exige um storage_location que já exista):
    docker exec unitycatalog-server-1 mkdir -p \\
      /tmp/uc-demo/vendas/public/pedidos \\
      /tmp/uc-demo/vendas/public/clientes \\
      /tmp/uc-demo/financeiro/public/faturamento

Uso:
    python seed_unitycatalog.py
    python seed_unitycatalog.py --container unitycatalog-server-1

Achado real durante esta sessão: criar tables via REST puro (POST /tables)
exige um campo `type_json` por coluna cujo formato exato não é documentado
com exemplo em lugar nenhum, e duas tentativas com valores plausíveis
("bigint", depois "long" com json.dumps duplo) falharam contra o servidor
real. O CLI `uc` embutido no container (bin/uc) monta esse payload
internamente — usar o CLI via `docker exec` em vez de REST puro pra
criação evita reimplementar essa serialização por tentativa e erro.
O CatalogAdapter em si (src/adapters/unitycatalog.adapter.ts) só faz GET
contra a API REST, nunca precisa criar nada — só a leitura importa pro
contrato CatalogAdapter, e essa parte já foi validada empiricamente.

Gotcha confirmado: `uc catalog create`/`uc catalog update` não têm flag
`--owner` — no servidor local sem autenticação, não há principal
autenticado pra virar owner automaticamente, então `owner` fica `null`
pra tudo criado por este script. Não é um bug do adapter (que lê o campo
corretamente) nem do script — é uma característica genuína de rodar sem
auth configurada.
"""

from __future__ import annotations

import argparse
import subprocess
import sys

CATALOGS = [
    ("vendas", "Domínio de vendas"),
    ("financeiro", "Domínio financeiro"),
]

SCHEMAS = [("vendas", "public"), ("financeiro", "public")]

# Achado real: storage_location precisa ser um caminho de verdade — EXTERNAL
# table com "s3://" fake tenta materializar um Delta table via credenciais
# AWS reais (DeltaKernelUtils.getHDFSConfiguration) e quebra com NPE sem
# elas. file:// dentro do próprio container evita depender de nuvem nenhuma
# só pra um smoke test local — os diretórios são criados via `docker exec
# ... mkdir -p` antes de rodar este script (ver README.md § Roadmap Fase 6).
# Achado real #2: DECIMAL quebra o Delta Kernel com "Unknown primitive type
# decimal" mesmo com precisão/escala explícita ("DECIMAL(18,2)") — o parser
# de --columns desta CLI só monta tipos primitivos simples, não o caminho de
# DecimalType parametrizado. Usar DOUBLE evita o problema pra este smoke test
# (não precisamos de decimal exato aqui, só de um tipo numérico qualquer).
TABLES = [
    {
        "full_name": "vendas.public.pedidos",
        "columns": "id_pedido LONG, valor_total DOUBLE",
        "storage_location": "file:///tmp/uc-demo/vendas/public/pedidos",
    },
    {
        "full_name": "vendas.public.clientes",
        "columns": "id_cliente LONG, cpf STRING",
        "storage_location": "file:///tmp/uc-demo/vendas/public/clientes",
        # Convenção que UnityCatalogAdapter reconhece pra PII — UC não tem
        # Tags/Classification como o OMD. CLI --columns não aceita
        # propriedade por coluna (só "nome TIPO"), então a marcação fica no
        # nível da tabela — UnityCatalogAdapter.isPii() já checa os dois
        # níveis (table.properties e column.properties) de propósito.
        "properties": '{"pii":"true"}',
    },
    {
        "full_name": "financeiro.public.faturamento",
        "columns": "mes_referencia DATE, valor_bruto DOUBLE",
        "storage_location": "file:///tmp/uc-demo/financeiro/public/faturamento",
    },
]

# Grant de teste: "geral@empresa.com" só recebe SELECT no catalog vendas
# (herda pra public.pedidos/public.clientes) — financeiro fica de fora de
# propósito, pra provar que getUserAccessLevel() devolve 'none' lá.
GRANT_PRINCIPAL = "geral@empresa.com"
GRANT_CATALOG = "vendas"


def uc(container: str, *args: str) -> str:
    result = subprocess.run(
        ["docker", "exec", container, "bin/uc", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    combined = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0:
        # Achado real: a API de usuários (SCIM) devolve erro num formato
        # totalmente diferente do resto da UC — HTTP 500 com "status":"409"
        # como string dentro do corpo e "already exists" em texto livre, sem
        # o error_code estruturado (ex. CATALOG_ALREADY_EXISTS) que
        # catalogs/schemas/tables/permissions usam. Checagem tolerante cobre
        # os dois formatos.
        if "ALREADY_EXISTS" in combined or "already exists" in combined.lower():
            return "_already_exists_"
        raise RuntimeError(f"uc {' '.join(args)} falhou:\n{combined}")
    return result.stdout


def seed(container: str) -> None:
    print(f"Semeando Unity Catalog no container {container}...")

    for name, comment in CATALOGS:
        out = uc(container, "catalog", "create", "--name", name, "--comment", comment)
        print(f"  catalog {name}: {'já existia' if out == '_already_exists_' else 'criado'}")

    for catalog, schema in SCHEMAS:
        out = uc(container, "schema", "create", "--catalog", catalog, "--name", schema)
        print(f"  schema {catalog}.{schema}: {'já existia' if out == '_already_exists_' else 'criado'}")

    for t in TABLES:
        args = [
            "table", "create",
            "--full_name", t["full_name"],
            "--columns", t["columns"],
            "--format", "DELTA",
            "--table_type", "EXTERNAL",
            "--storage_location", t["storage_location"],
        ]
        if "properties" in t:
            args += ["--properties", t["properties"]]
        out = uc(container, *args)
        print(f"  table {t['full_name']}: {'já existia' if out == '_already_exists_' else 'criada'}")

    # Achado real: permission create exige que o principal já exista como
    # user cadastrado na UC (404 "User not found" senão) — mesmo requisito
    # do OMD (getUserAccessLevel também depende do usuário existir de fato).
    out = uc(container, "user", "create", "--name", "Usuario Geral", "--email", GRANT_PRINCIPAL)
    print(f"  user {GRANT_PRINCIPAL}: {'já existia' if out == '_already_exists_' else 'criado'}")

    uc(
        container,
        "permission", "create",
        "--securable_type", "catalog",
        "--name", GRANT_CATALOG,
        "--principal", GRANT_PRINCIPAL,
        "--privilege", "SELECT",
    )
    print(f"  grant: SELECT em catalog '{GRANT_CATALOG}' para {GRANT_PRINCIPAL} ok")

    print("Seed do Unity Catalog concluído.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="unitycatalog-server-1")
    args = parser.parse_args()
    try:
        seed(args.container)
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
