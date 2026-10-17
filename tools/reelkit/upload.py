#!/usr/bin/env python3
"""저장소(playn-media) 업로드. 예약 작업은 마스터 키 대신 3시간 티켓을 쓴다 (2026-10-18).
  티켓 받기(SQL):  select hq_issue_ticket('reel-job-<id>');
  사용:  PLAYN_TICKET=<티켓> python3 tools/reelkit/upload.py <로컬파일> <저장 경로: reels/… src/… promo/… cards/…>
  출력: 공개 URL 한 줄. PLAYN_KEY가 있으면 기존 playn-publish ?mode=upload 를 쓴다."""
import json, mimetypes, os, sys, urllib.request
HQ = 'https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-hq'
PUB = 'https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-publish?mode=upload&path='
def upload(local, path):
    ct = mimetypes.guess_type(local)[0] or 'application/octet-stream'
    data = open(local, 'rb').read()
    k, t = os.environ.get('PLAYN_KEY'), os.environ.get('PLAYN_TICKET')
    if k:
        r = urllib.request.Request(PUB + path, data=data, method='POST', headers={'x-playand-key': k, 'content-type': ct})
        return json.load(urllib.request.urlopen(r, timeout=300))['url']
    if not t: raise SystemExit('PLAYN_TICKET 없음')
    r = urllib.request.Request(HQ, data=json.dumps({'action': 'upload_url', 'ticket': t, 'path': path}).encode(), headers={'content-type': 'application/json'})
    j = json.load(urllib.request.urlopen(r, timeout=30))
    if not j.get('ok'): raise SystemExit('업로드 주소 실패: ' + str(j.get('error')))
    urllib.request.urlopen(urllib.request.Request(j['upload_url'], data=data, method='PUT', headers={'content-type': ct}), timeout=600).read()
    return j['url']
if __name__ == '__main__':
    print(upload(sys.argv[1], sys.argv[2]))
