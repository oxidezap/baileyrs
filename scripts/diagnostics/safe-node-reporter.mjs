// Preserve pass/fail outcomes without allowing assertion payloads into public diagnostic logs.
export default async function* reporter(source) {
	for await (const event of source) {
		if (['test:pass', 'test:fail'].includes(event.type)) {
			const message = String(event.data.details?.error?.cause?.message ?? event.data.details?.error?.message ?? '')
			yield (
				JSON.stringify({
					event: event.type,
					number: event.data.testNumber,
					nesting: event.data.nesting,
					category: message.includes('Timed out waiting for messages.upsert match')
						? 'delivery-timeout'
						: message.includes('device list account identity unavailable')
							? 'adv-identity-unavailable'
							: event.type === 'test:fail'
								? 'other-failure'
								: 'pass'
				}) + '\n'
			)
		}
		if (event.type === 'test:summary')
			yield (
				JSON.stringify({
					event: event.type,
					counts: Object.fromEntries(
						Object.entries(event.data.counts ?? {}).filter(([, value]) => typeof value === 'number')
					)
				}) + '\n'
			)
	}
}
