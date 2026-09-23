/**
 * Node compatibility wrapper for the historical deep import.
 *
 * Importing this path has always made filesystem, stream, optional processor,
 * and Buffer-backed media behavior available without requiring the package
 * root to be imported first. Host socket internals import the portable core
 * directly and therefore never enter this Node initializer.
 */
import { nodeRuntime as initializedNodeRuntime } from '../Runtime/node.ts'

void initializedNodeRuntime

export * from './messages-media-core.ts'
