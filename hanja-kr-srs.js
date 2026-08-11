// 한자 일일 학습(SRS) - 상태 저장 및 큐 빌더
// fsrs-kr.js가 먼저 로드되어 있어야 함 (window.FSRS 사용)
//
// 저장 구조 (localStorage key: 'hanja-kr-srs-v1'):
// { "校": { stability, difficulty, due: <ISO 날짜 문자열>, reps, lapses, last_review: <ISO> }, ... }
//
// 설계 포인트: 상태는 "한자 자체"를 키로 저장하므로, 어떤 급수 범위를 학습하든
// 이미 상태가 있는 한자는 자동으로 "신규"에서 제외되고 복습 큐로만 들어감.
// (급수 데이터 자체에 중복 한자가 없기 때문에 별도 급수 필터링 로직이 필요 없음)

(function(global){
  'use strict';

  const STORAGE_KEY = 'hanja-kr-srs-v1';
  const DAY_MS = 86400000;

  function toDateOnly(d){
    // 시:분:초 제거하고 날짜만 비교하기 위한 헬퍼 (로컬 자정 기준)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysBetween(a, b){
    return Math.round((toDateOnly(b) - toDateOnly(a)) / DAY_MS);
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

    /**
     * 한 한자에 대해 평가(rating)를 적용하고 상태를 저장.
     * @param {string} hanjaChar
     * @param {number} rating - FSRS.Rating.Again/Hard/Good/Easy (1~4)
     * @param {Date} now
     */
    function rate(hanjaChar, rating, now){
      now = now || new Date();
      const all = loadAll();
      const existing = all[hanjaChar];
      const prevState = existing ? { stability: existing.stability, difficulty: existing.difficulty } : null;
      const elapsedDays = existing ? Math.max(0, daysBetween(new Date(existing.last_review), now)) : 0;

      const next = global.FSRS.nextState(prevState, elapsedDays, rating);
      const intervalDays = global.FSRS.nextInterval(next.stability, 0.9);
      const due = new Date(toDateOnly(now).getTime() + intervalDays * DAY_MS);

      const reps = (existing ? existing.reps : 0) + 1;
      const lapses = (existing ? existing.lapses : 0) + (rating === global.FSRS.Rating.Again ? 1 : 0);

      all[hanjaChar] = {
        stability: next.stability,
        difficulty: next.difficulty,
        due: due.toISOString(),
        last_review: now.toISOString(),
        reps, lapses
      };
      saveAll(all);
      return all[hanjaChar];
    }

    /**
     * 오늘 학습할 큐를 만듦: 복습(기한 도래) + 신규(아직 상태 없는 한자, 개수 제한).
     * @param {Array<{c:string}>} scopeData - 신규 카드 후보 전체 목록 (보통 KR_ALL_DATA)
     * @param {number} newLimit - 하루 신규 카드 최대 개수
     * @param {Date} now
     * @returns {{review: Array, new: Array}} - 각각 scopeData의 원소(한자 데이터 객체) 배열
     */
    function buildDailyQueue(scopeData, newLimit, now){
      now = now || new Date();
      const all = loadAll();
      const today = toDateOnly(now);

      const review = [];
      const seen = new Set(); // scopeData 안에 있는 한자들만 취급 (스코프 밖 상태는 무시)
      const scopeChars = new Set(scopeData.map(item => item.c));

      Object.keys(all).forEach(char => {
        if(!scopeChars.has(char)) return; // 이 스코프에 속하지 않는 한자는 큐에서 제외
        const card = all[char];
        const due = toDateOnly(new Date(card.due));
        if(due <= today){
          review.push(char);
        }
        seen.add(char);
      });

      const newChars = [];
      for(const item of scopeData){
        if(newChars.length >= newLimit) break;
        if(!seen.has(item.c)){
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

    return { getCard, rate, buildDailyQueue, stats, _loadAll: loadAll, _saveAll: saveAll };
  }

  global.HanjaSRS = { createSRS };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = { createSRS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
