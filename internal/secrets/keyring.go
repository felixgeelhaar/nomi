package secrets

import (
	"errors"

	"github.com/zalando/go-keyring"
)

// keyringService is the service name used for every Nomi-owned keyring entry.
// macOS Keychain groups entries by service; Linux Secret Service uses it as a
// schema attribute; Windows Credential Manager treats it as part of the
// target name.
const keyringService = "ai.nomi"

// keyringStore delegates to the OS keyring via go-keyring. On macOS this is
// the user's Keychain, on Windows the Credential Manager, on Linux the
// Secret Service (gnome-keyring / kwallet / pass). The library handles the
// platform selection; if none of these is available go-keyring returns an
// error from every operation.
type keyringStore struct{}

func (keyringStore) Put(key, value string) error {
	return keyring.Set(keyringService, key, value)
}

func (keyringStore) Get(key string) (string, error) {
	v, err := keyring.Get(keyringService, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return v, err
}

func (keyringStore) Delete(key string) error {
	err := keyring.Delete(keyringService, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// keyringAvailable probes the host keyring by writing/reading/deleting a
// throwaway entry. A failure here is the signal to fall back to the
// encrypted file vault.
func keyringAvailable() error {
	const probe = "nomi.probe"
	if err := keyring.Set(keyringService, probe, "1"); err != nil {
		return err
	}
	if _, err := keyring.Get(keyringService, probe); err != nil {
		_ = keyring.Delete(keyringService, probe)
		return err
	}
	return keyring.Delete(keyringService, probe)
}
