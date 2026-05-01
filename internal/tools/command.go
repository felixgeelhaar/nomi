package tools

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/felixgeelhaar/nomi/internal/domain"
)

// CommandExecTool executes shell commands with strict parsing, a clean env,
// and process-group isolation. It does NOT invoke a shell; metacharacters in
// the argv are refused.
type CommandExecTool struct{}

// NewCommandExecTool creates a new CommandExecTool
func NewCommandExecTool() *CommandExecTool {
	return &CommandExecTool{}
}

// Name returns the tool name
func (t *CommandExecTool) Name() string {
	return "command.exec"
}

// Capability returns the required capability
func (t *CommandExecTool) Capability() string {
	return "command.exec"
}

// Execute runs a single binary with its arguments.
//
// Input fields:
//   - command (string, required): the command line. Parsed like a POSIX shell
//     but executed directly (no /bin/sh). Metacharacters are refused.
//   - workspace_root (string, optional): if set, cwd must resolve inside it,
//     and an unset working_directory defaults to the root.
//   - working_directory (string, optional): cwd for the subprocess; validated
//     against workspace_root when both are set.
//   - env (map[string]string, optional): overrides merged onto the env
//     allowlist. The daemon's other env vars (secrets, tokens) are never
//     forwarded.
//   - allowed_binaries ([]string, optional): if non-empty, only argv[0]s with
//     a basename in this list are allowed to run.
//   - timeout (number, optional): seconds; default 30.
func (t *CommandExecTool) Execute(ctx context.Context, input map[string]interface{}) (map[string]interface{}, error) {
	rawCommand, ok := input["command"].(string)
	if !ok || rawCommand == "" {
		return nil, &domain.UserError{
			Code:    domain.ErrCodeToolExecution,
			Title:   "Missing command",
			Message: "Nomi needs a command to run. The planner may have forgotten to include it.",
		}
	}

	tokens, err := ParseCommand(rawCommand)
	if err != nil {
		return nil, err
	}

	// Optional binary allowlist.
	if rawList, ok := input["allowed_binaries"].([]interface{}); ok && len(rawList) > 0 {
		binary := filepath.Base(tokens[0])
		permitted := false
		for _, entry := range rawList {
			if s, ok := entry.(string); ok && s == binary {
				permitted = true
				break
			}
		}
		if !permitted {
			return nil, &domain.UserError{
				Code:    domain.ErrCodeBinaryNotAllowed,
				Title:   "Command not allowed",
				Message: fmt.Sprintf("The command %q isn't on the allowed list for this assistant. Open the assistant builder and add it to the allowed binaries, or change the permission rule to Confirm.", binary),
				Action:  "Open Assistant Builder",
			}
		}
	}

	workRoot, err := WorkspaceRootFromInput(input)
	if err != nil {
		return nil, err
	}

	// Resolve working directory. If both root and working_directory are set,
	// the directory must live inside the root.
	workDir := ""
	if raw, ok := input["working_directory"].(string); ok && raw != "" {
		if workRoot != "" {
			resolved, err := ResolveWithinRoot(workRoot, raw)
			if err != nil {
				return nil, fmt.Errorf("working_directory: %w", err)
			}
			workDir = resolved
		} else {
			// No root declared: keep legacy behavior of accepting an absolute
			// path, but only after filepath.Clean to collapse traversal.
			workDir = filepath.Clean(raw)
		}
	} else if workRoot != "" {
		workDir = workRoot
	}

	timeout := 30
	if v, ok := input["timeout"].(float64); ok {
		timeout = int(v)
	} else if v, ok := input["timeout"].(int); ok {
		timeout = v
	}
	cmdCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, tokens[0], tokens[1:]...)
	if workDir != "" {
		cmd.Dir = workDir
	}

	overrides := map[string]string{}
	if rawEnv, ok := input["env"].(map[string]interface{}); ok {
		for k, v := range rawEnv {
			overrides[k] = fmt.Sprintf("%v", v)
		}
	}
	cmd.Env = BuildSandboxEnv(overrides)
	cmd.SysProcAttr = sandboxSysProcAttr()

	output, runErr := cmd.CombinedOutput()

	result := map[string]interface{}{
		"command":   rawCommand,
		"argv":      tokens,
		"output":    string(output),
		"exit_code": 0,
		"work_dir":  workDir,
		"timed_out": false,
	}

	if cmdCtx.Err() == context.DeadlineExceeded {
		result["timed_out"] = true
		result["exit_code"] = -1
		return result, &domain.UserError{
			Code:    domain.ErrCodeCommandTimeout,
			Title:   "Command took too long",
			Message: fmt.Sprintf("The command didn't finish within %d seconds. Try a simpler task or increase the timeout.", timeout),
		}
	}

	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			result["exit_code"] = exitErr.ExitCode()
		} else {
			result["exit_code"] = -1
		}
		result["error"] = runErr.Error()
		return result, nil
	}

	return result, nil
}
