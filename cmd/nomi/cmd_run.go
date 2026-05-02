package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// runCmd: submit a goal, drive the run end-to-end, return its output.
//
//	nomi run "summarize notes.md"
//	nomi run --assistant=Researcher --auto-approve "ack"
//
// Auto-approves plans by default (the typical headless flow). For
// confirm-mode capabilities (filesystem.write, command.exec), prompts
// the user on stdin unless --auto-approve is passed.
func runCmd(common *commonFlags, args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	bindCommonFlags(fs, common)
	assistant := fs.String("assistant", "", "assistant name (default: first configured)")
	autoApprove := fs.Bool("auto-approve", false, "auto-approve confirm-mode capabilities (DANGEROUS)")
	timeout := fs.Duration("timeout", 5*time.Minute, "give up after this long if the run doesn't reach a terminal state")
	_ = fs.Parse(args)

	rest := fs.Args()
	if len(rest) == 0 {
		fmt.Fprintln(os.Stderr, "nomi run: goal required")
		return 2
	}
	goal := strings.Join(rest, " ")

	cli, err := NewClient(common)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	// Resolve assistant id from name (or pick first if unspecified).
	asID, asName, err := resolveAssistant(cli, *assistant)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	var created struct {
		ID string `json:"id"`
	}
	if err := cli.Post("/runs", map[string]any{"goal": goal, "assistant_id": asID}, &created); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "▶ run %s submitted to %s\n", created.ID[:8], asName)

	deadline := time.Now().Add(*timeout)
	stdin := bufio.NewReader(os.Stdin)
	for time.Now().Before(deadline) {
		var detail struct {
			Run struct {
				Status string `json:"status"`
			} `json:"run"`
			Steps []struct {
				Title  string `json:"title"`
				Status string `json:"status"`
				Output string `json:"output,omitempty"`
				Error  string `json:"error,omitempty"`
			} `json:"steps"`
		}
		if err := cli.Get("/runs/"+created.ID, &detail); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}

		switch detail.Run.Status {
		case "plan_review":
			fmt.Fprintln(os.Stderr, "▶ plan ready, approving")
			_ = cli.Post("/runs/"+created.ID+"/plan/approve", map[string]any{}, nil)
		case "awaiting_approval":
			if !handleApproval(cli, created.ID, *autoApprove, stdin) {
				return 1
			}
		case "completed":
			for _, s := range detail.Steps {
				if s.Output != "" {
					fmt.Println(s.Output)
				}
			}
			fmt.Fprintln(os.Stderr, "✓ done")
			return 0
		case "failed":
			for _, s := range detail.Steps {
				if s.Error != "" {
					fmt.Fprintf(os.Stderr, "✗ %s: %s\n", s.Title, s.Error)
				}
			}
			return 1
		case "cancelled":
			fmt.Fprintln(os.Stderr, "✗ cancelled")
			return 1
		}
		time.Sleep(2 * time.Second)
	}
	fmt.Fprintf(os.Stderr, "✗ timed out after %s\n", *timeout)
	return 1
}

func resolveAssistant(cli *Client, name string) (id, resolvedName string, err error) {
	var list struct {
		Assistants []struct {
			ID, Name string
		} `json:"assistants"`
	}
	if err := cli.Get("/assistants", &list); err != nil {
		return "", "", err
	}
	if len(list.Assistants) == 0 {
		return "", "", fmt.Errorf("no assistants configured: run `nomi seed` or open the desktop wizard first")
	}
	if name == "" {
		return list.Assistants[0].ID, list.Assistants[0].Name, nil
	}
	for _, a := range list.Assistants {
		if a.Name == name {
			return a.ID, a.Name, nil
		}
	}
	return "", "", fmt.Errorf("assistant %q not found (have: %s)", name, joinNames(list.Assistants))
}

func joinNames(as []struct{ ID, Name string }) string {
	out := make([]string, 0, len(as))
	for _, a := range as {
		out = append(out, a.Name)
	}
	return strings.Join(out, ", ")
}

// handleApproval drains every pending approval card. Returns false on
// fatal error or user abort, true if all approvals were resolved.
func handleApproval(cli *Client, runID string, auto bool, stdin *bufio.Reader) bool {
	var list struct {
		Approvals []struct {
			ID         string         `json:"id"`
			RunID      string         `json:"run_id"`
			Status     string         `json:"status"`
			Capability string         `json:"capability"`
			Metadata   map[string]any `json:"metadata"`
		} `json:"approvals"`
	}
	if err := cli.Get("/approvals", &list); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return false
	}
	for _, a := range list.Approvals {
		if a.RunID != runID || a.Status != "pending" {
			continue
		}
		ok := auto
		if !auto {
			fmt.Fprintf(os.Stderr, "? approve %s ", a.Capability)
			if t, _ := a.Metadata["tool"].(string); t != "" {
				fmt.Fprintf(os.Stderr, "(tool: %s) ", t)
			}
			fmt.Fprint(os.Stderr, "[y/N]: ")
			line, _ := stdin.ReadString('\n')
			ok = strings.EqualFold(strings.TrimSpace(line), "y") ||
				strings.EqualFold(strings.TrimSpace(line), "yes")
		}
		body := map[string]any{"approved": ok}
		if err := cli.Post("/approvals/"+a.ID+"/resolve", body, nil); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return false
		}
	}
	return true
}
