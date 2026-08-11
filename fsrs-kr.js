// FSRS-6 (Free Spaced Repetition Scheduler) - 순수 JS 구현
//
// 출처: open-spaced-repetition/ts-fsrs (MIT License)의 핵심 수식을 그대로 포팅함.
// https://github.com/open-spaced-repetition/ts-fsrs
// https://github.com/open-spaced-repetition/fsrs4anki/wiki (알고리즘 설명)
//
// Anki의 "학습 단계(learning steps, 1분/10분 등 세부 큐잉)"는 포함하지 않음 —
// 이건 FSRS 알고리즘 자체가 아니라 Anki UI의 추가 기능이라 이 프로젝트에서는 생략하고,
// 모든 복습을 FSRS 코어 메모리 모델(안정성/난이도)로만 스케줄링함.
//
// window.FSRS 로 노출됨.

(function(global){
  'use strict';

  // FSRS-6 기본 가중치 21개 (open-spaced-repetition 공식 배포 기본값, population-average)
  const W = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542 // 마지막 값이 DECAY
  ];
  const DECAY = -W[20]; // 주의: 공식 구현체는 W[20](0.1542)의 '음수'를 decay로 씀 (부호 반전 필수)
  const S_MIN = 0.001;
  const S_MAX = 36500;

  function clamp(v, lo, hi){ return Math.min(Math.max(v, lo), hi); }
  function roundTo(v, n){ const p = Math.pow(10, n); return Math.round(v * p) / p; }

  function computeFactor(){
    return Math.exp((1 / DECAY) * Math.log(0.9)) - 1;
  }
  const FACTOR = roundTo(computeFactor(), 8);

  // R(t,S) = (1 + FACTOR * t / S) ^ DECAY  -- 망각곡선: 경과일 t, 안정성 S일 때 기억확률
  function forgettingCurve(elapsedDays, stability){
    return roundTo(Math.pow(1 + FACTOR * elapsedDays / stability, DECAY), 8);
  }

  // Rating: 1=again(다시) 2=hard(어려움) 3=good(알맞음) 4=easy(쉬움)
  const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };

  function initStability(g){
    return Math.max(W[g - 1], 0.1);
  }

  function initDifficulty(g){
    const d = W[4] - Math.exp((g - 1) * W[5]) + 1;
    return roundTo(d, 8);
  }

  function linearDamping(deltaD, oldD){
    return roundTo(deltaD * (10 - oldD) / 9, 8);
  }

  function meanReversion(init, current){
    return roundTo(W[7] * init + (1 - W[7]) * current, 8);
  }

  function nextDifficulty(d, g){
    const deltaD = -W[6] * (g - 3);
    const nextD = d + linearDamping(deltaD, d);
    return clamp(meanReversion(initDifficulty(Rating.Easy), nextD), 1, 10);
  }

  // 정답(다시 제외) 시 다음 안정성
  function nextRecallStability(d, s, r, g){
    const hardPenalty = (g === Rating.Hard) ? W[15] : 1;
    const easyBonus = (g === Rating.Easy) ? W[16] : 1;
    const val = s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
      (Math.exp((1 - r) * W[10]) - 1) * hardPenalty * easyBonus);
    return roundTo(clamp(val, S_MIN, S_MAX), 8);
  }

  // "다시"(잊어버림) 시 다음 안정성
  function nextForgetStability(d, s, r){
    const val = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
    return roundTo(clamp(val, S_MIN, S_MAX), 8);
  }

  // 하루 안에 같은 카드를 다시 복습하는 경우 (동일일 재복습)
  function nextShortTermStability(s, g){
    const sinc = Math.pow(s, -W[19]) * Math.exp(W[17] * (g - 3 + W[18]));
    const masked = (g >= Rating.Hard) ? Math.max(sinc, 1) : sinc;
    return roundTo(clamp(s * masked, S_MIN, S_MAX), 8);
  }

  /**
   * 카드 하나에 대해 리뷰 한 번을 적용한 다음 상태를 계산.
   * @param {?{stability:number, difficulty:number}} state - 현재 상태 (신규 카드는 null)
   * @param {number} elapsedDays - 마지막 복습 이후 지난 일수 (신규 카드는 0)
   * @param {number} rating - Rating.Again/Hard/Good/Easy
   * @returns {{stability:number, difficulty:number, retrievability:?number}}
   */
  function nextState(state, elapsedDays, rating){
    if(elapsedDays < 0) throw new Error('elapsedDays는 0 이상이어야 합니다: ' + elapsedDays);
    if(rating < 1 || rating > 4) throw new Error('유효하지 않은 rating: ' + rating);

    // 신규 카드 (첫 리뷰)
    if(!state){
      return {
        stability: initStability(rating),
        difficulty: clamp(initDifficulty(rating), 1, 10),
        retrievability: null
      };
    }

    const d = state.difficulty, s = state.stability;
    const r = forgettingCurve(elapsedDays, s);

    let newS;
    if(elapsedDays === 0){
      // 같은 날 재복습
      newS = nextShortTermStability(s, rating);
    } else if(rating === Rating.Again){
      const sAfterFail = nextForgetStability(d, s, r);
      const nextSMin = s / Math.exp(W[17] * W[18]);
      newS = clamp(roundTo(nextSMin, 8), S_MIN, sAfterFail);
    } else {
      newS = nextRecallStability(d, s, r, rating);
    }

    const newD = nextDifficulty(d, rating);
    return { stability: newS, difficulty: newD, retrievability: r };
  }

  /**
   * 안정성으로부터 다음 복습까지의 간격(일)을 계산.
   * @param {number} stability
   * @param {number} requestRetention - 목표 기억 유지율 (기본 0.9 = 90%)
   */
  function nextInterval(stability, requestRetention){
    requestRetention = requestRetention || 0.9;
    const intervalModifier = roundTo((Math.pow(requestRetention, 1 / DECAY) - 1) / FACTOR, 8);
    return Math.max(1, Math.round(stability * intervalModifier));
  }

  global.FSRS = {
    Rating, W, DECAY, FACTOR,
    forgettingCurve, initStability, initDifficulty, nextDifficulty,
    nextRecallStability, nextForgetStability, nextShortTermStability,
    nextState, nextInterval
  };

  // Node.js에서 테스트할 수 있도록 CommonJS export도 지원
  if(typeof module !== 'undefined' && module.exports){
    module.exports = global.FSRS;
  }
})(typeof window !== 'undefined' ? window : globalThis);
