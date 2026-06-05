import staticPlugin from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError, BadRequestError, ConfigError } from "../lib/errors.js";
import { ok } from "../lib/response.js";

const MAX_IMAGES = 32;
const MAX_HTML_PAGES = 64;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;

const shareImageSchema = z.object({
  filename: z.string().max(80).optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).default("image/png"),
  base64: z.string().min(1),
  caption: z.string().max(120).optional()
});

const shareHtmlPageSchema = z.object({
  filename: z.string().max(80).optional(),
  html: z.string().min(1).max(MAX_HTML_BYTES),
  caption: z.string().max(120).optional()
});

const shareRequestSchema = z
  .object({
    title: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    sourceUrl: z.string().url().optional(),
    images: z.array(shareImageSchema).max(MAX_IMAGES).optional().default([]),
    htmlPages: z.array(shareHtmlPageSchema).max(MAX_HTML_PAGES).optional().default([])
  })
  .refine((value) => value.images.length > 0 || value.htmlPages.length > 0, {
    message: "Share page payload must include images or htmlPages"
  });

export async function registerShareRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const shareRoot = path.resolve(config.SHARE_PUBLIC_DIR);
  await mkdir(shareRoot, { recursive: true });

  await app.register(staticPlugin, {
    root: shareRoot,
    prefix: "/share/",
    decorateReply: false,
    setHeaders(response) {
      response.setHeader("cache-control", "public, max-age=86400, immutable");
    }
  });

  app.post(
    "/api/d2/share-pages",
    {
      bodyLimit: MAX_TOTAL_BYTES + 8 * 1024 * 1024
    },
    async (request) => {
      assertShareUploadToken(request.headers, config);
      const parsed = shareRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new BadRequestError("Invalid share page payload", parsed.error.flatten());
      }

      const id = randomUUID().replace(/-/g, "");
      const pageDir = path.join(shareRoot, id);
      await mkdir(pageDir, { recursive: true });

      let totalBytes = 0;
      const images: ShareImage[] = [];
      const pages: ShareHtmlPage[] = [];

      for (let index = 0; index < parsed.data.htmlPages.length; index += 1) {
        const page = parsed.data.htmlPages[index];
        const html = normalizeSharedHtml(page.html, parsed.data.title || "Destiny 2 查询结果");
        const bytes = Buffer.byteLength(html, "utf8");
        if (bytes > MAX_HTML_BYTES) {
          throw new BadRequestError("Share HTML page is too large", { index, maxBytes: MAX_HTML_BYTES });
        }
        totalBytes += bytes;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new BadRequestError("Share payload is too large", { maxBytes: MAX_TOTAL_BYTES });
        }

        const filename = `page-${String(index + 1).padStart(2, "0")}.html`;
        await writeFile(path.join(pageDir, filename), html, "utf8");
        pages.push({
          src: filename,
          caption: page.caption || `第 ${index + 1} 页`,
          bytes
        });
      }

      for (let index = 0; index < parsed.data.images.length; index += 1) {
        const image = parsed.data.images[index];
        const bytes = Buffer.from(image.base64, "base64");
        if (bytes.length === 0) {
          throw new BadRequestError("Share image is empty", { index });
        }
        if (bytes.length > MAX_IMAGE_BYTES) {
          throw new BadRequestError("Share image is too large", { index, maxBytes: MAX_IMAGE_BYTES });
        }
        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new BadRequestError("Share payload is too large", { maxBytes: MAX_TOTAL_BYTES });
        }

        const extension = extensionForMimeType(image.mimeType);
        const filename = `image-${String(index + 1).padStart(2, "0")}${extension}`;
        await writeFile(path.join(pageDir, filename), bytes);
        images.push({
          src: filename,
          caption: image.caption || `第 ${index + 1} 张`,
          bytes: bytes.length
        });
      }

      await writeFile(
        path.join(pageDir, "index.html"),
        shareHtml({
          title: parsed.data.title || "Destiny 2 查询结果",
          description: parsed.data.description || "",
          sourceUrl: parsed.data.sourceUrl || "",
          pages,
          images,
          createdAt: new Date()
        }),
        "utf8"
      );

      const url = new URL(`/share/${id}/index.html`, config.PUBLIC_BASE_URL).toString();
      return ok({
        id,
        url,
        pageCount: pages.length,
        imageCount: images.length,
        bytes: totalBytes
      });
    }
  );
}

interface ShareImage {
  src: string;
  caption: string;
  bytes: number;
}

interface ShareHtmlPage {
  src: string;
  caption: string;
  bytes: number;
}

function assertShareUploadToken(headers: Record<string, string | string[] | undefined>, config: AppConfig): void {
  if (!config.SHARE_UPLOAD_TOKEN) {
    throw new ConfigError("Share page upload is not configured");
  }
  const authorization = headerValue(headers.authorization);
  const bearer = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
  const token = bearer || headerValue(headers["x-d2-share-token"]).trim();
  if (!constantTimeEquals(token, config.SHARE_UPLOAD_TOKEN)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid share upload token");
  }
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function constantTimeEquals(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function normalizeSharedHtml(html: string, fallbackTitle: string): string {
  const trimmed = html.trim();
  if (/<!doctype html|<html[\s>]/iu.test(trimmed)) {
    return trimmed;
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fallbackTitle)}</title>
</head>
<body>${trimmed}</body>
</html>`;
}

function shareHtml(input: {
  title: string;
  description: string;
  sourceUrl: string;
  pages: ShareHtmlPage[];
  images: ShareImage[];
  createdAt: Date;
}): string {
  const title = escapeHtml(input.title);
  const pageTotal = input.pages.length;
  const imageTotal = input.images.length;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #202020;
      color: #f4f7fb;
      font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 18px 20px;
      background: rgba(23, 23, 23, 0.94);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
    }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .meta { margin-top: 8px; color: #aeb7c2; font-size: 13px; }
    main { width: 100%; margin: 0 auto; padding: 12px clamp(8px, 1.4vw, 22px) 42px; }
    section.share-page,
    figure {
      margin: 0 0 18px;
      padding: 12px;
      border-radius: 10px;
      background: #151515;
      border: 1px solid rgba(255, 255, 255, 0.07);
    }
    .page-head,
    figcaption {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: #c7d0dc;
      font-size: 13px;
      font-weight: 800;
    }
    iframe {
      display: block;
      width: 100%;
      min-height: 680px;
      border: 0;
      border-radius: 6px;
      background: #202020;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 6px;
      background: #0c0c0c;
    }
    a { color: #76b7ff; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <div class="meta">${escapeHtml(input.description)}${input.description ? " · " : ""}${escapeHtml(formatShareDate(input.createdAt))}${input.sourceUrl ? ` · <a href="${escapeAttribute(input.sourceUrl)}">数据源</a>` : ""}</div>
  </header>
  <main>
    ${input.pages
      .map(
        (page, index) => `<section class="share-page">
      <div class="page-head"><span>${escapeHtml(page.caption)}</span><span>${index + 1}/${pageTotal} · HTML · <a href="./${escapeAttribute(page.src)}" target="_blank" rel="noopener">单独打开</a></span></div>
      <iframe src="./${escapeAttribute(page.src)}" loading="${index === 0 ? "eager" : "lazy"}" onload="resizeFrame(this)"></iframe>
    </section>`
      )
      .join("\n")}
    ${input.images
      .map(
        (image, index) => `<figure>
      <figcaption><span>${escapeHtml(image.caption)}</span><span>${index + 1}/${imageTotal} · ${formatBytes(image.bytes)}</span></figcaption>
      <img src="./${escapeAttribute(image.src)}" loading="${index === 0 ? "eager" : "lazy"}" alt="${escapeAttribute(image.caption)}">
    </figure>`
      )
      .join("\n")}
  </main>
  <script>
    function resizeFrame(frame) {
      try {
        var doc = frame.contentDocument || frame.contentWindow.document;
        var height = Math.max(
          doc.documentElement ? doc.documentElement.scrollHeight : 0,
          doc.body ? doc.body.scrollHeight : 0,
          680
        );
        frame.style.height = height + "px";
      } catch (_) {}
    }
  </script>
</body>
</html>`;
}

function formatShareDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
