package api

import (
	"github.com/gin-gonic/gin"
	"github.com/felixgeelhaar/nomi/internal/domain"
)

// respondError writes a JSON error response. If err is a *domain.UserError,
// the response includes structured code/title/message/action fields so the UI
// can render a tailored message and action button.
func respondError(c *gin.Context, status int, err error) {
	if ue, ok := err.(*domain.UserError); ok {
		payload := gin.H{
			"error":   ue.Message,
			"code":    ue.Code,
			"title":   ue.Title,
			"message": ue.Message,
		}
		if ue.Action != "" {
			payload["action"] = ue.Action
		}
		c.JSON(status, payload)
		return
	}
	c.JSON(status, gin.H{"error": err.Error()})
}
