# Changelog

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
