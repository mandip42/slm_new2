/**
 * Photo persistence.
 *
 * Photos document where a measurement was taken. They are stored as Blobs next to
 * the session they belong to and, like recordings, are always deletable on their
 * own: removing a picture must never put the measured numbers at risk.
 *
 * A photo taken outside a measurement has a null sessionId and is still kept, so
 * a picture is never silently discarded because the user had not pressed START.
 */

import { createId } from '@/lib/id';
import { filenameWithExtension } from '@/lib/filenames';
import { STORES, get, getAll, getAllByIndex, put, remove } from './db';
import { RECORD_SCHEMA_VERSION, type PhotoRecord } from './types';

/** Extension used for stored stills. JPEG is what the capture encodes to. */
export const PHOTO_EXTENSION = 'jpg';

export async function savePhoto(input: {
  blob: Blob;
  sessionId: string | null;
  atSeconds: number | null;
  name: string;
  width: number;
  height: number;
  facing: PhotoRecord['facing'];
}): Promise<PhotoRecord> {
  const record: PhotoRecord = {
    id: createId('pho'),
    schemaVersion: RECORD_SCHEMA_VERSION,
    sessionId: input.sessionId,
    createdAt: Date.now(),
    atSeconds: input.atSeconds,
    // Normalised on the way in, exactly as recordings are: what is stored is
    // what can be written to a filesystem.
    name: filenameWithExtension(input.name, PHOTO_EXTENSION, 'photo'),
    mimeType: input.blob.type || 'image/jpeg',
    width: input.width,
    height: input.height,
    sizeBytes: input.blob.size,
    facing: input.facing,
    blob: input.blob,
  };
  await put(STORES.photos, record);
  return record;
}

export function loadPhoto(id: string): Promise<PhotoRecord | undefined> {
  return get<PhotoRecord>(STORES.photos, id);
}

export async function listPhotos(): Promise<PhotoRecord[]> {
  const photos = await getAll<PhotoRecord>(STORES.photos);
  return photos.sort((a, b) => b.createdAt - a.createdAt);
}

/** Photos belonging to one session, oldest first so they read as a sequence. */
export async function listPhotosForSession(sessionId: string): Promise<PhotoRecord[]> {
  const photos = await getAllByIndex<PhotoRecord>(STORES.photos, 'sessionId', sessionId);
  return photos.sort((a, b) => a.createdAt - b.createdAt);
}

export async function renamePhoto(id: string, name: string): Promise<PhotoRecord | undefined> {
  const record = await get<PhotoRecord>(STORES.photos, id);
  if (!record) return undefined;
  const updated: PhotoRecord = {
    ...record,
    name: filenameWithExtension(name, PHOTO_EXTENSION, 'photo'),
  };
  await put(STORES.photos, updated);
  return updated;
}

export async function deletePhoto(id: string): Promise<void> {
  await remove(STORES.photos, id);
}

/** Total bytes used by stored photos. */
export async function photosSizeBytes(): Promise<number> {
  const photos = await listPhotos();
  return photos.reduce((total, photo) => total + photo.sizeBytes, 0);
}
