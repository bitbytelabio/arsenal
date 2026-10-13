set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

export ARSENAL_OMP_PROFILE := env("ARSENAL_OMP_PROFILE", "arsenal")
export ARSENAL_PROFILE := env("ARSENAL_PROFILE", home_directory() / ".omp/profiles" / ARSENAL_OMP_PROFILE / "agent")

# List available commands; never install implicitly.
default:
    @just --list

# Install repository dependencies without changing bun.lock.
deps:
    bun install --frozen-lockfile

# Generate the local plugin distribution.
build:
    bun --no-env-file run bin/arsenal.ts build --write

# Package the plugin distribution into dist/ archive.
pack:
    bun --no-env-file run bin/arsenal.ts plugin pack --write
# Preview plugin linking without writing configuration.
preview:
    OMP_PROFILE="$ARSENAL_OMP_PROFILE" omp plugin link ./plugin --dry-run --json

# Install/update the selected profile, then verify it (optional custom profile/prompt templates).
profile-install:
    bun --no-env-file run bin/arsenal.ts profile install --profile "$ARSENAL_PROFILE" --write
    bun --no-env-file run bin/arsenal.ts profile verify --profile "$ARSENAL_PROFILE"

# Link the built plugin into OMP (user-scoped local link under selected profile context).
link:
    OMP_PROFILE="$ARSENAL_OMP_PROFILE" omp plugin link ./plugin

# Install dependencies, build plugin distribution, and link into OMP.
install-local: deps build link
# Verify the selected profile without modifying it.
verify:
    bun --no-env-file run bin/arsenal.ts profile verify --profile "$ARSENAL_PROFILE"

# Run all tests, or pass test paths / Bun test flags.
test *args:
    bun --no-env-file test "$@"

# Run focused profile, MCP, specialist parity, and slash-command tests.
test-local:
    bun --no-env-file test tests/us2-profile.test.ts tests/mcp-lifecycle.test.ts tests/mcp-uv-runner.test.ts tests/ida-detector.test.ts tests/us12-domain-coverage.test.ts tests/slash-commands.test.ts

# Type-check the repository.
typecheck:
    bun run typecheck

# Check byte-for-byte build determinism.
determinism:
    bun --no-env-file run bin/arsenal.ts build --check-determinism --json
