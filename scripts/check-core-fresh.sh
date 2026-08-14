#!/usr/bin/env bash
set -euo pipefail

# A consumer's build reads core/ — the pinned submodule — never a sibling
# checkout of this repository. When a sibling exists and has moved past the
# pin, the edit someone is waiting to see is not in that build; say so. Notes,
# never a failure: a pinned commit is a valid thing to build. Runs from the
# consumer repository's root, called by its build.sh when the pin carries this
# script; a pin too old to carry it is itself the news these notes would have
# printed. Always exits 0.
if [ -d ../dotmd-webcore/.git ]; then
    sibling=$(git -C ../dotmd-webcore rev-parse --verify -q main || true)
    if [ -n "$sibling" ] && [ "$sibling" != "$(git -C core rev-parse HEAD)" ]; then
        echo "note: core/ ($(git -C core rev-parse --short HEAD)) is not ../dotmd-webcore main ($(git -C ../dotmd-webcore rev-parse --short main)) — scripts/sync-core.sh moves it" >&2
    fi
    if [ -n "$(git -C ../dotmd-webcore status --porcelain -- packages 2>/dev/null)" ]; then
        echo "note: ../dotmd-webcore has uncommitted work under packages/ — it reaches a build only committed there and synced" >&2
    fi
fi
