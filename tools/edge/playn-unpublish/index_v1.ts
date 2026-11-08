// playn-unpublish v1 (2026-11-08): 발행된 릴스 하나를 인스타(피드·스토리)·스레드·유튜브·페이스북에서 지움
// POST {queue_id, story_id?} + 헤더 x-playand-key(intake_key). 사장님이 지우라고 한 것만 호출
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-playand-key", "access-control-allow-methods": "POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const cfg = async (k: string) => (await sb.from("playand_config").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
const txt = async (r: Response) => { const t = await r.text(); return `${r.status} ${t.slice(0, 200)}`; };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const key = await cfg("intake_key");
  if (!key || req.headers.get("x-playand-key") !== key) return new Response("not found", { status: 404 });
  const b = await req.json().catch(() => ({}));
  const { data: it } = await sb.from("playn_ig_queue").select("id,ig_media_id,status").eq("id", Number(b.queue_id)).maybeSingle();
  if (!it) return J({ ok: false, error: "no item" }, 404);
  const out: Record<string, unknown> = {};
  const ig = await cfg("ig_token_playn");
  if (it.ig_media_id && ig) {
    const r = await fetch(`https://graph.instagram.com/v21.0/${it.ig_media_id}?access_token=${ig}`, { method: "DELETE" });
    out.instagram = await txt(r);
  }
  if (b.story_id && ig) out.story = await txt(await fetch(`https://graph.instagram.com/v21.0/${b.story_id}?access_token=${ig}`, { method: "DELETE" }));
  const { data: xs } = await sb.from("playn_xpost").select("id,channel,ext_id,status").eq("queue_id", it.id);
  for (const x of xs ?? []) {
    if (!x.ext_id || x.status !== "published") continue;
    try {
      let res = "";
      if (x.channel === "threads") {
        const t = await cfg("threads_token_playn");
        res = await txt(await fetch(`https://graph.threads.net/v1.0/${x.ext_id}?access_token=${t}`, { method: "DELETE" }));
      } else if (x.channel === "youtube") {
        const tk = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: (await cfg("yt_client_id"))!, client_secret: (await cfg("yt_client_secret"))!, refresh_token: (await cfg("yt_refresh_playn"))!, grant_type: "refresh_token" }) })).json();
        res = await txt(await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${x.ext_id}`, { method: "DELETE", headers: { Authorization: "Bearer " + tk.access_token } }));
      } else if (x.channel === "facebook") {
        const ut = await cfg("fb_user_token_playn");
        const acc = await (await fetch(`https://graph.facebook.com/v22.0/me/accounts?fields=id,access_token,instagram_business_account{username}&limit=100&access_token=${ut}`)).json();
        const pg = (acc.data ?? []).find((p: any) => p.instagram_business_account?.username === "playn_no.1") ?? acc.data?.[0];
        res = await txt(await fetch(`https://graph.facebook.com/v22.0/${x.ext_id}?access_token=${pg?.access_token}`, { method: "DELETE" }));
      }
      out[x.channel] = res;
      if (/^(200|204)/.test(res)) await sb.from("playn_xpost").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("id", x.id);
    } catch (e) { out[x.channel] = "err " + String(e).slice(0, 150); }
  }
  if (/^200/.test(String(out.instagram ?? ""))) await sb.from("playn_ig_queue").update({ status: "deleted", error_note: "사장님 요청으로 삭제 " + new Date().toISOString() }).eq("id", it.id);
  await sb.from("playand_log").insert({ source: "unpublish", payload: { queue: it.id, out } });
  return J({ ok: true, out });
});
