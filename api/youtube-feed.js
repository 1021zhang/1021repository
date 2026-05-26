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

export default async function handler(request, response) {
  const { channelId } = request.query;

  if (!channelId) {
    response.status(400).json({ error: "Missing channelId" });
    return;
  }

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

  try {
    const feedResponse = await fetch(feedUrl);
    const xml = await feedResponse.text();

    if (!feedResponse.ok) {
      response.status(feedResponse.status).json({
        channelId,
        error: "Failed to fetch YouTube feed",
        videos: []
      });
      return;
    }

    response.status(200).json({
      channelId,
      videos: parseVideos(xml)
    });
  } catch (error) {
    response.status(502).json({
      channelId,
      error: "Failed to fetch YouTube feed",
      detail: error instanceof Error ? error.message : String(error),
      videos: []
    });
  }
}
