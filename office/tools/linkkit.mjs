// Đọc link an toàn cho văn phòng: trang web, YouTube, Google Drive/Docs, Facebook.
// Dùng chung cho server (xem trước link trong chat) và công cụ read-link.mjs của nhân viên.
// - Chỉ http/https, cổng 80/443; chặn localhost và mạng nội bộ (kể cả sau khi chuyển hướng)
// - Giới hạn thời gian và dung lượng tải; chỉ đọc nội dung CÔNG KHAI (không đăng nhập)
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 NekomaStudio/1.0';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('link không hợp lệ'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('chỉ đọc link http/https');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('chỉ đọc link cổng 80/443');
  if (u.username || u.password) throw new Error('link không được chứa tài khoản/mật khẩu');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('không đọc link trỏ vào máy nội bộ / mạng LAN');
  return u;
}

// fetch có kiểm tra từng lần chuyển hướng + giới hạn dung lượng
export async function safeFetch(raw, { maxBytes = 3 * 1024 * 1024, timeout = 15000, accept = 'text/html,*/*' } = {}) {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const u = await checkUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'vi,en;q=0.8' } });
    } catch (e) { clearTimeout(timer); throw new Error(e.name === 'AbortError' ? 'quá thời gian tải link' : `không tải được link (${e.message})`); }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), u).href;
      continue;
    }
    const chunks = []; let size = 0;
    try {
      for await (const c of res.body || []) {
        size += c.length;
        if (size > maxBytes) { ctrl.abort(); throw new Error(`file quá lớn (trên ${Math.round(maxBytes / 1048576)} MB)`); }
        chunks.push(c);
      }
    } finally { clearTimeout(timer); }
    return { url: u.href, status: res.status, headers: res.headers, buffer: Buffer.concat(chunks) };
  }
  throw new Error('link chuyển hướng quá nhiều lần');
}

const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&nbsp;/g, ' ');

export function pageMeta(html, base) {
  const meta = (k) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'))?.[1] || '').trim();
  const title = meta('og:title') || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  let image = meta('og:image') || meta('twitter:image');
  try { if (image) image = new URL(image, base).href; } catch { image = ''; }
  return { title, description: meta('og:description') || meta('description'), image, site: meta('og:site_name') };
}

// chữ đọc được của trang (bỏ script/style/menu), tối đa maxChars
export function pageText(html, maxChars = 20000) {
  const body = (html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || html)
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(body).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim().slice(0, maxChars);
}

// ---------- nhận dạng loại link ----------
export function youtubeId(raw) {
  try {
    const u = new URL(raw);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      return m ? m[2] : null;
    }
  } catch { /* không phải URL */ }
  return null;
}
export function driveInfo(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === 'docs.google.com') {
      const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
      if (m) return { kind: { document: 'doc', spreadsheets: 'sheet', presentation: 'slides' }[m[1]], id: m[2] };
    }
    if (u.hostname === 'drive.google.com') {
      if (/^\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) return { kind: 'folder', id: u.pathname.split('/').pop() };
      const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get('id');
      if (id) return { kind: 'file', id };
    }
  } catch { /* không phải URL */ }
  return null;
}
export const isFacebook = (raw) => { try { return /(^|\.)(facebook|fb)\.(com|watch)$|^fb\.me$/.test(new URL(raw).hostname); } catch { return false; } };
const loginWall = (url, html = '') => /accounts\.google\.com|ServiceLogin|\/login(\.php)?|checkpoint/i.test(url) || /<form[^>]+(login|signin)/i.test(html);

// ---------- YouTube: tiêu đề, kênh, mô tả, phụ đề ----------
export async function readYoutube(id, { transcript = true } = {}) {
  const out = { kind: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}` };
  try {
    const o = JSON.parse((await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(out.url)}`, { accept: 'application/json' })).buffer.toString('utf8'));
    Object.assign(out, { title: o.title, author: o.author_name, image: o.thumbnail_url });
  } catch { /* video riêng tư hoặc bị chặn nhúng */ }
  if (!transcript) return out;
  try {
    const html = (await safeFetch(`${out.url}&hl=vi`, { maxBytes: 4 * 1024 * 1024 })).buffer.toString('utf8');
    const player = JSON.parse(html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s)?.[1] || '{}');
    const d = player.videoDetails || {};
    Object.assign(out, { title: out.title || d.title, author: out.author || d.author, description: d.shortDescription || '', seconds: +d.lengthSeconds || 0, views: +d.viewCount || 0 });
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track = tracks.find((t) => t.languageCode === 'vi') || tracks.find((t) => t.languageCode?.startsWith('en')) || tracks[0];
    if (track?.baseUrl) {
      const xml = (await safeFetch(track.baseUrl, { accept: 'text/xml' })).buffer.toString('utf8');
      out.transcriptLang = track.languageCode;
      out.transcript = [...xml.matchAll(/<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
        .map(([, s, t]) => `[${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}] ${decode(decode(t)).replace(/\s+/g, ' ').trim()}`).join('\n');
      // YouTube hay chặn tải phụ đề tự động (trả về rỗng) dù video có phụ đề
      if (!out.transcript) out.note = 'video có phụ đề nhưng YouTube chặn tải tự động — dùng tiêu đề + mô tả, hoặc anh dán phụ đề vào chat';
    }
  } catch (e) { out.note = `không lấy được mô tả/phụ đề (${e.message})`; }
  return out;
}

// ---------- Google Drive / Docs (chỉ file chia sẻ "Bất kỳ ai có đường liên kết") ----------
export async function readDrive(info, { download = false } = {}) {
  const out = { kind: 'drive', driveKind: info.kind, id: info.id };
  if (info.kind === 'folder') { out.note = 'Thư mục Drive: chưa đọc được danh sách file (cần đăng nhập Google). Anh gửi link từng file nhé.'; return out; }
  const exportUrl = {
    doc: `https://docs.google.com/document/d/${info.id}/export?format=txt`,
    sheet: `https://docs.google.com/spreadsheets/d/${info.id}/export?format=csv`,
    slides: `https://docs.google.com/presentation/d/${info.id}/export/txt`,
  }[info.kind];
  if (exportUrl) {
    const r = await safeFetch(exportUrl, { maxBytes: 8 * 1024 * 1024, accept: 'text/plain,text/csv,*/*' });
    if (r.status !== 200 || loginWall(r.url, r.buffer.toString('utf8', 0, 4000))) throw new Error('file Drive chưa chia sẻ công khai — anh bật "Bất kỳ ai có đường liên kết đều xem được" rồi gửi lại nhé');
    out.text = r.buffer.toString('utf8').replace(/^﻿/, '');
    out.ext = info.kind === 'sheet' ? 'csv' : 'txt';
    return out;
  }
  // file thường (ảnh, PDF, zip…): tải về nếu được yêu cầu
  const r = await safeFetch(`https://drive.usercontent.google.com/download?id=${info.id}&export=download&confirm=t`, { maxBytes: download ? 100 * 1024 * 1024 : 2 * 1024 * 1024, accept: '*/*' });
  const type = r.headers.get('content-type') || '';
  if (r.status !== 200 || (type.includes('text/html') && loginWall(r.url, r.buffer.toString('utf8', 0, 4000)))) throw new Error('file Drive chưa chia sẻ công khai — anh bật "Bất kỳ ai có đường liên kết đều xem được" rồi gửi lại nhé');
  const cd = r.headers.get('content-disposition') || '';
  out.name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1] || `drive-${info.id}`);
  out.type = type; out.size = r.buffer.length; out.buffer = r.buffer;
  return out;
}

// ---------- trang web / Facebook ----------
export async function readPage(raw, { text = true } = {}) {
  const r = await safeFetch(raw);
  const type = r.headers.get('content-type') || '';
  if (!type.includes('html')) return { kind: 'file', url: r.url, type, size: r.buffer.length };
  const html = r.buffer.toString('utf8');
  const out = { kind: isFacebook(raw) ? 'facebook' : 'web', url: r.url, ...pageMeta(html, r.url) };
  // Facebook chặn người đọc không đăng nhập: trang trả về "Error"/"Log in" thay cho tiêu đề thật
  if (isFacebook(raw) && /^(error|facebook|log ?in|đăng nhập)/i.test(out.title || '')) out.title = '';
  if (isFacebook(raw) && (loginWall(r.url, html) || !out.description)) out.note = 'Facebook chỉ cho đọc phần công khai (tiêu đề, mô tả, ảnh). Bài riêng tư/nhóm kín cần đăng nhập — anh copy nội dung hoặc chụp màn hình gửi vào chat nhé.';
  if (text && !isFacebook(raw)) out.text = pageText(html);
  return out;
}

// Xem trước gọn cho thẻ link trong chat
export async function preview(raw) {
  const yt = youtubeId(raw);
  if (yt) return readYoutube(yt, { transcript: false });
  const drive = driveInfo(raw);
  if (drive) {
    try { const p = await readPage(raw, { text: false }); return { ...p, kind: 'drive', driveKind: drive.kind }; }
    catch { return { kind: 'drive', driveKind: drive.kind, url: raw, title: 'Google Drive' }; }
  }
  return readPage(raw, { text: false });
}
