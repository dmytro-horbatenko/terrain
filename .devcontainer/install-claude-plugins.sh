#!/bin/bash
# Installs the Claude Code plugins this repo's sessions rely on: superpowers
# (brainstorming, subagent-driven-development, dispatching-parallel-agents,
# TDD, writing-plans, systematic-debugging, ...), skill-creator, and
# code-simplifier. The container's ~/.claude (the claude-code-config volume)
# starts empty and deliberately decoupled from the host's ~/.claude, so none
# of this is present until this script runs. Every subcommand is idempotent
# (exit 0 if already installed/added), so this is safe to re-run on rebuild.
set -euo pipefail

claude plugin marketplace add anthropics/claude-plugins-official

for plugin in superpowers skill-creator code-simplifier; do
  claude plugin install "${plugin}@claude-plugins-official" -s user
  claude plugin enable "${plugin}@claude-plugins-official" -s user || true
done
