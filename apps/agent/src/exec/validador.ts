import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

/**
 * Fase 2 do plano de execução tipada — validador próprio, pequeno, com os tipos que
 * realmente aparecem nas capabilities declaradas. Sem `zod`: adicionar uma dependência de
 * runtime para isto seria troca ruim num processo que já roda com o token da casa.
 *
 * A lista de tipos não é fechada por design — o plano já dizia isso ("os tipos que
 * realmente aparecem"). `caminhoSeguro` e `textoCurto` entraram aqui porque as duas
 * primeiras capabilities reais (`docker.*`, depois `fs.*`) precisaram deles; um tipo novo
 * só entra quando uma capability de verdade precisar, nunca antecipado.
 */
export type EspecificacaoDeParam =
  | { readonly tipo: 'enum'; readonly valores: readonly string[] }
  | { readonly tipo: 'inteiro'; readonly min: number; readonly max: number }
  | { readonly tipo: 'slug' }
  | { readonly tipo: 'projectId' }
  | { readonly tipo: 'caminhoSeguro' }
  | { readonly tipo: 'textoCurto'; readonly max: number }

const REGEX_SLUG      = /^[a-zA-Z0-9_.-]+$/
const REGEX_PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Valida UM valor contra UMA especificação. Devolve o valor no tipo que a capability vai
 * consumir (`inteiro` devolve `number`; todo o resto devolve `string`) — nunca a string
 * bruta sem checagem, mesmo para os tipos "livres" como `textoCurto`.
 */
export function validar(spec: EspecificacaoDeParam, valor: unknown, nomeDoParam: string): string | number {
  switch (spec.tipo) {
    case 'enum': {
      if (typeof valor !== 'string' || !spec.valores.includes(valor)) {
        throw new Error(`"${nomeDoParam}": valor inválido "${String(valor)}" — use um de: ${spec.valores.join(', ')}.`)
      }
      return valor
    }

    case 'inteiro': {
      const n = typeof valor === 'number' ? valor : Number(valor)
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
        throw new Error(`"${nomeDoParam}": precisa ser um inteiro entre ${spec.min} e ${spec.max}, recebido "${String(valor)}".`)
      }
      return n
    }

    case 'slug': {
      // Mesmo padrão de `NOME_DE_PROGRAMA_SEGURO` em executar-programa.ts: sem espaço,
      // barra ou metacaractere. Serve para nome de container/serviço do Docker.
      if (typeof valor !== 'string' || !REGEX_SLUG.test(valor)) {
        throw new Error(`"${nomeDoParam}": precisa ser um nome simples (letras, números, "_" "." "-"), recebido "${String(valor)}".`)
      }
      return valor
    }

    case 'projectId': {
      if (typeof valor !== 'string' || !REGEX_PROJECT_ID.test(valor)) {
        throw new Error(`"${nomeDoParam}": precisa ser um UUID válido, recebido "${String(valor)}".`)
      }
      return valor
    }

    case 'caminhoSeguro': {
      if (typeof valor !== 'string' || !valor.trim()) {
        throw new Error(`"${nomeDoParam}": precisa ser um caminho, recebido "${String(valor)}".`)
      }
      const resolvido = resolve(valor)
      if (!isUnderSafeRoot(resolvido)) {
        throw new Error(`"${nomeDoParam}": caminho fora dos diretórios permitidos: ${resolvido}`)
      }
      return resolvido
    }

    case 'textoCurto': {
      if (typeof valor !== 'string' || !valor.trim()) {
        throw new Error(`"${nomeDoParam}": precisa ser texto não vazio.`)
      }
      if (valor.length > spec.max) {
        throw new Error(`"${nomeDoParam}": máximo de ${spec.max} caracteres, recebido ${valor.length}.`)
      }
      return valor
    }
  }
}
