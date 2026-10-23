// Bounded decode cache: current/neighbor slides, not the entire image collection.
const cache = new Map<string, Promise<HTMLImageElement>>();
export function decodedSlide(src: string): Promise<HTMLImageElement> {
  const existing = cache.get(src);
  if (existing) return existing;
  const image = new Image();
  image.src = src;
  const loaded = image.decode().then(() => {
    if (!image.naturalWidth) throw new Error("Empty slide: " + src);
    return image;
  }).catch(error => { cache.delete(src); throw error; });
  cache.set(src, loaded);
  while (cache.size > 6) cache.delete(cache.keys().next().value!);
  return loaded;
}
