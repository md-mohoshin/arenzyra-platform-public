const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const NGROK_SKIP_HEADER = "ngrok-skip-browser-warning";

export const dynamic = "force-dynamic";

function isAllowedMediaUrl(url: URL): boolean {
  const apiOrigin = new URL(API_URL).origin;

  return (
    url.origin === apiOrigin &&
    (url.pathname.startsWith("/media/") ||
      url.pathname.startsWith("/uploads/") ||
      url.pathname.startsWith("/assets/logos/") ||
      url.pathname.startsWith("/assets/players/"))
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing media URL", { status: 400 });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(target);
  } catch {
    return new Response("Invalid media URL", { status: 400 });
  }

  if (!isAllowedMediaUrl(mediaUrl)) {
    return new Response("Media URL is not allowed", { status: 400 });
  }

  const upstream = await fetch(mediaUrl, {
    cache: "no-store",
    headers: {
      [NGROK_SKIP_HEADER]: "1",
    },
  });

  if (!upstream.ok) {
    return new Response("Unable to load media", { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  headers.set("cache-control", "public, max-age=300");

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}
