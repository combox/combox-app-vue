export function yieldToMain(): Promise<void> {
  const anyGlobal = globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }
  if (anyGlobal.scheduler?.yield) return anyGlobal.scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

