// playn-ytlong v1 (2026-11-09): 유튜브 롱폼(일반 영상) 업로드 도우미
// 큰 파일은 함수 메모리에 올리지 않는다. 함수는 업로드 주소(세션)만 만들어 주고, 파일은 호출한 쪽이 그 주소로 바로 올린다.
// POST + 헤더 x-playand-key(intake_key)
//   {action:"init", title, description, tags[], privacy?, size}  → {ok, upload_url}
//   {action:"finish", video_id, thumb_url?}                        → 썸네일 지정 + 기록 → {ok, url, thumb}
// 사장님이 발행 OK 한 영상만 호출한다.
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-playand-key", "access-control-allow-methods": "POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const cfg = async (k: string) => (await sb.from("playand_config").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
const log = (source: string, payload: unknown) => sb.from("playand_log").insert({ source, payload });

async function ytAccess() {
  const r = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: (await cfg("yt_client_id"))!, client_secret: (await cfg("yt_client_secret"))!, refresh_token: (await cfg("yt_refresh_playn"))!, grant_type: "refresh_token" }) })).json();
  if (!r.access_token) throw new Error("yt token: " + JSON.stringify(r.error ?? r).slice(0, 200));
  return r.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const key = await cfg("intake_key");
  if (!key || req.headers.get("x-playand-key") !== key) return new Response("not found", { status: 404 });
  const b = await req.json().catch(() => ({}));
  try {
    const at = await ytAccess();
    if (b.action === "init") {
      const size = Number(b.size); if (!size) return J({ ok: false, error: "size required" }, 400);
      const meta = {
        snippet: { title: String(b.title ?? "").slice(0, 100), description: String(b.description ?? "").slice(0, 4900), tags: Array.isArray(b.tags) ? b.tags.slice(0, 30) : [], categoryId: String(b.category ?? "20"), defaultLanguage: "ko", defaultAudioLanguage: "ko" },
        status: { privacyStatus: b.privacy ?? "public", selfDeclaredMadeForKids: false },
      };
      const r = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { Authorization: "Bearer " + at, "content-type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
        body: JSON.stringify(meta),
      });
      const loc = r.headers.get("location");
      if (!loc) return J({ ok: false, error: (await r.text()).slice(0, 300) }, 502);
      await log("ytlong_init", { title: meta.snippet.title, size });
      return J({ ok: true, upload_url: loc });
    }
    if (b.action === "finish") {
      const id = String(b.video_id ?? ""); if (!id) return J({ ok: false, error: "video_id required" }, 400);
      let thumb: unknown = null;
      if (b.thumb_url) {
        const img = await fetch(String(b.thumb_url));
        const bin = new Uint8Array(await img.arrayBuffer());
        const tr = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, { method: "POST", headers: { Authorization: "Bearer " + at, "content-type": img.headers.get("content-type") ?? "image/jpeg" }, body: bin });
        thumb = tr.ok ? "ok" : `${tr.status} ${(await tr.text()).slice(0, 200)}`;
      }
      const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${id}`, { headers: { Authorization: "Bearer " + at } })).json();
      const it = v.items?.[0];
      await log("ytlong_published", { id, title: it?.snippet?.title, privacy: it?.status?.privacyStatus, thumb });
      return J({ ok: true, url: `https://www.youtube.com/watch?v=${id}`, privacy: it?.status?.privacyStatus, upload: it?.status?.uploadStatus, thumb });
    }
    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    await log("ytlong_failed", { error: String(e).slice(0, 300) });
    return J({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
