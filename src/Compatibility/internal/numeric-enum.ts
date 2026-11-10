type NumericEnumMembers = Readonly<Record<string, number>>

/**
 * Build the same forward and reverse runtime lookup exposed by a numeric
 * TypeScript enum while keeping the source directly executable by Node.
 */
export const makeNumericEnum = <const T extends NumericEnumMembers>(
	members: T
): Readonly<T & Record<number, string>> => {
	const output: Record<string | number, string | number> = { ...members }
	for (const [name, value] of Object.entries(members)) output[value] = name
	return Object.freeze(output) as Readonly<T & Record<number, string>>
}
