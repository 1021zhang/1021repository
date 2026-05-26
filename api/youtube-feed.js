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
  const { channelId, url, handle } = request.query;

  if (!channelId && !url && !handle) {
    response.status(400).json({ error: "Missing channelId" });
    return;
  }

  try {
    const resolvedChannelId = await resolveChannelId({ channelId, url, handle });

    if (!resolvedChannelId) {
      response.status(400).json({
        channelId: channelId || "",
        resolvedChannelId: "",
        error: "无法识别这个 YouTube 频道，请尝试粘贴 /channel/UC... 格式链接",
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
        error: "Failed to fetch YouTube feed",
        videos: []
      });
      return;
    }

    response.status(200).json({
      channelId: channelId || "",
      resolvedChannelId,
      videos: parseVideos(xml)
    });
  } catch (error) {
    response.status(502).json({
      channelId: channelId || "",
      resolvedChannelId: "",
      error: "Failed to fetch YouTube feed",
      detail: error instanceof Error ? error.message : String(error),
      videos: []
    });
  }
}
