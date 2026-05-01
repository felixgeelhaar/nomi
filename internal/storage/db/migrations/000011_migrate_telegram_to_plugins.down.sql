-- Roll back the 000011 data migration. The up migration writes into
-- plugin_connections and assistant_connection_bindings but leaves
-- connector_configs untouched, so rollback just removes the new rows.

DELETE FROM assistant_connection_bindings
 WHERE connection_id IN (
   SELECT id FROM plugin_connections WHERE plugin_id = 'com.nomi.telegram'
 );

DELETE FROM plugin_connections WHERE plugin_id = 'com.nomi.telegram';
