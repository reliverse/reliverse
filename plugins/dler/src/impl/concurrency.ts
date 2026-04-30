export function resolveConcurrency(
  value: unknown,
  options: { readonly defaultValue: number; readonly label: string },
): number {
  const rawValue = value ?? options.defaultValue;

  if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
    throw new Error(`${options.label} must be a positive integer.`);
  }

  if (rawValue < 1) {
    throw new Error(`${options.label} must be at least 1.`);
  }

  return rawValue;
}

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index] as TItem, index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
