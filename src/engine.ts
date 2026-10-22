import { defaultScenario, type Scenario, type TimelineEvent, type Mechanic } from './scenario';
export const STEP=1/60, ARENA=42;
export type Vec={x:number;z:number};
export type Role='tank'|'damage'|'healer';
export interface Config {seed:number;role:Role;position:'melee'|'ranged';party:number;soak:1|2;mode:'realistic'|'focus';focus:'Fury'|'Surge'|'Crosswinds';marker:number;cystOrder:number;partner:number;sensitivity:number;}
export const defaultConfig: Config={seed:3420,role:'damage',position:'ranged',party:1,soak:1,mode:'realistic',focus:'Fury',marker:0,cystOrder:1,partner:1,sensitivity:1};
export function validateConfig(c:unknown): asserts c is Config {
  const v=c as Config;
  if(!v||!Number.isInteger(v.seed)||v.seed<0||v.seed>4294967295||!['tank','damage','healer'].includes(v.role)||!['melee','ranged'].includes(v.position)||!['realistic','focus'].includes(v.mode)||!['Fury','Surge','Crosswinds'].includes(v.focus)||![1,2].includes(v.soak)||![1,2,3,4].includes(v.party)||!Number.isInteger(v.marker)||v.marker<0||v.marker>3||![1,2,3].includes(v.cystOrder)||!Number.isInteger(v.partner)||v.partner<1||v.partner>19||!Number.isFinite(v.sensitivity)||v.sensitivity<0.2||v.sensitivity>3) throw Error('배정/시드 설정이 올바르지 않습니다.');
}
export function distance(a:Vec,b:Vec){return Math.hypot(a.x-b.x,a.z-b.z);}
export function angle(a:Vec,b:Vec){return Math.atan2(b.x-a.x,b.z-a.z);}
export function point(a:number,r:number):Vec{return {x:Math.sin(a)*r,z:Math.cos(a)*r};}
export function inCone(p:Vec,origin:Vec,facing:number,radius:number,halfAngle:number){const d=distance(p,origin);return d<=radius && (d<0.01||Math.abs(Math.atan2(Math.sin(angle(origin,p)-facing),Math.cos(angle(origin,p)-facing)))<=halfAngle);}
export function crossHit(p:Vec,origin:Vec,rotation:number,length:number,width:number){const d={x:p.x-origin.x,z:p.z-origin.z};const x=d.x*Math.cos(rotation)-d.z*Math.sin(rotation),z=d.x*Math.sin(rotation)+d.z*Math.cos(rotation);return (Math.abs(x)<=width&&Math.abs(z)<=length)||(Math.abs(z)<=width&&Math.abs(x)<=length);}
export function sweptDistance(p:Vec,a:Vec,b:Vec){const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;const t=d===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/d));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
export class Random {constructor(public state:number){} next(){this.state=(this.state+0x6D2B79F5)|0;let t=Math.imul(this.state^this.state>>>15,1|this.state);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;}}
export interface Actor extends Vec {id:number;name:string;role:Role;position:'melee'|'ranged';party:number;soak:number;home:Vec;goal:Vec;action:string;vulnerable:number;claws:number;virulent:number;generation:number;slow:number;vx:number;vz:number;y:number;vy:number;facing:number;cooldown:number;hits:number;}
export interface Hazard extends Vec {id:number;kind:'tornado'|'puddle'|'cyst'|'cross';radius:number;expires:number;vx:number;vz:number;rotation:number;owner:number;generation:number;}
export interface Cast {event:TimelineEvent;end:number;facing:number;group:number;targets:number[];resolved:boolean;}
export interface Result {time:number;kind:string;message:string;success:boolean;actor:number;eventAt:number;}
interface Flight {a:number;b:number;until:number;collided:boolean;eventAt:number;}
interface Fury {target:number;since:number;eventAt:number;}
interface Gust {at:number;direction:number;eventAt:number;order:number;}
export const markers=[{x:0,z:29},{x:29,z:0},{x:0,z:-29},{x:-29,z:0}];
export class Simulation {
  time=0; tick=0; actors:Actor[]=[]; hazards:Hazard[]=[]; casts:Cast[]=[]; results:Result[]=[]; rng:Random; next=0; hazardId=0; soakCount=0; fury:Fury|null=null; gusts:Gust[]=[]; flights:Flight[]=[]; warnings:{text:string;until:number}[]=[]; digUntil=0; bossFacing=0; lastTank=-1; replay=false; completed=false; furyTriggers=0;
  constructor(public config:Config={...defaultConfig},public scenario:Scenario=defaultScenario){validateConfig(config);this.rng=new Random(config.seed);this.createRoster();}
  get player(){return this.actors[0];}
  get boss():Vec{return {x:0,z:0};}
  createRoster(){
    const roles:Role[]=[this.config.role]; const need={tank:2,healer:4,damage:14}; need[this.config.role]--;
    for(const role of ['tank','healer','damage'] as Role[])for(let i=0;i<need[role];i++)roles.push(role);
    let soakIndex=0;
    roles.forEach((role,id)=>{
      const position=id===0?this.config.position:role==='tank'?'melee':role==='healer'?(id%2?'melee':'ranged'):id%2?'melee':'ranged';
      let soak=role==='tank'?0:1+(soakIndex++%2);
      const home=role==='tank'?{x:id%2?2:-2,z:8}:point((id/20)*Math.PI*2+Math.PI,position==='melee'?11:22);
      this.actors.push({id,name:id===0?'나':`${role==='tank'?'탱커':role==='healer'?'힐러':'딜러'} ${id}`,role,position,soak,party:id===0?this.config.party:1+Math.floor((id-1)/5),home,goal:{...home},...home,action:'대기',vulnerable:0,claws:0,virulent:0,generation:0,slow:0,vx:0,vz:0,y:0,vy:0,facing:Math.PI,cooldown:0,hits:0});
    });
    if(this.player.role!=='tank'&&this.player.soak!==this.config.soak){const other=this.actors.find(a=>a.id!==0&&a.soak===this.config.soak)!;other.soak=this.player.soak;this.player.soak=this.config.soak;}
  }
  say(text:string){this.warnings.push({text,until:this.time+4});}
  record(kind:string,message:string,success:boolean,actor=0,eventAt=this.time){if(this.replay)return;this.results.push({time:this.time,kind,message,success,actor,eventAt});if(!success&&actor===0){this.player.hits++;this.say(message);}}
  damage(a:Actor,kind:string,message:string,eventAt=this.time){this.record(kind,message,false,a.id,eventAt);}
  selectFarthest(){return [...this.actors].sort((a,b)=>distance(b,this.boss)-distance(a,this.boss)||a.id-b.id)[0];}
  activeTank(){const tanks=this.actors.filter(a=>a.role==='tank');return [...tanks].sort((a,b)=>(a.claws>this.time?1:0)-(b.claws>this.time?1:0)||a.id-b.id)[0];}
  chooseTargets(kind:Mechanic,count:number){
    const pool=this.actors.filter(a=>a.role!=='tank');
    const out=[...pool].sort((a,b)=>a.id-b.id);for(let i=out.length-1;i>0;i--){const j=Math.floor(this.rng.next()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
    if(this.config.mode==='focus'&&this.config.focus===kind){const i=out.indexOf(this.player);if(i>=0)out.splice(i,1);out.unshift(this.player);}
    return out.slice(0,count).map(a=>a.id);
  }
  addHazard(kind:Hazard['kind'],p:Vec,radius:number,life:number,extra:Partial<Hazard>={}){this.hazards.push({id:this.hazardId++,kind,...p,radius,expires:this.time+life,vx:0,vz:0,rotation:0,owner:-1,generation:0,...extra});}
  start(e:TimelineEvent){
    let targets:number[]=[];let group=0;
    if(e.kind==='Mutilate'){group=1+this.soakCount++%2;this.say(`절단: 소킹 ${group}조 집결`);}
    if(e.kind==='Ravage'){targets=[this.activeTank().id];this.say('유린: 전방에서 이탈');}
    if(e.kind==='Tempest')this.say('폭풍: 회오리 경로 확인');
    if(e.kind==='Surge'){targets=this.chooseTargets('Surge',3);this.say(targets.includes(0)?'내 낭종: 지정 마커로 이동':'낭종 배치 — 접촉 주의');}
    if(e.kind==='Crosswinds'){
      targets=this.chooseTargets('Crosswinds',8);
      // Explicit player pairing remains separate from selecting who is targeted.
      if(targets.includes(0)){targets=targets.filter(id=>id!==this.config.partner);targets.splice(targets.indexOf(0)+1,0,this.config.partner);targets=targets.slice(0,8);}
      this.say(targets.includes(0)?'교차 강풍: 내 짝과 마주보기':'교차 강풍: 비행 경로 회피');
    }
    if(e.kind==='Fury'){
      const target=this.config.mode==='focus'&&this.config.focus==='Fury'?this.player:this.selectFarthest();
      this.fury={target:target.id,since:this.time,eventAt:e.at};this.say(`Fury → ${target.name}, 8yd 안에 14명 집결`);return;
    }
    if(e.kind==='DigIn'){
      this.digUntil=this.time+e.duration;
      for(let i=0;i<3;i++)this.gusts.push({at:this.time+6+i*7,direction:(i+Math.floor(e.at/100))%4,eventAt:e.at,order:i+1});
      this.say('강풍 구간 · 방향·간격은 연습용 추정');
    }
    this.casts.push({event:e,end:e.at+e.duration,facing:angle(this.boss,this.activeTank()),group,targets,resolved:false});
  }
  resolve(c:Cast){
    c.resolved=true;const k=c.event.kind;
    if(k==='Mutilate'){
      const members=this.actors.filter(a=>a.soak===c.group),inside=members.filter(a=>inCone(a,this.boss,c.facing,19,0.62));
      const invalid=inside.filter(a=>a.vulnerable>this.time), ok=inside.length>=members.length&&invalid.length===0;
      this.record(k,ok?`${c.group}조 ${inside.length}/${members.length} 소킹 성공`:`${c.group}조 ${inside.length}/${members.length} · 중복 취약 ${invalid.length}명`,ok,0,c.event.at);
      for(const a of inside){if(a.vulnerable>this.time&&a.id!==0)this.damage(a,k,'절단 취약 상태 재진입',c.event.at);a.vulnerable=this.time+7;}
      for(const a of this.actors.filter(a=>a.soak!==c.group&&a.role!=='tank'&&inCone(a,this.boss,c.facing,19,0.62)))this.damage(a,k,'다른 소킹 조의 절단에 진입',c.event.at);
    }
    if(k==='Ravage'){
      const target=this.actors[c.targets[0]];if(target.claws>this.time)this.damage(target,k,'탱커 취약 상태 중복 피격',c.event.at);target.claws=this.time+6;
      for(const a of this.actors)if(a.id!==target.id&&inCone(a,this.boss,c.facing,34,0.48))this.damage(a,k,'유린 전방 공격 피격',c.event.at);
      if(this.player.id!==target.id&&!inCone(this.player,this.boss,c.facing,34,0.48))this.record(k,'전방 공격 회피',true,0,c.event.at);
    }
    if(k==='Tempest')for(let i=0;i<6;i++){const a=i*Math.PI/3+this.rng.next()*0.2;this.addHazard('tornado',point(a,6),1.7,23,{vx:Math.sin(a)*7,vz:Math.cos(a)*7});}
    if(k==='Surge')c.targets.forEach((id,i)=>{const a=this.actors[id];this.addHazard('cyst',a,2.2,150,{owner:id,rotation:(id===0?this.config.marker:i)%4});if(id===0)this.record(k,distance(a,markers[this.config.marker])<6?'내 마커에 낭종 배치':'배치 마커 이탈 — 강풍 자원 위치 주의',distance(a,markers[this.config.marker])<6,0,c.event.at);});
    if(k==='Crosswinds')for(let i=0;i<c.targets.length;i+=2){const a=this.actors[c.targets[i]],b=this.actors[c.targets[i+1]];const dir=angle(a,b);a.vx=Math.sin(dir)*19;a.vz=Math.cos(dir)*19;b.vx=-a.vx;b.vz=-a.vz;this.flights.push({a:a.id,b:b.id,until:this.time+2,collided:false,eventAt:c.event.at});}
  }
  goalFor(a:Actor):{p:Vec;action:string}{
    const cast=this.casts.find(c=>!c.resolved&&c.end-this.time<7&&['Mutilate','Ravage','Surge','Crosswinds'].includes(c.event.kind));
    if(cast?.event.kind==='Crosswinds'&&cast.targets.includes(a.id)){const index=cast.targets.indexOf(a.id),pair=Math.floor(index/2),side=index%2;return {p:{x:(pair-1.5)*9,z:side?18:-18},action:`짝 ${this.actors[cast.targets[index^1]].name} 대기`};}
    if(cast?.event.kind==='Surge'&&cast.targets.includes(a.id)){const index=cast.targets.indexOf(a.id);return {p:markers[a.id===0?this.config.marker:index%4],action:'낭종 마커 배치'};}
    const gust=this.gusts[0];
    if(gust&&gust.at-this.time<4){const cyst=this.hazards.filter(h=>h.kind==='cyst').sort((x,y)=>distance(a,x)-distance(a,y))[0];if(cyst)return {p:gust.at-this.time>0.2?{x:cyst.x+3.7,z:cyst.z}:cyst,action:`강풍 ${gust.order} · 낭종 접촉 준비`};}
    if(a.virulent>this.time){const pos=point(a.id*Math.PI*2/20+Math.PI/4,29);return {p:pos,action:'맹독 산개'};}
    if(cast?.event.kind==='Mutilate'&&a.soak===cast.group)return {p:{x:Math.sin(cast.facing)*12+(a.id%3-1)*2,z:Math.cos(cast.facing)*12+(a.id%2)*2},action:`소킹 ${cast.group}조`};
    if(cast?.event.kind==='Ravage'&&cast.targets[0]===a.id)return {p:point(cast.facing,8),action:'유린 담당 탱커'};
    if(this.fury){const target=this.actors[this.fury.target];if(a.id===target.id)return {p:target,action:'Fury 집결 유도'};if(a.id<16)return {p:{x:target.x+Math.sin(a.id*2.4)*4,z:target.z+Math.cos(a.id*2.4)*4},action:'Fury 14인 집결'};}
    if(a.role==='tank')return {p:point(a.id===this.activeTank().id?0:Math.PI/2,8),action:a.id===this.activeTank().id?'보스 유도':'탱커 교대 대기'};
    return {p:a.home,action:'기본 진형'};
  }
  plan(a:Actor){
    const g=this.goalFor(a);a.goal={...g.p};a.action=g.action;
    // Local obstacle avoidance is separate from the selected mechanic goal.
    if(!a.action.includes('낭종')&&!a.action.includes('강풍'))for(const h of this.hazards){if(!['tornado','puddle','cyst'].includes(h.kind))continue;const d=distance(a,h), safe=h.radius+2;if(d<safe+3){const dx=a.x-h.x,dz=a.z-h.z;a.goal.x+=dx/Math.max(d,0.2)*6;a.goal.z+=dz/Math.max(d,0.2)*6;}}
    if(a.action==='맹독 산개')for(const b of this.actors)if(a.id!==b.id&&distance(a,b)<5){a.goal.x+=(a.x-b.x)*2;a.goal.z+=(a.z-b.z)*2;}
  }
  step(input:Vec={x:0,z:0},jump=false){
    if(this.completed)return;
    this.tick++;this.time=Math.min(this.scenario.duration,this.tick*STEP);
    while(this.next<this.scenario.events.length&&this.scenario.events[this.next].at<=this.time)this.start(this.scenario.events[this.next++]);
    this.bossFacing=angle(this.boss,this.activeTank());
    const previous=this.actors.map(a=>({x:a.x,z:a.z}));
    for(const a of this.actors){
      this.plan(a);let movement:Vec;
      if(a.id===0&&!this.replay)movement=input;else{const d=distance(a,a.goal);movement=d<0.15?{x:0,z:0}:{x:(a.goal.x-a.x)/d*Math.min(1,d/0.6),z:(a.goal.z-a.z)/d*Math.min(1,d/0.6)};}
      if(a.id===0&&jump&&a.y===0)a.vy=8;
      a.vy-=22*STEP;a.y=Math.max(0,a.y+a.vy*STEP);if(a.y===0)a.vy=0;
      const flying=this.flights.some(f=>!f.collided&&(f.a===a.id||f.b===a.id));
      const speed=a.slow>this.time?3.5:8;
      const dx=(flying?0:movement.x*speed)+a.vx,dz=(flying?0:movement.z*speed)+a.vz;
      a.x+=dx*STEP;a.z+=dz*STEP;
      if(Math.hypot(movement.x,movement.z)>0.1)a.facing=Math.atan2(movement.x,movement.z);
      if(!flying){a.vx*=0.94;a.vz*=0.94;}
      if(distance(a,this.boss)>ARENA-1){const p=point(angle(this.boss,a),ARENA-1);Object.assign(a,p);if(a.cooldown<this.time){this.damage(a,'경계','전장 경계 이탈');a.cooldown=this.time+2;}a.vx=0;a.vz=0;}
    }
    for(const c of this.casts)if(!c.resolved&&this.time+1e-8>=c.end)this.resolve(c);
    this.casts=this.casts.filter(c=>!c.resolved||this.time<c.end+0.3);
    for(const f of this.flights){
      if(f.collided)continue;
      const a=this.actors[f.a],b=this.actors[f.b];const relOld={x:previous[a.id].x-previous[b.id].x,z:previous[a.id].z-previous[b.id].z},relNew={x:a.x-b.x,z:a.z-b.z};
      if(sweptDistance({x:0,z:0},relOld,relNew)<2.1){f.collided=true;a.vx=a.vz=b.vx=b.vz=0;this.record('Crosswinds',`${a.name} ↔ ${b.name} 비행 상쇄`,true,a.id===0||b.id===0?0:a.id,f.eventAt);}
      else if(this.time>=f.until){f.collided=true;for(const p of [a,b]){this.damage(p,'Crosswinds','비행 중 짝과 충돌하지 못함',f.eventAt);p.vx=p.vz=0;}}
    }
    this.flights=this.flights.filter(f=>!f.collided);
    for(const h of this.hazards){
      if(h.kind==='tornado'){
        h.x+=h.vx*STEP;h.z+=h.vz*STEP;
        if(distance(h,this.boss)>ARENA-h.radius){const n=point(angle(this.boss,h),1),dot=h.vx*n.x+h.vz*n.z;h.vx-=2*dot*n.x;h.vz-=2*dot*n.z;Object.assign(h,point(angle(this.boss,h),ARENA-h.radius-0.1));}
      }
      for(const a of this.actors){
        if(h.expires<=this.time)continue;
        if(h.kind==='cyst'&&sweptDistance(h,previous[a.id],a)<h.radius+0.65){h.expires=this.time;const dir=angle(h,a);a.vx+=Math.sin(dir)*21;a.vz+=Math.cos(dir)*21;a.slow=this.time+4;const gust=this.gusts[0];const timely=!!gust&&Math.abs(gust.at-this.time)<2;this.record('Cyst',timely?'낭종 반동·감속 획득':'낭종을 미리 소모함 · 후속 강풍 자원 감소',timely,a.id);}
        if((h.kind==='tornado'||h.kind==='puddle')&&distance(a,h)<h.radius+0.7&&a.cooldown<this.time){this.damage(a,h.kind,h.kind==='tornado'?'회오리 충돌':'잔류 맹독 바닥 피격');a.cooldown=this.time+1.5;}
        if(h.kind==='cross'&&a.id!==h.owner&&crossHit(a,h,h.rotation,h.radius,1)&&a.cooldown<this.time){this.damage(a,'Virulence','맹독 십자 방출 피격');a.cooldown=this.time+1.5;if(a.virulent<=this.time&&h.generation<2){a.virulent=this.time+5;a.generation=h.generation+1;}}
      }
    }
    this.hazards=this.hazards.filter(h=>h.expires>this.time);
    if(this.fury&&this.time>=this.digUntil){
      const target=this.actors[this.fury.target],count=this.actors.filter(a=>distance(a,target)<=8).length;
      if(count>=14){const since=this.time-this.fury.since;this.record('Fury',`14인 집결 → To the Slaughter (${since.toFixed(1)}초)`,true,0,this.fury.eventAt);this.furyTriggers++;for(const a of this.actors.filter(a=>distance(a,target)<=8)){a.virulent=this.time+6;a.generation=0;}this.say('집결 완료 → 맹독 산개!');this.fury=null;}
      else if(this.time-this.fury.since>18){this.record('Fury',`집결 지연 ${count}/14 · 조건 충족까지 유지`,false,0,this.fury.eventAt);this.fury.since=this.time;}
    }
    for(const a of this.actors)if(a.virulent>0&&a.virulent<=this.time){a.virulent=0;this.addHazard('cross',a,Math.max(6,15-a.generation*3),0.8,{owner:a.id,generation:a.generation,rotation:Math.PI/4});this.addHazard('puddle',a,2.4,24);}
    while(this.gusts.length&&this.gusts[0].at<=this.time){const g=this.gusts.shift()!,dir=point(g.direction*Math.PI/2,1);this.say(`강풍 ${g.order} · ${['북','동','남','서'][g.direction]} 방향으로 밀림`);for(const a of this.actors){const protectedByCyst=a.slow>this.time;a.vx+=dir.x*(protectedByCyst?4:27);a.vz+=dir.z*(protectedByCyst?4:27);this.record('DigIn',protectedByCyst?'낭종 감속으로 강풍 완화':'강풍 때 낭종 감속 없음',protectedByCyst,a.id,g.eventAt);}}
    this.warnings=this.warnings.filter(w=>w.until>this.time);
    if(this.time>=this.scenario.duration){this.completed=true;this.say('전투 연습 종료');}
  }
  seek(seconds:number){
    const target=Math.max(0,Math.min(seconds,this.scenario.duration));
    const fresh=new Simulation({...this.config},this.scenario);fresh.replay=true;
    while(fresh.time+STEP/2<target&&!fresh.completed)fresh.step();
    fresh.replay=false;fresh.results=[];fresh.warnings=[];fresh.player.hits=0;
    Object.assign(this,fresh); // Rebuild all actors, hazards, debuffs and RNG; historical damage is excluded.
  }
  snapshot(){return JSON.stringify({tick:this.tick,actors:this.actors,hazards:this.hazards,fury:this.fury,results:this.results,rng:this.rng.state,next:this.next});}
}
