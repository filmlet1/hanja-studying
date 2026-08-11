// 한자 일일 학습(SRS) - 상태 저장 및 큐 빌더
// fsrs-kr.js가 먼저 로드되어 있어야 함 (window.FSRS 사용)
//
// 저장 구조 (localStorage key: 'hanja-kr-srs-v1'):
// { "校": { state, step, stability, difficulty, due, reps, lapses, last_review }, ... }
//
// 안키 기본값과 동일한 학습 단계(Learning Steps)를 FSRS 장기 기억 모델 위에 얹은 구조:
// - 신규 카드: "학습(learning)" 단계 1분→10분을 거친 뒤 "복습(review)" 상태로 졸업
//   (다시=1단계로, 어려움=현재+다음 단계 평균, 알맞음=다음 단계(마지막이면 졸업 1일), 쉬움=즉시 졸업 4일)
// - 복습 카드가 "다시"로 틀리면 "재학습(relearning)" 단계(10분)를 한 번 더 거친 뒤 복귀
// - 한 번 "복습" 상태로 졸업한 뒤부터는 FSRS가 장기 간격(일 단위)을 계산
//
// 설계 포인트: 상태는 "한자 자체"를 키로 저장하므로, 어떤 급수 범위를 학습하든
// 이미 상태가 있는 한자는 자동으로 "신규"에서 제외되고 복습 큐로만 들어감.

(function(global){
  'use strict';

  const STORAGE_KEY = 'hanja-kr-srs-v1';
  const DAY_MS = 86400000;
  const MIN_MS = 60000;

  // 안키 기본값
  const LEARNING_STEPS_MIN = [1, 10];   // 신규 카드 학습 단계 (분)
  const RELEARNING_STEPS_MIN = [10];    // 복습 카드가 "다시" 눌렀을 때 재학습 단계 (분)
  const GRADUATING_DAYS = 1;            // 학습 단계 다 마치고 "알맞음"으로 졸업 시 다음 복습까지 일수
  const EASY_DAYS = 4;                  // 학습 중 "쉬움"으로 즉시 졸업 시 다음 복습까지 일수

  function toDateOnly(d){
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function daysBetween(a, b){
    return Math.round((toDateOnly(b) - toDateOnly(a)) / DAY_MS);
  }
  function plusMinutes(now, min){ return new Date(now.getTime() + min * MIN_MS); }
  function plusDays(now, days){ return new Date(now.getTime() + days * DAY_MS); } // 자정이 아니라 '지금'부터 N일 뒤

  const R = () => global.FSRS.Rating; // 지연 참조 (fsrs-kr.js 로드 순서 보장용)

  /**
   * 카드 하나에 평가를 적용한 "다음 카드 상태"를 계산 (순수 함수, 저장 안 함).
   * @param {?object} card - 현재 카드 상태 (없으면 완전 신규)
   * @param {number} rating - FSRS.Rating.Again/Hard/Good/Easy
   * @param {Date} now
   * @returns {object} 다음 카드 상태 (due, state, step, stability, difficulty, reps, lapses, last_review)
   */
  function computeNext(card, rating, now){
    const Rt = R();
    const reps = (card ? card.reps : 0) + 1;
    const baseLapses = card ? card.lapses : 0;

    // --- 신규 카드 (아직 아무 상태 없음) ---
    if(!card){
      if(rating === Rt.Again){
        return { state:'learning', step:0, stability:null, difficulty:null,
          due: plusMinutes(now, LEARNING_STEPS_MIN[0]).toISOString(), reps, lapses: baseLapses, last_review: now.toISOString() };
      }
      if(rating === Rt.Hard){
        const avg = LEARNING_STEPS_MIN.length >= 2 ? (LEARNING_STEPS_MIN[0]+LEARNING_STEPS_MIN[1])/2 : LEARNING_STEPS_MIN[0]*1.5;
        return { state:'learning', step:0, stability:null, difficulty:null,
          due: plusMinutes(now, avg).toISOString(), reps, lapses: baseLapses, last_review: now.toISOString() };
      }
      if(rating === Rt.Good){
        if(LEARNING_STEPS_MIN.length <= 1){
          const fs = global.FSRS.nextState(null, 0, Rt.Good);
          return { state:'review', step:null, stability:fs.stability, difficulty:fs.difficulty,
            due: plusDays(now, GRADUATING_DAYS).toISOString(), reps, lapses: baseLapses, last_review: now.toISOString() };
        }
        return { state:'learning', step:1, stability:null, difficulty:null,
          due: plusMinutes(now, LEARNING_STEPS_MIN[1]).toISOString(), reps, lapses: baseLapses, last_review: now.toISOString() };
      }
      // Easy: 즉시 졸업
      const fs = global.FSRS.nextState(null, 0, Rt.Easy);
      return { state:'review', step:null, stability:fs.stability, difficulty:fs.difficulty,
        due: plusDays(now, EASY_DAYS).toISOString(), reps, lapses: baseLapses, last_review: now.toISOString() };
    }

    // --- 학습(learning) 단계 중 ---
    if(card.state === 'learning'){
      if(rating === Rt.Again){
        return { ...card, step:0, due: plusMinutes(now, LEARNING_STEPS_MIN[0]).toISOString(), reps, last_review: now.toISOString() };
      }
      if(rating === Rt.Hard){
        const cur = LEARNING_STEPS_MIN[card.step];
        const nxt = LEARNING_STEPS_MIN[card.step+1];
        const avg = nxt !== undefined ? (cur+nxt)/2 : cur*1.5;
        return { ...card, due: plusMinutes(now, avg).toISOString(), reps, last_review: now.toISOString() };
      }
      if(rating === Rt.Good){
        const nextStep = card.step + 1;
        if(nextStep >= LEARNING_STEPS_MIN.length){
          const fs = global.FSRS.nextState(null, 0, Rt.Good);
          return { state:'review', step:null, stability:fs.stability, difficulty:fs.difficulty,
            due: plusDays(now, GRADUATING_DAYS).toISOString(), reps, lapses: card.lapses, last_review: now.toISOString() };
        }
        return { ...card, step:nextStep, due: plusMinutes(now, LEARNING_STEPS_MIN[nextStep]).toISOString(), reps, last_review: now.toISOString() };
      }
      // Easy: 즉시 졸업
      const fs = global.FSRS.nextState(null, 0, Rt.Easy);
      return { state:'review', step:null, stability:fs.stability, difficulty:fs.difficulty,
        due: plusDays(now, EASY_DAYS).toISOString(), reps, lapses: card.lapses, last_review: now.toISOString() };
    }

    // --- 복습(review) 단계 (이미 장기 기억 모델 보유) ---
    if(card.state === 'review'){
      const elapsedDays = Math.max(0, daysBetween(new Date(card.last_review), now));
      if(rating === Rt.Again){
        const fs = global.FSRS.nextState({stability:card.stability, difficulty:card.difficulty}, elapsedDays, Rt.Again);
        return { state:'relearning', step:0, stability:fs.stability, difficulty:fs.difficulty,
          due: plusMinutes(now, RELEARNING_STEPS_MIN[0]).toISOString(), reps, lapses: card.lapses+1, last_review: now.toISOString() };
      }
      const fs = global.FSRS.nextState({stability:card.stability, difficulty:card.difficulty}, elapsedDays, rating);
      const intervalDays = global.FSRS.nextInterval(fs.stability, 0.9);
      return { state:'review', step:null, stability:fs.stability, difficulty:fs.difficulty,
        due: plusDays(now, intervalDays).toISOString(), reps, lapses: card.lapses, last_review: now.toISOString() };
    }

    // --- 재학습(relearning) 단계 중 ---
    if(card.state === 'relearning'){
      if(rating === Rt.Again){
        return { ...card, step:0, due: plusMinutes(now, RELEARNING_STEPS_MIN[0]).toISOString(), reps, last_review: now.toISOString() };
      }
      if(rating === Rt.Hard){
        const cur = RELEARNING_STEPS_MIN[card.step];
        return { ...card, due: plusMinutes(now, cur*1.5).toISOString(), reps, last_review: now.toISOString() };
      }
      if(rating === Rt.Good){
        const nextStep = card.step + 1;
        if(nextStep >= RELEARNING_STEPS_MIN.length){
          const intervalDays = global.FSRS.nextInterval(card.stability, 0.9);
          return { state:'review', step:null, stability:card.stability, difficulty:card.difficulty,
            due: plusDays(now, intervalDays).toISOString(), reps, lapses: card.lapses, last_review: now.toISOString() };
        }
        return { ...card, step:nextStep, due: plusMinutes(now, RELEARNING_STEPS_MIN[nextStep]).toISOString(), reps, last_review: now.toISOString() };
      }
      // Easy: 즉시 졸업
      const intervalDays = Math.max(global.FSRS.nextInterval(card.stability, 0.9), EASY_DAYS);
      return { state:'review', step:null, stability:card.stability, difficulty:card.difficulty,
        due: plusDays(now, intervalDays).toISOString(), reps, lapses: card.lapses, last_review: now.toISOString() };
    }

    throw new Error('알 수 없는 카드 상태: ' + card.state);
  }

  /**
   * 사람이 읽기 좋은 간격 문자열로 변환 (예: "<1분", "6분", "1일", "3개월").
   */
  function formatInterval(now, dueISO){
    const due = new Date(dueISO);
    const diffMin = (due - now) / MIN_MS;
    if(diffMin < 1) return '<1분';
    if(diffMin < 60) return Math.round(diffMin) + '분';
    const diffHour = diffMin / 60;
    if(diffHour < 24) return Math.round(diffHour) + '시간';
    const diffDays = Math.round(diffHour / 24);
    if(diffDays < 30) return diffDays + '일';
    if(diffDays < 365) return Math.round(diffDays/30) + '개월';
    return Math.round(diffDays/365) + '년';
  }

  /**
   * @param {{getItem:function, setItem:function}} storage - localStorage 호환 객체 (테스트 시 주입 가능)
   */
  function createSRS(storage){
    function loadAll(){
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch(e){
        console.warn('SRS 상태 로드 실패, 빈 상태로 시작함', e);
        return {};
      }
    }

    function saveAll(all){
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
    }

    function getCard(hanjaChar){
      const all = loadAll();
      return all[hanjaChar] || null;
    }

    function rate(hanjaChar, rating, now){
      now = now || new Date();
      const all = loadAll();
      const existing = all[hanjaChar] || null;
      const next = computeNext(existing, rating, now);
      all[hanjaChar] = next;
      saveAll(all);
      return next;
    }

    /**
     * 안키처럼: 지금 이 카드에 대해 다시/어려움/알맞음/쉬움 각각을 눌렀을 때
     * 얼마 뒤에 다시 나오는지 미리보기 (상태 변경 없음).
     * @returns {{again:string, hard:string, good:string, easy:string}}
     */
    function previewIntervals(hanjaChar, now){
      now = now || new Date();
      const card = getCard(hanjaChar);
      const Rt = R();
      const labels = {};
      [['again',Rt.Again],['hard',Rt.Hard],['good',Rt.Good],['easy',Rt.Easy]].forEach(([key, rating])=>{
        const next = computeNext(card, rating, now);
        labels[key] = formatInterval(now, next.due);
      });
      return labels;
    }

    function buildDailyQueue(scopeData, newLimit, now){
      now = now || new Date();
      const all = loadAll();
      const today = toDateOnly(now);
      const scopeChars = new Set(scopeData.map(item => item.c));

      const review = [];
      const learnedInScope = new Set();
      Object.keys(all).forEach(char => {
        if(!scopeChars.has(char)) return;
        learnedInScope.add(char);
        const due = toDateOnly(new Date(all[char].due));
        if(due <= today){
          review.push(char);
        }
      });

      const newChars = [];
      for(const item of scopeData){
        if(newChars.length >= newLimit) break;
        if(!learnedInScope.has(item.c)){
          newChars.push(item.c);
        }
      }

      const byChar = {};
      scopeData.forEach(item => { byChar[item.c] = item; });

      return {
        review: review.map(c => byChar[c]).filter(Boolean),
        new: newChars.map(c => byChar[c]).filter(Boolean)
      };
    }

    function stats(scopeData){
      const all = loadAll();
      const scopeChars = new Set(scopeData.map(item => item.c));
      let learned = 0, dueToday = 0;
      const today = toDateOnly(new Date());
      Object.keys(all).forEach(char => {
        if(!scopeChars.has(char)) return;
        learned++;
        if(toDateOnly(new Date(all[char].due)) <= today) dueToday++;
      });
      return { learned, dueToday, total: scopeData.length };
    }

    return { getCard, rate, previewIntervals, buildDailyQueue, stats, _loadAll: loadAll, _saveAll: saveAll };
  }

  global.HanjaSRS = { createSRS, computeNext, formatInterval };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = { createSRS, computeNext, formatInterval };
  }
})(typeof window !== 'undefined' ? window : globalThis);
