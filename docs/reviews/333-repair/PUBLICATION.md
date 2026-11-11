# Authorized publication and follow-up acceptance

On 2026-11-11 the owner explicitly authorized publication to the public repository and closure of the reviewed gaps. PR #336 had merged into main at `98bca07648bb351627143924f6450aec63e9c1eb`, with the same tree as the repair base. The repair was published through GitHub's connected Git-data API as `544debdd8ba0039b61f134821d6fd62838895911`, PR #337. Its tree `f86691560339e0a50757804aa6a6c165f4512f4a` exactly matches locally validated `f762098f`. Git fetch readback verified the tree. The earlier publication-blocked checkpoint is historical, not a current request for approval.

The first CI pass proved previous-release upgrade, dependency audit, Docker production contract and Production Docker Validation. It also exposed a real MySQL deadlock: missing-intent locking lookup in payment history took an index gap lock, conflicting with a concurrent collection for a different booking. Follow-up code discovers candidates without a gap lock and locks only an existing primary-key row, revalidating identity and status. The original native contention assertion remains intact.

Follow-up review also closes the NDC count-only passenger validation exception and rejects unsupported child/infant profiles before local NDC order writes, including old offers without a canonical offer reference. Local NDC shopping currently quotes adults only; no new child/infant pricing support is claimed. Existing typed direct/servicing behavior stays separately tested.

Generated event and service catalogs are synchronized with the refund-completion event and new runtime dependencies. The S-06 fixture now closes the application pool and restores environment variables. Additional native DCS/SSR/APIS regressions are wired into Production Gates; their skipped local execution is not MySQL acceptance.

## Closure scope

The primary issue table contains 35 IDs despite its older title count. SEC-02 was withdrawn/already fixed; the other 34 primary IDs map to code repairs. REC-01 and additional verified subfindings are included. This is a mapping of implementations, not a declaration that CI or external acceptance has completed. Keep #333 open until the proposed head's native gates and review pass. Operator/device/provider acceptance, historical manual financial reconciliation and broader roadmap modules must not be closed by this code-only evidence.

Gitleaks flagged the APIS source digest in the immutable checkpoint as a generic API key. Recomputing SHA-256 from the published source reproduced the exact value. A single path-and-value allowlist preserves every default detector and permits only that verified public source digest; the real scanner policy probe is retained. No secret was discovered or suppressed by a broad file exclusion.
