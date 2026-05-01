-- Down migration is intentionally a no-op: the up migration only adds a
-- capability that should always have been present. Stripping llm.chat back
-- out would re-break chat for any assistant that was relying on the
-- backfill, which is worse than leaving it in place.
SELECT 1;
