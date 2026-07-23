import { relative, resolve } from 'node:path'
import ts from 'typescript-compat-auditor'

export type AuditCategory = 'exports' | 'functions' | 'fields' | 'events'
export type AuditStatus = 'matched' | 'missing' | 'mismatch' | 'extra'

export interface AuditItem {
	category: AuditCategory
	path: string
	status: AuditStatus
	expected?: string
	actual?: string
	detail?: string
	upstreamLocation?: string
	localLocation?: string
}

export interface CategorySummary {
	matched: number
	missing: number
	mismatched: number
	extra: number
	total: number
	coverage: number
}

export interface CompatibilityReport {
	localEntry: string
	upstreamEntry: string
	maxDepth: number
	scopes: AuditCategory[]
	diagnostics: string[]
	summary: CategorySummary & { categories: Record<AuditCategory, CategorySummary> }
	items: AuditItem[]
}

export interface AuditOptions {
	localEntry: string
	upstreamEntry: string
	maxDepth?: number
	scopes?: AuditCategory[]
	maxItems?: number
}

interface ExportInfo {
	name: string
	symbol: ts.Symbol
	type: ts.Type
	surfaceType: ts.Type
	location?: string
}

interface AuditContext {
	checker: ts.TypeChecker
	items: AuditItem[]
	maxDepth: number
	maxItems: number
	seenPaths: Set<string>
}

const ALL_SCOPES: AuditCategory[] = ['exports', 'functions', 'fields', 'events']
const TYPE_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
const SIGNATURE_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope

const toPercent = (matched: number, total: number) => (total === 0 ? 100 : Number(((matched / total) * 100).toFixed(2)))

const locationOf = (symbol: ts.Symbol | undefined): string | undefined => {
	const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
	if (!declaration) return undefined
	const source = declaration.getSourceFile()
	const position = source.getLineAndCharacterOfPosition(declaration.getStart(source, false))
	const path = relative(process.cwd(), source.fileName) || source.fileName
	return `${path}:${position.line + 1}:${position.character + 1}`
}

const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
	symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

const typeForSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol, fallback: ts.Node): ts.Type => {
	const target = resolveAlias(checker, symbol)
	if (target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeParameter)) {
		return checker.getDeclaredTypeOfSymbol(target)
	}

	const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? fallback
	return checker.getTypeOfSymbolAtLocation(target, declaration)
}

const valueTypeForSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined => {
	const target = resolveAlias(checker, symbol)
	const declaration = target.valueDeclaration
	return declaration ? checker.getTypeOfSymbolAtLocation(target, declaration) : undefined
}

const sourceModule = (program: ts.Program, checker: ts.TypeChecker, entry: string) => {
	const wanted = resolve(entry)
	const source = program.getSourceFiles().find(file => resolve(file.fileName) === wanted)
	if (!source) throw new Error(`TypeScript program did not load entry: ${wanted}`)
	const symbol = checker.getSymbolAtLocation(source)
	if (!symbol) throw new Error(`Entry is not an external module: ${wanted}`)
	return { source, symbol }
}

const exportsFor = (
	checker: ts.TypeChecker,
	source: ts.SourceFile,
	moduleSymbol: ts.Symbol
): Map<string, ExportInfo> => {
	const result = new Map<string, ExportInfo>()
	for (const exported of checker.getExportsOfModule(moduleSymbol)) {
		const target = resolveAlias(checker, exported)
		const type = typeForSymbol(checker, exported, source)
		result.set(exported.name, {
			name: exported.name,
			symbol: target,
			type,
			surfaceType: valueTypeForSymbol(checker, exported) ?? type,
			location: locationOf(target)
		})
	}
	return result
}

const typeText = (checker: ts.TypeChecker, type: ts.Type) => checker.typeToString(type, undefined, TYPE_FLAGS)

const signatureText = (checker: ts.TypeChecker, signature: ts.Signature, kind: ts.SignatureKind) =>
	checker.signatureToString(signature, undefined, SIGNATURE_FLAGS, kind)

const uniqueSignatures = (checker: ts.TypeChecker, type: ts.Type, kind: ts.SignatureKind) => {
	const seen = new Set<string>()
	return checker.getSignaturesOfType(type, kind).filter(signature => {
		const key = signatureText(checker, signature, kind)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

const isPublicProperty = (symbol: ts.Symbol) =>
	!(symbol.declarations ?? []).some(declaration => {
		const namedDeclaration = declaration as ts.NamedDeclaration
		if (namedDeclaration.name && ts.isPrivateIdentifier(namedDeclaration.name)) return true
		const modifiers = ts.getCombinedModifierFlags(declaration)
		return Boolean(modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
	})

const literalValue = (type: ts.Type): string | number | bigint | undefined =>
	(type as ts.LiteralType & { value?: string | number | bigint }).value

/**
 * TypeScript deliberately treats enums and classes originating in different
 * packages as nominal in a few places. A drop-in declaration audit instead
 * needs to compare their observable contracts. This fallback walks both
 * public shapes after the compiler's regular bidirectional assignability check
 * fails, while retaining optionality, union members, overloads and return
 * types. Optional local-only properties are accepted and reported separately
 * as extras by the surface walker.
 */
const semanticTypeMatch = (
	checker: ts.TypeChecker,
	expected: ts.Type,
	actual: ts.Type,
	depth = 0,
	seen = new Map<ts.Type, Set<ts.Type>>(),
	expectedReceiver?: ts.Type,
	actualReceiver?: ts.Type
): boolean => {
	if (expected === actual) return true
	if (depth > 8) return typeText(checker, expected) === typeText(checker, actual)

	let actuals = seen.get(expected)
	if (actuals?.has(actual)) return true
	if (!actuals) {
		actuals = new Set()
		seen.set(expected, actuals)
	}
	actuals.add(actual)

	if (expected.isUnion() || actual.isUnion()) {
		if (!expected.isUnion() || !actual.isUnion() || expected.types.length !== actual.types.length) return false
		const unmatched = new Set(actual.types.map((_, index) => index))
		for (const expectedPart of expected.types) {
			let match: number | undefined
			for (const index of unmatched) {
				if (semanticTypeMatch(checker, expectedPart, actual.types[index]!, depth + 1, seen)) {
					match = index
					break
				}
			}
			if (match === undefined) return false
			unmatched.delete(match)
		}
		return true
	}

	const expectedLiteral = literalValue(expected)
	const actualLiteral = literalValue(actual)
	if (expectedLiteral !== undefined || actualLiteral !== undefined) return Object.is(expectedLiteral, actualLiteral)

	const intrinsicMask =
		ts.TypeFlags.Any |
		ts.TypeFlags.Unknown |
		ts.TypeFlags.Never |
		ts.TypeFlags.String |
		ts.TypeFlags.Number |
		ts.TypeFlags.Boolean |
		ts.TypeFlags.BigInt |
		ts.TypeFlags.ESSymbol |
		ts.TypeFlags.Void |
		ts.TypeFlags.Undefined |
		ts.TypeFlags.Null
	const expectedIntrinsic = expected.flags & intrinsicMask
	const actualIntrinsic = actual.flags & intrinsicMask
	if (expectedIntrinsic || actualIntrinsic) return expectedIntrinsic === actualIntrinsic

	const expectedArray = checker.isArrayType(expected)
	const actualArray = checker.isArrayType(actual)
	if (expectedArray || actualArray) {
		if (!expectedArray || !actualArray) return false
		const expectedElement = checker.getTypeArguments(expected as ts.TypeReference)[0]
		const actualElement = checker.getTypeArguments(actual as ts.TypeReference)[0]
		return Boolean(
			expectedElement && actualElement && semanticTypeMatch(checker, expectedElement, actualElement, depth + 1, seen)
		)
	}

	const expectedTuple = checker.isTupleType(expected)
	const actualTuple = checker.isTupleType(actual)
	if (expectedTuple || actualTuple) {
		if (!expectedTuple || !actualTuple) return false
		const expectedElements = checker.getTypeArguments(expected as ts.TypeReference)
		const actualElements = checker.getTypeArguments(actual as ts.TypeReference)
		return (
			expectedElements.length === actualElements.length &&
			expectedElements.every((element, index) =>
				semanticTypeMatch(checker, element, actualElements[index]!, depth + 1, seen)
			)
		)
	}

	if (!isObjectLike(expected) || !isObjectLike(actual)) {
		return typeText(checker, expected) === typeText(checker, actual)
	}

	const signaturesMatch = (kind: ts.SignatureKind) => {
		const expectedSignatures = uniqueSignatures(checker, expected, kind)
		const actualSignatures = uniqueSignatures(checker, actual, kind)
		if (expectedSignatures.length !== actualSignatures.length) return false
		const unmatched = new Set(actualSignatures.map((_, index) => index))
		for (const expectedSignature of expectedSignatures) {
			let match: number | undefined
			for (const index of unmatched) {
				const actualSignature = actualSignatures[index]!
				const expectedParameters = expectedSignature.getParameters()
				const actualParameters = actualSignature.getParameters()
				if (expectedParameters.length !== actualParameters.length) continue
				const parametersMatch = expectedParameters.every((parameter, parameterIndex) => {
					const actualParameter = actualParameters[parameterIndex]!
					return (
						parameterOptional(parameter) === parameterOptional(actualParameter) &&
						isRestParameter(parameter) === isRestParameter(actualParameter) &&
						semanticTypeMatch(
							checker,
							propertyType(checker, parameter, expectedSignature.getReturnType()),
							propertyType(checker, actualParameter, actualSignature.getReturnType()),
							depth + 1,
							seen
						)
					)
				})
				const expectedReturn = checker.getReturnTypeOfSignature(expectedSignature)
				const actualReturn = checker.getReturnTypeOfSignature(actualSignature)
				const returnsReceiver = Boolean(
					expectedReceiver &&
					actualReceiver &&
					checker.isTypeAssignableTo(expectedReturn, expectedReceiver) &&
					checker.isTypeAssignableTo(expectedReceiver, expectedReturn) &&
					checker.isTypeAssignableTo(actualReturn, actualReceiver) &&
					checker.isTypeAssignableTo(actualReceiver, actualReturn)
				)
				if (
					parametersMatch &&
					(returnsReceiver || semanticTypeMatch(checker, expectedReturn, actualReturn, depth + 1, seen))
				) {
					match = index
					break
				}
			}
			if (match === undefined) return false
			unmatched.delete(match)
		}
		return true
	}

	if (!signaturesMatch(ts.SignatureKind.Call) || !signaturesMatch(ts.SignatureKind.Construct)) return false

	const expectedProperties = checker
		.getPropertiesOfType(expected)
		.filter(property => property.name !== 'prototype' && isPublicProperty(property))
	const actualProperties = new Map(
		checker
			.getPropertiesOfType(actual)
			.filter(property => property.name !== 'prototype' && isPublicProperty(property))
			.map(property => [property.name, property])
	)
	if (expectedProperties.length > 500 || actualProperties.size > 500) {
		return typeText(checker, expected) === typeText(checker, actual)
	}
	for (const expectedProperty of expectedProperties) {
		const actualProperty = actualProperties.get(expectedProperty.name)
		if (!actualProperty || optionalProperty(expectedProperty) !== optionalProperty(actualProperty)) return false
		if (
			!semanticTypeMatch(
				checker,
				propertyType(checker, expectedProperty, expected),
				propertyType(checker, actualProperty, actual),
				depth + 1,
				seen,
				expected,
				actual
			)
		) {
			return false
		}
		actualProperties.delete(expectedProperty.name)
	}

	// An optional extension cannot make a local value incompatible with an
	// upstream consumer; a required local-only property can.
	return [...actualProperties.values()].every(optionalProperty)
}

const exactTypeMatch = (
	checker: ts.TypeChecker,
	expected: ts.Type,
	actual: ts.Type,
	expectedReceiver?: ts.Type,
	actualReceiver?: ts.Type
) => {
	if (expected === actual) return true
	const expectedText = typeText(checker, expected)
	const actualText = typeText(checker, actual)
	if (expectedText === 'any' || actualText === 'any' || expectedText === 'unknown' || actualText === 'unknown')
		return false
	return (
		(checker.isTypeAssignableTo(actual, expected) && checker.isTypeAssignableTo(expected, actual)) ||
		semanticTypeMatch(checker, expected, actual, 0, new Map(), expectedReceiver, actualReceiver)
	)
}

const addItem = (ctx: AuditContext, item: AuditItem) => {
	if (ctx.items.length >= ctx.maxItems) return
	const key = `${item.category}\u0000${item.path}\u0000${item.status}`
	if (ctx.seenPaths.has(key)) return
	ctx.seenPaths.add(key)
	ctx.items.push(item)
}

const optionalProperty = (symbol: ts.Symbol) => Boolean(symbol.flags & ts.SymbolFlags.Optional)

const propertyType = (checker: ts.TypeChecker, property: ts.Symbol, owner: ts.Type) => {
	const declaration = property.valueDeclaration ?? property.declarations?.[0]
	const ownerDeclaration = owner.symbol?.valueDeclaration ?? owner.symbol?.declarations?.[0]
	return declaration || ownerDeclaration
		? checker.getTypeOfSymbolAtLocation(property, declaration ?? ownerDeclaration!)
		: checker.getTypeOfSymbol(property)
}

const isRestParameter = (symbol: ts.Symbol) =>
	Boolean(symbol.valueDeclaration && ts.isParameter(symbol.valueDeclaration) && symbol.valueDeclaration.dotDotDotToken)

const parameterOptional = (symbol: ts.Symbol) =>
	Boolean(symbol.flags & ts.SymbolFlags.Optional) ||
	Boolean(
		symbol.valueDeclaration &&
		ts.isParameter(symbol.valueDeclaration) &&
		(symbol.valueDeclaration.questionToken || symbol.valueDeclaration.initializer)
	)

const signatureIssues = (
	checker: ts.TypeChecker,
	expected: ts.Signature,
	actual: ts.Signature,
	expectedReceiver?: ts.Type,
	actualReceiver?: ts.Type
): string[] => {
	const issues: string[] = []
	const expectedTypeParameters = expected.typeParameters ?? []
	const actualTypeParameters = actual.typeParameters ?? []
	if (expectedTypeParameters.length !== actualTypeParameters.length) {
		issues.push(`type parameters ${actualTypeParameters.length} != ${expectedTypeParameters.length}`)
	}

	const expectedParameters = expected.getParameters()
	const actualParameters = actual.getParameters()
	if (expectedParameters.length !== actualParameters.length) {
		issues.push(`parameters ${actualParameters.length} != ${expectedParameters.length}`)
	}

	const count = Math.min(expectedParameters.length, actualParameters.length)
	for (let index = 0; index < count; index++) {
		const upstreamParameter = expectedParameters[index]!
		const localParameter = actualParameters[index]!
		if (upstreamParameter.name !== localParameter.name) {
			issues.push(`parameter ${index + 1} name ${localParameter.name} != ${upstreamParameter.name}`)
		}
		if (parameterOptional(upstreamParameter) !== parameterOptional(localParameter)) {
			issues.push(`parameter ${upstreamParameter.name} optionality differs`)
		}
		if (isRestParameter(upstreamParameter) !== isRestParameter(localParameter)) {
			issues.push(`parameter ${upstreamParameter.name} rest marker differs`)
		}

		const expectedType = propertyType(checker, upstreamParameter, expected.getReturnType())
		const actualType = propertyType(checker, localParameter, actual.getReturnType())
		// A drop-in accepts every upstream argument; exact mode also prevents a
		// silent widening that would hide mismatched public declarations.
		if (!exactTypeMatch(checker, expectedType, actualType)) {
			issues.push(
				`parameter ${upstreamParameter.name} type ${typeText(checker, actualType)} != ${typeText(checker, expectedType)}`
			)
		}
	}

	const expectedReturn = checker.getReturnTypeOfSignature(expected)
	const actualReturn = checker.getReturnTypeOfSignature(actual)
	const returnsReceiver = Boolean(
		expectedReceiver &&
		actualReceiver &&
		checker.isTypeAssignableTo(expectedReturn, expectedReceiver) &&
		checker.isTypeAssignableTo(expectedReceiver, expectedReturn) &&
		checker.isTypeAssignableTo(actualReturn, actualReceiver) &&
		checker.isTypeAssignableTo(actualReceiver, actualReturn)
	)
	if (!returnsReceiver && !exactTypeMatch(checker, expectedReturn, actualReturn)) {
		issues.push(`return ${typeText(checker, actualReturn)} != ${typeText(checker, expectedReturn)}`)
	}
	return issues
}

const compareSignatureKind = (
	ctx: AuditContext,
	path: string,
	expectedType: ts.Type,
	actualType: ts.Type | undefined,
	kind: ts.SignatureKind,
	upstreamLocation?: string,
	localLocation?: string,
	expectedReceiver?: ts.Type,
	actualReceiver?: ts.Type
) => {
	const expectedSignatures = uniqueSignatures(ctx.checker, expectedType, kind)
	if (expectedSignatures.length === 0) return
	if (!actualType) {
		addItem(ctx, {
			category: 'functions',
			path,
			status: 'missing',
			expected: expectedSignatures.map(signature => signatureText(ctx.checker, signature, kind)).join(' | '),
			upstreamLocation
		})
		return
	}

	const actualSignatures = uniqueSignatures(ctx.checker, actualType, kind)
	if (actualSignatures.length === 0) {
		addItem(ctx, {
			category: 'functions',
			path,
			status: 'mismatch',
			expected: expectedSignatures.map(signature => signatureText(ctx.checker, signature, kind)).join(' | '),
			actual: typeText(ctx.checker, actualType),
			detail: kind === ts.SignatureKind.Call ? 'local symbol is not callable' : 'local symbol is not constructable',
			upstreamLocation,
			localLocation
		})
		return
	}

	const remaining = new Set(actualSignatures.map((_, index) => index))
	const unmatched: string[] = []
	for (const expected of expectedSignatures) {
		let bestIndex: number | undefined
		let bestIssues: string[] | undefined
		for (const index of remaining) {
			const issues = signatureIssues(ctx.checker, expected, actualSignatures[index]!, expectedReceiver, actualReceiver)
			if (!bestIssues || issues.length < bestIssues.length) {
				bestIssues = issues
				bestIndex = index
			}
			if (issues.length === 0) break
		}

		if (bestIndex === undefined || (bestIssues?.length ?? 0) > 0) {
			unmatched.push(...(bestIssues ?? ['no local overload']))
		} else {
			remaining.delete(bestIndex)
		}
	}

	if (unmatched.length === 0 && remaining.size === 0) {
		addItem(ctx, { category: 'functions', path, status: 'matched', upstreamLocation, localLocation })
	} else {
		addItem(ctx, {
			category: 'functions',
			path,
			status: 'mismatch',
			expected: expectedSignatures.map(signature => signatureText(ctx.checker, signature, kind)).join(' | '),
			actual: actualSignatures.map(signature => signatureText(ctx.checker, signature, kind)).join(' | '),
			detail: [...new Set(unmatched)].join('; ') || `${remaining.size} extra local overload(s)`,
			upstreamLocation,
			localLocation
		})
	}
}

const compareCallable = (
	ctx: AuditContext,
	path: string,
	expectedType: ts.Type,
	actualType: ts.Type | undefined,
	upstreamLocation?: string,
	localLocation?: string,
	expectedReceiver?: ts.Type,
	actualReceiver?: ts.Type
) => {
	compareSignatureKind(
		ctx,
		path,
		expectedType,
		actualType,
		ts.SignatureKind.Call,
		upstreamLocation,
		localLocation,
		expectedReceiver,
		actualReceiver
	)
	compareSignatureKind(
		ctx,
		`new ${path}`,
		expectedType,
		actualType,
		ts.SignatureKind.Construct,
		upstreamLocation,
		localLocation,
		expectedReceiver,
		actualReceiver
	)
}

const isObjectLike = (type: ts.Type) => Boolean(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))

const opaqueType = (checker: ts.TypeChecker, type: ts.Type) => {
	const text = typeText(checker, type)
	return (
		text === 'string' ||
		text === 'number' ||
		text === 'boolean' ||
		text === 'Date' ||
		text.startsWith('Promise<') ||
		text.startsWith('Map<') ||
		text.startsWith('Set<') ||
		text === 'Buffer' ||
		text.startsWith('Buffer<') ||
		text === 'Uint8Array' ||
		text.startsWith('Uint8Array<') ||
		checker.isArrayType(type) ||
		checker.isTupleType(type)
	)
}

const compareObjectSurface = (
	ctx: AuditContext,
	path: string,
	expectedType: ts.Type,
	actualType: ts.Type | undefined,
	depth: number
) => {
	if (depth > ctx.maxDepth || !isObjectLike(expectedType) || opaqueType(ctx.checker, expectedType)) return
	const expectedProperties = ctx.checker
		.getPropertiesOfType(expectedType)
		.filter(property => property.name !== 'prototype' && isPublicProperty(property))
	if (expectedProperties.length > 500) return
	const actualProperties = actualType
		? new Map(
				ctx.checker
					.getPropertiesOfType(actualType)
					.filter(isPublicProperty)
					.map(property => [property.name, property])
			)
		: new Map()

	for (const expectedProperty of expectedProperties) {
		const propertyPath = `${path}.${expectedProperty.name}`
		const expectedPropertyType = propertyType(ctx.checker, expectedProperty, expectedType)
		const actualProperty = actualProperties.get(expectedProperty.name)
		if (!actualProperty || !actualType) {
			addItem(ctx, {
				category: 'fields',
				path: propertyPath,
				status: 'missing',
				expected: typeText(ctx.checker, expectedPropertyType),
				upstreamLocation: locationOf(expectedProperty)
			})
			compareCallable(ctx, propertyPath, expectedPropertyType, undefined, locationOf(expectedProperty))
			continue
		}

		const actualPropertyType = propertyType(ctx.checker, actualProperty, actualType)
		const optionalMismatch = optionalProperty(expectedProperty) !== optionalProperty(actualProperty)
		const typeMismatch = !exactTypeMatch(
			ctx.checker,
			expectedPropertyType,
			actualPropertyType,
			expectedType,
			actualType
		)
		addItem(ctx, {
			category: 'fields',
			path: propertyPath,
			status: optionalMismatch || typeMismatch ? 'mismatch' : 'matched',
			expected: optionalMismatch || typeMismatch ? typeText(ctx.checker, expectedPropertyType) : undefined,
			actual: optionalMismatch || typeMismatch ? typeText(ctx.checker, actualPropertyType) : undefined,
			detail: optionalMismatch ? 'required/optional modifier differs' : undefined,
			upstreamLocation: locationOf(expectedProperty),
			localLocation: locationOf(actualProperty)
		})

		compareCallable(
			ctx,
			propertyPath,
			expectedPropertyType,
			actualPropertyType,
			locationOf(expectedProperty),
			locationOf(actualProperty),
			expectedType,
			actualType
		)

		if (
			depth < ctx.maxDepth &&
			ctx.checker.getSignaturesOfType(expectedPropertyType, ts.SignatureKind.Call).length === 0 &&
			isObjectLike(expectedPropertyType) &&
			!opaqueType(ctx.checker, expectedPropertyType)
		) {
			compareObjectSurface(ctx, propertyPath, expectedPropertyType, actualPropertyType, depth + 1)
		}
	}

	if (actualType) {
		const expectedNames = new Set(expectedProperties.map(property => property.name))
		for (const actualProperty of ctx.checker.getPropertiesOfType(actualType).filter(isPublicProperty)) {
			if (actualProperty.name === 'prototype' || expectedNames.has(actualProperty.name)) continue
			addItem(ctx, {
				category: 'fields',
				path: `${path}.${actualProperty.name}`,
				status: 'extra',
				actual: typeText(ctx.checker, propertyType(ctx.checker, actualProperty, actualType)),
				localLocation: locationOf(actualProperty)
			})
		}
	}
}

const surfaceType = (checker: ts.TypeChecker, type: ts.Type) => {
	const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call)
	if (signatures.length === 0) return type
	const returned = checker.getReturnTypeOfSignature(signatures[0]!)
	return opaqueType(checker, returned) ? undefined : returned
}

const arrayElementType = (checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined => {
	if (!checker.isArrayType(type) && !checker.isTupleType(type)) return undefined
	if (checker.isTupleType(type)) {
		const elements = checker.getTypeArguments(type as ts.TypeReference)
		return elements.length === 1 ? elements[0] : undefined
	}
	return checker.getTypeArguments(type as ts.TypeReference)[0]
}

const nonNullishUnionMember = (type: ts.Type): ts.Type | undefined => {
	if (!type.isUnion()) return undefined
	const members = type.types.filter(member => !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)))
	return members.length === 1 ? members[0] : undefined
}

const compareEventPayload = (
	ctx: AuditContext,
	path: string,
	expectedType: ts.Type,
	actualType: ts.Type,
	depth: number
) => {
	if (depth >= ctx.maxDepth) return
	const expectedNonNullish = nonNullishUnionMember(expectedType)
	const actualNonNullish = nonNullishUnionMember(actualType)
	if (expectedNonNullish || actualNonNullish) {
		if (expectedNonNullish && actualNonNullish) {
			compareEventPayload(ctx, path, expectedNonNullish, actualNonNullish, depth + 1)
		}
		return
	}
	const expectedElement = arrayElementType(ctx.checker, expectedType)
	const actualElement = arrayElementType(ctx.checker, actualType)
	if (expectedElement) {
		const elementPath = `${path}[]`
		if (!actualElement) {
			addItem(ctx, {
				category: 'events',
				path: elementPath,
				status: 'mismatch',
				expected: typeText(ctx.checker, expectedElement),
				actual: typeText(ctx.checker, actualType),
				detail: 'upstream payload is an array/tuple'
			})
			return
		}
		addItem(ctx, {
			category: 'events',
			path: elementPath,
			status: exactTypeMatch(ctx.checker, expectedElement, actualElement) ? 'matched' : 'mismatch',
			expected: exactTypeMatch(ctx.checker, expectedElement, actualElement)
				? undefined
				: typeText(ctx.checker, expectedElement),
			actual: exactTypeMatch(ctx.checker, expectedElement, actualElement)
				? undefined
				: typeText(ctx.checker, actualElement)
		})
		compareEventPayload(ctx, elementPath, expectedElement, actualElement, depth + 1)
		return
	}

	if (!isObjectLike(expectedType) || !isObjectLike(actualType) || expectedType.isUnion() || actualType.isUnion()) return
	const expectedProperties = ctx.checker.getPropertiesOfType(expectedType)
	if (expectedProperties.length > 300) return
	const actualProperties = new Map(
		ctx.checker.getPropertiesOfType(actualType).map(property => [property.name, property])
	)
	for (const expectedProperty of expectedProperties) {
		const propertyPath = `${path}.${expectedProperty.name}`
		const expectedPropertyType = propertyType(ctx.checker, expectedProperty, expectedType)
		const actualProperty = actualProperties.get(expectedProperty.name)
		if (!actualProperty) {
			addItem(ctx, {
				category: 'events',
				path: propertyPath,
				status: 'missing',
				expected: typeText(ctx.checker, expectedPropertyType),
				upstreamLocation: locationOf(expectedProperty)
			})
			continue
		}
		const actualPropertyType = propertyType(ctx.checker, actualProperty, actualType)
		const mismatch =
			optionalProperty(expectedProperty) !== optionalProperty(actualProperty) ||
			!exactTypeMatch(ctx.checker, expectedPropertyType, actualPropertyType)
		addItem(ctx, {
			category: 'events',
			path: propertyPath,
			status: mismatch ? 'mismatch' : 'matched',
			expected: mismatch ? typeText(ctx.checker, expectedPropertyType) : undefined,
			actual: mismatch ? typeText(ctx.checker, actualPropertyType) : undefined,
			detail:
				optionalProperty(expectedProperty) !== optionalProperty(actualProperty)
					? 'required/optional modifier differs'
					: undefined,
			upstreamLocation: locationOf(expectedProperty),
			localLocation: locationOf(actualProperty)
		})
		compareEventPayload(ctx, propertyPath, expectedPropertyType, actualPropertyType, depth + 1)
	}

	const expectedNames = new Set(expectedProperties.map(property => property.name))
	for (const actualProperty of ctx.checker.getPropertiesOfType(actualType)) {
		if (expectedNames.has(actualProperty.name)) continue
		addItem(ctx, {
			category: 'events',
			path: `${path}.${actualProperty.name}`,
			status: 'extra',
			actual: typeText(ctx.checker, propertyType(ctx.checker, actualProperty, actualType)),
			localLocation: locationOf(actualProperty)
		})
	}
}

const compareEvents = (ctx: AuditContext, upstream: ExportInfo | undefined, local: ExportInfo | undefined) => {
	if (!upstream) return
	const expectedEvents = ctx.checker.getPropertiesOfType(upstream.type)
	const actualEvents = local
		? new Map(ctx.checker.getPropertiesOfType(local.type).map(event => [event.name, event]))
		: new Map()
	for (const expectedEvent of expectedEvents) {
		const path = `BaileysEventMap[${JSON.stringify(expectedEvent.name)}]`
		const expectedType = propertyType(ctx.checker, expectedEvent, upstream.type)
		const actualEvent = actualEvents.get(expectedEvent.name)
		if (!actualEvent || !local) {
			addItem(ctx, {
				category: 'events',
				path,
				status: 'missing',
				expected: typeText(ctx.checker, expectedType),
				upstreamLocation: locationOf(expectedEvent)
			})
			continue
		}
		const actualType = propertyType(ctx.checker, actualEvent, local.type)
		const mismatch = !exactTypeMatch(ctx.checker, expectedType, actualType)
		addItem(ctx, {
			category: 'events',
			path,
			status: mismatch ? 'mismatch' : 'matched',
			expected: mismatch ? typeText(ctx.checker, expectedType) : undefined,
			actual: mismatch ? typeText(ctx.checker, actualType) : undefined,
			upstreamLocation: locationOf(expectedEvent),
			localLocation: locationOf(actualEvent)
		})
		compareEventPayload(ctx, path, expectedType, actualType, 0)
	}

	if (local) {
		const expectedNames = new Set(expectedEvents.map(event => event.name))
		for (const actualEvent of ctx.checker.getPropertiesOfType(local.type)) {
			if (expectedNames.has(actualEvent.name)) continue
			addItem(ctx, {
				category: 'events',
				path: `BaileysEventMap[${JSON.stringify(actualEvent.name)}]`,
				status: 'extra',
				actual: typeText(ctx.checker, propertyType(ctx.checker, actualEvent, local.type)),
				localLocation: locationOf(actualEvent)
			})
		}
	}
}

const summarize = (items: AuditItem[]): CategorySummary => {
	const matched = items.filter(item => item.status === 'matched').length
	const missing = items.filter(item => item.status === 'missing').length
	const mismatched = items.filter(item => item.status === 'mismatch').length
	const extra = items.filter(item => item.status === 'extra').length
	const total = matched + missing + mismatched
	return { matched, missing, mismatched, extra, total, coverage: toPercent(matched, total) }
}

export const runCompatibilityAudit = (options: AuditOptions): CompatibilityReport => {
	const localEntry = resolve(options.localEntry)
	const upstreamEntry = resolve(options.upstreamEntry)
	const maxDepth = Math.max(0, options.maxDepth ?? 3)
	const scopes = options.scopes?.length ? [...new Set(options.scopes)] : ALL_SCOPES
	const program = ts.createProgram({
		rootNames: [localEntry, upstreamEntry],
		options: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			strict: true,
			skipLibCheck: true,
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
			resolveJsonModule: true,
			types: ['node']
		}
	})
	const checker = program.getTypeChecker()
	const upstreamModule = sourceModule(program, checker, upstreamEntry)
	const localModule = sourceModule(program, checker, localEntry)
	const upstreamExports = exportsFor(checker, upstreamModule.source, upstreamModule.symbol)
	const localExports = exportsFor(checker, localModule.source, localModule.symbol)
	const ctx: AuditContext = {
		checker,
		items: [],
		maxDepth,
		maxItems: options.maxItems ?? 50_000,
		seenPaths: new Set()
	}

	if (scopes.includes('exports')) {
		for (const [name, expected] of upstreamExports) {
			const actual = localExports.get(name)
			addItem(ctx, {
				category: 'exports',
				path: name,
				status: actual ? 'matched' : 'missing',
				expected: actual ? undefined : typeText(checker, expected.type),
				upstreamLocation: expected.location,
				localLocation: actual?.location
			})
		}
		for (const [name, actual] of localExports) {
			if (upstreamExports.has(name)) continue
			addItem(ctx, {
				category: 'exports',
				path: name,
				status: 'extra',
				actual: typeText(checker, actual.type),
				localLocation: actual.location
			})
		}
	}

	if (scopes.includes('functions') || scopes.includes('fields')) {
		for (const [name, expected] of upstreamExports) {
			if (name === 'BaileysEventMap') continue
			const actual = localExports.get(name)
			if (scopes.includes('functions')) {
				compareCallable(ctx, name, expected.surfaceType, actual?.surfaceType, expected.location, actual?.location)
			}

			if (scopes.includes('fields') && actual) {
				const expectedSurface = surfaceType(checker, expected.surfaceType)
				const actualSurface = surfaceType(checker, actual.surfaceType)
				if (expectedSurface) {
					compareObjectSurface(
						ctx,
						checker.getSignaturesOfType(expected.surfaceType, ts.SignatureKind.Call).length ? `${name}()` : name,
						expectedSurface,
						actualSurface,
						0
					)
				}
			}
		}
	}

	if (scopes.includes('events')) {
		compareEvents(ctx, upstreamExports.get('BaileysEventMap'), localExports.get('BaileysEventMap'))
	}

	const diagnostics = ts
		.getPreEmitDiagnostics(program)
		.slice(0, 50)
		.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
	const categories = Object.fromEntries(
		ALL_SCOPES.map(category => [category, summarize(ctx.items.filter(item => item.category === category))])
	) as Record<AuditCategory, CategorySummary>
	const summary = { ...summarize(ctx.items), categories }

	return {
		localEntry,
		upstreamEntry,
		maxDepth,
		scopes,
		diagnostics,
		summary,
		items: ctx.items.toSorted(
			(left, right) =>
				ALL_SCOPES.indexOf(left.category) - ALL_SCOPES.indexOf(right.category) ||
				left.path.localeCompare(right.path) ||
				left.status.localeCompare(right.status)
		)
	}
}

export const strictAuditFailed = (report: CompatibilityReport) =>
	report.diagnostics.length > 0 || report.items.some(item => item.status === 'missing' || item.status === 'mismatch')

const renderSummaryTable = (report: CompatibilityReport) => {
	const rows = report.scopes.map(category => {
		const value = report.summary.categories[category]
		return [
			category,
			`${value.coverage.toFixed(2)}%`,
			String(value.matched),
			String(value.total),
			String(value.missing),
			String(value.mismatched),
			String(value.extra)
		]
	})
	const headers = ['category', 'coverage', 'matched', 'upstream', 'missing', 'mismatch', 'extra']
	const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => row[index]!.length)))
	const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ')
	return [line(headers), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

export interface RenderOptions {
	format?: 'table' | 'markdown' | 'json'
	details?: boolean
	onlyMissing?: boolean
	showExtra?: boolean
}

const selectedItems = (report: CompatibilityReport, options: RenderOptions) => {
	if (options.onlyMissing) {
		return report.items.filter(item => item.status === 'missing' || item.status === 'mismatch')
	}
	if (options.format === 'json') return report.items
	if (!options.details) return []
	return report.items.filter(item => item.status !== 'matched' && (options.showExtra || item.status !== 'extra'))
}

export const renderCompatibilityReport = (report: CompatibilityReport, options: RenderOptions = {}) => {
	const format = options.format ?? 'table'
	const items = selectedItems(report, options)
	if (format === 'json') return JSON.stringify({ ...report, items }, null, 2)

	if (format === 'markdown') {
		const lines = [
			'# Baileyrs compatibility audit',
			'',
			`- Overall coverage: **${report.summary.coverage.toFixed(2)}%** (${report.summary.matched}/${report.summary.total})`,
			`- Local: \`${report.localEntry}\``,
			`- Upstream: \`${report.upstreamEntry}\``,
			'',
			'| Category | Coverage | Matched | Upstream | Missing | Mismatch | Extra |',
			'|---|---:|---:|---:|---:|---:|---:|',
			...report.scopes.map(category => {
				const value = report.summary.categories[category]
				return `| ${category} | ${value.coverage.toFixed(2)}% | ${value.matched} | ${value.total} | ${value.missing} | ${value.mismatched} | ${value.extra} |`
			})
		]
		if (items.length) {
			lines.push('', '## Gaps', '')
			for (const item of items) {
				const location = item.upstreamLocation ? ` — upstream: \`${item.upstreamLocation}\`` : ''
				lines.push(`- **${item.status}** \`${item.category}:${item.path}\`${location}`)
				if (item.detail) lines.push(`  - ${item.detail}`)
				if (item.expected) lines.push(`  - expected: \`${item.expected.replaceAll('`', '\\`')}\``)
				if (item.actual) lines.push(`  - actual: \`${item.actual.replaceAll('`', '\\`')}\``)
			}
		}
		return lines.join('\n')
	}

	const lines = [
		`Baileyrs compatibility: ${report.summary.coverage.toFixed(2)}% (${report.summary.matched}/${report.summary.total})`,
		`local:    ${report.localEntry}`,
		`upstream: ${report.upstreamEntry}`,
		'',
		renderSummaryTable(report)
	]
	if (items.length) {
		lines.push('', 'gaps:')
		for (const item of items) {
			lines.push(`- [${item.status}] ${item.category}:${item.path}`)
			if (item.detail) lines.push(`  ${item.detail}`)
			if (item.expected) lines.push(`  expected: ${item.expected}`)
			if (item.actual) lines.push(`  actual:   ${item.actual}`)
			if (item.upstreamLocation) lines.push(`  upstream: ${item.upstreamLocation}`)
			if (item.localLocation) lines.push(`  local:    ${item.localLocation}`)
		}
	}
	return lines.join('\n')
}
