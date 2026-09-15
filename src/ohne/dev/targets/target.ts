/**
 * A codegen unit the dev supervisor can invalidate and regenerate on change.
 *
 * `affectedBy` is a dependency-closure containment test, not a file-set membership test.
 * It asks whether a changed path falls within everything the target reads.
 * So a brand-new file is caught even though no prior snapshot lists it.
 */
export interface Target {
  /**
   * Stable identifier for the target, used in logs.
   */
  id: string;

  /**
   * Whether `changedPath` falls inside this target's dependency closure.
   *
   * For a set-based target the closure is a set of directories, so the test is containment.
   */
  affectedBy(changedPath: string): boolean;

  /**
   * Regenerates the target's output.
   * Returns the absolute paths its generator produced, empty when the write was skipped.
   *
   * A set-based target skips the write when its file set is unchanged since the last `regen`.
   */
  regen(): Promise<string[]>;
}
