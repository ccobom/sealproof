import {
  requestReleaseStatus,
  type FinalizationFetcher,
  type FinalizedRelease,
  type ReleaseStatus,
} from "./finalization-client";

// Status is supplementary: a failed read must never discard the successful
// finalization response or send the caller back through admission/upload.
export async function retainReleaseAndLoadStatus(
  release: FinalizedRelease,
  retainRelease: (release: FinalizedRelease) => void,
  fetcher?: FinalizationFetcher,
): Promise<ReleaseStatus | undefined> {
  retainRelease(release);
  try {
    return await requestReleaseStatus(release, fetcher);
  } catch {
    return undefined;
  }
}
