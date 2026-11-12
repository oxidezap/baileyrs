# Choosing CI jobs

`changes.mjs` shares one decision across CI, CodSpeed, autofix and previews. The latter three call `changes.yml`; CI keeps its existing selector job name for branch protection. It skips jobs only when every changed file is documentation in the explicit allowlist, the release manifest, or a package manifest whose only semantic change is the package's own version. Dependency versions, scripts, exports and other package fields run all jobs. Unknown files and workflow changes run all jobs too. This policy does not trust a PR title, author or branch name.

The selector reads the entire Git diff, including deleted paths and both sides of renames. PRs compare from the merge base, including fork commits fetched by checkout. Pushes compare the whole before/after range. Missing history, empty diffs and malformed manifests run all jobs. No API pagination or patch truncation can hide changes.

CI retains `All checks passed` and the existing job names. Require the aggregate check in branch protection. A selector failure fails that aggregate; it cannot turn missing outputs into success. Forks still skip private Bartender jobs without gaining secrets. Release verification passes `full: true`, and manual CodSpeed runs always measure. No release or nightly fuzz gates change.

Run `node --test scripts/__tests__/ci-changes.test.mjs` to verify the selection matrix. The selector needs Node 24 and Git, without npm dependencies or API credentials.
