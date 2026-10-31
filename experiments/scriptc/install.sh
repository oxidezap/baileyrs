#!/usr/bin/env bash
set -euo pipefail
# Official archive and release API digest, pinned to v0.4.0, Linux x64 glibc.
root=${1:?usage: install.sh destination}
mkdir -p "$root"
curl --fail --location --retry 3 https://github.com/vercel-labs/scriptc/releases/download/v0.4.0/scriptc-0.4.0-linux-x64-gnu.tar.gz -o "$root/compiler.tar.gz"
printf '%s  %s\n' ccd3f95b7e04de6682306fd6e255866a916e18dbf95bff6b100d8074cbbcb006 "$root/compiler.tar.gz" | sha256sum --check -
tar -xzf "$root/compiler.tar.gz" -C "$root"
"$root/bin/scriptc" --version
