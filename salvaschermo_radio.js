// VARIABILI GLOBALI RADIO 3D
var isRadioScreensaverActive = false;
var radioTime = 0;
var lastStationStr = "";
var currentTunePos = 50; 
var tuneTarget = 50;
var tuneVelocity = 0;

// Nomi di fantasia basati su modello e anno di presunta costruzione
var radioModels = ['radica_mod58', 'bakelite_mod35', 'compact_mod65', 'transistor_mod68', 'console_mod55', 'teutonia_mod54']; 
var currentRadioIdx = 0;

var radioDOMContainer = null;
var radioNeedleDOM = null;
var radioTextDOM = null;

// --- NUOVA FUNZIONE PER LEGGERE LE ETICHETTE PERSONALIZZATE ---
function getRadioCustomLabel(modelKey, defaultName) {
    try {
        let labels = JSON.parse(localStorage.getItem('customLabels') || '{}');
        return labels[modelKey] && labels[modelKey].trim() !== "" ? labels[modelKey] : defaultName;
    } catch (e) {
        return defaultName;
    }
}

function injectRadioStyles() {
    if (document.getElementById('radio3DStyle')) return;
    let style = document.createElement('style');
    style.id = 'radio3DStyle';
    style.innerHTML = `
    :root {
      --bachelite: #120703;
      --oro-vintage: #d4a359;
    }

    #radio3DContainer {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 20000;
    }

    /* FILTRO RUMORE */
    .radio-noise-overlay {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      opacity: 0.14;
      pointer-events: none;
      mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
      border-radius: inherit;
    }

    /* CLASSI MATERIALI LEGNO */
    .wood-radica {
      background-color: #531c0e;
      background-image:
        linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, transparent 40%, rgba(0,0,0,0.5) 100%),
        radial-gradient(ellipse at 25% 35%, #a24422 0%, #531c0e 40%, #290b03 80%),
        radial-gradient(circle at 75% 75%, #8a3316 0%, #441408 50%, transparent 90%),
        repeating-linear-gradient(125deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 2px, transparent 2px, transparent 9px);
      background-blend-mode: overlay, normal, multiply, soft-light;
    }

    .wood-light {
      background-color: #8a5022;
      background-image:
        linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, transparent 50%, rgba(0,0,0,0.4) 100%),
        radial-gradient(ellipse at 50% 50%, #e89e5d 0%, #4a250a 100%),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 2px, transparent 2px, transparent 8px);
      background-blend-mode: overlay, normal, soft-light;
    }

    .wood-dark {
      background-color: #3d1c04;
      background-image:
        linear-gradient(to right, rgba(0,0,0,0.6) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.6) 100%),
        radial-gradient(ellipse at 50% 50%, #6e330a 0%, #1f0701 100%),
        repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 3px, transparent 3px, transparent 15px);
      background-blend-mode: overlay, normal, soft-light;
    }

    /* STRUTTURA GENERALE E DIMENSIONI MODELLI */
    .radio-body-3d {
      position: relative;
      padding: 22px;
      box-sizing: border-box;
      box-shadow:
        inset 0 3px 0 rgba(255, 255, 255, 0.3),
        inset 0 15px 25px rgba(255, 255, 255, 0.15),
        inset 0 -15px 35px rgba(0, 0, 0, 0.9),
        inset 12px 0 20px rgba(0,0,0,0.4),
        inset -12px 0 20px rgba(0,0,0,0.4),
        0 25px 50px rgba(0, 0, 0, 0.9),
        0 2px 4px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .model-radica_mod58 { width: 500px; height: 320px; border-radius: 40px; }
    .model-bakelite_mod35 { width: 480px; height: 420px; border-radius: 240px 240px 15px 15px; padding: 20px; }
    .model-compact_mod65 { width: 440px; height: 280px; border-radius: 30px; }
    .model-transistor_mod68 { width: 500px; height: 340px; border-radius: 12px; padding: 15px; background-color: #613b1e; box-shadow: inset 0 2px 5px rgba(255,255,255,0.2), 0 20px 40px rgba(0,0,0,0.8); }

    /* CORNICI E BEZEL INTERNI */
    .bezel-gold-dark {
      width: 100%; height: 100%;
      border-radius: 20px;
      border: 4px solid #1a0f05; background: #dca33c;
      padding: 12px; box-sizing: border-box;
      box-shadow: inset 0 5px 15px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; justify-content: space-between;
    }
    
    .bezel-black {
      width: 100%; height: 100%;
      border-radius: 5px; background: #1a1a1a;
      padding: 0; box-sizing: border-box;
      box-shadow: inset 0 10px 20px rgba(0,0,0,0.9);
      display: flex; flex-direction: column; justify-content: space-between;
    }

    .bezel-full-gold {
      width: 100%; height: 100%;
      border-radius: 20px; border: 3px solid #8a6c27;
      background: linear-gradient(135deg, #d4af37 0%, #aa842b 100%);
      padding: 15px; box-sizing: border-box;
      box-shadow: inset 0 5px 15px rgba(0,0,0,0.6), 0 2px 5px rgba(255,255,255,0.3);
      display: flex; gap: 15px;
    }

    /* GRIGLIE ALTOPARLANTE */
    .speaker-classic {
      background: radial-gradient(circle, transparent 20%, #111 20%, #111 40%, transparent 40%, transparent 100%), radial-gradient(circle, transparent 20%, #222 20%, #222 40%, transparent 40%, transparent 100%), #443325;
      background-size: 6px 6px; background-position: 0 0, 3px 3px;
    }
    
    .speaker-superla {
      background: radial-gradient(circle, transparent 20%, #c49a6c 20%, #c49a6c 40%, transparent 40%, transparent 100%), radial-gradient(circle, transparent 20%, #b08558 20%, #b08558 40%, transparent 40%, transparent 100%), #e6c299;
      background-size: 6px 6px; background-position: 0 0, 3px 3px;
    }
    
    .speaker-woven {
      background: repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.3) 5px, rgba(0,0,0,0.3) 10px), repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(0,0,0,0.3) 5px, rgba(0,0,0,0.3) 10px), #d4af37;
    }
    .speaker-dots {
      background: radial-gradient(#111 35%, transparent 35%), #443325;
      background-size: 8px 8px;
    }

    .speaker-zone {
      border: 3px solid #111;
      box-shadow: inset 0 8px 16px rgba(0,0,0,0.85), 0 1px 1px rgba(255,255,255,0.05);
      position: relative;
      overflow: hidden;
    }

    /* VETRO RETROILLUMINATO */
    .glass-dial {
      position: relative;
      background: linear-gradient(to bottom, #111 0%, #1f1305 10%, #ff7b00 50%, #3a1e00 100%);
      border: 2px solid #0a0402;
      box-shadow: inset 0 0 25px rgba(0, 0, 0, 0.9), 0 1px 1px rgba(255,255,255,0.1);
      overflow: hidden;
    }
    .glass-dial-vertical {
      background: linear-gradient(to right, #111 0%, #1a1a1a 50%, #0a0a0a 100%);
    }

    .glass-dial::before {
      content: ''; position: absolute; top: 0; left: -50%; width: 200%; height: 100%;
      background: linear-gradient(45deg, transparent 45%, rgba(255,255,255,0.08) 50%, transparent 55%);
      pointer-events: none; z-index: 3;
    }
    
    /* MOSTRINA IN OTTONE TRANCIATO (Resa a filo, senza ombra fluttuante) */
    .brass-bezel {
      border: 4px solid #d4af37 !important;
      border-top-color: #fdf0a6 !important;
      border-bottom-color: #7a5c13 !important;
      border-left-color: #cca44d !important;
      border-right-color: #b58c38 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.5), inset 0 4px 10px rgba(0,0,0,0.9) !important;
    }

    /* CONTENITORE SCALE */
    .scale-container {
      width: 100%; height: 100%;
      padding: 8px 15px; box-sizing: border-box;
      display: flex; flex-direction: column; justify-content: space-between;
      z-index: 1; position: relative;
    }
    
    .dial-info { flex-shrink: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; margin-bottom: 4px; }
    .dial-scales { flex-grow: 1; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 2px; gap: 6px; }

    .radio-dial-text-title { font-family: 'Times New Roman', serif; font-size: 16px; font-weight: bold; color: rgba(255, 230, 180, 0.98); text-shadow: 0 0 6px #ff5500; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
    .radio-dial-text-artist { font-family: 'Times New Roman', serif; font-size: 13px; font-style: italic; color: rgba(255, 230, 180, 0.85); text-shadow: 0 0 4px #ff5500; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
    
    .scale-band { display: flex; align-items: center; gap: 10px; }
    .scale-name { font-family: sans-serif; font-size: 10px; font-weight: bold; color: rgba(255,230,180,0.9); width: 22px; text-shadow: 0 0 2px #ff5500; }
    .scale-lines { 
      flex-grow: 1; height: 7px; 
      background: repeating-linear-gradient(90deg, rgba(255,230,180,0.8) 0px, rgba(255,230,180,0.8) 1px, transparent 1px, transparent 15px);
      border-bottom: 1px solid rgba(255,230,180,0.5);
    }
    .scale-freq { font-family: monospace; font-size: 9px; color: rgba(255,230,180,0.7); display: flex; justify-content: space-between; padding: 0 32px; margin-top: -3px; }

    /* LAYOUT SONY VERTICALE */
    .scale-container-vertical { padding: 10px 5px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
    .dial-info-vertical { height: 30%; display: flex; align-items: flex-start; justify-content: center; text-align: center; }
    .dial-scales-vertical { height: 70%; position: relative; width: 100%; display: flex; justify-content: center; }
    .v-line { width: 2px; height: 100%; background: rgba(255,255,255,0.2); }
    .v-ticks { position: absolute; left: 50%; transform: translateX(-50%); width: 15px; height: 100%; background: repeating-linear-gradient(180deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 12px); }

    /* LANCETTA FISICA ORIZZONTALE */
    .radio-needle {
      position: absolute; left: 50%; top: 2px; bottom: 2px; width: 2px;
      background: #e62200; box-shadow: 3px 2px 4px rgba(0, 0, 0, 0.8);
      z-index: 2; transition: left 0.1s linear;
    }
    .radio-needle-horizontal { width: 100%; height: 2px; background: #e62200; left: 0; top: 50%; box-shadow: 2px 3px 4px rgba(0, 0, 0, 0.8); transition: top 0.1s linear; }

    /* MANOPOLE */
    .heavy-knob {
      width: 36px; height: 36px; border-radius: 50%;
      border: 2px solid #000; position: relative;
      box-shadow: 0 4px 6px rgba(0,0,0,0.9), inset 0 1px 2px rgba(255,255,255,0.2);
    }
    .knob-dark { background: radial-gradient(circle at 30% 30%, #3a1a10 0%, var(--bachelite) 65%); }
    
    /* AVORIO INVECCHIATO (Tono Osso/Plaskon) */
    .knob-white { 
      background: radial-gradient(circle at 30% 30%, #fdf7e3 0%, #d8ccb1 65%); 
      border: 1px solid #8c816a; 
    }
    
    .heavy-knob::before {
      content: ''; position: absolute; top: 50%; left: 50%; width: 22px; height: 22px;
      margin: -11px 0 0 -11px; border-radius: 50%; border: 1px dashed rgba(255,255,255,0.15);
    }
    .heavy-knob::after {
      content: ''; position: absolute; top: 3px; left: 50%; width: 2px; height: 7px;
      background: var(--oro-vintage); transform: translateX(-50%); box-shadow: 0 0 2px #000;
    }
    .knob-white::before { border-color: rgba(100,80,60,0.2); }
    .knob-white::after { background: #5c4e3a; }

    /* PIEDINI IN GOMMA */
    .radio-foot {
      position: absolute; bottom: -12px; width: 55px; height: 14px;
      background: linear-gradient(to right, #111, #222 50%, #050505);
      border-radius: 0 0 12px 12px; box-shadow: 0 12px 15px rgba(0,0,0,0.7);
    }
    .radio-foot.f-left { left: 45px; } .radio-foot.f-right { right: 45px; }

    /* --- NUOVI MODELLI CON NOMI FANTASIA --- */
    .model-console_mod55 { width: 560px; height: 310px; border-radius: 50px; background-color: #593112; border: 18px solid #3a1a05; padding: 15px; }
    .console-bezel { background: #eadecd; width: 100%; height: 100%; border-radius: 25px; display: flex; flex-direction: column; justify-content: space-between; padding: 15px; box-shadow: 0 15px 30px rgba(0,0,0,0.9), inset 0 2px 8px rgba(255,255,255,0.8); border: 1px solid #c2b5a3; }
    .console-speaker { width: 38%; background: #1a1a1a; border-radius: 12px; box-shadow: inset 0 5px 15px rgba(0,0,0,0.9); display: flex; flex-direction: column; justify-content: space-evenly; overflow: hidden; padding: 10px 0; }
    .console-louver { width: 100%; height: 14px; background: linear-gradient(to bottom, #e8dfcc 0%, #c4b69b 100%); box-shadow: 0 6px 6px rgba(0,0,0,0.8), inset 0 2px 3px rgba(255,255,255,0.9); }
    .knob-cream { background: radial-gradient(circle at 30% 30%, #fdf7e3 0%, #eadecd 40%, #c2b5a3 100%); border: 1px solid #a89a85; }

    .model-teutonia_mod54 { width: 540px; height: 370px; border-radius: 18px; padding: 15px; }
    .teutonia-bezel { background: #e3dcc8; border-radius: 12px; padding: 10px; height: 100%; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 0 2px 8px rgba(0,0,0,0.5); }
    .teutonia-black-dial { background: #0a0a0a; border-radius: 8px; border: 2px solid #b59b57; display: flex; align-items: center; padding: 0 15px; gap: 15px; box-shadow: inset 0 10px 20px rgba(0,0,0,0.9); height: 125px; position: relative; }
    
    .piano-key { width: 30px; height: 22px; background: linear-gradient(to bottom, #fdf7e3 0%, #e0d3bc 80%, #b8ab92 100%); border: 1px solid #8c816a; border-radius: 0 0 4px 4px; box-shadow: 0 5px 5px rgba(0,0,0,0.6), inset 0 1px 2px rgba(255,255,255,0.6); }
    .piano-key:nth-child(2) { transform: translateY(3px); background: linear-gradient(to bottom, #e3d8c1 0%, #ccbe9f 80%, #9e937d 100%); box-shadow: 0 2px 2px rgba(0,0,0,0.6); }

    `;
    document.head.appendChild(style);
}

function getRadioHTML(model) {
    let scaleHTML = `
        <div class="scale-container">
            <div class="dial-info">
                <div class="radio-dial-text-title" id="radioDialTitle">In Attesa...</div>
                <div class="radio-dial-text-artist" id="radioDialArtist">Web Radio</div>
            </div>
            <div class="dial-scales">
                <div class="scale-band"><span class="scale-name">OM</span><div class="scale-lines"></div></div>
                <div class="scale-freq"><span>55</span><span>70</span><span>100</span><span>140</span><span>160</span></div>
                <div class="scale-band"><span class="scale-name">OC</span><div class="scale-lines" style="background-size: 14px 100%;"></div></div>
                <div class="scale-freq"><span>6</span><span>8</span><span>10</span><span>12</span><span>15</span></div>
            </div>
        </div>
    `;

    let darkScaleHTML = scaleHTML
        .replace(/rgba\(255, 230, 180, 0\.98\)/g, '#222')
        .replace(/#ff5500/g, 'transparent')
        .replace(/rgba\(255, 230, 180, 0\.85\)/g, '#444')
        .replace(/rgba\(255,230,180,0\.9\)/g, '#111')
        .replace(/rgba\(255,230,180,0\.8\)/g, '#555')
        .replace(/rgba\(255,230,180,0\.7\)/g, '#333');

    if (model === 'radica_mod58') {
        return `
        <div class="radio-body-3d wood-radica model-radica_mod58" style="position: relative;">
            <div class="radio-noise-overlay"></div>
            <!-- LOGO MODIFICATO -->
            <div style="position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); color: #ffca28; font-family: 'Brush Script MT', cursive, serif; font-size: 16px; text-shadow: 1px 1px 3px rgba(0,0,0,0.8), -1px -1px 0px rgba(255,255,255,0.1), 0px 0px 5px rgba(230,190,0,0.4); z-index: 10; letter-spacing: 1px;">${getRadioCustomLabel('radica_mod58', 'Radica')}</div>
            
            <div class="bezel-gold-dark" style="margin-top: 10px;">
                <div style="display:flex; gap: 12px; height: 180px;">
                    <div class="speaker-zone speaker-superla" style="width: 42%; border-radius: 12px; box-shadow: inset 0 8px 16px rgba(0,0,0,0.85);"></div>
                    <div class="glass-dial brass-bezel" id="radioGlassDial" style="width: 58%; border-radius: 8px;">
                        <div class="radio-needle" id="radioNeedle"></div>
                        ${scaleHTML}
                    </div>
                </div>
                <div style="display:flex; justify-content:space-around; align-items:center; padding: 10px 30px 0 30px; position:relative; z-index:5;">
                    <div class="heavy-knob knob-white" style="width:32px;height:32px;"></div>
                    <div class="heavy-knob knob-white" style="width:32px;height:32px;"></div>
                    <div class="heavy-knob knob-white" style="width:32px;height:32px;"></div>
                </div>
            </div>
            <div class="radio-foot f-left"></div><div class="radio-foot f-right"></div>
        </div>`;
    } 
    else if (model === 'bakelite_mod35') {
        return `
        <div class="radio-body-3d wood-dark model-bakelite_mod35">
            <div class="radio-noise-overlay"></div>
            <div class="speaker-zone speaker-superla" style="height: 220px; width: 440px; margin: 0 auto; border-radius: 220px 220px 6px 6px; border: 2px solid #3a1c04; box-shadow: inset 0 10px 20px rgba(0,0,0,0.9); position: relative;">
                <!-- LOGO MODIFICATO -->
                <div style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); color: #dca33c; font-family: 'Times New Roman', serif; font-weight: bold; font-size: 18px; letter-spacing: 8px; text-shadow: 2px 2px 5px #000;">${getRadioCustomLabel('bakelite_mod35', 'CLASSIC')}</div>
            </div>
            <div class="glass-dial brass-bezel" id="radioGlassDial" style="height: 130px; margin-top: 15px; border-radius: 6px; background: linear-gradient(to bottom, #e3cd91 0%, #c4a75c 100%);">
                <div class="radio-needle" id="radioNeedle" style="background: #333;"></div>
                ${darkScaleHTML}
            </div>
            <div style="display:flex; justify-content:center; gap: 90px; margin-top: 15px;">
                <div class="heavy-knob knob-dark" style="width:40px; height:40px;"></div>
                <div class="heavy-knob knob-dark" style="width:40px; height:40px;"></div>
            </div>
        </div>`;
    }
    else if (model === 'compact_mod65') {
        return `
        <div class="radio-body-3d wood-radica model-compact_mod65">
            <div class="radio-noise-overlay"></div>
            <div class="bezel-full-gold" style="position: relative;">
                <!-- LOGO MODIFICATO -->
                <div style="position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); color: #5c4314; font-family: sans-serif; font-weight: 900; font-size: 13px; letter-spacing: 5px; z-index: 10;">${getRadioCustomLabel('compact_mod65', 'COMPACT')}</div>
                
                <div class="speaker-zone speaker-dots" style="width: 35%; height: 100%; border-radius: 8px; border: 2px solid #5c4314;"></div>
                <div style="width: 65%; display: flex; flex-direction: column; justify-content: space-between; padding-bottom: 15px;">
                    <div class="glass-dial brass-bezel" id="radioGlassDial" style="height: 140px; border-radius: 8px;">
                        <div class="radio-needle" id="radioNeedle"></div>
                        ${scaleHTML}
                    </div>
                    <div style="display:flex; justify-content:space-around; align-items:flex-end; padding-bottom: 5px;">
                        <div class="heavy-knob knob-white" style="width:32px; height:32px;"></div>
                        <div class="heavy-knob knob-white" style="width:32px; height:32px;"></div>
                        <div class="heavy-knob knob-white" style="width:32px; height:32px;"></div>
                    </div>
                </div>
            </div>
            <div class="radio-foot f-left" style="left:30px;"></div><div class="radio-foot f-right" style="right:30px;"></div>
        </div>`;
    }
    else if (model === 'transistor_mod68') {
        return `
        <div class="radio-body-3d wood-light model-transistor_mod68" style="display:flex; flex-direction:column; padding: 15px; gap: 15px; background-color: #613b1e; position: relative;">
            <div class="radio-noise-overlay"></div>
            <div class="speaker-zone speaker-superla" style="width: 100%; height: 55%; border-radius: 6px; border: 3px solid #2a1b10; box-shadow: inset 0 10px 20px rgba(0,0,0,0.8); position: relative;">
               <!-- LOGO MODIFICATO -->
               <div style="color:#e0e0e0; font-family:sans-serif; font-weight:bold; font-size:22px; position:absolute; top:12px; left:18px; letter-spacing: 2px;">${getRadioCustomLabel('transistor_mod68', 'Rover')}</div>
            </div>
            <div style="height: 45%; display: flex; gap: 15px; background: #e8decf; padding: 12px; border-radius: 6px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.3);">
                <div class="glass-dial" id="radioGlassDial" style="width: 75%; height: 100%; border-radius: 4px;">
                    <div class="radio-needle" id="radioNeedle"></div>
                    ${scaleHTML}
                </div>
                <div style="width: 25%; display: flex; justify-content: space-around; align-items: center;">
                    <div class="heavy-knob knob-white" style="width:36px;height:36px;"></div>
                    <div class="heavy-knob knob-white" style="width:36px;height:36px;"></div>
                </div>
            </div>
        </div>`;
    }
    else if (model === 'console_mod55') {
        return `
        <div class="radio-body-3d wood-light model-console_mod55">
            <div class="radio-noise-overlay"></div>
            <div class="console-bezel" style="position: relative;">
                <!-- LOGO MODIFICATO -->
                <div style="position: absolute; top: 15px; right: 40px; color: #593112; font-family: 'Georgia', serif; font-style: italic; font-weight: bold; font-size: 24px; letter-spacing: 1px; text-shadow: 1px 1px 0px rgba(255,255,255,0.9); z-index: 10;">${getRadioCustomLabel('console_mod55', 'Console')}</div>
                
                <div style="display:flex; gap: 15px; height: 170px;">
                    <div class="speaker-zone speaker-superla" style="width: 38%; margin-top: 25px; border-radius: 12px; border: 2px solid #a89a85; box-shadow: inset 0 5px 15px rgba(0,0,0,0.9);"></div>
                    
                    <div class="glass-dial brass-bezel" id="radioGlassDial" style="width: 62%; border-radius: 12px; background: linear-gradient(to bottom, #e3cd91 0%, #c4a75c 100%); margin-top: 25px;">
                        <div class="radio-needle" id="radioNeedle" style="background: #333;"></div>
                        ${darkScaleHTML}
                    </div>
                </div>
                <div style="display:flex; padding: 5px 40px 0 40px; align-items:center;">
                    <div class="heavy-knob knob-cream" style="width:36px;height:36px;"></div>
                    <div class="heavy-knob knob-cream" style="width:36px;height:36px; margin-left: 20px;"></div>
                    <div style="flex-grow:1;"></div>
                    <div class="heavy-knob knob-cream" style="width:36px;height:36px; margin-right: 20px;"></div>
                    <div class="heavy-knob knob-cream" style="width:36px;height:36px;"></div>
                </div>
            </div>
        </div>`;
    }
    else if (model === 'teutonia_mod54') {
        return `
        <div class="radio-body-3d wood-dark model-teutonia_mod54">
            <div class="radio-noise-overlay"></div>
            <div class="teutonia-bezel" style="position: relative;">
                <div class="speaker-zone speaker-superla" style="flex:1; border-radius: 8px; position:relative; border: 1px solid #b59b57; box-shadow: inset 0 10px 20px rgba(0,0,0,0.9);">
                    <!-- LOGO MODIFICATO -->
                    <div style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); color: #d4af37; font-family: sans-serif; font-weight: bold; font-size: 20px; letter-spacing: 6px; text-shadow: 2px 2px 6px #000, 0 0 2px #000;">${getRadioCustomLabel('teutonia_mod54', 'TEUTONIA')}</div>
                </div>
                <div class="teutonia-black-dial brass-bezel" id="radioGlassDial">
                    <div class="heavy-knob knob-white" style="width:50px;height:50px; flex-shrink:0;"></div>
                    <div style="flex:1; height: 90%; position:relative; overflow:hidden;">
                        <div class="radio-needle" id="radioNeedle" style="background:#00e676; box-shadow: 0 0 10px #00e676;"></div>
                        ${scaleHTML}
                    </div>
                    <div class="heavy-knob knob-white" style="width:50px;height:50px; flex-shrink:0;"></div>
                </div>
                <div style="display:flex; justify-content:center; gap: 4px; height: 22px; margin-top: -10px; z-index: 10;">
                    <div class="piano-key"></div>
                    <div class="piano-key"></div>
                    <div class="piano-key"></div>
                    <div class="piano-key"></div>
                    <div class="piano-key"></div>
                </div>
            </div>
        </div>`;
    }
}

function initRadioDOM(parentOverlay) {
    injectRadioStyles();

    radioDOMContainer = document.createElement('div');
    radioDOMContainer.id = 'radio3DContainer';
    
    let select = document.getElementById('vuStyleSelect');
    currentRadioIdx = select ? select.selectedIndex % radioModels.length : 0;

    let activeModel = radioModels[currentRadioIdx];
    radioDOMContainer.innerHTML = getRadioHTML(activeModel);

    parentOverlay.appendChild(radioDOMContainer);

    radioNeedleDOM = document.getElementById('radioNeedle');
    radioTextDOM = {
        title: document.getElementById('radioDialTitle'),
        artist: document.getElementById('radioDialArtist'),
        dialBg: document.getElementById('radioGlassDial')
    };

    updateRadioScale();
    window.addEventListener('resize', updateRadioScale);
}

function removeRadioDOM() {
    if (radioDOMContainer) {
        radioDOMContainer.remove();
        radioDOMContainer = null;
        radioNeedleDOM = null;
        radioTextDOM = null;
    }
    window.removeEventListener('resize', updateRadioScale);
}

function updateRadioScale() {
    if (!radioDOMContainer) return;
    
    let activeModel = radioModels[currentRadioIdx];
    let nativeWidth = 500, nativeHeight = 350;
    
    if (activeModel === 'radica_mod58') { nativeWidth = 500; nativeHeight = 320; }
    else if (activeModel === 'bakelite_mod35') { nativeWidth = 480; nativeHeight = 420; }
    else if (activeModel === 'compact_mod65') { nativeWidth = 440; nativeHeight = 280; }
    else if (activeModel === 'transistor_mod68') { nativeWidth = 500; nativeHeight = 340; }
    else if (activeModel === 'console_mod55') { nativeWidth = 560; nativeHeight = 310; }
    else if (activeModel === 'teutonia_mod54') { nativeWidth = 540; nativeHeight = 370; }

    let ssOverlay = document.getElementById('screensaverOverlay');
    let macFaceplate = ssOverlay ? ssOverlay.querySelector('.mac-faceplate') : null;
    
    let availableWidth = window.innerWidth * 0.9;
    let availableHeight = window.innerHeight * 0.85;

    if (macFaceplate && macFaceplate.clientWidth > 50) {
        availableWidth = macFaceplate.clientWidth - 80; 
        
        let hwControls = macFaceplate.querySelector('.hw-controls');
        let hwHeight = hwControls ? hwControls.clientHeight : 100;
        
        availableHeight = macFaceplate.clientHeight - hwHeight - 80; 
    }

    let scaleX = availableWidth / nativeWidth;
    let scaleY = availableHeight / nativeHeight;
    
    let optimalScale = Math.min(scaleX, scaleY);

    if (!optimalScale || optimalScale <= 0.1 || !isFinite(optimalScale)) {
        setTimeout(updateRadioScale, 50);
        return; 
    }
    
    if (optimalScale > 3.5) optimalScale = 3.5;

    radioDOMContainer.style.transform = `translate(-50%, -55%) scale(${optimalScale})`;
}

function updateAntiqueRadioDOM() {
    if (!radioNeedleDOM || !radioTextDOM) return;

    radioTime += 0.03;
    let activeModel = radioModels[currentRadioIdx];
    
    let titleStr = document.getElementById('mainTitle') ? document.getElementById('mainTitle').textContent : "In Attesa...";
    let artistStr = document.getElementById('mainArtist') ? document.getElementById('mainArtist').textContent : "Web Radio";

    if (radioTextDOM.title.textContent !== titleStr) radioTextDOM.title.textContent = titleStr;
    if (radioTextDOM.artist && radioTextDOM.artist.textContent !== artistStr) radioTextDOM.artist.textContent = artistStr;

    let flicker = Math.sin(radioTime) * 0.06 + 0.94; 
    
    if (activeModel !== 'transistor_mod68' && activeModel !== 'console_mod55' && activeModel !== 'teutonia_mod54' && activeModel !== 'bakelite_mod35') {
        radioTextDOM.dialBg.style.background = `linear-gradient(to bottom, #111 0%, #1f1305 10%, rgba(255, 123, 0, ${flicker}) 50%, #3a1e00 100%)`;
    }

    let currentStationStr = titleStr + artistStr;
    if (currentStationStr !== lastStationStr) {
        lastStationStr = currentStationStr;
        let hash = 0;
        for (let i = 0; i < currentStationStr.length; i++) { hash = currentStationStr.charCodeAt(i) + ((hash << 5) - hash); }
        tuneTarget = 10 + (Math.abs(hash) % 80); 
    }

    let diff = tuneTarget - currentTunePos;
    tuneVelocity += diff * 0.015; 
    tuneVelocity *= 0.85; 
    currentTunePos += tuneVelocity;
    
    let flutter = (Math.sin(radioTime * 15) * 0.5) + (Math.cos(radioTime * 23) * 0.3);
    let finalPos = Math.max(5, Math.min(95, currentTunePos + flutter));

    radioNeedleDOM.style.left = `${finalPos}%`;
}
