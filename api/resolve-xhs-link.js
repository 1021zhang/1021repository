const XHS_MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeExternalUrl(url) {
  if (!url) return "";
  const trimmedUrl = String(url).trim();
  if (!trimmedUrl) return "";
  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function extractXiaohongshuUserId(url) {
  if (!url) return "";
  const match = String(url).trim().match(/\/user\/profile\/([^?&#/]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function normalizeXhsUrl(input) {
  const normalizedUrl = normalizeExternalUrl(input);
  if (!normalizedUrl) return "";

  try {
    const parsedUrl = new URL(normalizedUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    if (!["xhslink.com", "xiaohongshu.com"].includes(hostname)) return "";
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return "";
    return parsedUrl.toString();
  } catch {
    return "";
  }
}

export default async function handler(request, response) {
  const originalUrl = normalizeXhsUrl(firstQueryValue(request.query.url));

  if (!originalUrl) {
    response.status(400).json({
      error: "invalid_url",
      message: "只支持小红书链接"
    });
    return;
  }

  try {
    const parsedUrl = new URL(originalUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");

    if (hostname === "xiaohongshu.com") {
      response.status(200).json({
        originalUrl,
        finalUrl: originalUrl,
        userId: extractXiaohongshuUserId(originalUrl)
      });
      return;
    }

    const xhsResponse = await fetch(originalUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": XHS_MOBILE_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    const finalUrl = normalizeXhsUrl(xhsResponse.url) || originalUrl;

    response.status(200).json({
      originalUrl,
      finalUrl,
      userId: extractXiaohongshuUserId(finalUrl)
    });
  } catch (error) {
    response.status(200).json({
      originalUrl,
      finalUrl: originalUrl,
      userId: "",
      error: "resolve_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
