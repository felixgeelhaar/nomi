package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/felixgeelhaar/nomi/internal/configio"
	"github.com/felixgeelhaar/nomi/internal/secrets"
	"github.com/felixgeelhaar/nomi/internal/storage/db"
)

// ConfigServer wires GET /config/export + POST /config/import. Both
// gated by the standard bearer-token middleware (no special auth) —
// the snapshot omits secret plaintext, so the trust boundary matches
// every other authenticated read/write endpoint.
type ConfigServer struct {
	deps configio.Deps
}

func NewConfigServer(database *db.DB, secretStore secrets.Store) *ConfigServer {
	return &ConfigServer{deps: configio.Deps{
		DB:           database,
		Providers:    db.NewProviderProfileRepository(database),
		Assistants:   db.NewAssistantRepository(database),
		Settings:     db.NewAppSettingsRepository(database),
		Globals:      db.NewGlobalSettingsRepository(database),
		Memory:       db.NewMemoryRepository(database),
		PluginStates: db.NewPluginStateRepository(database),
		Secrets:      secretStore,
	}}
}

// Export renders the current daemon state as YAML (Content-Type
// application/x-yaml) so a `curl -O` produces a file ready for `nomi
// import`. Clients that want JSON can parse the YAML themselves;
// keeping one wire format on the server avoids drift between the two.
func (s *ConfigServer) Export(c *gin.Context) {
	snap, err := configio.Export(s.deps)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out, err := configio.Marshal(snap)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", `attachment; filename="nomi-config.yaml"`)
	c.Data(http.StatusOK, "application/x-yaml", out)
}

// Import accepts a YAML body (Content-Type application/x-yaml or
// text/yaml; we don't enforce — Marshal/Unmarshal handle anything the
// snapshot's tags accept) and applies it idempotently. Returns the
// per-section counts so the caller can show the user what changed.
func (s *ConfigServer) Import(c *gin.Context) {
	body, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var snap configio.Snapshot
	if err := configio.Unmarshal(body, &snap); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parse snapshot: " + err.Error()})
		return
	}
	res, err := configio.Import(&snap, s.deps)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": res})
}
