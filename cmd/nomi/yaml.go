package main

import "gopkg.in/yaml.v3"

// yamlUnmarshal exists so cmd_seed.go can parse seed.yaml without
// adding `gopkg.in/yaml.v3` to its own import set — keeps the
// subcommand file readable.
func yamlUnmarshal(raw []byte, out any) error { return yaml.Unmarshal(raw, out) }
