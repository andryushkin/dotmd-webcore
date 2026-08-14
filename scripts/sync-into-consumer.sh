#!/usr/bin/env bash
set -euo pipefail

# Moves a consumer's core/ submodule — this repository — to the tip of main.
# Runs from the consumer repository's root, execed by its scripts/sync-core.sh
# shim; nothing here climbs out of the current directory by its own path,
# because $0 lives inside the very submodule being moved. The mechanism lives
# here rather than with each consumer because it knows only two names, both
# family conventions — `core/` and a sibling checkout `../dotmd-webcore` — and
# because it has already accumulated knowledge worth not forking: every rule
# below was paid for the day the mechanism was born.
if [ ! -f core/package.json ] || [ ! -e core/.git ]; then
    echo "run from a consumer root: no core/ submodule here" >&2
    exit 1
fi

# A sibling checkout outranks GitHub for freshness when it is present; without
# one, origin is the truth. Core work lands on main through a PR, so a sibling
# main that has run ahead of its own origin/main is an accident, not work in
# progress — and a pin taken from it dies later, when the PR lands as a
# different SHA and the branch is deleted: a fresh clone's
# `git submodule update --init` is left pointing at no tree. Measured, not
# theoretical. So the sync refuses that tip unless told otherwise.
if [ -d ../dotmd-webcore/.git ]; then
    if git -C ../dotmd-webcore rev-parse --verify -q origin/main >/dev/null \
        && ! git -C ../dotmd-webcore merge-base --is-ancestor main origin/main; then
        ahead=$(git -C ../dotmd-webcore rev-list --count origin/main..main)
        echo "refusing: ../dotmd-webcore main is $ahead commit(s) past its origin/main." >&2
        echo "Land them through a PR first — or rerun with ALLOW_UNPUSHED_CORE=1." >&2
        if [ "${ALLOW_UNPUSHED_CORE:-}" != "1" ]; then
            exit 1
        fi
    fi
    git -C core fetch ../../dotmd-webcore main
    # The consumer's audit answers "is the pin reachable from the core's
    # origin?" offline, from the submodule's own origin/main tracking ref —
    # which a fetch from the sibling does not move, so a truthful sync used to
    # read as "commit not on its origin". Mirror the sibling's knowledge of
    # origin into the submodule; still no network. Forced, because a tracking
    # ref follows its remote wherever it goes, rewrites included.
    git -C core fetch ../../dotmd-webcore "+refs/remotes/origin/main:refs/remotes/origin/main"
else
    git -C core fetch origin main
fi

# On the branch, not a detached commit: a fix committed on a detached HEAD
# lands outside every branch, which is the one way to lose work a directory
# never offered.
git -C core checkout -q main

# --ff-only: a failure here means core/ carries commits of its own. They were
# born in the wrong place — move them to the core's repository first; this
# script only ever consumes.
git -C core merge --ff-only FETCH_HEAD

# Workspace members may have gained or dropped dependencies with the move.
bun install

git -C core log --oneline -1
echo "core/ is at the tip. Pin it when the work is done: git add core, commit."
