/**
 * A peer range taken apart into the versions it spans.
 */
export interface PeerRange {
  /**
   * The lowest version the range takes.
   */
  floor: string;

  /**
   * The first version it no longer takes, prereleases included.
   * A lone `>=floor`, as older releases published, ends at `floor`'s line.
   */
  ceiling: string;

  /**
   * Whether the range is one exact version, as a prerelease of a package declares.
   */
  exact: boolean;
}
