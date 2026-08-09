import '@testing-library/jest-dom/vitest';

// Node's own built-in `localStorage` global (stable since Node ~24, active
// by default -- hence the `--localstorage-file was provided without a
// valid path` warning) shadows jsdom's real implementation on both
// `globalThis` and `window` here, and is missing methods like `.clear`
// without a backing file configured. Replace it with a minimal in-memory
// Storage polyfill so `useStatus`'s localStorage calls behave the same way
// they do in a real browser, where this Node-specific shadowing doesn't
// exist.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(window, 'localStorage', {
  value: memoryStorage,
  configurable: true,
  writable: true,
});
