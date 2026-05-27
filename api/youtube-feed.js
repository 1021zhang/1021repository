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

function addCandidate(candidates, channelId, source) {
  if (!channelId || candidates.some((candidate) => candidate.id === channelId)) return;
  candidates.push({ id: channelId, source });
}

function addMatches(candidates, text, pattern, source) {
  for (const match of text.matchAll(pattern)) {
    addCandidate(candidates, match[1], source);
  }
}

function collectChannelIdCandidates(text = "") {
  const candidates = [];

  addMatches(
    candidates,
    text,
    /"channelMetadataRenderer"\s*:\s*\{[\s\S]{0,2000}?"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/g,
    "channelMetadataRenderer.externalId"
  );
  addMatches(
    candidates,
    text,
    /\\"channelMetadataRenderer\\"\s*:\s*\{[\s\S]{0,2000}?\\"externalId\\"\s*:\s*\\"(UC[A-Za-z0-9_-]{22})\\"/g,
    "channelMetadataRenderer.externalId"
  );
  addMatches(
    candidates,
    text,
    /"metadata"\s*:\s*\{[\s\S]{0,3000}?"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/g,
    "metadata.channelId"
  );
  addMatches(
    candidates,
    text,
    /<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*>/gi,
    "meta.channelId"
  );
  addMatches(
    candidates,
    text,
    /<meta[^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]+itemprop=["']channelId["'][^>]*>/gi,
    "meta.channelId"
  );
  addMatches(
    candidates,
    text,
    /<meta[^>]+itemprop=["']identifier["'][^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]*>/gi,
    "meta.identifier"
  );
  addMatches(
    candidates,
    text,
    /<meta[^>]+content=["'](UC[A-Za-z0-9_-]{22})["'][^>]+itemprop=["']identifier["'][^>]*>/gi,
    "meta.identifier"
  );
  addMatches(
    candidates,
    text,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["'][^>]*>/gi,
    "canonical"
  );
  addMatches(
    candidates,
    text,
    /<link[^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["'][^>]+rel=["']canonical["'][^>]*>/gi,
    "canonical"
  );
  addMatches(candidates, text, /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/g, "youtube.com/channel");

  return candidates;
}

function cleanChannelTitle(value = "") {
  return decodeXml(value)
    .replace(/\\"/g, '"')
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\s+-\s+YouTube$/i, "")
    .trim();
}

function extractChannelTitleFromText(text = "") {
  const patterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']title["'][^>]*>/i,
    /"ownerChannelName"\s*:\s*"([^"]+)"/,
    /\\"ownerChannelName\\"\s*:\s*\\"([^"]+?)\\"/,
    /"channelMetadataRenderer"\s*:\s*\{[\s\S]*?"title"\s*:\s*"([^"]+)"/,
    /\\"channelMetadataRenderer\\"\s*:\s*\{[\s\S]*?\\"title\\"\s*:\s*\\"([^"]+?)\\"/,
    /"title"\s*:\s*"([^"]+)"/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const title = cleanChannelTitle(match[1]);
      if (title) return title;
    }
  }

  return "";
}

async function validateFeedForChannelId(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

  try {
    const feedResponse = await fetch(feedUrl, { headers: YOUTUBE_FEED_HEADERS });
    const xml = await feedResponse.text();
    const hasFeed = /<feed/i.test(xml);
    const videos = hasFeed ? parseVideos(xml) : [];
    const isValid = feedResponse.ok && hasFeed && (videos.length > 0 || /<\/feed>/i.test(xml));

    return {
      channelId,
      feedUrl,
      status: feedResponse.status,
      statusText: feedResponse.statusText,
      responsePreview: xml.slice(0, 300),
      xml,
      videos,
      channelTitle: feedResponse.ok ? cleanChannelTitle(readTag(xml, "title")) : "",
      valid: isValid
    };
  } catch (error) {
    return {
      channelId,
      feedUrl,
      status: 0,
      statusText: "",
      errorMessage: error instanceof Error ? error.message : String(error),
      responsePreview: "",
      xml: "",
      videos: [],
      channelTitle: "",
      valid: false
    };
  }
}

async function resolveChannelInfo({ channelId, url, handle }) {
  const normalizedChannelId = normalizeChannelId(channelId);
  if (normalizedChannelId) return { channelId: normalizedChannelId, channelTitle: "", candidates: [normalizedChannelId] };

  const handleName = handle ? String(handle).replace(/^@/, "").trim() : "";
  const normalizedUrl = normalizePageUrl(url);
  const handleUrl = handleName ? `https://www.youtube.com/@${handleName}` : "";
  const pageUrls = uniqueValues([handleUrl, appendAboutUrl(handleUrl), normalizedUrl, appendAboutUrl(normalizedUrl)]);
  let channelTitle = "";
  const candidateRecords = [];

  for (const pageUrl of pageUrls) {
    try {
      const pageResponse = await fetch(pageUrl, { headers: YOUTUBE_PAGE_HEADERS });
      const html = await pageResponse.text();

      if (!pageResponse.ok) continue;

      channelTitle = channelTitle || extractChannelTitleFromText(html);
      collectChannelIdCandidates(html).forEach((candidate) => addCandidate(candidateRecords, candidate.id, candidate.source));
    } catch {
      // Try the next candidate URL.
    }
  }

  for (const candidate of candidateRecords) {
    const validation = await validateFeedForChannelId(candidate.id);
    if (validation.valid) {
      return {
        channelId: candidate.id,
        channelTitle: channelTitle || validation.channelTitle,
        candidates: candidateRecords.map((item) => item.id),
        feedValidation: validation
      };
    }
  }

  return { channelId: "", channelTitle, candidates: candidateRecords.map((item) => item.id) };
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
    const resolvedInfo = await resolveChannelInfo({ channelId, url, handle });
    const resolvedChannelId = resolvedInfo.channelId;
    let channelTitle = resolvedInfo.channelTitle;

    if (!resolvedChannelId) {
      if (resolvedInfo.candidates?.length > 0) {
        response.status(502).json({
          channelId: channelId || "",
          resolvedChannelId: "",
          channelTitle,
          error: "resolved_channel_feed_invalid",
          message: "已找到频道 ID 候选，但都无法读取 YouTube feed",
          input,
          status: 502,
          statusText: "Bad Gateway",
          candidates: resolvedInfo.candidates,
          videos: []
        });
        return;
      }

      response.status(400).json({
        channelId: channelId || "",
        resolvedChannelId: "",
        channelTitle,
        error: "channel_id_not_resolved",
        message: "无法从这个 YouTube 频道链接识别 channelId，请尝试在 YouTube 频道页点击“分享频道 → 复制频道 ID”。",
        input,
        videos: []
      });
      return;
    }

    const feedValidation = resolvedInfo.feedValidation || (await validateFeedForChannelId(resolvedChannelId));
    feedUrl = feedValidation.feedUrl;
    const xml = feedValidation.xml;
    channelTitle = channelTitle || feedValidation.channelTitle;

    if (!feedValidation.valid) {
      const invalidFeedResponse = feedValidation.status === 200 && !/<feed/i.test(feedValidation.xml);
      response.status(feedValidation.status || 502).json({
        channelId: channelId || "",
        resolvedChannelId,
        channelTitle,
        error: invalidFeedResponse ? "invalid_feed_response" : "feed_fetch_failed",
        message: invalidFeedResponse ? "YouTube feed 返回内容异常" : "YouTube feed 请求失败",
        feedUrl,
        status: feedValidation.status,
        statusText: feedValidation.statusText,
        errorMessage: feedValidation.errorMessage || feedValidation.statusText || "HTTP request failed",
        responsePreview: feedValidation.responsePreview,
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
        channelTitle,
        feedUrl,
        status: feedValidation.status,
        statusText: feedValidation.statusText,
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
        channelTitle,
        feedUrl,
        status: feedValidation.status,
        statusText: feedValidation.statusText,
        videos: []
      });
      return;
    }

    response.status(200).json({
      channelId: channelId || resolvedChannelId,
      resolvedChannelId,
      channelTitle,
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
