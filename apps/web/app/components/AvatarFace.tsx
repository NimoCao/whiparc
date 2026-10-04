'use client';

import { useState } from 'react';
import { resolveAvatarUrl } from '../lib/avatar';

interface AvatarFaceProps {
  url?: string | null;
  name: string;
  // Rendered when there is no avatar or it fails to load.
  initials?: number;
}

// Inner content of an avatar chip: the uploaded image, or the user's initials.
// The caller owns the surrounding box (size, shape, background), because every
// place that shows an avatar styles it differently.
export default function AvatarFace({ url, name, initials = 2 }: AvatarFaceProps) {
  // Tracks the URL that failed rather than a boolean, so a new upload (new
  // URL) is tried again instead of staying stuck on initials.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolveAvatarUrl(url);

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- server-resized 256px PNG from our own API, not an optimizable remote asset
      <img
        src={src}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return <>{name.slice(0, initials).toUpperCase()}</>;
}
