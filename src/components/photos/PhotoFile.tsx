'use client';

/**
 * A photograph of the measurement position, with its file actions.
 *
 * The picture itself is the point, so it is shown full width above the metadata:
 * a thumbnail small enough to fit a metadata row is too small to tell one machine
 * from another.
 */

import { useEffect, useMemo } from 'react';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { renamePhoto, PHOTO_EXTENSION } from '@/storage/photoStore';
import type { PhotoRecord } from '@/storage/types';
import { FileCard } from '@/components/files/FileCard';

export function PhotoFile({
  photo,
  onRenamed,
  onDelete,
}: {
  photo: PhotoRecord;
  onRenamed?: (record: PhotoRecord) => void;
  onDelete?: () => void;
}) {
  /**
   * The object URL is derived from the blob rather than created in an effect, so
   * the first render already has an image to show. It is revoked when the blob
   * changes or the card unmounts; a blob URL keeps its blob in memory for the life
   * of the document otherwise.
   */
  const url = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <FileCard
      blob={photo.blob}
      storedName={photo.name}
      extension={PHOTO_EXTENSION}
      fallbackName="photo"
      mimeType={photo.mimeType}
      nameLabel={`Photo file name for ${photo.name}`}
      downloadLabel="Download photo"
      deleteLabel="Delete photo"
      preview={
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL for an image held in IndexedDB; next/image cannot process an object URL */}
          <img
            src={url}
            alt={`Measurement position: ${photo.name}`}
            className="w-full rounded-lg border border-line bg-panel-sunken object-contain"
          />
        </>
      }
      entries={[
        [
          'Taken',
          photo.atSeconds !== null
            ? `${formatDateTime(photo.createdAt)}, ${formatDuration(photo.atSeconds)} into the measurement`
            : formatDateTime(photo.createdAt),
        ],
        [
          'Image',
          `${photo.width} \u00d7 ${photo.height}, ${
            photo.facing === 'environment'
              ? 'rear camera'
              : photo.facing === 'user'
                ? 'front camera'
                : 'camera not reported'
          }`,
        ],
        ['Size', formatBytes(photo.sizeBytes)],
      ]}
      onRename={async (filename) => {
        const updated = await renamePhoto(photo.id, filename);
        if (updated) onRenamed?.(updated);
      }}
      onDelete={onDelete}
    />
  );
}
