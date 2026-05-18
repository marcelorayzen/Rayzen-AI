# PC Agent Runtime — Rayzen AI

The PC Agent is a Node.js 20 TypeScript process that runs locally on the user's Windows machine. It connects to the Rayzen AI backend exclusively via BullMQ over Redis — there is no persistent WebSocket connection.

## Architecture

```
VPS Ubuntu           Local Machine (Windows)
┌─────────────────────┐          ┌────────────────────────────────┐
│  NestJS API         │          │  PC Agent (Node.js)            │
│  ExecutionModule    │          │                                │
│    ↓                │          │  ┌──────────────────────────┐  │
│  BullMQ queue       │◄─Redis──►│  │  poll every 3s           │  │
│  "agent-tasks"      │          │  │  → whitelist.ts check    │  │
└─────────────────────┘          │  │  → executor.ts dispatch  │  │
                                 │  │  → update job status     │  │
                                 │  └──────────────────────────┘  │
                                 └────────────────────────────────┘
```

## Security Model

### Whitelist-first execution

Every action must be explicitly registered in `apps/agent/src/security/whitelist.ts`:

```typescript
export const ALLOWED_ACTIONS = new Set([
  'open_app',
  'list_dir',
  'read_file',
  'write_file',
  'screenshot',
  // ...
])
```

Actions not present in the whitelist are silently rejected — no error is returned to the queue, no system call is made.

### Path sandbox

All file-system actions enforce:
- Block path traversal: any path containing `../` is rejected
- Block system directories: `/etc`, `/var`, `/root`, `/sys`, `C:\Windows\System32`
- Allow only user-space paths within configured sandbox root

### Dry-run protocol

Medium and high-risk actions implement a two-phase execution:

```typescript
// Phase 1 — validate without side effects
await action.execute({ ...payload, dryRun: true })

// Phase 2 — real execution (only if dry-run passes)
return action.execute(payload)
```

### Job lifecycle

```
pending → active → done
              └──→ failed  (after 3 retries with 5s backoff)
```

Jobs are never removed from Redis on completion (`removeOnComplete: false`, `removeOnFail: false`) to preserve audit trail and support debugging.

## Action Catalogue

| Action | Risk | Description |
|---|---|---|
| `open_app` | low | Launch application by name |
| `close_app` | medium | Terminate process by name |
| `screenshot` | low | Capture screen to file |
| `list_dir` | low | List directory contents (sandboxed) |
| `read_file` | low | Read file contents (sandboxed) |
| `write_file` | medium | Write content to file (dry-run first) |
| `delete_file` | high | Delete file (dry-run + confirmation) |
| `run_script` | high | Execute whitelisted script (no free shell) |
| `get_clipboard` | low | Read clipboard text |
| `set_clipboard` | low | Write text to clipboard |
| `type_text` | low | Type text via keyboard automation |
| `press_key` | low | Send keyboard shortcut |
| `move_mouse` | low | Move cursor to coordinates |
| `click` | low | Mouse click at coordinates |
| `get_active_window` | low | Get currently focused window title |
| `focus_window` | low | Bring window to foreground |
| `minimize_window` | low | Minimize window |
| `maximize_window` | low | Maximize window |
| `notify` | low | Show system notification |
| `get_system_info` | low | CPU, RAM, disk usage |
| `get_running_processes` | low | List running processes |
| `download_file` | medium | Download URL to file (sandboxed path) |
| `open_url` | low | Open URL in default browser |

## Adding a New Action

1. Add to `whitelist.ts`:
   ```typescript
   export const ALLOWED_ACTIONS = new Set([
     // existing...
     'new_action',
   ])
   ```

2. Create `apps/agent/src/actions/new-action.ts`:
   ```typescript
   export async function newAction(payload: NewActionPayload): Promise<NewActionResult> {
     // 1. Validate input
     // 2. Check path sandbox if applicable
     // 3. Implement dry-run if risk >= medium
     // 4. Execute
   }
   ```

3. Add case in `executor.ts`:
   ```typescript
   case 'new_action':
     return newAction(task.payload as NewActionPayload)
   ```

4. Write tests in `apps/agent/src/__tests__/new-action.spec.ts`:
   - Test whitelist enforcement
   - Test path traversal rejection
   - Test dry-run behaviour
   - Test happy path

## Agent Authentication

The PC Agent authenticates to the Redis instance using a long-lived JWT (`AGENT_TOKEN`, 30-day expiry) configured in the agent's `.env`. This token is validated by the `AgentBridgeModule` before any queue interaction is permitted.

## Configuration

```bash
AGENT_API_URL=https://api.yourdomain.com    # VPS API base URL
AGENT_TOKEN=<long-lived JWT>                # from /agent/register
AGENT_POLL_INTERVAL_MS=3000                 # default: 3000ms
REDIS_URL=redis://localhost:6379            # shared with API in dev
```
