import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
  const downloadPromises = urls.map(url =>
    globalDownloadLimit(() => downloadFile(url, targetDir))
  );

  return await Promise.all(downloadPromises);
}

/**
 * Downloads a single file from URL to target directory
 */
async function downloadFile(
  url: string,
  targetDir: string
): Promise<DownloadedInput> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`
      );
    }

    // Extract filename from URL or use a default
    const filename = extractFilename(url);
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
 * Extracts filename from URL
 * Falls back to timestamp-based filename if extraction fails
 */
function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = basename(pathname);

    // If we got a valid filename with extension, use it
    if (filename && filename.includes(".")) {
      return filename;
    }

    // Fallback: use timestamp + extension from content-type header
    return `input-${Date.now()}.bin`;
  } catch {
    // Invalid URL or extraction failed
    return `input-${Date.now()}.bin`;
  }
}
