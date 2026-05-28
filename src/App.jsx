import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "follow_blue_oval_app_v1";
const AUTO_YOUTUBE_SYNC_STORAGE_KEY = "follow_last_auto_youtube_sync_at";
const GLOBAL_SYNC_STORAGE_KEY = "follow_last_global_sync_at";
const PLATFORM_ORDER_STORAGE_KEY = "follow_platform_order";
const PLATFORM_VISIBILITY_STORAGE_KEY = "follow_platform_visibility";
const DEFAULT_PLATFORM_ORDER = ["youtube", "instagram", "bilibili", "xiaohongshu", "weibo", "rss"];
const LEGACY_DEFAULT_PLATFORM_ORDER = ["youtube", "bilibili", "xiaohongshu", "weibo", "instagram", "rss"];
const DEFAULT_PLATFORM_VISIBILITY = {
  youtube: true,
  instagram: true,
  bilibili: true,
  xiaohongshu: false,
  weibo: false,
  rss: false
};
const YOUTUBE_FEED_BASE_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const initialPlatforms = [
  { id: "youtube", name: "YouTube", syncType: "manual", homepageUrl: "https://www.youtube.com", connected: false, creators: [] },
  { id: "instagram", name: "Instagram", syncType: "manual", homepageUrl: "https://www.instagram.com", connected: false, creators: [] },
  { id: "bilibili", name: "B站", syncType: "manual", homepageUrl: "https://www.bilibili.com", connected: false, creators: [] },
  { id: "xiaohongshu", name: "小红书", syncType: "manual", homepageUrl: "https://www.xiaohongshu.com", connected: false, creators: [] },
  { id: "weibo", name: "微博", syncType: "manual", homepageUrl: "https://weibo.com", connected: false, creators: [] },
  { id: "rss", name: "RSS", syncType: "rss", homepageUrl: "", connected: false, creators: [] }
];

function usesCreatorSyncState(platformId) {
  return platformId === "youtube";
}

function getYouTubeFeedUrl(channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  return normalizedChannelId ? `${YOUTUBE_FEED_BASE_URL}${encodeURIComponent(normalizedChannelId)}` : "";
}

function createCreator(platformId, name, homepageUrl, sourceId, updates = [], extra = {}) {
  return {
    id: extra.id || `${platformId}-${sourceId || Date.now()}`,
    name,
    avatar: name.slice(0, 1).toUpperCase(),
    homepageUrl,
    sourceId: sourceId || "",
    selected: true,
    updates,
    ...extra
  };
}

function createUpdate(id, time, title, url, read = false, extra = {}) {
  return { id, title, url, time, read, ...extra };
}

function normalizePlatforms(platforms) {
  const platformMap = new Map(Array.isArray(platforms) ? platforms.map((platform) => [platform.id, platform]) : []);

  const normalizedPlatforms = initialPlatforms.map((defaultPlatform) => {
    const savedPlatform = platformMap.get(defaultPlatform.id);
    if (!savedPlatform) return defaultPlatform;

    return {
      ...defaultPlatform,
      ...savedPlatform,
      creators: normalizeCreators(savedPlatform)
    };
  });

  return cleanupAllPlatforms(normalizedPlatforms);
}

function normalizeCreators(platform) {
  if (Array.isArray(platform.creators)) {
    return platform.creators.map((creator) => {
      const youtubeSourceId = platform.id === "youtube" ? normalizeYouTubeChannelId(creator.sourceId) : creator.sourceId;
      const youtubeInfo = platform.id === "youtube" ? resolveYouTubeChannelInfo(creator.homepageUrl || creator.handle || "") : null;
      const bilibiliUid = platform.id === "bilibili" ? extractBilibiliUid(creator.uid || creator.sourceId || creator.homepageUrl) : "";

      return {
        ...creator,
        avatar: creator.avatar || creator.name?.slice(0, 1).toUpperCase() || "?",
        sourceId:
          platform.id === "youtube"
            ? youtubeSourceId || youtubeInfo?.sourceId || ""
            : platform.id === "bilibili"
              ? bilibiliUid
              : creator.sourceId,
        feedUrl:
          platform.id === "youtube" && youtubeSourceId
            ? creator.feedUrl || getYouTubeFeedUrl(youtubeSourceId)
            : creator.feedUrl || youtubeInfo?.feedUrl,
        handle: platform.id === "youtube" ? creator.handle || youtubeInfo?.handle || "" : creator.handle,
        uid: platform.id === "bilibili" ? bilibiliUid : creator.uid,
        homepageUrl: platform.id === "bilibili" && bilibiliUid ? normalizeBilibiliHomepage(bilibiliUid) : creator.homepageUrl,
        knownGoodFeedUrl: platform.id === "youtube" ? normalizeYouTubeFeedUrl(creator.knownGoodFeedUrl) : creator.knownGoodFeedUrl,
        knownGoodSourceId:
          platform.id === "youtube" ? normalizeYouTubeChannelId(creator.knownGoodSourceId) : creator.knownGoodSourceId,
        lastSuccessfulSyncAt: usesCreatorSyncState(platform.id) ? creator.lastSuccessfulSyncAt || "" : creator.lastSuccessfulSyncAt,
        syncFailCount: usesCreatorSyncState(platform.id) ? Number(creator.syncFailCount || 0) : creator.syncFailCount,
        syncStatus: usesCreatorSyncState(platform.id) ? creator.syncStatus || "active" : creator.syncStatus,
        lastSyncError: usesCreatorSyncState(platform.id) ? creator.lastSyncError || null : creator.lastSyncError,
        lastSyncErrorAt: usesCreatorSyncState(platform.id) ? creator.lastSyncErrorAt || "" : creator.lastSyncErrorAt,
        selected: creator.selected !== false,
        updates: Array.isArray(creator.updates) ? creator.updates : []
      };
    });
  }

  if (!Array.isArray(platform.updates)) return [];

  return platform.updates.map((update) =>
    createCreator(
      platform.id,
      update.creator,
      update.url,
      `legacy-${update.id}`,
      [createUpdate(update.id, update.time, update.title, update.url, update.read)]
    )
  );
}

function getUpdateSortTime(update) {
  const candidates = [update.publishedAt, update.updatedAt, update.createdAt, update.time];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  return null;
}

function sortUpdatesByRecency(updates) {
  return updates
    .map((update, index) => ({ update, index, timestamp: getUpdateSortTime(update) }))
    .sort((first, second) => {
      if (first.timestamp !== null && second.timestamp !== null) return second.timestamp - first.timestamp;
      return first.index - second.index;
    })
    .map(({ update }) => update);
}

function cleanupCreatorUpdates(creator) {
  const updates = Array.isArray(creator.updates) ? creator.updates : [];
  const unreadUpdates = sortUpdatesByRecency(updates.filter((update) => !update.read));
  const readUpdates = updates.filter((update) => update.read);
  const latestUnread = unreadUpdates[0];
  const extraUnreadAsRead = unreadUpdates.slice(1).map((update) => ({ ...update, read: true }));
  const latestReadUpdates = sortUpdatesByRecency([...extraUnreadAsRead, ...readUpdates]).slice(0, 5);

  return {
    ...creator,
    updates: latestUnread ? [latestUnread, ...latestReadUpdates] : latestReadUpdates
  };
}

function cleanupAllPlatforms(platforms) {
  return platforms.map((platform) => ({
    ...platform,
    creators: Array.isArray(platform.creators) ? platform.creators.map(cleanupCreatorUpdates) : []
  }));
}

function loadPlatforms() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return normalizePlatforms(initialPlatforms);

    const normalizedPlatforms = normalizePlatforms(JSON.parse(saved));
    savePlatforms(normalizedPlatforms);
    return normalizedPlatforms;
  } catch {
    return normalizePlatforms(initialPlatforms);
  }
}

function savePlatforms(platforms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(platforms));
}

function readLastAutoYouTubeSyncAt() {
  try {
    return localStorage.getItem(AUTO_YOUTUBE_SYNC_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function readLastGlobalSyncAt() {
  try {
    return localStorage.getItem(GLOBAL_SYNC_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveLastGlobalSyncAt(value) {
  try {
    localStorage.setItem(GLOBAL_SYNC_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures; sync status can still update in memory.
  }
}

function saveLastAutoYouTubeSyncAt(value) {
  try {
    localStorage.setItem(AUTO_YOUTUBE_SYNC_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures; sync should still run.
  }
}

function normalizePlatformOrder(order, platforms = initialPlatforms) {
  const platformIds = platforms.map((platform) => platform.id);
  const orderedIds = Array.isArray(order) ? order.filter((platformId) => platformIds.includes(platformId)) : [];
  return [...orderedIds, ...platformIds.filter((platformId) => !orderedIds.includes(platformId))];
}

function readPlatformOrder() {
  try {
    const saved = localStorage.getItem(PLATFORM_ORDER_STORAGE_KEY);
    const parsedOrder = saved ? JSON.parse(saved) : DEFAULT_PLATFORM_ORDER;
    const isLegacyDefault =
      Array.isArray(parsedOrder) &&
      parsedOrder.length === LEGACY_DEFAULT_PLATFORM_ORDER.length &&
      parsedOrder.every((platformId, index) => platformId === LEGACY_DEFAULT_PLATFORM_ORDER[index]);
    return normalizePlatformOrder(isLegacyDefault ? DEFAULT_PLATFORM_ORDER : parsedOrder);
  } catch {
    return normalizePlatformOrder(DEFAULT_PLATFORM_ORDER);
  }
}

function savePlatformOrder(order) {
  try {
    localStorage.setItem(PLATFORM_ORDER_STORAGE_KEY, JSON.stringify(normalizePlatformOrder(order)));
  } catch {
    // Ignore storage failures; visual order can fall back to defaults.
  }
}

function normalizePlatformVisibility(visibility, platforms = initialPlatforms) {
  const savedVisibility = visibility && typeof visibility === "object" ? visibility : {};

  return platforms.reduce((nextVisibility, platform) => {
    nextVisibility[platform.id] =
      savedVisibility[platform.id] === undefined ? DEFAULT_PLATFORM_VISIBILITY[platform.id] !== false : savedVisibility[platform.id] !== false;
    return nextVisibility;
  }, {});
}

function readPlatformVisibility() {
  try {
    const saved = localStorage.getItem(PLATFORM_VISIBILITY_STORAGE_KEY);
    return normalizePlatformVisibility(saved ? JSON.parse(saved) : DEFAULT_PLATFORM_VISIBILITY);
  } catch {
    return normalizePlatformVisibility(DEFAULT_PLATFORM_VISIBILITY);
  }
}

function savePlatformVisibility(visibility, platforms = initialPlatforms) {
  try {
    localStorage.setItem(PLATFORM_VISIBILITY_STORAGE_KEY, JSON.stringify(normalizePlatformVisibility(visibility, platforms)));
  } catch {
    // Ignore storage failures; visibility can fall back to defaults.
  }
}

function normalizeExternalUrl(url) {
  if (!url) return "";
  const trimmedUrl = String(url).trim();
  const lowerUrl = trimmedUrl.toLowerCase();
  if (
    trimmedUrl === "" ||
    trimmedUrl === "#" ||
    lowerUrl === "about:blank" ||
    lowerUrl === "undefined" ||
    lowerUrl === "null"
  ) {
    return "";
  }
  if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://")) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function normalizeBilibiliHomepage(input) {
  const uid = extractBilibiliUid(input);
  if (uid) return `https://space.bilibili.com/${uid}`;
  return normalizeExternalUrl(input);
}

function extractBilibiliUid(input) {
  if (!input) return "";
  const trimmedInput = String(input).trim();
  if (!trimmedInput) return "";
  const directMatch = trimmedInput.match(/^\d+$/);
  if (directMatch) return directMatch[0];
  const spaceMatch = trimmedInput.match(/space\.bilibili\.com\/(\d+)/i);
  return spaceMatch ? spaceMatch[1] : "";
}

function isMockOrEmptyUrl(url) {
  return normalizeExternalUrl(url) === "";
}

function navigateExternal(finalUrl) {
  try {
    window.location.assign(finalUrl);
  } catch {
    const link = document.createElement("a");
    link.href = finalUrl;
    link.rel = "noreferrer";
    link.target = "_self";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

function getCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function formatSyncTime(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return `${date.toLocaleDateString("zh-CN")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getAutoYouTubeSyncText(value) {
  const lastAutoSyncedAt = Date.parse(value || "");
  if (!Number.isFinite(lastAutoSyncedAt)) return "自动同步：30 分钟内不重复检查";

  const remainingMs = AUTO_SYNC_INTERVAL_MS - (Date.now() - lastAutoSyncedAt);
  if (remainingMs <= 0) return "自动同步：下次打开时会检查";

  return `下次自动同步：约 ${Math.ceil(remainingMs / 60000)} 分钟后`;
}

function formatVideoTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return getCurrentTime();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeYouTubeChannelId(input) {
  if (!input) return "";
  const trimmedInput = String(input).trim();
  if (!trimmedInput) return "";

  const directMatch = trimmedInput.match(/^(UC[A-Za-z0-9_-]{22})$/);
  if (directMatch) return directMatch[1];

  const channelMatch = trimmedInput.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/i);
  if (channelMatch) return channelMatch[1];

  const youtubeChannelMatch = trimmedInput.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/i);
  if (youtubeChannelMatch) return youtubeChannelMatch[1];

  return "";
}

function resolveYouTubeChannelInfo(input) {
  const trimmedInput = String(input || "").trim();
  if (!trimmedInput) {
    return { sourceId: "", homepageUrl: "", feedUrl: "", handle: "" };
  }

  const sourceId = normalizeYouTubeChannelId(trimmedInput);
  if (isValidYouTubeChannelId(sourceId)) {
    return {
      sourceId,
      homepageUrl: `https://www.youtube.com/channel/${sourceId}`,
      feedUrl: getYouTubeFeedUrl(sourceId),
      handle: ""
    };
  }

  const handleMatch = trimmedInput.match(/(?:youtube\.com\/)?@([A-Za-z0-9._-]+)/i) || trimmedInput.match(/^@([A-Za-z0-9._-]+)/);
  if (handleMatch) {
    const handle = handleMatch[1];
    return {
      sourceId: "",
      homepageUrl: `https://www.youtube.com/@${handle}`,
      feedUrl: "",
      handle
    };
  }

  return {
    sourceId: "",
    homepageUrl: normalizeExternalUrl(trimmedInput),
    feedUrl: "",
    handle: ""
  };
}

function isValidYouTubeChannelId(channelId) {
  return /^UC[A-Za-z0-9_-]{22}$/.test(String(channelId || "").trim());
}

function getYouTubeChannelId(creator) {
  const sourceId = normalizeYouTubeChannelId(creator.sourceId);
  if (isValidYouTubeChannelId(sourceId)) return sourceId;

  try {
    const feedUrl = normalizeExternalUrl(creator.feedUrl);
    if (!feedUrl) return "";
    return normalizeYouTubeChannelId(new URL(feedUrl).searchParams.get("channel_id") || "");
  } catch {
    return "";
  }
}

function getYouTubeChannelIdFromFeedUrl(feedUrl) {
  try {
    return normalizeYouTubeChannelId(new URL(feedUrl).searchParams.get("channel_id") || "");
  } catch {
    return "";
  }
}

function normalizeYouTubeFeedUrl(url) {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return "";

  try {
    const parsedUrl = new URL(normalizedUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    const channelId = normalizeYouTubeChannelId(parsedUrl.searchParams.get("channel_id") || "");
    if (hostname !== "youtube.com" || parsedUrl.pathname !== "/feeds/videos.xml" || !channelId) return "";
    return parsedUrl.toString();
  } catch {
    return "";
  }
}

function getYouTubeHomepageUrl(homepageUrl, channelId) {
  const normalizedHomepageUrl = normalizeExternalUrl(homepageUrl);
  if (normalizedHomepageUrl) return normalizedHomepageUrl;
  return isValidYouTubeChannelId(channelId) ? `https://www.youtube.com/channel/${channelId}` : "";
}

function addYouTubeSyncTarget(targets, target) {
  if (!target?.value || targets.some((item) => item.type === target.type && item.value === target.value)) return;
  targets.push(target);
}

function getYouTubeCreatorSyncTargets(creator, options = {}) {
  if (options.automatic && creator.syncStatus === "needs_attention") return [];

  const targets = [];
  const knownGoodFeedUrl = normalizeYouTubeFeedUrl(creator.knownGoodFeedUrl);
  const feedUrl = normalizeYouTubeFeedUrl(creator.feedUrl);
  const knownGoodSourceId = normalizeYouTubeChannelId(creator.knownGoodSourceId);
  const sourceId = getYouTubeChannelId(creator);
  const homepageUrl = normalizeExternalUrl(creator.homepageUrl);

  addYouTubeSyncTarget(targets, knownGoodFeedUrl ? { type: "feedUrl", value: knownGoodFeedUrl } : null);
  addYouTubeSyncTarget(targets, feedUrl ? { type: "feedUrl", value: feedUrl } : null);
  addYouTubeSyncTarget(targets, isValidYouTubeChannelId(knownGoodSourceId) ? { type: "channelId", value: knownGoodSourceId } : null);
  addYouTubeSyncTarget(targets, isValidYouTubeChannelId(sourceId) ? { type: "channelId", value: sourceId } : null);
  addYouTubeSyncTarget(targets, homepageUrl ? { type: "url", value: homepageUrl } : null);
  addYouTubeSyncTarget(targets, creator.handle ? { type: "handle", value: String(creator.handle).replace(/^@/, "") } : null);

  return targets;
}

function getYouTubeCreatorSyncTarget(creator, options = {}) {
  return getYouTubeCreatorSyncTargets(creator, options)[0] || null;
}

function getYouTubeCreatorFallbackTargets(creator, currentType) {
  const targets = [];
  const channelId = normalizeYouTubeChannelId(creator.sourceId);
  if (currentType !== "channelId" && isValidYouTubeChannelId(channelId)) {
    targets.push({ type: "channelId", value: channelId });
  }

  const homepageUrl = normalizeExternalUrl(creator.homepageUrl);
  if (currentType !== "url" && homepageUrl) {
    targets.push({ type: "url", value: homepageUrl });
  }

  if (currentType !== "handle" && creator.handle) {
    targets.push({ type: "handle", value: String(creator.handle).replace(/^@/, "") });
  }

  return targets;
}

function getYouTubeFeedQuery(target) {
  const queryKey =
    target.type === "feedUrl" ? "feedUrl" : target.type === "channelId" ? "channelId" : target.type === "handle" ? "handle" : "url";
  return `${queryKey}=${encodeURIComponent(target.value)}`;
}

function isStaleYouTubeSourceError(data) {
  const message = String(data.message || data.errorMessage || "");
  const responsePreview = String(data.responsePreview || data.preview || "");
  return (
    data.error === "feed_fetch_failed" ||
    data.error === "invalid_feed_url" ||
    data.error === "invalid_feed_response" ||
    data.error === "no_videos_parsed" ||
    data.error === "alternate_feed_invalid" ||
    data.error === "resolved_channel_feed_invalid" ||
    Number(data.status) === 404 ||
    data.statusText === "Not Found" ||
    message.includes("Not Found") ||
    responsePreview.includes("Error 404")
  );
}

function isTemporaryYouTubeName(name, creator) {
  const trimmedName = String(name || "").trim();
  const handle = String(creator.handle || "").replace(/^@/, "").trim();
  return !trimmedName || trimmedName === "YouTube 频道" || (handle && (trimmedName === handle || trimmedName === `@${handle}`));
}

function inferLocalCreatorName(platform, input) {
  const trimmedInput = String(input || "").trim();
  if (!trimmedInput) return "";

  if (platform.id === "youtube") {
    const youtubeInfo = resolveYouTubeChannelInfo(trimmedInput);
    return youtubeInfo.handle || youtubeInfo.sourceId || "";
  }

  if (platform.id === "bilibili") {
    const uidMatch = trimmedInput.match(/space\.bilibili\.com\/(\d+)/i) || trimmedInput.match(/^(\d+)$/);
    return uidMatch ? `B站用户 ${uidMatch[1]}` : "";
  }

  const normalizedUrl = normalizeExternalUrl(trimmedInput);

  try {
    const parsedUrl = new URL(normalizedUrl);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

    if (platform.id === "instagram") {
      const username = pathParts[0];
      return username && !["p", "reel", "stories", "explore"].includes(username) ? username : "";
    }

    if (platform.id === "weibo") {
      if (pathParts[0] === "u" && pathParts[1]) return pathParts[1];
      return pathParts[0] || "";
    }

    if (platform.id === "xiaohongshu") {
      const profileIndex = pathParts.findIndex((part) => part === "profile" || part === "user");
      const userId = profileIndex >= 0 ? pathParts[profileIndex + 1] : pathParts[pathParts.length - 1];
      return userId ? `小红书用户 ${userId}` : "小红书用户";
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeLookupQuery(input) {
  const youtubeInfo = resolveYouTubeChannelInfo(input);
  if (youtubeInfo.sourceId) return `channelId=${encodeURIComponent(youtubeInfo.sourceId)}`;
  if (youtubeInfo.handle) return `handle=${encodeURIComponent(youtubeInfo.handle)}`;
  return `url=${encodeURIComponent(input)}`;
}

function useAutoCreatorName(platform, form, setForm) {
  const [nameStatus, setNameStatus] = useState("");

  useEffect(() => {
    const homepageUrl = form.homepageUrl.trim();
    if (!homepageUrl || form.creator.trim() || platform.id === "rss") {
      setNameStatus("");
      return undefined;
    }

    if (platform.id !== "youtube") {
      const inferredName = inferLocalCreatorName(platform, homepageUrl);
      if (inferredName) {
        setForm((current) =>
          current.creator.trim() || current.homepageUrl.trim() !== homepageUrl ? current : { ...current, creator: inferredName }
        );
      }
      setNameStatus("");
      return undefined;
    }

    let isCancelled = false;
    setNameStatus("正在识别频道名...");

    const timerId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/youtube-feed?${getYouTubeLookupQuery(homepageUrl)}`);
        const data = await response.json().catch(() => ({}));
        const inferredName = String(data.channelTitle || inferLocalCreatorName(platform, homepageUrl) || "").trim();

        if (isCancelled) return;

        if (inferredName) {
          setForm((current) =>
            current.creator.trim() || current.homepageUrl.trim() !== homepageUrl ? current : { ...current, creator: inferredName }
          );
          setNameStatus(data.channelTitle ? "已识别频道名" : "无法自动识别，可手动填写");
        } else {
          setNameStatus("无法自动识别，可手动填写");
        }
      } catch {
        const inferredName = inferLocalCreatorName(platform, homepageUrl);
        if (isCancelled) return;

        if (inferredName) {
          setForm((current) =>
            current.creator.trim() || current.homepageUrl.trim() !== homepageUrl ? current : { ...current, creator: inferredName }
          );
        }
        setNameStatus("无法自动识别，可手动填写");
      }
    }, 450);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [platform.id, form.creator, form.homepageUrl, setForm]);

  return nameStatus;
}

function getYouTubeSyncErrorMessage(errorCode) {
  const messages = {
    missing_input: "同步失败：缺少 YouTube 频道链接或 channelId",
    channel_id_not_resolved: "同步失败：无法识别频道 ID，请尝试在 YouTube 频道页点击“分享频道 → 复制频道 ID”。",
    feed_fetch_failed: "同步失败：YouTube feed 请求失败，请稍后重试",
    invalid_feed_response: "同步失败：YouTube feed 返回异常",
    no_videos_parsed: "同步失败：已读取 feed，但没有解析到视频"
  };

  return messages[errorCode] || "同步失败：未知错误";
}

function getUnreadCreators(platform) {
  return platform.creators
    .filter((creator) => creator.selected !== false)
    .map((creator) => ({
      ...creator,
      unreadUpdates:
        platform.id === "youtube"
          ? creator.updates.filter((update) => !update.read).slice(0, 1)
          : platform.id === "bilibili"
            ? []
          : creator.updates.filter((update) => !update.read)
    }))
    .filter((creator) => creator.unreadUpdates.length > 0);
}

function getReadUpdates(platform) {
  return platform.creators.flatMap((creator) =>
    creator.updates
      .filter((update) => update.read)
      .map((update) => ({ ...update, creatorName: creator.name }))
  );
}

function getStatusText(platform, unreadCreators) {
  const creatorCount = platform.creators.filter((creator) => creator.selected !== false).length;

  if (creatorCount === 0) {
    if (platform.id === "youtube") return "还没添加频道";
    if (platform.id === "bilibili") return "还没添加 UP 主";
    return "还没添加博主";
  }

  if (platform.id === "bilibili") return `已添加 ${creatorCount} 位 UP 主，暂无新更新`;

  if (unreadCreators.length > 0) {
    if (platform.id === "rss") return `${unreadCreators.length} 个订阅源更新`;
    return `${unreadCreators.length} 位博主更新`;
  }

  if (platform.id === "rss") return `已添加 ${creatorCount} 个订阅源，暂无新更新`;
  return `已添加 ${creatorCount} 位博主，暂无新更新`;
}

function getHomeStatusInfo(platform, unreadCreators) {
  const creatorCount = platform.creators.filter((creator) => creator.selected !== false).length;
  const label =
    platform.id === "youtube"
      ? "自动同步"
      : platform.id === "rss"
        ? "高级订阅源"
        : "手动入口";

  if (platform.id === "youtube") {
    if (unreadCreators.length > 0) return { label, text: `${unreadCreators.length} 位博主更新` };
    if (creatorCount > 0) return { label, text: "暂无新更新" };
    return { label, text: `已添加 ${creatorCount} 个频道` };
  }

  if (platform.id === "bilibili") {
    return { label, text: creatorCount > 0 ? `已添加 ${creatorCount} 位 UP 主` : "还没添加 UP 主" };
  }

  if (platform.id === "rss") {
    return { label, text: creatorCount > 0 ? `已添加 ${creatorCount} 个订阅源` : "还没添加订阅源" };
  }

  return { label, text: creatorCount > 0 ? `已添加 ${creatorCount} 位博主` : "还没添加博主" };
}

function getActionText(platform) {
  if (platform.id === "youtube") return "添加 YouTube 频道";
  if (platform.id === "bilibili") return "添加 B站 UP 主";
  if (platform.id === "xiaohongshu") return "添加小红书博主";
  if (platform.id === "weibo") return "添加微博博主";
  if (platform.id === "instagram") return "添加 Instagram 博主";
  return "添加 RSS";
}

function getConnectedNote(platform) {
  if (platform.id === "rss") return "等待下一次同步";
  if (platform.id === "bilibili") return "手动添加链接，作为主页入口使用";
  return "等待下一次更新";
}

function getPlatformSupplementText(platform, creatorCount) {
  if (platform.id === "rss") return creatorCount > 0 ? "高级订阅源入口" : "添加高级订阅源";
  if (platform.id === "bilibili") return creatorCount > 0 ? "展开查看常用主页" : "手动添加 B站主页链接";
  if (platform.id === "instagram" || platform.id === "xiaohongshu" || platform.id === "weibo") {
    return creatorCount > 0 ? "展开查看常用主页" : "手动添加主页链接";
  }
  if (creatorCount > 0) return getConnectedNote(platform);
  if (platform.id === "youtube") return "先添加频道，有更新会显示在这里";
  return "先添加博主，有更新会显示在这里";
}

function getHomePlatforms(platforms, platformOrder, platformVisibility) {
  return normalizePlatformOrder(platformOrder, platforms)
    .filter((platformId) => platformVisibility?.[platformId] !== false)
    .map((platformId) => platforms.find((platform) => platform.id === platformId))
    .filter(Boolean);
}

function getOrderedPlatforms(platforms, platformOrder) {
  return normalizePlatformOrder(platformOrder, platforms)
    .map((platformId) => platforms.find((platform) => platform.id === platformId))
    .filter(Boolean);
}

function getAddChoiceText(platform) {
  if (platform.id === "rss") return "高级：添加 RSS 订阅源";
  return getActionText(platform);
}

function getManualModalTitle(platform) {
  if (platform.id === "rss") return "添加 RSS 订阅源";
  if (platform.id === "youtube") return "添加 YouTube 频道";
  if (platform.id === "bilibili") return "添加 B站 UP 主";
  return `添加 ${platform.name} 博主`;
}

function getHomepageLabel(platform) {
  if (platform.id === "rss") return "RSS 链接";
  if (platform.id === "youtube") return "YouTube 频道主页链接，可选";
  if (platform.id === "bilibili") return "B站主页链接或 UID";
  if (platform.id === "instagram") return "Instagram 主页链接";
  return "主页链接";
}

function getCreatorLabel(platform) {
  if (platform.id === "rss") return "订阅源名称";
  if (platform.id === "youtube") return "频道名";
  if (platform.id === "bilibili") return "UP 主名";
  return "博主名";
}

function getCreatorPlaceholder(platform) {
  if (platform.id === "rss") return "例如：Design Feed";
  if (platform.id === "youtube") return "例如：MKBHD";
  if (platform.id === "bilibili") return "例如：影视飓风";
  if (platform.id === "instagram") return "例如：design";
  return "例如：瑞英";
}

function shouldIgnoreSwipeBackTarget(target) {
  if (!target?.closest) return false;
  return Boolean(target.closest("input, textarea, select, button, label, [contenteditable='true'], [role='button']"));
}

export default function App() {
  const [platforms, setPlatforms] = useState(loadPlatforms);
  const [activePlatformId, setActivePlatformId] = useState(null);
  const [manualPlatformId, setManualPlatformId] = useState(null);
  const [editingCreatorContext, setEditingCreatorContext] = useState(null);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [youtubeSyncState, setYouTubeSyncState] = useState({ status: "idle", message: "", debugInfo: null });
  const [globalSyncState, setGlobalSyncState] = useState({ status: "idle", message: "", debugInfo: null });
  const [lastGlobalSyncAt, setLastGlobalSyncAt] = useState(readLastGlobalSyncAt);
  const [lastAutoYouTubeSyncAt, setLastAutoYouTubeSyncAt] = useState(readLastAutoYouTubeSyncAt);
  const [platformOrder, setPlatformOrder] = useState(() => normalizePlatformOrder(readPlatformOrder(), platforms));
  const [platformVisibility, setPlatformVisibility] = useState(() => normalizePlatformVisibility(readPlatformVisibility(), platforms));
  const autoSyncStartedRef = useRef(false);
  const swipeBackRef = useRef({ tracking: false, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  const activePlatform = platforms.find((platform) => platform.id === activePlatformId);
  const manualPlatform = platforms.find((platform) => platform.id === manualPlatformId);
  const editingPlatform = platforms.find((platform) => platform.id === editingCreatorContext?.platformId);
  const editingCreator = editingPlatform?.creators.find((creator) => creator.id === editingCreatorContext?.creatorId);
  const youtubePlatform = platforms.find((platform) => platform.id === "youtube");

  function updatePlatforms(nextPlatforms) {
    const normalizedPlatforms = normalizePlatforms(nextPlatforms);
    setPlatforms(normalizedPlatforms);
    setPlatformOrder((currentOrder) => normalizePlatformOrder(currentOrder, normalizedPlatforms));
    setPlatformVisibility((currentVisibility) => normalizePlatformVisibility(currentVisibility, normalizedPlatforms));
    savePlatforms(normalizedPlatforms);
  }

  function updatePlatformOrder(nextOrder) {
    const normalizedOrder = normalizePlatformOrder(nextOrder, platforms);
    setPlatformOrder(normalizedOrder);
    savePlatformOrder(normalizedOrder);
  }

  function movePlatformOrder(platformId, direction) {
    const currentOrder = normalizePlatformOrder(platformOrder, platforms);
    const currentIndex = currentOrder.indexOf(platformId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;

    const nextOrder = [...currentOrder];
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
    updatePlatformOrder(nextOrder);
  }

  function updatePlatformVisibility(platformId) {
    setPlatformVisibility((currentVisibility) => {
      const nextVisibility = normalizePlatformVisibility(
        { ...currentVisibility, [platformId]: currentVisibility[platformId] === false },
        platforms
      );
      savePlatformVisibility(nextVisibility, platforms);
      return nextVisibility;
    });
  }

  function recordYouTubeSyncAttempt() {
    const syncedAt = new Date().toISOString();
    saveLastAutoYouTubeSyncAt(syncedAt);
    setLastAutoYouTubeSyncAt(syncedAt);
    return syncedAt;
  }

  useEffect(() => {
    if (autoSyncStartedRef.current) return;
    autoSyncStartedRef.current = true;

    const youtube = platforms.find((platform) => platform.id === "youtube");
    const hasSyncableCreator = youtube?.creators.some((creator) => getYouTubeCreatorSyncTarget(creator, { automatic: true }));
    const lastAutoSyncedAt = Date.parse(readLastAutoYouTubeSyncAt());
    const shouldSync =
      hasSyncableCreator && (!Number.isFinite(lastAutoSyncedAt) || Date.now() - lastAutoSyncedAt > AUTO_SYNC_INTERVAL_MS);

    if (shouldSync) {
      syncYouTubeFeeds({ automatic: true });
    }
  }, []);

  function openHome() {
    setActiveTab("home");
    setActivePlatformId(null);
    setShowAddChoice(false);
  }

  function resetSwipeBack() {
    swipeBackRef.current = { tracking: false, startX: 0, startY: 0, lastX: 0, lastY: 0 };
  }

  function performSwipeBack() {
    if (showAddChoice) {
      setShowAddChoice(false);
      return;
    }

    if (manualPlatformId) {
      setManualPlatformId(null);
      return;
    }

    if (editingCreatorContext) {
      setEditingCreatorContext(null);
      return;
    }

    if (activePlatformId) {
      setActivePlatformId(null);
      return;
    }

    if (activeTab === "sync" || activeTab === "settings") {
      openHome();
    }
  }

  function handleSwipeBackTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch || event.touches.length !== 1 || touch.clientX > 30 || shouldIgnoreSwipeBackTarget(event.target)) {
      resetSwipeBack();
      return;
    }

    swipeBackRef.current = {
      tracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY
    };
  }

  function handleSwipeBackTouchMove(event) {
    if (!swipeBackRef.current.tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;

    swipeBackRef.current = {
      ...swipeBackRef.current,
      lastX: touch.clientX,
      lastY: touch.clientY
    };
  }

  function handleSwipeBackTouchEnd(event) {
    const swipe = swipeBackRef.current;
    if (!swipe.tracking) return;

    const touch = event.changedTouches?.[0];
    const endX = touch?.clientX ?? swipe.lastX;
    const endY = touch?.clientY ?? swipe.lastY;
    const deltaX = endX - swipe.startX;
    const deltaY = endY - swipe.startY;
    resetSwipeBack();

    if (deltaX >= 80 && Math.abs(deltaY) <= 60 && deltaX > Math.abs(deltaY) * 1.5) {
      performSwipeBack();
    }
  }

  function markUpdateAsRead(platformId, creatorId, updateId) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== platformId) return platform;

        return {
          ...platform,
          creators: platform.creators.map((creator) => {
            if (creator.id !== creatorId) return creator;

            return {
              ...creator,
              updates: creator.updates.map((update) =>
                update.id === updateId ? { ...update, read: true } : update
              )
            };
          })
        };
      })
    );
  }

  function openExternalLink({ platform, creator, update }) {
    const finalUrl = normalizeExternalUrl(update?.url || update?.link || update?.contentUrl || creator?.homepageUrl || platform?.homepageUrl);

    if (!finalUrl) {
      alert("当前是模拟内容，暂无真实链接。你可以手动添加真实链接。");
      return;
    }

    if (update?.id && creator?.id && platform?.id) {
      markUpdateAsRead(platform.id, creator.id, update.id);
    }

    navigateExternal(finalUrl);
  }

  function openCreatorHomepage(platform, update) {
    const creator = platform.creators.find((item) => item.name === update.creatorName);
    const finalUrl = normalizeExternalUrl(creator?.homepageUrl || update.url);

    if (!finalUrl) {
      alert("当前没有可打开的主页链接");
      return;
    }

    navigateExternal(finalUrl);
  }

  function openFollowedCreatorHomepage(platform, creator) {
    const finalUrl = normalizeExternalUrl(creator?.homepageUrl);

    if (import.meta.env.DEV) {
      console.log("follow external homepage", {
        platformName: platform?.name,
        creatorName: creator?.name,
        homepageUrl: creator?.homepageUrl,
        normalizedUrl: finalUrl
      });
    }

    if (!finalUrl) {
      alert("当前没有可打开的主页链接");
      return;
    }

    navigateExternal(finalUrl);
  }

  function removeCreator(platformId, creator) {
    if (!window.confirm(`确定不再关注「${creator.name}」吗？`)) return;

    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== platformId) return platform;

        return {
          ...platform,
          connected: platform.creators.length > 1,
          creators: platform.creators.filter((item) => item.id !== creator.id)
        };
      })
    );
  }

  function updateCreator(platformId, creatorId, formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== platformId) return platform;

        return {
          ...platform,
          creators: platform.creators.map((creator) => {
            if (creator.id !== creatorId) return creator;

            const youtubeInfo = platform.id === "youtube" ? resolveYouTubeChannelInfo(formData.homepageUrl) : null;
            const bilibiliUid = platform.id === "bilibili" ? extractBilibiliUid(formData.homepageUrl) : "";
            const creatorName =
              formData.creator.trim() ||
              (platform.id === "youtube"
                ? youtubeInfo.handle || youtubeInfo.sourceId || "YouTube 频道"
                : platform.id === "bilibili" && bilibiliUid
                  ? `B站用户 ${bilibiliUid}`
                  : "");
            const channelId = youtubeInfo?.sourceId || "";
            const homepageUrl =
              platform.id === "youtube"
                ? youtubeInfo.homepageUrl
                : platform.id === "bilibili"
                  ? normalizeBilibiliHomepage(formData.homepageUrl)
                : normalizeExternalUrl(formData.homepageUrl);

            return {
              ...creator,
              name: creatorName,
              avatar: creatorName.slice(0, 1).toUpperCase(),
              homepageUrl,
              sourceId: platform.id === "youtube" ? channelId : platform.id === "bilibili" ? bilibiliUid : creator.sourceId,
              feedUrl: platform.id === "youtube" ? youtubeInfo.feedUrl : creator.feedUrl,
              handle: platform.id === "youtube" ? youtubeInfo.handle : creator.handle,
              uid: platform.id === "bilibili" ? bilibiliUid : creator.uid,
              knownGoodFeedUrl: platform.id === "youtube" ? "" : creator.knownGoodFeedUrl,
              knownGoodSourceId: platform.id === "youtube" ? "" : creator.knownGoodSourceId,
              syncFailCount: usesCreatorSyncState(platform.id) ? 0 : creator.syncFailCount,
              syncStatus: usesCreatorSyncState(platform.id) ? "active" : creator.syncStatus,
              lastSyncError: usesCreatorSyncState(platform.id) ? null : creator.lastSyncError,
              lastSyncErrorAt: usesCreatorSyncState(platform.id) ? "" : creator.lastSyncErrorAt
            };
          })
        };
      })
    );

    setEditingCreatorContext(null);
  }

  async function syncYouTubeFeeds(options = {}) {
    const silent = options.silent === true;
    const automatic = options.automatic === true;
    const youtube = platforms.find((platform) => platform.id === "youtube");
    const creators = youtube?.creators.filter((creator) => creator.selected !== false) || [];
    const syncItems = creators
      .map((creator) => ({ creator, targets: getYouTubeCreatorSyncTargets(creator, { automatic }) }))
      .filter(({ targets }) => targets.length > 0);
    const missingTargetCreators = creators.filter(
      (creator) => !(automatic && creator.syncStatus === "needs_attention") && getYouTubeCreatorSyncTargets(creator, { automatic }).length === 0
    );

    if (!youtube) return { addedCount: 0, failedCount: 0 };

    recordYouTubeSyncAttempt();

    if (!silent) {
      setYouTubeSyncState({ status: "syncing", message: automatic ? "自动同步中..." : "同步中...", debugInfo: null });
    }

    if (syncItems.length === 0) {
      const syncedAt = new Date().toISOString();
      updatePlatforms(platforms.map((platform) => (platform.id === "youtube" ? { ...platform, lastSyncedAt: syncedAt } : platform)));
      if (!silent) {
        setYouTubeSyncState({ status: "success", message: "还没有可同步的 YouTube 频道，请先添加频道链接。", debugInfo: null });
      }
      return { addedCount: 0, failedCount: 0 };
    }

    const results = await Promise.all(
      syncItems.map(async ({ creator, targets }) => {
        const oldSourceId = creator.sourceId || "";
        const oldFeedUrl = creator.feedUrl || "";
        const oldKnownGoodFeedUrl = creator.knownGoodFeedUrl || "";
        const requestFeed = async (syncTarget) => {
          const response = await fetch(`/api/youtube-feed?${getYouTubeFeedQuery(syncTarget)}`);
          const data = await response.json().catch(() => ({}));
          return { response, data };
        };
        const createFailureResult = (data, errorMessage = getYouTubeSyncErrorMessage(data.error), extraDebug = {}) => ({
          creatorId: creator.id,
          videos: [],
          failed: true,
          clearSource: extraDebug.clearSource === true,
          syncFailCount: Number(creator.syncFailCount || 0) + 1,
          errorCode: data.error || "unknown",
          errorMessage,
          debugInfo: {
            creatorName: creator.name,
            sourceId: oldSourceId,
            knownGoodFeedUrl: creator.knownGoodFeedUrl || "",
            knownGoodSourceId: creator.knownGoodSourceId || "",
            syncFailCount: Number(creator.syncFailCount || 0) + 1,
            lastSuccessfulSyncAt: creator.lastSuccessfulSyncAt || "",
            homepageUrl: creator.homepageUrl || "",
            feedUrl: creator.feedUrl || data.feedUrl || "",
            error: data.error || "unknown",
            status: data.status ?? "",
            statusText: data.statusText || "",
            errorMessage: data.errorMessage || data.message || errorMessage,
            responsePreview: (data.responsePreview || data.preview || "").slice(0, 200),
            candidateCount: Array.isArray(data.candidates) ? data.candidates.length : "",
            alternateFeedCount: data.alternateFeedCount || "",
            resolvedBy: data.resolvedBy || "",
            suggestion: extraDebug.suggestion || "",
            ...extraDebug
          }
        });

        try {
          let lastData = {};

          for (const target of targets) {
            const { response, data } = await requestFeed(target);
            lastData = data;

            if (!response.ok) continue;

            const videos = Array.isArray(data.videos) ? data.videos : [];
            const feedUrl = normalizeYouTubeFeedUrl(data.feedUrl);
            const resolvedChannelId = normalizeYouTubeChannelId(data.resolvedChannelId || data.channelId || getYouTubeChannelIdFromFeedUrl(feedUrl));
            if (videos.length === 0 || !feedUrl || !isValidYouTubeChannelId(resolvedChannelId)) continue;

            return {
              creatorId: creator.id,
              videos,
              resolvedChannelId,
              channelTitle: data.channelTitle || "",
              feedUrl,
              resolvedBy: data.resolvedBy || "",
              failed: false,
              recoveredSourceId: Boolean((oldSourceId && oldSourceId !== resolvedChannelId) || (oldFeedUrl && oldFeedUrl !== feedUrl) || (!oldKnownGoodFeedUrl && feedUrl)),
              oldSourceId,
              errorCode: "",
              errorMessage: "",
              debugInfo: null
            };
          }

          return createFailureResult(lastData, "部分频道暂时无法同步，已保留上次成功结果", {
            suggestion: "如果连续失败，可以编辑该频道并保留 YouTube @handle 或 /channel/UC... 链接后重试"
          });
        } catch (error) {
          console.warn("YouTube feed sync failed", creator.name, error);
          return {
            creatorId: creator.id,
            videos: [],
            failed: true,
            syncFailCount: Number(creator.syncFailCount || 0) + 1,
            errorCode: "network_request_failed",
            errorMessage: "同步失败：网络请求失败",
            debugInfo: {
              creatorName: creator.name,
              sourceId: creator.sourceId || "",
              knownGoodFeedUrl: creator.knownGoodFeedUrl || "",
              knownGoodSourceId: creator.knownGoodSourceId || "",
              syncFailCount: Number(creator.syncFailCount || 0) + 1,
              lastSuccessfulSyncAt: creator.lastSuccessfulSyncAt || "",
              homepageUrl: creator.homepageUrl || "",
              feedUrl: creator.feedUrl || "",
              error: "network_request_failed",
              status: "",
              statusText: "",
              errorMessage: error instanceof Error ? error.message : String(error),
              responsePreview: ""
            }
          };
        }
      })
    );

    const resultMap = new Map(results.map((result) => [result.creatorId, result]));
    let updatedCreatorCount = 0;
    const apiFailedResults = results.filter((result) => result.failed);
    const recoveredSourceCount = results.filter((result) => result.recoveredSourceId).length;
    const alternateRecoveredCount = results.filter(
      (result) => result.recoveredSourceId && result.resolvedBy === "alternate_feed"
    ).length;
    const temporarilyFailedCount = apiFailedResults.filter((result) => Number(result.syncFailCount || 1) < 3).length;
    const needsAttentionCount =
      apiFailedResults.filter((result) => Number(result.syncFailCount || 1) >= 3).length + missingTargetCreators.length;
    const failedCount = missingTargetCreators.length + apiFailedResults.length;
    const syncedAt = new Date().toISOString();

    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== "youtube") return platform;

      return {
        ...platform,
        connected: platform.creators.length > 0,
        lastSyncedAt: syncedAt,
        lastSyncFailedCount: failedCount,
        creators: platform.creators.map((creator) => {
          const result = resultMap.get(creator.id);
          if (!result) return creator;
          if (result.failed) {
            const nextFailCount = Number(creator.syncFailCount || 0) + 1;

            return {
              ...creator,
              syncFailCount: nextFailCount,
              syncStatus: nextFailCount >= 3 ? "needs_attention" : "unstable",
              lastSyncError: result.errorCode || result.errorMessage || "unknown",
              lastSyncErrorAt: syncedAt
            };
          }

          const resolvedChannelId = normalizeYouTubeChannelId(result.resolvedChannelId);
          const latestVideo = result.videos[0];
          const resolvedFields = isValidYouTubeChannelId(resolvedChannelId) && latestVideo
            ? {
                sourceId: resolvedChannelId,
                feedUrl: normalizeYouTubeFeedUrl(result.feedUrl) || getYouTubeFeedUrl(resolvedChannelId),
                knownGoodSourceId: resolvedChannelId,
                knownGoodFeedUrl: normalizeYouTubeFeedUrl(result.feedUrl) || getYouTubeFeedUrl(resolvedChannelId),
                lastSuccessfulSyncAt: syncedAt,
                syncFailCount: 0,
                syncStatus: "active",
                lastSyncError: null,
                lastSyncErrorAt: ""
              }
            : {};
          const resolvedName =
            result.channelTitle && isTemporaryYouTubeName(creator.name, creator)
              ? { name: result.channelTitle, avatar: result.channelTitle.slice(0, 1).toUpperCase() }
              : {};

          if (!latestVideo) return { ...creator, ...resolvedFields, ...resolvedName };

          const existingKeys = new Set(
            creator.updates.flatMap((update) => [update.id, normalizeExternalUrl(update.url)]).filter(Boolean)
          );
          const latestVideoExists =
            existingKeys.has(latestVideo.id) || existingKeys.has(normalizeExternalUrl(latestVideo.url));

          if (latestVideoExists) {
            const normalizedLatestUrl = normalizeExternalUrl(latestVideo.url);
            const normalizedUpdates = creator.updates.map((update) => {
              const isLatestUpdate = update.id === latestVideo.id || normalizeExternalUrl(update.url) === normalizedLatestUrl;
              return update.read || isLatestUpdate ? update : { ...update, read: true };
            });

            return { ...creator, ...resolvedFields, ...resolvedName, updates: normalizedUpdates };
          }

          updatedCreatorCount += 1;
          const latestUpdate = createUpdate(
            latestVideo.id,
            formatVideoTime(latestVideo.publishedAt || latestVideo.updatedAt),
            latestVideo.title,
            latestVideo.url,
            false,
            {
              source: "youtube-feed",
              publishedAt: latestVideo.publishedAt || "",
              updatedAt: latestVideo.updatedAt || "",
              createdAt: new Date().toISOString()
            }
          );
          const readExistingUpdates = creator.updates.map((update) => (update.read ? update : { ...update, read: true }));

          return { ...creator, ...resolvedFields, ...resolvedName, updates: [latestUpdate, ...readExistingUpdates] };
        })
      };
    });

    updatePlatforms(nextPlatforms);

    const firstDebugInfo =
      apiFailedResults[0]?.debugInfo ||
      (missingTargetCreators[0]
        ? {
            creatorName: missingTargetCreators[0].name,
            sourceId: missingTargetCreators[0].sourceId || "",
            knownGoodFeedUrl: missingTargetCreators[0].knownGoodFeedUrl || "",
            knownGoodSourceId: missingTargetCreators[0].knownGoodSourceId || "",
            homepageUrl: missingTargetCreators[0].homepageUrl || "",
            feedUrl: missingTargetCreators[0].feedUrl || "",
            error: "missing_input",
            status: "",
            statusText: "",
            syncFailCount: Number(missingTargetCreators[0].syncFailCount || 0),
            lastSuccessfulSyncAt: missingTargetCreators[0].lastSuccessfulSyncAt || "",
            errorMessage: "缺少 YouTube 频道链接或 channelId",
            responsePreview: ""
          }
        : null);

    if (!silent) {
      if (failedCount > 0) {
        const recoveredText =
          recoveredSourceCount > 0
            ? `，${recoveredSourceCount} 个频道已重新识别${
                alternateRecoveredCount > 0 ? `，其中 ${alternateRecoveredCount} 个已通过频道 RSS 链接识别` : ""
              }`
            : "";
        const failedText = [
          temporarilyFailedCount > 0 ? `${temporarilyFailedCount} 个频道暂时无法同步，已保留上次成功结果` : "",
          needsAttentionCount > 0 ? `${needsAttentionCount} 个频道需要检查` : ""
        ]
          .filter(Boolean)
          .join("，");

        setYouTubeSyncState({
          status: "success",
          message: `同步完成，${updatedCreatorCount > 0 ? `发现 ${updatedCreatorCount} 位博主的新更新` : "暂无新更新"}${failedText ? `，${failedText}` : ""}${recoveredText}`,
          debugInfo: firstDebugInfo
        });
      } else {
        const recoveredText =
          recoveredSourceCount > 0
            ? `${recoveredSourceCount} 个频道已重新识别${
                alternateRecoveredCount > 0 ? `，其中 ${alternateRecoveredCount} 个已通过频道 RSS 链接识别` : ""
              }`
            : "";

        setYouTubeSyncState({
          status: "success",
          message:
            recoveredSourceCount > 0
              ? `${updatedCreatorCount > 0 ? `发现 ${updatedCreatorCount} 位博主的新更新，` : "同步完成，暂无新更新，"}${recoveredText}`
              : updatedCreatorCount > 0
                ? `发现 ${updatedCreatorCount} 位博主的新更新`
                : "同步完成，暂无新更新",
          debugInfo: null
        });
      }
    }

    return { addedCount: updatedCreatorCount, failedCount, debugInfo: firstDebugInfo, temporarilyFailedCount, needsAttentionCount };
  }

  async function syncAllPlatforms() {
    setGlobalSyncState({ status: "syncing", message: "同步中...", debugInfo: null });

    const youtubeResult = await syncYouTubeFeeds({ silent: true });
    const syncedAt = new Date().toISOString();
    saveLastGlobalSyncAt(syncedAt);
    setLastGlobalSyncAt(syncedAt);

    if (youtubeResult.failedCount > 0) {
      setGlobalSyncState({
        status: "success",
        message: "同步完成，YouTube 部分频道暂时无法同步，已保留上次成功结果",
        debugInfo: youtubeResult.debugInfo || null
      });
      return;
    }

    setGlobalSyncState({
      status: "success",
      message:
        youtubeResult.addedCount > 0
          ? `同步完成，YouTube 发现 ${youtubeResult.addedCount} 位博主的新更新`
          : "同步完成，暂无新更新",
      debugInfo: null
    });
  }

  function addManualCreator(formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== formData.platformId) return platform;

        const youtubeInfo = platform.id === "youtube" ? resolveYouTubeChannelInfo(formData.homepageUrl) : null;
        const bilibiliUid = platform.id === "bilibili" ? extractBilibiliUid(formData.homepageUrl) : "";
        const creatorName =
          formData.creator.trim() ||
          (platform.id === "youtube"
            ? youtubeInfo.handle || youtubeInfo.sourceId || "YouTube 频道"
            : platform.id === "bilibili" && bilibiliUid
              ? `B站用户 ${bilibiliUid}`
              : "");
        const channelId = youtubeInfo?.sourceId || "";
        const homepageUrl =
          platform.id === "youtube"
            ? youtubeInfo.homepageUrl
            : platform.id === "bilibili"
              ? normalizeBilibiliHomepage(formData.homepageUrl)
            : normalizeExternalUrl(formData.homepageUrl);
        const sourceId = platform.id === "youtube" ? channelId : platform.id === "bilibili" ? bilibiliUid : `manual-${Date.now()}`;
        const creatorRecordId = channelId || bilibiliUid || `manual-${Date.now()}`;
        const feedUrl = youtubeInfo?.feedUrl || "";
        const updateTitle = formData.title.trim();
        const updateUrl = formData.updateUrl.trim();
        const hasUpdate = platform.id !== "youtube" && platform.id !== "bilibili" && (updateTitle || updateUrl);
        const updates = hasUpdate
          ? [
              createUpdate(
                `${formData.platformId}-manual-update-${Date.now()}`,
                formData.time,
                updateTitle || `${creatorName} 最新内容`,
                updateUrl ? normalizeExternalUrl(updateUrl) : ""
              )
            ]
          : [];
        const existingCreator = platform.creators.find(
          (creator) =>
            (channelId && creator.sourceId === channelId) ||
            (bilibiliUid && (creator.uid === bilibiliUid || creator.sourceId === bilibiliUid)) ||
            (homepageUrl && creator.homepageUrl === homepageUrl) ||
            creator.name === creatorName
        );

        if (existingCreator) {
          return {
            ...platform,
            connected: true,
            creators: platform.creators.map((creator) =>
              creator.id === existingCreator.id
                ? {
                    ...creator,
                    selected: true,
                    homepageUrl,
                    sourceId: platform.id === "youtube" ? channelId : platform.id === "bilibili" ? bilibiliUid : creator.sourceId,
                    feedUrl: platform.id === "youtube" ? feedUrl : creator.feedUrl,
                    handle: platform.id === "youtube" ? youtubeInfo.handle : creator.handle,
                    uid: platform.id === "bilibili" ? bilibiliUid : creator.uid,
                    syncFailCount: usesCreatorSyncState(platform.id) ? 0 : creator.syncFailCount,
                    syncStatus: usesCreatorSyncState(platform.id) ? "active" : creator.syncStatus,
                    lastSyncError: usesCreatorSyncState(platform.id) ? null : creator.lastSyncError,
                    lastSyncErrorAt: usesCreatorSyncState(platform.id) ? "" : creator.lastSyncErrorAt,
                    updates: [...updates, ...creator.updates]
                  }
                : creator
            )
          };
        }

        return {
          ...platform,
          connected: true,
          creators: [
            createCreator(formData.platformId, creatorName, homepageUrl, sourceId, updates, {
              ...(feedUrl ? { feedUrl } : {}),
              ...(platform.id === "youtube" && youtubeInfo?.handle ? { handle: youtubeInfo.handle } : {}),
              ...(platform.id === "bilibili" && bilibiliUid ? { uid: bilibiliUid } : {}),
              ...(usesCreatorSyncState(platform.id) ? { syncFailCount: 0, syncStatus: "active", lastSyncError: null, lastSyncErrorAt: "" } : {}),
              ...(platform.id === "youtube" && !channelId ? { id: `${formData.platformId}-${creatorRecordId}` } : {})
            }),
            ...platform.creators
          ]
        };
      })
    );

    setManualPlatformId(null);
  }

  function addRssSource(formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== "rss") return platform;

        const sourceName = formData.creator.trim();
        const homepageUrl = normalizeExternalUrl(formData.homepageUrl);
        const update = createUpdate(`rss-update-${Date.now()}`, getCurrentTime(), `${sourceName} 最新文章`, homepageUrl);

        return {
          ...platform,
          connected: true,
          creators: [
            createCreator("rss", sourceName, homepageUrl, `rss-${Date.now()}`, [update]),
            ...platform.creators
          ]
        };
      })
    );

    setManualPlatformId(null);
  }

  function resetDemo() {
    localStorage.removeItem(GLOBAL_SYNC_STORAGE_KEY);
    updatePlatforms(initialPlatforms);
    updatePlatformOrder(DEFAULT_PLATFORM_ORDER);
    setPlatformVisibility(normalizePlatformVisibility(DEFAULT_PLATFORM_VISIBILITY));
    savePlatformVisibility(DEFAULT_PLATFORM_VISIBILITY);
    setLastGlobalSyncAt("");
    setActivePlatformId(null);
    setManualPlatformId(null);
    setShowAddChoice(false);
    setActiveTab("home");
  }

  function openPlatformAction(platform) {
    setManualPlatformId(platform.id);
  }

  function openAddChoice(platformId) {
    setShowAddChoice(false);
    setManualPlatformId(platformId);
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ app: "follow", version: "0.1", exportedAt: new Date().toISOString(), platforms }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "follow-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("导入会覆盖当前 follow 数据，确定继续吗？")) {
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedPlatforms = Array.isArray(parsed) ? parsed : parsed.platforms;
        if (!Array.isArray(importedPlatforms)) throw new Error("Invalid backup");
        updatePlatforms(importedPlatforms);
        openHome();
      } catch {
        alert("导入失败，请确认文件是 follow 导出的 JSON 数据");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!window.confirm("确定清空 follow 数据并恢复初始状态吗？")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PLATFORM_ORDER_STORAGE_KEY);
    localStorage.removeItem(PLATFORM_VISIBILITY_STORAGE_KEY);
    localStorage.removeItem(GLOBAL_SYNC_STORAGE_KEY);
    setPlatforms(initialPlatforms);
    setPlatformOrder(normalizePlatformOrder(DEFAULT_PLATFORM_ORDER));
    setPlatformVisibility(normalizePlatformVisibility(DEFAULT_PLATFORM_VISIBILITY));
    setLastGlobalSyncAt("");
    openHome();
  }

  return (
    <main
      className="page"
      onTouchStart={handleSwipeBackTouchStart}
      onTouchMove={handleSwipeBackTouchMove}
      onTouchEnd={handleSwipeBackTouchEnd}
      onTouchCancel={resetSwipeBack}
    >
      <section className="phone-shell">
        <header className="app-header">
          <div>
            <h1 className="brand-word">follow</h1>
            <p>关注的人，有更新了</p>
          </div>

          {!activePlatform && activeTab === "home" && (
            <button
              className="top-add-button"
              type="button"
              onClick={() => setShowAddChoice(true)}
              aria-label="添加到 follow"
            >
              ＋
            </button>
          )}
        </header>

        {activePlatform && activeTab === "home" && (
          <PlatformDetail
            platform={activePlatform}
            onBack={() => setActivePlatformId(null)}
            onManualAdd={() => setManualPlatformId(activePlatform.id)}
            onOpenUpdate={openExternalLink}
            onOpenHomepage={openCreatorHomepage}
            onOpenFollowedCreator={openFollowedCreatorHomepage}
            onEditCreator={(creator) => setEditingCreatorContext({ platformId: activePlatform.id, creatorId: creator.id })}
            onRemoveCreator={removeCreator}
          />
        )}

        {!activePlatform && activeTab === "home" && (
          <HomePage
            platforms={platforms}
            platformOrder={platformOrder}
            platformVisibility={platformVisibility}
            onConnect={openPlatformAction}
            onOpenUpdate={openExternalLink}
            onOpenCreator={openFollowedCreatorHomepage}
            onReset={resetDemo}
            onViewAll={(platformId) => setActivePlatformId(platformId)}
          />
        )}

        {activeTab === "sync" && (
          <SyncPage
            youtubePlatform={youtubePlatform}
            syncState={youtubeSyncState}
            globalSyncState={globalSyncState}
            lastGlobalSyncAt={lastGlobalSyncAt}
            lastAutoYouTubeSyncAt={lastAutoYouTubeSyncAt}
            onSyncAll={syncAllPlatforms}
          />
        )}
        {activeTab === "settings" && (
          <SettingsPage
            platforms={platforms}
            platformOrder={platformOrder}
            platformVisibility={platformVisibility}
            onMovePlatform={movePlatformOrder}
            onTogglePlatformVisibility={updatePlatformVisibility}
            onExport={exportData}
            onImport={importData}
            onClear={clearData}
          />
        )}

        <nav className="tab-bar">
          <button className={`tab ${activeTab === "home" ? "active" : ""}`} type="button" onClick={openHome}>
            <TabIcon name="home" />
            首页
          </button>
          <button
            className={`tab ${activeTab === "sync" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setActiveTab("sync");
              setActivePlatformId(null);
            }}
          >
            <TabIcon name="sync" />
            同步
          </button>
          <button
            className={`tab ${activeTab === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setActiveTab("settings");
              setActivePlatformId(null);
            }}
          >
            <TabIcon name="settings" />
            设置
          </button>
        </nav>
      </section>

      {manualPlatform && (
        <ManualAddModal
          platform={manualPlatform}
          onClose={() => setManualPlatformId(null)}
          onAdd={manualPlatform.id === "rss" ? addRssSource : addManualCreator}
        />
      )}
      {editingPlatform && editingCreator && (
        <EditCreatorModal
          platform={editingPlatform}
          creator={editingCreator}
          onClose={() => setEditingCreatorContext(null)}
          onSave={(formData) => updateCreator(editingPlatform.id, editingCreator.id, formData)}
        />
      )}
      {showAddChoice && (
        <AddChoiceModal
          platforms={platforms}
          platformOrder={platformOrder}
          platformVisibility={platformVisibility}
          onClose={() => setShowAddChoice(false)}
          onChoose={openAddChoice}
        />
      )}
    </main>
  );
}

function HomePage({ platforms, platformOrder, platformVisibility, onConnect, onOpenUpdate, onOpenCreator, onReset, onViewAll }) {
  const homePlatforms = getHomePlatforms(platforms, platformOrder, platformVisibility);

  return (
    <section className="overview">
      <div className="overview-head">
        <div>
          <h2>我的追更</h2>
        </div>
        <button type="button" onClick={onReset}>重置</button>
      </div>

      <div className="platform-list">
        {homePlatforms.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            onConnect={() => onConnect(platform)}
            onOpenUpdate={onOpenUpdate}
            onOpenCreator={onOpenCreator}
            onViewAll={() => onViewAll(platform.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({ platform, onConnect, onOpenUpdate, onOpenCreator, onViewAll }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const unreadCreators = getUnreadCreators(platform);
  const previewCreators = unreadCreators.slice(0, 2);
  const restCount = unreadCreators.length - previewCreators.length;
  const visibleCreators = platform.creators.filter((creator) => creator.selected !== false);
  const creatorCount = visibleCreators.length;
  const quickCreators = visibleCreators.slice(0, 5);
  const hiddenCreatorCount = creatorCount - quickCreators.length;
  const statusInfo = getHomeStatusInfo(platform, unreadCreators);
  const supplementText = getPlatformSupplementText(platform, creatorCount);
  const shouldShowUnreadUpdates = unreadCreators.length > 0;
  const shouldShowQuickCreators = isExpanded && creatorCount > 0;

  return (
    <article className="platform-card">
      <div className="platform-card-head">
        <button
          className="platform-title expand-trigger"
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
        >
          <span className="blue-oval">{platform.name}</span>
          <span className="expand-arrow">{isExpanded ? "∧" : "∨"}</span>
        </button>

        {creatorCount === 0 ? (
          <button className="card-add-button" type="button" onClick={onConnect}>{getActionText(platform)}</button>
        ) : (
          <button className="view-all" type="button" onClick={onViewAll}>查看全部 →</button>
        )}
      </div>

      <p className="count-text platform-status">
        <span className={`status-chip status-chip-${platform.id === "youtube" ? "auto" : platform.id === "rss" ? "advanced" : "manual"}`}>
          {statusInfo.label}
        </span>
        <span>{statusInfo.text}</span>
      </p>
      <p className="platform-note">{supplementText}</p>

      {shouldShowUnreadUpdates && (
        <div className="creator-list">
          {previewCreators.map((creator) => (
            <CreatorRow
              key={creator.id}
              creator={creator}
              update={creator.unreadUpdates[0]}
              onClick={(event) => {
                event.stopPropagation();
                onOpenUpdate({ platform, creator, update: creator.unreadUpdates[0] });
              }}
            />
          ))}
          {restCount > 0 && (
            <button className="more-line" type="button" onClick={onViewAll}>
              还有 {restCount} 位更新，查看全部 →
            </button>
          )}
        </div>
      )}

      {shouldShowQuickCreators && (
        <div className="quick-creator-list">
          {quickCreators.map((creator) => {
            const hasHomepage = !isMockOrEmptyUrl(creator.homepageUrl);

            return (
              <button
                className="quick-creator-row"
                type="button"
                key={creator.id}
                onClick={() => {
                  if (hasHomepage) onOpenCreator(platform, creator);
                }}
                disabled={!hasHomepage}
              >
                <span>{creator.name}</span>
                {hasHomepage ? <strong>进入主页 →</strong> : <em>暂无主页链接</em>}
              </button>
            );
          })}
          {hiddenCreatorCount > 0 && (
            <button className="more-line quick-more-line" type="button" onClick={onViewAll}>
              还有 {hiddenCreatorCount} 位，查看全部 →
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function CreatorRow({ creator, update, onClick }) {
  const Component = onClick ? "button" : "div";

  return (
    <Component className={`creator-row ${onClick ? "clickable" : ""}`} type={onClick ? "button" : undefined} onClick={onClick}>
      <Avatar text={creator.avatar} />
      <div className="creator-info">
        <div>
          <strong>{creator.name}</strong>
          <span>{update.time} 更新</span>
        </div>
        <p>{update.title}</p>
      </div>
    </Component>
  );
}

function PlatformDetail({
  platform,
  onBack,
  onManualAdd,
  onOpenUpdate,
  onOpenHomepage,
  onOpenFollowedCreator,
  onEditCreator,
  onRemoveCreator
}) {
  const [showReadUpdates, setShowReadUpdates] = useState(false);
  const unreadCreators = getUnreadCreators(platform);
  const readUpdates = getReadUpdates(platform);
  const followedCreators = platform.creators.filter((creator) => creator.selected !== false);
  const statusText = getStatusText(platform, unreadCreators);

  return (
    <section className="detail-page">
      <div className="detail-head">
        <button className="back-link" type="button" onClick={onBack}>← 返回首页</button>
        <button className="detail-add-button" type="button" onClick={onManualAdd} aria-label={`添加${platform.name}`}>＋</button>
      </div>

      <div className="detail-title">
        <span className="blue-oval large">{platform.name}</span>
        <p>{statusText}</p>
      </div>

      {unreadCreators.length > 0 ? (
        <div className="detail-list">
          {unreadCreators.flatMap((creator) =>
            creator.unreadUpdates.map((update) => (
              <article className="detail-card" key={`${creator.id}-${update.id}`}>
                <CreatorRow creator={creator} update={update} />
                <button className="open-content" type="button" onClick={() => onOpenUpdate({ platform, creator, update })}>
                  {platform.id === "youtube" ? "打开内容 →" : "进入主页 →"}
                </button>
              </article>
            ))
          )}
        </div>
      ) : (
        <EmptyState />
      )}

      {platform.creators.length > 0 && (
        <FollowedCreatorsSection
          platformId={platform.id}
          creators={followedCreators}
          onOpenCreator={(creator) => onOpenFollowedCreator(platform, creator)}
          onEditCreator={onEditCreator}
          onRemoveCreator={(creator) => onRemoveCreator(platform.id, creator)}
        />
      )}

      {readUpdates.length > 0 && (
        <section className="read-area">
          <button className="read-toggle" type="button" onClick={() => setShowReadUpdates((current) => !current)}>
            已读更新 {readUpdates.length} 条 {showReadUpdates ? "∧" : "∨"}
          </button>

          {showReadUpdates && (
            <div className="read-list">
              {readUpdates.map((update) => (
                <div className="read-item" key={`${update.creatorName}-${update.id}`}>
                  <div>
                    <strong>{update.creatorName}</strong>
                    <p>{update.title}</p>
                    <button type="button" onClick={() => onOpenHomepage(platform, update)}>进入主页 →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function FollowedCreatorsSection({ platformId, creators, onOpenCreator, onEditCreator, onRemoveCreator }) {
  return (
    <section className="followed-area">
      <h3>已关注博主 {creators.length} 位</h3>
      <div className="followed-list">
        {creators.map((creator) => (
          <div className="followed-item" key={creator.id}>
            <div>
              <strong>{creator.name}</strong>
              {platformId === "youtube" && (
                <>
                  <p className="creator-debug">
                    {creator.sourceId ? `sourceId: ${creator.sourceId}` : "等待同步识别 channelId"}
                  </p>
                  {creator.syncStatus === "unstable" && (
                    <p className="creator-debug">同步偶发失败，已保留上次成功结果</p>
                  )}
                  {creator.syncStatus === "needs_attention" && (
                    <p className="creator-debug">暂不可同步，可作为主页入口使用</p>
                  )}
                </>
              )}
            </div>
            <div className="followed-actions">
              {isMockOrEmptyUrl(creator.homepageUrl) ? (
                <span>暂无主页链接</span>
              ) : (
                <button type="button" onClick={() => onOpenCreator(creator)}>进入主页 →</button>
              )}
              <button className="edit-creator-button" type="button" onClick={() => onEditCreator(creator)}>
                编辑
              </button>
              <button className="remove-creator-button" type="button" onClick={() => onRemoveCreator(creator)}>
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TabIcon({ name }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 10v9h11v-9" />
        <path d="M10 19v-5h4v5" />
      </svg>
    );
  }

  if (name === "sync") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.1 9A7 7 0 0 0 6.7 6.8L4 9.4" />
        <path d="M5.9 15A7 7 0 0 0 17.3 17.2L20 14.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
      <path d="M19 12a7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3h-4.8l-.3 3.1a7 7 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.3 3.1h4.8l.3-3.1a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
    </svg>
  );
}

function AddChoiceModal({ platforms, platformOrder, platformVisibility, onClose, onChoose }) {
  const options = getHomePlatforms(platforms, platformOrder, platformVisibility).map((platform) => ({
    id: platform.id,
    label: getAddChoiceText(platform)
  }));

  return (
    <div className="modal-mask">
      <section className="modal-card">
        <div className="modal-head">
          <h2>添加到 follow</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="add-choice-list">
          {options.map((option) => (
            <button key={option.id} type="button" onClick={() => onChoose(option.id)}>{option.label}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ManualAddModal({ platform, onClose, onAdd }) {
  const isRss = platform.id === "rss";
  const isYouTube = platform.id === "youtube";
  const isBilibili = platform.id === "bilibili";
  const [form, setForm] = useState({
    platformId: platform.id,
    creator: "",
    homepageUrl: "",
    title: "",
    updateUrl: "",
    time: getCurrentTime()
  });
  const nameStatus = useAutoCreatorName(platform, form, setForm);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if ((!isYouTube && !isBilibili && !form.creator.trim()) || !form.homepageUrl.trim()) {
      alert(isYouTube ? "请填写 YouTube 频道链接" : `请填写${getCreatorLabel(platform)}和${getHomepageLabel(platform)}`);
      return;
    }

    onAdd({
      platformId: form.platformId,
      creator: form.creator,
      homepageUrl: form.homepageUrl,
      title: form.title,
      updateUrl: form.updateUrl,
      time: form.time || getCurrentTime()
    });
  }

  return (
    <div className="modal-mask">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>{getManualModalTitle(platform)}</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <label>
          {isYouTube ? "频道名，可选" : getCreatorLabel(platform)}
          <input
            name="creator"
            value={form.creator}
            onChange={handleChange}
            placeholder={isYouTube ? "例如：emma chamberlain" : getCreatorPlaceholder(platform)}
          />
        </label>

        <label>
          {isYouTube ? "YouTube 频道链接" : getHomepageLabel(platform)}
          <input
            name="homepageUrl"
            value={form.homepageUrl}
            onChange={handleChange}
            placeholder={isYouTube ? "https://www.youtube.com/@casey" : isBilibili ? "https://space.bilibili.com/123456" : "https://..."}
          />
          {isYouTube && (
            <span className="field-note">
              粘贴 YouTube 频道主页即可，支持 @handle 或 /channel/UC... 链接。系统会自动识别用于同步的频道 ID。
            </span>
          )}
          {isYouTube && nameStatus && <span className="field-note">{nameStatus}</span>}
          {isBilibili && (
            <span className="field-note">
              先手动添加 B站 UP 主主页，作为主页入口使用。
            </span>
          )}
        </label>

        {!isRss && !isYouTube && !isBilibili && (
          <>
            <label>
              最新内容标题，可选
              <input name="title" value={form.title} onChange={handleChange} placeholder="例如：周末独居日常" />
            </label>
            <label>
              最新内容链接，可选
              <input name="updateUrl" value={form.updateUrl} onChange={handleChange} placeholder="https://..." />
            </label>
            <label>
              更新时间
              <input name="time" value={form.time} onChange={handleChange} placeholder="10:32" />
            </label>
          </>
        )}

        <button className="submit-button" type="submit">加入 follow</button>
      </form>
    </div>
  );
}

function EditCreatorModal({ platform, creator, onClose, onSave }) {
  const isYouTube = platform.id === "youtube";
  const isBilibili = platform.id === "bilibili";
  const [form, setForm] = useState({
    creator: creator.name || "",
    homepageUrl: creator.homepageUrl || ""
  });
  const nameStatus = useAutoCreatorName(platform, form, setForm);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if ((!isYouTube && !isBilibili && !form.creator.trim()) || !form.homepageUrl.trim()) {
      alert(isYouTube ? "请填写频道名和 YouTube 频道链接" : `请填写${getCreatorLabel(platform)}和${getHomepageLabel(platform)}`);
      return;
    }

    onSave(form);
  }

  return (
    <div className="modal-mask">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>编辑 {platform.name} 博主</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <label>
          {isYouTube ? "频道名" : getCreatorLabel(platform)}
          <input name="creator" value={form.creator} onChange={handleChange} />
        </label>

        <label>
          {isYouTube ? "YouTube 频道链接" : getHomepageLabel(platform)}
          <input
            name="homepageUrl"
            value={form.homepageUrl}
            onChange={handleChange}
            placeholder={isYouTube ? "https://www.youtube.com/@casey" : isBilibili ? "https://space.bilibili.com/123456" : "https://..."}
          />
          {isYouTube && nameStatus && <span className="field-note">{nameStatus}</span>}
          {isBilibili && (
            <span className="field-note">
              先手动添加 B站 UP 主主页，实验同步会尝试读取最新投稿。
            </span>
          )}
        </label>

        <button className="submit-button" type="submit">保存修改</button>
      </form>
    </div>
  );
}

function SettingsPage({
  platforms,
  platformOrder,
  platformVisibility,
  onMovePlatform,
  onTogglePlatformVisibility,
  onExport,
  onImport,
  onClear
}) {
  const orderedPlatforms = getOrderedPlatforms(platforms, platformOrder);
  const [openGroups, setOpenGroups] = useState({
    platform: true,
    data: false,
    about: false
  });

  function toggleGroup(groupId) {
    setOpenGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <section className="settings-page">
      <div className="settings-title"><span className="blue-oval">设置</span></div>

      <section className="settings-card settings-group">
        <button
          className="settings-group-head"
          type="button"
          onClick={() => toggleGroup("platform")}
          aria-expanded={openGroups.platform}
        >
          <h2>平台管理</h2>
          <span>{openGroups.platform ? "∧" : "∨"}</span>
        </button>
        {openGroups.platform && (
          <div className="settings-group-body">
            <section className="settings-subsection">
              <h3>平台显示</h3>
              <p>控制首页和添加弹窗显示哪些平台</p>
              <div className="platform-order-list">
                {orderedPlatforms.map((platform) => {
                  const isVisible = platformVisibility?.[platform.id] !== false;

                  return (
                    <div className="platform-order-item" key={platform.id}>
                      <strong>{platform.name}</strong>
                      <button
                        className={`visibility-button ${isVisible ? "visible" : ""}`}
                        type="button"
                        onClick={() => onTogglePlatformVisibility(platform.id)}
                      >
                        {isVisible ? "显示中" : "已隐藏"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="settings-subsection">
              <h3>平台顺序</h3>
              <p>调整首页平台显示顺序</p>
              <div className="platform-order-list">
                {orderedPlatforms.map((platform, index) => (
                  <div className="platform-order-item" key={platform.id}>
                    <strong>
                      {platform.name}
                      {platformVisibility?.[platform.id] === false && <span className="hidden-platform-label">已隐藏</span>}
                    </strong>
                    <div>
                      <button type="button" onClick={() => onMovePlatform(platform.id, -1)} disabled={index === 0}>
                        上移
                      </button>
                      <button type="button" onClick={() => onMovePlatform(platform.id, 1)} disabled={index === orderedPlatforms.length - 1}>
                        下移
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>

      <section className="settings-card settings-group">
        <button className="settings-group-head" type="button" onClick={() => toggleGroup("data")} aria-expanded={openGroups.data}>
          <h2>数据管理</h2>
          <span>{openGroups.data ? "∧" : "∨"}</span>
        </button>
        {openGroups.data && (
          <div className="settings-actions settings-group-body">
            <button type="button" onClick={onExport}>导出数据</button>
            <label className="import-button">导入数据<input type="file" accept="application/json,.json" onChange={onImport} /></label>
            <button className="danger-button" type="button" onClick={onClear}>清空数据</button>
          </div>
        )}
      </section>

      <section className="settings-card settings-group">
        <button className="settings-group-head" type="button" onClick={() => toggleGroup("about")} aria-expanded={openGroups.about}>
          <h2>关于 follow</h2>
          <span>{openGroups.about ? "∧" : "∨"}</span>
        </button>
        {openGroups.about && (
          <div className="settings-group-body">
            <p>follow v0.1</p>
            <p>个人追更小工具</p>
            <p>当前版本为 PWA 原型</p>
          </div>
        )}
      </section>
    </section>
  );
}

function SyncPage({
  youtubePlatform,
  syncState,
  globalSyncState,
  lastGlobalSyncAt,
  lastAutoYouTubeSyncAt,
  onSyncAll
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const isSyncingAll = globalSyncState.status === "syncing";
  const isYouTubeSyncing = syncState.status === "syncing";
  const autoSyncText = getAutoYouTubeSyncText(lastAutoYouTubeSyncAt);
  const debugInfo = globalSyncState.debugInfo || syncState.debugInfo;
  const debugItems = debugInfo
    ? [
        ["失败频道名", debugInfo.creatorName],
        ["当前 sourceId", debugInfo.sourceId],
        ["knownGoodSourceId", debugInfo.knownGoodSourceId],
        ["当前 homepageUrl", debugInfo.homepageUrl],
        ["当前 feedUrl", debugInfo.feedUrl],
        ["knownGoodFeedUrl", debugInfo.knownGoodFeedUrl],
        ["错误类型", debugInfo.error],
        ["解析方式", debugInfo.resolvedBy],
        ["HTTP 状态码", debugInfo.status],
        ["状态文字", debugInfo.statusText],
        ["错误信息", debugInfo.errorMessage],
        ["syncFailCount", debugInfo.syncFailCount],
        ["lastSuccessfulSyncAt", debugInfo.lastSuccessfulSyncAt],
        ["候选 channelId 数量", debugInfo.candidateCount],
        ["alternate feed 数量", debugInfo.alternateFeedCount],
        ["建议", debugInfo.suggestion],
        ["responsePreview", debugInfo.responsePreview?.slice(0, 200)]
      ].filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    : [];

  return (
    <section className="simple-page">
      <span className="blue-oval">同步</span>
      <h2>同步中心</h2>
      <p>统一检查可同步平台的新更新</p>
      <section className="sync-card">
        <h3>同步全部</h3>
        <p>上次同步：{formatSyncTime(lastGlobalSyncAt || youtubePlatform?.lastSyncedAt)}</p>
        <p>{autoSyncText}</p>
        <button className="submit-button" type="button" onClick={onSyncAll} disabled={isSyncingAll || isYouTubeSyncing}>
          {isSyncingAll ? "同步中..." : "同步全部"}
        </button>
        <p className="sync-scope-note">目前仅 YouTube 参与同步，其他平台作为手动入口使用。</p>
        {globalSyncState.message && <p className="sync-message">{globalSyncState.message}</p>}
        {debugInfo && (
          <div className="sync-debug">
            <button className="diagnostics-toggle" type="button" onClick={() => setShowDiagnostics((current) => !current)}>
              {showDiagnostics ? "收起诊断信息" : "查看诊断信息"}
            </button>
            {showDiagnostics && (
              <>
                {debugItems.map(([label, value]) => (
                  <span key={label}>{label}：{value}</span>
                ))}
                {debugInfo.feedUrl && (
                  <button
                    className="feed-test-button"
                    type="button"
                    onClick={() => {
                      window.location.href = debugInfo.feedUrl;
                    }}
                  >
                    打开 feed 测试 →
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <span className="blue-oval">done</span>
      <h3>暂无新更新</h3>
      <p>已配置，等待下一次更新。</p>
    </div>
  );
}

function Avatar({ text }) {
  return <span className="avatar">{text}</span>;
}
