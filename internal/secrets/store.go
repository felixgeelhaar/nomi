// Package secrets holds the implementation of Nomi's at-rest secret
// management. Bot tokens, LLM provider API keys, and any future credentials
// are stored outside the SQLite database — either in the OS keyring (macOS
// Keychain, Windows Credential Manager, Linux Secret Service) when
// available, or in an AES-GCM-encrypted vault file next to the database
// with a 0600 key file on hosts where the keyring backend is absent
// (typical for headless Linux without D-Bus).
//
// The SQLite database stores only reference URIs of the form
// `secret://<key>`, never the plaintext value. Callers treat inputs that
// don't match the reference prefix as plaintext for backward-compatible
// migration paths — a value read from the DB before migration may still be
// plaintext; Resolve handles both cases so the read path never has to
// distinguish.
package secrets

import (
	"fmt"
	"strings"
)

// Store is the minimal key/value secret store interface. Implementations
// must store values opaquely and return them only when asked by key.
type Store interface {
	// Put associates value with key. Overwrites any existing entry.
	Put(key, value string) error
	// Get returns the value for key. Returns (_, ErrNotFound) if absent.
	Get(key string) (string, error)
	// Delete removes the entry if present; no-op if absent.
	Delete(key string) error
}

// ErrNotFound is returned by Store.Get when the key does not exist.
var ErrNotFound = fmt.Errorf("secret not found")

// ReferencePrefix is the URI scheme used to mark a stored reference.
// Plaintext inputs never carry this prefix, so IsReference is enough to
// distinguish "already in the vault" from "needs to be migrated."
const ReferencePrefix = "secret://"

// IsReference reports whether s looks like a secret reference produced by
// this package.
func IsReference(s string) bool {
	return strings.HasPrefix(s, ReferencePrefix)
}

// NewReference builds a canonical reference for the given key.
func NewReference(key string) string {
	return ReferencePrefix + key
}

// KeyFromReference extracts the underlying key from a reference. Returns
// ("", false) if ref isn't a reference.
func KeyFromReference(ref string) (string, bool) {
	if !IsReference(ref) {
		return "", false
	}
	return strings.TrimPrefix(ref, ReferencePrefix), true
}

// Resolve returns the plaintext for a reference, or the input itself if it
// isn't a reference (which happens transiently while a plaintext value
// from a pre-migration DB row is being used). Errors from the underlying
// store are passed through so callers can distinguish "not found" from
// "backend broken."
func Resolve(s Store, ref string) (string, error) {
	key, ok := KeyFromReference(ref)
	if !ok {
		return ref, nil
	}
	return s.Get(key)
}

// StoreAsReference writes value into the store under key and returns the
// canonical reference URI that should be persisted in the DB in place of
// the plaintext.
func StoreAsReference(s Store, key, value string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("secret key is required")
	}
	if err := s.Put(key, value); err != nil {
		return "", err
	}
	return NewReference(key), nil
}
