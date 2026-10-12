package expo.modules.jarspider

/**
 * Streaming entry for the httpd /proxy route, called by reflection so the two
 * Expo modules have no compile-time dependency.
 */
object JarProxy {
  /**
   * Returns the catvod Object[] {Integer status, String mime, InputStream body,
   * Map<String, String> headers?} or null when no JAR spider handled the
   * request. A siteKey param routes to that JAR site's spider only (its
   * exceptions propagate, like the Java app); do=js is never handled here;
   * otherwise the recent jar's Proxy.proxy runs first, then the others.
   */
  @JvmStatic
  fun handle(params: Map<String, String>): Array<Any?>? = JarLoader.proxy(params)
}
