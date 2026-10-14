// Interaction measurement: scripted wheel/drag rounds with the frame sampler (best-of-N), main-thread CPU per step
// (CDP Performance.ThreadTime, much less sensitive to machine load than rAF fps) and the calibration references.
import os from 'node:os';
import { sleep, median } from './util.mjs';
import { Session } from './session.mjs';

export const loadavg = () => +os.loadavg()[0].toFixed(2);

async function cdpMetrics(cdp) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
}
export async function cdpStart(s) {
  const cdp = await s.ctx.newCDPSession(s.page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  return cdp;
}

/** Scripted wheel zoom and drag pan for `ms` (wall clock), real mouse input. Returns the number of input steps sent. */
export async function drive(s, rect, ms, hardMs = 60000) {
  const cx = rect.x + rect.width * 0.4;
  const cy = rect.y + rect.height * 0.5;
  const t0 = Date.now();
  let k = 0, steps = 0;
  while (Date.now() - t0 < ms && Date.now() - t0 < hardMs) {
    const phase = k++ % 4;
    const x = cx + (k % 3) * 40, y = cy + (k % 5) * 20;
    await s.page.mouse.move(x, y);
    if (phase === 0 || phase === 2) {
      const dir = phase === 0 ? -120 : 120;
      for (let i = 0; i < 6 && Date.now() - t0 < ms; i++) {
        await s.page.mouse.wheel(0, dir);
        steps++;
        await sleep(16);
      }
    } else {
      const sign = phase === 1 ? -1 : 1;
      await s.page.mouse.down();
      await s.page.mouse.move(x + sign * 160, y + sign * 70, { steps: 10 });
      steps += 10;
      await s.page.mouse.up();
    }
  }
  return steps;
}

/** N rounds of `drive`, each with its own sampler window. */
export async function interactionRounds(s, rect, { rounds = 3, ms = 3500 } = {}) {
  const out = [];
  for (let r = 0; r < rounds; r++) {
    await s.metrics(() => window.__spikeMetrics.startSampler());
    const steps = await drive(s, rect, ms);
    const st = await s.metrics(() => window.__spikeMetrics.stopSampler());
    out.push({ ...st, steps });
  }
  return out;
}

/** Best-of-N: p5 and dropped-frame ratio are taken from the best round, because load only ever makes a round worse. */
export function summariseRounds(rounds) {
  const best = (f, pick) => pick(...rounds.map(f));
  return {
    fpsMedian: median(rounds.map((r) => r.medianFps)),
    fpsP5: best((r) => r.p5Fps, Math.max),
    fpsP5Rounds: rounds.map((r) => +r.p5Fps.toFixed(1)),
    droppedRatio: best((r) => r.slowTimeFrac, Math.min),
    droppedFrames: best((r) => r.droppedFrames, Math.min),
    maxFrameGapMs: best((r) => r.maxIntervalMs, Math.min),
    frames: rounds.reduce((a, r) => a + r.frames, 0),
    inputSteps: rounds.reduce((a, r) => a + r.steps, 0),
  };
}

/**
 * Main-thread CPU per interaction step: 24 wheel steps (zoom in, zoom out) 120 ms apart and a 20-move drag,
 * minus the idle CPU rate measured first. Capped at capMs wall time (huge trees: steps take seconds).
 */
export async function cpuProbe(s, rect, { capMs = 25000, steps = 24 } = {}) {
  const cdp = await cdpStart(s);
  const cx = rect.x + rect.width * 0.4, cy = rect.y + rect.height * 0.5;
  await s.page.mouse.move(cx, cy);
  const i0 = await cdpMetrics(cdp);
  const ti = Date.now();
  await sleep(1000);
  const i1 = await cdpMetrics(cdp);
  const idleRate = (i1.ThreadTime - i0.ThreadTime) / ((Date.now() - ti) / 1000); // cpu seconds per second
  const out = { idleCpuPctOfOneCore: +(idleRate * 100).toFixed(1) };
  // wheel
  const w0 = await cdpMetrics(cdp);
  const tw = Date.now();
  let done = 0;
  for (; done < steps && Date.now() - tw < capMs; done++) {
    await s.page.mouse.wheel(0, done < steps / 2 ? -120 : 120);
    await sleep(120);
  }
  await s.settle(300);
  const w1 = await cdpMetrics(cdp);
  const wallW = (Date.now() - tw) / 1000;
  out.wheelSteps = done;
  out.cpuWheelStepMs = done ? +Math.max(0, ((w1.ThreadTime - w0.ThreadTime - idleRate * wallW) * 1000) / done).toFixed(1) : null;
  // drag
  const d0 = await cdpMetrics(cdp);
  const td = Date.now();
  await s.page.mouse.down();
  await s.page.mouse.move(cx - 200, cy + 100, { steps: 20 });
  await s.page.mouse.up();
  await s.settle(300);
  const d1 = await cdpMetrics(cdp);
  const wallD = (Date.now() - td) / 1000;
  out.cpuDragMoveMs = +Math.max(0, ((d1.ThreadTime - d0.ThreadTime - idleRate * wallD) * 1000) / 20).toFixed(1);
  out.cpuMsPerStep = Math.max(out.cpuWheelStepMs ?? 0, out.cpuDragMoveMs);
  try {
    await cdp.detach();
  } catch {}
  return out;
}

// ------------------------------------------------------------------------------------------ calibration

const CANVAS_REF = `<!doctype html><meta charset=utf-8><body style="margin:0"><canvas id=c width=1000 height=800 style="display:block"></canvas><script>
const cv=document.getElementById('c'),ctx=cv.getContext('2d',{willReadFrequently:true});
let k=1,tx=0,ty=0,pend=false;const segs=[];let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
for(let i=0;i<3000;i++){segs.push([rnd()*1000,rnd()*800,rnd()*60-30,rnd()*60-30])}
function draw(){pend=false;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,1000,800);ctx.setTransform(k,0,0,k,tx,ty);ctx.beginPath();for(const s of segs){ctx.moveTo(s[0],s[1]);ctx.lineTo(s[0]+s[2],s[1]+s[3])}ctx.lineWidth=1/k;ctx.stroke()}
function req(){if(!pend){pend=true;requestAnimationFrame(draw)}}
addEventListener('wheel',e=>{e.preventDefault();const f=Math.exp(-e.deltaY*0.0015);tx=e.clientX-(e.clientX-tx)*f;ty=e.clientY-(e.clientY-ty)*f;k*=f;req()},{passive:false});
let d=null;addEventListener('pointerdown',e=>{d=[e.clientX,e.clientY,tx,ty]});addEventListener('pointermove',e=>{if(d){tx=d[2]+e.clientX-d[0];ty=d[3]+e.clientY-d[1];req()}});addEventListener('pointerup',()=>d=null);
draw();
let iv=[],last=0,run=false,t0=0;
function tick(t){if(!run)return;if(last)iv.push(t-last);last=t;requestAnimationFrame(tick)}
window.__spikeMetrics={startSampler(){iv=[];last=0;run=true;t0=performance.now();requestAnimationFrame(tick)},stopSampler(){const now=performance.now();run=false;if(last)iv.push(now-last);const s=iv.slice().sort((a,b)=>a-b);const sum=iv.reduce((a,b)=>a+b,0);const pc=(p)=>s[Math.min(s.length-1,Math.floor(p/100*s.length))];let acc=0,slow=s[s.length-1]||0;for(let i=s.length-1;i>=0;i--){acc+=s[i];slow=s[i];if(acc>=0.05*sum)break}
return{frames:iv.length,durationMs:now-t0,meanFps:1000/(sum/iv.length),medianFps:1000/pc(50),p5Fps:1000/slow,p5FpsByFrame:1000/pc(95),p95Fps:1000/pc(5),droppedFrames:iv.filter(d=>d>25).reduce((a,d)=>a+Math.max(1,Math.round(d/16.667)-1),0),maxIntervalMs:s[s.length-1]||0,slowTimeFrac:Math.max(sum,now-t0)>0?(iv.filter(d=>d>50).reduce((a,b)=>a+b,0)+Math.max(0,now-t0-sum))/Math.max(sum,now-t0):0}}};
</script>`;

async function measureOnPage(s, rect, opts) {
  const rounds = await interactionRounds(s, rect, opts);
  const sum = summariseRounds(rounds);
  const cpu = await cpuProbe(s, rect, { capMs: 15000 });
  return { ...sum, ...cpu };
}

/** Reference measurements at the start of every run: a plain Canvas2D animation and (if built) the stub at 200 tips. */
export async function calibrate(browser, stub, log) {
  const out = { loadStart: loadavg() };
  const rect = { x: 0, y: 0, width: 1000, height: 600 };
  const ctx = await browser.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.setContent(CANVAS_REF);
    const s = new Session(page, ctx, 'about:blank', 'calibration-canvas');
    await sleep(300);
    out.canvas = { ...(await measureOnPage(s, rect, { rounds: 3, ms: 2500 })), loadavg: loadavg() };
    log(`calibration canvas: median ${out.canvas.fpsMedian.toFixed(1)} fps, best p5 ${out.canvas.fpsP5.toFixed(1)}, cpu/step ${out.canvas.cpuMsPerStep} ms (load ${out.canvas.loadavg})`);
  } catch (e) {
    out.canvas = { error: String(e.message).slice(0, 200) };
  } finally {
    await ctx.close().catch(() => {});
  }
  if (stub) {
    try {
      const b2 = new (await import('./session.mjs')).Browser(stub.url, () => {});
      b2.browser = browser.browser;
      out.stub200 = await b2.withSession('calibration-stub200', async (s) => {
        const { getEntry } = await import('./truth.mjs');
        await s.mount(getEntry('syn-yule-200'), {});
        await s.settle(300);
        const r = await s.containerRect();
        return { ...(await measureOnPage(s, r, { rounds: 3, ms: 2500 })), loadavg: loadavg() };
      }, 120000);
      log(`calibration stub@200: median ${out.stub200.fpsMedian.toFixed(1)} fps, best p5 ${out.stub200.fpsP5.toFixed(1)}, cpu/step ${out.stub200.cpuMsPerStep} ms (load ${out.stub200.loadavg})`);
    } catch (e) {
      out.stub200 = { error: String(e.message).slice(0, 200) };
    }
  } else out.stub200 = { error: 'stub is not built (spikes/stub/dist missing)' };
  out.loadEnd = loadavg();
  return out;
}
