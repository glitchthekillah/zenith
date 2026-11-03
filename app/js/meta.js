// Extra info for manga and comics from AniList (public, no sign-in): a proper banner,
// a summary, genres, authors and status when the reading server has none.
// Results are kept on this device for a week so each series is only looked up once.
import { http } from './core.js';

const KEY = 'zenith-anilist', WEEK = 7 * 864e5;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const keep = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {} };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const Q = `query($q:String){Media(search:$q,type:MANGA,sort:SEARCH_MATCH){id siteUrl title{romaji english native} synonyms bannerImage coverImage{extraLarge color}
  description(asHtml:false) genres averageScore status format startDate{year} chapters volumes staff(perPage:4,sort:RELEVANCE){edges{role node{name{full}}}}}}`;

export async function anilist(name) {
  if (!name) return null;
  const all = load(), k = norm(name), hit = all[k];
  if (hit && Date.now() - hit.at < WEEK) return hit.data;
  let data = null;
  try {
    const r = await http('https://graphql.anilist.co', { method: 'POST', body: { query: Q, variables: { q: name } } });
    const m = r?.data?.Media;
    // Only keep it if the titles really match, so a book never gets a stranger's banner
    const names = m ? [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].map(norm) : [];
    if (m && names.some((t) => t && (t === k || t.startsWith(k) || k.startsWith(t)))) {
      data = {
        url: m.siteUrl, banner: m.bannerImage || '', cover: m.coverImage?.extraLarge || '', color: m.coverImage?.color || '',
        summary: String(m.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\(Source:[^)]*\)/i, '').trim(),
        genres: m.genres || [], score: m.averageScore || 0, status: { FINISHED: 'Finished', RELEASING: 'Ongoing', HIATUS: 'On hiatus', CANCELLED: 'Cancelled', NOT_YET_RELEASED: 'Upcoming' }[m.status] || '',
        year: m.startDate?.year || '', volumes: m.volumes || 0, chapters: m.chapters || 0,
        authors: (m.staff?.edges || []).filter((e) => /story|art|original/i.test(e.role)).map((e) => e.node?.name?.full).filter(Boolean).slice(0, 2),
      };
    }
  } catch { return null; }
  all[k] = { at: Date.now(), data }; keep(all);
  return data;
}
