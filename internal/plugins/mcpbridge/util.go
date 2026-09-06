package mcpbridge

import (
	"strings"
	"unicode"
)

// splitArgs is a comma-then-space split. Quoted strings with embedded
// commas aren't supported; the args field is for simple invocations
// like "run --dir /tmp".
func splitArgs(csv string) []string {
	if csv == "" {
		return nil
	}
	fields := strings.FieldsFunc(csv, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('_')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "_")
}

func shortID(id string) string {
	id = strings.ReplaceAll(id, "-", "")
	if len(id) > 6 {
		return id[:6]
	}
	return id
}
