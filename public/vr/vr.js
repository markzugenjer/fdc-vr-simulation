/**
 * FDC Solo 3D — VR layer for Meta Quest 3.
 *
 * The original simulation keeps doing all the work (walking, collisions, stairs, people, the
 * ENCJ journey). This module only:
 *   1. puts the camera on a VR "rig" and keeps your head where the simulation wants the eyes,
 *   2. feeds the Quest controllers into the simulation's own movement (window.__fdc.joy / keys),
 *   3. mirrors the on-screen HTML panels (ENCJ step, subtitles, choices, menu) as 3D panels
 *      you can point at with the controller laser.
 *
 * Controls in VR
 *   Left stick      walk (where you look)      Left stick click   run
 *   Right stick     snap turn 30°              Trigger            press panel buttons
 *   A               open / close nearest door  B or Y             menu
 *   X               "Lihat adegan" (jump to the current ENCJ scene)
 */
export function setupVR(F) {
  const { THREE, renderer, scene, camera, player, keys, joy } = F;
  const $ = (id) => document.getElementById(id);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const FONT = '"DM Sans", "Poppins", system-ui, -apple-system, sans-serif';
  const GREEN = '#6f8a3c';

  // ------------------------------------------------------------------ Enter VR button
  const style = document.createElement('style');
  style.textContent = `
    #vrEnter{margin-top:8px;width:100%;background:${GREEN};color:#fff;border:0;border-radius:999px;
      padding:12px 18px;font:600 15px ${FONT};cursor:pointer}
    #vrEnter[hidden]{display:none}
    #vrFloat{position:fixed;right:16px;bottom:16px;z-index:50;background:${GREEN};color:#fff;border:0;
      border-radius:999px;padding:10px 16px;font:600 14px ${FONT};cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}
    #vrFloat[hidden]{display:none}`;
  document.head.append(style);
  const enterBtn = document.createElement('button');
  enterBtn.id = 'vrEnter';
  enterBtn.type = 'button';
  enterBtn.textContent = 'Masuk VR (Meta Quest)';
  enterBtn.hidden = true;
  const floatBtn = document.createElement('button');
  floatBtn.id = 'vrFloat';
  floatBtn.type = 'button';
  floatBtn.textContent = 'Masuk VR';
  floatBtn.hidden = true;
  ($('card') || document.body).append(enterBtn);
  document.body.append(floatBtn);

  const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
  let session = null;
  async function enterVR() {
    if (session || !navigator.xr) return;
    try {
      session = await navigator.xr.requestSession('immersive-vr', sessionInit);
      session.addEventListener('end', () => { session = null; });
      await renderer.xr.setSession(session);
    } catch (err) {
      session = null;
      console.warn('[VR] could not start:', err);
    }
  }
  enterBtn.addEventListener('click', enterVR);
  floatBtn.addEventListener('click', enterVR);
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (!ok) return;
      enterBtn.hidden = false;
      floatBtn.hidden = false;
      if (matchMedia('(display-mode: standalone)').matches) enterVR(); // installed app: straight in
    }).catch(() => {});
    navigator.xr.addEventListener?.('sessiongranted', enterVR);
  }

  // ------------------------------------------------------------------ FPS counter
  // Shown in the VR panel, and as a small badge on a Quest or with ?fps in the address.
  const fps = { value: 0, frames: 0, t: performance.now() };
  function countFrame() {
    fps.frames++;
    const now = performance.now();
    if (now - fps.t >= 500) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.t));
      fps.frames = 0;
      fps.t = now;
      if (badge) badge.textContent = `FPS ${fps.value}`;
    }
  }
  const showBadge = window.__questPerf || new URLSearchParams(location.search).has('fps');
  let badge = null;
  if (showBadge) {
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:10px;right:10px;z-index:60;padding:4px 10px;border-radius:8px;'
      + `background:rgba(20,26,15,.8);color:#b9d77a;font:600 13px ${FONT};pointer-events:none`;
    document.body.append(badge);
    const loop = () => { if (!renderer.xr.isPresenting) countFrame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ crash safety
  // In VR, one error inside the frame loop used to stop drawing for good (a black screen).
  // The loop now catches it and keeps going (see make-vr.mjs). The error is shown at the bottom
  // of the VR panel for 20 s and remembered on the headset, so it can be reported.
  const ERR_KEY = 'fdc.vr.lastError';
  let lastError = null;
  let errCount = 0;
  function report(e, where) {
    errCount++;
    const msg = String(e?.message || e || 'unknown error').slice(0, 140);
    const at = (e?.stack || '').split('\n').find((l) => l.trim().startsWith('at '))?.trim().slice(0, 160) || '';
    const text = `${where}: ${msg}${errCount > 1 ? ` (×${errCount})` : ''}`;
    if (lastError?.text !== text) console.error('[VR]', where, e);
    lastError = { text, at: performance.now() };
    try { localStorage.setItem(ERR_KEY, JSON.stringify({ text, where: at, when: new Date().toISOString() })); } catch { /* storage blocked */ }
  }
  window.__vrOnError = (e) => report(e, 'Frame');
  window.addEventListener('error', (ev) => report(ev.error || ev.message, 'Page'));
  window.addEventListener('unhandledrejection', (ev) => report(ev.reason, 'Async'));
  try {
    const prev = JSON.parse(localStorage.getItem(ERR_KEY) || 'null');
    if (prev) console.warn('[VR] last error on this headset:', prev);
  } catch { /* storage blocked */ }

  // The Quest can reset the GPU (for example when memory runs low). Reload instead of staying black.
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    report('graphics reset by the headset', 'GPU');
    setTimeout(() => location.reload(), 2500); // if it doesn't come back by itself
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  // ------------------------------------------------------------------ rig + head tracking
  const rig = new THREE.Group();
  rig.name = 'vr-rig';
  const ui = new THREE.Group(); // panels live in world space, not on the head
  ui.name = 'vr-ui';
  let turn = 0;
  const headLocal = new THREE.Vector3();
  const prevHead = new THREE.Vector3();
  const headQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const off = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  let haveHead = false;
  let headYaw = 0;
  const xrOn = () => renderer.xr.isPresenting;
  const shadowWas = renderer.shadowMap.enabled;

  function refreshMaterials() {
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------------ headset refresh rate
  // Quest 3 can run at 72, 90 or 120 Hz. A steady rate feels better than a higher one that
  // keeps dropping, so 90 is the default; the menu lets you switch (remembered on this headset).
  const HZ_KEY = 'fdc.vr.hz';
  let targetHz = 90;
  try { targetHz = Number(localStorage.getItem(HZ_KEY)) || 90; } catch { /* storage blocked */ }
  const supportedHz = () => {
    const s = renderer.xr.getSession();
    return s?.supportedFrameRates ? [...s.supportedFrameRates].map(Math.round).filter((r) => [72, 90, 120].includes(r)) : [];
  };
  function applyHz() {
    const s = renderer.xr.getSession();
    const list = supportedHz();
    if (!s?.updateTargetFrameRate || !list.length) return;
    if (!list.includes(targetHz)) targetHz = list.includes(90) ? 90 : list[0];
    s.updateTargetFrameRate(targetHz).catch(() => {});
  }
  function cycleHz() {
    const list = supportedHz();
    if (!list.length) return;
    targetHz = list[(list.indexOf(targetHz) + 1) % list.length];
    try { localStorage.setItem(HZ_KEY, String(targetHz)); } catch { /* storage blocked */ }
    applyHz();
  }

  const mapEl = $('map');
  let mapWasHidden = true;

  renderer.xr.addEventListener('sessionstart', () => {
    applyHz();
    // the 2D mini-map can't be seen in VR but would still be redrawn every frame
    mapWasHidden = !mapEl || mapEl.classList.contains('hide');
    mapEl?.classList.add('hide');
    scene.add(rig, ui);
    rig.add(camera);
    turn = player.yaw;
    haveHead = false;
    if (F.plan) F.setPlanXR(0);
    // Shadows are the most expensive part of the scene: off in VR keeps the Quest smooth.
    // (On a Quest they are already off from the start, so no shader rebuild hitch here.)
    if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; refreshMaterials(); }
    // Prepare every material's shader now, so walking into a new room later doesn't stutter.
    try { renderer.compile(scene, camera); } catch (e) { report(e, 'Warm-up'); }
    floatBtn.hidden = true;
    menuOpen = !overlayVisible();
    showPanels();
  });
  renderer.xr.addEventListener('sessionend', () => {
    scene.attach(camera);
    camera.removeFromParent();
    scene.remove(rig, ui);
    joy.x = joy.y = 0;
    keys.ShiftLeft = false;
    if (shadowWas && !renderer.shadowMap.enabled) { renderer.shadowMap.enabled = true; refreshMaterials(); }
    if (!mapWasHidden) mapEl?.classList.remove('hide');
    floatBtn.hidden = false;
    window.dispatchEvent(new Event('resize'));
  });

  /** Runs every frame BEFORE the simulation's tick: read controllers, steer the player. */
  window.__vrPre = (dt) => {
    if (!xrOn()) return;
    countFrame();
    headLocal.copy(camera.position); // the headset pose three.js wrote at the last render
    headQ.copy(camera.quaternion);
    euler.setFromQuaternion(headQ, 'YXZ');
    headYaw = turn + euler.y;

    // Walking around your real room moves you in the clinic too (free roam only).
    if (haveHead && !F.patientMode) {
      off.copy(headLocal).sub(prevHead).setY(0).applyAxisAngle(Y_AXIS, turn);
      if (off.lengthSq() < 0.25) { player.x += off.x; player.z += off.z; }
    }
    prevHead.copy(headLocal);
    haveHead = true;

    readControllers(dt);
    player.yaw = headYaw; // the simulation walks "forward" along player.yaw: make that where you look
    updateUI(dt);
  };

  /** Runs INSIDE the tick, right after the simulation placed its camera: move the rig instead. */
  window.__vrSync = () => {
    if (!xrOn()) return;
    const desired = camera.position; // the simulation's eye position for this frame
    rig.rotation.set(0, turn, 0);
    off.copy(headLocal).applyAxisAngle(Y_AXIS, turn);
    rig.position.set(desired.x - off.x, desired.y - off.y, desired.z - off.z);
    camera.position.copy(headLocal);
    camera.quaternion.copy(headQ);
    rig.updateMatrixWorld(true);
  };

  // ------------------------------------------------------------------ controllers
  const pads = [];
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i);
    rig.add(ctrl);
    const pad = { ctrl, gamepad: null, hand: '', pressed: {}, select: false, selectEdge: false, ray: new THREE.Raycaster() };
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    pad.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xb9d77a, transparent: true, opacity: 0.9 }));
    pad.line.scale.z = 3;
    ctrl.add(pad.line);
    ctrl.addEventListener('connected', (e) => { pad.gamepad = e.data.gamepad || null; pad.hand = e.data.handedness || ''; });
    ctrl.addEventListener('disconnected', () => { pad.gamepad = null; pad.hand = ''; });
    ctrl.addEventListener('selectstart', () => { pad.select = true; pad.selectEdge = true; });
    ctrl.addEventListener('selectend', () => { pad.select = false; });
    pads.push(pad);
  }
  const padFor = (hand) => pads.find((p) => p.hand === hand && p.gamepad);
  const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  let snapReady = true;

  function edge(pad, index) {
    const now = !!pad?.gamepad?.buttons[index]?.pressed;
    const was = pad.pressed[index];
    pad.pressed[index] = now;
    return now && !was;
  }

  function readControllers() {
    const left = padFor('left');
    const right = padFor('right');
    joy.x = left ? dead(left.gamepad.axes[2] ?? 0) : 0;
    joy.y = left ? dead(left.gamepad.axes[3] ?? 0) : 0;
    keys.ShiftLeft = !!left?.gamepad.buttons[3]?.pressed; // click the stick to run

    if (right) {
      const ax = right.gamepad.axes[2] ?? 0;
      if (Math.abs(ax) > 0.7 && snapReady) { snapTurn(ax > 0 ? -1 : 1); snapReady = false; }
      if (Math.abs(ax) < 0.3) snapReady = true;
      if (edge(right, 4)) toggleNearestDoor(); // A
      if (edge(right, 5)) toggleMenu(); // B
    }
    if (left) {
      if (edge(left, 4)) $('encjGo')?.click(); // X
      if (edge(left, 5)) toggleMenu(); // Y
    }
  }

  function snapTurn(dir) {
    // turn around the head, not the rig origin, so the view doesn't slide sideways
    camera.getWorldPosition(headWorld);
    const a = dir * (Math.PI / 6);
    turn += a;
    headYaw += a;
  }

  function toggleNearestDoor() {
    if (F.patientMode || !F.playing) return;
    const d = F.nearestDoor(player.x, player.y, player.z, player.yaw);
    if (d) F.toggleDoor(d);
  }

  // ------------------------------------------------------------------ panels
  const targets = [];
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function makePanel(w, h, ppm = 900) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * ppm);
    canvas.height = Math.round(h * ppm);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.renderOrder = 1000;
    return { mesh, canvas, ctx: canvas.getContext('2d'), tex, W: canvas.width, H: canvas.height };
  }
  function makeButton(w, h, getLabel, onClick, tone = 'green') {
    const p = makePanel(w, h);
    let hover = false;
    let lastKey = '';
    p.draw = (force) => {
      const label = getLabel();
      const key = label + hover;
      if (!force && key === lastKey) return;
      lastKey = key;
      const { ctx, W, H } = p;
      ctx.clearRect(0, 0, W, H);
      rrect(ctx, 4, 4, W - 8, H - 8, H * 0.3);
      ctx.fillStyle = tone === 'green' ? (hover ? '#56702b' : GREEN) : hover ? '#eef3e3' : '#ffffff';
      ctx.fill();
      if (hover) { ctx.lineWidth = 8; ctx.strokeStyle = '#b9d77a'; ctx.stroke(); }
      ctx.fillStyle = tone === 'green' ? '#ffffff' : '#1f2a17';
      ctx.font = `600 ${Math.round(H * 0.4)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, W / 2, H * 0.53, W * 0.92);
      p.tex.needsUpdate = true;
    };
    p.mesh.userData.onClick = onClick;
    p.mesh.userData.setHover = (v) => { if (v !== hover) { hover = v; p.draw(); } };
    p.mesh.userData.panel = p;
    targets.push(p.mesh);
    p.draw(true);
    return p;
  }

  // Readers for the original page's HTML panels
  const txt = (id) => ($(id)?.textContent || '').trim().replace(/\s+/g, ' ');
  // (offsetParent is always null for position:fixed panels like #choice, so check the style instead)
  const visible = (id) => { const e = $(id); return !!e && !e.classList.contains('hide') && getComputedStyle(e).display !== 'none'; };
  const overlayVisible = () => { const o = $('overlay'); return !!o && !o.classList.contains('hide'); };
  const choiceLabel = (i) => {
    const bt = $('choiceOpts')?.querySelectorAll('button')[i];
    if (!bt) return '';
    return `${i + 1}. ${bt.textContent.replace(/^\d+/, '').trim()}`;
  };

  // HUD: room, ENCJ step, subtitles, toast + choice buttons underneath
  const hud = makePanel(0.95, 0.52);
  const hudGroup = new THREE.Group();
  hudGroup.add(hud.mesh);
  const choiceBtns = [0, 1, 2, 3].map((i) => {
    const b = makeButton(0.95, 0.085, () => choiceLabel(i), () => $('choiceOpts')?.querySelectorAll('button')[i]?.click());
    b.mesh.position.set(0, -0.32 - i * 0.1, 0.002);
    hudGroup.add(b.mesh);
    return b;
  });
  ui.add(hudGroup);

  let hudKey = '';
  function drawHud() {
    const toastOn = $('toast')?.classList.contains('on');
    const choiceOn = visible('choice');
    const data = {
      room: txt('room'),
      door: txt('doorHint'),
      phase: txt('encjPhase'),
      num: txt('encjNum'),
      act: txt('encjAct'),
      cust: txt('encjCust'),
      chips: [...($('encjChips')?.children || [])].map((c) => c.textContent.trim()).filter(Boolean),
      subs: txt('subs'),
      toast: toastOn ? txt('toast') : '',
      q: choiceOn ? txt('choiceQ') : '',
      n: choiceOn ? $('choiceOpts')?.querySelectorAll('button').length || 0 : 0,
      fps: fps.value,
      level,
      err: lastError && performance.now() - lastError.at < 20000 ? lastError.text : '',
    };
    const key = JSON.stringify(data);
    if (key === hudKey) return;
    hudKey = key;
    const { ctx, W, H } = hud;
    const pad = W * 0.045;
    ctx.clearRect(0, 0, W, H);
    rrect(ctx, 4, 4, W - 8, H - 8, 34);
    ctx.fillStyle = 'rgba(20,26,15,0.86)';
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let y = pad + 28;
    if (data.fps) {
      ctx.font = `700 24px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = data.fps >= targetHz * 0.95 ? '#9be37a' : data.fps >= targetHz * 0.8 ? '#f2d26b' : '#f28b7a';
      ctx.fillText(`FPS ${data.fps} / ${targetHz}${data.level ? `  ·  L${data.level}` : ''}`, W - pad, y);
      ctx.textAlign = 'left';
    }
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = '#b9d77a';
    ctx.fillText(data.room + (data.door ? `   ·   ${data.door}` : ''), pad, y, W - pad * 2 - 250);
    y += 52;
    if (data.act) {
      ctx.font = `600 26px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(`${data.phase}   ${data.num}`, pad, y, W - pad * 2);
      y += 44;
      ctx.font = `700 36px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      for (const line of wrap(ctx, data.act, W - pad * 2).slice(0, 2)) { ctx.fillText(line, pad, y); y += 44; }
      ctx.font = `500 28px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(data.cust, pad, y, W - pad * 2);
      y += 40;
      if (data.chips.length) {
        ctx.font = `600 22px ${FONT}`;
        let x = pad;
        for (const c of data.chips) {
          const w = ctx.measureText(c).width + 28;
          rrect(ctx, x, y - 26, w, 36, 18);
          ctx.fillStyle = 'rgba(185,215,122,0.22)';
          ctx.fill();
          ctx.fillStyle = '#dcebb8';
          ctx.fillText(c, x + 14, y);
          x += w + 10;
        }
        y += 46;
      }
    }
    const said = data.q || data.subs || data.toast;
    if (said) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(pad, y - 12, W - pad * 2, 2);
      y += 30;
      ctx.font = `${data.q ? 700 : 500} 30px ${FONT}`;
      ctx.fillStyle = data.q ? '#ffe9a8' : '#ffffff';
      for (const line of wrap(ctx, said, W - pad * 2).slice(0, 3)) { ctx.fillText(line, pad, y); y += 38; }
    }
    if (data.err) {
      // an error was caught (the app kept running) - shown so it can be photographed and reported
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = '#f28b7a';
      ctx.fillText(`⚠ ${data.err}`, pad, H - pad, W - pad * 2);
    }
    hud.tex.needsUpdate = true;
    choiceBtns.forEach((b, i) => { b.mesh.visible = i < data.n; b.draw(); });
  }

  // Menu: start buttons, scene controls, exit
  const menuGroup = new THREE.Group();
  const menuHead = makePanel(0.9, 0.2);
  menuGroup.add(menuHead.mesh);
  const loadingText = () => { const s = $('start'); return s?.disabled ? s.textContent.trim() : ''; };
  const menuItems = [
    ['Jadi pasien', () => $('startPatient')?.click(), 'green'],
    ['Jalan-jalan bebas', () => $('start')?.click(), 'green'],
    [() => ($('resume') && !$('resume').classList.contains('hide') ? 'Lanjutkan' : ''), () => $('resume')?.click(), 'light'],
    ['Lihat adegan ENCJ', () => { $('encjGo')?.click(); closeMenu(); }, 'light'],
    [() => txt('encjSpeed') || 'Kecepatan', () => $('encjSpeed')?.click(), 'light'],
    ['Siang / malam', () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n' })), 'light'],
    [() => (supportedHz().length > 1 ? `Refresh rate: ${targetHz} Hz` : ''), cycleHz, 'light'],
    ['Keluar dari VR', () => session?.end(), 'light'],
  ].map(([label, fn, tone]) => {
    const get = typeof label === 'function' ? label : () => label;
    const b = makeButton(0.9, 0.1, get, () => { fn(); if (tone === 'green' || get() === 'Lanjutkan') closeMenu(); }, tone);
    menuGroup.add(b.mesh);
    b.get = get;
    return b;
  });
  ui.add(menuGroup);

  function drawMenuHead() {
    const { ctx, W, H } = menuHead;
    ctx.clearRect(0, 0, W, H);
    rrect(ctx, 4, 4, W - 8, H - 8, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillStyle = GREEN;
    ctx.fillText('fdc', 34, H * 0.62);
    ctx.font = `700 32px ${FONT}`;
    ctx.fillStyle = '#1f2a17';
    ctx.fillText('Dental Clinic · Solo — VR', 170, H * 0.47);
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = '#5d6650';
    ctx.fillText(loadingText() || 'Tombol B / Y: buka atau tutup menu', 170, H * 0.78);
    menuHead.tex.needsUpdate = true;
  }
  let menuKey = '';
  function layoutMenu() {
    const key = loadingText() + menuItems.map((b) => b.get()).join('|');
    if (key === menuKey) return;
    menuKey = key;
    drawMenuHead();
    let y = -0.17;
    const loading = !!loadingText();
    for (const b of menuItems) {
      const label = b.get();
      const show = !!label && !(loading && (label === 'Jadi pasien' || label === 'Jalan-jalan bebas'));
      b.mesh.visible = show;
      if (show) { b.mesh.position.set(0, y, 0.002); y -= 0.115; b.draw(true); }
    }
  }

  let menuOpen = true;
  function toggleMenu() { menuOpen = !menuOpen; showPanels(); placeNow = true; }
  function closeMenu() { menuOpen = false; showPanels(); }
  function showPanels() {
    menuGroup.visible = menuOpen;
    hudGroup.visible = !menuOpen;
    placeNow = true;
  }

  // Panels float in front of you and follow lazily when you turn away (comfortable, never head-locked).
  let placeNow = true;
  const fwd = new THREE.Vector3();
  const want = new THREE.Vector3();
  function follow(group, dist, drop, dt) {
    camera.getWorldPosition(headWorld);
    fwd.set(-Math.sin(headYaw), 0, -Math.cos(headYaw));
    want.copy(headWorld).addScaledVector(fwd, dist);
    want.y = headWorld.y - drop;
    const toPanel = group.position.clone().sub(headWorld).setY(0).normalize();
    const angle = toPanel.angleTo(fwd);
    if (placeNow || angle > 0.7 || group.position.distanceTo(want) > 1.6) group.userData.moving = true;
    if (group.userData.moving) {
      group.position.lerp(want, placeNow ? 1 : Math.min(1, dt * 4));
      if (group.position.distanceTo(want) < 0.02) group.userData.moving = false;
    }
    group.lookAt(headWorld.x, group.position.y, headWorld.z);
  }

  // ------------------------------------------------------------------ distance culling + auto quality
  // Far people and small far props (plants, chairs, bottles...) are skipped when drawing. They keep
  // moving; only the drawing stops. Uses a render layer the camera doesn't see, so it never fights
  // the simulation's own show/hide.
  // The distances shrink automatically when the headset can't hold its refresh rate, and grow
  // back when it has room again. Level 0 = full detail.
  const LEVELS = [
    { people: 14, props: 26 },
    { people: 10, props: 18 },
    { people: 7, props: 12 },
    { people: 5, props: 8 },
  ];
  let level = 0;
  const HIDDEN_LAYER = 5;
  let people = [];
  let props = [];
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  function collect() {
    people = [];
    props = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) { people.push(o); return; }
      if (o.isInstancedMesh) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      o.getWorldScale(_s);
      const r = g.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z);
      if (r > 0 && r < 1.2) props.push(o); // small things only: walls and floors always stay
    });
    // the VR panels, buttons and controllers are never culled
    const mine = new Set();
    rig.traverse((o) => mine.add(o));
    ui.traverse((o) => mine.add(o));
    props = props.filter((o) => !mine.has(o));
  }
  function hide(o, far) {
    if (far && !o.userData.vrCulled) { o.userData.vrCulled = o.layers.mask; o.layers.set(HIDDEN_LAYER); }
    else if (!far && o.userData.vrCulled) { o.layers.mask = o.userData.vrCulled; o.userData.vrCulled = 0; }
  }
  let cullT = 0;
  let collectT = 0;
  function cullFar(dt) {
    cullT -= dt;
    collectT -= dt;
    if (cullT > 0) return;
    cullT = 0.25;
    if (collectT <= 0) { collectT = 5; collect(); } // people and props can be added while you play
    camera.getWorldPosition(headWorld);
    const L = LEVELS[level];
    const pf = L.people * L.people;
    const sf = L.props * L.props;
    for (const o of people) hide(o, _p.setFromMatrixPosition(o.matrixWorld).distanceToSquared(headWorld) > pf);
    for (const o of props) {
      const bs = o.geometry.boundingSphere;
      hide(o, _p.copy(bs.center).applyMatrix4(o.matrixWorld).distanceToSquared(headWorld) > sf);
    }
  }
  function uncullAll() {
    scene.traverse((o) => { if (o.userData?.vrCulled) { o.layers.mask = o.userData.vrCulled; o.userData.vrCulled = 0; } });
    people = []; props = []; collectT = 0;
  }
  renderer.xr.addEventListener('sessionend', uncullAll);

  // Auto quality: every 2 s compare the frame rate with the target.
  let qT = 0, qFrames = 0, goodFor = 0, settleT = 3; // ignore the first 3 s (loading, shader warm-up)
  function autoQuality(dt) {
    qT += dt; qFrames++;
    if (qT < 2) return;
    const avg = qFrames / qT;
    qT = 0; qFrames = 0;
    if (settleT > 0) { settleT -= 2; return; }
    if (avg < targetHz * 0.9 && level < LEVELS.length - 1) { level++; goodFor = 0; cullT = 0; }
    else if (avg >= targetHz * 0.97) {
      goodFor += 2;
      if (goodFor >= 10 && level > 0) { level--; goodFor = 0; cullT = 0; } // 10 s steady → a bit more detail
    } else goodFor = 0;
  }
  renderer.xr.addEventListener('sessionstart', () => { level = 0; settleT = 3; goodFor = 0; qT = 0; qFrames = 0; });

  let pollT = 0;
  function updateUI(dt) {
    cullFar(dt);
    autoQuality(dt);
    if (overlayVisible() && !menuOpen) { menuOpen = true; showPanels(); }
    pollT -= dt;
    if (pollT <= 0) {
      pollT = 0.15;
      if (menuGroup.visible) layoutMenu();
      if (hudGroup.visible) drawHud();
    }
    if (menuGroup.visible) follow(menuGroup, 1.25, 0.05, dt);
    if (hudGroup.visible) follow(hudGroup, 1.2, 0.42, dt);
    placeNow = false;
    pointers();
  }

  // Laser pointers: hover + trigger to click
  const rot = new THREE.Matrix4();
  let hovered = new Set();
  function pointers() {
    const live = targets.filter((m) => m.visible && m.parent?.visible);
    const now = new Set();
    for (const p of pads) {
      if (!p.gamepad) { p.line.visible = false; continue; }
      p.line.visible = true;
      rot.identity().extractRotation(p.ctrl.matrixWorld);
      p.ray.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
      p.ray.ray.direction.set(0, 0, -1).applyMatrix4(rot);
      const hit = p.ray.intersectObjects(live, false)[0];
      p.line.scale.z = hit ? hit.distance : 3;
      if (hit) {
        now.add(hit.object);
        if (p.selectEdge) hit.object.userData.onClick?.();
      }
      p.selectEdge = false;
    }
    for (const m of hovered) if (!now.has(m)) m.userData.setHover?.(false);
    for (const m of now) m.userData.setHover?.(true);
    hovered = now;
  }

  console.info('[VR] ready');
  return { enterVR, rig, menu: menuGroup, hud: hudGroup, get menuOpen() { return menuOpen; } };
}
