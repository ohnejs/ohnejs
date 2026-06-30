/**
 * Static metadata for a dashboard page, independent of its module.
 * This is what dashboard page discovery produces.
 */
export interface DiscoveredDashboardPage {
  /**
   * URL route pattern, always starting with `/`.
   */
  pattern: string;

  /**
   * Page module path relative to the layer's dashboard directory, used to build the served URL.
   */
  module: string;

  /**
   * Absolute path of the file the page was discovered in.
   */
  file: string;

  /**
   * Name of the layer that owns the page.
   */
  layer: string;
}

/**
 * Subdirectory within a layer's dashboard directory that holds page files.
 */
export const DASHBOARD_PAGES_DIR = 'pages';
