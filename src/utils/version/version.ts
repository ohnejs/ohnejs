/**
 * A version taken apart into its numbers and its prerelease identifiers.
 */
export interface Version {
  /**
   * The major number.
   */
  major: number;

  /**
   * The minor number.
   */
  minor: number;

  /**
   * The patch number.
   */
  patch: number;

  /**
   * The dot-separated prerelease identifiers, `[]` for a release.
   */
  prerelease: string[];
}
