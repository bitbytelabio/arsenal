"""Canonical JSON Schema contracts shared by Python CLI and native OMP hooks."""
from __future__ import annotations

import json
from functools import lru_cache
from importlib.resources import files

from jsonschema import Draft202012Validator, FormatChecker


PLAYBOOK_CATALOG_SCHEMA = "PLAYBOOK_CATALOG_SCHEMA"
PLAYBOOK_ADMISSION_SCHEMA = "PLAYBOOK_ADMISSION_SCHEMA"

@lru_cache(maxsize=32)
def schema(name: str) -> dict[str, object]:
    if not name.isidentifier() or not name.endswith("_SCHEMA"):
        raise ValueError(f"Unknown schema name: {name}")
    source = files("arsenal").joinpath("schema_data", f"{name.lower()}.json")
    return json.loads(source.read_text(encoding="utf-8"))


@lru_cache(maxsize=32)
def validator(name: str) -> Draft202012Validator:
    document = schema(name)
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document, format_checker=FormatChecker())


def validate(name: str, data: object) -> list[str]:
    return [
        f"/{'/'.join(map(str, error.absolute_path))}: {error.message}"
        for error in sorted(validator(name).iter_errors(data), key=lambda item: str(item.absolute_path))
    ]
