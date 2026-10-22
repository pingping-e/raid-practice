export type Mechanic = 'Mutilate' | 'Ravage' | 'Tempest' | 'Fury' | 'Surge' | 'Crosswinds' | 'DigIn';
export type Confidence = 'handoff-observed' | 'log-observed' | 'reconstructed';
export interface TimelineEvent { id: string; at: number; duration: number; kind: Mechanic; confidence: Confidence; source: string; }
export interface Scenario { version: 1; duration: number; title: string; source: string; events: TimelineEvent[]; }
const source = 'https://www.warcraftlogs.com/reports/A8yxaWCNdrb1wmLh?fight=24&view=replay';
const events: TimelineEvent[] = [];
function add(kind: Mechanic, at: number, duration: number, confidence: Confidence = 'reconstructed') {
  events.push({ id: `${kind}-${at}`, kind, at, duration, confidence, source: confidence === 'reconstructed' ? '연습용 재구성: docs/ACCURACY.md' : source });
}
add('Mutilate',5.007,3.007,'handoff-observed'); add('Mutilate',9.007,3.02,'handoff-observed');
add('Tempest',12.995,3.499,'handoff-observed'); add('Ravage',17.494,3.02,'handoff-observed'); add('Ravage',21.492,3.005,'handoff-observed');
for (const t of [29,76.205,156.020,203.018,283.081]) add('Surge',t,5,'handoff-observed');
for (const t of [99.992,227.036]) add('DigIn',t,24,'handoff-observed');
for (const base of [48,128,175,255]) {
  add('Mutilate',base,3); add('Mutilate',base+4,3); add('Tempest',base+8,3.5); add('Ravage',base+13,3); add('Ravage',base+17,3);
}
for (const t of [35,82,162,209,289]) add('Crosswinds',t,6);
for (const t of [63,144,190,270]) add('Fury',t,0);
export const defaultScenario: Scenario = { version:1, title:'스조라크 · 신화 / 연습용 재구성', duration:302.375, source, events: events.sort((a,b)=>a.at-b.at) };
export const names: Record<Mechanic,string> = {Mutilate:'절단 · Mutilate',Ravage:'유린 · Ravage',Tempest:'폭풍 · Tempest',Fury:'뱀의 격노 · Fury',Surge:'맹독 쇄도 · Surge',Crosswinds:'교차 강풍 · Crosswinds',DigIn:'굴 파기 · Dig In'};
export function validateScenario(s: unknown): asserts s is Scenario {
  if (!s || typeof s !== 'object') throw Error('시나리오는 객체여야 합니다.');
  const v = s as Scenario;
  if (v.version !== 1 || !Number.isFinite(v.duration) || v.duration < 30 || v.duration > 1800 || typeof v.title !== 'string' || v.title.length > 200 || !Array.isArray(v.events) || v.events.length > 1000) throw Error('시나리오 버전·길이·이벤트 수를 확인하세요.');
  if (typeof v.source !== 'string' || !/^https:\/\//.test(v.source)) throw Error('HTTPS 출처가 필요합니다.');
  const ids = new Set<string>(); let previous = -1;
  for (const e of v.events) {
    if (!e || typeof e.id !== 'string' || ids.has(e.id) || !Object.hasOwn(names,e.kind) || !Number.isFinite(e.at) || e.at < previous || e.at < 0 || !Number.isFinite(e.duration) || e.duration < 0 || e.duration > 60 || e.at+e.duration > v.duration || !['handoff-observed','log-observed','reconstructed'].includes(e.confidence) || typeof e.source !== 'string' || e.source.length > 1000) throw Error('잘못된 이벤트: 시간순·기믹·출처를 확인하세요.');
    ids.add(e.id); previous=e.at;
  }
}
