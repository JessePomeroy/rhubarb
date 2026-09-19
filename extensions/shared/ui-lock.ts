/** Cooperative queue for tools that replace Pi's interactive UI. */
export function createUiLock() {
  let tail: Promise<void> = Promise.resolve();
  return async function withLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  };
}

export const withUiLock = createUiLock();
