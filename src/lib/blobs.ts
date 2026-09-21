/**
 * Blob helpers.
 *
 * Reading a stored blob back as a data URL is needed wherever a file has to be
 * embedded rather than referenced: the printable report is one self-contained
 * document, so an object URL in it would break as soon as it was saved or shared.
 */

/** Read a blob as a `data:` URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('The file could not be read as a data URL.'));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('The file could not be read from local storage.'));
    reader.readAsDataURL(blob);
  });
}
