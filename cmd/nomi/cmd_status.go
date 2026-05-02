package main

import (
	"flag"
	"fmt"
	"os"
)

// statusCmd: one-shot health + version + active default. Useful as the
// first command after deploying the daemon — confirms reachability,
// build version, and that an LLM is wired.
//
//	nomi status
func statusCmd(common *commonFlags, args []string) int {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	bindCommonFlags(fs, common)
	_ = fs.Parse(args)

	cli, err := NewClient(common)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	var health struct {
		Status string `json:"status"`
	}
	if err := cli.Get("/health", &health); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var version struct {
		Version, Commit, BuildDate string
	}
	_ = cli.Get("/version", &version)
	var defaults struct {
		ProviderID string `json:"provider_id"`
		ModelID    string `json:"model_id"`
	}
	_ = cli.Get("/settings/llm-default", &defaults)
	var safety struct {
		Profile string
	}
	_ = cli.Get("/settings/safety-profile", &safety)

	if common.JSON {
		printJSON(map[string]any{
			"url":         cli.URL,
			"health":      health.Status,
			"version":     version,
			"llm_default": defaults,
			"safety":      safety.Profile,
		})
		return 0
	}

	fmt.Printf("URL:           %s\n", cli.URL)
	fmt.Printf("Health:        %s\n", health.Status)
	fmt.Printf("Version:       %s (commit %s, built %s)\n",
		version.Version, version.Commit, version.BuildDate)
	if defaults.ProviderID != "" {
		fmt.Printf("Default LLM:   %s / %s\n", short(defaults.ProviderID), defaults.ModelID)
	} else {
		fmt.Printf("Default LLM:   (none configured — run `nomi seed` or open the wizard)\n")
	}
	fmt.Printf("Safety:        %s\n", safety.Profile)
	return 0
}
