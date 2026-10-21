import { rm } from 'node:fs/promises'
// Must preserve recursive cleanup of the temporary offline auth directory.
await rm('unused-offline-fixture', { recursive: true, force: true })
