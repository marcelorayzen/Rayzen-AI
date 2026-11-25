# Modelos do modo Crítico

Três documentos, gerados só quando o projeto é crítico ou trata dado sensível. Cada um vira
um arquivo próprio em `docs/`.

---

## `docs/SEGURANCA.md`

- **Ameaças** (o que pode dar errado, quem, como): {{…}}
- **Superfície**: entradas externas, credenciais, permissões mínimas por papel.
- **Segredos**: onde moram (nunca no repositório), rotação, quem acessa.
- **Controles**: o que impede cada ameaça — mecanismo, não instrução.

---

## `docs/RISCOS.md`

| risco | prob. | impacto | sinal de que está acontecendo | mitigação | dono |
|---|---|---|---|---|---|
| {{…}} | {{B/M/A}} | {{B/M/A}} | {{…}} | {{…}} | {{…}} |

---

## `docs/DADOS.md`

- **Fontes** e contratos de dados (ver `docs/CONTRATO-*.md`).
- **Qualidade**: regras, o que acontece quando falham.
- **Linhagem**: de onde vem e para onde vai cada dado relevante.
- **Acesso e retenção**: quem lê, por quanto tempo se guarda, como se elimina.
