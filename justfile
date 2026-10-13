set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

export ARSENAL_OMP_PROFILE := env("ARSENAL_OMP_PROFILE", "arsenal")
export ARSENAL_PROFILE := env("ARSENAL_PROFILE", home_directory() / ".omp/profiles" / ARSENAL_OMP_PROFILE / "agent")

# List available commands; never install implicitly.
default:
    @just --list

# Install repository dependencies without changing bun.lock and uv.lock.
deps:
    bun install --frozen-lockfile
    uv sync --locked

# Generate the local plugin distribution.
build:
    uv run --locked arsenal build --write --force

# Package the plugin distribution into dist/ archive.
pack:
    uv run --locked arsenal plugin pack --write
# Preview plugin linking without writing configuration.
preview:
    OMP_PROFILE="$ARSENAL_OMP_PROFILE" omp plugin link ./plugin --dry-run --json

# Install/update the selected profile, then verify it (optional custom profile/prompt templates).
profile-install:
    uv run --locked arsenal profile install --profile "$ARSENAL_PROFILE" --write
    uv run --locked arsenal profile verify --profile "$ARSENAL_PROFILE"

# Link the built plugin into OMP (user-scoped local link under selected profile context).
link:
    OMP_PROFILE="$ARSENAL_OMP_PROFILE" omp plugin link ./plugin

# Install dependencies, build plugin distribution, and link into OMP.
install-local: deps build link
# Verify the selected profile without modifying it.
verify:
    uv run --locked arsenal profile verify --profile "$ARSENAL_PROFILE"

# Run all tests (both Python and native Bun test suites).
test *args:
    uv run --locked pytest "$@"
    bun test "$@"

# Run focused profile, MCP, specialist parity, and slash-command tests.
test-local:
    uv run --locked pytest tests/python/test_install_profile.py tests/python/test_install_mcp.py tests/python/test_install_editors.py tests/python/test_install_plugin.py
    bun test tests/us2-profile.test.ts tests/mcp-lifecycle.test.ts tests/mcp-uv-runner.test.ts tests/ida-detector.test.ts tests/us12-domain-coverage.test.ts tests/slash-commands.test.ts

# Type-check the repository.
typecheck:
    bun run typecheck

# Check byte-for-byte build determinism.
determinism:
    uv run --locked arsenal build --check-determinism --json
