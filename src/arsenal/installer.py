"""Arsenal harness & capability installer dispatcher.

Routes profile, plugin, and mcp command families to the appropriate installation subsystems.
"""

from __future__ import annotations

from arsenal.common import Context, ExitCodes


def handle(ctx: Context) -> int:
    """Dispatch command context to profile, plugin, or mcp handler."""
    family = ctx.family.lower()
    if family == "profile":
        from arsenal.installation.profile import handle_profile

        return handle_profile(ctx)

    if family == "plugin":
        from arsenal.installation.plugin import handle_plugin

        return handle_plugin(ctx)

    if family == "mcp":
        from arsenal.installation.mcp import handle_mcp

        return handle_mcp(ctx)

    return ctx.fail(f"Unrecognized installer command family: '{ctx.family}'", code=ExitCodes.CLI_USAGE_ERROR)
