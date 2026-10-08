# Play N 릴스 빌더 (v3)

사용: `PLAYN_KEY=<playand_config.intake_key> python3 tools/reelkit/playn_reel_v3.py spec.json out.mp4`

## 같은 영상 재사용 금지 (모든 시리즈 공통)
릴스, 키즈, 이벤트, e스포츠, 친구랑 등 시리즈를 가리지 않고 적용된다.

- 빌드할 때마다 서버 공용 기록을 읽어 검사한다. 기록은 Supabase `playn_clip_registry`에 있고 `playn-publish ?mode=clips`로 읽고 쓴다.
  - 다른 릴스에서 쓴 같은 원본의 겹치는 구간이 있으면 빌드가 실패한다.
  - 한 원본(트레일러·영상·사진)은 최대 2개 릴스까지만 쓴다.
  - 장면의 60% 이상은 처음 쓰는 원본이어야 한다.
  - 예외는 spec에 `"allow_reuse": [장면번호]`로 직접 적는다. 사장님 OK가 있을 때만 쓴다.
- 빌드에 성공하면 그 릴스(`reel_id`, 없으면 파일명 앞의 R34 같은 번호)의 사용 구간을 서버에 기록한다.
- `PLAYN_KEY`가 없으면 빌드가 중단된다. 로컬 파일 기록은 더 이상 쓰지 않는다.

## 채널별 따로 제작 (2026-10-09)
같은 원본·같은 장면 틀에서 채널마다 버전을 따로 뽑는다. spec에 `variants`를 넣고 `--variant=`로 빌드.

```
python3 tools/reelkit/playn_reel_v3.py R46.json R46.mp4              # 인스타(기본): 보내기 CTA, 인스타 음악 미리보기
python3 tools/reelkit/playn_reel_v3.py R46.json R46_yt.mp4 --variant=yt   # 유튜브: 루프 엔딩, 댓글 1·2·3, 구독
python3 tools/reelkit/playn_reel_v3.py R46.json R46_fb.mp4 --variant=fb   # 페이스북: 영어 한 줄 병기, 공유하기
python3 tools/reelkit/playn_reel_v3.py R46.json R46_th.mp4 --variant=th   # 스레드: 답글로 골라줘
```

variants 예시:
```json
"variants": {
 "yt": {"kicker": "무료 팀게임 TOP3", "scenes": {"5": {"image": null, "clip": {"steam_appid": 2073850, "start": 20.6}, "cta": true, "line": "셋 중에 뭐부터?\n{댓글로 1·2·3} 👇", "pill": "구독하면 매주 무료 게임 추천"}}},
 "fb": {"kicker": "무료 팀게임 TOP3 · Free team games", "scenes": {"0": {"sub": "… · 100% free to play"}, "5": {"line": "같이 갈 친구한테\n{공유하기} 🔁", "pill": "Share with your squad"}}},
 "th": {"scenes": {"5": {"line": "너라면 뭐부터 해?\n{답글로} 골라줘 💬"}}}
}
```
- `scenes`는 장면 번호별로 덮어쓰기(없는 번호면 뒤에 추가), `drop_scenes: [번호]`로 빼기, 나머지 키(title·kicker·music·cover_scene)는 통째로 교체
- 채널 버전은 클립 기록에 새 구간만 더한다(기본 버전 기록 유지)
- 업로드 후 큐 `channel_meta`에 `{"youtube":{"title","video_url"},"facebook":{"video_url"},"threads":{"text","topic","video_url","poll":[...]}}`
- 확인: `playn-publish ?mode=preview&id=큐번호`
