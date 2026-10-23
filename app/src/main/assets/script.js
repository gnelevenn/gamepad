/**
 * ============================================================================
 * XBOX VIRTUAL GAMEPAD - ENGINE INPUT VANILLA JS
 * Dirancang khusus untuk Perangkat Android Low-End (RAM 2GB, CPU Entry-Level)
 * ============================================================================
 * Fitur Utama:
 * 1. Pelacakan Multitouch Penuh (Pointer ID tracking)
 * 2. Dual Virtual Analog Joystick (L3 & R3) dengan Auto-Centering halus
 * 3. D-Pad, ABXY, Bumper (LB/RB), Trigger Progresif (LT/RT)
 * 4. Animasi & Visual Joystick didorong 100% oleh requestAnimationFrame (RAF)
 * 5. Haptic Feedback (navigator.vibrate) 10ms
 * 6. Hook Telemetri / Output Data Siap Sambung ke WebSocket atau WebRTC PC
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. STATE GAMEPAD (MODEL DATA STANDAR KONTROLER XBOX)
  // --------------------------------------------------------------------------
  const gamepadState = {
    buttons: {
      a: false,
      b: false,
      x: false,
      y: false,
      lb: false,
      rb: false,
      view: false,
      menu: false,
      xbox: false,
      share: false,
      dpadUp: false,
      dpadDown: false,
      dpadLeft: false,
      dpadRight: false,
      l3: false,
      r3: false
    },
    triggers: {
      lt: 0.0, // Nilai 0.0 s/d 1.0
      rt: 0.0  // Nilai 0.0 s/d 1.0
    },
    axes: {
      leftStickX: 0.0,  // -1.0 (kiri) s/d 1.0 (kanan)
      leftStickY: 0.0,  // -1.0 (atas) s/d 1.0 (bawah)
      rightStickX: 0.0, // -1.0 s/d 1.0
      rightStickY: 0.0  // -1.0 s/d 1.0
    },
    timestamp: Date.now()
  };

  // Konfigurasi & Pengaturan
  const config = {
    vibrateEnabled: true,
    vibrateDurationMs: 10,
    deadzone: 0.08,        // Deadzone analog joystick untuk mencegah drift
    maxStickRadius: 42,    // Radius batas gerak visual joystick (px)
    telemetryOpen: false
  };

  // Posisi Visual Joystick untuk Dikelola oleh Render Loop RAF
  const visualJoysticks = {
    left: { x: 0, y: 0, targetX: 0, targetY: 0, touchId: null },
    right: { x: 0, y: 0, targetX: 0, targetY: 0, touchId: null }
  };

  // Peta Pelacakan Sentuhan untuk Tombol (Touch ID -> Action Name)
  const activeTouches = new Map();

  // --------------------------------------------------------------------------
  // 2. CACHE ELEMEN DOM (Mencegah Query DOM Berulang Saat Game Dimainkan)
  // --------------------------------------------------------------------------
  const DOM = {
    container: document.getElementById('gamepad-container'),
    rotatePrompt: document.getElementById('rotate-prompt'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnForceFullscreen: document.getElementById('btn-force-fullscreen'),
    btnToggleVibrate: document.getElementById('toggle-vibrate'),
    vibrateIcon: document.getElementById('vibrate-icon'),
    btnToggleTelemetry: document.getElementById('toggle-telemetry'),
    telemetryPanel: document.getElementById('telemetry-panel'),

    // Joysticks
    lStickBase: document.getElementById('lstick-base'),
    lStickThumb: document.getElementById('lstick-thumb'),
    rStickBase: document.getElementById('rstick-base'),
    rStickThumb: document.getElementById('rstick-thumb'),

    // Triggers
    ltFill: document.getElementById('lt-fill'),
    rtFill: document.getElementById('rt-fill'),
    ltVal: document.getElementById('lt-val'),
    rtVal: document.getElementById('rt-val'),

    // Telemetri HUD
    hudFps: document.getElementById('hud-fps'),
    telLs: document.getElementById('tel-ls'),
    telRs: document.getElementById('tel-rs'),
    telTr: document.getElementById('tel-tr'),
    telTouch: document.getElementById('tel-touch')
  };

  // Simpan Bounding Rect Joystick untuk kalkulasi cepat tanpa reflow
  let lStickRect = { left: 0, top: 0, width: 0, height: 0, cx: 0, cy: 0 };
  let rStickRect = { left: 0, top: 0, width: 0, height: 0, cx: 0, cy: 0 };

  function updateJoystickRects() {
    if (DOM.lStickBase) {
      const b = DOM.lStickBase.getBoundingClientRect();
      lStickRect = {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2
      };
      // Sesuaikan radius dinamis berdasarkan ukuran layar
      config.maxStickRadius = (b.width / 2) * 0.72;
    }
    if (DOM.rStickBase) {
      const b = DOM.rStickBase.getBoundingClientRect();
      rStickRect = {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2
      };
    }
  }

  // --------------------------------------------------------------------------
  // 3. SISTEM HAPTIC FEEDBACK (GETARAN HP ANDROID)
  // --------------------------------------------------------------------------
  function triggerHaptic(duration) {
    if (!config.vibrateEnabled) return;
    const dur = duration || config.vibrateDurationMs;

    // Coba Web Vibration API
    if (navigator && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(dur);
      } catch (e) {
        // Abaikan jika browser membatasi getaran sebelum interaksi penuh
      }
    }

    // Dukungan Native Android Bridge jika dijalankan via WebView
    if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      try {
        window.AndroidBridge.vibrate(dur);
      } catch (e) {
        // Fallback aman
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. PENANGANAN INPUT TOMBOL DIGITAL (ABXY, DPAD, BUMPERS, AUX)
  // --------------------------------------------------------------------------
  function setButtonState(btnKey, isPressed, element) {
    if (gamepadState.buttons[btnKey] === isPressed) return;

    gamepadState.buttons[btnKey] = isPressed;

    if (isPressed) {
      triggerHaptic(config.vibrateDurationMs);
      if (element) element.classList.add('active');
    } else {
      if (element) element.classList.remove('active');
    }

    // Kirim pembaruan ke hook telemetri/output
    onGamepadStateChanged();
  }

  function setTriggerState(triggerKey, value, element) {
    const clamped = Math.max(0, Math.min(1, value));
    if (Math.abs(gamepadState.triggers[triggerKey] - clamped) < 0.01) return;

    gamepadState.triggers[triggerKey] = clamped;

    if (triggerKey === 'lt' && DOM.ltFill) {
      DOM.ltFill.style.width = `${Math.round(clamped * 100)}%`;
      if (DOM.ltVal) DOM.ltVal.textContent = `${Math.round(clamped * 100)}%`;
    } else if (triggerKey === 'rt' && DOM.rtFill) {
      DOM.rtFill.style.width = `${Math.round(clamped * 100)}%`;
      if (DOM.rtVal) DOM.rtVal.textContent = `${Math.round(clamped * 100)}%`;
    }

    if (element) {
      if (clamped > 0.05) {
        element.classList.add('active');
      } else {
        element.classList.remove('active');
      }
    }

    onGamepadStateChanged();
  }

  // --------------------------------------------------------------------------
  // 5. PENANGANAN VIRTUAL JOYSTICK MULTITOUCH (L3 & R3)
  // --------------------------------------------------------------------------
  function handleJoystickMove(which, clientX, clientY) {
    const rect = which === 'left' ? lStickRect : rStickRect;
    const visual = visualJoysticks[which];

    const dx = clientX - rect.cx;
    const dy = clientY - rect.cy;
    const distance = Math.hypot(dx, dy);
    const maxRadius = config.maxStickRadius;

    let clampedDist = distance;
    let angle = Math.atan2(dy, dx);

    if (distance > maxRadius) {
      clampedDist = maxRadius;
    }

    const visualX = Math.cos(angle) * clampedDist;
    const visualY = Math.sin(angle) * clampedDist;

    visual.targetX = visualX;
    visual.targetY = visualY;

    // Normalisasi nilai axes dari -1.0 hingga +1.0
    let normX = visualX / maxRadius;
    let normY = visualY / maxRadius;

    // Aplikasikan Deadzone matematis
    const mag = Math.hypot(normX, normY);
    if (mag < config.deadzone) {
      normX = 0;
      normY = 0;
    } else {
      const rescale = (mag - config.deadzone) / (1 - config.deadzone);
      normX = (normX / mag) * rescale;
      normY = (normY / mag) * rescale;
    }

    if (which === 'left') {
      gamepadState.axes.leftStickX = parseFloat(normX.toFixed(3));
      gamepadState.axes.leftStickY = parseFloat(normY.toFixed(3));
    } else {
      gamepadState.axes.rightStickX = parseFloat(normX.toFixed(3));
      gamepadState.axes.rightStickY = parseFloat(normY.toFixed(3));
    }

    onGamepadStateChanged();
  }

  function resetJoystick(which) {
    const visual = visualJoysticks[which];
    visual.touchId = null;
    visual.targetX = 0;
    visual.targetY = 0;

    if (which === 'left') {
      gamepadState.axes.leftStickX = 0.0;
      gamepadState.axes.leftStickY = 0.0;
      gamepadState.buttons.l3 = false;
    } else {
      gamepadState.axes.rightStickX = 0.0;
      gamepadState.axes.rightStickY = 0.0;
      gamepadState.buttons.r3 = false;
    }

    onGamepadStateChanged();
  }

  // --------------------------------------------------------------------------
  // 6. GLOBAL MULTITOUCH DISPATCHER (EFISIEN, NON-BLOCKING)
  // --------------------------------------------------------------------------
  function onTouchStart(e) {
    e.preventDefault(); // Mencegah emulasi mouse dan scrolling default Android

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!target) continue;

      // Cek apakah menyentuh Joystick Kiri
      if (DOM.lStickBase && DOM.lStickBase.contains(target)) {
        visualJoysticks.left.touchId = touch.identifier;
        handleJoystickMove('left', touch.clientX, touch.clientY);
        triggerHaptic(6);
        continue;
      }

      // Cek apakah menyentuh Joystick Kanan
      if (DOM.rStickBase && DOM.rStickBase.contains(target)) {
        visualJoysticks.right.touchId = touch.identifier;
        handleJoystickMove('right', touch.clientX, touch.clientY);
        triggerHaptic(6);
        continue;
      }

      // Cek elemen tombol dengan atribut data-input
      const btnElement = target.closest('[data-input]');
      if (btnElement) {
        const inputKey = btnElement.getAttribute('data-input');
        activeTouches.set(touch.identifier, { key: inputKey, elem: btnElement });

        if (inputKey === 'lt' || inputKey === 'rt') {
          setTriggerState(inputKey, 1.0, btnElement);
          triggerHaptic(12);
        } else {
          setButtonState(inputKey, true, btnElement);
        }
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // Update posisi Joystick Kiri
      if (visualJoysticks.left.touchId === touch.identifier) {
        handleJoystickMove('left', touch.clientX, touch.clientY);
        continue;
      }

      // Update posisi Joystick Kanan
      if (visualJoysticks.right.touchId === touch.identifier) {
        handleJoystickMove('right', touch.clientX, touch.clientY);
        continue;
      }

      // Cek apakah jari bergeser ke tombol lain (misal geser dari A ke B)
      const currentBinding = activeTouches.get(touch.identifier);
      if (currentBinding) {
        const hoveredElem = document.elementFromPoint(touch.clientX, touch.clientY);
        const hoveredBtn = hoveredElem ? hoveredElem.closest('[data-input]') : null;

        if (hoveredBtn && hoveredBtn !== currentBinding.elem) {
          // Lepas tombol lama
          if (currentBinding.key === 'lt' || currentBinding.key === 'rt') {
            setTriggerState(currentBinding.key, 0.0, currentBinding.elem);
          } else {
            setButtonState(currentBinding.key, false, currentBinding.elem);
          }

          // Tekan tombol baru
          const newKey = hoveredBtn.getAttribute('data-input');
          activeTouches.set(touch.identifier, { key: newKey, elem: hoveredBtn });

          if (newKey === 'lt' || newKey === 'rt') {
            setTriggerState(newKey, 1.0, hoveredBtn);
          } else {
            setButtonState(newKey, true, hoveredBtn);
          }
        }
      }
    }
  }

  function onTouchEndOrCancel(e) {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // Lepas Joystick Kiri
      if (visualJoysticks.left.touchId === touch.identifier) {
        resetJoystick('left');
      }

      // Lepas Joystick Kanan
      if (visualJoysticks.right.touchId === touch.identifier) {
        resetJoystick('right');
      }

      // Lepas Tombol
      const binding = activeTouches.get(touch.identifier);
      if (binding) {
        if (binding.key === 'lt' || binding.key === 'rt') {
          setTriggerState(binding.key, 0.0, binding.elem);
        } else {
          setButtonState(binding.key, false, binding.elem);
        }
        activeTouches.delete(touch.identifier);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 7. RENDER LOOP DENGAN requestAnimationFrame (GPU ACCELERATED)
  // --------------------------------------------------------------------------
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let currentFps = 60;

  function renderLoop(currentTime) {
    // 1. Interpolasi Halus & Pembaruan Transform 3D Joystick Kiri
    const left = visualJoysticks.left;
    left.x += (left.targetX - left.x) * 0.45;
    left.y += (left.targetY - left.y) * 0.45;
    if (Math.abs(left.targetX - left.x) < 0.1 && Math.abs(left.targetY - left.y) < 0.1) {
      left.x = left.targetX;
      left.y = left.targetY;
    }
    if (DOM.lStickThumb) {
      DOM.lStickThumb.style.transform = `translate3d(${left.x.toFixed(2)}px, ${left.y.toFixed(2)}px, 0)`;
    }

    // 2. Interpolasi Halus & Pembaruan Transform 3D Joystick Kanan
    const right = visualJoysticks.right;
    right.x += (right.targetX - right.x) * 0.45;
    right.y += (right.targetY - right.y) * 0.45;
    if (Math.abs(right.targetX - right.x) < 0.1 && Math.abs(right.targetY - right.y) < 0.1) {
      right.x = right.targetX;
      right.y = right.targetY;
    }
    if (DOM.rStickThumb) {
      DOM.rStickThumb.style.transform = `translate3d(${right.x.toFixed(2)}px, ${right.y.toFixed(2)}px, 0)`;
    }

    // 3. Perhitungan FPS dan Pembaruan Telemetri HUD (jika aktif)
    frameCount++;
    if (currentTime - lastFrameTime >= 1000) {
      currentFps = Math.round((frameCount * 1000) / (currentTime - lastFrameTime));
      frameCount = 0;
      lastFrameTime = currentTime;

      if (config.telemetryOpen && DOM.hudFps) {
        DOM.hudFps.textContent = `${currentFps} FPS`;
      }
    }

    if (config.telemetryOpen) {
      updateTelemetryDisplay();
    }

    requestAnimationFrame(renderLoop);
  }

  function updateTelemetryDisplay() {
    if (DOM.telLs) {
      DOM.telLs.textContent = `X: ${gamepadState.axes.leftStickX.toFixed(2)} | Y: ${gamepadState.axes.leftStickY.toFixed(2)}`;
    }
    if (DOM.telRs) {
      DOM.telRs.textContent = `X: ${gamepadState.axes.rightStickX.toFixed(2)} | Y: ${gamepadState.axes.rightStickY.toFixed(2)}`;
    }
    if (DOM.telTr) {
      DOM.telTr.textContent = `LT: ${gamepadState.triggers.lt.toFixed(2)} | RT: ${gamepadState.triggers.rt.toFixed(2)}`;
    }
    if (DOM.telTouch) {
      let count = activeTouches.size;
      if (visualJoysticks.left.touchId !== null) count++;
      if (visualJoysticks.right.touchId !== null) count++;
      DOM.telTouch.textContent = `${count} Titik`;
    }
  }

  // --------------------------------------------------------------------------
  // 8. DATA OUTPUT / INTEGRASI WEBSOCKET & WEBRTC (HOOK UNTUK PENGEMBANG)
  // --------------------------------------------------------------------------
  /**
   * Fungsi ini dipanggil setiap kali ada perubahan pada state kontroler
   * (tombol ditekan/dilepas atau analog digerakkan).
   */
  function onGamepadStateChanged() {
    gamepadState.timestamp = Date.now();

    /* ========================================================================
     * PANDUAN INTEGRASI SERVER / PC (WEBSOCKET ATAU WEBRTC):
     *
     * Contoh 1: Pengiriman via WebSocket ke PC game server (Node.js / Python):
     * if (window.gamepadSocket && window.gamepadSocket.readyState === WebSocket.OPEN) {
     *     window.gamepadSocket.send(JSON.stringify(gamepadState));
     * }
     *
     * Contoh 2: Pengiriman Binary Buffer Super Cepat (Bit-Packed XInput):
     * // Mengirim 8 byte bitmask tombol + 4 byte float axis untuk latensi <1ms
     * // window.dataChannel?.send(packGamepadData(gamepadState));
     * ======================================================================== */

    // Kirim Custom Event ke Window agar developer bisa menangkap event dari luar
    window.dispatchEvent(new CustomEvent('xbox-gamepad-input', { detail: gamepadState }));
  }

  // Ekspor API Global untuk keperluan scripting eksternal / wrapper Android
  window.XboxVirtualGamepad = {
    getState: function () {
      return Object.assign({}, gamepadState);
    },
    setVibration: function (enabled) {
      config.vibrateEnabled = !!enabled;
    },
    resetAll: function () {
      resetJoystick('left');
      resetJoystick('right');
      Object.keys(gamepadState.buttons).forEach(k => gamepadState.buttons[k] = false);
      gamepadState.triggers.lt = 0;
      gamepadState.triggers.rt = 0;
      onGamepadStateChanged();
    }
  };

  // --------------------------------------------------------------------------
  // 9. EVENT LISTENER SISTEM & KONTROL LAYAR PENUH
  // --------------------------------------------------------------------------
  function toggleFullscreen() {
    const doc = window.document;
    const docEl = doc.documentElement;

    const requestFullscreen = docEl.requestFullscreen || docEl.mozRequestFullScreen ||
                              docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
    const exitFullscreen = doc.exitFullscreen || doc.mozCancelFullScreen ||
                           doc.webkitExitFullscreen || doc.msExitFullscreen;

    if (!doc.fullscreenElement && !doc.mozFullScreenElement &&
        !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
      if (requestFullscreen) {
        requestFullscreen.call(docEl).catch(() => {});
      }
      // Coba kunci orientasi landscape jika browser mendukung Screen Orientation API
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else {
      if (exitFullscreen) {
        exitFullscreen.call(doc);
      }
    }
  }

  function initEventListeners() {
    // Event Sentuh Global
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEndOrCancel, { passive: false });
    window.addEventListener('touchcancel', onTouchEndOrCancel, { passive: false });

    // Dukungan Pointer/Mouse untuk pengujian di Browser Desktop
    let isMouseDown = false;
    window.addEventListener('mousedown', function (e) {
      isMouseDown = true;
      const target = e.target.closest('[data-input]');
      if (target) {
        const key = target.getAttribute('data-input');
        if (key === 'lt' || key === 'rt') {
          setTriggerState(key, 1.0, target);
        } else {
          setButtonState(key, true, target);
        }
      }
    });

    window.addEventListener('mouseup', function () {
      isMouseDown = false;
      document.querySelectorAll('[data-input].active').forEach(elem => {
        const key = elem.getAttribute('data-input');
        if (key === 'lt' || key === 'rt') {
          setTriggerState(key, 0.0, elem);
        } else {
          setButtonState(key, false, elem);
        }
      });
      resetJoystick('left');
      resetJoystick('right');
    });

    // Toggle Layar Penuh
    if (DOM.btnFullscreen) {
      DOM.btnFullscreen.addEventListener('click', toggleFullscreen);
    }
    if (DOM.btnForceFullscreen) {
      DOM.btnForceFullscreen.addEventListener('click', toggleFullscreen);
    }

    // Toggle Getaran
    if (DOM.btnToggleVibrate) {
      DOM.btnToggleVibrate.addEventListener('click', function () {
        config.vibrateEnabled = !config.vibrateEnabled;
        DOM.btnToggleVibrate.classList.toggle('active', config.vibrateEnabled);
        if (DOM.vibrateIcon) {
          DOM.vibrateIcon.textContent = config.vibrateEnabled ? '⚡ Getar: ON' : '⚡ Getar: OFF';
        }
        if (config.vibrateEnabled) triggerHaptic(20);
      });
    }

    // Toggle Telemetri HUD
    if (DOM.btnToggleTelemetry) {
      DOM.btnToggleTelemetry.addEventListener('click', function () {
        config.telemetryOpen = !config.telemetryOpen;
        DOM.btnToggleTelemetry.classList.toggle('active', config.telemetryOpen);
        if (DOM.telemetryPanel) {
          DOM.telemetryPanel.classList.toggle('hidden', !config.telemetryOpen);
        }
        triggerHaptic(10);
      });
    }

    // Update dimensi bounding rect saat rotasi layar atau perubahan ukuran window
    window.addEventListener('resize', updateJoystickRects);
    window.addEventListener('orientationchange', function () {
      setTimeout(updateJoystickRects, 300);
    });

    // Mencegah menu konteks klik kanan / tekan lama
    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      return false;
    });

    // Mencegah default drag pada gambar / svg
    window.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });
  }

  // --------------------------------------------------------------------------
  // 10. BOOTSTRAP INISIALISASI
  // --------------------------------------------------------------------------
  function init() {
    updateJoystickRects();
    initEventListeners();
    requestAnimationFrame(renderLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
