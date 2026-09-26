'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DOC_CSS, resolveBiz, type Biz } from '@/components/EstimateDocument';
import { HEARD_ABOUT_US,
  MAX_PHOTOS, REQUEST_PHOTOS_BUCKET, formatPhone, formatPhoneInput, validateRequest,
  type RequestInput, type RequestPhoto,
} from '@/lib/requests';

/* ------------------------------------------------------------------ *
 * Public estimate request form. Direction B — soft stack: the same
 * letterhead the estimate arrives on, then three rounded cards on the
 * warm ground. Mobile first; tested shape is a 360px phone.
 *
 * The rule this whole file is built around: the customer's typing is
 * never lost. Text is saved server-side BEFORE a single photo moves,
 * so a dead upload on cell service costs them a retry, not the form.
 * ------------------------------------------------------------------ */

const FORM_CSS = `
/* Direction A — paperwork. The form IS the estimate sheet: same letterhead,
   same hairlines, same block button. Nothing floats. */
.sjhc-request .sheet{padding-bottom:0}
.sjhc-request .intro{padding:clamp(18px,4.5vw,26px) clamp(20px,5vw,34px) clamp(16px,4vw,22px);border-bottom:1px solid var(--line);background:#fff}
.sjhc-request .h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,8vw,44px);color:var(--maroon);letter-spacing:.02em;line-height:.95}
.sjhc-request .sub{font-size:clamp(14px,3.7vw,16px);color:#4a4540;margin-top:5px;max-width:40ch}
.sjhc-request .stack{background:#fff}
.sjhc-request .banner{margin:clamp(14px,3.5vw,18px) clamp(20px,5vw,34px) 0;border-left:3px solid #b03040;background:#fdf1f3;
  padding:11px 14px;font-size:14.5px;color:#8c2230}
.sjhc-request .fcard{border-bottom:1px solid var(--line);padding:clamp(15px,4vw,20px) clamp(20px,5vw,34px);background:#fff}
.sjhc-request .fhead{display:flex;flex-direction:row-reverse;justify-content:flex-end;align-items:center;gap:9px;margin-bottom:13px}
.sjhc-request .ftitle{font-family:'Bebas Neue',sans-serif;font-size:clamp(19px,5vw,22px);color:var(--maroon);letter-spacing:.04em}
.sjhc-request .fstep{font-family:'Bebas Neue',sans-serif;font-size:14px;color:#fff;background:var(--maroon);
  width:22px;height:22px;display:grid;place-items:center;border-radius:4px;flex:0 0 auto}
.sjhc-request .grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.sjhc-request .f{display:block;margin-top:9px}
.sjhc-request .f:first-child{margin-top:0}
.sjhc-request .grid2 .f{margin-top:0}
.sjhc-request .flabel{display:block;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:4px}
.sjhc-request .in{width:100%;border:1px solid #d5cdc6;border-radius:6px;background:#fbf9f7;padding:11px 11px;
  font-family:'Barlow Condensed',system-ui,sans-serif;font-size:16px;color:var(--ink);min-height:44px;
  -webkit-appearance:none;appearance:none;transition:border-color 120ms,box-shadow 120ms,background 120ms}
.sjhc-request .in::placeholder{color:#9b938c}
.sjhc-request .in:focus{outline:none;background:#fff;border-color:var(--maroon);box-shadow:0 0 0 2px rgba(61,10,26,.12)}
.sjhc-request .in.bad{border-color:#b03040;background:#fdf6f7}
.sjhc-request textarea.in{min-height:92px;resize:vertical;line-height:1.35}
.sjhc-request .err{font-size:13px;color:#b03040;margin-top:4px}
.sjhc-request .drop{border:1px dashed #c0b6ae;border-radius:6px;background:#fbf9f7;padding:16px 12px;text-align:center}
.sjhc-request .dropt{font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--maroon);letter-spacing:.03em}
.sjhc-request .drophint{font-size:13px;color:var(--muted);margin-top:4px}
.sjhc-request .picks{display:flex;gap:8px;justify-content:center;margin-top:11px;flex-wrap:wrap}
.sjhc-request .pick{border:1px solid #c9bfb7;background:#fff;border-radius:6px;padding:10px 16px;
  font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.05em;color:var(--maroon);cursor:pointer;min-height:44px}
.sjhc-request .pick:disabled{opacity:.45;cursor:default}
.sjhc-request .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}
.sjhc-request .th{position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;background:#eee7e1;border:1px solid var(--line);max-width:100%}
.sjhc-request .th img{width:100%;height:100%;object-fit:cover;display:block}
.sjhc-request .th .x{position:absolute;top:3px;right:3px;width:24px;height:24px;border:none;border-radius:4px;
  background:rgba(28,27,26,.72);color:#fff;font-size:15px;line-height:1;display:grid;place-items:center;cursor:pointer}
.sjhc-request .th .veil{position:absolute;inset:0;display:grid;place-items:center;background:rgba(255,255,255,.8);
  font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;text-align:center;padding:4px}
.sjhc-request .th .veil.bad{background:rgba(176,48,64,.14);color:#8c2230}
.sjhc-request .bar{height:4px;background:#e6ddd6;margin-top:11px;overflow:hidden}
.sjhc-request .bar i{display:block;height:100%;background:var(--grad);transition:width 200ms}
.sjhc-request .btnrow{padding:clamp(16px,4vw,22px) clamp(20px,5vw,34px) clamp(18px,4.5vw,24px);background:#fff}
.sjhc-request .cta{width:100%;border:none;border-radius:8px;padding:16px;background:var(--maroon);color:#fff;
  font-family:'Bebas Neue',sans-serif;font-size:clamp(19px,5vw,22px);letter-spacing:.05em;cursor:pointer;
  position:relative;overflow:hidden;min-height:56px}
.sjhc-request .cta::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--grad)}
.sjhc-request .cta:disabled{opacity:.55;cursor:default}
.sjhc-request .reassure{text-align:center;font-size:13.5px;color:var(--muted);margin-top:10px}
.sjhc-request .turnstile{padding:clamp(14px,3.5vw,18px) clamp(20px,5vw,34px) 0;background:#fff}
.sjhc-request .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.sjhc-request .done{padding:clamp(24px,7vw,44px) clamp(20px,5vw,34px) clamp(30px,8vw,48px);text-align:center;background:#fff}
.sjhc-request .donemark{width:58px;height:58px;margin:0 auto 16px;border-radius:8px;background:var(--maroon);position:relative;
  display:grid;place-items:center;color:#fff;font-family:'Bebas Neue',sans-serif;font-size:28px;overflow:hidden}
.sjhc-request .donemark::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--grad)}
.sjhc-request .doneh{font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,8vw,44px);color:var(--maroon);letter-spacing:.02em;line-height:.98}
.sjhc-request .donep{font-size:clamp(15px,4vw,17px);color:#4a4540;margin:10px auto 0;max-width:34ch}
.sjhc-request .donecall{display:inline-block;margin-top:20px;font-family:'Bebas Neue',sans-serif;font-size:22px;
  letter-spacing:.05em;color:var(--maroon);border:2px solid var(--maroon);border-radius:8px;padding:11px 22px;text-decoration:none}
@media (max-width:360px){.sjhc-request .grid2{grid-template-columns:1fr}.sjhc-request .grid2 .f+.f{margin-top:9px}}
`;


/** First-touch attribution from the URL (Meta/Google append these). Sent, never shown. */
function utmFromLocation(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) { const v = q.get(k); if (v) out[k] = v.slice(0, 200); }
  if (document.referrer) out.referrer = document.referrer.slice(0, 300);
  return out;
}

const EMPTY: RequestInput = {
  first_name: '', last_name: '', email: '', phone: '',
  address: '', city: '', state: 'MI', postal_code: '', description: '',
};

type ShotStatus = 'ready' | 'uploading' | 'done' | 'failed';
interface Shot {
  key: string;
  preview: string;
  blob: Blob;
  width: number | null;
  height: number | null;
  status: ShotStatus;
  path?: string;
}

/* ---------------- Image prep ---------------- */

const isHeic = (f: File) =>
  /\.hei[cf]$/i.test(f.name) || f.type === 'image/heic' || f.type === 'image/heif';

/** heic2any, fetched only when someone actually hands us a HEIC. */
async function loadHeicDecoder(): Promise<((o: unknown) => Promise<Blob | Blob[]>) | null> {
  const w = window as unknown as { heic2any?: (o: unknown) => Promise<Blob | Blob[]> };
  if (w.heic2any) return w.heic2any;
  try {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('heic decoder unavailable'));
      document.head.appendChild(s);
    });
  } catch {
    return null;
  }
  return w.heic2any ?? null;
}

async function decode(blob: Blob): Promise<{ bitmap: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { bitmap, w: bitmap.width, h: bitmap.height };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('could not read that image'));
      el.src = url;
    });
    return { bitmap: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** HEIC in, 1600px JPEG out. iPhone originals are 3-5MB; this lands around 300KB. */
async function prepare(file: File): Promise<Omit<Shot, 'key' | 'status'>> {
  let source: Blob = file;

  if (isHeic(file)) {
    const heic2any = await loadHeicDecoder();
    if (!heic2any) throw new Error('This photo is a HEIC. Reload and try again, or pick it from your Photos app.');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    source = Array.isArray(out) ? out[0]! : out;
  }

  const { bitmap, w, h } = await decode(source);
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not read that image');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  if (!blob) throw new Error('could not read that image');

  return { preview: canvas.toDataURL('image/jpeg', 0.5), blob, width, height };
}

/* ---------------- Component ---------------- */

export default function RequestForm({ biz, leadRef, turnstileSiteKey }: {
  biz: Biz;
  leadRef: string;
  turnstileSiteKey: string | null;
}) {
  const b = resolveBiz(biz);

  const [v, setV] = useState<RequestInput>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [shots, setShots] = useState<Shot[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');

  const [phase, setPhase] = useState<'form' | 'sending' | 'done'>('form');
  const [banner, setBanner] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);

  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  const errors = validateRequest(v);
  const show = (k: keyof RequestInput) => serverErrors[k] ?? (touched[k] ? errors[k] : undefined);
  const set = (k: keyof RequestInput, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    setServerErrors((p) => (p[k] ? { ...p, [k]: '' } : p));
  };
  const blur = (k: keyof RequestInput) => setTouched((p) => ({ ...p, [k]: true }));

  /* ---- Turnstile: only rendered when a site key is configured ---- */
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [turnstileSiteKey]);

  /* ---- Photos ---- */
  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setPhotoNote(null);
    const room = MAX_PHOTOS - shots.length;
    if (room <= 0) { setPhotoNote(`That's the limit of ${MAX_PHOTOS} photos.`); return; }

    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setPhotoNote(`We took the first ${room}. The limit is ${MAX_PHOTOS} photos.`);

    for (const file of chosen) {
      try {
        const prepped = await prepare(file);
        setShots((p) => [...p, { ...prepped, key: `${Date.now()}-${Math.random()}`, status: 'ready' }]);
      } catch (e) {
        setPhotoNote(e instanceof Error ? e.message : "One of those photos wouldn't open.");
      }
    }
  }, [shots.length]);

  const removeShot = (key: string) => setShots((p) => p.filter((s) => s.key !== key));

  /* ---- Submit ---- */
  async function uploadShots(
    list: Shot[],
    uploads: { path: string; token: string }[],
  ): Promise<{ landed: RequestPhoto[]; failures: number }> {
    const supabase = createClient();
    const landed: RequestPhoto[] = [];
    let failures = 0;
    let done = 0;

    for (let i = 0; i < list.length; i++) {
      const slot = uploads[i];
      if (!slot) { failures++; continue; }
      setShots((p) => p.map((s) => (s.key === list[i]!.key ? { ...s, status: 'uploading' } : s)));

      const { error } = await supabase.storage
        .from(REQUEST_PHOTOS_BUCKET)
        .uploadToSignedUrl(slot.path, slot.token, list[i]!.blob, { contentType: 'image/jpeg' });

      if (error) {
        failures++;
        setShots((p) => p.map((s) => (s.key === list[i]!.key ? { ...s, status: 'failed' } : s)));
      } else {
        landed.push({
          path: slot.path,
          bytes: list[i]!.blob.size,
          width: list[i]!.width,
          height: list[i]!.height,
        });
        done++;
        setUploaded(done);
        setShots((p) => p.map((s) => (s.key === list[i]!.key ? { ...s, status: 'done', path: slot.path } : s)));
      }
    }
    return { landed, failures };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setServerErrors({});
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (Object.keys(errors).length) {
      setBanner('A few fields still need a fix. They are marked below.');
      return;
    }

    setPhase('sending');
    setUploaded(0);

    const token = turnstileSiteKey
      ? (document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value ?? '')
      : '';

    let payload: { id: string | null; uploads: { path: string; token: string }[] };
    try {
      const res = await fetch('/api/public/estimate-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...v,
          website: honeypot,
          ref: leadRef,
          ...utmFromLocation(),
          turnstile_token: token,
          photo_count: shots.length,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase('form');
        if (json.errors) setServerErrors(json.errors);
        setBanner(json.error ?? "We couldn't send that. Try again in a moment.");
        return;
      }
      payload = json;
    } catch {
      setPhase('form');
      setBanner('That did not go through. Check your connection and press send again — nothing you typed was lost.');
      return;
    }

    // Text is saved. From here the customer is in, whatever the photos do.
    if (payload.id) setRequestId(payload.id);

    if (payload.id && shots.length) {
      const { landed, failures } = await uploadShots(shots, payload.uploads ?? []);
      try {
        await fetch(`/api/public/estimate-request/${payload.id}/photos-done`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: landed }),
        });
      } catch { /* the objects are in the bucket; the queue email still fires on retry */ }
      if (failures) {
        setPhotoNote(
          `${failures} photo${failures === 1 ? '' : 's'} didn't upload, but your request is in. You can try those again.`,
        );
      }
    }

    setPhase('done');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Re-upload only the photos that didn't land. The server hands back fresh
      slots, so a retry can never clobber one that did make it. */
  async function retryPhotos() {
    const stuck = shots.filter((s) => s.status !== 'done');
    if (!requestId || !stuck.length) return;

    setPhotoNote(null);
    setPhase('sending');
    try {
      const res = await fetch(`/api/public/estimate-request/${requestId}/photo-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: stuck.length }),
      });
      const json = await res.json();
      if (!res.ok || !json.uploads?.length) {
        setPhase('done');
        setPhotoNote(`We couldn't take those photos right now. Text them to ${formatPhone(b.phone)} and we'll add them.`);
        return;
      }

      const { landed, failures } = await uploadShots(stuck, json.uploads);
      await fetch(`/api/public/estimate-request/${requestId}/photos-done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: landed }),
      });
      setPhase('done');
      setPhotoNote(
        failures
          ? `${failures} still didn't go through. Text them to ${formatPhone(b.phone)} and we'll add them.`
          : null,
      );
    } catch {
      setPhase('done');
      setPhotoNote(`We couldn't take those photos right now. Text them to ${formatPhone(b.phone)} and we'll add them.`);
    }
  }

  /* ---------------- Success ---------------- */
  if (phase === 'done') {
    return (
      <div className="sjhc-sign sjhc-request">
        <style>{DOC_CSS}{FORM_CSS}</style>
        <div className="sheet">
          <Letterhead b={b} />
          <div className="done">
            <div className="donemark" aria-hidden="true">✓</div>
            <h1 className="doneh">Got it{v.first_name ? `, ${v.first_name}` : ''}.</h1>
            <p className="donep">
              We&apos;ll text you a price at <b>{formatPhone(v.phone)}</b> within a few hours.
              It comes from {formatPhone(b.phone)}, so watch for that number.
            </p>
            {photoNote && <p className="donep" style={{ color: '#8c2230' }}>{photoNote}</p>}
            {shots.some((s) => s.status === 'failed') && (
              <button type="button" className="pick" style={{ marginTop: 14 }} onClick={retryPhotos}>
                Try those photos again
              </button>
            )}
            <a className="donecall" href={`tel:${(b.phone || '').replace(/\D/g, '')}`}>
              Call {formatPhone(b.phone)}
            </a>
          </div>
          <div className="foot">
            <div className="g" />
            {[b.name, b.phone, b.website].filter(Boolean).join(' · ')} · Downriver Michigan
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Form ---------------- */
  const sending = phase === 'sending';
  const photoPct = shots.length ? Math.round((uploaded / shots.length) * 100) : 0;

  return (
    <div className="sjhc-sign sjhc-request">
      <style>{DOC_CSS}{FORM_CSS}</style>
      <form className="sheet" onSubmit={submit} noValidate>
        <Letterhead b={b} />

        <div className="intro">
          <h1 className="h1">Request an estimate</h1>
          <p className="sub">Tell us what needs to go and send a few photos. Most prices go back out the same day.</p>
        </div>

        <div className="stack">
          {banner && <div className="banner" role="alert">{banner}</div>}

          {/* 1 — About you */}
          <section className="fcard">
            <div className="fhead">
              <span className="ftitle">About you</span>
              <span className="fstep">1</span>
            </div>
            <div className="grid2">
              <label className="f" htmlFor="req-first">
                <span className="flabel">First name</span>
                <input id="req-first" name="given-name" autoComplete="given-name"
                  className={`in ${show('first_name') ? 'bad' : ''}`} value={v.first_name}
                  onChange={(e) => set('first_name', e.target.value)} onBlur={() => blur('first_name')} />
                {show('first_name') && <span className="err">{show('first_name')}</span>}
              </label>
              <label className="f" htmlFor="req-last">
                <span className="flabel">Last name</span>
                <input id="req-last" name="family-name" autoComplete="family-name"
                  className={`in ${show('last_name') ? 'bad' : ''}`} value={v.last_name}
                  onChange={(e) => set('last_name', e.target.value)} onBlur={() => blur('last_name')} />
                {show('last_name') && <span className="err">{show('last_name')}</span>}
              </label>
            </div>
            <label className="f" htmlFor="req-phone">
              <span className="flabel">Phone</span>
              <input id="req-phone" name="tel" autoComplete="tel" inputMode="tel" placeholder="(734) 555-0142"
                className={`in ${show('phone') ? 'bad' : ''}`} value={v.phone}
                onChange={(e) => set('phone', formatPhoneInput(e.target.value))} onBlur={() => blur('phone')} />
              {show('phone') && <span className="err">{show('phone')}</span>}
            </label>
            <label className="f" htmlFor="req-email">
              <span className="flabel">Email</span>
              <input id="req-email" name="email" autoComplete="email" inputMode="email" type="email" placeholder="you@email.com"
                className={`in ${show('email') ? 'bad' : ''}`} value={v.email}
                onChange={(e) => set('email', e.target.value)} onBlur={() => blur('email')} />
              {show('email') && <span className="err">{show('email')}</span>}
            </label>
          </section>

          {/* 2 — The job */}
          <section className="fcard">
            <div className="fhead">
              <span className="ftitle">The job</span>
              <span className="fstep">2</span>
            </div>
            <label className="f" htmlFor="req-street">
              <span className="flabel">Street address</span>
              <input id="req-street" name="street-address" autoComplete="street-address"
                className={`in ${show('address') ? 'bad' : ''}`} value={v.address}
                onChange={(e) => set('address', e.target.value)} onBlur={() => blur('address')} />
              {show('address') && <span className="err">{show('address')}</span>}
            </label>
            <label className="f" htmlFor="req-city">
              <span className="flabel">City</span>
              <input id="req-city" name="address-level2" autoComplete="address-level2"
                className={`in ${show('city') ? 'bad' : ''}`} value={v.city}
                onChange={(e) => set('city', e.target.value)} onBlur={() => blur('city')} />
              {show('city') && <span className="err">{show('city')}</span>}
            </label>
            <div className="grid2" style={{ marginTop: 10 }}>
              <label className="f" htmlFor="req-state">
                <span className="flabel">State</span>
                <input id="req-state" name="address-level1" autoComplete="address-level1" maxLength={2}
                  className="in" value={v.state}
                  onChange={(e) => set('state', e.target.value.toUpperCase())} />
              </label>
              <label className="f" htmlFor="req-zip">
                <span className="flabel">ZIP</span>
                <input id="req-zip" name="postal-code" autoComplete="postal-code" inputMode="numeric" maxLength={10}
                  className={`in ${show('postal_code') ? 'bad' : ''}`} value={v.postal_code}
                  onChange={(e) => set('postal_code', e.target.value)} onBlur={() => blur('postal_code')} />
                {show('postal_code') && <span className="err">{show('postal_code')}</span>}
              </label>
            </div>
            <label className="f" htmlFor="req-desc">
              <span className="flabel">What needs to go</span>
              <textarea id="req-desc" className={`in ${show('description') ? 'bad' : ''}`} value={v.description}
                placeholder="What needs to go? Where is it (garage, basement, curb)? Any stairs or tight spots?"
                onChange={(e) => set('description', e.target.value)} onBlur={() => blur('description')} />
              {show('description') && <span className="err">{show('description')}</span>}
            </label>
            <label className="f" htmlFor="req-heard">
              <span className="flabel">How did you hear about us?</span>
              <select id="req-heard" className="in" value={v.heard_about_us ?? ''} onChange={(e) => set('heard_about_us', e.target.value)}>
                <option value="">Pick one (optional)</option>
                {HEARD_ABOUT_US.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          </section>

          {/* 3 — Photos */}
          <section className="fcard">
            <div className="fhead">
              <span className="ftitle">Photos</span>
              <span className="fstep">3</span>
            </div>
            <div className="drop">
              <div className="dropt">A few photos, and we can price it without coming out</div>
              <p className="drophint">Up to {MAX_PHOTOS}. Optional, but it gets you a real number faster.</p>
              <div className="picks">
                <button type="button" className="pick" disabled={shots.length >= MAX_PHOTOS || sending}
                  onClick={() => cameraRef.current?.click()}>
                  Take a photo
                </button>
                <button type="button" className="pick" disabled={shots.length >= MAX_PHOTOS || sending}
                  onClick={() => libraryRef.current?.click()}>
                  Choose from library
                </button>
              </div>
            </div>

            <input ref={cameraRef} id="req-camera" type="file" accept="image/*" capture="environment"
              hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={libraryRef} id="req-library" type="file" multiple accept="image/*,.heic,.heif"
              hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />

            {shots.length > 0 && (
              <>
                <div className="thumbs">
                  {shots.map((s) => (
                    <div className="th" key={s.key}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview} alt="" />
                      {s.status === 'ready' && !sending && (
                        <button type="button" className="x" aria-label="Remove photo" onClick={() => removeShot(s.key)}>×</button>
                      )}
                      {s.status === 'uploading' && <span className="veil">Sending</span>}
                      {s.status === 'failed' && <span className="veil bad">Failed</span>}
                    </div>
                  ))}
                </div>
                {sending && (
                  <>
                    <div className="bar"><i style={{ width: `${photoPct}%` }} /></div>
                    <p className="drophint" style={{ textAlign: 'left' }}>{uploaded} of {shots.length} sent</p>
                  </>
                )}
              </>
            )}
            {photoNote && <p className="err">{photoNote}</p>}
          </section>

          {/* Turnstile */}
          {turnstileSiteKey && (
            <div className="turnstile">
              <div ref={turnstileRef} className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="light" />
            </div>
          )}

          {/* Honeypot — off-screen, never focusable by a person */}
          <input className="hp" type="text" id="req-website" name="website" tabIndex={-1} autoComplete="off"
            aria-hidden="true" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />

        </div>

        <div className="btnrow">
          <button className="cta" type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Send my request'}
          </button>
          <p className="reassure">
            No obligation. We text you a price at the number above, from {formatPhone(b.phone)}.
          </p>
        </div>

        <div className="foot">
          <div className="g" />
          {[b.name, b.phone, b.website].filter(Boolean).join(' · ')} · Downriver Michigan
        </div>
      </form>
    </div>
  );
}

/* Shared letterhead — the same block the estimate carries. */
function Letterhead({ b }: { b: ReturnType<typeof resolveBiz> }) {
  return (
    <>
      <div className="util">
        {b.licensed_insured && <span><b>Licensed &amp; Insured</b></span>}
        <span>Free estimates</span>
        <span>Serving Downriver MI</span>
      </div>
      <div className="head">
        <div className="brandrow">
          <div className="mark" aria-hidden="true">{b.monogram}</div>
          <div>
            <div className="brandname">{b.name}</div>
            {b.tagline && <div className="tag">{b.tagline}</div>}
          </div>
        </div>
        <div className="contact">
          {b.phone && <span><b>{b.phone}</b></span>}
          {b.website && <span>{b.website}</span>}
        </div>
        {b.area && <div className="area">{b.area}</div>}
      </div>
      <div className="gradbar" />
    </>
  );
}
