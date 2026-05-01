package main

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

func main() {
	path := flag.String("file", "", "path to audit export (json or ndjson)")
	flag.Parse()
	if *path == "" {
		fmt.Fprintln(os.Stderr, "usage: nomi-verify -file <path>")
		os.Exit(2)
	}

	raw, err := os.ReadFile(*path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read file: %v\n", err)
		os.Exit(1)
	}

	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "{") {
		if err := verifyJSON(raw); err != nil {
			fmt.Fprintf(os.Stderr, "verification failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("OK: JSON audit signature is valid")
		return
	}
	if err := verifyNDJSON(raw); err != nil {
		fmt.Fprintf(os.Stderr, "verification failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("OK: NDJSON audit signature is valid")
}

func verifyJSON(raw []byte) error {
	var envelope map[string]interface{}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	sigB64, _ := envelope["signature"].(string)
	pubB64, _ := envelope["public_key"].(string)
	if sigB64 == "" || pubB64 == "" {
		return fmt.Errorf("missing signature/public_key")
	}
	delete(envelope, "signature")
	payload, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pub, payload, sig) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

func verifyNDJSON(raw []byte) error {
	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	lines := make([]string, 0)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if len(lines) < 2 {
		return fmt.Errorf("not enough lines")
	}
	sigLine := lines[len(lines)-1]
	payload := strings.Join(lines[:len(lines)-1], "\n")

	var sigObj map[string]interface{}
	if err := json.Unmarshal([]byte(sigLine), &sigObj); err != nil {
		return err
	}
	sigB64, _ := sigObj["signature"].(string)
	pubB64, _ := sigObj["public_key"].(string)
	if sigB64 == "" || pubB64 == "" {
		return fmt.Errorf("missing signature/public_key")
	}
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pub, []byte(payload), sig) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}
