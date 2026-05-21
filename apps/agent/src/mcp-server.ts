import { pathToFileURL } from 'url'
import { join } from 'path'

void (async () => {
  const entry = pathToFileURL(join(__dirname, '..', 'src', 'mcp', 'rayzen-mcp.mjs')).href
  await import(entry)
})()
