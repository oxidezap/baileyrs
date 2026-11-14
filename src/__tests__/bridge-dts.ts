/**
 * The bridge's own declarations, which several tests read as the contract the
 * core actually deserializes. Not a `.test.ts`, so the runner leaves it alone.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript-compat-auditor'

const CANDIDATES = [
	'../../node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge.d.ts',
	// Pre-0.6.0-alpha.39 packages shipped the declarations under pkg/.
	'../../node_modules/@oxidezap/whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts',
	// Sibling checkout, for local development against an unpublished bridge.
	'../../../whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts'
].map(candidate => path.resolve(import.meta.dirname, candidate))

/** Resolve `whatsapp_rust_bridge.d.ts` from the installed package. */
export const loadBridgeDts = (): string => {
	for (const candidate of CANDIDATES) {
		try {
			return formatBridgeDts(readFileSync(candidate, 'utf8'))
		} catch {
			/* try the next one */
		}
	}
	throw new Error(`Could not find whatsapp_rust_bridge.d.ts. Tried:\n  ${CANDIDATES.join('\n  ')}`)
}

/** The members of an `export type X = "a" | "b"`, in declaration order. */
export const bridgeStringUnion = (dts: string, name: string): string[] => {
	// `[^;]+` rather than `.+`: the generator wraps long unions across lines, as
	// it already does for WhatsAppEvent, and a body-shaped match survives that.
	const declaration = new RegExp(`^export type ${name} = ([^;]+);$`, 'mu').exec(dts)
	if (!declaration) throw new Error(`the bridge no longer declares ${name}`)
	return [...declaration[1]!.matchAll(/"([^"]*)"/gu)].map(match => match[1]!)
}

/** Canonical whitespace for text-based contract checks, without changing types. */
export const formatBridgeDts = (text: string): string =>
	ts.createPrinter().printFile(ts.createSourceFile('bridge.d.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS))

/** Read only the top-level discriminator of each declared event variant. */
export const bridgeEventTypes = (text: string): string[] => {
	const source = ts.createSourceFile('bridge.d.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const declaration = source.statements.find(
		(node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'WhatsAppEvent'
	)
	if (!declaration || !ts.isUnionTypeNode(declaration.type)) throw new Error('WhatsAppEvent union not found in .d.ts')
	const values = declaration.type.types.map(member => {
		if (!ts.isTypeLiteralNode(member)) throw new Error('WhatsAppEvent variant is not an object type')
		const discriminator = member.members.find(
			(node): node is ts.PropertySignature =>
				ts.isPropertySignature(node) && ts.isIdentifier(node.name) && node.name.text === 'type'
		)
		const type = discriminator?.type
		if (!type || !ts.isLiteralTypeNode(type) || !ts.isStringLiteral(type.literal))
			throw new Error('WhatsAppEvent variant has no string discriminator')
		return type.literal.text
	})
	return [...new Set(values)].toSorted()
}
