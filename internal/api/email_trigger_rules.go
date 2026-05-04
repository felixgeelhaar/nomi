package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/felixgeelhaar/nomi/internal/domain"
	"github.com/felixgeelhaar/nomi/internal/storage/db"
)

// EmailTriggerServer handles CRUD for email trigger rules.
// Routes are nested under /plugins/:id/connections/:conn_id/trigger-rules
// and guarded to only respond for the email plugin.
type EmailTriggerServer struct {
	triggerRepo *db.EmailTriggerRepository
}

// NewEmailTriggerServer constructs a new server.
func NewEmailTriggerServer(triggerRepo *db.EmailTriggerRepository) *EmailTriggerServer {
	return &EmailTriggerServer{triggerRepo: triggerRepo}
}

// ListEmailTriggerRules returns all trigger rules for a connection.
func (s *EmailTriggerServer) ListEmailTriggerRules(c *gin.Context) {
	if c.Param("id") != "com.nomi.email" {
		c.JSON(http.StatusNotFound, gin.H{"error": "trigger rules only available for email plugin"})
		return
	}
	connID := c.Param("conn_id")
	rules, err := s.triggerRepo.ListByConnection(connID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list trigger rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

// CreateEmailTriggerRule creates a new trigger rule.
func (s *EmailTriggerServer) CreateEmailTriggerRule(c *gin.Context) {
	if c.Param("id") != "com.nomi.email" {
		c.JSON(http.StatusNotFound, gin.H{"error": "trigger rules only available for email plugin"})
		return
	}
	connID := c.Param("conn_id")
	var req domain.TriggerRule
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if strings.TrimSpace(req.AssistantID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "assistant_id is required"})
		return
	}
	if err := s.triggerRepo.Create(&req, connID, req.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create trigger rule"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rule": req})
}

// UpdateEmailTriggerRule updates an existing trigger rule by name.
func (s *EmailTriggerServer) UpdateEmailTriggerRule(c *gin.Context) {
	if c.Param("id") != "com.nomi.email" {
		c.JSON(http.StatusNotFound, gin.H{"error": "trigger rules only available for email plugin"})
		return
	}
	connID := c.Param("conn_id")
	name := c.Param("name")
	var req domain.TriggerRule
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	if err := s.triggerRepo.Update(connID, name, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update trigger rule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": req})
}

// DeleteEmailTriggerRule deletes a trigger rule by name.
func (s *EmailTriggerServer) DeleteEmailTriggerRule(c *gin.Context) {
	if c.Param("id") != "com.nomi.email" {
		c.JSON(http.StatusNotFound, gin.H{"error": "trigger rules only available for email plugin"})
		return
	}
	connID := c.Param("conn_id")
	name := c.Param("name")
	if err := s.triggerRepo.Delete(connID, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete trigger rule"})
		return
	}
	c.Status(http.StatusNoContent)
}
