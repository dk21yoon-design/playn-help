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
