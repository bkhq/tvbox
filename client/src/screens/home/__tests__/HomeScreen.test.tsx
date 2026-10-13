import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  TVFocusGuideView,
} from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  type Bootstrap,
  BootstrapProvider,
  createBootstrap,
} from "../../../core/bootstrap";
import {
  parseVodConfig,
  type VodConfig,
  type VodConfigPrefs,
} from "../../../core/config";
import type { ServerLink } from "../../../core/serverLink";
import {
  registerProvider,
  resetProviderRegistry,
  type SiteProvider,
} from "../../../core/provider";
import { appSettings, createSettingsStore } from "../../../core/settings";
import { createConfigRepository, MemoryStore } from "../../../core/storage";
import { normalizeResult, type Result } from "../../../core/types";
import HomeScreen from "..";

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  TextInput,
  TVFocusGuideView,
];

const mockNavigate = jest.fn();
jest.mock("../../../navigation/useAppNavigation", () => ({
  useAppNavigation: () => ({ navigate: mockNavigate }),
}));

const URL = "https://example.com/config.json";
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: "jar", name: "Jar 站", type: 3, api: "csp_Jar" },
    {
      key: "cms",
      name: "CMS 站",
      type: 1,
      api: "https://cms.example.com/api.php/provide/vod",
    },
    {
      key: "xml",
      name: "XML 站",
      type: 0,
      api: "https://xml.example.com/api.php/provide/vod/at/xml",
    },
    { key: "py", name: "Py 站", type: 3, api: "https://example.com/spider.py" },
  ],
});

const CLASSES = [
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "剧集" },
];

function vods(siteKey: string) {
  return [1, 2].map((n) => ({
    vod_id: `${siteKey}-${n}`,
    vod_name: `${siteKey} 影片 ${n}`,
    vod_pic: `https://img.example.com/${siteKey}-${n}.jpg`,
    vod_remarks: "更新至1集",
  }));
}

interface MockOptions {
  /** Sites whose home() rejects. */
  failing?: Set<string>;
  /** Sites whose homeVideo() is empty, so home() carries the list. */
  homeList?: Set<string>;
  /** Sites without any videos. */
  noVideos?: Set<string>;
}

function mockProviders(options: MockOptions = {}) {
  const home = jest.fn(async (site: string): Promise<Result> => {
    if (options.failing?.has(site)) throw new Error("home failed");
    const list =
      options.homeList?.has(site) && !options.noVideos?.has(site)
        ? vods(`${site}-home`)
        : [];
    return normalizeResult({ class: CLASSES, list });
  });
  const homeVideo = jest.fn(async (site: string): Promise<Result> =>
    normalizeResult({
      list:
        options.homeList?.has(site) || options.noVideos?.has(site)
          ? []
          : vods(site),
    }),
  );
  registerProvider({
    id: "test",
    match: (site) => site.key === "cms" || site.key === "xml",
    create: (site) =>
      ({
        site,
        home: () => home(site.key),
        homeVideo: () => homeVideo(site.key),
      }) as unknown as SiteProvider,
  });
  return { home, homeVideo };
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().join(""));
}

async function setup(options: {
  saved?: boolean;
  load?: (url: string, prefs?: VodConfigPrefs) => Promise<VodConfig>;
  link?: Partial<ServerLink>;
}) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, "vod");
  const settings = createSettingsStore(store);
  if (options.saved) {
    await configs.add({ url: URL, name: "我的配置" });
    await configs.setActive(URL);
  }
  const loadConfig = jest.fn(
    options.load ??
      ((url: string, _prefs?: VodConfigPrefs) =>
        Promise.resolve(parseVodConfig(CONFIG_TEXT, url))),
  );
  const link =
    options.link &&
    ({
      init: jest.fn(async () => undefined),
      onConfigError: jest.fn(),
      ...options.link,
    } as ServerLink);
  const bootstrap = createBootstrap({
    configs,
    settings,
    loadConfig: (url, prefs) => loadConfig(url, prefs),
    createServerLink: link ? () => link : undefined,
  });
  await bootstrap.start();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <HomeScreen />
      </BootstrapProvider>,
    );
  });
  return {
    renderer,
    bootstrap: bootstrap as Bootstrap,
    configs,
    loadConfig,
    link,
  };
}

function byTestID(renderer: ReactTestRenderer, testID: string) {
  const [node] = renderer.root.findAll(
    (item) => item.props.testID === testID && typeof item.type !== "string",
  );
  if (!node) throw new Error(`No element with testID ${testID}`);
  return node;
}

describe("HomeScreen", () => {
  beforeEach(async () => {
    mockNavigate.mockClear();
    await appSettings.set("homeSiteKey", "");
  });
  afterEach(() => resetProviderRegistry());

  it.each(["ready", "empty", "error"])("opens Live from the %s home screen", async (status) => {
    mockProviders();
    const { renderer } = await setup({
      saved: status !== "empty",
      ...(status === "error" ? { load: async () => { throw new Error("config unavailable"); } } : {}),
    });
    await act(async () => byTestID(renderer, "home-nav-Live").props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith("Live");
    await act(async () => renderer.unmount());
  });

  it("shows the home site classes and videos", async () => {
    const { home, homeVideo } = mockProviders();
    const { renderer, loadConfig } = await setup({ saved: true });
    expect(loadConfig).toHaveBeenCalledWith(URL, { home: undefined });
    expect(home).toHaveBeenCalledWith("cms");
    expect(homeVideo).toHaveBeenCalledWith("cms");
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        "首页",
        "CMS 站",
        "电影",
        "剧集",
        "cms 影片 1",
        "cms 影片 2",
      ]),
    );

    expect(byTestID(renderer, "vod-card-cms-1").props.hasTVPreferredFocus).toBe(
      true,
    );
    expect(
      byTestID(renderer, "home-class-movie").props.hasTVPreferredFocus,
    ).toBe(false);
    expect(
      byTestID(renderer, "home-switch-site").props.hasTVPreferredFocus,
    ).toBe(false);

    await act(async () => byTestID(renderer, "home-class-tv").props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith("Category", {
      siteKey: "cms",
      typeId: "tv",
      typeName: "剧集",
    });

    await act(async () => byTestID(renderer, "vod-card-cms-2").props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith("Detail", {
      siteKey: "cms",
      vodId: "cms-2",
      vodName: "cms 影片 2",
      vodPic: "https://img.example.com/cms-2.jpg",
    });

    await act(async () =>
      byTestID(renderer, "home-nav-Settings").props.onPress(),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith("Settings");

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(["搜索", "历史记录", "收藏", "手机控制", "设置"]),
    );
    await act(async () =>
      byTestID(renderer, "home-nav-Control").props.onPress(),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith("Control");
    await act(async () => renderer.unmount());
  });

  it("falls back to the homeContent list and focuses the first tab without videos", async () => {
    mockProviders({ homeList: new Set(["cms"]) });
    const fallback = await setup({ saved: true });
    expect(texts(fallback.renderer)).toContain("cms-home 影片 1");
    await act(async () => fallback.renderer.unmount());

    resetProviderRegistry();
    mockProviders({ noVideos: new Set(["cms"]) });
    const { renderer } = await setup({ saved: true });
    expect(texts(renderer)).toContain("暂无内容");
    expect(
      byTestID(renderer, "home-class-movie").props.hasTVPreferredFocus,
    ).toBe(true);
    expect(
      byTestID(renderer, "home-switch-site").props.hasTVPreferredFocus,
    ).toBe(false);
    await act(async () => renderer.unmount());
  });

  it("switches the home site from the picker and reloads the content", async () => {
    const { home } = mockProviders();
    const { renderer } = await setup({ saved: true });
    expect(
      renderer.root.findAllByProps({ testID: "home-site-picker" }),
    ).toHaveLength(0);

    await act(async () =>
      byTestID(renderer, "home-switch-site").props.onPress(),
    );
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        "Jar 站",
        "CMS 站",
        "XML 站",
        "Py 站",
        "不支持：JAR 爬虫",
        "不支持：Python 爬虫",
      ]),
    );
    const cms = byTestID(renderer, "home-site-cms");
    expect(cms.props.hasTVPreferredFocus).toBe(true);
    expect(
      cms.findAllByType(Text).map((node) => node.props.children),
    ).toContain("首页");
    expect(byTestID(renderer, "home-site-jar").props.disabled).toBe(true);
    expect(byTestID(renderer, "vod-card-cms-1").props.hasTVPreferredFocus).toBe(
      false,
    );

    await act(async () => byTestID(renderer, "home-site-xml").props.onPress());
    expect(appSettings.get("homeSiteKey")).toBe("xml");
    expect(
      renderer.root.findAllByProps({ testID: "home-site-picker" }),
    ).toHaveLength(0);
    expect(home).toHaveBeenLastCalledWith("xml");
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(["XML 站", "xml 影片 1"]),
    );
    expect(texts(renderer)).not.toContain("cms 影片 1");
    await act(async () => renderer.unmount());
  });

  it("closes the picker without changing the site", async () => {
    mockProviders();
    const { renderer } = await setup({ saved: true });
    await act(async () =>
      byTestID(renderer, "home-switch-site").props.onPress(),
    );
    // Hardware back (Android) / Menu (tvOS) arrives as Modal.onRequestClose.
    await act(async () =>
      renderer.root.findByType(Modal).props.onRequestClose(),
    );
    expect(
      renderer.root.findAllByProps({ testID: "home-site-picker" }),
    ).toHaveLength(0);
    expect(appSettings.get("homeSiteKey")).toBe("");
    await act(async () => renderer.unmount());
  });

  it("shows provider errors with a retry while the top bar stays usable", async () => {
    const failing = new Set(["cms"]);
    const { home } = mockProviders({ failing });
    const { renderer } = await setup({ saved: true });
    expect(texts(renderer)).toContain("加载失败：home failed");
    expect(
      byTestID(renderer, "home-error-retry").props.hasTVPreferredFocus,
    ).toBe(true);
    expect(
      byTestID(renderer, "home-switch-site").props.hasTVPreferredFocus,
    ).toBe(false);

    failing.clear();
    await act(async () =>
      byTestID(renderer, "home-error-retry").props.onPress(),
    );
    expect(home).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain("cms 影片 1");

    await act(async () =>
      byTestID(renderer, "home-nav-Search").props.onPress(),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith("Search");
    await act(async () => renderer.unmount());
  });

  it("shows a message when no site is supported", async () => {
    const onlyJar = JSON.stringify({
      sites: [{ key: "jar", name: "Jar 站", type: 3, api: "csp_Jar" }],
    });
    const { renderer } = await setup({
      saved: true,
      load: (url) => Promise.resolve(parseVodConfig(onlyJar, url)),
    });
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(["首页", "没有可用站点"]),
    );
    expect(
      byTestID(renderer, "home-switch-site").props.hasTVPreferredFocus,
    ).toBe(true);
    await act(async () =>
      byTestID(renderer, "home-switch-site").props.onPress(),
    );
    expect(byTestID(renderer, "home-site-jar").props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });

  it("adds a config when none is saved", async () => {
    mockProviders();
    const { renderer, configs, loadConfig } = await setup({});
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(["尚未添加配置", "添加配置"]),
    );
    expect(loadConfig).not.toHaveBeenCalled();
    expect(
      renderer.root.findByProps({ testID: "home-config-input" }).props
        .hasTVPreferredFocus,
    ).toBe(true);

    await act(async () =>
      renderer.root
        .findByProps({ testID: "home-config-input" })
        .props.onChangeText(` ${URL} `),
    );
    await act(async () =>
      renderer.root.findByProps({ testID: "home-config-add" }).props.onPress(),
    );

    expect((await configs.getActive())?.url).toBe(URL);
    expect(loadConfig).toHaveBeenCalledWith(URL, { home: undefined });
    expect(texts(renderer)).toContain("cms 影片 1");
    await act(async () => renderer.unmount());
  });

  it("shows the load error, reports it to the server link and retries", async () => {
    mockProviders();
    const failure = new Error("HTTP 404: " + URL);
    let fail = true;
    const { renderer, loadConfig, link } = await setup({
      saved: true,
      load: (url) =>
        fail
          ? Promise.reject(failure)
          : Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
      link: {},
    });
    expect(link?.init).toHaveBeenCalled();
    expect(link?.onConfigError).toHaveBeenCalledWith(URL, failure);
    expect(texts(renderer)).toContain(`配置加载失败：${failure.message}`);
    expect(
      renderer.root.findByProps({ testID: "home-reload" }).props
        .hasTVPreferredFocus,
    ).toBe(true);

    fail = false;
    await act(async () =>
      renderer.root.findByProps({ testID: "home-reload" }).props.onPress(),
    );
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain("cms 影片 1");
    await act(async () => renderer.unmount());
  });

  it("shows a config the server link loads", async () => {
    let linkLoad: ((url: string) => Promise<unknown>) | undefined;
    const store = new MemoryStore();
    const configs = createConfigRepository(store, "vod");
    const bootstrap = createBootstrap({
      configs,
      settings: createSettingsStore(store),
      loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
      createServerLink: (load) => {
        linkLoad = load;
        return {
          init: async () => undefined,
          onConfigError: jest.fn(),
        } as unknown as ServerLink;
      },
    });
    await bootstrap.start();
    expect(bootstrap.getSnapshot().status).toBe("empty");

    // What the link does when a subscription is approved.
    await configs.add({ url: URL });
    await configs.setActive(URL);
    await linkLoad?.(URL);
    expect(bootstrap.getSnapshot()).toMatchObject({
      status: "ready",
      entry: { url: URL },
    });
  });
});
