import { esc, icon } from './core.js';

export const CATEGORIES = [['all', 'Everything', 'grid'], ['movie', 'Movies', 'film'], ['tv', 'Shows', 'tv'], ['anime', 'Anime', 'star'], ['book', 'Books', 'book'], ['manga', 'Manga', 'manga'], ['comic', 'Comics', 'comic']];
const labels = { movie: 'Movie', tv: 'Show', anime: 'Anime', book: 'Book', manga: 'Manga', comic: 'Comic', collection: 'Collection' };
const libraries = new Map();
const readingKind = (s) => /manga|manhwa|manhua/i.test(s) ? 'manga' : /comic/i.test(s) ? 'comic' : /book|novel/i.test(s) ? 'book' : /anime/i.test(s) ? 'anime' : '';
export const validCategory = (k) => CATEGORIES.some(([key]) => key === k) ? k : 'all';
export function registerLibraries(owner, list) {
  for (const l of list || []) libraries.set(`${owner.id}:${l.Id ?? l.id}`, readingKind(l.Name || l.name || ''));
}
export function kindOf(x) {
  if (labels[x._category]) return x._category;
  const type = String(x.type || x.Type || x.kind || '').toLowerCase();
  const lib = readingKind(x.libraryName || x.LibraryName || '') || libraries.get(`${x._g}:${x.ParentId ?? x.libraryId}`);
  const genres = (x.Genres || x.genres || []).map((g) => typeof g === 'string' ? g : g.name || '');
  const anime = x.anime || lib === 'anime' || genres.some((g) => /^anime$/i.test(g)) || (x.Tags || []).some((t) => /^anime$/i.test(t)) || Object.keys(x.ProviderIds || {}).some((k) => /^(anidb|anilist|myanimelist)$/i.test(k)) || (genres.some((g) => /^animation$/i.test(g)) && (x.ProductionLocations || []).some((c) => /^(japan|jp)$/i.test(c)));
  if (anime) return 'anime';
  if (['manga', 'manhwa', 'manhua'].includes(type)) return 'manga';
  if (['comic', 'comics'].includes(type)) return 'comic';
  if (['book', 'books', 'novel'].includes(type)) return 'book';
  if (type === 'movie' || type === 'boxset') return 'movie';
  if (lib && lib !== 'anime') return lib;
  if (['tv', 'series', 'show', 'episode', 'season'].includes(type)) return 'tv';
  if (Number(x.format) === 3) return 'book';
  return 'other';
}
export const typeBadge = (kind) => labels[kind] ? `<span class="media-type">${esc(labels[kind])}</span>` : '';
export function categoryTabs(selected, attribute, href) {
  return `<nav class="category-tabs chips" aria-label="Media categories">${CATEGORIES.map(([k, label, glyph]) => `<a class="chip ${k === selected ? 'on' : ''}" href="${esc(href(k))}" ${attribute}="${k}"${k === selected ? ' aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav>`;
}
// The same hierarchy in global search and Request search. Filtering is local;
// selecting a category never starts the same server search over again.
export function groupedResults(entries, selected = 'all') {
  selected = validCategory(selected);
  const shown = entries.filter((x) => selected === 'all' || x.kind === selected);
  const groups = selected === 'all' ? [
    ['Movies and shows', shown.filter((x) => ['movie', 'tv', 'anime'].includes(x.kind))],
    ['Books, manga and comics', shown.filter((x) => ['book', 'manga', 'comic', 'reading'].includes(x.kind))],
  ] : [[CATEGORIES.find(([k]) => k === selected)[1], shown]];
  return groups.filter(([, items]) => items.length).map(([name, items]) => `<section class="row category-results"><div class="row-head"><h3>${name} (${items.length})</h3></div><div class="grid">${items.map((x) => x.html).join('')}</div></section>`).join('');
}
