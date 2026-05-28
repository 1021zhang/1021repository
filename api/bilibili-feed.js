function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function readTag(entry, tagName) {
  const match = entry.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function readLink(entry) {
  const linkTag = entry.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (linkTag) return decodeXml(linkTag[1].trim());

  const href = entry.match(/<link[^>]+href=["']([^"']+)["']/i);
  return href ? decodeXml(href[1].trim()) : "";
}

function normalizeUid(input = "") {
  const uid = String(input).trim().match(/^\d+$/)?.[0];
  return uid || "";
}

function parseVideos(xml) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return items
    .map((item, index) => {
      const url = readLink(item);
      const guid = readTag(item, "guid");
      const publishedAt = readTag(item, "pubDate") || readTag(item, "updated");

      return {
        id: guid || url,
        title: readTag(item, "title"),
        url,
        publishedAt,
        author: readTag(item, "author") || readTag(item, "dc:creator"),
        originalIndex: index,
        sortTime: Date.parse(publishedAt)
      };
    })
    .sort((first, second) => {
      const firstHasTime = Number.isFinite(first.sortTime);
      const secondHasTime = Number.isFinite(second.sortTime);
      if (firstHasTime && secondHasTime && first.sortTime !== second.sortTime) return second.sortTime - first.sortTime;
      return first.originalIndex - second.originalIndex;
    })
    .slice(0, 3)
    .map(({ originalIndex, sortTime, ...video }) => video);
}

export default async function handler(request, response) {
  const uid = normalizeUid(firstQueryValue(request.query.uid));
  const feedUrl = uid ? `https://rsshub.app/bilibili/user/video/${encodeURIComponent(uid)}` : "";

  if (!uid) {
    response.status(400).json({
      error: "missing_uid",
      message: "缺少 B站 UID",
      uid: "",
      feedUrl: "",
      videos: []
    });
    return;
  }

  try {
    const feedResponse = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; follow-bilibili-rss-checker/0.1)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    const xml = await feedResponse.text();
    const videos = feedResponse.ok ? parseVideos(xml) : [];

    if (!feedResponse.ok) {
      response.status(feedResponse.status || 502).json({
        error: "feed_fetch_failed",
        message: "B站投稿源暂时无法读取",
        uid,
        feedUrl,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        responsePreview: xml.slice(0, 300),
        videos: []
      });
      return;
    }

    if (!/<item/i.test(xml) || videos.length === 0) {
      response.status(502).json({
        error: "no_videos_parsed",
        message: "B站投稿源已读取，但没有解析到投稿",
        uid,
        feedUrl,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        responsePreview: xml.slice(0, 300),
        videos: []
      });
      return;
    }

    response.status(200).json({ uid, feedUrl, videos });
  } catch (error) {
    response.status(502).json({
      error: "network_request_failed",
      message: "B站投稿源请求失败",
      uid,
      feedUrl,
      status: 0,
      statusText: "",
      errorMessage: error instanceof Error ? error.message : String(error),
      responsePreview: "",
      videos: []
    });
  }
}
