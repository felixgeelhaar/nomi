//go:build !windows

package tools

import "syscall"

// sandboxSysProcAttr returns platform-specific process attributes that start
// the child in a new session/process group. This prevents signals sent to the
// daemon from propagating to subprocesses and keeps foreground-tty control
// from leaking into command.exec output.
func sandboxSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
