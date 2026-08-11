// 한자능력검정시험 학습 - 게임 로직
// hanja-kr-data.js가 먼저 로드된 후 실행되어야 합니다 (KRDATA1~15, KR_GRADES, KR_ALL_DATA 사용).
// 기존 "한자 타이핑"(일본 상용한자) 프로젝트의 UI/구조를 재사용하되,
// - 음독/훈독 2칸 입력 -> 훈음 1칸 통합 입력으로 변경
// - 난이도(쉬움/보통/어려움) 제거 (다음자는 "여러 정답 중 하나만 맞아도 통과"로 통일)
// - 일일 챌린지 -> "한자 일일 학습"(SRS, 추후 구현) 자리로 교체, 지금은 비활성

const GRADES = KR_GRADES; // 이하 로직은 GRADES라는 이름으로 참조

let currentGrade = 9; // 기본값: 4급
let currentLen = 100;
let ROUND = [];
let idx = 0;
let missCount = 0;
let attemptCount = 0;
let revealCount = 0;
let startTime = null;
let timerHandle = null;
let hintMisses = 0;
let readingsMatched = []; // 현재 한자의 훈음 세트별 매칭 여부
let transitioning = false; // 정답 판정 후 다음 문항으로 넘어가는 전환 구간 동안 중복 제출 방지용 잠금

const el = (id) => document.getElementById(id);
const startScreen = el('startScreen');
const gameScreen = el('gameScreen');
const resultScreen = el('resultScreen');

(function initTheme(){
  const saved = localStorage.getItem('hanja-kr-theme');
  const theme = saved || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = el('themeToggle');
  if(btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  if(btn){
    btn.addEventListener('click', ()=>{
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('hanja-kr-theme', next);
      btn.textContent = next === 'light' ? '☀️' : '🌙';
    });
  }
})();

function renderLengthPicker(preferredLen){
  const g = GRADES[currentGrade];
  const wrap = el('lengthPicker');
  wrap.innerHTML = '';
  const useLen = (preferredLen !== undefined && g.lens.includes(preferredLen)) ? preferredLen : g.lens[Math.min(2, g.lens.length-1)];
  g.lens.forEach((len)=>{
    const b = document.createElement('button');
    b.textContent = (len===g.count ? '전체 '+len : len+'문항');
    b.dataset.len = len;
    if(len === useLen) b.classList.add('active');
    wrap.appendChild(b);
  });
  currentLen = useLen;
}

el('gradePicker').addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if(!b) return;
  document.querySelectorAll('#gradePicker button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  currentGrade = parseInt(b.dataset.grade);
  renderLengthPicker();
  loadStartLeaderboard();
});

el('lengthPicker').addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if(!b) return;
  document.querySelectorAll('#lengthPicker button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  currentLen = parseInt(b.dataset.len);
  loadStartLeaderboard();
});

renderLengthPicker(100);

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function startGame(){
  const g = GRADES[currentGrade];
  beginRound(shuffle(g.data).slice(0, currentLen), g.label);
}

function beginRound(round, label){
  ROUND = round;
  idx = 0; missCount = 0; attemptCount = 0; hintMisses = 0; revealCount = 0;
  transitioning = false;
  startTime = Date.now();
  startScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  el('statTotal').textContent = ROUND.length;
  el('lineSub').textContent = label + ' · 훈음 완주';
  el('footerNote').textContent = label + ' ' + ROUND.length + '자 · 한국어문회 배정한자 기준';
  buildTrack();
  renderStation();
  clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 250);
  el('answerInput').focus();
}

function buildTrack(){
  const track = el('track');
  track.innerHTML = '';
  ROUND.forEach((_,i)=>{
    const d = document.createElement('div');
    d.className = 'dot';
    d.id = 'dot'+i;
    track.appendChild(d);
  });
  updateTrack();
}

function updateTrack(){
  ROUND.forEach((_,i)=>{
    const d = el('dot'+i);
    d.className = 'dot' + (i<idx?' done':'') + (i===idx?' current':'');
  });
}

function renderStation(){
  const item = ROUND[idx];
  const kEl = el('kanjiDisplay');
  kEl.textContent = item.c;
  kEl.classList.remove('flip'); void kEl.offsetWidth; kEl.classList.add('flip');
  el('flapcard').classList.remove('wrong');
  el('hintBtn').classList.add('hidden');
  el('hintText').textContent = '';
  el('giveupBtn').disabled = false;
  hintMisses = 0;
  el('answerInput').value = '';
  el('statPos').textContent = idx+1;

  readingsMatched = item.readings.map(()=>false);

  const slotsEl = el('slots');
  slotsEl.innerHTML = '';
  slotsEl.appendChild(renderSlotBoxes(item.readings));
  updateTrack();
  updateStats();
}

function readingDisplay(r){
  return r.hun.join('/') + ' ' + r.eum;
}

function renderSlotBoxes(readings){
  const d = document.createElement('div');
  d.className = 'slot';
  d.id = 'slot-hun';
  const boxes = readings.map((r,i) => `<div class="reading-box rb-empty" id="box-${i}"><span class="rb-h"></span></div>`).join('');
  d.innerHTML = `<div class="label">훈음</div>${boxes}`;
  return d;
}

function markBox(i, reading, state){
  const box = el(`box-${i}`);
  if(!box) return;
  box.classList.remove('rb-empty');
  box.classList.add(state === 'revealed' ? 'rb-revealed' : 'rb-filled');
  box.querySelector('.rb-h').textContent = readingDisplay(reading);
}

function isStationComplete(){
  // 다음자(여러 훈음 세트)는 그중 하나만 맞아도 통과
  return readingsMatched.some(x=>x);
}

function revealRemainingBoxes(item){
  item.readings.forEach((r,i) => {
    if(!readingsMatched[i]){ markBox(i, r, 'revealed'); readingsMatched[i] = true; }
  });
}

function goToNext(delayMs){
  transitioning = true;
  el('giveupBtn').disabled = true;
  setTimeout(()=>{
    idx++;
    if(idx >= ROUND.length){
      transitioning = false;
      finishGame();
    } else {
      renderStation();
      transitioning = false;
      el('answerInput').focus();
    }
  }, delayMs || 420);
}

function checkAndAdvance(delayMs){
  if(!isStationComplete()) return;
  const item = ROUND[idx];
  revealRemainingBoxes(item);
  el('slots').querySelectorAll('.slot').forEach(s => s.classList.add('complete'));
  goToNext(delayMs);
}

// 정답 판정: 띄어쓰기를 무시하고, 훈음 세트를 "훈+음" 통째로 비교
// 훈이 여러 개(예: 暇 = 틈/겨를)인 경우 그중 하나만 맞아도 그 세트는 정답 처리
function normalize(s){
  return s.replace(/\s+/g, '');
}

function findMatchIndex(readings, matchedArr, val){
  const valN = normalize(val);
  for(let i=0;i<readings.length;i++){
    if(matchedArr[i]) continue;
    const r = readings[i];
    const hit = r.hun.some(h => normalize(h + r.eum) === valN);
    if(hit) return i;
  }
  return -1;
}

function submitAnswer(){
  if(transitioning) return; // 전환 중엔 어떤 입력도 처리하지 않음 (연타/IME 이중 이벤트 방지)
  const val = el('answerInput').value.trim();
  if(!val) return;
  attemptCount++;
  const item = ROUND[idx];
  const card = el('flapcard');

  const i = findMatchIndex(item.readings, readingsMatched, val);
  if(i !== -1){
    readingsMatched[i] = true;
    markBox(i, item.readings[i], 'filled');
    el('answerInput').value = '';
    updateStats();
    checkAndAdvance(420);
  } else {
    missCount++;
    hintMisses++;
    card.classList.add('wrong');
    setTimeout(()=>card.classList.remove('wrong'), 300);
    el('answerInput').value = '';
    if(hintMisses >= 2){
      el('hintBtn').classList.remove('hidden');
    }
    updateStats();
  }
}

el('hintBtn').addEventListener('click', ()=>{
  const item = ROUND[idx];
  const i = readingsMatched.findIndex(x=>!x);
  const firstChar = (i !== -1) ? item.readings[i].hun[0][0] : null;
  el('hintText').textContent = firstChar ? ('첫 글자: ' + firstChar) : '';
});

el('giveupBtn').addEventListener('click', ()=>{
  if(isStationComplete()) return;
  const item = ROUND[idx];
  revealRemainingBoxes(item);
  revealCount++;
  el('statReveal').textContent = revealCount;
  el('hintText').textContent = '';
  el('hintBtn').classList.add('hidden');
  el('answerInput').value = '';
  goToNext(2600);
});

el('submitBtn').addEventListener('click', submitAnswer);
el('answerInput').addEventListener('keydown', (e)=>{
  if(e.key==='Enter' && !e.isComposing) submitAnswer();
});

function updateStats(){
  const acc = attemptCount===0 ? 100 : Math.round(((attemptCount-missCount)/attemptCount)*100);
  el('statAcc').textContent = acc + '%';
  el('statMiss').textContent = missCount;
  el('statReveal').textContent = revealCount;
}

function updateTimer(){
  const sec = Math.floor((Date.now()-startTime)/1000);
  const m = Math.floor(sec/60), s = sec%60;
  el('statTime').textContent = m+':'+String(s).padStart(2,'0');
}

function finishGame(){
  clearInterval(timerHandle);
  const sec = Math.floor((Date.now()-startTime)/1000);
  const m = Math.floor(sec/60), s = sec%60;
  const timeStr = m+':'+String(s).padStart(2,'0');
  const acc = attemptCount===0 ? 100 : Math.round(((attemptCount-missCount)/attemptCount)*100);
  const revealRate = ROUND.length===0 ? 0 : (revealCount/ROUND.length)*100;

  gameScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');
  el('resTime').textContent = timeStr;
  el('resAcc').textContent = acc+'%';
  el('resMiss').textContent = missCount;
  el('resReveal').textContent = revealCount;

  const rankWrap = el('rankSubmitWrap');
  const blockedMsg = el('rankBlockedMsg');
  if(revealRate > 20){
    rankWrap.classList.add('hidden');
    blockedMsg.classList.remove('hidden');
    blockedMsg.textContent = '정답 보기를 20% 초과 사용하여 랭킹 등록이 제한됩니다.';
  } else {
    rankWrap.classList.remove('hidden');
    blockedMsg.classList.add('hidden');
  }

  loadGlobalLeaderboard();

  el('rankSubmitBtn').onclick = () => {
    const nickname = el('nicknameInput').value.trim().slice(0,8);
    if(!nickname) return;
    submitGlobalScore(nickname, sec, acc, missCount, revealCount);
    el('rankSubmitBtn').disabled = true;
    el('rankSubmitBtn').textContent = '등록 완료';
  };
}

el('quitBtn').addEventListener('click', ()=>{
  clearInterval(timerHandle);
  gameScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
});

el('againBtn').addEventListener('click', ()=>{
  resultScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
});

el('startBtn').addEventListener('click', startGame);

// --- 한자 일일 학습 (SRS/FSRS) ---
const studyScreen = el('studyScreen');
const studyDoneScreen = el('studyDoneScreen');
const srs = HanjaSRS.createSRS(window.localStorage);
const DAILY_NEW_LIMIT = 20;

let studyQueue = [];   // 오늘 풀 카드들 (review + new 합친 것)
let studyIdx = 0;
let studyCurrent = null;

function updateStudySub(){
  const s = srs.stats(KR_ALL_DATA);
  el('studySub').textContent = `누적 학습 ${s.learned}자 · 오늘 복습 예정 ${s.dueToday}자`;
}
updateStudySub();

el('dailyStudyBtn').addEventListener('click', ()=>{
  const q = srs.buildDailyQueue(KR_ALL_DATA, DAILY_NEW_LIMIT, new Date());
  studyQueue = shuffle(q.review.concat(q.new));
  if(studyQueue.length === 0){
    startScreen.classList.add('hidden');
    studyDoneScreen.classList.remove('hidden');
    return;
  }
  el('studyReviewCount').textContent = q.review.length;
  el('studyNewCount').textContent = q.new.length;
  studyIdx = 0;
  startScreen.classList.add('hidden');
  studyScreen.classList.remove('hidden');
  renderStudyCard();
});

function renderStudyCard(){
  if(studyIdx >= studyQueue.length){
    studyScreen.classList.add('hidden');
    studyDoneScreen.classList.remove('hidden');
    return;
  }
  studyCurrent = studyQueue[studyIdx];
  el('studyKanji').textContent = studyCurrent.c;
  el('studyAnswer').classList.add('hidden');
  el('studyAnswer').innerHTML = '';
  el('studyRevealRow').classList.remove('hidden');
  el('studyRatingRow').classList.add('hidden');
  el('studyRemaining').textContent = studyQueue.length - studyIdx;
}

el('studyRevealBtn').addEventListener('click', ()=>{
  const answerEl = el('studyAnswer');
  answerEl.textContent = studyCurrent.readings.map(readingDisplay).join(' · ');
  answerEl.classList.remove('hidden');
  el('studyRevealRow').classList.add('hidden');
  el('studyRatingRow').classList.remove('hidden');
});

function rateCurrentAndAdvance(rating){
  srs.rate(studyCurrent.c, rating, new Date());
  studyIdx++;
  renderStudyCard();
}

el('rateAgain').addEventListener('click', ()=> rateCurrentAndAdvance(FSRS.Rating.Again));
el('rateHard').addEventListener('click', ()=> rateCurrentAndAdvance(FSRS.Rating.Hard));
el('rateGood').addEventListener('click', ()=> rateCurrentAndAdvance(FSRS.Rating.Good));
el('rateEasy').addEventListener('click', ()=> rateCurrentAndAdvance(FSRS.Rating.Easy));

el('studyQuitBtn').addEventListener('click', ()=>{
  studyScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  updateStudySub();
});

el('studyDoneBtn').addEventListener('click', ()=>{
  studyDoneScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  updateStudySub();
});


// --- Firebase 리더보드 ---
// TODO: 이 프로젝트는 기존 "한자 타이핑"과 별개 사이트이므로,
// Firebase 콘솔에서 새 프로젝트를 만들고 아래 설정값을 교체해야 합니다.
// (Realtime Database 사용, 기존 프로젝트의 config를 그대로 쓰면 데이터가 섞입니다.)
const firebaseConfig = {
  apiKey: "AIzaSyDV2_R9rz7_pS-X1ThhSfCfmdlTwrzji4g",
  authDomain: "hanja-studying.firebaseapp.com",
  databaseURL: "https://hanja-studying-default-rtdb.firebaseio.com",
  projectId: "hanja-studying",
  storageBucket: "hanja-studying.firebasestorage.app",
  messagingSenderId: "334495234070",
  appId: "1:334495234070:web:36255e6ed4b6a810cf9d37",
  measurementId: "G-W4EHWZM2DR"
};
let database = null;
try {
  firebase.initializeApp(firebaseConfig);
  database = firebase.database();
} catch(e) {
  console.warn('Firebase 설정이 아직 없습니다. 리더보드 기능은 비활성 상태입니다.', e);
}

function categoryKeyFor(){
  const g = GRADES[currentGrade];
  return `${g.key}_${ROUND.length}`;
}

function submitGlobalScore(nickname, timeSec, acc, miss, reveal){
  if(!database) return;
  const categoryKey = categoryKeyFor();
  database.ref(`leaderboards/${categoryKey}`).push({
    nickname, time: timeSec, acc, miss, reveal, ts: Date.now()
  });
}

function renderLeaderboardSnapshot(containerEl, snapshot){
  containerEl.innerHTML = '';
  let rank = 1;
  let any = false;
  snapshot.forEach((child) => {
    any = true;
    const r = child.val();
    const t = Math.floor(r.time / 60) + ':' + String(r.time % 60).padStart(2, '0');
    const revealTxt = (r.reveal === undefined || r.reveal === null) ? '' : ' · 정답보기 ' + r.reveal;
    const row = document.createElement('div');
    row.className = 'row';

    // innerHTML 대신 textContent로 삽입: nickname은 누구나 쓸 수 있는 외부 데이터이므로 XSS 방지
    const rankSpan = document.createElement('span');
    rankSpan.textContent = `${rank}위 · ${r.nickname}`;
    const statB = document.createElement('b');
    statB.textContent = `${t} / ${r.acc}%${revealTxt}`;
    row.appendChild(rankSpan);
    row.appendChild(statB);
    containerEl.appendChild(row);
    rank++;
  });
  if(!any){
    containerEl.innerHTML = '<div class="row"><span>기록 없음</span></div>';
  }
}

function loadGlobalLeaderboard(){
  if(!database) return;
  const categoryKey = categoryKeyFor();
  el('bestTitle').textContent = GRADES[currentGrade].label + ' · ' + ROUND.length + '자 · TOP 10';
  database.ref(`leaderboards/${categoryKey}`).orderByChild('time').limitToFirst(10).once('value')
    .then(snapshot => renderLeaderboardSnapshot(el('bestRows'), snapshot))
    .catch(()=>{ el('bestRows').innerHTML = '<div class="row"><span>불러오기 실패</span></div>'; });
}

function loadStartLeaderboard(){
  if(!database) { el('startBestRows').innerHTML = '<div class="row"><span>랭킹 준비 중</span></div>'; return; }
  const g = GRADES[currentGrade];
  const categoryKey = `${g.key}_${currentLen}`;
  el('startBestTitle').textContent = g.label + ' · ' + currentLen + '자 · TOP 10';
  database.ref(`leaderboards/${categoryKey}`).orderByChild('time').limitToFirst(10).once('value')
    .then(snapshot => renderLeaderboardSnapshot(el('startBestRows'), snapshot))
    .catch(()=>{ el('startBestRows').innerHTML = '<div class="row"><span>불러오기 실패</span></div>'; });
}

loadStartLeaderboard();
