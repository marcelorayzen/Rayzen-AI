import { NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * ── "Não encontrei" e "não existe" não podem ter a mesma cara ────────────────
 *
 * Rota com escopo de projeto que devolve `200 []` ou `200 {nodes:[],edges:[]}` para um id que não
 * existe está afirmando um fato — *este projeto não tem nada* — quando a verdade é *este projeto
 * não é nada*. Para um humano no painel a diferença é um segundo de confusão; para um consumidor
 * automático (MCP, Hermes, o orquestrador) é conhecimento inventado, e foi exatamente assim que o
 * Hermes respondeu com o estado do projeto DEFAULT ao ser perguntado sobre um id inexistente.
 *
 * A distinção que importa não é "tem dado?" e sim **"o dono do dado existe?"**:
 *
 * | situação | resposta |
 * |---|---|
 * | projeto não existe | **404** — o id está errado |
 * | projeto existe e a coleção está vazia | `200` com a coleção vazia, como antes |
 *
 * A query extra só roda no caminho em que já não havia o que devolver, então o caso comum (tem
 * dado) não paga nada.
 *
 * Esta função existe para que essa regra tenha **um** lugar. `ProjectStateService.get()` fazia a
 * mesma checagem à mão desde o conserto de 14/09; na terceira cópia isso viraria o problema das
 * quatro `SAFE_ROOTS` divergentes, e a correção seria "arrumar em N lugares e esquecer o N+1".
 */
export async function garantirProjeto(prisma: PrismaService, projectId: string): Promise<void> {
  const projeto = await prisma.project.findUnique({
    where:  { id: projectId },
    select: { id: true },
  })
  if (!projeto) throw new NotFoundException(`Project ${projectId} not found`)
}
