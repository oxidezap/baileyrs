import { registerHooks } from 'node:module'
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'fs-native-extensions') throw new Error('TEST_NATIVE_LOCK_LOAD_DENIED')
		return nextResolve(specifier, context)
	}
})
