import type { WABrowserDescription } from '../Types/index.ts'
import { makeNumericEnum } from '../Compatibility/internal/numeric-enum.ts'
import type { CompanionWebClientType as CompanionWebClientTypeType } from '../Compatibility/public-api/enum-types.ts'

const CompanionWebClientTypeValues = {
	UNKNOWN: 0,
	CHROME: 1,
	EDGE: 2,
	FIREFOX: 3,
	IE: 4,
	OPERA: 5,
	SAFARI: 6,
	ELECTRON: 7,
	UWP: 8,
	OTHER_WEB_CLIENT: 9
} as const
export const CompanionWebClientType = makeNumericEnum(
	CompanionWebClientTypeValues
) as unknown as typeof CompanionWebClientTypeType
export type CompanionWebClientType = CompanionWebClientTypeType

const BROWSER_TO_COMPANION_WEB_CLIENT: Record<string, CompanionWebClientType> = {
	Chrome: CompanionWebClientType.CHROME,
	Edge: CompanionWebClientType.EDGE,
	Firefox: CompanionWebClientType.FIREFOX,
	IE: CompanionWebClientType.IE,
	Opera: CompanionWebClientType.OPERA,
	Safari: CompanionWebClientType.SAFARI
}

export const getCompanionWebClientType = ([os, browserName]: WABrowserDescription): CompanionWebClientType => {
	if (browserName === 'Desktop') {
		return os === 'Windows' ? CompanionWebClientType.UWP : CompanionWebClientType.ELECTRON
	}
	return BROWSER_TO_COMPANION_WEB_CLIENT[browserName] || CompanionWebClientType.OTHER_WEB_CLIENT
}

export const getCompanionPlatformId = (browser: WABrowserDescription): string =>
	getCompanionWebClientType(browser).toString()

export const buildPairingQRData = (
	ref: string,
	noiseKeyB64: string,
	identityKeyB64: string,
	advB64: string,
	browser: WABrowserDescription
): string =>
	'https://wa.me/settings/linked_devices#' +
	[ref, noiseKeyB64, identityKeyB64, advB64, getCompanionPlatformId(browser)].join(',')
