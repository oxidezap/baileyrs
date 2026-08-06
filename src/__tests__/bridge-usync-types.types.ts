import type {
	UsyncOutcome,
	UsyncProtocolResult,
	UsyncQuery,
	UsyncResponse,
	UsyncUser,
	WasmWhatsAppClient
} from '@oxidezap/whatsapp-rust-bridge'
import type { TypedUSyncQuery } from '../Compatibility/usync/adapter.ts'

type Assert<Condition extends true> = Condition
type Exact<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false

type TypedMethodExact = Assert<Exact<WasmWhatsAppClient['queryUsync'], (query: UsyncQuery) => Promise<UsyncResponse>>>
type AdapterUsesGeneratedMethodExact = Assert<Exact<TypedUSyncQuery, WasmWhatsAppClient['queryUsync']>>
type BinaryTokenExact = Assert<Exact<NonNullable<UsyncUser['tc_token']>, Uint8Array>>
type GenericOutcomePreserved = Assert<Exact<Extract<UsyncOutcome<string>, { type: 'value' }>['data'], string>>
type LargePictureIdPreserved = Assert<
	Exact<Extract<UsyncProtocolResult, { type: 'picture' }>['data'], UsyncOutcome<number | string>>
>

export type BridgeUSyncTypeAssertions = [
	TypedMethodExact,
	AdapterUsesGeneratedMethodExact,
	BinaryTokenExact,
	GenericOutcomePreserved,
	LargePictureIdPreserved
]
