import { statfs } from "node:fs/promises";

/**
 * Takes a job slot if one is free. Every successful call must be paired with releaseJobSlot().
 */
export const takeJobSlot = (): boolean => {
  if (jobsRunning >= MAX_CONCURRENT_JOBS) return false;
  jobsRunning += 1;
  return true;
};

export const releaseJobSlot = () => {
  jobsRunning -= 1;
};

/**
 * Sets aside disk space for a job. The job fits only if it stays within MAX_DISK_GB
 * and within the real free space on `path` after what running jobs have set aside.
 */
export const reserveDisk = async (bytes: number, path: string): Promise<DiskDecision> => {
  if (bytes > MAX_DISK_BYTES) {
    return {
      fits: false,
      neverFits: true,
      message: `Needs ${toGb(bytes)} GB of disk, more than the ${MAX_DISK_GB} GB limit (MAX_DISK_GB)`,
      details: { neededGb: toGb(bytes), maxDiskGb: MAX_DISK_GB },
    };
  }

  const disk = await statfs(path);
  // Checked after the await so no other job can reserve in between.
  const availableBytes = Math.min(
    MAX_DISK_BYTES - reservedDiskBytes,
    disk.bavail * disk.bsize - reservedDiskBytes
  );

  if (bytes > availableBytes) {
    return {
      fits: false,
      neverFits: false,
      message: `Needs ${toGb(bytes)} GB of disk, ${toGb(Math.max(availableBytes, 0))} GB left of ${MAX_DISK_GB} GB`,
      details: {
        neededGb: toGb(bytes),
        availableGb: toGb(Math.max(availableBytes, 0)),
        maxDiskGb: MAX_DISK_GB,
      },
    };
  }

  reservedDiskBytes += bytes;
  return { fits: true };
};

/**
 * Raises a running job's reservation, e.g. when an input without a reported size turns out bigger than counted.
 */
export const reserveExtraDisk = (bytes: number) => {
  reservedDiskBytes += bytes;
};

export const releaseDisk = (bytes: number) => {
  reservedDiskBytes -= bytes;
};

export const getCapacity = () => ({
  jobsRunning,
  maxJobs: MAX_CONCURRENT_JOBS,
  reservedDiskGb: toGb(reservedDiskBytes),
  maxDiskGb: MAX_DISK_GB,
});

const toGb = (bytes: number) => Math.round((bytes / GB) * 10) / 10;

type DiskDecision =
  | { fits: true }
  | { fits: false; neverFits: boolean; message: string; details: Record<string, unknown> };

const GB = 1024 ** 3;

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS ?? 4);
if (!Number.isInteger(MAX_CONCURRENT_JOBS) || MAX_CONCURRENT_JOBS < 1) {
  throw new Error(
    `MAX_CONCURRENT_JOBS must be a whole number of 1 or more, got "${process.env.MAX_CONCURRENT_JOBS}"`
  );
}

const MAX_DISK_GB = Number(process.env.MAX_DISK_GB ?? 65);
if (!Number.isFinite(MAX_DISK_GB) || MAX_DISK_GB <= 0) {
  throw new Error(`MAX_DISK_GB must be a number above 0, got "${process.env.MAX_DISK_GB}"`);
}
const MAX_DISK_BYTES = MAX_DISK_GB * GB;

let jobsRunning = 0;
let reservedDiskBytes = 0;
