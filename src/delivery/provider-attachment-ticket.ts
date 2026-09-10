import { sha256Hex } from "../document/hash";

const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ProviderAttachmentTicketKeys = Readonly<Record<string, Uint8Array>>;

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function issueProviderAttachmentCapability(): Promise<{
  capability: string;
  capabilityHash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(CAPABILITY_BYTES));
  try {
    const capability = encode(bytes);
    return {
      capability,
      capabilityHash: await sha256Hex(new TextEncoder().encode(capability)),
    };
  } finally {
    bytes.fill(0);
  }
}

export async function hashProviderAttachmentCapability(
  capability: string,
): Promise<string | undefined> {
  if (!CAPABILITY_PATTERN.test(capability)) return undefined;
  return sha256Hex(new TextEncoder().encode(capability));
}
