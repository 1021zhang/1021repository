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

function normalizeFeedUrl(url) {
  if (!url) return "";

  try {
    const parsedUrl = new URL(decodeXml(String(url).trim()));
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    if (parsedUrl.protocol !== "https:" || hostname !== "youtube.com" || parsedUrl.pathname !== "/feeds/videos.xml") {
      return "";
    }
    if (!normalizeChannelId(parsedUrl.searchParams.get("channel_id") || "")) return "";
    return parsedUrl.toString();
  } catch {
    return "";
  }
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

function collectAlternateFeedUrls(text = "") {
  const feedUrls = [];
  const addFeedUrl = (value = "") => {
    const normalizedFeedUrl = normalizeFeedUrl(value.replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
    if (normalizedFeedUrl && !feedUrls.includes(normalizedFeedUrl)) feedUrls.push(normalizedFeedUrl);
  };

  for (const match of text.matchAll(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    addFeedUrl(match[1]);
  }
  for (const match of text.matchAll(/<link[^>]+href=["']([^"']*feeds\/videos\.xml\?channel_id=UC[A-Za-z0-9_-]{22}[^"']*)["'][^>]*>/gi)) {
    addFeedUrl(match[1]);
  }
  for (const match of text.matchAll(/https:\\?\/\\?\/www\.youtube\.com\\?\/feeds\\?\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})/g)) {
    addFeedUrl(`https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}`);
  }
  for (const match of text.matchAll(/https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})/g)) {
    addFeedUrl(`https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}`);
  }

  return feedUrls;
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

async function validateFeedUrl(feedUrl) {
  const normalizedFeedUrl = normalizeFeedUrl(feedUrl);
  if (!normalizedFeedUrl) {
    return {
      channelId: "",
      feedUrl: "",
      status: 400,
      statusText: "Bad Request",
      errorMessage: "Invalid YouTube feed URL",
      responsePreview: "",
      xml: "",
      videos: [],
      channelTitle: "",
      valid: false
    };
  }

  const channelId = normalizeChannelId(new URL(normalizedFeedUrl).searchParams.get("channel_id") || "");
  try {
    const feedResponse = await fetch(normalizedFeedUrl, { headers: YOUTUBE_FEED_HEADERS });
    const xml = await feedResponse.text();
    const hasFeed = /<feed/i.test(xml);
    const videos = hasFeed ? parseVideos(xml) : [];
    const isValid = feedResponse.ok && hasFeed && (videos.length > 0 || /<\/feed>/i.test(xml));

    return {
      channelId,
      feedUrl: normalizedFeedUrl,
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
      feedUrl: normalizedFeedUrl,
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

async function validateFeedForChannelId(channelId) {
  return validateFeedUrl(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
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
  const alternateFeedUrls = [];

  for (const pageUrl of pageUrls) {
    try {
      const pageResponse = await fetch(pageUrl, { headers: YOUTUBE_PAGE_HEADERS });
      const html = await pageResponse.text();

      if (!pageResponse.ok) continue;

      channelTitle = channelTitle || extractChannelTitleFromText(html);
      collectAlternateFeedUrls(html).forEach((feedUrl) => {
        if (!alternateFeedUrls.includes(feedUrl)) alternateFeedUrls.push(feedUrl);
      });
      collectChannelIdCandidates(html).forEach((candidate) => addCandidate(candidateRecords, candidate.id, candidate.source));
    } catch {
      // Try the next candidate URL.
    }
  }

  if (alternateFeedUrls.length > 0) {
    const alternateValidations = [];

    for (const alternateFeedUrl of alternateFeedUrls) {
      const validation = await validateFeedUrl(alternateFeedUrl);
      alternateValidations.push(validation);
      if (validation.valid) {
        return {
          channelId: validation.channelId,
          channelTitle: channelTitle || validation.channelTitle,
          candidates: candidateRecords.map((item) => item.id),
          feedValidation: validation,
          resolvedBy: "alternate_feed"
        };
      }
    }

    return {
      channelId: "",
      channelTitle,
      candidates: candidateRecords.map((item) => item.id),
      alternateFeedUrls,
      alternateValidations,
      alternateFeedFailed: true
    };
  }

  const candidateValidations = [];

  for (const candidate of candidateRecords) {
    const validation = await validateFeedForChannelId(candidate.id);
    candidateValidations.push(validation);
    if (validation.valid) {
      return {
        channelId: candidate.id,
        channelTitle: channelTitle || validation.channelTitle,
        candidates: candidateRecords.map((item) => item.id),
        feedValidation: validation,
        resolvedBy: "channel_id_candidate"
      };
    }
  }

  return { channelId: "", channelTitle, candidates: candidateRecords.map((item) => item.id), candidateValidations };
}

function getFailedFeedStatus(validation) {
  if (!validation) return 502;
  if (validation.status === 0) return 502;
  return validation.status || 502;
}

function getInvalidFeedMessage(validation, fallbackMessage) {
  if (!validation) return fallbackMessage;
  if (validation.status === 404) return "YouTube feed 返回 404";
  if (validation.status === 0) return "YouTube feed 请求失败";
  return fallbackMessage;
}

export default async function handler(request, response) {
  const channelId = firstQueryValue(request.query.channelId);
  const feedUrlInput = firstQueryValue(request.query.feedUrl);
  const url = firstQueryValue(request.query.url);
  const handle = firstQueryValue(request.query.handle);
  const input = feedUrlInput || channelId || url || handle || "";
  let feedUrl = "";

  if (!feedUrlInput && !channelId && !url && !handle) {
    response.status(400).json({
      error: "missing_input",
      message: "缺少 YouTube feedUrl、channelId 或频道链接"
    });
    return;
  }

  try {
    const resolvedInfo = feedUrlInput
      ? {
          channelId: normalizeChannelId(new URL(normalizeFeedUrl(feedUrlInput) || "https://www.youtube.com/feeds/videos.xml").searchParams.get("channel_id") || ""),
          channelTitle: "",
          candidates: [],
          feedValidation: await validateFeedUrl(feedUrlInput),
          resolvedBy: "feed_url"
        }
      : await resolveChannelInfo({ channelId, url, handle });
    const resolvedChannelId = resolvedInfo.channelId;
    let channelTitle = resolvedInfo.channelTitle;

    if (!resolvedChannelId) {
      if (feedUrlInput) {
        response.status(resolvedInfo.feedValidation?.status || 400).json({
          channelId: "",
          resolvedChannelId: "",
          channelTitle,
          error: "invalid_feed_url",
          message: "YouTube feedUrl 无效或无法读取",
          input,
          resolvedBy: "feed_url",
          status: resolvedInfo.feedValidation?.status || 400,
          statusText: resolvedInfo.feedValidation?.statusText || "Bad Request",
          errorMessage: resolvedInfo.feedValidation?.errorMessage || "",
          responsePreview: resolvedInfo.feedValidation?.responsePreview || "",
          videos: []
        });
        return;
      }

      if (resolvedInfo.alternateFeedFailed) {
        const failedValidation = resolvedInfo.alternateValidations?.[0];
        const status = getFailedFeedStatus(failedValidation);

        response.status(status).json({
          channelId: channelId || "",
          resolvedChannelId: "",
          channelTitle,
          error: "alternate_feed_invalid",
          message: getInvalidFeedMessage(failedValidation, "已找到频道 RSS 链接，但无法读取 YouTube feed"),
          input,
          resolvedBy: "alternate_feed",
          feedUrl: failedValidation?.feedUrl || resolvedInfo.alternateFeedUrls?.[0] || "",
          status,
          statusText: failedValidation?.statusText || (status === 502 ? "Bad Gateway" : ""),
          errorMessage: failedValidation?.errorMessage || "",
          responsePreview: failedValidation?.responsePreview || "",
          candidates: resolvedInfo.candidates || [],
          alternateFeedCount: resolvedInfo.alternateFeedUrls?.length || 0,
          videos: []
        });
        return;
      }

      if (resolvedInfo.candidates?.length > 0) {
        const failedValidation = resolvedInfo.candidateValidations?.[0];
        const status = getFailedFeedStatus(failedValidation);

        response.status(status).json({
          channelId: channelId || "",
          resolvedChannelId: "",
          channelTitle,
          error: "resolved_channel_feed_invalid",
          message: getInvalidFeedMessage(failedValidation, "已找到频道 ID 候选，但都无法读取 YouTube feed"),
          input,
          resolvedBy: "channel_id_candidate",
          feedUrl: failedValidation?.feedUrl || "",
          status,
          statusText: failedValidation?.statusText || (status === 502 ? "Bad Gateway" : ""),
          errorMessage: failedValidation?.errorMessage || "",
          responsePreview: failedValidation?.responsePreview || "",
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
        resolvedBy: resolvedInfo.resolvedBy || (feedUrlInput ? "feed_url" : "channel_id"),
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
        resolvedBy: resolvedInfo.resolvedBy || (feedUrlInput ? "feed_url" : "channel_id"),
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
        resolvedBy: resolvedInfo.resolvedBy || (feedUrlInput ? "feed_url" : "channel_id"),
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
      resolvedBy: resolvedInfo.resolvedBy || (feedUrlInput ? "feed_url" : "channel_id"),
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
