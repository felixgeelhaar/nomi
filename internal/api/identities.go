package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/felixgeelhaar/nomi/internal/domain"
	"github.com/felixgeelhaar/nomi/internal/storage/db"
)

// IdentityServer exposes REST endpoints for managing channel identity
// allowlists (ADR 0001 §9). Identities are per-(plugin, connection), so
// the routes are nested under a connection.
type IdentityServer struct {
	repo *db.ChannelIdentityRepository
}

// NewIdentityServer constructs the identity endpoint handler.
func NewIdentityServer(repo *db.ChannelIdentityRepository) *IdentityServer {
	return &IdentityServer{repo: repo}
}

// ListIdentities returns every identity entry for a connection.
func (s *IdentityServer) ListIdentities(c *gin.Context) {
	connectionID := c.Param("conn_id")
	list, err := s.repo.ListByConnection(connectionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"identities": list})
}

// CreateIdentityRequest is the payload for POST .../identities.
type CreateIdentityRequest struct {
	ExternalIdentifier string   `json:"external_identifier"`
	DisplayName        string   `json:"display_name"`
	AllowedAssistants  []string `json:"allowed_assistants"`
	Enabled            bool     `json:"enabled"`
}

// CreateIdentity adds one entry to a connection's allowlist.
func (s *IdentityServer) CreateIdentity(c *gin.Context) {
	pluginID := c.Param("id")
	connectionID := c.Param("conn_id")
	var req CreateIdentityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ExternalIdentifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "external_identifier is required"})
		return
	}
	ident := &domain.ChannelIdentity{
		PluginID:           pluginID,
		ConnectionID:       connectionID,
		ExternalIdentifier: req.ExternalIdentifier,
		DisplayName:        req.DisplayName,
		AllowedAssistants:  req.AllowedAssistants,
		Enabled:            req.Enabled,
	}
	if err := s.repo.Create(ident); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ident)
}

// UpdateIdentityRequest patches an existing entry.
type UpdateIdentityRequest struct {
	DisplayName       *string   `json:"display_name,omitempty"`
	AllowedAssistants *[]string `json:"allowed_assistants,omitempty"`
	Enabled           *bool     `json:"enabled,omitempty"`
}

// UpdateIdentity modifies fields on one allowlist entry.
func (s *IdentityServer) UpdateIdentity(c *gin.Context) {
	identID := c.Param("ident_id")
	// The repo has no GetByID yet — list + filter in the handler. Cheap
	// since the list is per-connection and small.
	connectionID := c.Param("conn_id")
	existing, err := s.repo.ListByConnection(connectionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var target *domain.ChannelIdentity
	for _, e := range existing {
		if e.ID == identID {
			target = e
			break
		}
	}
	if target == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "identity not found"})
		return
	}
	var req UpdateIdentityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.DisplayName != nil {
		target.DisplayName = *req.DisplayName
	}
	if req.AllowedAssistants != nil {
		target.AllowedAssistants = *req.AllowedAssistants
	}
	if req.Enabled != nil {
		target.Enabled = *req.Enabled
	}
	if err := s.repo.Update(target); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, target)
}

// DeleteIdentity removes one entry.
func (s *IdentityServer) DeleteIdentity(c *gin.Context) {
	identID := c.Param("ident_id")
	if err := s.repo.Delete(identID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
