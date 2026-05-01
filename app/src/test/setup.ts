import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library renders into document.body; cleanup() unmounts and
// removes the container between tests so DOM state doesn't leak across tests.
afterEach(() => {
  cleanup();
});

// jsdom under Node 20 ships a stub localStorage object without working
// methods (the upstream v25 + Node 20 combination prints a
// `--localstorage-file` warning and exposes an empty {}). Replace it
// with an in-memory implementation so tests that exercise persistence
// helpers (updater defer, approval-panel visibility flag, …) behave
// like a real browser.
function installMemoryStorage(target: Storage | undefined): void {
  if (target && typeof target.setItem === "function") return;
  const store = new Map<string, string>();
  const impl: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, target === window.sessionStorage ? "sessionStorage" : "localStorage", {
    value: impl,
    writable: true,
    configurable: true,
  });
}

installMemoryStorage(window.localStorage);
installMemoryStorage(window.sessionStorage);
