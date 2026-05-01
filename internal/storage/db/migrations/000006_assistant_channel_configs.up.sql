-- Add channel_configs column to assistants table for per-connection channel configuration
ALTER TABLE assistants ADD COLUMN channel_configs TEXT; -- JSON array of ChannelConfig
