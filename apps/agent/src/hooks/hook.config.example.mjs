/**
 * Configuração do hook Rayzen AI para Claude Code
 *
 * Copie este arquivo para hook.config.mjs e preencha os valores.
 * Este arquivo é lido pelo rayzen-hook.mjs se as env vars não estiverem definidas.
 *
 * NUNCA comite hook.config.mjs (já está no .gitignore).
 */

export default {
  // URL pública da API Rayzen (ex: ngrok no notebook)
  apiUrl: 'https://SEU-ENDPOINT-API.ngrok-free.dev',

  // JWT de autenticação — obter em POST /auth/login
  apiToken: 'SEU_TOKEN_AQUI',

  // ID do projeto ativo no Rayzen.
  //
  // DEIXE VAZIO para detecção automática por pasta/repo git:
  //   - O hook lê o nome do repositório via `git remote get-url origin`
  //   - Consulta GET /projects?repoSlug=<nome-do-repo> na API
  //   - Usa o projectId do projeto encontrado (cache de 5 min)
  //
  // Preencha manualmente SOMENTE se quiser fixar um projeto independente
  // do repositório git aberto (comportamento anterior).
  projectId: '',
}
