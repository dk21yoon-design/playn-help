# W 시리즈 v2 (2026-10-17 샘플: W08v2, 큐 #128 draft)
- 카드 규칙 v3(tools/cardkit/CARD_RULE.md) + 경기 장면·팀 로고
- 장면: LCK 공식 유튜브 매치 하이라이트를 집 PC로 받아 ffmpeg 프레임 캡처 (클라우드는 유튜브 차단)
- 팀 로고: 하이라이트 끝 결과 화면 상단 스코어보드에서 잘라 흰색만 남김(alpha = 밝기)
- 매장 사진은 마지막 CTA 장에만
- 출처·Riot 고지문은 카드에 넣지 않고 캡션 맨 끝 '출처' 블록에
- 픽 현황 표 수가 10표 미만이면 카드에 넣지 않음
- 렌더: python3 shot.py <cards.html 절대경로> (jalnan.woff·logo.svg·이미지와 같은 폴더)
