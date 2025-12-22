import { readFile, unlink, stat, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { lookup } from "mime-types";
import { getSupabaseClient } from "./supabase.js";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

export interface OutputFile {
  filename: string;
  path: string;
  url: string;
  size: number;
  contentType: string;
}

/**
 * Parses FFmpeg arguments to extract output file paths
 *
 * FFmpeg syntax: inputs come after -i flag, outputs are standalone file arguments
 * Example: "-i input.mp4 -c:v libx264 output.mp4" -> ["output.mp4"]
 * Example: "-i input.mp4 out1.mp4 out2.webm" -> ["out1.mp4", "out2.webm"]
 */
export function parseOutputFiles(args: string[]): string[] {
  const outputs: string[] = [];
  let skipNext = false;
  let isAfterInput = false;

  // Flags that require a value (skip next arg)
  const flagsWithValues = [
    "-i", "-f", "-c", "-codec", "-vcodec", "-acodec",
    "-b:v", "-b:a", "-r", "-s", "-ar", "-ac",
    "-vf", "-af", "-t", "-ss", "-to",
    "-frames:v", "-frames:a", "-metadata",
    "-filter_complex", "-lavfi", "-map", "-map_metadata",
    "-disposition", "-stream_loop", "-itsoffset",
    "-crf", "-preset", "-profile", "-level", "-qscale",
    "-g", "-bf", "-maxrate", "-bufsize", "-pix_fmt",
  ];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    // Skip the next argument if current flag requires a value
    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Mark that we've seen an input
    if (arg === "-i") {
      isAfterInput = true;
      skipNext = true; // Skip the input filename
      continue;
    }

    // If it starts with -, it's a flag
    if (arg.startsWith("-")) {
      // Check if this flag or its prefix requires a value
      const requiresValue = flagsWithValues.some(flag =>
        arg === flag || arg.startsWith(flag + ":")
      );

      if (requiresValue) {
        skipNext = true;
      }
      continue;
    }

    // Skip arguments that are clearly not file paths:
    // - Stream specifiers like "[0:v]" or "[outv]"
    // - URLs (already processed as inputs or complex filter args)
    if (arg.startsWith("[") || arg.includes("://") || arg.includes("=")) {
      continue;
    }

    // Non-flag argument after we've seen an input = output file
    // Must look like a filename (contains a dot for extension or no special chars)
    if (isAfterInput && !arg.startsWith("-")) {
      outputs.push(arg);
    }
  }

  return outputs;
}

/**
 * Creates a temporary directory for FFmpeg outputs
 * Returns the absolute path to the temp directory
 */
export async function createTempDir(): Promise<string> {
  const tempDir = join(tmpdir(), "ffmpeg-outputs", `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Converts output file paths to absolute paths within temp directory
 */
export function resolveOutputPaths(outputFiles: string[], tempDir: string): Map<string, string> {
  const pathMap = new Map<string, string>();

  for (const outputFile of outputFiles) {
    const filename = basename(outputFile);
    const absolutePath = join(tempDir, filename);
    pathMap.set(outputFile, absolutePath);
  }

  return pathMap;
}

/**
 * Replaces output file paths in args with absolute temp directory paths
 */
export function replaceOutputPaths(args: string[], pathMap: Map<string, string>): string[] {
  return args.map(arg => pathMap.get(arg) || arg);
}

/**
 * Uploads a file to Supabase Storage
 * Validates file size (max 100MB)
 * Returns storage metadata
 */
export async function uploadToSupabase(
  localPath: string,
  originalFilename: string
): Promise<OutputFile> {
  const bucketName = process.env.SUPABASE_BUCKET;

  if (!bucketName) {
    throw new Error("SUPABASE_BUCKET environment variable is not set");
  }

  // Check file exists and get size
  const fileStats = await stat(localPath);

  if (fileStats.size > MAX_FILE_SIZE) {
    throw new Error(
      `File ${originalFilename} exceeds maximum size of 100MB (${fileStats.size} bytes)`
    );
  }

  // Read file buffer
  const fileBuffer = await readFile(localPath);

  // Generate unique storage path: timestamp-filename
  const timestamp = Date.now();
  const storagePath = `${timestamp}-${basename(originalFilename)}`;

  // Detect MIME type
  const contentType = lookup(originalFilename) || "application/octet-stream";

  // Get Supabase client
  const supabase = getSupabaseClient();

  // Upload to Supabase
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(
      `Failed to upload ${originalFilename} to Supabase Storage: ${uploadError.message}`
    );
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucketName).getPublicUrl(storagePath);

  return {
    filename: originalFilename,
    path: storagePath,
    url: publicUrl,
    size: fileStats.size,
    contentType,
  };
}

/**
 * Cleans up temporary files
 * Deletes all files in the given array of paths
 */
export async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  const deletePromises = filePaths.map(async filePath => {
    try {
      await unlink(filePath);
    } catch (err) {
      // Ignore errors during cleanup (file might not exist)
      // eslint-disable-next-line no-console
      console.warn(`Failed to delete temp file ${filePath}:`, err);
    }
  });

  await Promise.all(deletePromises);
}
