import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "follow_blue_oval_app_v1";
const HOME_PLATFORM_IDS = ["youtube", "xiaohongshu", "weibo", "instagram"];
const YOUTUBE_FEED_BASE_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const initialPlatforms = [
  { id: "youtube", name: "YouTube", syncType: "manual", homepageUrl: "https://www.youtube.com", connected: false, creators: [] },
  { id: "xiaohongshu", name: "小红书", syncType: "manual", homepageUrl: "https://www.xiaohongshu.com", connected: false, creators: [] },
  { id: "weibo", name: "微博", syncType: "manual", homepageUrl: "https://weibo.com", connected: false, creators: [] },
  { id: "instagram", name: "Instagram", syncType: "manual", homepageUrl: "https://www.instagram.com", connected: false, creators: [] },
  { id: "rss", name: "RSS", syncType: "rss", homepageUrl: "", connected: false, creators: [] }
];

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

      return {
        ...creator,
        avatar: creator.avatar || creator.name?.slice(0, 1).toUpperCase() || "?",
        sourceId: platform.id === "youtube" ? youtubeSourceId || youtubeInfo?.sourceId || "" : creator.sourceId,
        feedUrl:
          platform.id === "youtube" && youtubeSourceId
            ? creator.feedUrl || getYouTubeFeedUrl(youtubeSourceId)
            : creator.feedUrl || youtubeInfo?.feedUrl,
        handle: platform.id === "youtube" ? creator.handle || youtubeInfo?.handle || "" : creator.handle,
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

function getYouTubeHomepageUrl(homepageUrl, channelId) {
  const normalizedHomepageUrl = normalizeExternalUrl(homepageUrl);
  if (normalizedHomepageUrl) return normalizedHomepageUrl;
  return isValidYouTubeChannelId(channelId) ? `https://www.youtube.com/channel/${channelId}` : "";
}

function getYouTubeCreatorSyncTarget(creator) {
  const channelId = getYouTubeChannelId(creator);
  if (isValidYouTubeChannelId(channelId)) return { type: "channelId", value: channelId };

  const homepageUrl = normalizeExternalUrl(creator.homepageUrl);
  if (homepageUrl) return { type: "url", value: homepageUrl };

  if (creator.handle) return { type: "handle", value: String(creator.handle).replace(/^@/, "") };

  return null;
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
    return "还没添加博主";
  }

  if (unreadCreators.length > 0) {
    if (platform.id === "rss") return `${unreadCreators.length} 个订阅源更新`;
    return `${unreadCreators.length} 位博主更新`;
  }

  if (platform.id === "rss") return `已添加 ${creatorCount} 个订阅源，暂无新更新`;
  return `已添加 ${creatorCount} 位博主，暂无新更新`;
}

function getActionText(platform) {
  if (platform.id === "youtube") return "添加 YouTube 频道";
  if (platform.id === "xiaohongshu") return "添加小红书博主";
  if (platform.id === "weibo") return "添加微博博主";
  if (platform.id === "instagram") return "添加 Instagram 博主";
  return "添加 RSS";
}

function getConnectedNote(platform) {
  if (platform.id === "rss") return "等待下一次同步";
  return "等待下一次更新";
}

function getPlatformSupplementText(platform, creatorCount) {
  if (creatorCount > 0) return getConnectedNote(platform);
  if (platform.id === "youtube") return "先添加频道，有更新会显示在这里";
  return "先添加博主，有更新会显示在这里";
}

function getHomePlatforms(platforms) {
  return HOME_PLATFORM_IDS.map((platformId) => platforms.find((platform) => platform.id === platformId)).filter(Boolean);
}

function getManualModalTitle(platform) {
  if (platform.id === "rss") return "添加 RSS 订阅源";
  if (platform.id === "youtube") return "添加 YouTube 频道";
  return `添加 ${platform.name} 博主`;
}

function getHomepageLabel(platform) {
  if (platform.id === "rss") return "RSS 链接";
  if (platform.id === "youtube") return "YouTube 频道主页链接，可选";
  if (platform.id === "instagram") return "Instagram 主页链接";
  return "主页链接";
}

function getCreatorLabel(platform) {
  if (platform.id === "rss") return "订阅源名称";
  if (platform.id === "youtube") return "频道名";
  return "博主名";
}

function getCreatorPlaceholder(platform) {
  if (platform.id === "rss") return "例如：Design Feed";
  if (platform.id === "youtube") return "例如：MKBHD";
  if (platform.id === "instagram") return "例如：design";
  return "例如：瑞英";
}

export default function App() {
  const [platforms, setPlatforms] = useState(loadPlatforms);
  const [activePlatformId, setActivePlatformId] = useState(null);
  const [manualPlatformId, setManualPlatformId] = useState(null);
  const [editingCreatorContext, setEditingCreatorContext] = useState(null);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [youtubeSyncState, setYouTubeSyncState] = useState({ status: "idle", message: "", debugInfo: null });
  const autoSyncStartedRef = useRef(false);

  const activePlatform = platforms.find((platform) => platform.id === activePlatformId);
  const manualPlatform = platforms.find((platform) => platform.id === manualPlatformId);
  const editingPlatform = platforms.find((platform) => platform.id === editingCreatorContext?.platformId);
  const editingCreator = editingPlatform?.creators.find((creator) => creator.id === editingCreatorContext?.creatorId);
  const youtubePlatform = platforms.find((platform) => platform.id === "youtube");

  function updatePlatforms(nextPlatforms) {
    const normalizedPlatforms = normalizePlatforms(nextPlatforms);
    setPlatforms(normalizedPlatforms);
    savePlatforms(normalizedPlatforms);
  }

  useEffect(() => {
    if (autoSyncStartedRef.current) return;
    autoSyncStartedRef.current = true;

    const youtube = platforms.find((platform) => platform.id === "youtube");
    const hasSyncableCreator = youtube?.creators.some((creator) => getYouTubeChannelId(creator));
    const lastSyncedAt = Date.parse(youtube?.lastSyncedAt || "");
    const shouldSync = hasSyncableCreator && (!Number.isFinite(lastSyncedAt) || Date.now() - lastSyncedAt > AUTO_SYNC_INTERVAL_MS);

    if (shouldSync) {
      syncYouTubeFeeds({ silent: true });
    }
  }, []);

  function openHome() {
    setActiveTab("home");
    setActivePlatformId(null);
    setShowAddChoice(false);
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
    const finalUrl = normalizeExternalUrl(update?.url || creator?.homepageUrl || platform?.homepageUrl);

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

            const creatorName = formData.creator.trim();
            const youtubeInfo = platform.id === "youtube" ? resolveYouTubeChannelInfo(formData.homepageUrl) : null;
            const channelId = youtubeInfo?.sourceId || "";
            const homepageUrl =
              platform.id === "youtube"
                ? youtubeInfo.homepageUrl
                : normalizeExternalUrl(formData.homepageUrl);

            return {
              ...creator,
              name: creatorName,
              avatar: creatorName.slice(0, 1).toUpperCase(),
              homepageUrl,
              sourceId: platform.id === "youtube" ? channelId : creator.sourceId,
              feedUrl: platform.id === "youtube" ? youtubeInfo.feedUrl : creator.feedUrl,
              handle: platform.id === "youtube" ? youtubeInfo.handle : creator.handle
            };
          })
        };
      })
    );

    setEditingCreatorContext(null);
  }

  async function syncYouTubeFeeds(options = {}) {
    const silent = options.silent === true;
    const youtube = platforms.find((platform) => platform.id === "youtube");
    const creators = youtube?.creators.filter((creator) => creator.selected !== false) || [];
    const syncTargets = creators
      .map((creator) => ({ creator, target: getYouTubeCreatorSyncTarget(creator) }))
      .filter(({ target }) => Boolean(target));
    const missingTargetCreators = creators.filter((creator) => !getYouTubeCreatorSyncTarget(creator));

    if (!youtube) return { addedCount: 0, failedCount: 0 };

    if (!silent) {
      setYouTubeSyncState({ status: "syncing", message: "同步中...", debugInfo: null });
    }

    if (syncTargets.length === 0) {
      const syncedAt = new Date().toISOString();
      updatePlatforms(platforms.map((platform) => (platform.id === "youtube" ? { ...platform, lastSyncedAt: syncedAt } : platform)));
      if (!silent) {
        setYouTubeSyncState({ status: "success", message: "还没有可同步的 YouTube 频道，请先添加频道链接。", debugInfo: null });
      }
      return { addedCount: 0, failedCount: 0 };
    }

    const results = await Promise.all(
      syncTargets.map(async ({ creator, target }) => {
        try {
          const queryKey = target.type === "channelId" ? "channelId" : target.type === "handle" ? "handle" : "url";
          const response = await fetch(`/api/youtube-feed?${queryKey}=${encodeURIComponent(target.value)}`);
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            return {
              creatorId: creator.id,
              videos: [],
              failed: true,
              errorCode: data.error || "unknown",
              errorMessage: getYouTubeSyncErrorMessage(data.error),
              debugInfo: {
                creatorName: creator.name,
                sourceId: creator.sourceId || "",
                homepageUrl: creator.homepageUrl || "",
                feedUrl: creator.feedUrl || data.feedUrl || "",
                error: data.error || "unknown",
                status: data.status ?? "",
                statusText: data.statusText || "",
                errorMessage: data.errorMessage || data.message || getYouTubeSyncErrorMessage(data.error),
                responsePreview: (data.responsePreview || data.preview || "").slice(0, 200)
              }
            };
          }

          return {
            creatorId: creator.id,
            videos: Array.isArray(data.videos) ? data.videos : [],
            resolvedChannelId: data.resolvedChannelId || data.channelId || "",
            failed: false,
            errorCode: "",
            errorMessage: "",
            debugInfo: null
          };
        } catch (error) {
          console.warn("YouTube feed sync failed", creator.name, error);
          return {
            creatorId: creator.id,
            videos: [],
            failed: true,
            errorCode: "network_request_failed",
            errorMessage: "同步失败：网络请求失败",
            debugInfo: {
              creatorName: creator.name,
              sourceId: creator.sourceId || "",
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
          if (!result || result.failed) return creator;

          const resolvedChannelId = normalizeYouTubeChannelId(result.resolvedChannelId);
          const resolvedFields = isValidYouTubeChannelId(resolvedChannelId)
            ? {
                sourceId: resolvedChannelId,
                feedUrl: getYouTubeFeedUrl(resolvedChannelId)
              }
            : {};

          const latestVideo = result.videos[0];
          if (!latestVideo) return { ...creator, ...resolvedFields };

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

            return { ...creator, ...resolvedFields, updates: normalizedUpdates };
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

          return { ...creator, ...resolvedFields, updates: [latestUpdate, ...readExistingUpdates] };
        })
      };
    });

    updatePlatforms(nextPlatforms);

    if (!silent) {
      const firstDebugInfo =
        apiFailedResults[0]?.debugInfo ||
        (missingTargetCreators[0]
          ? {
              creatorName: missingTargetCreators[0].name,
              sourceId: missingTargetCreators[0].sourceId || "",
              homepageUrl: missingTargetCreators[0].homepageUrl || "",
              feedUrl: missingTargetCreators[0].feedUrl || "",
              error: "missing_input",
              status: "",
              statusText: "",
              errorMessage: "缺少 YouTube 频道链接或 channelId",
              responsePreview: ""
            }
          : null);

      if (failedCount > 0 && results.every((result) => result.failed)) {
        const firstMissingMessage = missingTargetCreators[0]
          ? `${missingTargetCreators[0].name} 暂时无法识别频道 ID，请尝试使用 /channel/UC... 链接`
          : "";
        const firstApiMessage = apiFailedResults[0]?.errorMessage || "";
        setYouTubeSyncState({
          status: "error",
          message: firstMissingMessage ? `同步失败：${firstMissingMessage}` : firstApiMessage || "同步失败：未知错误",
          debugInfo: firstDebugInfo
        });
      } else if (failedCount > 0) {
        setYouTubeSyncState({
          status: "success",
          message: `同步完成，发现 ${updatedCreatorCount} 位博主的新更新，${failedCount} 个频道失败`,
          debugInfo: firstDebugInfo
        });
      } else {
        setYouTubeSyncState({
          status: "success",
          message: updatedCreatorCount > 0 ? `发现 ${updatedCreatorCount} 位博主的新更新` : "同步完成，暂无新更新",
          debugInfo: null
        });
      }
    }

    return { addedCount: updatedCreatorCount, failedCount };
  }

  function addManualCreator(formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== formData.platformId) return platform;

        const youtubeInfo = platform.id === "youtube" ? resolveYouTubeChannelInfo(formData.homepageUrl) : null;
        const creatorName =
          formData.creator.trim() ||
          (platform.id === "youtube" ? youtubeInfo.handle || youtubeInfo.sourceId || "YouTube 频道" : "");
        const channelId = youtubeInfo?.sourceId || "";
        const homepageUrl =
          platform.id === "youtube"
            ? youtubeInfo.homepageUrl
            : normalizeExternalUrl(formData.homepageUrl);
        const sourceId = platform.id === "youtube" ? channelId : `manual-${Date.now()}`;
        const creatorRecordId = channelId || `manual-${Date.now()}`;
        const feedUrl = youtubeInfo?.feedUrl || "";
        const updateTitle = formData.title.trim();
        const updateUrl = formData.updateUrl.trim();
        const hasUpdate = platform.id !== "youtube" && (updateTitle || updateUrl);
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
                    sourceId: platform.id === "youtube" ? channelId : creator.sourceId,
                    feedUrl: platform.id === "youtube" ? feedUrl : creator.feedUrl,
                    handle: platform.id === "youtube" ? youtubeInfo.handle : creator.handle,
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
    updatePlatforms(initialPlatforms);
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
    setPlatforms(initialPlatforms);
    openHome();
  }

  return (
    <main className="page">
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
            onConnect={openPlatformAction}
            onReset={resetDemo}
            onViewAll={(platformId) => setActivePlatformId(platformId)}
          />
        )}

        {activeTab === "sync" && (
          <SyncPage youtubePlatform={youtubePlatform} syncState={youtubeSyncState} onSync={() => syncYouTubeFeeds()} />
        )}
        {activeTab === "settings" && <SettingsPage onExport={exportData} onImport={importData} onClear={clearData} />}

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
      {showAddChoice && <AddChoiceModal onClose={() => setShowAddChoice(false)} onChoose={openAddChoice} />}
    </main>
  );
}

function HomePage({ platforms, onConnect, onReset, onViewAll }) {
  const homePlatforms = getHomePlatforms(platforms);

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
            onViewAll={() => onViewAll(platform.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({ platform, onConnect, onViewAll }) {
  const unreadCreators = getUnreadCreators(platform);
  const previewCreators = unreadCreators.slice(0, 2);
  const restCount = unreadCreators.length - previewCreators.length;
  const creatorCount = platform.creators.filter((creator) => creator.selected !== false).length;
  const statusText = getStatusText(platform, unreadCreators);
  const supplementText = getPlatformSupplementText(platform, creatorCount);

  return (
    <article className="platform-card">
      <div className="platform-card-head">
        <div className="platform-title">
          <span className="blue-oval">{platform.name}</span>
        </div>

        {creatorCount === 0 ? (
          <button className="view-all" type="button" onClick={onConnect}>{getActionText(platform)}</button>
        ) : (
          <button className="view-all" type="button" onClick={onViewAll}>查看全部 →</button>
        )}
      </div>

      <p className="count-text platform-status">{statusText}</p>
      <p className="platform-note">{supplementText}</p>

      {unreadCreators.length > 0 && (
        <div className="creator-list">
          {previewCreators.map((creator) => (
            <CreatorRow key={creator.id} creator={creator} update={creator.unreadUpdates[0]} />
          ))}
          {restCount > 0 && (
            <button className="more-line" type="button" onClick={onViewAll}>还有 {restCount} 位更新⌄</button>
          )}
        </div>
      )}
    </article>
  );
}

function CreatorRow({ creator, update }) {
  return (
    <div className="creator-row">
      <Avatar text={creator.avatar} />
      <div className="creator-info">
        <div>
          <strong>{creator.name}</strong>
          <span>{update.time} 更新</span>
        </div>
        <p>{update.title}</p>
      </div>
    </div>
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
                <p className="creator-debug">
                  {creator.sourceId ? `sourceId: ${creator.sourceId}` : "等待同步识别 channelId"}
                </p>
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

function AddChoiceModal({ onClose, onChoose }) {
  const options = [
    { id: "youtube", label: "添加 YouTube 频道" },
    { id: "xiaohongshu", label: "添加小红书博主" },
    { id: "weibo", label: "添加微博博主" },
    { id: "instagram", label: "添加 Instagram 博主" },
    { id: "rss", label: "高级：添加 RSS 订阅源" }
  ];

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
  const [form, setForm] = useState({
    platformId: platform.id,
    creator: "",
    homepageUrl: "",
    title: "",
    updateUrl: "",
    time: getCurrentTime()
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if ((!isYouTube && !form.creator.trim()) || !form.homepageUrl.trim()) {
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
            placeholder={isYouTube ? "https://www.youtube.com/@casey" : "https://..."}
          />
          {isYouTube && (
            <span className="field-note">
              粘贴 YouTube 频道主页即可，支持 @handle 或 /channel/UC... 链接。系统会自动识别用于同步的频道 ID。
            </span>
          )}
        </label>

        {!isRss && !isYouTube && (
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
  const [form, setForm] = useState({
    creator: creator.name || "",
    homepageUrl: creator.homepageUrl || ""
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!form.creator.trim() || !form.homepageUrl.trim()) {
      alert(isYouTube ? "请填写频道名和 YouTube 频道链接" : "请填写博主名和主页链接");
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
          {isYouTube ? "频道名" : "博主名"}
          <input name="creator" value={form.creator} onChange={handleChange} />
        </label>

        <label>
          {isYouTube ? "YouTube 频道链接" : "主页链接"}
          <input
            name="homepageUrl"
            value={form.homepageUrl}
            onChange={handleChange}
            placeholder={isYouTube ? "https://www.youtube.com/@casey" : "https://..."}
          />
        </label>

        <button className="submit-button" type="submit">保存修改</button>
      </form>
    </div>
  );
}

function SettingsPage({ onExport, onImport, onClear }) {
  return (
    <section className="settings-page">
      <div className="settings-title"><span className="blue-oval">设置</span></div>
      <section className="settings-card">
        <h2>数据管理</h2>
        <div className="settings-actions">
          <button type="button" onClick={onExport}>导出数据</button>
          <label className="import-button">导入数据<input type="file" accept="application/json,.json" onChange={onImport} /></label>
          <button className="danger-button" type="button" onClick={onClear}>清空数据</button>
        </div>
      </section>
      <section className="settings-card">
        <h2>关于</h2>
        <p>follow v0.1</p>
        <p>个人追更小工具</p>
        <p>当前版本为 PWA 原型</p>
      </section>
    </section>
  );
}

function SyncPage({ youtubePlatform, syncState, onSync }) {
  const channelCount = youtubePlatform?.creators.filter((creator) => creator.selected !== false).length || 0;
  const isSyncing = syncState.status === "syncing";
  const debugInfo = syncState.debugInfo;
  const debugItems = debugInfo
    ? [
        ["失败频道名", debugInfo.creatorName],
        ["当前 sourceId", debugInfo.sourceId],
        ["当前 homepageUrl", debugInfo.homepageUrl],
        ["当前 feedUrl", debugInfo.feedUrl],
        ["错误类型", debugInfo.error],
        ["HTTP 状态码", debugInfo.status],
        ["状态文字", debugInfo.statusText],
        ["错误信息", debugInfo.errorMessage],
        ["responsePreview", debugInfo.responsePreview?.slice(0, 200)]
      ].filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    : [];

  return (
    <section className="simple-page">
      <span className="blue-oval">同步</span>
      <h2>同步中心</h2>
      <section className="sync-card">
        <h3>YouTube</h3>
        <p>已添加 {channelCount} 个频道</p>
        <p>上次同步：{formatSyncTime(youtubePlatform?.lastSyncedAt)}</p>
        <button className="submit-button" type="button" onClick={onSync} disabled={isSyncing}>
          {isSyncing ? "同步中..." : "立即同步 YouTube"}
        </button>
        {syncState.message && <p className="sync-message">{syncState.message}</p>}
        {debugInfo && (
          <div className="sync-debug">
            <strong>调试信息：</strong>
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
