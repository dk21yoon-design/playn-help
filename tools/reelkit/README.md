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

## 상위 쇼츠 학습 옵션 (2026-10-09)
조회 10만~40만 게임추천 쇼츠 프레임 분석 결과를 옵션으로 넣었다.
- `"stroke": true` (spec): 제목·하단 자막·중앙 문구에 검은 외곽선. 초록 박스 글자는 제외
- `"counter": true` (spec): `name`이 있는 장면에 `1/2 ●●` 진행 표시(오른쪽 위). 몇 개 남았는지 보여줘서 끝까지 보게 함
- `"react": "ㅁㅊ 둘 다 {거의 공짜}"` (장면): 영상 위쪽에 밈형 리액션 자막(굵은 외곽선, 살짝 기울임). 첫 장면 훅에 사용
- VS·비교형(둘 중 뭐?)은 댓글·답글 투표로 이어지기 좋다 → 유튜브 "댓글로 1·2", 스레드 투표

## 채널별 영상 차별화 옵션 (2026-10-09, R46부터 기본)
variant 안에 넣는다.
- `"order": [0, 1, {새 장면}, 2, …]`: 장면 구성 자체를 바꿈 (숫자 = 기본 장면 번호, dict = 새 장면). 유튜브 20초 버전용
- `"pace": 0.5`: CTA와 `"fixed": true` 장면을 빼고 장면마다 초를 더함 (페북은 천천히)
- `"text_scale": 1.12`: 하단 자막·칩·리뷰 글씨 확대 (페북, 소리 없이 보는 사람)
- `"aspect": "3:4"`, `"crop_y": 220`: 1080×1440으로 잘라 스레드 피드에서 크게 보이게 (상단 라벨~하단 버튼 문구까지 들어가는 위치)
- 장면 `"fixed": true`: pace 적용 안 함 (어두운 전환 구간 피하려고 길이를 맞춘 장면)

| 채널 | 비율 | 길이 | 구성 |
|---|---|---|---|
| 인스타 | 9:16 | 12초 | 기본, 보내기 CTA, 인스타 음악 |
| 유튜브 | 9:16 | 20초 | 게임당 2컷 + 마감 정보 컷, 댓글 1·2, 구독, 게임 장면으로 끝 |
| 페이스북 | 9:16 | 14초 | +0.5초/장면, 글씨 1.12배, 영어 한 줄 병기, 공유하기 |
| 스레드 | 3:4 | 8초 | 판정 컷 빼고 빠르게, 질문 제목, 답글·투표 |

빌드 후 어두운 프레임 검사: `signalstats` YAVG가 20 이하인 프레임이 영상 영역(y 620~1340)에 있으면 클립 시작점을 옮긴다.
