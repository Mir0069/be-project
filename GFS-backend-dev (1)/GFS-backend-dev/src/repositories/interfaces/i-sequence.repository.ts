export interface ISequenceRepository {
  /**
   * Atomically increments and returns the next sequence value for a given sequence name.
   * @param sequenceName e.g., "PRJ-2026"
   */
  getNextSequenceValue(sequenceName: string): Promise<number>;

  /**
   * Hands a drawn value back when the write it was drawn for did not happen.
   *
   * Conditional by design: it decrements ONLY while the counter still sits at
   * `value`, so a concurrent allocation that already moved past it is never
   * clobbered and two callers can never be handed the same number. Returns
   * whether the value was reclaimed; a false is normal under concurrency and
   * simply means the number stays spent.
   */
  releaseSequenceValue(sequenceName: string, value: number): Promise<boolean>;
}
