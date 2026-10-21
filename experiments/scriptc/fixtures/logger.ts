import P, { type Logger } from 'pino'
const logger: Logger = P({ level: 'silent' })
logger.info({ fixture: true }, 'offline')
