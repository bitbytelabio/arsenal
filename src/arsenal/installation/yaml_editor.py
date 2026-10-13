"""Non-destructive YAML merging engine preserving comments, formatting, and quotes.

Uses ruamel.yaml roundtrip capability to retain comments, quotes, and structure.
"""

from __future__ import annotations

import io
from typing import Any


def merge_yaml_preserving_comments(existing_content: str, incoming_content: str) -> str:
    """Non-destructively merge incoming YAML into existing YAML, preserving comments and formatting."""
    if not existing_content.strip():
        return incoming_content.rstrip() + "\n"
    if not incoming_content.strip():
        return existing_content.rstrip() + "\n"

    try:
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True
        yaml.indent(mapping=2, sequence=4, offset=2)

        existing_doc = yaml.load(existing_content)
        incoming_doc = yaml.load(incoming_content)

        if existing_doc is None:
            return incoming_content.rstrip() + "\n"
        if incoming_doc is None:
            return existing_content.rstrip() + "\n"

        def _merge_recursive(target: Any, source: Any) -> None:
            if isinstance(target, dict) and isinstance(source, dict):
                for k, v in source.items():
                    if k not in target:
                        target[k] = v
                    elif isinstance(target[k], dict) and isinstance(v, dict):
                        _merge_recursive(target[k], v)

        _merge_recursive(existing_doc, incoming_doc)

        buf = io.StringIO()
        yaml.dump(existing_doc, buf)
        return buf.getvalue().rstrip() + "\n"

    except ImportError:
        # Fallback to PyYAML if ruamel.yaml is absent
        import yaml as pyyaml

        existing_doc = pyyaml.safe_load(existing_content) or {}
        incoming_doc = pyyaml.safe_load(incoming_content) or {}

        def _merge_dict(target: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
            for k, v in source.items():
                if k not in target:
                    target[k] = v
                elif isinstance(target[k], dict) and isinstance(v, dict):
                    _merge_dict(target[k], v)
            return target

        merged = _merge_dict(existing_doc, incoming_doc)
        return pyyaml.dump(merged, sort_keys=False).rstrip() + "\n"
