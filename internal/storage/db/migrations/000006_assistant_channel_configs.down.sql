-- Revert 000006: drop channel_configs column. Requires SQLite 3.35+.
ALTER TABLE assistants DROP COLUMN channel_configs;
