import * as os from 'os'
import { execSync } from 'child_process'

function getDiskInfo() {
  try {
    if (os.platform() === 'win32') {
      const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8' })
      const lines = output.trim().split('\n').slice(1).filter(Boolean)
      return lines.map((line) => {
        const parts = line.trim().split(/\s+/)
        const caption = parts[0]
        const free = parseInt(parts[1] ?? '0')
        const total = parseInt(parts[2] ?? '0')
        if (!total) return null
        return {
          drive: caption,
          totalGB: (total / 1024 ** 3).toFixed(2),
          freeGB: (free / 1024 ** 3).toFixed(2),
          usedGB: ((total - free) / 1024 ** 3).toFixed(2),
          usedPercent: (((total - free) / total) * 100).toFixed(1),
        }
      }).filter(Boolean)
    }
  } catch {
    return null
  }
  return null
}

export async function getSystemInfo() {
  const uptime = os.uptime()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    memory: {
      totalGB: (totalMem / 1024 ** 3).toFixed(2),
      usedGB: (usedMem / 1024 ** 3).toFixed(2),
      freeGB: (freeMem / 1024 ** 3).toFixed(2),
      usedPercent: ((usedMem / totalMem) * 100).toFixed(1),
    },
    disk: getDiskInfo(),
    uptimeHours: (uptime / 3600).toFixed(1),
    nodeVersion: process.version,
  }
}
