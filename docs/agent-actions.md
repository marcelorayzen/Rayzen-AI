# Catálogo de Ações do Agent — Matriz de Risco

> 🤖 **GERADO AUTOMATICAMENTE** por `scripts/gen-agent-catalog.mjs` — não edite à mão.
> Fonte de verdade: `whitelist.ts` · Metadata: `skill-registry.ts` (V2)
> Gerado em: 2026-06-27T02:12:37.985Z

**Total: 45 ações** · 🔴 5 high · 🟡 8 medium · 🟢 10 low · 🟢 22 none · ⚠️ 0 sem metadata

| Ação | Nome | Risco | Runtime | Categoria | Metadata |
|---|---|---|---|---|---|
| `jarvis:open_app` | Open Application | 🟢 low | agent-desktop | system | ✓ |
| `jarvis:open_url` | Open URL | 🟢 low | agent-desktop | browser | ✓ |
| `jarvis:open_vscode` | Open VS Code | 🟢 none | agent-desktop | editor | ✓ |
| `jarvis:browse_and_screenshot` | Browse and Screenshot | 🟢 low | agent-desktop | browser | ✓ |
| `jarvis:list_dir` | List Directory | 🟢 none | agent-desktop | filesystem | ✓ |
| `jarvis:file_search` | File Search | 🟢 none | agent-desktop | filesystem | ✓ |
| `jarvis:file_read` | File Read | 🟢 none | agent-desktop | filesystem | ✓ |
| `jarvis:file_write` | File Write | 🟡 medium | agent-desktop | filesystem | ✓ |
| `jarvis:file_delete` | File Delete | 🔴 high | agent-desktop | filesystem | ✓ |
| `jarvis:organize_downloads` | Organize Downloads | 🟡 medium | agent-desktop | filesystem | ✓ |
| `jarvis:create_project_folder` | Create Project Folder | 🟢 low | agent-desktop | filesystem | ✓ |
| `jarvis:get_system_info` | Get System Info | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:screenshot` | Screenshot | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:notify` | Notify | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:clipboard_read` | Read Clipboard | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:clipboard_write` | Write Clipboard | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:git_status` | Git Status | 🟢 none | agent-desktop | git | ✓ |
| `jarvis:git_log` | Git Log | 🟢 none | agent-desktop | git | ✓ |
| `jarvis:git_diff` | Git Diff | 🟢 none | agent-desktop | git | ✓ |
| `jarvis:git_branch` | Git Branch | 🟢 low | agent-desktop | git | ✓ |
| `jarvis:git_add` | Git Add | 🟢 low | agent-desktop | git | ✓ |
| `jarvis:git_commit` | Git Commit | 🟡 medium | agent-desktop | git | ✓ |
| `jarvis:git_pull` | Git Pull | 🟡 medium | agent-desktop | git | ✓ |
| `jarvis:git_push` | Git Push | 🟡 medium | agent-desktop | git | ✓ |
| `jarvis:run_command` | Run Command | 🟡 medium | agent-desktop | terminal | ✓ |
| `jarvis:run_tests` | Run Tests | 🟢 low | agent-desktop | qa | ✓ |
| `jarvis:inspect_schema` | Inspect Schema | 🟢 none | agent-desktop | data | ✓ |
| `jarvis:parse_test_report` | Parse Test Report | 🟢 none | agent-desktop | qa | ✓ |
| `jarvis:get_qa_summary` | QA Summary | 🟢 none | agent-desktop | qa | ✓ |
| `jarvis:get_data_quality` | Data Quality | 🟢 none | agent-desktop | data | ✓ |
| `jarvis:capture_test_failure` | Capture Test Failure | 🟢 none | agent-desktop | qa | ✓ |
| `jarvis:prisma_generate` | Prisma Generate | 🟢 low | agent-desktop | data | ✓ |
| `jarvis:prisma_migrate` | Prisma Migrate | 🔴 high | agent-desktop | data | ✓ |
| `jarvis:docker_ps` | Docker PS | 🟢 none | agent-server | docker | ✓ |
| `jarvis:docker_start` | Docker Start | 🟡 medium | agent-server | docker | ✓ |
| `jarvis:docker_stop` | Docker Stop | 🟡 medium | agent-server | docker | ✓ |
| `jarvis:docker_logs` | Docker Logs | 🟢 none | agent-server | docker | ✓ |
| `jarvis:restart_api` | Restart API | 🔴 high | agent-server | system | ✓ |
| `jarvis:read_emails` | Read Emails | 🟢 none | agent-desktop | email | ✓ |
| `jarvis:send_email` | Send Email | 🔴 high | agent-desktop | email | ✓ |
| `jarvis:get_calendar` | Get Calendar | 🟢 none | agent-desktop | calendar | ✓ |
| `jarvis:run_graphify` | Run Graphify | 🟢 low | agent-server | system | ✓ |
| `jarvis:graphify_sync` | Graphify Sync | 🟢 low | agent-server | system | ✓ |
| `jarvis:guardian_analyze` | Guardian Analyze | 🟢 none | agent-desktop | system | ✓ |
| `jarvis:supervised_session` | Supervised Session | 🔴 high | agent-server | system | ✓ |

✅ Sem drift: whitelist e registry estão sincronizados.
