// 时间轴：两种模式
//   steps     几何浏览：离散快照年（values 数组 + 索引滑杆）
//   continuous 族群分布：连续年份（min..max 整数滑杆，播放按步长推进）
// 标签（年份格式 + 时期名）由 main 通过 describe 回调提供。

import { fmtYear, type Lang } from './i18n';

export type TimelineMode = 'steps' | 'continuous';

export interface TimelineApi {
  buildSteps(values: number[], index: number): void;
  buildContinuous(range: [number, number], value: number): void;
  update(value: number): void;
  onValue(cb: (value: number) => void): void;
  setDescribe(cb: (value: number) => { year: string; name: string }): void;
  setLang(): void;
}

export function createTimeline(root: HTMLElement): TimelineApi {
  let valueCb: ((v: number) => void) | null = null;
  let describeCb: ((v: number) => { year: string; name: string }) | null = null;
  let mode: TimelineMode = 'steps';
  let values: number[] = [];
  let range: [number, number] = [0, 0];
  let playStep = 1;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  root.innerHTML = `
    <div class="era-label">
      <div class="era-year" id="tl-year"></div>
      <div class="era-name" id="tl-name"></div>
    </div>
    <div class="slider-wrap">
      <input type="range" id="tl-range" min="0" max="0" step="1" value="0" aria-label="timeline" />
      <div class="ticks" id="tl-ticks"></div>
    </div>
    <button class="btn ghost" id="tl-play" type="button"></button>
    <span class="era-name" id="tl-note" hidden></span>
  `;

  const rangeEl = root.querySelector<HTMLInputElement>('#tl-range')!;
  const yearEl = root.querySelector<HTMLElement>('#tl-year')!;
  const nameEl = root.querySelector<HTMLElement>('#tl-name')!;
  const ticksEl = root.querySelector<HTMLElement>('#tl-ticks')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#tl-play')!;
  const noteEl = root.querySelector<HTMLElement>('#tl-note')!;

  function lang(): Lang {
    return document.documentElement.dataset.lang === 'en' ? 'en' : 'zh';
  }

  function currentValue(): number {
    const raw = Number(rangeEl.value);
    if (mode === 'steps') return values[raw] ?? range[0];
    return raw;
  }

  function paint(): void {
    const v = currentValue();
    const l = lang();
    const label = describeCb ? describeCb(v) : { year: fmtYear(v, l), name: '' };
    yearEl.textContent = label.year;
    nameEl.textContent = label.name;
  }

  function stopPlay(): void {
    playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    playBtn.textContent = lang() === 'zh' ? '播放' : 'Play';
  }

  function advance(): void {
    if (mode === 'steps') {
      const next = (Number(rangeEl.value) + 1) % values.length;
      rangeEl.value = String(next);
    } else {
      const next = Number(rangeEl.value) + playStep;
      rangeEl.value = String(next > range[1] ? range[0] : next);
    }
    paint();
    valueCb?.(currentValue());
  }

  rangeEl.addEventListener('input', () => {
    stopPlay();
    paint();
    valueCb?.(currentValue());
  });

  playBtn.addEventListener('click', () => {
    if (playing) {
      stopPlay();
      return;
    }
    playing = true;
    playBtn.textContent = lang() === 'zh' ? '暂停' : 'Pause';
    timer = setInterval(advance, 1400);
  });

  function buildTicks(tickValues: number[]): void {
    ticksEl.innerHTML = '';
    const stride = Math.max(1, Math.ceil(tickValues.length / 8));
    tickValues.forEach((v, i) => {
      if (i % stride !== 0 && i !== tickValues.length - 1) return;
      const span = document.createElement('span');
      span.textContent = String(v);
      ticksEl.appendChild(span);
    });
  }

  return {
    buildSteps(vs, index) {
      mode = 'steps';
      values = vs;
      stopPlay();
      root.classList.toggle('disabled', vs.length <= 1);
      noteEl.hidden = vs.length > 1;
      noteEl.textContent = lang() === 'zh' ? '该数据源为现代单一版本，无时间轴' : 'This source has a single modern vintage';
      rangeEl.min = '0';
      rangeEl.max = String(Math.max(vs.length - 1, 0));
      rangeEl.value = String(index);
      buildTicks(vs);
      paint();
    },
    buildContinuous([min, max], value) {
      mode = 'continuous';
      range = [min, max];
      playStep = Math.max(1, Math.round((max - min) / 120));
      stopPlay();
      root.classList.remove('disabled');
      noteEl.hidden = true;
      rangeEl.min = String(min);
      rangeEl.max = String(max);
      rangeEl.step = '1';
      rangeEl.value = String(value);
      // 刻度取整百/整五十，直观易读
      const span = max - min;
      const granularity = span > 1500 ? 500 : span > 600 ? 200 : span > 250 ? 100 : 50;
      const ticks: number[] = [];
      for (let v = Math.ceil(min / granularity) * granularity; v <= max; v += granularity) ticks.push(v);
      buildTicks(ticks.length > 0 ? ticks : [min, max]);
      paint();
    },
    update(value) {
      if (mode === 'steps') {
        const idx = values.indexOf(value);
        rangeEl.value = String(idx >= 0 ? idx : 0);
      } else {
        rangeEl.value = String(value);
      }
      paint();
    },
    onValue(cb) {
      valueCb = cb;
    },
    setDescribe(cb) {
      describeCb = cb;
      paint();
    },
    setLang() {
      stopPlay();
      paint();
    },
  };
}
