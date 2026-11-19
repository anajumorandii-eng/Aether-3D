const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/** Conservative name matching. Ambiguous or different versions must not auto-take playback. */
export function findTrackMatch<T extends { name: string }>(files: T[], title: string, artist: string): T | undefined {
  const track = normalize(title);
  if (!track) return undefined;
  const artists = [...new Set([artist, artist.split(',')[0]].map(normalize).filter(Boolean))];
  let best: T | undefined; let bestScore = 0; let tied = false;
  for (const file of files) {
    const names = [normalize(file.name), normalize(file.name.replace(/^\s*\d+\s*[-._]\s*/, ''))];
    const score = names.some(name => artists.some(a => name === a + track || name === track + a)) ? 3 : names.includes(track) ? 1 : 0;
    if (score > bestScore) { best = file; bestScore = score; tied = false; }
    else if (score > 0 && score === bestScore) tied = true;
  }
  return tied ? undefined : best;
}
