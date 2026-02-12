import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import pLimit from "p-limit";

export interface DownloadedInput {
  url: string;
  localPath: string;
  filename: string;
}

// Global download queue shared across all requests
// Limits total concurrent downloads to 12 across the entire server
// This prevents overwhelming the network even with many parallel requests
const globalDownloadLimit = pLimit(12);

/**
 * Downloads files from URLs to local directory using global download queue
 * Returns mapping of URL → local path for each downloaded file
 *
 * Uses a shared global limit of 12 concurrent downloads across all requests
 * to prevent overwhelming the network or running out of file descriptors
 */
export async function downloadInputs(
  urls: string[],
  targetDir: string
): Promise<DownloadedInput[]> {
  // Download all URLs using the global download queue
  // Pass index to avoid filename collisions (e.g., multiple URLs with same basename)
  const downloadPromises = urls.map((url, index) =>
    globalDownloadLimit(() => downloadFile(url, targetDir, index))
  );

  return await Promise.all(downloadPromises);
}

/**
 * Downloads a single file from URL to target directory
 */
async function downloadFile(
  url: string,
  targetDir: string,
  index: number
): Promise<DownloadedInput> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`
      );
    }

    // Extract filename from URL, prefixed with index to avoid collisions
    const filename = `${index}-${extractFilename(url)}`;
    const localPath = join(targetDir, filename);

    // Download file content
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write to local filesystem
    await writeFile(localPath, buffer);

    return {
      url,
      localPath,
      filename,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
    throw new Error(`Failed to download ${url}: ${errorMessage}`);
  }
}

/**
 * Builds a debuggable filename from the full URL path
 * e.g. "https://storage.rendi.dev/files/abc-123/trimmed.mp4" → "files_abc-123_trimmed.mp4"
 */
function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const ext = extname(pathname) || ".bin";

    // Slugify host + path: strip extension, replace non-alphanumeric with underscores, trim
    const withoutExt = `${urlObj.host}${pathname}`.slice(0, -ext.length);
    const slug = withoutExt
      .replace(/[^a-zA-Z0-9-]/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");

    // Truncate to stay within 255-byte filesystem limit (with room for index prefix)
    const maxSlugLength = 240 - ext.length;
    const truncatedSlug =
      slug.length > maxSlugLength ? slug.slice(-maxSlugLength) : slug;

    return `${truncatedSlug}${ext}`;
  } catch {
    return `input-${Date.now()}.bin`;
  }
}
