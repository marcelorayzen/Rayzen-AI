import { spawn } from 'child_process'
import { existsSync } from 'fs'

export class ClaudeLauncher {
  static launch(projectPath: string, objective: string): Promise<{ ok: boolean; pid?: number; error?: string }> {
    return new Promise((resolve) => {
      if (!existsSync(projectPath)) {
        resolve({ ok: false, error: `Diretório não encontrado: ${projectPath}` })
        return
      }

      // Spawn Windows Terminal or cmd with claude in the project directory
      const isWindows = process.platform === 'win32'

      let cmd: string
      let args: string[]

      if (isWindows) {
        // Try Windows Terminal first, fallback to cmd
        cmd = 'wt.exe'
        args = ['--startingDirectory', projectPath, 'cmd', '/k', `claude "${objective}"`]
      } else {
        cmd = 'bash'
        args = ['-c', `cd "${projectPath}" && claude "${objective}"`]
      }

      try {
        const child = spawn(cmd, args, {
          detached: true,
          stdio: 'ignore',
          cwd: projectPath,
        })
        child.unref()
        resolve({ ok: true, pid: child.pid })
      } catch {
        // Fallback: open terminal in directory without auto-running claude
        try {
          const fallback = spawn(isWindows ? 'explorer' : 'xdg-open', [projectPath], {
            detached: true, stdio: 'ignore',
          })
          fallback.unref()
          resolve({ ok: true, pid: fallback.pid })
        } catch (e2) {
          resolve({ ok: false, error: String(e2) })
        }
      }
    })
  }
}
