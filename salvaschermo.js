// --- CORE E VU METER CLASSICI ---
let globalCustomLabels = {};

function loadCustomLabels() {
    try {
        let parsed = JSON.parse(localStorage.getItem('customLabels'));
        globalCustomLabels = (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        globalCustomLabels = {};
    }
}

function getCustomLabel(modelKey, defaultName) {
    return globalCustomLabels[modelKey] && globalCustomLabels[modelKey].trim() !== "" ? globalCustomLabels[modelKey] : defaultName;
}

window.addEventListener('load', loadCustomLabels);

var idleTimer = null, randomStyleInterval = null, ssActive = false;
var camillaWs = null, pollInterval = null;
var smoothedL = 0, smoothedR = 0, smoothedSingle = 0;
var targetL = 0, targetR = 0, targetSingle = 0;
var velL = 0, velR = 0, velSingle = 0;
var animationId, bgCache = {};
var isConnectingWs = false, isStreamingActive = false;
let originalStyleBeforeSs = null;

const canvasL = document.getElementById('vuLeft'); 
const canvasR = document.getElementById('vuRight');
const ctxL = canvasL ? canvasL.getContext('2d') : null; 
const ctxR = canvasR ? canvasR.getContext('2d') : null;

if(canvasL && canvasR) {
    canvasL.width = 880; canvasL.height = 500; 
    canvasR.width = 880; canvasR.height = 500;
}

const inlineVuL = document.getElementById('inlineVuLeft'); 
const inlineVuR = document.getElementById('inlineVuRight');
const inlineVuSingle = document.getElementById('inlineVuSingle');
const inlineCtxL = inlineVuL ? inlineVuL.getContext('2d') : null; 
const inlineCtxR = inlineVuR ? inlineVuR.getContext('2d') : null;
const inlineCtxSingle = inlineVuSingle ? inlineVuSingle.getContext('2d') : null;

if(inlineVuL) {
    inlineVuL.width = 880; inlineVuL.height = 500; 
    inlineVuR.width = 880; inlineVuR.height = 500;
    inlineVuSingle.width = 880; inlineVuSingle.height = 500;
}

let audioCtx = null, localAnalyser = null, localAudioSource = null, localAnalyzerInterval = null;

function connectLocalAnalyzer() {
    let tgl = document.getElementById('localAnalyzerToggle');
    if (tgl && !tgl.checked) {
        targetL = 0; targetR = 0; targetSingle = 0;
        return;
    }
    let player = document.getElementById('localAudioPlayer');
    if (!audioCtx) {
        let AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        localAnalyser = audioCtx.createAnalyser();
        localAnalyser.fftSize = 512;
        localAnalyser.smoothingTimeConstant = 0.8;
        localAudioSource = audioCtx.createMediaElementSource(player);
        localAudioSource.connect(localAnalyser);
        localAnalyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (localAnalyzerInterval) clearInterval(localAnalyzerInterval);

    const bufferLength = localAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    localAnalyzerInterval = setInterval(() => {
        localAnalyser.getByteTimeDomainData(dataArray);
        let rms = 0;
        for (let i = 0; i < bufferLength; i++) {
            let val = (dataArray[i] - 128) / 128;
            rms += val * val;
        }
        rms = Math.sqrt(rms / bufferLength);
        let db = 20 * Math.log10(rms || 0.0001);
        let targetVal = Math.max(0, (db + 60) * (255 / 60));
        targetL = targetVal;
        targetR = targetVal * 0.95;
        targetSingle = targetVal;
    }, 30);
}

function disconnectLocalAnalyzer() {
    if (localAnalyzerInterval) {
        clearInterval(localAnalyzerInterval);
        localAnalyzerInterval = null;
    }
    if (!camillaWs) { targetL = 0; targetR = 0; targetSingle = 0; }
}

function toggleLocalStream() {
    let player = document.getElementById('localAudioPlayer');
    let btn = document.getElementById('btnLocalStream');
    let streamUrl = document.getElementById('streamUrlInput').value;

    if (!streamUrl) { alert("Imposta l'URL dello streaming HTTP nelle Impostazioni!"); return; }

    if (player.paused) {
        player.src = streamUrl + "?t=" + new Date().getTime();
        player.play().then(() => {
            btn.style.color = 'var(--hl-color)';
            btn.style.textShadow = '0 0 10px var(--hl-glow)';
            isStreamingActive = true;
            disconnectCamilla();
            connectLocalAnalyzer();
        }).catch(e => alert("Impossibile connettersi allo stream: " + e.message));
    } else {
        player.pause();
        player.src = '';
        btn.style.color = '#aaa';
        btn.style.textShadow = 'none';
        isStreamingActive = false;
        disconnectLocalAnalyzer();
        let playBtnHtml = document.getElementById('btnPlay').innerHTML || "";
        if (playBtnHtml.includes('pause-fill')) {
            connectCamilla();
        }
    }
}

function connectCamilla() {
    if (camillaWs && (camillaWs.readyState === WebSocket.OPEN || camillaWs.readyState === WebSocket.CONNECTING)) return;
    if (isConnectingWs) return;
    isConnectingWs = true;

    const uri = document.getElementById('wsUriInput').value || ("ws://" + (window.location.hostname || "127.0.0.1") + ":1234");
    try {
        camillaWs = new WebSocket(uri);
        camillaWs.onopen = () => {
            isConnectingWs = false;
            if(pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(() => {
                if (camillaWs && camillaWs.readyState === WebSocket.OPEN) {
                    camillaWs.send(JSON.stringify({"GetSignalLevels": null}));
                }
            }, 50);
        };
        camillaWs.onmessage = (event) => {
            try {
                let response = JSON.parse(event.data); 
                let cmd = response.GetSignalLevels;
                if (cmd && cmd.result === "Ok" && cmd.value && cmd.value.playback_rms) {
                    let rms = cmd.value.playback_rms; 
                    let leftDb = rms[0] !== undefined ? rms[0] : -60; 
                    let rightDb = rms[1] !== undefined ? rms[1] : leftDb;
                    targetL = Math.max(0, (leftDb + 60) * (255 / 60));
                    targetR = Math.max(0, (rightDb + 60) * (255 / 60));
                    targetSingle = Math.max(0, (Math.max(leftDb, rightDb) + 60) * (255 / 60));
                }
            } catch (e) {}
        };
        camillaWs.onclose = () => {
            isConnectingWs = false;
            if (pollInterval) clearInterval(pollInterval);
            camillaWs = null; 
            targetL = 0; targetR = 0; targetSingle = 0;

            let playBtnHtml = document.getElementById('btnPlay').innerHTML || "";
            let isPlaying = playBtnHtml.includes('pause-fill') && !isStreamingActive;
            if (isPlaying) {
                setTimeout(() => { connectCamilla(); }, 2000);
            }
        };
        camillaWs.onerror = (error) => {
            isConnectingWs = false;
            if (camillaWs) camillaWs.close();
        };
    } catch (e) {
        isConnectingWs = false;
        setTimeout(() => { connectCamilla(); }, 2000);
    }
}

function disconnectCamilla() {
    isConnectingWs = false;
    if (pollInterval) clearInterval(pollInterval);
    if (camillaWs) {
        camillaWs.onclose = null;
        camillaWs.close();
        camillaWs = null;
    }
    if(!isStreamingActive) { targetL = 0; targetR = 0; targetSingle = 0; }
}

function resetIdle() { 
    if (ssActive) return; 
    clearTimeout(idleTimer); 
    
    if (typeof currentLayoutMode !== 'undefined' && currentLayoutMode === 'mobile') return;
    
    let mins = parseFloat(document.getElementById('ssTimeout').value || '1'); 
    if (mins > 0) { 
        idleTimer = setTimeout(() => startScreensaver(false), mins * 60000); 
    } 
}

['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll', 'blur', 'focus'].forEach(evt => 
    window.addEventListener(evt, resetIdle, {passive: true})
);

function startScreensaver(force = false) {
    if (typeof currentLayoutMode !== 'undefined' && currentLayoutMode === 'mobile') {
        if(force) alert("Salvaschermo non disponibile per l'interfaccia Smartphone.");
        return;
    }
    
    if (ssActive) return; 
    let isPlaying = false; 
    let playBtnHtml = document.getElementById('btnPlay') ? document.getElementById('btnPlay').innerHTML : ""; 
    if (playBtnHtml.includes('pause-fill')) isPlaying = true;
    if (!isPlaying && !force) { resetIdle(); return; }

    let styleSelect = document.getElementById('vuStyleSelect');
    originalStyleBeforeSs = styleSelect ? styleSelect.value : 'blue_mod70';
    
    let isStream = false;
    if (window.lastPlayedFile) {
        let fUp = window.lastPlayedFile.toUpperCase();
        if (fUp.startsWith('HTTP') || fUp.startsWith('RADIO/') || fUp.startsWith('WEBRADIO/') || fUp.endsWith('.M3U') || fUp.endsWith('.PLS')) {
            isStream = true;
        }
    }

    clearTimeout(idleTimer); 
    ssActive = true;
    
    let ssOverlay = document.getElementById('screensaverOverlay');
    let textDiv = document.getElementById('ssTrackInfo');

    if (ssOverlay) {
        ssOverlay.style.display = 'flex';
    }

    if (isStream && typeof initRadioDOM === 'function') {
        isRadioScreensaverActive = true;
        let macFaceplate = ssOverlay.querySelector('.mac-faceplate');
        if(macFaceplate) macFaceplate.style.display = 'none';
        initRadioDOM(ssOverlay); 
        setTimeout(() => {
            ssOverlay.style.opacity = '1'; 
            ssOverlay.style.pointerEvents = 'auto';
        }, 10);
    } else {
        isRadioScreensaverActive = false;
        let macFaceplate = ssOverlay.querySelector('.mac-faceplate');
        if(macFaceplate) macFaceplate.style.display = 'flex';
        
        if (typeof removeRadioDOM === 'function') removeRadioDOM(); 

        if(textDiv) textDiv.style.display = ''; 
        if (canvasL) canvasL.style.display = '';
        if (canvasR) canvasR.style.display = '';

        if(typeof updateUITheme === 'function') updateUITheme(originalStyleBeforeSs);
        
        setTimeout(() => {
            ssOverlay.style.opacity = '1'; 
            ssOverlay.style.pointerEvents = 'auto'; 
        }, 10);
    }

    let randTime = parseFloat(document.getElementById('ssRandomTime').value || '0.5');
    if (randTime > 0) { 
        randomStyleInterval = setInterval(() => { changeThemeOffset(1); }, randTime * 60000); 
    }
}

// =========================================
// GESTIONE EVENTI
// =========================================
let ssControlsTimeout = null; 
const ssOver = document.getElementById('screensaverOverlay');
let pointerstartX = 0; let pointerstartY = 0;

if (ssOver) {
    ssOver.addEventListener('pointerdown', e => { 
        if (!ssActive) return;
        pointerstartX = e.clientX; 
        pointerstartY = e.clientY; 
    });
    
    ssOver.addEventListener('pointermove', e => {
        if (!ssActive) return;
        if (e.pointerType === 'mouse' && localStorage.getItem('mostraMiniPlayerSS') !== 'false') {
            showSsControls();
        }
    });

    ssOver.addEventListener('pointerup', e => {
        if (!ssActive) return;
        let deltaX = e.clientX - pointerstartX; 
        let deltaY = Math.abs(e.clientY - pointerstartY);
        
        if (Math.abs(deltaX) > 60 && deltaY < 150) { 
            changeThemeOffset(deltaX < 0 ? 1 : -1); 
        } else if (Math.abs(deltaX) < 15 && deltaY < 15) { 
            if (localStorage.getItem('mostraMiniPlayerSS') === 'false') {
                exitScreensaver();
            } else {
                toggleSsControls(); 
            }
        }
    });
}

function showSsControls() {
    let ctrl = document.getElementById('ssControlsOverlay');
    if (!ctrl) return;
    if (localStorage.getItem('mostraMiniPlayerSS') === 'false') return;

    ctrl.style.display = 'flex'; 
    setTimeout(() => {
        ctrl.style.opacity = '1';
        ctrl.style.pointerEvents = 'auto';
    }, 10);

    if(ssControlsTimeout) clearTimeout(ssControlsTimeout);
    ssControlsTimeout = setTimeout(() => {
        ctrl.style.opacity = '0';
        ctrl.style.pointerEvents = 'none';
        setTimeout(() => { ctrl.style.display = 'none'; }, 300);
    }, 5000);
}

function toggleSsControls() {
    let ctrl = document.getElementById('ssControlsOverlay');
    if (!ctrl) return;
    
    if (ctrl.style.opacity === '1') {
        ctrl.style.opacity = '0';
        ctrl.style.pointerEvents = 'none';
        if(ssControlsTimeout) clearTimeout(ssControlsTimeout);
        setTimeout(() => { ctrl.style.display = 'none'; }, 300);
    } else {
        showSsControls();
    }
}

function resetSsControlsTimer() {
    if (ssActive && localStorage.getItem('mostraMiniPlayerSS') !== 'false') {
        showSsControls();
    }
}

function exitScreensaver() {
    if (!ssActive) return; 
    ssActive = false; 
    isRadioScreensaverActive = false;
    
    let ssOverlay = document.getElementById('screensaverOverlay');
    let ssControls = document.getElementById('ssControlsOverlay');

    if (ssOverlay) {
        ssOverlay.style.transition = 'none';
        ssOverlay.style.opacity = '0'; 
        ssOverlay.style.pointerEvents = 'none';
        
        let macFaceplate = ssOverlay.querySelector('.mac-faceplate');
        if(macFaceplate) macFaceplate.style.display = 'flex';
        
        ssOverlay.style.display = 'none'; 
        setTimeout(() => { ssOverlay.style.transition = 'opacity 0.5s ease'; }, 50);
    }

    if (ssControls) {
        ssControls.style.transition = 'none';
        ssControls.style.opacity = '0';
        ssControls.style.pointerEvents = 'none';
        if(ssControlsTimeout) clearTimeout(ssControlsTimeout);
        
        ssControls.style.display = 'none';
        setTimeout(() => { ssControls.style.transition = 'opacity 0.3s ease'; }, 50);
    }
    
    if (typeof removeRadioDOM === 'function') removeRadioDOM();

    let textDiv = document.getElementById('ssTrackInfo');
    if(textDiv) textDiv.style.display = ''; 
    if (randomStyleInterval) { clearInterval(randomStyleInterval); randomStyleInterval = null; } 
    
    let canvasLeft = document.getElementById('vuLeft');
    let canvasRight = document.getElementById('vuRight');
    if (canvasLeft) canvasLeft.style.display = '';
    if (canvasRight) canvasRight.style.display = '';
    
    let keepStyleToggle = document.getElementById('keepSsStyleToggle'); 
    let keepStyle = keepStyleToggle ? keepStyleToggle.checked : false; 
    
    if (!keepStyle && typeof originalStyleBeforeSs !== 'undefined' && originalStyleBeforeSs) {
        const select = document.getElementById('vuStyleSelect');
        if (select && select.value !== originalStyleBeforeSs) {
            select.value = originalStyleBeforeSs;
            if(typeof updateUITheme === 'function') updateUITheme(originalStyleBeforeSs);
            if(typeof saveSettings === 'function') saveSettings();
        }
    }
    resetIdle();
}

function changeThemeOffset(offset) {
    const select = document.getElementById('vuStyleSelect');
    if(!select) return;
    let idx = select.selectedIndex + offset;
    if (idx >= select.options.length) idx = 0;
    if (idx < 0) idx = select.options.length - 1;
    select.selectedIndex = idx;
    
    if(typeof updateUITheme === 'function') updateUITheme(select.value);
    
    if (isRadioScreensaverActive && typeof initRadioDOM === 'function') {
        let ssOverlay = document.getElementById('screensaverOverlay');
        removeRadioDOM();
        initRadioDOM(ssOverlay);
    }
    if(typeof saveSettings === 'function') saveSettings();
}

function renderLoop() {
    let styleSelect = document.getElementById('vuStyleSelect');
    let currentStyle = styleSelect ? styleSelect.value : 'blue_mod70';

    let inl = document.getElementById('inlineVuToggle');
    let isInlineActive = false;
    if (inl && inl.checked && !ssActive) { 
        let activeTab = document.querySelector('.tab-pane.active');
        if (activeTab && activeTab.id === 'tab-nowplaying') {
            isInlineActive = true;
        }
    }

    if (ssActive || isInlineActive) {
        const spring = 0.12; 
        const friction = 0.82;
        
        velL += (targetL - smoothedL) * spring; 
        velL *= friction; 
        smoothedL += velL;
        
        velR += (targetR - smoothedR) * spring; 
        velR *= friction; 
        smoothedR += velR;
        
        velSingle += (targetSingle - smoothedSingle) * spring; 
        velSingle *= friction; 
        smoothedSingle += velSingle;

        if (ssActive && isRadioScreensaverActive && typeof updateAntiqueRadioDOM === 'function') {
            updateAntiqueRadioDOM();
        } else if (ssActive && !isRadioScreensaverActive) {
            if(ctxL) drawNeedle(ctxL, smoothedL, currentStyle);
            if(ctxR) drawNeedle(ctxR, smoothedR, currentStyle);
        } else if (isInlineActive) {
            if (typeof currentLayoutMode !== 'undefined' && currentLayoutMode === 'mobile') {
                if(inlineCtxSingle) drawNeedle(inlineCtxSingle, smoothedSingle, currentStyle);
            } else {
                if(inlineCtxL) drawNeedle(inlineCtxL, smoothedL, currentStyle);
                if(inlineCtxR) drawNeedle(inlineCtxR, smoothedR, currentStyle);
            }
        }
    }

    animationId = requestAnimationFrame(renderLoop);
}

function initScreensaverAndVU() {
    animationId = requestAnimationFrame(renderLoop);
}

// IL "PENNELLO" DEL CANVAS CON ETICHETTE DINAMICHE
function renderFaceToCtx(ctx, style, w, h, backlight) {
    let scaleRatio = w / 440;
    if (style === 'blue_mono_mod1000') {
        let bgGrad = ctx.createRadialGradient(w/2, h*0.45, 10, w/2, h*0.5, h * 1.15); 
        bgGrad.addColorStop(0, backlight ? "#2fb2ff" : "#175980"); 
        bgGrad.addColorStop(0.45, backlight ? "#1066c0" : "#083360"); 
        bgGrad.addColorStop(1, backlight ? "#05204a" : "#021025"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.62, radius = h * 1.32; 
        ctx.strokeStyle = "#ffffff"; 
        ctx.lineWidth = Math.max(1.5, w / 250); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.28, Math.PI * 1.72, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1; 
        ctx.strokeStyle = "#ffffff";
        for (let a = 1.28; a <= 1.72; a += 0.008) { 
            let isMajor = (Math.abs((a % 0.04)) < 0.002 || Math.abs((a % 0.04) - 0.04) < 0.002); 
            let tickLen = isMajor ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.fillStyle = "#ffffff"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(11 * scaleRatio)}px sans-serif`; 
        ctx.fillText("WATTS", cx, h * 0.70); 
        ctx.font = `${Math.round(10 * scaleRatio)}px sans-serif`; 
        ctx.fillText("dB", cx, h * 0.38); 
        ctx.font = `${Math.round(10 * scaleRatio)}px sans-serif`; 
        ctx.fillText("POWER OUTPUT", cx, h * 0.57);
        let mcWatts = [".012", ".12", "1.2", "12", "120", "1.2", "2.4", "4.8"]; 
        let mcWattsAngles = [1.32, 1.38, 1.44, 1.50, 1.56, 1.62, 1.67, 1.70]; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        for (let i = 0; i < mcWatts.length; i++) { 
            let ang = mcWattsAngles[i]; 
            let x = cx + (radius - (h * 0.15)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.15)) * Math.sin(Math.PI * ang); 
            if (i >= 5) { 
                ctx.save(); 
                ctx.translate(x, y); 
                ctx.rotate(0.32); 
                ctx.fillText(mcWatts[i], 0, 0); 
                ctx.restore(); 
            } else { 
                ctx.fillText(mcWatts[i], x, y); 
            } 
        }
        let mcDb = ["-50", "-40", "-30", "-20", "-10", "0"]; 
        let mcDbAngles = [1.32, 1.40, 1.48, 1.56, 1.62, 1.69]; 
        ctx.font = `${Math.round(11 * scaleRatio)}px sans-serif`;
        for (let i = 0; i < mcDb.length; i++) { 
            let ang = mcDbAngles[i]; 
            let x = cx + (radius + (h * 0.085)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius + (h * 0.085)) * Math.sin(Math.PI * ang); 
            ctx.fillText(mcDb[i], x, y); 
        }
        ctx.save(); 
        let vignette = ctx.createRadialGradient(w/2, h/2, h*0.4, w/2, h/2, w*0.7); 
        vignette.addColorStop(0, "rgba(0,0,0,0)"); 
        vignette.addColorStop(1, "rgba(0,0,0,0.4)"); 
        ctx.fillStyle = vignette; 
        ctx.fillRect(0, 0, w, h); 
        ctx.beginPath(); 
        ctx.moveTo(0, 0); 
        ctx.lineTo(w, 0); 
        ctx.lineTo(w, h * 0.35); 
        ctx.quadraticCurveTo(w / 2, h * 0.05, 0, h * 0.35); 
        ctx.closePath(); 
        let glareGrad = ctx.createLinearGradient(0, 0, 0, h * 0.35); 
        glareGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)"); 
        glareGrad.addColorStop(1, "rgba(255, 255, 255, 0.0)"); 
        ctx.fillStyle = glareGrad; 
        ctx.fill(); 
        ctx.lineWidth = 0.5; 
        ctx.strokeStyle = "rgba(255,255,255,0.03)"; 
        for(let i=0; i<h; i+=4) { 
            ctx.beginPath(); 
            ctx.moveTo(0, i); 
            ctx.lineTo(w, i); 
            ctx.stroke(); 
        } 
        ctx.restore(); 
        return;
    }
    if (style === 'light_meter_mod88') {
        let bgGrad = ctx.createLinearGradient(0, 0, 0, h); 
        bgGrad.addColorStop(0, backlight ? "#e8dcca" : "#555044"); 
        bgGrad.addColorStop(0.65, backlight ? "#d5c6ab" : "#444036"); 
        bgGrad.addColorStop(0.75, backlight ? "#c2b296" : "#333028"); 
        bgGrad.addColorStop(1, backlight ? "#eedfc4" : "#60584c"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 1; 
        ctx.strokeStyle = backlight ? "#444" : "#222"; 
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = (Math.abs((a % 0.03)) < 0.005) ? h*0.09 : h*0.04; 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = backlight ? "#333" : "#666"; 
        ctx.textAlign = "center"; 
        let topV = ["0.0001", "0.001", "0.01", "0.1", "1", "10", "100", "200", "300"]; 
        let topA = [1.35, 1.385, 1.42, 1.46, 1.50, 1.54, 1.58, 1.615, 1.65]; 
        ctx.font = `${Math.round(11*scaleRatio)}px sans-serif`; 
        for(let i=0; i<topV.length; i++) { 
            ctx.fillText(topV[i], cx + (radius - h*0.14) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.14) * Math.sin(Math.PI * topA[i])); 
        }
        let botV = ["-60", "-50", "-40", "-30", "-20", "-10", "0", "+5"]; 
        let botA = [1.38, 1.41, 1.44, 1.48, 1.52, 1.56, 1.61, 1.64]; 
        ctx.font = `${Math.round(9*scaleRatio)}px sans-serif`; 
        for(let i=0; i<botV.length; i++) { 
            ctx.fillText(botV[i], cx + (radius + h*0.04) * Math.cos(Math.PI * botA[i]), cy + (radius + h*0.04) * Math.sin(Math.PI * botA[i])); 
        }
        ctx.font = `italic ${Math.round(22*scaleRatio)}px "Brush Script MT", cursive`; 
        ctx.fillText(getCustomLabel('light_meter_mod88', "ClassicMeter"), cx, h*0.88); 
        ctx.font = `${Math.round(10*scaleRatio)}px sans-serif`; 
        ctx.fillText("watts (8Ω)", cx, h*0.72); 
        ctx.fillText("dB", cx, h*0.78);
    } else if (style === 'cyan_meter_mod88') {
        let bgGrad = ctx.createRadialGradient(w/2, h/2, 10, w/2, h/2, w); 
        bgGrad.addColorStop(0, backlight ? "#00aaff" : "#002244"); 
        bgGrad.addColorStop(1, backlight ? "#004488" : "#001122"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 1; 
        ctx.strokeStyle = "#000"; 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI*1.35, Math.PI*1.65); 
        ctx.stroke(); 
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = (Math.abs((a % 0.03)) < 0.005) ? h*0.07 : h*0.03; 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = "#000"; 
        ctx.textAlign = "center"; 
        let topV = ["3.0m", "30m", ".30", "3.0", "30", "300"]; 
        let topA = [1.35, 1.41, 1.47, 1.53, 1.59, 1.65]; 
        ctx.font = `bold ${Math.round(14*scaleRatio)}px sans-serif`; 
        for(let i=0; i<topV.length; i++) { 
            ctx.fillText(topV[i], cx + (radius - h*0.12) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.12) * Math.sin(Math.PI * topA[i])); 
        }
        let botV = ["-50", "-40", "-30", "-20", "-10", "0"]; 
        let botA = [1.37, 1.42, 1.48, 1.54, 1.60, 1.64]; 
        ctx.font = `${Math.round(10*scaleRatio)}px sans-serif`; 
        for(let i=0; i<botV.length; i++) { 
            ctx.fillText(botV[i], cx + (radius + h*0.06) * Math.cos(Math.PI * botA[i]), cy + (radius + h*0.06) * Math.sin(Math.PI * botA[i])); 
        }
        ctx.font = `${Math.round(9*scaleRatio)}px sans-serif`; 
        ctx.fillText("WATTS", cx, h*0.25); 
        ctx.fillText("dB", cx, h*0.58); 
        ctx.fillText("POWER OUTPUT", cx, h*0.75); 
        ctx.strokeStyle = "#000"; 
        ctx.lineWidth = 6; 
        ctx.strokeRect(0,0,w,h);
    } else if (style === 'neon_mod95') {
        ctx.fillStyle = "#050a0a"; 
        ctx.fillRect(0, 0, w, h); 
        if (backlight) { 
            let glow = ctx.createRadialGradient(w/2, h*0.6, 10, w/2, h*0.6, h*1.2); 
            glow.addColorStop(0, "rgba(0, 255, 200, 0.25)"); 
            glow.addColorStop(1, "rgba(0, 20, 20, 0)"); 
            ctx.fillStyle = glow; 
            ctx.fillRect(0, 0, w, h); 
        }
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = backlight ? "#00ffcc" : "#005544"; 
        if(backlight) { 
            ctx.shadowColor = "#00ffcc"; 
            ctx.shadowBlur = 10; 
        }
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = h*0.05; 
            if(a > 1.58) { 
                ctx.strokeStyle = backlight ? "#ff3366" : "#661122"; 
                if(backlight) ctx.shadowColor = "#ff3366"; 
            } 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.shadowBlur = 0; 
        ctx.fillStyle = backlight ? "#00ffcc" : "#006655"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10*scaleRatio)}px sans-serif`;
        let topV = ["-50", "-40", "-30", "-20", "-10", "-3", "0", "+3", "+5"]; 
        let topA = [1.35, 1.39, 1.43, 1.47, 1.51, 1.55, 1.59, 1.62, 1.65]; 
        for(let i=0; i<topV.length; i++) { 
            if(i >= 6) ctx.fillStyle = backlight ? "#ff3366" : "#661122"; 
            ctx.fillText(topV[i], cx + (radius - h*0.1) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.1) * Math.sin(Math.PI * topA[i])); 
        }
        ctx.strokeStyle = backlight ? "#00ffcc" : "#004433"; 
        ctx.lineWidth = 1; 
        ctx.strokeRect(w*0.05, h*0.05, w*0.9, h*0.9);
    } else if (style === 'minimal_mod00') {
        let bgGrad = ctx.createRadialGradient(w/2, h/2, h*0.1, w/2, h/2, w); 
        bgGrad.addColorStop(0, backlight ? "#333" : "#1a1a1a"); 
        bgGrad.addColorStop(1, "#0a0a0a"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = backlight ? "#fff" : "#666"; 
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = (Math.abs((a % 0.03)) < 0.005) ? h*0.08 : h*0.04; 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = backlight ? "#fff" : "#777"; 
        ctx.textAlign = "center"; 
        let topV = ["0", "0.01", "0.1", "1", "10", "100", "200"]; 
        let topA = [1.35, 1.40, 1.45, 1.50, 1.55, 1.60, 1.65]; 
        ctx.font = `bold ${Math.round(14*scaleRatio)}px sans-serif`;
        for(let i=0; i<topV.length; i++) { 
            ctx.fillText(topV[i], cx + (radius - h*0.14) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.14) * Math.sin(Math.PI * topA[i])); 
        } 
        ctx.font = `bold ${Math.round(12*scaleRatio)}px sans-serif`; 
        ctx.fillText("WATTS 8Ω", cx, h*0.75); 
        ctx.fillText("dB", cx, h*0.82);
    } else if (style === 'dark_meter_mod88') {
        let bgGrad = ctx.createLinearGradient(0, 0, 0, h); 
        bgGrad.addColorStop(0, backlight ? "#1a0a00" : "#100600"); 
        bgGrad.addColorStop(1, backlight ? "#3d1900" : "#1f0c00"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = backlight ? "#ff6600" : "#883300"; 
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = (Math.abs((a % 0.03)) < 0.005) ? h*0.08 : h*0.04; 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = backlight ? "#ff6600" : "#883300"; 
        ctx.textAlign = "center"; 
        let topV = ["0.001", "0.01", "0.1", "1", "10", "100", "200", "400", "600"]; 
        let topA = [1.35, 1.39, 1.43, 1.47, 1.51, 1.55, 1.58, 1.62, 1.65]; 
        ctx.font = `bold ${Math.round(11*scaleRatio)}px sans-serif`;
        for(let i=0; i<topV.length; i++) { 
            ctx.fillText(topV[i], cx + (radius - h*0.12) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.12) * Math.sin(Math.PI * topA[i])); 
        } 
        ctx.font = `italic ${Math.round(20*scaleRatio)}px "Brush Script MT", cursive`; 
        ctx.fillText(getCustomLabel('dark_meter_mod88', "ClassicMeter"), cx, h*0.85); 
        ctx.font = `bold ${Math.round(10*scaleRatio)}px sans-serif`; 
        ctx.fillText("POWER/WATTS 8 Ω", cx, h*0.25); 
        ctx.fillText("dB", cx, h*0.68);
    } else if (style === 'orange_mod70') {
        let bgGrad = ctx.createRadialGradient(w/2, h, 10, w/2, h/2, w); 
        bgGrad.addColorStop(0, backlight ? "#ffcc00" : "#886600"); 
        bgGrad.addColorStop(0.5, backlight ? "#ff6600" : "#883300"); 
        bgGrad.addColorStop(1, "#330000"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 1; 
        ctx.strokeStyle = "#000"; 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI*1.35, Math.PI*1.65); 
        ctx.stroke(); 
        for(let a = 1.35; a <= 1.65; a += 0.015) { 
            let tL = (Math.abs((a % 0.03)) < 0.005) ? h*0.07 : h*0.03; 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = "#000"; 
        ctx.textAlign = "center"; 
        let topV = [".01", ".1", "1", "10", "100", "170W"]; 
        let topA = [1.36, 1.42, 1.48, 1.54, 1.60, 1.64]; 
        ctx.font = `bold ${Math.round(10*scaleRatio)}px sans-serif`;
        for(let i=0; i<topV.length; i++) { 
            ctx.fillText(topV[i], cx + (radius - h*0.1) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.1) * Math.sin(Math.PI * topA[i])); 
        } 
        ctx.strokeStyle = "#000"; 
        ctx.lineWidth = 15; 
        ctx.strokeRect(0,0,w,h);
    } else if (style === 'tube_mod50') {
        ctx.fillStyle = "#050505"; 
        ctx.fillRect(0, 0, w, h); 
        let cx = w / 2, cy = h * 1.5, radius = h * 1.15; 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = backlight ? "#00aaff" : "#004466"; 
        if(backlight) { 
            ctx.shadowColor = "#00aaff"; 
            ctx.shadowBlur = 8; 
        }
        for(let a = 1.35; a <= 1.65; a += 0.02) { 
            let tL = h*0.05; 
            if(a > 1.58) { 
                ctx.strokeStyle = backlight ? "#ff3300" : "#661100"; 
                if(backlight) ctx.shadowColor = "#ff3300"; 
            } 
            ctx.beginPath(); 
            ctx.moveTo(cx + radius*Math.cos(Math.PI*a), cy + radius*Math.sin(Math.PI*a)); 
            ctx.lineTo(cx + (radius-tL)*Math.cos(Math.PI*a), cy + (radius-tL)*Math.sin(Math.PI*a)); 
            ctx.stroke(); 
        }
        ctx.shadowBlur = 0; 
        ctx.fillStyle = backlight ? "#00aaff" : "#004466"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(11*scaleRatio)}px sans-serif`;
        let topV = ["20", "10", "5", "3", "0", "3", "6"]; 
        let topA = [1.35, 1.40, 1.45, 1.50, 1.55, 1.60, 1.65]; 
        for(let i=0; i<topV.length; i++) { 
            if(i >= 5) ctx.fillStyle = backlight ? "#ff3300" : "#661100"; 
            ctx.fillText(topV[i], cx + (radius - h*0.12) * Math.cos(Math.PI * topA[i]), cy + (radius - h*0.12) * Math.sin(Math.PI * topA[i])); 
        }
        ctx.fillStyle = backlight ? "#00aaff" : "#004466"; 
        ctx.fillText("dB", cx, h*0.75); 
        ctx.beginPath(); 
        ctx.arc(cx, h*0.88, h*0.1, 0, Math.PI*2); 
        ctx.stroke();
    } else if (style === 'flat_mod00') {
        ctx.fillStyle = "#262626"; 
        ctx.fillRect(0, 0, w, h); 
        let cx = w / 2, cy = h * 2.5, radius = h * 2.0; 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = "#fff"; 
        let scaleY = h * 0.65; 
        ctx.beginPath(); 
        ctx.moveTo(w*0.1, scaleY); 
        ctx.lineTo(w*0.9, scaleY); 
        ctx.stroke(); 
        ctx.beginPath(); 
        ctx.moveTo(w*0.75, scaleY); 
        ctx.lineTo(w*0.9, scaleY); 
        ctx.strokeStyle = "#ff3333"; 
        ctx.lineWidth = 4; 
        ctx.stroke(); 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = "#fff";
        for(let i=0; i<=10; i++) { 
            let x = w*0.1 + (w*0.8/10)*i; 
            if(i >= 8) ctx.strokeStyle = "#ff3333"; 
            ctx.beginPath(); 
            ctx.moveTo(x, scaleY); 
            ctx.lineTo(x, scaleY - ((i%2==0)?h*0.08:h*0.04)); 
            ctx.stroke(); 
        }
        ctx.fillStyle = "#fff"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(12*scaleRatio)}px sans-serif`; 
        let vals = ["- 50", "40", "30", "20", "10", "5", "0", "5 +"]; 
        for(let i=0; i<vals.length; i++) { 
            let x = w*0.12 + (w*0.76/(vals.length-1))*i; 
            ctx.fillText(vals[i], x, scaleY - h*0.12); 
        }
        ctx.font = `bold ${Math.round(10*scaleRatio)}px sans-serif`; 
        let bvals = ["0", "0.01", "0.1", "1", "10", "100", "200", "%"]; 
        for(let i=0; i<bvals.length; i++) { 
            let x = w*0.12 + (w*0.76/(bvals.length-1))*i; 
            ctx.fillText(bvals[i], x, scaleY + h*0.1); 
        }
    } else if (style === 'champagne_mod73') {
        let bgGrad = ctx.createRadialGradient(w/2, h*0.5, 5, w/2, h*0.5, h * 0.95); 
        bgGrad.addColorStop(0, backlight ? "#f9f2d9" : "#7c7564"); 
        bgGrad.addColorStop(0.5, backlight ? "#e6dcbf" : "#645c4c"); 
        bgGrad.addColorStop(1, backlight ? "#c2b493" : "#4a4233"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#403825"; 
        ctx.lineWidth = 2; 
        ctx.strokeRect(3, 3, w - 6, h - 6);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = "#2b2416"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#d60000"; 
        ctx.lineWidth = Math.max(3.2, w / 160); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.02), Math.PI * 1.59, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#2b2416"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        let vValues = ["-50", "-30", "-20", "-10", "-5", "-3", "-2", "-1", "0", "+3", "+5"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.13)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.13)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.save(); 
        ctx.font = `bold ${Math.round(13 * scaleRatio)}px "Times New Roman", serif`; 
        ctx.fillStyle = "#2b2416"; 
        ctx.fillText(getCustomLabel('champagne_mod73', "CHAMPAGNE"), cx, h * 0.62); 
        ctx.font = `bold ${Math.round(14 * scaleRatio)}px sans-serif`; 
        ctx.fillText("VU", cx, h * 0.78); 
        ctx.restore();
    } else if (style === 'studio_mod77') {
        let bgGrad = ctx.createLinearGradient(0, 0, 0, h); 
        bgGrad.addColorStop(0, backlight ? "#2c2f33" : "#1a1c1e"); 
        bgGrad.addColorStop(0.5, backlight ? "#232629" : "#141618"); 
        bgGrad.addColorStop(1, backlight ? "#181a1c" : "#0d0e0f"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#111"; 
        ctx.lineWidth = 3; 
        ctx.strokeRect(3, 3, w - 6, h - 6);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = "#e0e0e0"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#ff3d00"; 
        ctx.lineWidth = Math.max(3.2, w / 160); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.02), Math.PI * 1.59, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#e0e0e0"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        let vValues = ["-20", "-10", "-7", "-5", "-3", "-2", "-1", "0", "+1", "+2", "+3"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.13)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.13)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.save(); 
        let custom77 = getCustomLabel('studio_mod77', "MASTER");
        ctx.font = `bold ${Math.round(14 * scaleRatio)}px sans-serif`; 
        ctx.fillStyle = "#00e676"; 
        ctx.fillText(custom77, cx, h * 0.62); 
        if(custom77 === "MASTER") {
            ctx.fillStyle = "#e0e0e0"; 
            ctx.font = `bold ${Math.round(12 * scaleRatio)}px sans-serif`; 
            ctx.fillText("STUDIO", cx, h * 0.78); 
        }
        ctx.restore();
    } else if (style === 'amber_mod75') {
        let bgGrad = ctx.createRadialGradient(w/2, h*0.5, 5, w/2, h*0.5, h * 0.95); 
        bgGrad.addColorStop(0, backlight ? "#332615" : "#1a130a"); 
        bgGrad.addColorStop(0.5, backlight ? "#21180d" : "#120e08"); 
        bgGrad.addColorStop(1, "#100b06"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#42321c"; 
        ctx.lineWidth = 2; 
        ctx.strokeRect(3, 3, w - 6, h - 6);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = backlight ? "#ffca28" : "#886614"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#ff3d00"; 
        ctx.lineWidth = Math.max(3.2, w / 160); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.02), Math.PI * 1.59, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = backlight ? "#ffca28" : "#886614"; 
        ctx.textAlign = "center"; 
        ctx.font = `${Math.round(10 * scaleRatio)}px sans-serif`;
        let vValues = ["-20", "-10", "-5", "-3", "-2", "-1", "0", "+1", "+2", "+3", "+5"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.13)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.13)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.save(); 
        ctx.font = `italic 300 ${Math.round(16 * scaleRatio)}px "Times New Roman", serif`; 
        ctx.fillStyle = backlight ? "#ffca28" : "#886614"; 
        ctx.fillText(getCustomLabel('amber_mod75', "Classic"), cx, h * 0.70); 
        ctx.restore();
    } else if (style === 'touch_mod15') {
        let bgGrad = ctx.createRadialGradient(w/2, h*0.5, 5, w/2, h*0.5, h * 0.95); 
        bgGrad.addColorStop(0, backlight ? "#f7fd52" : "#7b7e28"); 
        bgGrad.addColorStop(0.5, backlight ? "#e3ea28" : "#717514"); 
        bgGrad.addColorStop(1, backlight ? "#a8ae10" : "#545708"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#1a160d"; 
        ctx.lineWidth = 2; 
        ctx.strokeRect(3, 3, w - 6, h - 6);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = "#1a160d"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#d60000"; 
        ctx.lineWidth = Math.max(3.2, w / 160); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.02), Math.PI * 1.59, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#111"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        let vValues = ["20", "10", "7", "5", "3", "2", "1", "0", "1", "2", "3"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.13)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.13)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.font = `bold ${Math.round(16 * scaleRatio)}px sans-serif`; 
        ctx.fillStyle = "#111"; 
        ctx.fillText("-", w * 0.15, h * 0.70); 
        ctx.fillStyle = "#d60000"; 
        ctx.fillText("+", w * 0.85, h * 0.70);
        ctx.save(); 
        ctx.font = `italic 500 ${Math.round(12 * scaleRatio)}px "Georgia", serif`; 
        ctx.fillStyle = "#333"; 
        ctx.textAlign = "center"; 
        ctx.fillText(getCustomLabel('touch_mod15', "Touch Panel"), cx, h * 0.62); 
        ctx.font = `bold ${Math.round(15 * scaleRatio)}px sans-serif`; 
        ctx.fillStyle = "#111"; 
        ctx.fillText("VU", cx, h * 0.78); 
        ctx.restore();
    } else if (style === 'waves_mod99') {
        ctx.fillStyle = "#121212"; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#080808"; 
        ctx.lineWidth = 4; 
        ctx.strokeRect(2, 2, w - 4, h - 4);
        let boxX = w * 0.04, boxY = h * 0.08, boxW = w * 0.92, boxH = h * 0.84; 
        ctx.save(); 
        ctx.fillStyle = "#1c1c1c"; 
        ctx.fillRect(boxX, boxY, boxW, boxH);
        let innerPad = 4, winX = boxX + innerPad, winY = boxY + innerPad, winW = boxW - (innerPad * 2), winH = boxH - (innerPad * 2); 
        ctx.save(); 
        ctx.beginPath(); 
        ctx.rect(winX, winY, winW, winH); 
        ctx.clip();
        let bgGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH); 
        bgGrad.addColorStop(0, backlight ? "#eaddba" : "#807662"); 
        bgGrad.addColorStop(0.35, backlight ? "#fff1d3" : "#988c75"); 
        bgGrad.addColorStop(0.7, backlight ? "#fff8e6" : "#a89d86"); 
        bgGrad.addColorStop(1, backlight ? "#d6c5a0" : "#716752"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(winX, winY, winW, winH);
        if (backlight) { 
            let lightGrad = ctx.createRadialGradient(winX + winW/2, winY + winH, 10, winX + winW/2, winY + winH, winH * 0.95); 
            lightGrad.addColorStop(0, "rgba(255, 230, 150, 0.85)"); 
            lightGrad.addColorStop(0.6, "rgba(255, 170, 50, 0.25)"); 
            lightGrad.addColorStop(1, "rgba(200, 120, 0, 0)"); 
            ctx.fillStyle = lightGrad; 
            ctx.fillRect(winX, winY, winW, winH); 
        }
        let cx = winX + winW / 2, cy = winY + winH * 1.62, radius = winH * 1.35; 
        ctx.strokeStyle = "#1a160d"; 
        ctx.lineWidth = Math.max(1.2, w / 320); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (winH * 0.09) : (winH * 0.05); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#d60000"; 
        ctx.lineWidth = Math.max(3.2, w / 150); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (winH * 0.035), Math.PI * 1.585, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#151515"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        let vValues = ["20", "10", "7", "5", "3", "2", "1", "0", "1", "2", "3"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (winH * 0.15)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.15)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.font = `bold ${Math.round(13 * scaleRatio)}px sans-serif`; 
        ctx.fillStyle = "#111"; 
        ctx.textAlign = "left"; 
        ctx.fillText("VU", winX + winW * 0.08, winY + winH * 0.32);
        let logoY = winY + winH * 0.60; 
        ctx.fillStyle = "#151515"; 
        ctx.strokeStyle = "#151515"; 
        ctx.lineWidth = 1.5; 
        let triW = 6 * scaleRatio, triH = 8 * scaleRatio, triSpacing = 8 * scaleRatio, startTriX = cx - triSpacing;
        for (let t = 0; t < 3; t++) { 
            let tx = startTriX + (t * triSpacing); 
            ctx.beginPath(); 
            ctx.moveTo(tx - triW/2, logoY + triH); 
            ctx.lineTo(tx, logoY); 
            ctx.lineTo(tx + triW/2, logoY + triH); 
            ctx.closePath(); 
            ctx.fill(); 
        }
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(11 * scaleRatio)}px sans-serif`; 
        ctx.fillText(getCustomLabel('waves_mod99', "WAVES"), cx, logoY + triH + 14 * scaleRatio); 
        ctx.restore();
    } else if (style === 'british_mod90') {
        ctx.fillStyle = "#0c0c0c"; 
        ctx.fillRect(0, 0, w, h);
        let screwRadius = Math.max(3, w / 75), cornerOffset = Math.max(12, w / 25); 
        [[cornerOffset, cornerOffset], [w - cornerOffset, cornerOffset], [cornerOffset, h - cornerOffset], [w - cornerOffset, h - cornerOffset]].forEach(([sx, sy]) => { 
            ctx.save(); 
            let sGrad = ctx.createRadialGradient(sx-1, sy-1, 0.5, sx, sy, screwRadius); 
            sGrad.addColorStop(0, "#888"); 
            sGrad.addColorStop(0.5, "#333"); 
            sGrad.addColorStop(1, "#111"); 
            ctx.fillStyle = sGrad; 
            ctx.beginPath(); 
            ctx.arc(sx, sy, screwRadius, 0, Math.PI * 2); 
            ctx.fill(); 
            ctx.strokeStyle = "#000"; 
            ctx.lineWidth = 1; 
            ctx.stroke(); 
            ctx.restore(); 
        });
        ctx.save(); 
        ctx.beginPath(); 
        let marginX = w * 0.08, topY = h * 0.08, bottomY = h * 0.92, cornerRad = 12; 
        ctx.moveTo(marginX + cornerRad, topY); 
        ctx.lineTo(w - marginX - cornerRad, topY); 
        ctx.arcTo(w - marginX, topY, w - marginX, topY + cornerRad, cornerRad); 
        ctx.lineTo(w - marginX, bottomY - cornerRad); 
        ctx.arcTo(w - marginX, bottomY, w - marginX - cornerRad, bottomY, cornerRad); 
        let notchXCenter = w / 2, notchRadius = w * 0.18; 
        ctx.lineTo(notchXCenter + notchRadius, bottomY); 
        ctx.arc(notchXCenter, bottomY, notchRadius, 0, Math.PI, true); 
        ctx.lineTo(marginX + cornerRad, bottomY); 
        ctx.arcTo(marginX, bottomY, marginX, bottomY - cornerRad, cornerRad); 
        ctx.lineTo(marginX, topY + cornerRad); 
        ctx.arcTo(marginX, topY, marginX + cornerRad, topY, cornerRad); 
        ctx.closePath(); 
        ctx.clip();
        let bgGrad = ctx.createRadialGradient(w/2, h*0.6, 10, w/2, h*0.6, h * 0.95); 
        bgGrad.addColorStop(0, backlight ? "#ffc247" : "#7f6123"); 
        bgGrad.addColorStop(0.4, backlight ? "#f78e1e" : "#7b470f"); 
        bgGrad.addColorStop(0.85, backlight ? "#c65100" : "#632800"); 
        bgGrad.addColorStop(1, backlight ? "#802b00" : "#401500"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = "#1a0800"; 
        ctx.lineWidth = Math.max(1.5, w / 280); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1.2;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.038) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#d60000"; 
        ctx.lineWidth = Math.max(3.8, w / 130); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.015), Math.PI * 1.585, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#111"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(11 * scaleRatio)}px sans-serif`;
        let vValues = ["20", "10", "7", "5", "3", "2", "1", "0", "1", "2", "3"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.125)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.125)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.font = `bold ${Math.round(18 * scaleRatio)}px sans-serif`; 
        ctx.fillText("VU", w * 0.18, h * 0.72); 
        ctx.textAlign = "right"; 
        ctx.fillText("20SVU", w * 0.82, h * 0.72); 
        ctx.textAlign = "center"; 
        ctx.fillStyle = "#c80000"; 
        ctx.font = `italic bold ${Math.round(23 * scaleRatio)}px "Brush Script MT", cursive`; 
        ctx.fillText(getCustomLabel('british_mod90', "Console"), cx, h * 0.52); 
        ctx.restore();
    } else if (style === 'vintage_mod60') {
        let bgGrad = ctx.createLinearGradient(0, 0, 0, h); 
        bgGrad.addColorStop(0, backlight ? "#e4d5b7" : "#726a5b"); 
        bgGrad.addColorStop(0.5, backlight ? "#fbf4e2" : "#7d7a71"); 
        bgGrad.addColorStop(1, backlight ? "#c5b38a" : "#625945"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#554b35"; 
        ctx.lineWidth = 2; 
        ctx.strokeRect(4, 4, w - 8, h - 8);
        let cx = w / 2, cy = h * 1.55, radius = h * 1.25; 
        ctx.strokeStyle = "#1a160d"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.30, Math.PI * 1.70, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1;
        for (let a = 1.30; a <= 1.70; a += 0.01) { 
            let tickLen = (a % 0.05 < 0.005) ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.strokeStyle = "#cc0000"; 
        ctx.lineWidth = Math.max(3.0, w / 160); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius - (h * 0.02), Math.PI * 1.585, Math.PI * 1.70, false); 
        ctx.stroke();
        ctx.fillStyle = "#111"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(11 * scaleRatio)}px sans-serif`;
        let vValues = ["20", "10", "7", "5", "3", "2", "1", "0", "1", "2", "3"]; 
        let vAngles = [1.32, 1.38, 1.42, 1.46, 1.50, 1.53, 1.56, 1.59, 1.62, 1.65, 1.68]; 
        for (let i = 0; i < vValues.length; i++) { 
            let ang = vAngles[i]; 
            let x = cx + (radius - (h * 0.13)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.13)) * Math.sin(Math.PI * ang); 
            ctx.fillText(vValues[i], x, y); 
        }
        ctx.font = `bold ${Math.round(14 * scaleRatio)}px sans-serif`; 
        ctx.textAlign = "left"; 
        ctx.fillText("VU", w * 0.15, h * 0.35);
    } else if (style === 'vfd_mod85') {
        ctx.fillStyle = "#080808"; 
        ctx.fillRect(0, 0, w, h); 
        ctx.strokeStyle = "#1a1a1a"; 
        ctx.lineWidth = 3; 
        ctx.strokeRect(3, 3, w - 6, h - 6);
        ctx.fillStyle = "#121212"; 
        ctx.fillRect(w * 0.1, h * 0.15, w * 0.8, h * 0.7); 
        ctx.strokeStyle = "#222"; 
        ctx.lineWidth = 1; 
        ctx.strokeRect(w * 0.1, h * 0.15, w * 0.8, h * 0.7);
        ctx.fillStyle = "#00e5ff"; 
        ctx.font = `bold ${Math.round(9 * scaleRatio)}px sans-serif`; 
        ctx.textAlign = "left"; 
        ctx.fillText(getCustomLabel('vfd_mod85', "PEAK LEVEL METER"), w * 0.12, h * 0.28); 
        ctx.fillText("-30 -20  -10   -6   -3    0   +3  +6", w * 0.12, h * 0.38);
    } else {
        let bgGrad = ctx.createRadialGradient(w/2, h*0.45, 10, w/2, h*0.5, h * 1.15); 
        bgGrad.addColorStop(0, backlight ? "#2fb2ff" : "#175980"); 
        bgGrad.addColorStop(0.45, backlight ? "#1066c0" : "#083360"); 
        bgGrad.addColorStop(1, backlight ? "#05204a" : "#021025"); 
        ctx.fillStyle = bgGrad; 
        ctx.fillRect(0, 0, w, h);
        let cx = w / 2, cy = h * 1.62, radius = h * 1.32; 
        ctx.strokeStyle = "#ffffff"; 
        ctx.lineWidth = Math.max(1.2, w / 300); 
        ctx.beginPath(); 
        ctx.arc(cx, cy, radius, Math.PI * 1.28, Math.PI * 1.72, false); 
        ctx.stroke(); 
        ctx.lineWidth = 1; 
        ctx.strokeStyle = "#ffffff";
        for (let a = 1.28; a <= 1.72; a += 0.008) { 
            let isMajor = (Math.abs((a % 0.04)) < 0.002 || Math.abs((a % 0.04) - 0.04) < 0.002); 
            let tickLen = isMajor ? (h * 0.04) : (h * 0.02); 
            let x1 = cx + radius * Math.cos(Math.PI * a); 
            let y1 = cy + radius * Math.sin(Math.PI * a); 
            let x2 = cx + (radius - tickLen) * Math.cos(Math.PI * a); 
            let y2 = cy + (radius - tickLen) * Math.sin(Math.PI * a); 
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke(); 
        }
        ctx.fillStyle = "#ffffff"; 
        ctx.textAlign = "center"; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`; 
        ctx.fillText("WATTS", cx, h * 0.70); 
        ctx.font = `${Math.round(9 * scaleRatio)}px sans-serif`; 
        ctx.fillText("dB", cx, h * 0.38); 
        ctx.font = `${Math.round(9 * scaleRatio)}px sans-serif`; 
        ctx.fillText("POWER OUTPUT", cx, h * 0.57);
        let mcWatts = ["6.0m", "60m", ".60", "6.0", "60", "600", "1.2", "2.4"]; 
        let mcWattsAngles = [1.32, 1.38, 1.44, 1.50, 1.56, 1.62, 1.67, 1.70]; 
        ctx.font = `bold ${Math.round(10 * scaleRatio)}px sans-serif`;
        for (let i = 0; i < mcWatts.length; i++) { 
            let ang = mcWattsAngles[i]; 
            let x = cx + (radius - (h * 0.15)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius - (h * 0.15)) * Math.sin(Math.PI * ang); 
            if (i >= 6) { 
                ctx.save(); 
                ctx.translate(x, y); 
                ctx.rotate(0.32); 
                ctx.fillText(mcWatts[i], 0, 0); 
                ctx.restore(); 
            } else { 
                ctx.fillText(mcWatts[i], x, y); 
            } 
        }
        let mcDb = ["-50", "-40", "-30", "-20", "-10", "0"]; 
        let mcDbAngles = [1.32, 1.40, 1.48, 1.56, 1.62, 1.69]; 
        ctx.font = `${Math.round(9 * scaleRatio)}px sans-serif`;
        for (let i = 0; i < mcDb.length; i++) { 
            let ang = mcDbAngles[i]; 
            let x = cx + (radius + (h * 0.085)) * Math.cos(Math.PI * ang); 
            let y = cy + (radius + (h * 0.085)) * Math.sin(Math.PI * ang); 
            ctx.fillText(mcDb[i], x, y); 
        }
    }

    if (style !== 'vfd_mod85' && style !== 'flat_mod00') {
        ctx.save(); 
        let vignette = ctx.createRadialGradient(w/2, h/2, h*0.4, w/2, h/2, w*0.7); 
        vignette.addColorStop(0, "rgba(0,0,0,0)"); 
        vignette.addColorStop(1, "rgba(0,0,0,0.4)"); 
        ctx.fillStyle = vignette; 
        ctx.fillRect(0, 0, w, h);
        ctx.beginPath(); 
        ctx.moveTo(0, 0); 
        ctx.lineTo(w, 0); 
        ctx.lineTo(w, h * 0.35); 
        ctx.quadraticCurveTo(w / 2, h * 0.05, 0, h * 0.35); 
        ctx.closePath();
        let glareGrad = ctx.createLinearGradient(0, 0, 0, h * 0.35); 
        glareGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)"); 
        glareGrad.addColorStop(1, "rgba(255, 255, 255, 0.0)"); 
        ctx.fillStyle = glareGrad; 
        ctx.fill();
        ctx.lineWidth = 0.5; 
        ctx.strokeStyle = "rgba(255,255,255,0.03)"; 
        for(let i=0; i<h; i+=4) { 
            ctx.beginPath(); 
            ctx.moveTo(0, i); 
            ctx.lineTo(w, i); 
            ctx.stroke(); 
        } 
        ctx.restore();
    }
}

// IL "TRUCCO" DEL CACHE AGGIORNATO (Forza il ridisegno se cambi l'etichetta)
function drawFaceWithCache(ctx, style) {
    const w = ctx.canvas.width; 
    const h = ctx.canvas.height;
    let tgl = document.getElementById('backlightToggle');
    let backlight = tgl ? tgl.checked : true;
    
    loadCustomLabels(); 
    let customHash = JSON.stringify(globalCustomLabels);
    let cacheKey = style + "_" + backlight + "_" + w + "x" + h + "_" + customHash;

    if (!bgCache[cacheKey]) {
        let offCanvas = document.createElement('canvas'); 
        offCanvas.width = w; 
        offCanvas.height = h;
        let oCtx = offCanvas.getContext('2d'); 
        renderFaceToCtx(oCtx, style, w, h, backlight); 
        bgCache[cacheKey] = offCanvas;
    }
    ctx.drawImage(bgCache[cacheKey], 0, 0);
}

function drawNeedle(ctx, value, style) {
    try {
        drawFaceWithCache(ctx, style);
        const w = ctx.canvas.width; 
        const h = ctx.canvas.height; 
        let tgl = document.getElementById('backlightToggle');
        let backlight = tgl ? tgl.checked : true;
        
        if (style === 'vfd_mod85') { 
            let numSegments = 24, startX = w * 0.14, startY = h * 0.52, totalW = w * 0.72, segW = (totalW / numSegments) - 3, segH = h * 0.22; 
            let activeSegments = Math.floor((value / 255) * numSegments); 
            if (activeSegments > numSegments) activeSegments = numSegments; 
            for (let s = 0; s < numSegments; s++) { 
                let x = startX + s * (segW + 3); 
                if (s < activeSegments) { 
                    if (s < numSegments * 0.65) ctx.fillStyle = "#00e676"; 
                    else if (s < numSegments * 0.85) ctx.fillStyle = "#ffea00"; 
                    else ctx.fillStyle = "#ff1744"; 
                    ctx.shadowColor = ctx.fillStyle; 
                    ctx.shadowBlur = 8; 
                } else { 
                    ctx.fillStyle = "#18201a"; 
                    ctx.shadowBlur = 0; 
                } 
                ctx.fillRect(x, startY, segW, segH); 
            } 
            ctx.shadowBlur = 0; 
            return; 
        }

        let cx = w / 2; let cy, radius;
        if (style === 'light_meter_mod88' || style === 'cyan_meter_mod88' || style === 'neon_mod95' || style === 'minimal_mod00' || style === 'dark_meter_mod88' || style === 'orange_mod70' || style === 'tube_mod50') { 
            cy = h * 1.5; radius = h * 1.15; 
        } else if (style === 'flat_mod00') { 
            cy = h * 2.5; radius = h * 2.0; 
        } else if (style === 'british_mod90' || style === 'vintage_mod60' || style === 'touch_mod15' || style === 'champagne_mod73' || style === 'studio_mod77' || style === 'amber_mod75') { 
            cy = h * 1.55; radius = h * 1.25; 
        } else if (style === 'waves_mod99') { 
            let boxY = h * 0.08, boxH = h * 0.84, innerPad = 4, winY = boxY + innerPad, winH = boxH - (innerPad * 2); 
            cy = winY + winH * 1.62; radius = winH * 1.35; 
        } else { 
            cy = h * 1.62; radius = h * 1.32; 
        }

        let angleVal = 1.32 + (value / 255) * 0.38; 
        if (angleVal > 1.70) angleVal = 1.70;
        if(style === 'flat_mod00') { angleVal = 1.42 + (value / 255) * 0.16; }

        let needleColor = "#111111";
        if (style === 'blue_mod70' || style === 'blue_mono_mod1000' || style === 'minimal_mod00' || style === 'dark_meter_mod88') needleColor = "#f5f5f5"; 
        if (style === 'neon_mod95') needleColor = "#ff3366"; 
        if (style === 'tube_mod50') needleColor = "#ff6600"; 
        if (style === 'flat_mod00') needleColor = "#e6ddcc";

        ctx.save(); 
        ctx.lineCap = "round"; 
        ctx.shadowColor = "rgba(0, 0, 0, 0.85)"; 
        ctx.shadowBlur = Math.max(6, w / 60); 
        ctx.shadowOffsetX = 4; 
        ctx.shadowOffsetY = 6;
        
        if(style === 'neon_mod95' && backlight) { ctx.shadowColor = "#ff3366"; ctx.shadowBlur = 10; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; } 
        if(style === 'tube_mod50' && backlight) { ctx.shadowColor = "#ff6600"; ctx.shadowBlur = 8; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

        ctx.strokeStyle = needleColor; 
        ctx.lineWidth = Math.max(1.3, w / 280); 
        if(style === 'flat_mod00') ctx.lineWidth = 3;
        ctx.beginPath(); 
        ctx.moveTo(cx, cy); 
        ctx.lineTo(cx + (radius + (h * 0.16)) * Math.cos(Math.PI * angleVal), cy + (radius + (h * 0.16)) * Math.sin(Math.PI * angleVal)); 
        ctx.stroke(); 
        ctx.restore();

        if(style !== 'flat_mod00') { 
            ctx.save(); 
            ctx.shadowColor = "rgba(0, 0, 0, 0.8)"; 
            ctx.shadowBlur = 6; 
            ctx.fillStyle = "#111"; 
            ctx.beginPath(); 
            ctx.arc(cx, cy, Math.max(4.5, w / 42), 0, Math.PI * 2); 
            ctx.fill(); 
            ctx.strokeStyle = "#444"; 
            ctx.lineWidth = 1.5; 
            ctx.stroke(); 
            ctx.fillStyle = "#888"; 
            ctx.beginPath(); 
            ctx.arc(cx - 1.5, cy - 1.5, Math.max(1, w / 150), 0, Math.PI * 2); 
            ctx.fill(); 
            ctx.restore(); 
        }
    } catch (e) { }
}
