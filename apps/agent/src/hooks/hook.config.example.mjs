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

  // JWT de autenticação - obter em POST /auth/login
  apiToken: 'SEU_TOKEN_AQUI',

  // ID do projeto ativo no Rayzen (obter em GET /projects)
  // Deixar vazio para não vincular eventos a um projeto específico
  projectId: '',
}
