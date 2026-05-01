-- Add model_policy column to assistants table
ALTER TABLE assistants ADD COLUMN model_policy TEXT; -- JSON
