# Changelog

## [0.2.9](https://github.com/oxidezap/baileyrs/compare/v0.2.8...v0.2.9) (2026-08-24)


### Bug Fixes

* **legacy-store:** keep the native mirror valid across a store round trip ([#86](https://github.com/oxidezap/baileyrs/issues/86)) ([e966155](https://github.com/oxidezap/baileyrs/commit/e966155afd2a8d94a9ef246506cfe79844fa934b))
* **messages:** give a poll and an event the message secret their sender needs ([#92](https://github.com/oxidezap/baileyrs/issues/92)) ([503c49b](https://github.com/oxidezap/baileyrs/commit/503c49bde342d0919d8a834380201429cec934be))
* **messages:** re-encode a hosted jid the way upstream does, and keep the key shape WhatsApp Web uses ([#89](https://github.com/oxidezap/baileyrs/issues/89)) ([30e0a90](https://github.com/oxidezap/baileyrs/commit/30e0a90d7a4ece8aaa7b84b6cc077704e8a68991))

## [0.2.8](https://github.com/oxidezap/baileyrs/compare/v0.2.7...v0.2.8) (2026-08-22)


### Performance

* **core:** optimize jid normalization, content type detection and the CB attr walk ([#82](https://github.com/oxidezap/baileyrs/issues/82)) ([3571cc1](https://github.com/oxidezap/baileyrs/commit/3571cc175fa5362ae6932a3928fee3d045601edb))


### Dependencies

* move to bridge 0.18.0 ([#84](https://github.com/oxidezap/baileyrs/issues/84)) ([b93d254](https://github.com/oxidezap/baileyrs/commit/b93d254c80686565fbe3f6f11545bd43a21476d3))

## [0.2.7](https://github.com/oxidezap/baileyrs/compare/v0.2.6...v0.2.7) (2026-08-21)


### Dependencies

* move to bridge 0.17.0 ([#80](https://github.com/oxidezap/baileyrs/issues/80)) ([fafc395](https://github.com/oxidezap/baileyrs/commit/fafc395a8a38350cc0572577fd9b1d5bb370761b))

## [0.2.6](https://github.com/oxidezap/baileyrs/compare/v0.2.5...v0.2.6) (2026-08-19)


### Features

* **socket:** warn once about config options nothing here reads ([#78](https://github.com/oxidezap/baileyrs/issues/78)) ([6101010](https://github.com/oxidezap/baileyrs/commit/6101010260806b47d9c4dea57e7c669e2d08572a))


### Bug Fixes

* **events:** a 429 stream error is a rejected session, not a preserved connection ([#77](https://github.com/oxidezap/baileyrs/issues/77)) ([742edf4](https://github.com/oxidezap/baileyrs/commit/742edf46a760ca187cc875ab50298457cf7d0a68))

## [0.2.5](https://github.com/oxidezap/baileyrs/compare/v0.2.4...v0.2.5) (2026-08-19)


### Dependencies

* move to bridge 0.16.0 ([#75](https://github.com/oxidezap/baileyrs/issues/75)) ([7e4bf8f](https://github.com/oxidezap/baileyrs/commit/7e4bf8fa745a295c77862e599d7e0a90a6bcd061))

## [0.2.4](https://github.com/oxidezap/baileyrs/compare/v0.2.3...v0.2.4) (2026-08-18)


### Bug Fixes

* **messages:** honour the caller's messageId on an edit ([#71](https://github.com/oxidezap/baileyrs/issues/71)) ([230a4bd](https://github.com/oxidezap/baileyrs/commit/230a4bdde700277c996e393b6416df72adceb05c))
* **messages:** honour the caller's messageId on sendMessage ([#72](https://github.com/oxidezap/baileyrs/issues/72)) ([3d61fa0](https://github.com/oxidezap/baileyrs/commit/3d61fa09ea5fb32e3a6bda8749088782dcfc23f0))


### Dependencies

* move to bridge 0.15.0 ([#74](https://github.com/oxidezap/baileyrs/issues/74)) ([b38f2b6](https://github.com/oxidezap/baileyrs/commit/b38f2b63b8ae5ad78b4ae47cf7034422b6db57b8))

## [0.2.3](https://github.com/oxidezap/baileyrs/compare/v0.2.2...v0.2.3) (2026-08-17)


### Bug Fixes

* **errors:** give a bridge rejection a stack that names the caller ([#70](https://github.com/oxidezap/baileyrs/issues/70)) ([61e7b26](https://github.com/oxidezap/baileyrs/commit/61e7b26d71a717b5df7ef2ae13f5ab982aab74fa))


### Dependencies

* move to bridge 0.14.0 ([#68](https://github.com/oxidezap/baileyrs/issues/68)) ([1d4ae34](https://github.com/oxidezap/baileyrs/commit/1d4ae3485f7642f5125124dc6dc268eb697c754d))

## [0.2.2](https://github.com/oxidezap/baileyrs/compare/v0.2.1...v0.2.2) (2026-08-14)


### Dependencies

* move to bridge 0.13.0 ([#66](https://github.com/oxidezap/baileyrs/issues/66)) ([14ba3b6](https://github.com/oxidezap/baileyrs/commit/14ba3b6ef02251a26a58eeb7fbaa8e5758f6f1e1))

## [0.2.1](https://github.com/oxidezap/baileyrs/compare/v0.2.0...v0.2.1) (2026-08-13)


### Bug Fixes

* **release:** recognise deps commits so a dependency bump reaches the changelog ([#65](https://github.com/oxidezap/baileyrs/issues/65)) ([0ebe705](https://github.com/oxidezap/baileyrs/commit/0ebe705c3fa4b81d35b344e1dbb3fb061b7b1c57))


### Performance

* **transport:** forward ArrayBuffer-backed frames instead of rebuilding them ([#62](https://github.com/oxidezap/baileyrs/issues/62)) ([c879042](https://github.com/oxidezap/baileyrs/commit/c879042b6305ab0ba85c4d2376352703b75d5135))


### Dependencies

* move to bridge 0.12.0 ([#64](https://github.com/oxidezap/baileyrs/issues/64)) ([0c049f8](https://github.com/oxidezap/baileyrs/commit/0c049f870be869edb3b70d52151899df87e60c99))

## [0.2.0](https://github.com/oxidezap/baileyrs/compare/v0.1.3...v0.2.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* **events:** move to bridge 0.10.0 and deliver the events it added ([#55](https://github.com/oxidezap/baileyrs/issues/55))

### Features

* **events:** move to bridge 0.10.0 and deliver the events it added ([#55](https://github.com/oxidezap/baileyrs/issues/55)) ([a687c45](https://github.com/oxidezap/baileyrs/commit/a687c45bf641fabb5061700772d3738d69e9bbed))


### Bug Fixes

* **auth:** rebuild the credential mirror from the persisted device ([#57](https://github.com/oxidezap/baileyrs/issues/57)) ([efb1e14](https://github.com/oxidezap/baileyrs/commit/efb1e141e4f27c35e61817e6e7b1e47e0c8404e8))
* **bridge:** read the payload shapes the bridge actually sends ([#59](https://github.com/oxidezap/baileyrs/issues/59)) ([c62b568](https://github.com/oxidezap/baileyrs/commit/c62b56844af28c0a75d6f5791e34a5fb4f917842))
* **deps:** bump @oxidezap/whatsapp-rust-bridge to 0.7.2 ([#45](https://github.com/oxidezap/baileyrs/issues/45)) ([d43dcea](https://github.com/oxidezap/baileyrs/commit/d43dceaded0736080aeecb2b34395cdce5b9f1eb))
* **event-buffer:** let a contacts.upsert win over an update buffered before it ([#52](https://github.com/oxidezap/baileyrs/issues/52)) ([8615dd6](https://github.com/oxidezap/baileyrs/commit/8615dd62abc0165b217a5fa22fcf8ca079969f50))
* **event-buffer:** release consolidated events in upstream's order ([#51](https://github.com/oxidezap/baileyrs/issues/51)) ([31c8576](https://github.com/oxidezap/baileyrs/commit/31c8576400657fd8d55d90762abe18deb52fbf90))
* **history:** return undefined when there is no history sync notification ([#48](https://github.com/oxidezap/baileyrs/issues/48)) ([bddb2bf](https://github.com/oxidezap/baileyrs/commit/bddb2bf69fc274bab346235c6429c35d9a9ec76e))
* **send:** keep a caller's &lt;biz&gt; working, on bridge 0.11.0 ([#61](https://github.com/oxidezap/baileyrs/issues/61)) ([46bdb82](https://github.com/oxidezap/baileyrs/commit/46bdb82ed795bb4c683e8483c3570b9837160537))
* three parity defects the differential fuzzers found ([#47](https://github.com/oxidezap/baileyrs/issues/47)) ([a7ffb68](https://github.com/oxidezap/baileyrs/commit/a7ffb68f40149da8e891c5550911c66952c72e3f))

## [0.1.3](https://github.com/oxidezap/baileyrs/compare/v0.1.2...v0.1.3) (2026-08-09)


### Bug Fixes

* **deps:** bump @oxidezap/whatsapp-rust-bridge to 0.7.1 ([#42](https://github.com/oxidezap/baileyrs/issues/42)) ([cf023a0](https://github.com/oxidezap/baileyrs/commit/cf023a033e3aba27a1ba9324d3c21af6afb7ff3c))
* **socket:** reject an invalid enum argument before it reaches the bridge ([#40](https://github.com/oxidezap/baileyrs/issues/40)) ([20c6ee0](https://github.com/oxidezap/baileyrs/commit/20c6ee04b34956d7d6bd9ce2117509f334063609))

## [0.1.2](https://github.com/oxidezap/baileyrs/compare/v0.1.1...v0.1.2) (2026-08-09)


### Bug Fixes

* **legacy-store:** accept status/broadcast sender-key addresses ([#38](https://github.com/oxidezap/baileyrs/issues/38)) ([51b6919](https://github.com/oxidezap/baileyrs/commit/51b6919781f0d60b0747434456e6c8c25c271ac4))

## [0.1.1](https://github.com/oxidezap/baileyrs/compare/v0.1.0...v0.1.1) (2026-08-09)


### Features

* **business:** add catalog and business profile surface ([#31](https://github.com/oxidezap/baileyrs/issues/31)) ([bbb37cd](https://github.com/oxidezap/baileyrs/commit/bbb37cd7c32d5a6273f319043856548e65b6a7fc))
* **exports:** add the public root exports that belong in this layer ([#36](https://github.com/oxidezap/baileyrs/issues/36)) ([7edf6c5](https://github.com/oxidezap/baileyrs/commit/7edf6c511f913824e373e731953b146d1cfe1443))
* **newsletter:** complete the upstream newsletter surface ([#30](https://github.com/oxidezap/baileyrs/issues/30)) ([f9abe6f](https://github.com/oxidezap/baileyrs/commit/f9abe6f1c4b61410ff4dfa4c5e09c941ea904f4b))
* **privacy:** add call and message privacy controls ([#28](https://github.com/oxidezap/baileyrs/issues/28)) ([ec23236](https://github.com/oxidezap/baileyrs/commit/ec2323622e97143753f13607821e5d648ad58ee4))
* **socket:** add the remaining server-side query wrappers ([#32](https://github.com/oxidezap/baileyrs/issues/32)) ([0a3d39b](https://github.com/oxidezap/baileyrs/commit/0a3d39b24ea68c76d4d16a12156bab8ea8ee981e))
* **socket:** decide and implement the internal-surface compatibility items ([#33](https://github.com/oxidezap/baileyrs/issues/33)) ([2a34474](https://github.com/oxidezap/baileyrs/commit/2a34474fe7f1796829fe960e13c930151fa7a3a2))
* **store:** make the bridge keystore namespaces a documented contract ([#37](https://github.com/oxidezap/baileyrs/issues/37)) ([5abf2d2](https://github.com/oxidezap/baileyrs/commit/5abf2d2dec3fca5d069ba6bb6026ab9b0b561337))


### Bug Fixes

* **chats:** stop silently dropping unsupported chatModify variants ([#29](https://github.com/oxidezap/baileyrs/issues/29)) ([c95a6a0](https://github.com/oxidezap/baileyrs/commit/c95a6a0afe00aac123f4bf7ae66a7b65770f422e))
* **deps:** update whatsapp-rust-bridge to 0.7.0 ([#26](https://github.com/oxidezap/baileyrs/issues/26)) ([10471a4](https://github.com/oxidezap/baileyrs/commit/10471a4add83616d170cc599748513da23a07da9))
* **messages:** stop dropping messageContextInfo on relay ([#34](https://github.com/oxidezap/baileyrs/issues/34)) ([96750da](https://github.com/oxidezap/baileyrs/commit/96750da51e2d1e480844b22bb2e681b62d9ae4c4))
* **types:** align the diverging public signatures with upstream ([#35](https://github.com/oxidezap/baileyrs/issues/35)) ([a546f95](https://github.com/oxidezap/baileyrs/commit/a546f95194965805eff28b9669fef04ab3f11cfa))

## [0.1.0](https://github.com/oxidezap/baileyrs/compare/v0.0.35...v0.1.0) (2026-08-08)


### ⚠ BREAKING CHANGES

* **connection:** make close mean the socket is finished, as upstream does ([#20](https://github.com/oxidezap/baileyrs/issues/20))

### Bug Fixes

* **connection:** make close mean the socket is finished, as upstream does ([#20](https://github.com/oxidezap/baileyrs/issues/20)) ([46a3d0e](https://github.com/oxidezap/baileyrs/commit/46a3d0ecc1efe4e0f7572af6498c9811875ff11f))


### Performance

* **events:** opt the packed receipt and ack paths into borrowed batches ([#25](https://github.com/oxidezap/baileyrs/issues/25)) ([29dc629](https://github.com/oxidezap/baileyrs/commit/29dc629a33820416a8ad15319f1953a543d74473))
* **messages:** resolve the content type once per send ([#22](https://github.com/oxidezap/baileyrs/issues/22)) ([4bd50ab](https://github.com/oxidezap/baileyrs/commit/4bd50ab6115a74f7883efc138a2bacacf5c50514))
* **proto:** give decoded messages a stable shape instead of re-parenting them ([#21](https://github.com/oxidezap/baileyrs/issues/21)) ([ff675ee](https://github.com/oxidezap/baileyrs/commit/ff675ee08a6fc769399425edad0dc7360fa3ce21))

## [0.0.35](https://github.com/oxidezap/baileyrs/compare/v0.0.34...v0.0.35) (2026-08-07)


### Features

* inflate history sync through the bridge ([#15](https://github.com/oxidezap/baileyrs/issues/15)) ([b27bb69](https://github.com/oxidezap/baileyrs/commit/b27bb69d552640bcff59f59f3caf98e616e196da))


### Bug Fixes

* **deps:** bump @oxidezap/whatsapp-rust-bridge to 0.6.4 ([#19](https://github.com/oxidezap/baileyrs/issues/19)) ([3927bfb](https://github.com/oxidezap/baileyrs/commit/3927bfbe8cd9de768a213702fd965530fb38c843))
* **legacy-store:** keep DM and group sessions usable across the upgrade ([#16](https://github.com/oxidezap/baileyrs/issues/16)) ([427347a](https://github.com/oxidezap/baileyrs/commit/427347a67696c655a2b2a48419d70830d99547bc))
