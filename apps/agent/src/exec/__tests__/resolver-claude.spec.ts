import { join } from 'path'
import { resolverExecutavelClaude } from '../resolver-claude'

/** O wrapper REAL instalado pelo npm nesta máquina (12/11), reduzido ao que importa. */
const WRAPPER_NPM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
].join('\r\n')

const DIR = 'C:\\Users\\x\\.npm-global'
const EXE = join(DIR, 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')

describe('resolverExecutavelClaude — sem shell, o binário de verdade', () => {
  it('Windows com só o .cmd: lê o wrapper e devolve o claude.exe que ele chama', () => {
    expect(resolverExecutavelClaude({
      plataforma: 'win32', env: {},
      onde: () => [join(DIR, 'claude'), join(DIR, 'claude.cmd')],
      ler: () => WRAPPER_NPM,
      existe: (c) => c === EXE,
    })).toBe(EXE)
  })

  it('.exe direto no PATH vence o wrapper', () => {
    expect(resolverExecutavelClaude({
      plataforma: 'win32', env: {}, onde: () => ['C:\\bin\\claude.exe', join(DIR, 'claude.cmd')], existe: () => true, ler: () => WRAPPER_NPM,
    })).toBe('C:\\bin\\claude.exe')
  })

  it('RAYZEN_CLAUDE_BIN explícito e existente vence tudo', () => {
    expect(resolverExecutavelClaude({
      plataforma: 'win32', env: { RAYZEN_CLAUDE_BIN: 'D:\\x\\claude.exe' }, onde: () => ['C:\\bin\\claude.exe'], existe: () => true,
    })).toBe('D:\\x\\claude.exe')
  })

  it('wrapper apontando para binário que não existe: cai em "claude" (falha alta no spawn, nunca silêncio)', () => {
    expect(resolverExecutavelClaude({
      plataforma: 'win32', env: {}, onde: () => [join(DIR, 'claude.cmd')], ler: () => WRAPPER_NPM, existe: () => false,
    })).toBe('claude')
  })

  it('fora do Windows, spawn("claude") já funciona', () => {
    expect(resolverExecutavelClaude({ plataforma: 'linux', env: {}, onde: () => { throw new Error('não chamar') } })).toBe('claude')
  })

  const real = process.platform === 'win32' ? it : it.skip
  real('nesta máquina, resolve para um claude.exe que existe', () => {
    const r = resolverExecutavelClaude()
    expect(r).toMatch(/claude\.exe$/i)
  })
})
