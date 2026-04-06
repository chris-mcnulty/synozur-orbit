/**
 * Simple size-aware LRU cache that evicts entries when the total byte budget
 * is exceeded.  Designed for caching thumbnail image buffers.
 */
export class LRUCache<T> {
  private map = new Map<string, { value: T; size: number }>();
  private currentSize = 0;

  constructor(private maxBytes: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Move to end (most-recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, size: number): void {
    // Skip caching entries that exceed the total budget to preserve the maxBytes invariant
    if (size > this.maxBytes) return;

    // Remove existing entry if present
    const existing = this.map.get(key);
    if (existing) {
      this.currentSize -= existing.size;
      this.map.delete(key);
    }

    // Evict oldest entries until we have room
    while (this.currentSize + size > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value!;
      const oldEntry = this.map.get(oldest)!;
      this.currentSize -= oldEntry.size;
      this.map.delete(oldest);
    }

    this.map.set(key, { value, size });
    this.currentSize += size;
  }

  get entries(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.currentSize;
  }
}
