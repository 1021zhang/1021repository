function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtml(value = "") {
  return decodeXml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function readTag(entry, tagName) {
  const match = entry.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function readAtomLink(entry) {
  const alternateMatch = entry.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  if (alternateMatch) return decodeXml(alternateMatch[1].trim());

  const hrefMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return hrefMatch ? decodeXml(hrefMatch[1].trim()) : "";
}

function readRssLink(entry) {
  return readTag(entry, "link") || readTag(entry, "guid");
}

function normalizeFeedUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeItemUrl(value) {
  if (!value) return "";

  try {
    return new URL(String(value).trim()).toString();
  } catch {
    return String(value).trim();
  }
}

function parseItems(xml) {
  const rssItems = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const atomEntries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const entries = rssItems.length > 0 ? rssItems : atomEntries;
  const isAtom = rssItems.length === 0;

  return entries
    .map((entry, index) => {
      const publishedAt = isAtom
        ? readTag(entry, "published") || readTag(entry, "updated")
        : readTag(entry, "pubDate") || readTag(entry, "updated");
      const url = normalizeItemUrl(isAtom ? readAtomLink(entry) : readRssLink(entry));
      const title = stripHtml(readTag(entry, "title"));
      const summary = stripHtml(isAtom ? readTag(entry, "summary") || readTag(entry, "content") : readTag(entry, "description"));

      return {
        id: readTag(entry, "guid") || readTag(entry, "id") || url || title,
        title,
        url,
        publishedAt,
        summary,
        originalIndex: index,
        sortTime: Date.parse(publishedAt)
      };
    })
    .filter((item) => item.title || item.url)
    .sort((first, second) => {
      const firstHasTime = Number.isFinite(first.sortTime);
      const secondHasTime = Number.isFinite(second.sortTime);
      if (firstHasTime && secondHasTime && first.sortTime !== second.sortTime) return second.sortTime - first.sortTime;
      return first.originalIndex - second.originalIndex;
    })
    .slice(0, 5)
    .map(({ originalIndex, sortTime, ...item }) => item);
}

export default async function handler(request, response) {
  const feedUrl = normalizeFeedUrl(request.query.feedUrl);

  if (!feedUrl) {
    response.status(400).json({
      error: "invalid_feed_url",
      message: "缺少或不支持的 RSS 链接"
    });
    return;
  }

  try {
    const feedResponse = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; follow-rss-checker/0.1)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const xml = await feedResponse.text();

    if (!feedResponse.ok) {
      response.status(feedResponse.status || 502).json({
        error: "feed_fetch_failed",
        message: "RSS 源请求失败",
        feedUrl,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        responsePreview: xml.slice(0, 300)
      });
      return;
    }

    if (!/<(?:rss|feed|item|entry)(?:\s|>)/i.test(xml)) {
      response.status(502).json({
        error: "invalid_feed_response",
        message: "RSS 源返回内容异常",
        feedUrl,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        responsePreview: xml.slice(0, 300)
      });
      return;
    }

    const items = parseItems(xml);
    if (items.length === 0) {
      response.status(502).json({
        error: "no_items_parsed",
        message: "RSS 源已读取，但没有解析到文章",
        feedUrl
      });
      return;
    }

    response.status(200).json({ feedUrl, items });
  } catch (error) {
    response.status(502).json({
      error: "network_request_failed",
      message: "RSS 源网络请求失败",
      feedUrl,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}
