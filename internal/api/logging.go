package api

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// accessLogMiddleware logs only request metadata (method, path, status, latency).
// Request and response bodies are never logged: endpoints like PUT /connectors/:name/config
// and PUT /provider-profiles carry bot tokens and API keys that must not reach stdout/syslog.
func accessLogMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%-6s %-3d %-10s %s",
			c.Request.Method,
			c.Writer.Status(),
			time.Since(start).Round(time.Millisecond),
			c.Request.URL.Path,
		)
	}
}
