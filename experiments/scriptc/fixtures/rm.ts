import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Minimal rm-options reproducer; execution removes only its own unique directory.
const folder = mkdtempSync(join(tmpdir(), 'baileyrs-scriptc-rm-'))
await rm(folder, { recursive: true, force: true })
