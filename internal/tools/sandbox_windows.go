//go:build windows

package tools

import "syscall"

// sandboxSysProcAttr returns platform-specific process attributes. On Windows
// we request a new process group so the child isn't killed by Ctrl+C sent to
// the daemon's console.
func sandboxSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: 0x00000200} // CREATE_NEW_PROCESS_GROUP
}
