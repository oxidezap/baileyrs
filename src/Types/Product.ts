import type { CatalogResult as CatalogPageResult, CollectionsResult } from '@oxidezap/whatsapp-rust-bridge'

import type { WAMediaUpload } from './Message.ts'

/**
 * What `getCatalog` returns, under a name of its own. The `CatalogResult`
 * below is the raw catalog envelope and is a different shape, so a consumer
 * typing the call has one name to reach for and it is this one.
 */
export type CatalogPage = CatalogPageResult

/** As `CatalogPage`, for `getCollections`. */
export type CollectionsPage = CollectionsResult

export type CatalogResult = {
	data: {
		paging: { cursors: { before: string; after: string } }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data: any[]
	}
}

export type ProductCreateResult = { data: { product: {} } }

export type CatalogStatus = { status: string; canAppeal: boolean }

export type CatalogCollection = {
	id: string
	name: string
	products: Product[]
	status: CatalogStatus
}

export type ProductAvailability = 'in stock'

export type ProductBase = {
	name: string
	retailerId?: string
	url?: string
	description: string
	price: number
	currency: string
	isHidden?: boolean
}

export type ProductCreate = ProductBase & {
	originCountryCode: string | undefined
	images: WAMediaUpload[]
}

export type ProductUpdate = Omit<ProductCreate, 'originCountryCode'>

export type Product = ProductBase & {
	id: string
	imageUrls: { [key: string]: string }
	reviewStatus: { [key: string]: string }
	availability: ProductAvailability
}

export type OrderPrice = { currency: string; total: number }

export type OrderProduct = {
	id: string
	imageUrl: string
	name: string
	quantity: number
	currency: string
	price: number
}

export type OrderDetails = { price: OrderPrice; products: OrderProduct[] }

export type CatalogCursor = string

export type GetCatalogOptions = {
	cursor?: CatalogCursor
	limit?: number
	jid?: string
}
