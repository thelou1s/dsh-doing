/**
 * dsh-doing v1.4 —— 思考中循环「滴」声，出结果即停；等待用户确认时循环「滴滴」两声。
 *
 * 浏览器端：
 *   - conversation 状态 running === true 时按配置间隔循环提示音
 *   - 会话出现待处理交互（approval / question，即 pendingInteraction）时
 *     循环播放「滴滴」两声（120ms 响 + 140ms 间隔），请求处理完即停，
 *     期间 doing 提示音让位，避免两套声音叠加
 *   - 设置 → dsh-doing 区块：音量（两种提示音共用）、doing 间隔、等待确认时的重播间隔
 */
window.__ModuleLoader__.load({
  id: 'dsh-doing',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const MIN_INTERVAL = 0.5;
    const MAX_INTERVAL = 5.0;
    const BEEP_FREQ = 880;
    const BEEP_MS = 120;
    /** 待确认提示音：两声之间的静音间隔（毫秒） */
    const ALERT_GAP_MS = 140;

    let config = { intervalSec: 1.2, volume: 0.08, alertIntervalSec: 1.5 };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const intervalMs = () => clamp(Number(config.intervalSec) || 1.2, MIN_INTERVAL, MAX_INTERVAL) * 1000;
    const alertIntervalMs = () => clamp(Number(config.alertIntervalSec) || 1.5, MIN_INTERVAL, MAX_INTERVAL) * 1000;
    const gainValue = () => clamp(Number(config.volume) || 0, 0, 1);

    async function refreshConfig() {
      try {
        const res = await fetch('/dsh-doing/config', { cache: 'no-store' });
        if (!res.ok) return;
        const next = await res.json();
        if (next && typeof next === 'object') {
          config = {
            intervalSec: Number(next.intervalSec) || 1.2,
            volume: next.volume === undefined ? 0.08 : Number(next.volume),
            alertIntervalSec: Number(next.alertIntervalSec) || 1.5,
          };
        }
      } catch {
        /* 沿用旧值 */
      }
    }

    // ---------- 音频 ----------
    let audioCtx = null;
    function ensureContext() {
      if (audioCtx !== null) return audioCtx;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor === undefined) return null;
      try {
        audioCtx = new Ctor();
      } catch {
        audioCtx = null;
      }
      return audioCtx;
    }
    function unlockAudio() {
      const ctx = ensureContext();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
    window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

    /**
     * 播放一声「滴」。
     * @param at 起始时间（AudioContext 时钟，秒）；省略则立即播放
     */
    function beep(at) {
      const ctx = ensureContext();
      if (ctx === null) return;
      const g0 = gainValue();
      if (g0 <= 0) return;
      const now = at === undefined ? ctx.currentTime : Math.max(at, ctx.currentTime);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(BEEP_FREQ, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(g0, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_MS / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + BEEP_MS / 1000 + 0.02);
    }

    /** 需要用户确认时的「滴滴」两声：音色、音量与 doing 提示音完全一致。 */
    function alertBeep() {
      const ctx = ensureContext();
      if (ctx === null) return;
      const g = gainValue();
      if (g <= 0) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      beep(t0);
      beep(t0 + (BEEP_MS + ALERT_GAP_MS) / 1000);
    }

    let holders = 0;
    let timer = null;
    function tick() {
      beep();
      timer = window.setTimeout(tick, intervalMs());
    }
    function startBeeping() {
      holders += 1;
      if (timer !== null) return;
      tick();
    }
    function stopBeeping() {
      holders = Math.max(0, holders - 1);
      if (holders > 0) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    // ---------- 等待用户确认：循环「滴滴」 ----------
    let alertTimer = null;
    function alertTick() {
      alertBeep();
      alertTimer = window.setTimeout(alertTick, alertIntervalMs());
    }
    function startAlerting() {
      if (alertTimer !== null) return;
      alertTick();
    }
    function stopAlerting() {
      if (alertTimer === null) return;
      window.clearTimeout(alertTimer);
      alertTimer = null;
    }

    // ---------- 状态 ----------
    function selectRunning(snapshot, sessionId) {
      if (snapshot === undefined || snapshot === null) return false;
      if (sessionId !== undefined) {
        const entry = typeof snapshot.get === 'function' ? snapshot.get(sessionId) : undefined;
        return entry !== undefined && entry !== null && entry.running === true;
      }
      let running = false;
      if (typeof snapshot.forEach === 'function') {
        snapshot.forEach((entry) => {
          if (entry !== undefined && entry !== null && entry.running === true) running = true;
        });
      }
      return running;
    }

    /**
     * 取出待处理交互对象（approval 请求 / 提问都走 uiSession 的 pendingInteraction）。
     * 返回对象本身而非布尔值：请求被新的一个替换时引用会变，便于只对新请求响一次。
     */
    function selectPending(snapshot, sessionId) {
      if (snapshot === undefined || snapshot === null) return undefined;
      if (sessionId !== undefined) {
        const entry = typeof snapshot.get === 'function' ? snapshot.get(sessionId) : undefined;
        return entry === undefined || entry === null ? undefined : entry.pendingInteraction;
      }
      let pending;
      if (typeof snapshot.forEach === 'function') {
        snapshot.forEach((entry) => {
          if (pending === undefined && entry !== undefined && entry !== null && entry.pendingInteraction) {
            pending = entry.pendingInteraction;
          }
        });
      }
      return pending;
    }

    function Doing(props) {
      const useSessionStatus = props.useSessionStatus;
      const sessionId = props.sessionId;
      const pending = typeof useSessionStatus === 'function'
        ? useSessionStatus((snapshot) => selectPending(snapshot, sessionId))
        : undefined;
      const waiting = pending !== undefined && pending !== null;
      const running = typeof useSessionStatus === 'function'
        ? useSessionStatus((snapshot) => selectRunning(snapshot, sessionId))
        : false;

      // doing 提示音：仅在跑、且不在等用户确认时响（等待期间由「滴滴」接管，避免两套声音叠在一起）
      React.useEffect(() => {
        if (!running || waiting) return undefined;
        startBeeping();
        return () => stopBeeping();
      }, [running, waiting]);

      // 等待用户确认：循环「滴滴」直到请求被处理
      React.useEffect(() => {
        if (!waiting) return undefined;
        startAlerting();
        return () => stopAlerting();
      }, [waiting]);


      return null;
    }

    // ---------- 图标（"do"） ----------
    function DoingIcon(props) {
      const size = props && props.size ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 2, y: 2, width: 60, height: 60, rx: 14, fill: '#3b82f6' }),
        h('text', {
          x: 32, y: 41, 'text-anchor': 'middle',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          fontSize: 26, fontWeight: 700, fill: '#ffffff',
        }, 'do'));
    }

    // ---------- 设置区块 ----------
    const cardStyle = { padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 };
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 10 };
    const labelStyle = { width: 140, flex: '0 0 auto', opacity: 0.85 };
    const valueStyle = { width: 64, opacity: 0.9, fontVariantNumeric: 'tabular-nums' };
    const btnStyle = {
      padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,.4)',
      background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer',
    };

    function Settings() {
      const intervalBox = React.useState(1.2);
      const volumeBox = React.useState(8);   // UI 用 0–100 的百分比，保存时换算回 0–1
      const alertBox = React.useState(1.5);
      const statusBox = React.useState('');

      React.useEffect(() => {
        let alive = true;
        fetch('/dsh-doing/config', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : undefined))
          .then((j) => {
            if (!alive || j === undefined) return;
            intervalBox[1](Number(j.intervalSec) || 1.2);
            volumeBox[1](Math.round((j.volume === undefined ? 0.08 : Number(j.volume)) * 100));
            alertBox[1](Number(j.alertIntervalSec) || 1.5);
          })
          .catch(() => {});
        return () => { alive = false; };
      }, []);

      const save = () => {
        const body = JSON.stringify({
          intervalSec: intervalBox[0],
          volume: Math.round(Number(volumeBox[0])) / 100,
          alertIntervalSec: alertBox[0],
        });
        fetch('/dsh-doing/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
          .then((r) => r.json())
          .then((j) => {
            statusBox[1](j && j.saved ? 'Saved' : 'Applied (not persisted)');
            refreshConfig();
          })
          .catch(() => statusBox[1]('Save failed'));
      };

      return h('div', { style: cardStyle },
        h('div', { style: { opacity: 0.85 } }, 'Doing alert / Confirm alert'),
        h('div', { style: rowStyle },
          h('span', { style: labelStyle }, 'Alert volume'),
          h('input', {
            type: 'range', min: 0, max: 100, step: 1,
            value: volumeBox[0],
            onChange: (e) => volumeBox[1](Number(e.target.value)),
            style: { flex: 1, maxWidth: 260 },
          }),
          h('span', { style: valueStyle }, Math.round(Number(volumeBox[0])) + '%')),
        h('div', { style: rowStyle },
          h('span', { style: labelStyle }, 'Doing interval(s)'),
          h('input', {
            type: 'range', min: MIN_INTERVAL, max: MAX_INTERVAL, step: 0.1,
            value: intervalBox[0],
            onChange: (e) => intervalBox[1](Number(e.target.value)),
            style: { flex: 1, maxWidth: 260 },
          }),
          h('span', { style: valueStyle }, Number(intervalBox[0]).toFixed(1) + 's')),
        h('div', { style: rowStyle },
          h('span', { style: labelStyle }, 'Confirm interval(s)'),
          h('input', {
            type: 'range', min: MIN_INTERVAL, max: MAX_INTERVAL, step: 0.1,
            value: alertBox[0],
            onChange: (e) => alertBox[1](Number(e.target.value)),
            style: { flex: 1, maxWidth: 260 },
          }),
          h('span', { style: valueStyle }, Number(alertBox[0]).toFixed(1) + 's')),
        h('div', { style: { ...rowStyle, gap: 12 } },
          h('button', { type: 'button', style: btnStyle, onClick: save }, 'Save'),
          h('button', {
            type: 'button', style: btnStyle,
            onClick: () => { unlockAudio(); beep(); },
          }, 'Preview'),
          h('button', {
            type: 'button', style: btnStyle,
            onClick: () => { unlockAudio(); alertBeep(); },
          }, 'Preview confirm'),
          h('span', { style: { opacity: 0.7 } }, statusBox[0])));
    }

    // 配置：启动即读，之后每 5 秒同步一次
    refreshConfig();
    window.setInterval(refreshConfig, 5000);

    return {
      inject: ['slots'],
      apply(ctx) {
        if (ctx.slots === undefined) return;
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-doing',
          order: 999,
          inject: () => ({}),
        }, Doing));

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'dsh-doing',
        }, DoingIcon));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-doing',
          order: 60,
          label: () => 'dsh-doing',
          inject: () => ({}),
        }, Settings));
      },
    };
  },
});
