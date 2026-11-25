-- G2.9: link do VS Code Remote da pasta da sessão, para o cartão "em andamento" do Hub.
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "vscode_url" TEXT;
