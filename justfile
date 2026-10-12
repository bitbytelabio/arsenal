set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

export ARSENAL_PROFILE := env("ARSENAL_PROFILE", home_directory() / ".omp/profiles/arsenal/agent")
export ARSENAL_SCOPE := env("ARSENAL_SCOPE", "user")

# List available commands; never install implicitly.
default:
    @just --list

# Install repository dependencies without changing bun.lock.
deps:
    bun install --frozen-lockfile

# Generate the local plugin distribution.
build:
    bun --no-env-file run bin/arsenal.ts build --write

# Preview profile changes and plugin linking without writing either.
preview:
    bun --no-env-file run bin/arsenal.ts profile install --profile "$ARSENAL_PROFILE"
    omp plugin link ./plugin --scope "$ARSENAL_SCOPE" --dry-run --json

# Install/update the selected profile, then verify it (no --force).
profile-install:
    bun --no-env-file run bin/arsenal.ts profile install --profile "$ARSENAL_PROFILE" --write
    bun --no-env-file run bin/arsenal.ts profile verify --profile "$ARSENAL_PROFILE"

# Link the built plugin into OMP; scope defaults to user.
link:
    omp plugin link ./plugin --scope "$ARSENAL_SCOPE"

# Install dependencies, build, install the profile, and link into OMP.
install-local: deps build profile-install link

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
