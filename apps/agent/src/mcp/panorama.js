'use strict'

/**
 * Monta o PANORAMA de um projeto (`rayzen_project_overview`, 17/11/2026) a partir das leituras que
 * o servidor MCP fez em paralelo. Puro, sem rede — testável sem subir o servidor.
 *
 * Cortes fixos por parte: o panorama substitui 5–6 leituras numa ida só, mas não pode virar um
 * contexto maior que elas. O que foi cortado é DITO (`truncado`), e uma parte que falhou diz que
 * falhou — nunca vira "o projeto não tem README".
 */

const CORTE = { readme: 6000, agents: 6000, estadoDoc: 4000 }
const MAX_ARQUIVOS_NA_ARVORE = 300

function texto(parte, corte) {
  if (!parte.ok) return { erro: parte.erro }
  const v = parte.v || {}
  if (v.recusado) return { recusado: v.recusado }
  if (v.existe === false) return { existe: false }
  const conteudo = typeof v.conteudo === 'string' ? v.conteudo : ''
  return {
    conteudo: conteudo.slice(0, corte),
    ...(conteudo.length > corte || v.truncado ? { truncado: true, bytes: v.bytes } : {}),
  }
}

function pacote(parte) {
  if (!parte.ok) return { erro: parte.erro }
  const v = parte.v || {}
  if (v.existe === false) return { existe: false }
  try {
    const p = JSON.parse(v.conteudo || '')
    return {
      name: p.name, version: p.version, engines: p.engines,
      scripts: p.scripts || {},
      dependencies: Object.keys(p.dependencies || {}),
      devDependencies: Object.keys(p.devDependencies || {}),
    }
  } catch {
    return { erro: 'package.json não é JSON válido' }
  }
}

/** Árvore resumida: pastas com a contagem de arquivos, e os primeiros caminhos. */
function arvore(parte) {
  if (!parte.ok) return { erro: parte.erro }
  const arquivos = ((parte.v && parte.v.arquivos) || []).map((a) => a.path)
  const porPasta = {}
  for (const f of arquivos) {
    const i = f.indexOf('/')
    const topo = i === -1 ? '.' : f.slice(0, i)
    porPasta[topo] = (porPasta[topo] || 0) + 1
  }
  return {
    fonte: parte.v && parte.v.fonte,
    total: (parte.v && parte.v.total) || arquivos.length,
    porPasta,
    arquivos: arquivos.slice(0, MAX_ARQUIVOS_NA_ARVORE),
    ...(arquivos.length > MAX_ARQUIVOS_NA_ARVORE ? { truncado: true } : {}),
  }
}

function estado(parte) {
  if (!parte.ok) return { erro: parte.erro }
  const s = parte.v || {}
  return {
    objective: s.objective, stage: s.stage,
    nextSteps: s.nextSteps, blockers: s.blockers, activeFocus: s.activeFocus,
  }
}

function montarPanorama({ estado: e, lista, readme, pkg, agents, estadoDoc }) {
  return {
    estado: estado(e),
    arvore: arvore(lista),
    readme: texto(readme, CORTE.readme),
    packageJson: pacote(pkg),
    agentsMd: texto(agents, CORTE.agents),
    estadoDoProjetoMd: texto(estadoDoc, CORTE.estadoDoc),
    nota: 'Panorama em uma chamada. Para o conteúdo inteiro de um arquivo ou outro arquivo, use rayzen_read_file.',
  }
}

module.exports = { montarPanorama, CORTE, MAX_ARQUIVOS_NA_ARVORE }
