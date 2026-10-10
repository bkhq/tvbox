export interface JarProxyResult {
  /** HTTP status from the spider's Object[0]. */
  status: number;
  /** Object[1]. */
  mime: string;
  /** Object[3] when present, else {}. */
  headers: Record<string, string>;
  /** Object[2] InputStream fully read, base64. */
  body: string;
}

/**
 * Native `JarSpider` (Android only). Rejections carry the codes
 * ERR_JARSPIDER_LOAD, ERR_JARSPIDER_NO_SPIDER and ERR_JARSPIDER_CALL.
 */
export interface JarSpiderNative {
  /** com.github.catvod.Proxy.set(port): the port JARs build local URLs with. */
  setProxyPort(port: number): void;
  /** BaseLoader.parseJar(jar, recent): download/cache by url+md5, DexClassLoader, Init, Proxy hook. Resolves true when a loader exists for the jar afterwards. */
  loadJar(jar: string, recent: boolean): Promise<boolean>;
  /** JarLoader.setRecent(md5(jar)). */
  setRecent(jar: string): void;
  /** JarLoader.getSpider(key, api, ext, jar) incl. spider.siteKey and spider.init(context, ext). Rejects ERR_JARSPIDER_LOAD when the result would be SpiderNull (jar not loadable / class missing / init threw). */
  initSpider(key: string, api: string, ext: string, jar: string): Promise<void>;
  // Spider calls by site key (spider created by initSpider; otherwise reject ERR_JARSPIDER_NO_SPIDER).
  // Each resolves the raw String the spider returned (JSON text, may be ""); exceptions reject ERR_JARSPIDER_CALL with the throwable message.
  homeContent(key: string, filter: boolean): Promise<string>;
  homeVideoContent(key: string): Promise<string>;
  /** extendJson: {"k":"v"} -> HashMap<String,String>. */
  categoryContent(key: string, tid: string, pg: string, filter: boolean, extendJson: string): Promise<string>;
  /** idsJson: ["id1","id2"] -> List<String>. */
  detailContent(key: string, idsJson: string): Promise<string>;
  searchContent(key: string, keyword: string, quick: boolean, pg: string): Promise<string>;
  /** vipFlagsJson: ["qq",...] -> List<String>. */
  playerContent(key: string, flag: string, id: string, vipFlagsJson: string): Promise<string>;
  /** BaseLoader.proxy routed to JAR spiders only: siteKey param -> that JAR site's spider.proxy(params); otherwise JarLoader.proxy(params) (recent first, then others). Resolves null when nothing handled it (no JAR spider for siteKey, do=js, no loaders, every proxy returned null). */
  proxy(paramsJson: string): Promise<JarProxyResult | null>;
  /** JarLoader.jsonExt / jsonExtMix on the recent loader; resolve JSONObject.toString(). jxsJson: {"name":"url"} (LinkedHashMap<String,String>) resp. {"name":{"k":"v"}} (LinkedHashMap<String,HashMap<String,String>>). */
  jsonExt(key: string, jxsJson: string, url: string): Promise<string>;
  jsonExtMix(flag: string, key: string, name: string, jxsJson: string, url: string): Promise<string>;
  /** spider.destroy() for one site key and drop it. */
  destroySpider(key: string): Promise<void>;
  /** JarLoader.clear(): destroy all spiders, drop loaders/methods/recent. */
  clear(): Promise<void>;
}
