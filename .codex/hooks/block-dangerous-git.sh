#!/bin/bash
# PreToolUse(Bash) guard. Blocks destructive git commands plus this project's
# data-loss vectors (the Postgres data lives in the `terrain_pg` Docker volume;
# Prisma reset drops & reseeds the DB). Exit 2 = blocked, command never runs.
#
# NOTE: deny rules in .claude/settings.json are the primary, confirmed guard
# under `--dangerously-skip-permissions`; this hook is defense-in-depth.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

DANGEROUS_PATTERNS=(
  # --- destructive git ---
  "git push"
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "reset --hard"
  # --- Terrain data-loss guards ---
  "down -v"
  "down --volumes"
  "migrate reset"
  "db push.*--force-reset"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
