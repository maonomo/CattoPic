import type { Context } from 'hono';
import type { Env } from '../types';
import { StorageService } from '../services/storage';
import { MetadataService } from '../services/metadata';
import { ImageProcessor } from '../services/imageProcessor';
import { errorResponse } from '../utils/response';
import { parseTags, isMobileDevice, getBestFormat } from '../utils/validation';
import { buildImageUrls } from '../utils/imageTransform';

const CLOUDFLARE_IMAGES_MAX_BYTES = 10 * 1024 * 1024;

// GET /api/random - Get random image (PUBLIC - no auth required)
export async function randomHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const url = new URL(c.req.url);

    // Parse query parameters
    const tagsParam = url.searchParams.get('tags');
    const excludeParam = url.searchParams.get('exclude');
    const orientationParam = url.searchParams.get('orientation');
    const formatParam = url.searchParams.get('format');

    const tags = parseTags(tagsParam);
    const exclude = parseTags(excludeParam);

    // Determine orientation (default to auto-detect based on device)
    let orientation: string | undefined;
    if (orientationParam === 'landscape' || orientationParam === 'portrait') {
      orientation = orientationParam;
    } else {
      // Default: auto-detect based on user agent
      const userAgent = c.req.header('User-Agent');
      orientation = isMobileDevice(userAgent) ? 'portrait' : 'landscape';
    }

    // Get random image metadata
    const metadata = new MetadataService(c.env.DB);
    const image = await metadata.getRandomImage({
      tags: tags.length > 0 ? tags : undefined,
      exclude: exclude.length > 0 ? exclude : undefined,
      orientation
    });

    if (!image) {
      return errorResponse('No images found matching criteria', 404);
    }

    const baseUrl = c.env.R2_PUBLIC_URL;
    const urls = buildImageUrls({
      baseUrl,
      image,
      options: {
        generateWebp: !!image.paths.webp || image.sizes.original > CLOUDFLARE_IMAGES_MAX_BYTES,
        generateAvif: !!image.paths.avif || image.sizes.original > CLOUDFLARE_IMAGES_MAX_BYTES,
      },
    });

    // Determine format to serve
    let targetUrl: string;
    let r2Key: string | null = null;
    let contentTypeFallback: string;

    if (image.format === 'gif') {
      // Always serve original for GIF
      r2Key = image.paths.original;
      targetUrl = urls.original;
      contentTypeFallback = 'image/gif';
    } else {
      // Determine best format based on Accept header or explicit format param
      let format: 'original' | 'webp' | 'avif';

      if (formatParam === 'webp' || formatParam === 'avif' || formatParam === 'original') {
        format = formatParam;
      } else {
        const acceptHeader = c.req.header('Accept');
        format = getBestFormat(acceptHeader);
      }

      switch (format) {
        case 'avif':
          targetUrl = urls.avif || urls.original;
          contentTypeFallback = urls.avif ? 'image/avif' : ImageProcessor.getContentType(image.format);
          if (!urls.avif) {
            r2Key = image.paths.original;
          } else if (image.paths.avif) {
            const isMarker = image.paths.avif === image.paths.original && image.format !== 'avif';
            r2Key = isMarker ? null : image.paths.avif;
          } else {
            r2Key = null;
          }
          break;
        case 'webp':
          targetUrl = urls.webp || urls.original;
          contentTypeFallback = urls.webp ? 'image/webp' : ImageProcessor.getContentType(image.format);
          if (!urls.webp) {
            r2Key = image.paths.original;
          } else if (image.paths.webp) {
            const isMarker = image.paths.webp === image.paths.original && image.format !== 'webp';
            r2Key = isMarker ? null : image.paths.webp;
          } else {
            r2Key = null;
          }
          break;
        default:
          r2Key = image.paths.original;
          targetUrl = urls.original;
          contentTypeFallback = ImageProcessor.getContentType(image.format);
      }
    }

    // If we have a concrete R2 key, serve from R2 binding (no egress).
    if (r2Key) {
      const storage = new StorageService(c.env.R2_BUCKET);
      const file = await storage.get(r2Key);
      if (!file) {
        return errorResponse('Image file not found', 404);
      }

      return new Response(file.body, {
        headers: {
          'Content-Type': contentTypeFallback,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Otherwise (Transform-URL), proxy the transformed response.
    const upstream = await fetch(targetUrl);
    if (!upstream.ok || !upstream.body) {
      console.error('Random handler upstream failed:', upstream.status, targetUrl);
      return errorResponse('Image file not found', 404);
    }

    const contentType = upstream.headers.get('Content-Type') || contentTypeFallback;
    return new Response(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (err) {
    console.error('Random handler error:', err);
    return errorResponse('Failed to get random image');
  }
}
