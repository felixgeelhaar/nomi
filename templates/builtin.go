package templates

import (
	"embed"
	"encoding/json"
	"fmt"

	"github.com/felixgeelhaar/nomi/internal/domain"
)

//go:embed built-in.json
var builtInFS embed.FS

// BuiltIn loads bundled assistant templates from templates/built-in.json.
func BuiltIn() ([]domain.AssistantDefinition, error) {
	raw, err := builtInFS.ReadFile("built-in.json")
	if err != nil {
		return nil, fmt.Errorf("read built-in templates: %w", err)
	}

	var out []domain.AssistantDefinition
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse built-in templates: %w", err)
	}
	return out, nil
}
