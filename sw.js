// @ts-check
/// <reference lib="webworker" />
/**
 * 서비스 워커 — 오프라인 실행과 기기 알림.
 * 빌드할 때 `build/service-worker-plugin.ts`가 PRECACHE·VERSION 자리를 채워 `dist/sw.js`로 낸다.
 * 앱 코드와 묶지 않는 순수 JS라 앱과 함께 쓰는 이름(캐시·메시지·태그)은 `src/pwa/pwa-constants.ts`와
 * 같아야 한다(`pwa-constants.test.ts`가 확인).
 *
 * 캐시 전략: 빌드 결과물 전체를 설치 때 미리 받아 두고(precache) 항상 캐시에서 준다.
 * 파일 이름에 해시가 있고 index.html도 같은 묶음이라 새 배포와 섞이지 않는다.
 * 새 버전은 sw.js 내용이 바뀌어 새 워커가 설치되고, 앱이 사용자에게 새로고침을 묻는다(SKIP_WAITING).
 */

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

/** @type {string[]} 빌드 결과물 경로(scope 기준 상대) */
const PRECACHE = ["assets/AchievementEditorPage-CSkrmST4.js","assets/AchievementIcon-C62ss-P4.css","assets/AchievementIcon-DCMrJ01F.js","assets/AchievementPicker-Co5-VQeO.css","assets/AchievementPicker-Ct3YyQQ2.js","assets/Button-D4ImU9wU.js","assets/Button-DT0SpAag.css","assets/GoalDetailPage-BEmXD0zU.js","assets/GoalEditorPage-DaH3SPSO.js","assets/GoalsPage-ag-o5ZcE.js","assets/PeerLinkPage-_nSprIlY.js","assets/PeerSyncPanel-B47I_LN7.css","assets/PeerSyncPanel-CJg0PT7j.js","assets/ProgressBar-Ccoz8VRe.js","assets/ProgressBar-CvDkaVav.css","assets/Section-CIH2LqpD.css","assets/Section-KxHwL3A3.js","assets/SettingsPage-BLcPPuNx.css","assets/SettingsPage-BjrAxWrx.js","assets/StatsPage-BIHvlYp1.css","assets/StatsPage-C1Iccz2W.js","assets/achievement-source-CWf6HuRi.js","assets/achievement-source-bExAeD5L.css","assets/categories-Dj62gNb4.js","assets/createLucideIcon-C_Pp-Thv.js","assets/custom-DREdzau2.js","assets/date-Cu8KwEML.js","assets/format-CKa8hEJS.js","assets/goal-D8WFNMQF.js","assets/index-B2-PimIm.css","assets/index-Cgdtsmxv.js","assets/jsQR-moY_pGiY.js","assets/lib-DcvPmCp3.js","assets/plus-D7hXWuqu.js","assets/preload-helper-CRzLMJPS.js","assets/rarity-Bx5qd32v.js","assets/rolldown-runtime-CbXtAM7H.js","assets/use-goals-B_wWnbm_.css","assets/use-goals-rcW_D5c2.js","favicon.svg","icons/apple-touch-icon.png","icons/badge-96.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","manifest.webmanifest"];
const VERSION = "2e47a010a971";

const PRECACHE_PREFIX = 'las-precache-';
const PRECACHE_NAME = `${PRECACHE_PREFIX}${VERSION}`;
const REMINDER_CACHE = 'las-reminders';
const SCHEDULE_PATH = 'reminder-schedule.json';
const NOTIFIED_PATH = 'reminder-notified.json';
const REMINDER_SYNC_TAG = 'las-reminders';
const MSG_SKIP_WAITING = 'SKIP_WAITING';
const MSG_CHECK_REMINDERS = 'CHECK_REMINDERS';
const NOTIFICATION_TAG = 'las-reminder';
const INDEX = 'index.html';

const scoped = (/** @type {string} */ path) => new URL(path, sw.registration.scope).href;

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PRECACHE_NAME).then((cache) => cache.addAll(PRECACHE.map(scoped))));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PRECACHE_PREFIX) && name !== PRECACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  // 해시 라우터라 문서 요청은 모두 같은 index.html
  const key = request.mode === 'navigate' ? scoped(INDEX) : url.href;
  event.respondWith(
    caches.open(PRECACHE_NAME).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
      return hit ?? fetch(request);
    }),
  );
});

sw.addEventListener('message', (event) => {
  const type = event.data && typeof event.data === 'object' ? event.data.type : undefined;
  if (type === MSG_SKIP_WAITING) void sw.skipWaiting();
  if (type === MSG_CHECK_REMINDERS) event.waitUntil(showTodayReminder());
});

sw.addEventListener('periodicsync', (event) => {
  const syncEvent = /** @type {ExtendableEvent & { tag: string }} */ (event);
  if (syncEvent.tag === REMINDER_SYNC_TAG) syncEvent.waitUntil(showTodayReminder());
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows[0];
      if (open) await open.focus();
      else await sw.clients.openWindow(scoped('./'));
    })(),
  );
});

/** 현지 날짜 YYYY-MM-DD — 앱의 dateKeyOf와 같은 형식 */
function todayKey() {
  const d = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {Cache} cache @param {string} path */
async function readJson(cache, path) {
  try {
    const res = await cache.match(scoped(path));
    return res ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 앱이 미리 계산해 둔 일정에서 오늘 몫을 하루 한 번 띄운다.
 * 앱이 화면에 떠 있으면 앱이 직접 토스트로 알리므로 건너뛴다.
 */
async function showTodayReminder() {
  if (Notification.permission !== 'granted') return;
  const windows = await sw.clients.matchAll({ type: 'window' });
  if (windows.some((client) => client.visibilityState === 'visible')) return;

  const cache = await caches.open(REMINDER_CACHE);
  const today = todayKey();
  const notified = await readJson(cache, NOTIFIED_PATH);
  if (notified?.date === today) return;
  const schedule = await readJson(cache, SCHEDULE_PATH);
  /** @type {{ date: string; title: string; body: string }[]} */
  const entries = Array.isArray(schedule?.entries) ? schedule.entries : [];
  const entry = entries.find((e) => e && e.date === today);
  if (!entry) return;

  await sw.registration.showNotification(entry.title, {
    body: entry.body,
    tag: NOTIFICATION_TAG,
    icon: scoped('icons/icon-192.png'),
    badge: scoped('icons/badge-96.png'),
    lang: 'ko',
  });
  await cache.put(scoped(NOTIFIED_PATH), Response.json({ date: today }));
}
