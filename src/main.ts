import "./style.css";
import {
  Simulation,
  STEP,
  defaultConfig,
  validateConfig,
  distance,
  type Config,
  type Vec,
  angle,
} from "./engine";
import {
  defaultScenario,
  validateScenario,
  names,
  type Scenario,
} from "./scenario";
import { Input, defaultBindings, type Bindings } from "./input";
import { View } from "./view";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const format = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function sessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
let scenario: Scenario = defaultScenario;
let stored = readStored<Config>("raid-config", defaultConfig);
try {
  validateConfig(stored);
} catch {
  stored = { ...defaultConfig };
}
let sim = new Simulation({ ...stored }, scenario),
  running = false,
  started = false,
  speed = 1,
  accumulator = 0,
  previous = performance.now(),
  lastHud = 0,
  recordId = sessionId(),
  beepKey = "";
let audio: AudioContext | undefined;
const history = readStored<
  {
    id?: string;
    at: string;
    seed: number;
    from: number;
    duration: number;
    failures: number;
    finished: boolean;
  }[]
>("raid-history", []);
let segmentStart = 0;
document.querySelector("#app")!.innerHTML = `
<header><div class="brand"><i>♜</i> RAID PRACTICE</div><div class="top-info"><span class="tag">MYTHIC · 20 PLAYERS</span><span>스조라크 연습실</span><button id="sources-open">출처와 구현 수준 ↗</button></div></header>
<div class="layout"><aside>
<div class="eyebrow">THE VENOMOUS ABYSS</div><h1>스조라크</h1><p class="subtitle">SSZORAK · 신화 난이도<br>나의 움직임으로 완성하는 20인 전투</p>
<div class="section"><h2>01 &nbsp; 내 역할</h2><div class="role-options"><button data-role="tank">◆ 탱커</button><button data-role="damage">✦ 딜러</button><button data-role="healer">✚ 힐러</button></div><div class="fields">
<label>전투 위치<select id="position"><option value="melee">근접 / 밀리</option><option value="ranged">원거리 / 레인지</option></select></label>
<label>파티 조<select id="party">${[1, 2, 3, 4].map((n) => `<option value="${n}">${n} 파티</option>`).join("")}</select></label>
<label>절단 소킹<select id="soak"><option value="1">소킹 1조</option><option value="2">소킹 2조</option></select></label></div><p class="hint">파티 조와 소킹 조는 별도 배정입니다.<br>탱커는 공대 소킹 조에 포함되지 않습니다.</p></div>
<div class="section"><h2>02 &nbsp; 특임과 연습 방식</h2><div class="fields">
<label>연습 모드<select id="mode"><option value="realistic">조건 기반 대상 선정</option><option value="focus">특임 집중 · 내 대상 보장</option></select></label>
<label>Fury 배정<select id="bait"><option value="false">기본 진형</option><option value="true">최원거리 유도 담당</option></select></label>
<label>집중 기믹<select id="focus"><option value="Fury">Fury 유도</option><option value="Surge">낭종 배치</option><option value="Crosswinds">교차 강풍</option></select></label>
<label>배치 마커<select id="marker">${["A · 북", "B · 동", "C · 남", "D · 서"].map((s, i) => `<option value="${i}">${s}</option>`).join("")}</select></label>
<label>낭종 순서<select id="cystOrder">${[1, 2, 3].map((n) => `<option value="${n}">${n}번째 강풍 담당</option>`).join("")}</select></label>
<label>강풍 짝<select id="partner">${Array.from({ length: 19 }, (_, i) => `<option value="${i + 1}">공대원 ${i + 1}</option>`).join("")}</select></label>
<label>난수 시드<input id="seed" type="number" min="0" max="4294967295" step="1"></label>
</div><p class="hint">Fury는 조건 모드에서 최원거리 대상을 고릅니다. 다른 대상·바람 규칙은 재구성입니다.</p>
<div class="sidebar-actions"><button id="apply">배정 적용 · 새 연습</button></div>
<div class="sidebar-actions"><button id="export">설정 내보내기</button><button id="import">불러오기</button></div><input type="file" id="file" accept="application/json" hidden></div>
<div class="section"><h2>03 &nbsp; 조작과 화면</h2><div class="fields"><label>마우스 감도<input id="sensitivity" type="range" min="0.2" max="3" step="0.1"></label></div><div class="key-list"><span><kbd>W S</kbd> 전진·후진</span><span><kbd>A D</kbd> 방향 전환</span><span><kbd>Q E</kbd> 옆걸음</span><span><kbd>Space</kbd> 점프</span></div><p class="hint">우클릭 드래그: 방향·카메라<br>좌클릭 드래그: 카메라만 회전<br>우클릭 + A/D: 옆걸음 · 양쪽 클릭: 전진<br>휠: 줌 · 포커스 상실: 자동 일시정지</p><details><summary>키 바인딩 변경</summary><div id="key-bindings"></div><p class="hint">항목을 클릭한 뒤 사용할 키를 누르세요.</p></details>
<div class="sidebar-actions"><button id="history-open">내 연습 기록</button></div></div>
</aside><main class="content"><div class="arena-top"><div><h2>전체 전투 연습 <span class="tag" id="duration-tag">302.375s</span></h2><p id="scenario-title"></p></div><div class="status" id="phase">연습 준비</div></div>
<div class="stage"><div id="scene" aria-label="스조라크 3D 전장"></div>
<div class="overlay compass">A / 북<br><span id="coords">좌표</span><br><span id="seed-label"></span></div>
<div class="overlay boss-health"><strong>스조라크 · SSZORAK</strong><div class="health-track"><div id="progress"></div></div><small>전투 진행도 · 체력 기반 전환 없음</small></div>
<div class="overlay timers"><h3>NEXT MECHANICS</h3><div id="timers"></div></div>
<div class="overlay warning" id="warning"></div><div class="overlay instruction" id="instruction"></div>
<div class="overlay raid"><h3>RAID / 20</h3><div class="raid-grid" id="raid"></div></div>
<div class="overlay castbar" id="cast" hidden></div><div class="watermark overlay">독자 제작 그래픽 · 재구성 공간 규칙</div>
<div class="splash" id="splash"><div class="eyebrow">POSITION. REACT. REPEAT.</div><h2>한 번 더, 더 정확하게.</h2><p>나와 19명의 공대원이 함께하는 전투.<br>역할을 정하고 공간 기믹을 연습하세요.<br><small>실제 로그 전체 재현이 아닌 연습용 시뮬레이션</small></p><button id="begin" class="primary">전투 연습 시작 →</button></div></div>
<div class="transport"><div class="transport-row"><button id="play" class="primary">▶ 시작</button><button id="retry">↺ 같은 시드</button><select id="speed" aria-label="재생 속도"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><div class="clock"><span id="clock">00:00</span> <small id="end-clock">/ 05:02</small></div><span class="spacer"></span><label class="check optional"><input id="goals" type="checkbox" checked>이동 목표</label><label class="check"><input id="sound" type="checkbox">경고음</label><button id="results-open">전투 분석</button></div>
<div class="timeline"><span>00:00</span><input id="seek" type="range" min="0" max="302.375" step="0.1" value="0" aria-label="연습 시작 시점"><span id="end-range">05:02</span></div><div class="segments" id="segments"></div><div class="bottom-note"><span id="pause-label">준비됨 · 시작 버튼을 누르세요</span><span>관측 시각과 근사 규칙 혼합 · 출처 확인 ↗</span></div></div>
</main></div>
<dialog id="sources"><button class="close">닫기 ×</button><h2>출처와 구현 수준</h2><p>기준: WCL A8yxaWCNdrb1wmLh / fight 24 · 302.375초. 원본 API와 공략은 현재 환경에서 네트워크 정책으로 접근하지 못했습니다. 아래 ‘전달 관측’은 사용자 제공 인계값이며 이 버전에서 독립적으로 재검증하지 않았습니다.</p><p>첫 콤보 시작·완료, Surge·Dig In 시작은 전달 관측입니다. 나머지 타임라인, 반경, 취약 지속시간, 바람 방향·간격, 회오리 궤적과 봇 전술은 연습용 재구성입니다. Fury의 8yd·14인 조건도 제공된 요구사항을 구현한 것으로 원본 대조 전입니다.</p><p>탱커 교대·취약, 조건 집결, 맹독 전염, 접촉 낭종, 비행 충돌은 동작합니다. 공격력·스킬·힐·사망은 모델링하지 않고 실패를 기록하며 전투는 계속됩니다. 실제 WoW 모델·지도·물리와 동일하지 않습니다.</p><p><a href="https://www.warcraftlogs.com/reports/A8yxaWCNdrb1wmLh?fight=24&view=replay" target="_blank" rel="noreferrer">기준 WCL 리플레이 ↗</a> · 상세 제한은 저장소 docs/ACCURACY.md 참조</p><div class="sources-list"><table><thead><tr><th>시각</th><th>기믹</th><th>근거</th><th>연습</th></tr></thead><tbody id="source-events"></tbody></table></div></dialog>
<dialog id="results"><button class="close">닫기 ×</button><h2>이번 연습 분석</h2><p>내 피격·공대 협동 판정을 기록합니다. 봇의 실패는 별도로 표시합니다. 구간 복원 중 발생한 과거 판정은 포함하지 않습니다.</p><div class="result-summary" id="summary"></div><div class="sources-list"><table><thead><tr><th>시각</th><th>대상</th><th>결과·원인</th><th>다시 연습</th></tr></thead><tbody id="result-rows"></tbody></table></div></dialog>
<dialog id="history"><button class="close">닫기 ×</button><h2>내 연습 기록</h2><p>이 브라우저에 최근 30회 저장합니다. 결과를 열거나 연습을 마치면 기록됩니다.</p><div class="record-list" id="history-list"></div></dialog><div class="toast" id="toast" hidden role="status"></div>`;
function toast(text: string) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  window.setTimeout(() => ($("toast").hidden = true), 5000);
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast(
      "브라우저 저장 공간에 기록하지 못했습니다. 설정 내보내기를 사용하세요.",
    );
  }
}
let selectedRole = stored.role;
function setForm(c: Config) {
  selectedRole = c.role;
  document
    .querySelectorAll<HTMLButtonElement>("[data-role]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.role === selectedRole),
    );
  for (const key of [
    "position",
    "party",
    "soak",
    "mode",
    "bait",
    "focus",
    "marker",
    "cystOrder",
    "partner",
    "seed",
    "sensitivity",
  ] as const)
    $(key).setAttribute("data-loaded", String(c[key]));
  for (const key of [
    "position",
    "party",
    "soak",
    "mode",
    "bait",
    "focus",
    "marker",
    "cystOrder",
    "partner",
    "seed",
    "sensitivity",
  ] as const)
    $<HTMLInputElement | HTMLSelectElement>(key).value = String(c[key]);
  updateRole();
}
function updateRole() {
  $<HTMLSelectElement>("position").disabled = selectedRole === "tank";
  $<HTMLSelectElement>("soak").disabled = selectedRole === "tank";
}
function configFromForm(): Config {
  const c = { ...stored, role: selectedRole };
  for (const key of ["position", "mode", "focus"] as const)
    (c as unknown as Record<string, unknown>)[key] =
      $<HTMLSelectElement>(key).value;
  for (const key of [
    "party",
    "soak",
    "marker",
    "cystOrder",
    "partner",
    "seed",
    "sensitivity",
  ] as const)
    (c as unknown as Record<string, unknown>)[key] = Number(
      $<HTMLInputElement>(key).value,
    );
  c.bait = $<HTMLSelectElement>("bait").value === "true";
  validateConfig(c);
  return c;
}
setForm(stored);
let view: View | undefined, input: Input | undefined;
try {
  view = new View($("scene"));
  input = new Input(view.renderer.domElement, () => {
    if (running) {
      setRunning(false);
      toast("포커스를 벗어나 자동 일시정지했습니다.");
    }
  });
  input.sensitivity = stored.sensitivity;
  input.facing = input.yaw = angle(sim.player, sim.boss);
  const b = readStored<Bindings>("raid-bindings", defaultBindings);
  if (
    Object.keys(defaultBindings).every(
      (k) => typeof b[k as keyof Bindings] === "string",
    ) &&
    new Set(Object.values(b)).size === 7
  )
    input.bindings = b;
} catch (e) {
  $("scene").innerHTML =
    '<div class="error">3D 화면을 시작할 수 없습니다. WebGL을 지원하는 데스크톱 브라우저에서 하드웨어 가속을 켜고 다시 시도하세요.</div>';
  $<HTMLButtonElement>("play").disabled = true;
  $<HTMLButtonElement>("begin").disabled = true;
  toast("WebGL 초기화 실패");
  console.error(e);
}
for (const [key, label] of Object.entries({
  forward: "전진",
  back: "후진",
  left: "좌회전",
  right: "우회전",
  strafeLeft: "왼쪽 옆걸음",
  strafeRight: "오른쪽 옆걸음",
  jump: "점프",
})) {
  const l = document.createElement("label");
  l.textContent = label;
  const field = document.createElement("input");
  field.readOnly = true;
  field.value =
    input?.bindings[key as keyof Bindings] ??
    defaultBindings[key as keyof Bindings];
  field.setAttribute("aria-label", label + " 키");
  field.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!input) return;
    if (["Escape", "Tab"].includes(e.code)) return;
    const next = { ...input.bindings, [key]: e.code };
    if (new Set(Object.values(next)).size !== 7) {
      toast("이미 사용 중인 키입니다.");
      return;
    }
    input.bindings = next;
    field.value = e.code;
    save("raid-bindings", next);
  });
  l.appendChild(field);
  $("key-bindings").appendChild(l);
}
function setRunning(value: boolean) {
  if (value && !view) return;
  running = value;
  accumulator = 0;
  previous = performance.now();
  input?.clear();
  $("splash").hidden = started;
  $("play").textContent = running
    ? "Ⅱ 일시정지"
    : started
      ? "▶ 계속"
      : "▶ 시작";
  $("pause-label").textContent = running
    ? "연습 중 · 포커스 이탈 시 자동 일시정지"
    : started
      ? "일시정지 · 계속 버튼으로 재개"
      : "준비됨 · 시작 버튼을 누르세요";
}
function begin() {
  if (sim.completed) reset(segmentStart);
  started = true;
  $("splash").hidden = true;
  if ($<HTMLInputElement>("sound").checked) {
    audio ??= new AudioContext();
    void audio.resume();
  }
  setRunning(!running);
}
function reset(at = 0, c: Config = sim.config) {
  sim = new Simulation({ ...c }, scenario);
  if (at > 0) sim.seek(at);
  segmentStart = at;
  recordId = sessionId();
  accumulator = 0;
  beepKey = "";
  started = true;
  input?.clear();
  if (input) {
    input.facing = input.yaw = angle(sim.player, sim.boss);
  }
  setRunning(false);
  hud();
}
function jumpTo(at: number) {
  if (started && sim.time > segmentStart + 1) recordHistory();
  reset(Math.max(0, at));
  toast(`${format(at)}부터 상태를 복원했습니다. 계속 버튼으로 시작하세요.`);
}
$("begin").onclick = begin;
$("play").onclick = begin;
$("retry").onclick = () => {
  recordHistory();
  reset(segmentStart);
  toast("같은 시드와 배정으로 재시작합니다.");
};
$("apply").onclick = () => {
  try {
    const c = configFromForm();
    recordHistory();
    stored = c;
    save("raid-config", c);
    if (input) input.sensitivity = c.sensitivity;
    reset(0, c);
    toast("배정을 적용했습니다. 시작 버튼으로 연습하세요.");
  } catch (e) {
    toast((e as Error).message);
  }
};
document.querySelectorAll<HTMLButtonElement>("[data-role]").forEach(
  (b) =>
    (b.onclick = () => {
      selectedRole = b.dataset.role as Config["role"];
      document
        .querySelectorAll<HTMLButtonElement>("[data-role]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      updateRole();
    }),
);
$<HTMLSelectElement>("speed").onchange = (e) =>
  (speed = Number((e.target as HTMLSelectElement).value));
$<HTMLInputElement>("sensitivity").oninput = (e) => {
  if (input) input.sensitivity = Number((e.target as HTMLInputElement).value);
};
$<HTMLInputElement>("seek").oninput = () => setRunning(false);
$<HTMLInputElement>("seek").onchange = (e) =>
  jumpTo(Number((e.target as HTMLInputElement).value));
$("sources-open").onclick = () => {
  setRunning(false);
  $<HTMLDialogElement>("sources").showModal();
};
$("results-open").onclick = () => showResults();
$("history-open").onclick = () => {
  setRunning(false);
  $("history-list").innerHTML =
    Array.isArray(history) && history.length
      ? history
          .map(
            (h) =>
              `<div>${escape(h.at)} · 시드 ${h.seed} · ${format(h.from)} → ${format(h.from + h.duration)} · 실패 ${h.failures}회 · ${h.finished ? "완료" : "구간 연습"}</div>`,
          )
          .join("")
      : "저장된 연습이 없습니다.";
  $<HTMLDialogElement>("history").showModal();
};
document
  .querySelectorAll<HTMLButtonElement>("dialog .close")
  .forEach(
    (b) =>
      (b.onclick = () => (b.closest("dialog") as HTMLDialogElement).close()),
  );
$<HTMLInputElement>("sound").onchange = () => {
  if ($<HTMLInputElement>("sound").checked) {
    audio ??= new AudioContext();
    void audio.resume();
  }
};
function sound() {
  if (!audio || !running || !$<HTMLInputElement>("sound").checked) return;
  const osc = audio.createOscillator(),
    gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
  osc.start();
  osc.stop(audio.currentTime + 0.12);
}
function recordHistory() {
  if (sim.time < segmentStart + 1 || !Array.isArray(history)) return;
  const existing = history.findIndex((h) => h.id === recordId);
  if (existing >= 0) history.splice(existing, 1);
  history.unshift({
    id: recordId,
    at: new Date().toLocaleString("ko-KR"),
    seed: sim.config.seed,
    from: segmentStart,
    duration: sim.time - segmentStart,
    failures: sim.results.filter((r) => !r.success && r.actor === 0).length,
    finished: sim.completed,
  });
  history.splice(30);
  save("raid-history", history);
}
function showResults() {
  setRunning(false);
  recordHistory();
  const mine = sim.results.filter((r) => r.actor === 0),
    fail = mine.filter((r) => !r.success);
  $("summary").innerHTML =
    `<div><strong>${format(sim.time - segmentStart)}</strong><small>연습한 시간</small></div><div><strong>${fail.length}</strong><small>내 실패·협동 실패</small></div><div><strong>${mine.filter((r) => r.success).length}</strong><small>성공한 판정</small></div>`;
  $("result-rows").innerHTML = sim.results.length
    ? sim.results
        .slice(-200)
        .reverse()
        .map(
          (r) =>
            `<tr><td>${format(r.time)}</td><td>${r.actor === 0 ? "나 / 공대" : `봇 ${r.actor}`}</td><td>${r.success ? "✓" : "!"} ${escape(r.message)}</td><td><button data-practice="${Math.max(0, r.eventAt - 8)}">8초 전부터</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="empty">아직 판정 기록이 없습니다.</td></tr>';
  bindPractice($("results"));
  $<HTMLDialogElement>("results").showModal();
}
function bindPractice(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-practice]").forEach(
    (b) =>
      (b.onclick = () => {
        b.closest("dialog")?.close();
        jumpTo(Number(b.dataset.practice));
      }),
  );
}
function scenarioUI() {
  $("duration-tag").textContent = scenario.duration.toFixed(3) + "s";
  $("end-clock").textContent = "/ " + format(scenario.duration);
  $("end-range").textContent = format(scenario.duration);
  $("scenario-title").textContent = scenario.title;
  $("source-events").innerHTML = scenario.events
    .map(
      (e) =>
        `<tr><td>${e.at.toFixed(3)}s</td><td>${escape(names[e.kind])}</td><td>${(e.confidence === "log-observed" ? "API 관측 시작" : e.confidence === "handoff-observed" ? "전달 관측 시작" : "재구성 시작") + " / " + (e.durationConfidence === "log-observed" ? "관측 시전 길이" : e.durationConfidence === "handoff-observed" ? "전달 시전 길이" : "근사 길이")}</td><td><button data-practice="${Math.max(0, e.at - 8)}">8초 전</button></td></tr>`,
    )
    .join("");
  bindPractice($("sources"));
  $("segments").innerHTML = [0, 25, 55, 92, 128, 183, 219, 255, 280]
    .filter((t) => t < scenario.duration)
    .map(
      (t) =>
        `<button data-practice="${t}">${format(t)} ${t === 0 ? "전체 전투" : t === 92 || t === 219 ? "강풍 준비" : "구간 연습"}</button>`,
    )
    .join("");
  bindPractice($("segments"));
  $<HTMLInputElement>("seek").max = String(scenario.duration);
}
$("export").onclick = () => {
  try {
    const data = { version: 1, config: configFromForm(), scenario };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `raid-practice-${data.config.seed}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    toast((e as Error).message);
  }
};
$("import").onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = async () => {
  const f = $<HTMLInputElement>("file").files?.[0];
  if (!f) return;
  try {
    if (f.size > 1_000_000) throw Error("파일은 1MB 이하여야 합니다.");
    const d = JSON.parse(await f.text());
    if (d.version !== 1) throw Error("지원하지 않는 저장 형식");
    validateConfig(d.config);
    validateScenario(d.scenario);
    setRunning(false);
    scenario = d.scenario;
    stored = d.config;
    setForm(stored);
    save("raid-config", stored);
    if (input) input.sensitivity = stored.sensitivity;
    scenarioUI();
    reset(0, stored);
    toast("시나리오와 배정을 불러왔습니다.");
  } catch (e) {
    toast(`불러오기 실패: ${(e as Error).message}`);
  } finally {
    $<HTMLInputElement>("file").value = "";
  }
};
function hud() {
  $("clock").textContent = format(sim.time);
  $<HTMLInputElement>("seek").value = String(sim.time);
  $("progress").style.width = `${100 * (sim.time / scenario.duration)}%`;
  $("phase").textContent = sim.completed
    ? "연습 종료"
    : sim.time < sim.digUntil
      ? "강풍 구간"
      : running
        ? "기본 전투"
        : started
          ? "일시정지"
          : "연습 준비";
  $("coords").textContent =
    `X ${sim.player.x.toFixed(1)} / Z ${sim.player.z.toFixed(1)}`;
  $("seed-label").textContent = `SEED ${sim.config.seed}`;
  const next = scenario.events.slice(sim.next, sim.next + 5);
  $("timers").innerHTML = next
    .map(
      (e) =>
        `<div class="timer" style="--fill:${Math.max(0, 100 - ((e.at - sim.time) / 45) * 100)}%"><div><span>${escape(names[e.kind].split(" · ")[0])}${e.confidence === "reconstructed" ? " ≈" : ""}</span><em>${(e.at - sim.time).toFixed(1)}</em></div></div>`,
    )
    .join("");
  $("warning").textContent = sim.warnings.at(-1)?.text ?? "";
  const cast = sim.casts.find((c) => !c.resolved && c.event.kind !== "DigIn");
  $("cast").hidden = !cast;
  if (cast) {
    const remaining = Math.max(0, cast.end - sim.time);
    $("cast").innerHTML =
      `${escape(names[cast.event.kind])} · ${remaining.toFixed(1)}s<div class="bar"><div style="width:${100 * (1 - remaining / Math.max(cast.event.duration, 0.1))}%"></div></div>`;
    if (remaining < 3) {
      const key = cast.event.id + Math.ceil(remaining);
      if (key !== beepKey) {
        sound();
        beepKey = key;
      }
    }
  }
  $("raid").innerHTML = sim.actors
    .map(
      (a) =>
        `<div class="raid-cell ${a.role} ${a.id === 0 ? "me" : ""} ${a.virulent > sim.time || a.vulnerable > sim.time ? "debuff" : ""}" title="${escape(a.name)} · 파티 ${a.party} · 소킹 ${a.soak || "제외"} · ${escape(a.action)}">${a.id === 0 ? "나" : a.id}</div>`,
    )
    .join("");
  let task = sim.player.action;
  if (sim.fury) {
    const target = sim.actors[sim.fury.target],
      count = sim.actors.filter((a) => distance(a, target) <= 8).length;
    task = `Fury · ${target.name} 주위 ${count}/14명 ${sim.time < sim.digUntil ? "· 강풍 중 발동 대기" : ""}`;
  }
  const gust = sim.gusts[0];
  let note = `목표까지 ${distance(sim.player, sim.player.goal).toFixed(1)}yd · ${sim.player.hits}회 피격/실패`;
  if (gust && gust.at - sim.time < 7) {
    task = `강풍 ${gust.order} · ${["북", "동", "남", "서"][gust.direction]}로 밀림 · ${(gust.at - sim.time).toFixed(1)}초`;
    note = `반대편 낭종의 반동·감속 활용 · 내 담당 ${sim.config.cystOrder}번째`;
  }
  $("instruction").innerHTML = `${escape(task)}<small>${escape(note)}</small>`;
}
scenarioUI();
hud();
// Debug surface contains no credentials; browser tests can step the actual core without a render clock.
Object.defineProperty(window, "raidDebug", {
  value: {
    get sim() {
      return sim;
    },
    pause() {
      setRunning(false);
    },
    step(n: number, input: Vec = { x: 0, z: 0 }) {
      setRunning(false);
      for (let i = 0; i < n; i++) sim.step(input);
      hud();
    },
    seek(t: number) {
      jumpTo(t);
    },
    get running() {
      return running;
    },
  },
});
function frame(now: number) {
  const elapsed = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  if (running) {
    accumulator += elapsed * speed;
    while (accumulator + 1e-10 >= STEP) {
      const movement = input?.movement(STEP) ?? { x: 0, z: 0 };
      sim.step(movement, input?.consumeJump() ?? false);
      accumulator -= STEP;
      if (sim.completed) {
        setRunning(false);
        showResults();
        break;
      }
    }
  }
  if (now - lastHud > 100) {
    hud();
    lastHud = now;
  }
  if (view && input)
    view.render(sim, input, $<HTMLInputElement>("goals").checked);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
