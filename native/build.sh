#!/usr/bin/env bash
# Rebuilds ../src/aurenstar.wasm from the Swiss Ephemeris C sources in ./swisseph (copy of
# https://github.com/aloistr/swisseph, commit 94621aba9f3ff9c32cb721eac0380c30dbb153fe) and the wrapper aur.c.
# Needs: clang with the wasm32 target, wasm-ld, wasi-libc and the clang wasm32 runtime
# (Ubuntu: apt install clang lld wasi-libc libclang-rt-18-dev-wasm32).
set -euo pipefail
cd "$(dirname "$0")"
S=./swisseph
clang --target=wasm32-wasi -mexec-model=reactor -O2 -s -DNO_SWE_GLP \
  -I"$S" -I/usr/include/wasm32-wasi -L/usr/lib/wasm32-wasi \
  -Wl,--no-entry -Wl,--strip-all \
  aur.c "$S"/{swedate,swehouse,swejpl,swemmoon,swemplan,sweph,swephlib}.c -lm \
  -o ../src/aurenstar.wasm
ls -l ../src/aurenstar.wasm
