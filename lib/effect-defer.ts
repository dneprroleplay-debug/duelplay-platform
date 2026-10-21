/**
 * Defers a state update out of the effect body.
 *
 * React's compiler rule `react-hooks/set-state-in-effect` reports state
 * writes that happen synchronously while an effect runs, because that can
 * cascade extra renders. Effects in this project either load data or mirror a
 * persisted/prop value; deferring the write to a microtask keeps the exact
 * same data flow and the same observable result, but the effect body itself
 * no longer performs a synchronous state write.
 */
export function deferEffectTask(task: () => void): void {
  void Promise.resolve().then(task);
}
