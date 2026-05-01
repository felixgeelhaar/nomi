-- Run-level attachment metadata captured by channel plugins on inbound.
--
-- Channel plugins write rows here when an inbound message carries
-- non-text content (Telegram photos / voice / docs, Slack files,
-- Discord attachments, eventually Email MIME parts). The runtime's
-- enrichment pass (media-10) walks these rows and dispatches the
-- right tool (whisper for audio, vision LLM for images, document
-- extraction for PDFs) before the assistant starts planning.
--
-- We intentionally store metadata + URL only — bytes stay on the
-- channel-provider's CDN until enrichment fetches them. This keeps
-- the SQLite footprint small and avoids the daemon doubling as a
-- file store. external_id is the channel-provider's reference
-- (Telegram file_id, Slack file_id, Discord attachment_id) so we
-- can re-fetch later if the URL has expired.

CREATE TABLE IF NOT EXISTS run_attachments (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- "image" | "document" | "audio" | "video"
    filename     TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '',
    url          TEXT NOT NULL DEFAULT '',
    external_id  TEXT NOT NULL DEFAULT '',
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_run_attachments_run ON run_attachments(run_id);
