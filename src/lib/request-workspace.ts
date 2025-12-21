import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface RequestWorkspace {
  rootDir: string;
  inputsDir: string;
  outputsDir: string;
}

/**
 * Creates a request-scoped workspace in temp directory
 * Structure: /tmp/{requestId}/inputs and /tmp/{requestId}/outputs
 */
export async function createRequestWorkspace(
  requestId: string
): Promise<RequestWorkspace> {
  const rootDir = join(tmpdir(), requestId);
  const inputsDir = join(rootDir, "inputs");
  const outputsDir = join(rootDir, "outputs");

  // Create directory structure
  await mkdir(inputsDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });

  return {
    rootDir,
    inputsDir,
    outputsDir,
  };
}

/**
 * Cleans up request workspace by deleting entire directory tree
 */
export async function cleanupRequestWorkspace(requestId: string): Promise<void> {
  const rootDir = join(tmpdir(), requestId);

  try {
    await rm(rootDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore errors during cleanup (directory might not exist)
    // eslint-disable-next-line no-console
    console.warn(`Failed to cleanup workspace ${rootDir}:`, err);
  }
}
