function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readTag(entry, tagName) {
  const match = entry.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function readLink(entry) {
  const match = entry.match(/<link[^>]+href="([^"]+)"/i);
  return match ? decodeXml(match[1].trim()) : "";
}

function parseVideos(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return entries.slice(0, 3).map((entry) => {
    const videoId = readTag(entry, "yt:videoId") || readTag(entry, "videoId");
    const link = readLink(entry);

    return {
      id: videoId || link,
      title: readTag(entry, "title"),
      url: link,
      publishedAt: readTag(entry, "published"),
      updatedAt: readTag(entry, "updated")
    };
  });
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePageUrl(url) {
  if (!url) return "";
  const trimmedUrl = String(url).trim();
  if (!trimmedUrl) return "";
  if (trimmedUrl.startsWith("@")) return `https://www.youtube.com/${trimmedUrl}`;
  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function extractChannelIdFromText(text = "") {
  const patterns = [
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/,
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/,
    /youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)"/i,
    /<link[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)"[^>]+rel="canonical"/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return "";
}

async function resolveChannelId({ channelId, url, handle }) {
  if (channelId) return channelId;

  const pageUrl = handle ? `https://www.youtube.com/@${String(handle).replace(/^@/, "")}` : normalizePageUrl(url);
  if (!pageUrl) return "";

  const pageResponse = await fetch(pageUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 follow YouTube feed resolver"
    }
  });
  const html = await pageResponse.text();

  if (!pageResponse.ok) return "";

  return extractChannelIdFromText(html);
}

export default async function handler(request, response) {
  const channelId = firstQueryValue(request.query.channelId);
  const url = firstQueryValue(request.query.url);
  const handle = firstQueryValue(request.query.handle);
  const input = channelId || url || handle || "";

  if (!channelId && !url && !handle) {
    response.status(400).json({
      error: "missing_input",
      message: "缺少 YouTube channelId 或频道链接"
    });
    return;
  }

  try {
    const resolvedChannelId = await resolveChannelId({ channelId, url, handle });

    if (!resolvedChannelId) {
      response.status(400).json({
        channelId: channelId || "",
        resolvedChannelId: "",
        error: "channel_id_not_resolved",
        message: "无法从这个 YouTube 频道链接识别 channelId，请尝试使用 /channel/UC... 格式链接",
        input,
        videos: []
      });
      return;
    }

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(resolvedChannelId)}`;
    const feedResponse = await fetch(feedUrl);
    const xml = await feedResponse.text();

    if (!feedResponse.ok) {
      response.status(feedResponse.status).json({
        channelId: channelId || "",
        resolvedChannelId,
        error: "feed_fetch_failed",
        message: "YouTube feed 请求失败",
        feedUrl,
        status: feedResponse.status,
        videos: []
      });
      return;
    }

    if (!/<feed/i.test(xml) && !/<entry/i.test(xml)) {
      response.status(502).json({
        error: "invalid_feed_response",
        message: "YouTube feed 返回内容异常",
        channelId: resolvedChannelId,
        resolvedChannelId,
        feedUrl,
        preview: xml.slice(0, 200),
        videos: []
      });
      return;
    }

    const videos = parseVideos(xml);

    if (videos.length === 0) {
      response.status(502).json({
        error: "no_videos_parsed",
        message: "YouTube feed 已读取，但没有解析到视频",
        channelId: resolvedChannelId,
        resolvedChannelId,
        feedUrl,
        videos: []
      });
      return;
    }

    response.status(200).json({
      channelId: channelId || resolvedChannelId,
      resolvedChannelId,
      feedUrl,
      videos
    });
  } catch (error) {
    response.status(502).json({
      channelId: channelId || "",
      resolvedChannelId: "",
      error: "feed_fetch_failed",
      message: "YouTube feed 请求失败",
      detail: error instanceof Error ? error.message : String(error),
      videos: []
    });
  }
}
