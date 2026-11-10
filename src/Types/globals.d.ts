// oxlint-disable-next-line require-module-specifiers -- empty export is required to mark this .d.ts as a module so `declare global` augments correctly
export {}

declare global {
	interface RequestInit {
		dispatcher?: unknown
		duplex?: 'half' | 'full'
	}
}
