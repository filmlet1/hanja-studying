// 한자 일일 학습 - 계정 동기화 (Google 로그인 + Firebase Realtime Database)
//
// 설계: hanja-kr-srs.js는 그대로 두고(로컬 localStorage 저장, 이미 테스트됨),
// 이 파일은 그 위에 "클라우드 동기화" 레이어를 얹는다.
// - 로그인 시: 로컬 상태와 클라우드 상태를 한자별로 병합(최근 학습 시각이 더 최신인 쪽을 채택)
// - 이후 매 rate() 호출마다: 로컬 저장은 그대로 하고, 추가로 클라우드에도 그 한자 하나만 비동기로 반영
//
// window.HanjaSync 로 노출됨. firebase(compat SDK), HanjaSRS(hanja-kr-srs.js)가 먼저 로드되어 있어야 함.

(function(global){
  'use strict';

  /**
   * 로컬(localStorage)과 클라우드 상태를 한자 단위로 병합.
   * 각 한자마다 last_review가 더 최근인 쪽을 채택. (한쪽에만 있으면 그쪽을 그대로 채택)
   * (테스트를 위해 모듈 최상위로 분리)
   */
  function mergeStates(localAll, cloudAll){
    const merged = {};
    const allChars = new Set([...Object.keys(localAll), ...Object.keys(cloudAll)]);
    allChars.forEach(char => {
      const l = localAll[char];
      const c = cloudAll[char];
      if(l && c){
        merged[char] = (new Date(l.last_review) >= new Date(c.last_review)) ? l : c;
      } else {
        merged[char] = l || c;
      }
    });
    return merged;
  }

  function createSync(database, localSrs){
    let currentUser = null;
    let authReadyCallbacks = [];

    function cloudRef(uid){
      return database.ref(`users/${uid}/srs`);
    }

    /**
     * 로그인 직후 1회 실행: 로컬<->클라우드 병합 후 양쪽에 동일하게 반영.
     */
    function syncOnLogin(uid){
      return cloudRef(uid).once('value').then(snapshot => {
        const cloudAll = snapshot.val() || {};
        const localAll = localSrs._loadAll();
        const merged = mergeStates(localAll, cloudAll);
        localSrs._saveAll(merged);
        return cloudRef(uid).set(merged);
      });
    }

    function pushCard(char){
      if(!currentUser) return;
      const card = localSrs.getCard(char);
      if(!card) return;
      cloudRef(currentUser.uid).child(char).set(card).catch(err => {
        console.warn('SRS 클라우드 동기화 실패 (해당 카드는 로컬엔 정상 저장됨):', err.message);
      });
    }

    function signIn(){
      const provider = new firebase.auth.GoogleAuthProvider();
      return firebase.auth().signInWithPopup(provider);
    }

    function signOutUser(){
      return firebase.auth().signOut();
    }

    function onAuthChange(cb){
      authReadyCallbacks.push(cb);
    }

    firebase.auth().onAuthStateChanged(user => {
      currentUser = user;
      if(user){
        syncOnLogin(user.uid).catch(err => console.error('SRS 동기화 실패:', err));
      }
      authReadyCallbacks.forEach(cb => cb(user));
    });

    return {
      signIn, signOut: signOutUser, onAuthChange,
      pushCard,
      getCurrentUser: () => currentUser
    };
  }

  global.HanjaSync = { createSync, mergeStates };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = { createSync, mergeStates };
  }
})(typeof window !== 'undefined' ? window : globalThis);
