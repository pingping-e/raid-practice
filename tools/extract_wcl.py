#!/usr/bin/env python3
"""Fetch bounded, paginated WCL data. Credentials stay in the process, never output."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

BASE = 'https://www.warcraftlogs.com'
REPORT = 'A8yxaWCNdrb1wmLh'
SPELLS = {1277027: 'Mutilate', 1277002: 'Ravage', 1287072: 'Tempest',
          1305959: 'Surge', 1305963: 'Surge', 1286033: 'DigIn',
          1285419: 'Crosswinds', 1285453: 'Crosswinds', 1285425: 'Crosswinds'}
CONFIG = dict(seed=3420, role='damage', position='ranged', party=1, soak=1,
              mode='realistic', focus='Fury', marker=0, cystOrder=1, partner=1,
              bait=False, sensitivity=1)

def request(url, payload, headers):
    # Do not log response bodies: OAuth errors may echo request details.
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 2:
                delay = min(30, max(1, int(error.headers.get('Retry-After', '5'))))
                time.sleep(delay)
                continue
            raise RuntimeError(f'WCL HTTP {error.code}; check network policy and authorization in environment settings') from None
        except urllib.error.URLError:
            raise RuntimeError('WCL connection failed; check proxy, network allowlist and TLS trust') from None
    raise RuntimeError('WCL retry limit exceeded')

def extract(args):
    client_id, secret = os.environ.get('WCL_CLIENT_ID'), os.environ.get('WCL_CLIENT_SECRET')
    if not client_id or not secret:
        raise RuntimeError('WCL_CLIENT_ID / WCL_CLIENT_SECRET must be set securely in environment settings; never paste credentials into source or CLI arguments')
    auth = base64.b64encode(f'{client_id}:{secret}'.encode()).decode()
    token = request(BASE + '/oauth/token', b'grant_type=client_credentials', {
        'Authorization': f'Basic {auth}', 'Content-Type': 'application/x-www-form-urlencoded'})
    if not isinstance(token.get('access_token'), str):
        raise RuntimeError('OAuth did not return an access token')
    headers = {'Authorization': 'Bearer ' + token['access_token'], 'Content-Type': 'application/json'}
    cache = Path('.cache/wcl'); cache.mkdir(parents=True, exist_ok=True)
    requests_made = 0
    def gql(query, variables):
        nonlocal requests_made
        key = hashlib.sha256(json.dumps([query, variables], sort_keys=True).encode()).hexdigest()
        dest = cache / (key + '.json')
        if dest.exists() and not args.refresh:
            return json.loads(dest.read_text())
        response = request(BASE + '/api/v2/client', {'query': query, 'variables': variables}, headers)
        requests_made += 1
        if response.get('errors'):
            raise RuntimeError('GraphQL rejected the request; verify report permissions and API schema (response suppressed)')
        if not response.get('data'):
            raise RuntimeError('GraphQL returned no report data')
        dest.write_text(json.dumps(response['data']))
        return response['data']
    meta = gql('''query($code:String!){ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
      reportData { report(code:$code) { fights(fightIDs:[24]) { id name startTime endTime encounterID difficulty } } } }''', {'code': REPORT})
    fights = meta.get('reportData', {}).get('report', {}).get('fights', [])
    fight = next((f for f in fights if f['id'] == 24), None)
    if not fight or fight.get('encounterID') != 3420 or fight.get('difficulty') != 5:
        raise RuntimeError('Selected fight is not the expected Sszorak Mythic encounter')
    start, end = fight['startTime'], fight['endTime']
    raw = []
    for data_type in ['Casts'] + (['Debuffs'] if args.debuffs else []):
        cursor = start
        for page in range(args.max_pages):
            data = gql('''query($code:String!, $start:Float!, $end:Float!, $type:EventDataType!) {
              reportData { report(code:$code) { events(fightIDs:[24], dataType:$type, startTime:$start, endTime:$end, limit:10000) { data nextPageTimestamp } } } }''',
              {'code': REPORT, 'start': cursor, 'end': end, 'type': data_type})
            events = data.get('reportData', {}).get('report', {}).get('events')
            if not events or not isinstance(events.get('data'), list):
                raise RuntimeError('Missing events page')
            raw.extend(events['data'])
            nxt = events.get('nextPageTimestamp')
            if nxt is None or nxt > end:
                break
            if nxt <= cursor:
                raise RuntimeError('Non-advancing pagination cursor; extraction aborted')
            cursor = nxt
        else:
            raise RuntimeError('Page budget reached; no incomplete output published. Increase --max-pages explicitly')
    (cache / 'events.json').write_text(json.dumps(raw))
    # 233 is report-specific, never reused for other reports. Only boss cast events count.
    boss = sorted([e for e in raw if e.get('sourceID') == 233 and e.get('type') in ['begincast', 'cast']], key=lambda e:e['timestamp'])
    normalized, used = [], set()
    for i, event in enumerate(boss):
        spell = event.get('abilityGameID')
        if spell not in SPELLS or i in used:
            continue
        at = (event['timestamp'] - start) / 1000
        if at < 0:
            continue
        duration = 0
        duration_confidence = 'reconstructed'
        if event['type'] == 'begincast':
            finish = next(((j, e) for j,e in enumerate(boss[i+1:],i+1) if e.get('abilityGameID') == spell and e['type']=='cast' and e['timestamp']-event['timestamp'] < 30000),None)
            if finish:
                duration_confidence='log-observed'; used.add(finish[0]); duration=(finish[1]['timestamp']-event['timestamp'])/1000
        normalized.append(dict(id=f'wcl-{spell}-{event["timestamp"]}', at=at, duration=duration, kind=SPELLS[spell], confidence='log-observed', durationConfidence=duration_confidence, source=f'{BASE}/reports/{REPORT}?fight=24'))
    if not normalized:
        raise RuntimeError('No mapped boss casts were extracted; source ID and spell IDs require investigation')
    # Fury is a debuff-driven condition, never synthesized from removal or cast timestamps.
    # Dig In cast duration is NOT the duration of the wind phase. Keep phase approximation explicit.
    for event in normalized:
        if event['kind']=='DigIn':
            event['duration']=min(24,(end-start)/1000-event['at'])
            event['durationConfidence']='reconstructed'
            event['source']+=' (cast start observed; 24s practice wind phase reconstructed)'
    output = Path(args.output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'version':1,'config':CONFIG,'scenario':{
        'version':1,'duration':(end-start)/1000,'title':'WCL 시전 관측 · 공간 규칙은 근사 / Fury 별도 분석 필요',
        'source':f'{BASE}/reports/{REPORT}?fight=24','events':normalized}},ensure_ascii=False,indent=2))
    rate = meta.get('rateLimitData',{})
    print(f'Wrote {len(normalized)} mapped cast events to {output}; {requests_made} uncached GraphQL calls.')
    print('Rate limit metadata:', json.dumps(rate))
    print('Import this file using the app settings. This is a cast-only scenario; Fury/debuff/position semantics require review, not an exact replay.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh',action='store_true')
    parser.add_argument('--debuffs',action='store_true')
    parser.add_argument('--max-pages',type=int,default=12)
    parser.add_argument('--output',default='.cache/wcl/wcl-practice.json')
    args=parser.parse_args()
    try:
        if not 1<=args.max_pages<=100:
            raise RuntimeError('--max-pages must be between 1 and 100')
        extract(args)
    except (RuntimeError,KeyError,ValueError,TypeError) as error:
        # Only controlled messages above are printed. Never dump requests, OAuth responses or env.
        print('Extraction failed:', str(error) if isinstance(error,RuntimeError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
