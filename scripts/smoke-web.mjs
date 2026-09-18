#!/usr/bin/env node
/**
 * smoke-web — exercita a interface de verdade, contra o ambiente que está no ar.
 *
 * Existe porque `apps/web` não tem runner de teste: os 863 testes do monorepo são
 * unidade/integração de backend e **todos mockam o Prisma**, então cobrem 0% do que o
 * usuário alcança. Na auditoria de 2026-08-19 isso ficou concreto — o botão `checkpoint`
 * derrubava a aplicação inteira (`undefined.slice` no render) com a suíte 100% verde.
 *
 * Cada asserção aqui corresponde a um defeito REAL, achado clicando. O critério para
 * entrar é o mesmo do catálogo de invariantes: já quebrou em silêncio e custou tempo.
 * A diferença de escopo entre os dois é deliberada — invariante pega defeito de DADO;
 * isto pega defeito de RENDERIZAÇÃO, que nenhum invariante alcança.
 *
 * Roda contra PRODUÇÃO por decisão, não por preguiça: E2E no CI exigiria subir Postgres,
 * Redis, LiteLLM, api, api-v2 e web com dado semeado — o CI hoje não tem `services:`
 * justamente porque todo teste mocka o banco. Contra o ambiente no ar, o ambiente já
 * existe. O custo é que isto **verifica depois do deploy**, não antes dele.
 *
 * Usa o puppeteer que já é dependência do `apps/api` (está lá para gerar PDF). Nenhuma
 * dependência nova foi adicionada para isto.
 *
 * Uso:
 *   pnpm smoke:web                  # roda tudo contra produção
 *   pnpm smoke:web -- --headed      # abre o navegador para acompanhar
 *
 *   # smoke de um build LOCAL antes de publicar (a resposta ainda muda a decisão):
 *   RAYZEN_WEB_URL=http://localhost:3000 RAYZEN_API_URL=https://api.rayzen.com.br pnpm smoke:web
 *
 * Config (nesta ordem): variável de ambiente → apps/agent/src/hooks/hook.config.mjs
 *   RAYZEN_WEB_URL · RAYZEN_API_TOKEN · RAYZEN_PROJECT_ID · RAYZEN_API_URL (só p/ build local)
 *
 * Exit code: 1 se qualquer asserção falhar. Um verde em que não se pode confiar é pior
 * que vermelho.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const rootDir    = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(rootDir, 'apps', 'agent', 'src', 'hooks', 'hook.config.mjs')

// O puppeteer é declarado em apps/api, não na raiz — resolvido de lá de propósito,
// para não duplicar a dependência só por causa deste script.
const require    = createRequire(join(rootDir, 'apps', 'api', 'package.json'))
const puppeteer  = require('puppeteer')

const headed = process.argv.slice(2).includes('--headed')

async function loadConfig() {
  let cfg = {}
  if (existsSync(configPath)) {
    try { cfg = (await import(pathToFileURL(configPath).href)).default ?? {} } catch { /* ignora */ }
  }
  return {
    webUrl:    process.env.RAYZEN_WEB_URL    ?? 'https://rayzen.com.br',
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
    // Só para smoke de build local: aponta o web de `localhost` para a API que está no ar,
    // via o override que a própria app lê (`rayzen_api_url`). Permite testar ANTES do
    // deploy, que é quando o resultado ainda muda a decisão.
    apiUrl:    process.env.RAYZEN_API_URL    ?? '',
  }
}

// ── Resultado ─────────────────────────────────────────────────────────────────

const resultados = []
const OUT = process.env.RAYZEN_SMOKE_OUT ?? join(tmpdir(), 'rayzen-smoke')

/**
 * Guarda a tela no momento da falha. Rodando desatendido no CI, "13/13 virou 12/13" sem
 * imagem é um vermelho que ninguém consegue diagnosticar sem reproduzir à mão — e
 * vermelho indiagnosticável é o que se aprende a ignorar.
 */
async function registrar(nome, ok, detalhe, refs = '', page = null) {
  resultados.push({ nome, ok, detalhe, refs })
  const marca = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
  console.log(`  ${marca} ${nome}${refs ? ` \x1b[90m(${refs})\x1b[0m` : ''}`)
  if (detalhe) console.log(`      \x1b[90m${detalhe}\x1b[0m`)

  if (!ok && page) {
    try {
      mkdirSync(OUT, { recursive: true })
      const arquivo = join(OUT, `falha-${nome.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`)
      await page.screenshot({ path: arquivo })
      console.log(`      \x1b[90m→ ${arquivo}\x1b[0m`)
    } catch { /* screenshot é diagnóstico, não pode derrubar o teste */ }
  }
}

/**
 * Ruído que não é defeito da aplicação, medido na auditoria:
 * - `cdn-cgi` é telemetria do Cloudflare
 * - `_rsc` são prefetches do Next que a navegação cancela
 * - ERR_ABORTED é requisição cancelada ao navegar/fechar, não falha
 */
const RUIDO = /cdn-cgi|_rsc=/
const ehRuido = (url) => RUIDO.test(url)

function instrumentar(page) {
  const b = { console: [], pageerror: [], http: [] }
  page.on('console', (m) => { if (m.type() === 'error') b.console.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => b.pageerror.push(String(e).slice(0, 200)))
  page.on('response', (r) => {
    if (r.status() >= 400 && !ehRuido(r.url())) b.http.push(`${r.status()} ${r.url().slice(0, 100)}`)
  })
  return b
}

/** Sessão autenticada com projeto ativo — sem isso toda tela mostra estado vazio. */
async function abrirApp(browser, cfg, rota = '/') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1100 })
  // Uma retentativa: `ERR_NETWORK_CHANGED` e afins derrubaram uma execução inteira numa
  // medição real. Blip de rede não é defeito da aplicação, e no CI viraria vermelho
  // recorrente sem causa — que é o que se aprende a ignorar.
  try {
    await page.goto(cfg.webUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } catch (e) {
    console.log(`      (retentando: ${String(e).slice(0, 60)})`)
    await new Promise((r) => setTimeout(r, 3000))
    await page.goto(cfg.webUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
  await page.evaluate((t, id, api) => {
    localStorage.setItem('rayzen_token', t)
    localStorage.setItem('rayzen_active_project_id', id)
    if (api) localStorage.setItem('rayzen_api_url', api)
  }, cfg.apiToken, cfg.projectId, cfg.apiUrl)
  const b = instrumentar(page)
  await page.goto(cfg.webUrl + rota, { waitUntil: 'networkidle2', timeout: 75_000 })
  await new Promise((r) => setTimeout(r, 3500))
  return { page, b }
}

const clicar = (page, rotulo) => page.evaluate((r) => {
  const el = [...document.querySelectorAll('button, a')]
    .find((e) => e.innerText.trim().toLowerCase().includes(r.toLowerCase()))
  if (!el) return false
  el.click(); return true
}, rotulo)

const texto = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

// ── Asserções ─────────────────────────────────────────────────────────────────

const MODAIS = ['missões', 'atividade', 'qa', 'evidências', 'síntese', 'docs', 'costs']

async function main() {
  const cfg = await loadConfig()
  if (!cfg.apiToken)  { console.error('✗ RAYZEN_API_TOKEN não configurado'); process.exit(1) }
  if (!cfg.projectId) { console.error('✗ RAYZEN_PROJECT_ID não configurado'); process.exit(1) }

  console.log(`\nsmoke-web → ${cfg.webUrl}\n`)
  // `--disable-web-security` SÓ quando o web e a API estão em origens diferentes, que é o
  // caso do smoke de build local: `api.rayzen.com.br` não libera CORS para `localhost`.
  // Contra produção a flag não entra — o teste tem de passar pelas mesmas regras do usuário.
  const args = ['--no-sandbox']
  // Diretório próprio: `OUT` guarda os screenshots de falha, e apontar os dois para a
  // mesma pasta faria o Chrome misturar perfil com artefato de diagnóstico.
  if (cfg.apiUrl) args.push('--disable-web-security', `--user-data-dir=${join(tmpdir(), 'rayzen-smoke-perfil')}`)
  const browser = await puppeteer.launch({ headless: headed ? false : 'new', args })

  try {
    // 1. A aplicação sobe autenticada e sem exceção de JS.
    {
      const { page, b } = await abrirApp(browser, cfg)
      const t = await texto(page)
      const carregou = t.includes('AGUARDANDO INPUT') || t.length > 200
      await registrar('a home carrega autenticada', carregou && b.pageerror.length === 0,
        b.pageerror.length ? `pageerror: ${b.pageerror[0]}` : `${t.length} chars renderizados`, '', page)
      await registrar('nenhuma resposta HTTP >= 400 na home', b.http.length === 0, b.http.join(' | '))
      await page.close()
    }

    // 2. Os modais do Header abrem com conteúdo, sem erro de console.
    for (const rotulo of MODAIS) {
      const { page, b } = await abrirApp(browser, cfg)
      const antes = (await texto(page)).length
      const achou = await clicar(page, rotulo)
      await new Promise((r) => setTimeout(r, 6000))
      const depois = (await texto(page)).length
      await registrar(`modal "${rotulo}" abre com conteúdo`,
        achou && depois > antes && b.pageerror.length === 0,
        !achou ? 'botão não encontrado no Header'
          : b.pageerror.length ? `pageerror: ${b.pageerror[0]}`
          : depois <= antes ? 'clique não mudou o DOM' : `+${depois - antes} chars`, '', page)
      await page.close()
    }

    // 3. F-002 — o backend tinha `POST /evidence/upload/:projectId` completo desde sempre,
    //    mas nao havia caminho na interface: o unico produtor era `jarvis:screenshot` no
    //    poller do agent, e em 3 meses o acervo inteiro tinha 1 registro.
    {
      const { page } = await abrirApp(browser, cfg)
      await clicar(page, 'evidências')
      await new Promise((r) => setTimeout(r, 4000))
      const temUpload = await page.evaluate(() =>
        Boolean(document.querySelector('input[type=file][accept*="image"]')))
      await registrar('evidências tem caminho de upload na UI', temUpload,
        temUpload ? 'input de arquivo presente' : 'nenhum input[type=file] no modal', 'F-002', page)
      await page.close()
    }

    // 4. F-009 — a asserção mais importante do arquivo.
    //    O corpo 202 de POST /synthesis/checkpoint não é um artefato; tratá-lo como um
    //    colocava na lista um objeto sem `sessionId` e o `.slice()` da modal derrubava a
    //    árvore inteira. O checkpoint gravava no servidor enquanto a tela morria.
    {
      const { page, b } = await abrirApp(browser, cfg)
      await clicar(page, 'checkpoint')
      await new Promise((r) => setTimeout(r, 12_000))
      let viva = true, t = ''
      try { t = await texto(page) } catch { viva = false }
      const paginaDeErro = /couldn.t load|Aw, Snap/i.test(t)
      await registrar('checkpoint NÃO derruba a aplicação',
        viva && !paginaDeErro && b.pageerror.length === 0,
        !viva ? 'a página morreu' : paginaDeErro ? 'página de erro do navegador'
          : b.pageerror.length ? `pageerror: ${b.pageerror[0]}` : 'página viva após o clique',
        'F-009', viva ? page : null)
      await page.close()
    }

    // 5. F-003 — o painel ficava em "Carregando…" porque `analyzeGap` era uma chamada de
    //    LLM de ~60s feita em toda requisição. Era a única tela que não entregava conteúdo
    //    dentro do tempo de atenção.
    {
      const { page } = await abrirApp(browser, cfg)
      await clicar(page, 'grafo')
      await new Promise((r) => setTimeout(r, 5000))
      const t = await texto(page)
      const abriu = /GOAL GRAPH/i.test(t)
      await registrar('grafo entrega conteúdo em <5s (não fica em "Carregando…")',
        abriu && !/Carregando/i.test(t.split('GOAL GRAPH')[1] ?? ''),
        abriu ? 'painel renderizado' : 'painel não abriu', 'F-003', page)
      await page.close()
    }

    // 6. F-001 — `conversation_messages` guarda conversa E telemetria de módulo interno.
    //    O histórico exibia 20 linhas idênticas chamadas "Conversa", cada uma abrindo o
    //    payload JSON cru de uma chamada interna.
    {
      const { page } = await abrirApp(browser, cfg)
      // O gatilho é o ícone de menu, sem texto — achado pelo `title`.
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((e) => e.title?.includes('Histórico'))?.click()
      })
      await new Promise((r) => setTimeout(r, 4000))

      // Lidos do DOM, não por regex sobre innerText: os títulos ficam num <p> por sessão,
      // e casar texto corrido aqui deu falso-verde na primeira versão deste script.
      const titulos = await page.evaluate(() => {
        const painel = [...document.querySelectorAll('div')]
          .find((d) => d.innerText?.startsWith('Histórico') && d.innerText.includes('Nova conversa'))
        if (!painel) return null
        return [...painel.querySelectorAll('p')].map((p) => p.innerText.trim()).filter(Boolean)
      })

      const genericos = titulos?.filter((t) => t === 'Conversa').length ?? 0
      const reais     = (titulos?.length ?? 0) - genericos
      await registrar('histórico mostra conversa, não telemetria',
        Array.isArray(titulos) && titulos.length > 0 && reais > 0,
        titulos === null ? 'sidebar não abriu'
          : titulos.length === 0 ? 'sidebar aberta e vazia'
          : `${reais} título(s) real(is), ${genericos} genérico(s) "Conversa"`,
        'F-001', page)
      await page.close()
    }
  } finally {
    await browser.close()
  }

  const falhas = resultados.filter((r) => !r.ok)
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} asserções passaram`)
  if (falhas.length) {
    console.log(`\x1b[31m${falhas.length} falha(s): ${falhas.map((f) => f.nome).join(', ')}\x1b[0m\n`)
    process.exit(1)
  }
  console.log('')
}

main().catch((e) => { console.error(`\n✗ smoke-web quebrou: ${e}\n`); process.exit(1) })
