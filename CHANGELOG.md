# Changelog

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
