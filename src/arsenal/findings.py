"""Finding lifecycle and independent verification data model.

Implements contracts/evidence-reporting.md §4, data-model.md §Finding and VerificationResult & T047.
"""

from __future__ import annotations

from typing import Literal

from arsenal.reports import (
    SEVERITIES,
    VALIDATION_STATUSES,
    create_finding,
    record_verification,
)

Severity = Literal["info", "low", "medium", "high", "critical"]
ValidationStatus = Literal["validated", "unvalidated", "rejected", "partial", "error"]

createFinding = create_finding
recordVerification = record_verification

__all__ = [
    "Severity",
    "ValidationStatus",
    "SEVERITIES",
    "VALIDATION_STATUSES",
    "create_finding",
    "record_verification",
    "createFinding",
    "recordVerification",
]
