// Avatars are uploaded to the Whiparc API and referenced by a server-relative
// path (/api/avatars/{key}); the API origin is only known client-side, so the
// path is resolved here. Absolute URLs are deliberately NOT passed through:
// user-supplied third-party image hosts are the thing uploads replaced, so
// anything that doesn't look like our own avatar path renders as initials.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const AVATAR_PATH = /^\/api\/avatars\/[0-9a-f]{32}$/;

export function resolveAvatarUrl(url: string | null | undefined): string {
  if (!url || !AVATAR_PATH.test(url)) return '';
  return `${API_URL}${url}`;
}

// Output size of the cropper and of every stored avatar (square, in px).
export const AVATAR_SIZE = 256;
export const AVATAR_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png';
export const AVATAR_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

// Verifies the file really is a JPEG or PNG from its leading bytes, not from
// the filename or the browser-reported MIME type (both user-controlled).
export async function sniffAvatarType(file: Blob): Promise<'image/png' | 'image/jpeg' | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPng = head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  if (isPng) return 'image/png';
  const isJpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return isJpeg ? 'image/jpeg' : null;
}
