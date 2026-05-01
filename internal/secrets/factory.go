package secrets

import (
	"log"
	"os"
)

// NewStore returns the best Store for the current host. It first probes the
// OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret
// Service) and falls back to the file vault if the keyring backend is
// unreachable. Headless Linux without D-Bus is the common case for the
// fallback.
//
// Set NOMI_DISABLE_KEYRING=1 to skip the probe and go straight to the
// file vault. Useful for demo / dev environments where the macOS
// keychain would prompt for biometric authorization nobody's there to
// grant, and for headless deployments where keychain access hangs
// indefinitely waiting for an interactive session.
//
// dataDir is used only by the file fallback for the key and vault files.
func NewStore(dataDir string) (Store, string, error) {
	if os.Getenv("NOMI_DISABLE_KEYRING") == "1" {
		log.Println("secrets: NOMI_DISABLE_KEYRING set, skipping keyring probe")
	} else if err := keyringAvailable(); err == nil {
		return keyringStore{}, "os_keyring", nil
	} else {
		log.Printf("secrets: OS keyring unavailable (%v); using encrypted file vault in %s", err, dataDir)
	}
	fs, err := newFileStore(dataDir)
	if err != nil {
		return nil, "", err
	}
	return fs, "file_vault", nil
}
