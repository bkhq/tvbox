import { type ReactElement, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { selectHome } from "../../core/config";
import { useVodConfig } from "../../core/bootstrap";
import { getProvider, UnsupportedSiteError } from "../../core/provider";
import { useSetting } from "../../core/settings";
import type { Class, Site, SiteUnsupportedReason, Vod } from "../../core/types";
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from "../../navigation/useAppNavigation";
import type { RouteName } from "../../navigation/types";
import {
  colors,
  FocusableButton,
  fontSize,
  HorizontalRow,
  radius,
  spacing,
  useLayout,
} from "../../ui";
import {
  ErrorView,
  FocusableInput,
  LoadingView,
  openVod,
  VodGrid,
} from "../common";

const NAV_LINKS: {
  route: Extract<
    RouteName,
    "Settings" | "History" | "Collect" | "Search" | "Control"
  >;
  title: string;
}[] = [
  { route: "Search", title: "搜索" },
  { route: "History", title: "历史记录" },
  { route: "Collect", title: "收藏" },
  { route: "Control", title: "手机控制" },
  { route: "Settings", title: "设置" },
];

const REASON_TEXT: Record<SiteUnsupportedReason, string> = {
  jar: "JAR 爬虫",
  py: "Python 爬虫",
  type: "未知类型",
};

export function unsupportedText(site: Site): string {
  return `不支持：${site.unsupportedReason ? REASON_TEXT[site.unsupportedReason] : "未知原因"}`;
}

function NavBar({ preferFocus }: { preferFocus: boolean }) {
  const navigation = useAppNavigation();
  return (
    <View style={styles.nav}>
      {NAV_LINKS.map((link, index) => (
        <FocusableButton
          key={link.route}
          testID={`home-nav-${link.route}`}
          title={link.title}
          hasTVPreferredFocus={preferFocus && index === 0}
          onPress={() => navigation.navigate(link.route)}
        />
      ))}
    </View>
  );
}

function AddConfigForm({ preferFocus }: { preferFocus: boolean }) {
  const { addConfig } = useVodConfig();
  const [url, setUrl] = useState("");
  const submit = () => {
    if (url.trim()) void addConfig(url);
  };
  return (
    <View style={styles.form}>
      <FocusableInput
        testID="home-config-input"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        onSubmitEditing={submit}
        placeholder="输入配置地址"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hasTVPreferredFocus={preferFocus}
      />
      <FocusableButton
        testID="home-config-add"
        title="添加配置"
        disabled={!url.trim()}
        onPress={submit}
      />
    </View>
  );
}

function SiteRow({
  site,
  isHome,
  preferFocus,
  onSelect,
}: {
  site: Site;
  isHome: boolean;
  preferFocus: boolean;
  onSelect: (site: Site) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={`home-site-${site.key}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !site.supported, selected: isHome }}
      disabled={!site.supported}
      hasTVPreferredFocus={preferFocus}
      onPress={() => onSelect(site)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.site,
        focused && styles.siteFocused,
        !site.supported && styles.siteUnsupported,
      ]}
    >
      <Text style={styles.siteName} numberOfLines={1}>
        {site.name || site.key}
      </Text>
      {isHome ? <Text style={styles.homeBadge}>首页</Text> : null}
      {site.supported ? null : (
        <Text style={styles.unsupported}>{unsupportedText(site)}</Text>
      )}
    </Pressable>
  );
}

/**
 * SiteDialog: every site of the config, unsupported ones disabled. The
 * hardware back key (Android) and the Menu button (tvOS) call
 * onRequestClose, so back closes the picker before the screen is popped.
 */
function SitePicker({
  sites,
  homeKey,
  onClose,
}: {
  sites: Site[];
  homeKey?: string;
  onClose: () => void;
}) {
  const [, setHomeSiteKey] = useSetting("homeSiteKey");
  const { isTV } = useLayout();
  const select = (site: Site) => {
    onClose();
    void setHomeSiteKey(site.key);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          testID="home-site-picker"
          style={[styles.picker, isTV ? styles.pickerTV : styles.pickerPhone]}
        >
          <Text style={styles.pickerTitle}>切换站点</Text>
          <FlatList
            data={sites}
            keyExtractor={(site) => site.key}
            renderItem={({ item }) => (
              <SiteRow
                site={item}
                isHome={item.key === homeKey}
                preferFocus={item.key === homeKey}
                onSelect={select}
              />
            )}
          />
          <FocusableButton
            testID="home-site-picker-close"
            title="关闭"
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

type HomeState =
  | { status: "loading" }
  | { status: "ready"; classes: Class[]; videos: Vod[] }
  | { status: "error"; message: string };

/** SiteViewModel.homeContent + homeVideoContent of `site`; reloads when the site object (config) changes. */
function useHomeContent(site: Site | undefined): [HomeState, () => void] {
  const [attempt, setAttempt] = useState(0);
  // The result of one request; a different site or attempt reads as loading until its own result arrives.
  const [loaded, setLoaded] = useState<{
    site: Site;
    attempt: number;
    state: HomeState;
  }>();

  useEffect(() => {
    if (!site) return;
    let active = true;
    const load = async (): Promise<HomeState> => {
      const provider = getProvider(site);
      const [home, video] = await Promise.all([
        provider.home(true),
        provider.homeVideo().catch(() => undefined),
      ]);
      const videos = video && video.list.length > 0 ? video.list : home.list;
      return { status: "ready", classes: home.class, videos };
    };
    load().then(
      (state) => active && setLoaded({ site, attempt, state }),
      (error: unknown) => {
        if (!active) return;
        const message =
          error instanceof UnsupportedSiteError
            ? `站点不支持：${site.name || site.key}`
            : `加载失败：${error instanceof Error ? error.message : String(error)}`;
        setLoaded({ site, attempt, state: { status: "error", message } });
      },
    );
    return () => {
      active = false;
    };
  }, [site, attempt]);

  const state =
    loaded && loaded.site === site && loaded.attempt === attempt
      ? loaded.state
      : { status: "loading" as const };
  return [state, () => setAttempt((n) => n + 1)];
}

function HomeContent() {
  const navigation = useAppNavigation();
  const { config } = useVodConfig();
  const [homeSiteKey] = useSetting("homeSiteKey");
  const [pickerOpen, setPickerOpen] = useState(false);
  const sites = config?.sites ?? [];
  const home = selectHome(sites, homeSiteKey || config?.home?.key);
  const [state, retry] = useHomeContent(home);

  const classes = state.status === "ready" ? state.classes : [];
  const videos = state.status === "ready" ? state.videos : [];
  const focusVideo = !pickerOpen && videos.length > 0;
  const focusTab = !pickerOpen && !focusVideo && classes.length > 0;
  const focusSwitch =
    !pickerOpen &&
    !focusVideo &&
    !focusTab &&
    !(home && state.status === "error");

  let body: ReactElement;
  if (!home) {
    body = <Text style={styles.note}>没有可用站点</Text>;
  } else if (state.status === "loading") {
    body = <LoadingView />;
  } else if (state.status === "error") {
    body = (
      <ErrorView
        testID="home-error"
        message={state.message}
        onRetry={retry}
        hasTVPreferredFocus={!pickerOpen}
      />
    );
  } else {
    body = (
      <VodGrid
        items={videos}
        onPressVod={(vod) => openVod(navigation, home.key, vod)}
        preferFirstFocus={focusVideo}
        ListHeaderComponent={
          classes.length > 0 ? (
            <HorizontalRow
              testID="home-classes"
              data={classes}
              keyExtractor={(item, index) => `${index}-${item.type_id}`}
              renderItem={({ item, index }) => (
                <FocusableButton
                  testID={`home-class-${item.type_id}`}
                  title={item.type_name}
                  hasTVPreferredFocus={focusTab && index === 0}
                  onPress={() =>
                    navigation.navigate("Category", {
                      siteKey: home.key,
                      typeId: item.type_id,
                      typeName: item.type_name,
                    })
                  }
                />
              )}
            />
          ) : null
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>首页</Text>
        <Text style={styles.title} numberOfLines={1}>
          {home ? home.name || home.key : "首页"}
        </Text>
        <View style={styles.actions}>
          <NavBar preferFocus={false} />
          <FocusableButton
            testID="home-switch-site"
            title="切换站点"
            hasTVPreferredFocus={focusSwitch}
            onPress={() => setPickerOpen(true)}
          />
        </View>
      </View>
      {body}
      {pickerOpen ? (
        <SitePicker
          sites={sites}
          homeKey={home?.key}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

export default function HomeScreen() {
  const { status, error, reload } = useVodConfig();

  if (status === "loading") {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>首页</Text>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.note}>正在加载配置…</Text>
      </View>
    );
  }

  if (status === "ready") {
    return (
      <View style={styles.container}>
        <HomeContent />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.padded]}>
      <Text style={styles.title}>首页</Text>
      {status === "error" ? (
        <View>
          <Text
            style={styles.error}
          >{`配置加载失败：${error?.message ?? ""}`}</Text>
          <FocusableButton
            testID="home-reload"
            title="重试"
            hasTVPreferredFocus
            onPress={() => void reload()}
          />
        </View>
      ) : (
        <Text style={styles.note}>尚未添加配置</Text>
      )}
      <AddConfigForm preferFocus={status === "empty"} />
      <NavBar preferFocus={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  padded: {
    padding: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.display,
  },
  note: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  error: {
    marginVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body,
  },
  nav: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginVertical: spacing.md,
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.remarkBackground,
  },
  picker: {
    maxHeight: "90%",
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  pickerTV: {
    width: "50%",
  },
  pickerPhone: {
    width: "92%",
  },
  pickerTitle: {
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  form: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.md,
  },
  input: {
    flex: 1,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
  },
  site: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  siteFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.surfaceFocused,
  },
  siteUnsupported: {
    opacity: 0.5,
  },
  siteName: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.title,
  },
  homeBadge: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    color: colors.text,
    fontSize: fontSize.caption,
  },
  unsupported: {
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
});
