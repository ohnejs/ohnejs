/**
 * Static metadata for a dashboard boot file.
 * This is what dashboard boot discovery produces.
 */
export interface DiscoveredDashboardBoot {
  /**
   * Boot file path relative to the layer's dashboard directory, used to build the served URL.
   * It is the file's identity across layers: a closer layer's file at the same path replaces it.
   */
  module: string;

  /**
   * Absolute path of the boot file.
   */
  file: string;

  /**
   * Name of the layer that owns the boot file.
   */
  layer: string;
}

/**
 * Subdirectory within a layer's dashboard directory that holds boot files.
 */
export const DASHBOARD_BOOT_DIR = 'boot';
