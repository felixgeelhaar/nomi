package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/felixgeelhaar/nomi/internal/secrets"
	"github.com/felixgeelhaar/nomi/internal/storage/db"
	"github.com/felixgeelhaar/nomi/internal/tunnel"
)

// WebhookServer handles authenticated webhook management endpoints.
type WebhookServer struct {
	connectionRepo *db.ConnectionRepository
	secrets        secrets.Store
	tunnel         tunnel.Adapter
}

// NewWebhookServer creates a webhook management server.
func NewWebhookServer(dbConn *db.DB, secrets secrets.Store, tunnel tunnel.Adapter) *WebhookServer {
	return &WebhookServer{
		connectionRepo: db.NewConnectionRepository(dbConn),
		secrets:        secrets,
		tunnel:         tunnel,
	}
}

// GetTunnelStatus returns the current tunnel public URL and health.
func (s *WebhookServer) GetTunnelStatus(c *gin.Context) {
	url := ""
	if s.tunnel != nil {
		url = s.tunnel.URL()
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":    s.tunnel != nil && url != "",
		"public_url": url,
	})
}

// RotateSecret generates a new webhook secret for a connection.
func (s *WebhookServer) RotateSecret(c *gin.Context) {
	connectionID := c.Param("connection_id")

	conn, err := s.connectionRepo.GetByID(connectionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "connection not found"})
		return
	}

	// Generate a 32-byte random secret
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate secret"})
		return
	}
	secret := hex.EncodeToString(secretBytes)

	// Store in secrets vault
	key := "webhook_secret_" + connectionID
	ref, err := secrets.StoreAsReference(s.secrets, key, secret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store secret"})
		return
	}

	// Update connection credential refs
	if conn.CredentialRefs == nil {
		conn.CredentialRefs = make(map[string]string)
	}
	conn.CredentialRefs["webhook_secret"] = ref
	if err := s.connectionRepo.Update(conn); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update connection"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "secret rotated"})
}

// UpdateAllowlist updates the webhook event allowlist for a connection.
func (s *WebhookServer) UpdateAllowlist(c *gin.Context) {
	connectionID := c.Param("connection_id")

	var req struct {
		Allowlist []string `json:"allowlist"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	conn, err := s.connectionRepo.GetByID(connectionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "connection not found"})
		return
	}

	conn.WebhookEventAllowlist = req.Allowlist
	if err := s.connectionRepo.Update(conn); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update connection"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"allowlist": req.Allowlist})
}
