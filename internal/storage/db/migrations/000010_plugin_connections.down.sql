DROP INDEX IF EXISTS idx_assistant_bindings_role;
DROP INDEX IF EXISTS idx_assistant_bindings_connection;
DROP TABLE IF EXISTS assistant_connection_bindings;

DROP INDEX IF EXISTS idx_plugin_connections_enabled;
DROP INDEX IF EXISTS idx_plugin_connections_plugin;
DROP TABLE IF EXISTS plugin_connections;
