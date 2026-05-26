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

const YOUTUBE_FEED_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; follow-rss-checker/0.1)",
  Accept: "application/atom+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

const YOUTUBE_PAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; follow-rss-checker/0.1)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

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

function appendAboutUrl(url) {
  if (!url) return "";
  const cleanUrl = url.split("#")[0].split("?")[0].replace(/\/$/, "");
  if (/\/about$/i.test(cleanUrl)) return cleanUrl;
  return `${cleanUrl}/about`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeChannelId(input = "") {
  const trimmedInput = String(input).trim();
  if (!trimmedInput) return "";

  const directMatch = trimmedInput.match(/^(UC[A-Za-z0-9_-]{22})$/);
  if (directMatch) return directMatch[1];

  const channelMatch = trimmedInput.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/i);
  if (channelMatch) return channelMatch[1];

  return "";
}

function extractChannelIdFromText(text = "") {
  const patterns = [
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
    /\\"channelId\\"\s*:\s*\\"(UC[A-Za-z0-9_-]{22})\\"/,
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
    /\\"externalId\\"\s*:\s*\\"(UC[A-Za-z0-9_-]{22})\\"/,
    /<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*>/i,
    /<meta[^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]+itemprop=["']channelId["'][^>]*>/i,
    /<meta[^>]+itemprop=["']identifier["'][^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*>/i,
    /<meta[^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]+itemprop=["']identifier["'][^>]*>/i,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/i,
    /<link[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"[^>]+rel="canonical"/i,
    /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return "";
}

async function resolveChannelId({ channelId, url, handle }) {
  const normalizedChannelId = normalizeChannelId(channelId);
  if (normalizedChannelId) return normalizedChannelId;

  const handleName = handle ? String(handle).replace(/^@/, "").trim() : "";
  const normalizedUrl = normalizePageUrl(url);
  const handleUrl = handleName ? `https://www.youtube.com/@${handleName}` : "";
  const pageUrls = uniqueValues([handleUrl, appendAboutUrl(handleUrl), normalizedUrl, appendAboutUrl(normalizedUrl)]);

  for (const pageUrl of pageUrls) {
    try {
      const pageResponse = await fetch(pageUrl, { headers: YOUTUBE_PAGE_HEADERS });
      const html = await pageResponse.text();

      if (!pageResponse.ok) continue;

      const resolvedChannelId = extractChannelIdFromText(html);
      if (resolvedChannelId) return resolvedChannelId;
    } catch {
      // Try the next candidate URL.
    }
  }

  return "";
}

export default async function handler(request, response) {
  const channelId = firstQueryValue(request.query.channelId);
  const url = firstQueryValue(request.query.url);
  const handle = firstQueryValue(request.query.handle);
  const input = channelId || url || handle || "";
  let feedUrl = "";

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
        message: "无法从这个 YouTube 频道链接识别 channelId，请尝试在 YouTube 频道页点击“分享频道 → 复制频道 ID”。",
        input,
        videos: []
      });
      return;
    }

    feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(resolvedChannelId)}`;
    const feedResponse = await fetch(feedUrl, { headers: YOUTUBE_FEED_HEADERS });
    const xml = await feedResponse.text();

    if (!feedResponse.ok) {
      response.status(feedResponse.status).json({
        channelId: channelId || "",
        resolvedChannelId,
        error: "feed_fetch_failed",
        message: "YouTube feed 请求失败",
        feedUrl,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        errorMessage: feedResponse.statusText || "HTTP request failed",
        responsePreview: xml.slice(0, 300),
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
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        responsePreview: xml.slice(0, 300),
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
        status: feedResponse.status,
        statusText: feedResponse.statusText,
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
      feedUrl,
      status: 0,
      statusText: "",
      errorMessage: error instanceof Error ? error.message : String(error),
      responsePreview: "",
      videos: []
    });
  }
}
