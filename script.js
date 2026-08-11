const API = 'mpd_bridge.php';

async function initFirstRun() {
    try {
        let res = await fetch(`${API}?action=check_first_run`);
        let data = await res.json();
        
        if (!data.ready) {
            let overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.95); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#00e676; font-family:-apple-system, sans-serif; text-align:center; padding:20px;';
            overlay.innerHTML = `
                <h2 style="margin:0 0 10px 0;">Configurazione Primo Avvio</h2>
                <p style="color:#aaa;">Scaricamento delle librerie grafiche e impostazione permessi in corso...</p>
                <p style="font-size:0.8rem; color:#666;">L'operazione richiede internet. La pagina si ricaricherà da sola a fine processo (circa 5-10 secondi).</p>
            `;
            document.body.appendChild(overlay);

            let installRes = await fetch(`${API}?action=install_dependencies`);
            let installData = await installRes.json();
            
            if (installData.success) {
                location.reload(); 
            } else {
                alert("Errore pacchettizzazione: " + installData.error);
                overlay.remove(); 
            }
            return false; 
        }
        return true; 
    } catch (e) {
        console.error("Errore controllo primo avvio", e);
        return true; 
    }
}

function applyTranslations(lang) {
    if (typeof localStorage !== 'undefined') localStorage.setItem('hifi_language', lang);
    if (typeof currentLang !== 'undefined') currentLang = lang;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        let key = el.getAttribute('data-i18n');
        if (typeof translations !== 'undefined' && translations[lang] && translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        let key = el.getAttribute('data-i18n-title');
        if (typeof translations !== 'undefined' && translations[lang] && translations[lang][key]) {
            el.setAttribute('title', translations[lang][key]);
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        let key = el.getAttribute('data-i18n-placeholder');
        if (typeof translations !== 'undefined' && translations[lang] && translations[lang][key]) {
            el.setAttribute('placeholder', translations[lang][key]);
        }
    });

    if (document.getElementById('langSelect')) {
        document.getElementById('langSelect').value = lang;
    }
}

function t(key) {
    let lng = (typeof currentLang !== 'undefined') ? currentLang : (localStorage.getItem('hifi_language') || 'it');
    return (typeof translations !== 'undefined' && translations[lng] && translations[lng][key]) 
        ? translations[lng][key] 
        : key;
}

let currentDuration = 0;
let currentRepeat = '0';
let currentRandom = '0';
let rawInfoCache = {};
let currentFolderPath = '';
let searchString = '';
let artistState = { artist: '', album: '' };
let albumState = { active: false };
let lastPlayingId = null;
let isMuted = false;
let preMuteVol = 50;

let volumeOsdTimer = null;
let lastKnownVolume = -1;
let lastLocalVolumeChange = 0;

function showVolumeOSD(vol, isMute = false) {
    let osd = document.getElementById('volumeOsd');
    let osdIcon = document.getElementById('volumeOsdIcon');
    let osdValue = document.getElementById('volumeOsdValue');
    let osdBar = document.getElementById('volumeOsdBar');
    if (!osd) return;

    let v = parseInt(vol) || 0;

    if (isMute || v === 0) {
        osdIcon.className = 'bi bi-volume-mute-fill';
        osdIcon.style.color = '#dc3545';
        osdIcon.style.textShadow = '0 0 20px rgba(220,53,69,0.5)';
        osdBar.style.background = '#dc3545';
        osdBar.style.boxShadow = '0 0 15px rgba(220,53,69,0.5)';
        osdValue.textContent = 'MUTE';
        osdBar.style.width = '0%';
    } else {
        let iconClass = v > 50 ? 'bi-volume-up-fill' : 'bi-volume-down-fill';
        osdIcon.className = `bi ${iconClass}`;
        osdIcon.style.color = 'var(--hl-color)';
        osdIcon.style.textShadow = '0 0 20px var(--hl-glow)';
        osdBar.style.background = 'var(--hl-color)';
        osdBar.style.boxShadow = '0 0 15px var(--hl-glow)';
        osdValue.textContent = v + '%';
        osdBar.style.width = v + '%';
    }

    osd.classList.add('show');

    if (volumeOsdTimer) clearTimeout(volumeOsdTimer);
    volumeOsdTimer = setTimeout(() => {
        osd.classList.remove('show');
    }, 2500); // Scompare dopo 2.5 secondi
}

let cachedSearchResults = [];
let cachedFolders = { path: null, data: [] };
let cachedAlbums = null;
let cachedArtists = null;
let cachedSubLevel = { id: null, data: [] };
let cachedMpdRadios = null;
let cachedRbRadios = null;
let globalCoverCache = {};

let universalFavorites = [];
try { 
    universalFavorites = JSON.parse(localStorage.getItem('hifi_universal_favs')) || []; 
} catch(e) { 
    universalFavorites = []; 
}
let lastFavJump = '';

let viewModes = { 
    'folderGrid': 'grid', 
    'albumGrid': 'grid', 
    'artistGrid': 'list', 
    'searchGrid': 'list',
    'radioListGrid': 'list' 
};

try {
    viewModes = { 
        'folderGrid': localStorage.getItem('view_folderGrid') || 'grid', 
        'albumGrid': localStorage.getItem('view_albumGrid') || 'grid', 
        'artistGrid': localStorage.getItem('view_artistGrid') || 'list', 
        'searchGrid': localStorage.getItem('view_searchGrid') || 'list',
        'radioListGrid': localStorage.getItem('view_radioListGrid') || 'list' 
    };
} catch(e) {
    console.warn("Accesso a localStorage negato o bloccato, uso i viewModes predefiniti.");
}

function toggleView(containerId) {
    viewModes[containerId] = viewModes[containerId] === 'grid' ? 'list' : 'grid'; 
    localStorage.setItem('view_' + containerId, viewModes[containerId]);
    
    let icon = document.getElementById(containerId + '_icon'); 
    if(icon) {
        icon.className = viewModes[containerId] === 'grid' ? 'bi bi-list' : 'bi bi-grid-fill';
    }
    
    let activeTab = document.querySelector('.tab-pane.active');
    if(activeTab) {
        let tid = activeTab.id.replace('tab-', '');
        if (tid === 'folders') loadFolders(currentFolderPath, true); 
        else if (tid === 'albums') { if(albumState.active) loadAlbumTracks(albumState.album, 'album', true); else loadAlbums(true); } 
        else if (tid === 'artists') { if(artistState.album) loadAlbumTracks(artistState.album, 'artist', true); else if(artistState.artist) loadArtistAlbums(artistState.artist, true); else loadArtists(true); } 
        else if (tid === 'search' && searchString) doSearch(true); 
        else if (tid === 'favorites') renderFavorites();
        else if (tid === 'webradio') renderRadioList(true);
    }
}

function buildItemHtml(mode, dataAttr, safeActionPath, imgUrl, title, subtitle, isDir, iconClass) {
    let pType = 'file';
    let mainClick = '';
    let showPlayBtn = true;
    let dataTag = ''; 
    let cacheKey = null;

    let sortChar = title ? title.charAt(0).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : '#';
    if (!/[A-Z]/.test(sortChar)) sortChar = '#';

    if (dataAttr && iconClass.includes('person')) {
        pType = 'artist';
        dataTag = `data-artist="${dataAttr}"`;
        mainClick = `loadArtistAlbums('${safeActionPath}')`;
        cacheKey = dataAttr;
    } else if (dataAttr && iconClass.includes('disc')) {
        pType = 'album';
        dataTag = `data-album="${dataAttr}"`;
        mainClick = `loadAlbumTracks('${safeActionPath}', 'album')`;
        cacheKey = dataAttr;
    } else if (isDir && subtitle !== 'Playlist' && subtitle !== t('item_playlist')) {
        pType = 'directory';
        dataTag = `data-folder="${safeActionPath}"`; 
        mainClick = `loadFolders('${safeActionPath}')`;
        cacheKey = safeActionPath;
        let pathUpper = safeActionPath.toUpperCase();
        if (pathUpper === 'WEBRADIO' || pathUpper === 'RADIO' || pathUpper === 'DEFAULTPLAYLIST') { showPlayBtn = false; }
    } else {
        pType = (subtitle === 'Playlist' || subtitle === t('item_playlist')) ? 'playlist' : 'file';
        mainClick = `playAdd('${safeActionPath}', '${pType}', 'play')`;
        cacheKey = safeActionPath;
    }

    let finalImgUrl = imgUrl;
    if (!finalImgUrl && cacheKey && globalCoverCache[cacheKey]) {
        finalImgUrl = globalCoverCache[cacheKey];
    }

    let isFav = universalFavorites.some(f => f.path === safeActionPath);
    let heartIcon = isFav ? 'bi-heart-fill' : 'bi-heart';
    let heartColor = isFav ? 'color: #dc3545;' : 'color: #aaa;';
    
    let safeTitle = (title || '').replace(/'/g, "\\'");
    let safeSub = (subtitle || '').replace(/'/g, "\\'");
    let safeImg = (finalImgUrl || '').replace(/'/g, "\\'");
    let safeIcon = iconClass.replace(/'/g, "\\'");

    let favBtnHtml = `<button class="btn-addplay" style="margin-top:0; flex: 1; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); ${heartColor}" onclick="toggleUniversalFav(this, '${pType}', '${safeActionPath}', '${safeTitle}', '${safeImg}', '${safeSub}', '${safeIcon}'); event.stopPropagation();" title="${t('tab_favs')}"><i class="bi ${heartIcon}"></i></button>`;

    let playBtnHtml = '';
    if (showPlayBtn) {
        playBtnHtml = `
            <button class="btn-addplay" style="margin-top:0; flex: 3;" onclick="playAdd('${safeActionPath}', '${pType}', 'play'); event.stopPropagation();"><i class="bi bi-play-fill"></i> Play</button>
            <button class="btn-addplay" style="margin-top:0; flex: 1; background: rgba(255,255,255,0.05);" onclick="playAdd('${safeActionPath}', '${pType}', 'enqueue'); event.stopPropagation();" title="Add to Queue"><i class="bi bi-plus-lg"></i></button>
            ${favBtnHtml}`;
    } else {
        playBtnHtml = `<div style="flex:4;"></div>${favBtnHtml}`;
    }

    let iconHtml = `<i class="bi ${iconClass}" ${finalImgUrl ? 'style="display:none;"' : ''}></i>`;
    let imgHtml = `<img class="lazy-cover" ${finalImgUrl ? `src="${finalImgUrl}" data-loaded="true" style="display:block;"` : ''} onerror="this.style.display='none'; this.previousElementSibling.style.display='block';">`;

    if (mode === 'grid') {
        return `
        <div class="grid-item" ${dataTag} data-letter="${sortChar}">
            <div class="grid-cover" onclick="${mainClick}" oncontextmenu="showContextMenu(event, '${safeActionPath}')">${iconHtml}${imgHtml}</div>
            <div class="grid-title" onclick="${mainClick}">${title}</div>
            <div class="grid-sub">${subtitle}</div>
            <div style="display:flex; gap: 5px; margin-top:0.6rem;">${playBtnHtml}</div>
        </div>`;
    } else {
        return `
        <div class="list-item" ${dataTag} data-letter="${sortChar}">
            <div class="list-cover" onclick="${mainClick}" oncontextmenu="showContextMenu(event, '${safeActionPath}')">${iconHtml}${imgHtml}</div>
            <div class="list-item-content" onclick="${mainClick}"><div style="font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</div><div style="font-size:0.8rem; color:#aaa;">${subtitle}</div></div>
            <div style="display:flex; gap: 5px; margin-left:10px; flex-shrink: 0; width: 180px;">${playBtnHtml}</div>
        </div>`;
    }
}

const coverObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            let album = entry.target.getAttribute('data-album');
            let artist = entry.target.getAttribute('data-artist');
            let folder = entry.target.getAttribute('data-folder'); 
            let img = entry.target.querySelector('img.lazy-cover');
            let icon = entry.target.querySelector('i');

            if (img && !img.dataset.loaded) {
                let endpoint = '';
                let cacheKey = null;
                
                if (album) { endpoint = `album_cover&album=${encodeURIComponent(album)}`; cacheKey = album; }
                else if (artist) { endpoint = `artist_cover&artist=${encodeURIComponent(artist)}`; cacheKey = artist; }
                else if (folder) { 
                    let fUpper = folder.toUpperCase();
                    if (!['NAS', 'OSDISK', 'USB', 'RADIO', 'WEBRADIO'].includes(fUpper) && !fUpper.includes('DEFAULT')) {
                        endpoint = `folder_cover&folder=${encodeURIComponent(folder)}`; 
                        cacheKey = folder; 
                    }
                }

                if (endpoint) {
                    fetch(`${API}?action=${endpoint}`).then(res => res.json()).then(data => {
                        if (data && data.coverUrl && data.coverUrl.trim() !== '' && !data.coverUrl.includes('coverart.php')) { 
                            img.src = data.coverUrl; 
                            img.onload = () => { img.style.display = 'block'; if(icon) icon.style.display = 'none'; }; 
                            if (cacheKey) globalCoverCache[cacheKey] = data.coverUrl; 
                        }
                    }).catch(e => console.error("Cover fetch error:", e));
                }
                img.dataset.loaded = "true";
            }
            observer.unobserve(entry.target);
        }
    });
}, { root: null, rootMargin: '300px' });

function setVolume(val) { 
    sendCmd('volume', val); 
    let localPlayer = document.getElementById('localAudioPlayer');
    if (localPlayer) {
        localPlayer.volume = val / 100;
    }
    if(val > 0) { 
        isMuted = false; 
        let mi = document.getElementById('muteIcon');
        if(mi) mi.className = 'bi bi-volume-up-fill'; 
        let bm = document.getElementById('btnMute');
        if(bm) bm.classList.remove('mute-active'); 
    } else {
        isMuted = true;
    }
    
    // Richiama l'animazione visiva
    showVolumeOSD(val, isMuted);
    lastKnownVolume = parseInt(val);
    lastLocalVolumeChange = Date.now(); // Registra il momento in cui hai toccato il volume
}

function toggleMute() { 
    let finalVol = 0;
    if (isMuted) { 
        finalVol = preMuteVol;
        setVolume(preMuteVol); 
        let vs = document.getElementById('volSlider');
        if(vs) vs.value = preMuteVol; 
    } else { 
        let vs = document.getElementById('volSlider');
        let currentVol = vs ? parseInt(vs.value) : 50; 
        if (currentVol > 0) preMuteVol = currentVol; 
        setVolume(0); 
        let mi = document.getElementById('muteIcon');
        if(mi) mi.className = 'bi bi-volume-mute-fill'; 
        let bm = document.getElementById('btnMute');
        if(bm) bm.classList.add('mute-active'); 
        finalVol = 0;
    } 
    
    // Richiama l'animazione visiva
    showVolumeOSD(finalVol, finalVol === 0);
    lastKnownVolume = finalVol;
    lastLocalVolumeChange = Date.now(); // Registra il momento
}

function applyDeviceLayout() { 
    let lSelect = document.getElementById('deviceLayout');
    let layoutSetting = lSelect ? lSelect.value : 'auto';
    let mode = layoutSetting; 
    
    if (layoutSetting === 'auto') { 
        let w = window.innerWidth, h = window.innerHeight, ratio = w / h; 
        if (w <= 600 || (w <= 900 && ratio < 1)) mode = 'mobile'; 
        else if (ratio < 1.2 && w <= 1200) mode = 'tablet'; 
        else if (w <= 1400) mode = 'laptop'; 
        else mode = 'desktop'; 
    } 
    document.body.classList.remove('layout-desktop', 'layout-laptop', 'layout-tablet', 'layout-mobile'); 
    document.body.classList.add('layout-' + mode); 
    if(typeof currentLayoutMode !== 'undefined') currentLayoutMode = mode; 
}

function updateUITheme(style) {
    let bLogo = document.getElementById('brandLogo');
    if(!bLogo) return;
    bLogo.removeAttribute('style');
    let themeClass = 'theme-default', logoText = "CLASSIC '70", fontClass = "blue_mod70";

    if (style === 'blue_mono_mod1000') { themeClass = 'theme-blue_mono'; logoText = "MONO 1000"; fontClass = "blue_mono"; }
    else if (style === 'champagne_mod73') { themeClass = 'theme-champagne'; logoText = "CHAMPAGNE '73"; fontClass = "champagne"; }
    else if (style === 'vfd_mod85' || style === 'neon_mod95' || style === 'flat_mod00') {
        themeClass = 'theme-vfd_peak'; logoText = (style==='vfd_mod85') ? "VFD PEAK '85" : "STUDIO METER"; fontClass = (style==='vfd_mod85') ? "vfd_peak" : "peppy";
        if(style!=='vfd_mod85') bLogo.style.fontFamily = "sans-serif";
    }
    else if (style === 'studio_mod77' || style === 'minimal_mod00') {
        themeClass = 'theme-studio_master'; logoText = (style==='studio_mod77') ? "STUDIO MASTER '77" : "STUDIO METER"; fontClass = (style==='studio_mod77') ? "peppy" : "peppy";
        if(style==='minimal_mod00') bLogo.style.fontFamily = "sans-serif";
    }
    else if (style === 'waves_mod99') { themeClass = 'theme-waves'; logoText = "WAVES '99"; fontClass="waves"; }
    else if (style === 'british_mod90') { themeClass = 'theme-british_console'; logoText = "BRITISH EQ '90"; fontClass = "british_console"; }
    else if (style === 'vintage_mod60' || style === 'orange_mod70' || style === 'amber_mod75' || style === 'tube_mod50') {
        themeClass = 'theme-vintage';
        if(style==='amber_mod75') { logoText = "AMBER '75"; fontClass="amber_classic"; }
        else if(style==='tube_mod50') { logoText = "TUBE GLOW '50"; fontClass="peppy"; }
        else { logoText = "VINTAGE '60"; fontClass="vintage"; }
    }
    else if (style === 'touch_mod15') { themeClass = 'theme-default'; logoText = "TOUCH METER '15"; fontClass="picore"; }
    else if (style && style.includes('meter')) { themeClass = 'theme-default'; logoText = "VU METER"; fontClass="peppy"; }

    // --- INIZIO LETTURA NOMI PERSONALIZZATI (SOVRASCRIVE IL DEFAULT) ---
    try {
        let labels = JSON.parse(localStorage.getItem('customLabels') || '{}');
        let cleanStyle = style.replace('vu_', ''); // Sicurezza sulla chiave
        if (labels[cleanStyle] && labels[cleanStyle].trim() !== '') {
            logoText = labels[cleanStyle];
        }
    } catch(e) {}
    // --- FINE LETTURA NOMI PERSONALIZZATI ---

    document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();
    document.body.classList.add(themeClass);
    if(typeof applyDeviceLayout === 'function') applyDeviceLayout();
    bLogo.textContent = logoText;
    bLogo.className = "brand-logo " + fontClass;
}

async function loadSettings() { 
    let hostname = window.location.hostname || "127.0.0.1"; 
    
    try { 
        let defaultsToUse = {};

        // 1. Tenta di caricare le impostazioni persistenti specifiche di questo dispositivo
        let clientRes = await fetch(`${API}?action=get_client_settings&_t=${Date.now()}`); 
        let clientData = await clientRes.json();
        
        if (clientRes.ok && !clientData.error && Object.keys(clientData).length > 0) {
            defaultsToUse = clientData;
        } else {
            // 2. Se non esiste un salvataggio, usa i default globali (creati dall'admin)
            let globalRes = await fetch(`${API}?action=get_default_settings&_t=${Date.now()}`);
            if (globalRes.ok) {
                defaultsToUse = await globalRes.json();
            }
        }
        
        if (Object.keys(defaultsToUse).length > 0) {
            localStorage.setItem('camilla_ss_timeout', defaultsToUse.ssTimeout !== undefined ? defaultsToUse.ssTimeout : '1'); 
            localStorage.setItem('camilla_ss_random', defaultsToUse.ssRandom !== undefined ? defaultsToUse.ssRandom : '0.5'); 
            localStorage.setItem('camilla_vu_style', defaultsToUse.vuStyle || 'blue_mod70'); 
            localStorage.setItem('camilla_ws_uri', defaultsToUse.wsUri || ''); 
            localStorage.setItem('moode_ui_url', defaultsToUse.moodeUrl || ''); 
            localStorage.setItem('camilla_stream_url', defaultsToUse.streamUrl || `http://${hostname}:8000/mpd.ogg`); 
            localStorage.setItem('camilla_backlight', defaultsToUse.backlight !== false); 
            localStorage.setItem('camilla_inline_vu', defaultsToUse.inlineVu !== false); 
            localStorage.setItem('camilla_local_analyzer', defaultsToUse.localAnalyzer !== false); 
            localStorage.setItem('camilla_device_layout', defaultsToUse.deviceLayout || 'auto'); 
            if(defaultsToUse.wakeOnTrack !== undefined) localStorage.setItem('camilla_wake_on_track', defaultsToUse.wakeOnTrack);
        }
    } catch (e) {
        console.warn("Server non raggiungibile, uso la cache locale");
    } 
    
    // Riapplica i valori caricati all'interfaccia (come già facevi)
    if(document.getElementById('ssTimeout')) document.getElementById('ssTimeout').value = localStorage.getItem('camilla_ss_timeout') || '1'; 
    if(document.getElementById('ssRandomTime')) document.getElementById('ssRandomTime').value = localStorage.getItem('camilla_ss_random') || '0.5'; 
    if(document.getElementById('vuStyleSelect')) document.getElementById('vuStyleSelect').value = localStorage.getItem('camilla_vu_style') || 'blue_mod70'; 
    if(document.getElementById('wsUriInput')) document.getElementById('wsUriInput').value = localStorage.getItem('camilla_ws_uri') || ("ws://" + hostname + ":1234"); 
    if(document.getElementById('moodeUiUrlInput')) document.getElementById('moodeUiUrlInput').value = localStorage.getItem('moode_ui_url') || ("http://" + hostname); 
    if(document.getElementById('streamUrlInput')) document.getElementById('streamUrlInput').value = localStorage.getItem('camilla_stream_url') || (`http://${hostname}:8000/mpd.ogg`); 
    if(document.getElementById('backlightToggle')) document.getElementById('backlightToggle').checked = localStorage.getItem('camilla_backlight') !== 'false'; 
    if(document.getElementById('inlineVuToggle')) document.getElementById('inlineVuToggle').checked = localStorage.getItem('camilla_inline_vu') !== 'false'; 
    if(document.getElementById('localAnalyzerToggle')) document.getElementById('localAnalyzerToggle').checked = localStorage.getItem('camilla_local_analyzer') !== 'false'; 
    if(document.getElementById('deviceLayout')) document.getElementById('deviceLayout').value = localStorage.getItem('camilla_device_layout') || 'auto'; 
    if(document.getElementById('wakeOnTrackToggle')) document.getElementById('wakeOnTrackToggle').checked = localStorage.getItem('camilla_wake_on_track') !== 'false'; 
    
    let camillaTgl = document.getElementById('camillaDspToggle');
    if (camillaTgl) camillaTgl.checked = localStorage.getItem('camilla_dsp_state') === 'true';
    
    let inlineC = document.getElementById('inlineVuContainer');
    let inlTgl = document.getElementById('inlineVuToggle');
    if(inlineC) inlineC.style.display = (inlTgl && inlTgl.checked) ? 'flex' : 'none'; 
    
    ['folderGrid', 'albumGrid', 'artistGrid', 'searchGrid', 'radioListGrid'].forEach(id => { 
        let icon = document.getElementById(id + '_icon'); 
        if(icon) icon.className = viewModes[id] === 'grid' ? 'bi bi-list' : 'bi bi-grid-fill'; 
    }); 
    
    applyDeviceLayout(); 
    let vss = document.getElementById('vuStyleSelect');
    if(vss) updateUITheme(vss.value); 
    if (typeof resetIdle === 'function') resetIdle(); 
        
    initAutoSave();
}

// Nuove funzioni per i bottoni
async function saveClientSettings() {
    let payload = {
        ssTimeout: document.getElementById('ssTimeout').value,
        ssRandom: document.getElementById('ssRandomTime').value,
        vuStyle: document.getElementById('vuStyleSelect').value,
        wsUri: document.getElementById('wsUriInput').value,
        moodeUrl: document.getElementById('moodeUiUrlInput').value,
        streamUrl: document.getElementById('streamUrlInput').value,
        backlight: document.getElementById('backlightToggle').checked,
        inlineVu: document.getElementById('inlineVuToggle').checked,
        localAnalyzer: document.getElementById('localAnalyzerToggle').checked,
        deviceLayout: document.getElementById('deviceLayout').value,
        wakeOnTrack: document.getElementById('wakeOnTrackToggle') ? document.getElementById('wakeOnTrackToggle').checked : true
    };
    
    let btn = document.getElementById('btnSaveClient');
    let originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvataggio...';
    
    try {
        await fetch(`${API}?action=save_client_settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Configurazione Salvata';
        btn.style.color = '#000';
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.color = '#000';
        }, 3000);
    } catch (e) {
        alert("Errore durante il salvataggio.");
        btn.innerHTML = originalHtml;
    }
}

async function restoreDefaultSettings() {
    if(confirm("Vuoi eliminare la configurazione permanente di questo dispositivo e ripristinare i valori globali?")) {
        try {
            await fetch(`${API}?action=delete_client_settings`);
            localStorage.clear();
            location.reload();
        } catch (e) {
            alert("Errore durante il ripristino.");
        }
    }
}

function initAutoSave() {
    const settingInputs = [
        'ssTimeout', 'ssRandomTime', 'vuStyleSelect', 'wsUriInput', 
        'moodeUiUrlInput', 'streamUrlInput', 'backlightToggle', 
        'inlineVuToggle', 'localAnalyzerToggle', 'deviceLayout'
    ];
    
    settingInputs.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveSettings);
        }
    });
}

function saveSettings() {
    let ssTimeout = document.getElementById('ssTimeout') ? document.getElementById('ssTimeout').value : '1';
    let ssRandom = document.getElementById('ssRandomTime') ? document.getElementById('ssRandomTime').value : '0.5';
    let vuStyle = document.getElementById('vuStyleSelect') ? document.getElementById('vuStyleSelect').value : 'blue_mod70';
    let wsUri = document.getElementById('wsUriInput') ? document.getElementById('wsUriInput').value : '';
    let moodeUrl = document.getElementById('moodeUiUrlInput') ? document.getElementById('moodeUiUrlInput').value : '';
    let streamUrl = document.getElementById('streamUrlInput') ? document.getElementById('streamUrlInput').value : '';
    let backlight = document.getElementById('backlightToggle') ? document.getElementById('backlightToggle').checked : true;
    let inlineVu = document.getElementById('inlineVuToggle') ? document.getElementById('inlineVuToggle').checked : true;
    let localAnalyzer = document.getElementById('localAnalyzerToggle') ? document.getElementById('localAnalyzerToggle').checked : true;
    let deviceLayout = document.getElementById('deviceLayout') ? document.getElementById('deviceLayout').value : 'auto';
    
    // SALVATAGGIO NUOVO INTERRUTTORE
    let wakeOnTrack = document.getElementById('wakeOnTrackToggle') ? document.getElementById('wakeOnTrackToggle').checked : true;

    localStorage.setItem('camilla_ss_timeout', ssTimeout);
    localStorage.setItem('camilla_ss_random', ssRandom);
    localStorage.setItem('camilla_vu_style', vuStyle);
    localStorage.setItem('camilla_ws_uri', wsUri);
    localStorage.setItem('moode_ui_url', moodeUrl);
    localStorage.setItem('camilla_stream_url', streamUrl);
    localStorage.setItem('camilla_backlight', backlight);
    localStorage.setItem('camilla_inline_vu', inlineVu);
    localStorage.setItem('camilla_local_analyzer', localAnalyzer);
    localStorage.setItem('camilla_device_layout', deviceLayout);
    localStorage.setItem('camilla_wake_on_track', wakeOnTrack);

    let settingsPayload = {
        ssTimeout: ssTimeout,
        ssRandom: ssRandom,
        vuStyle: vuStyle,
        wsUri: wsUri,
        moodeUrl: moodeUrl,
        streamUrl: streamUrl,
        backlight: backlight,
        inlineVu: inlineVu,
        localAnalyzer: localAnalyzer,
        deviceLayout: deviceLayout
    };

    fetch('mpd_bridge.php?action=set_default_settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsPayload)
    }).catch(e => console.error("Errore nel salvataggio impostazioni sul server:", e));

    if (typeof updateUITheme === 'function') updateUITheme(vuStyle);
    if (typeof applyDeviceLayout === 'function') applyDeviceLayout();
    if (typeof resetIdle === 'function') resetIdle();

    let inlineC = document.getElementById('inlineVuContainer');
    if (inlineC) {
        inlineC.style.display = inlineVu ? 'flex' : 'none';
    }
}

function openMoodeUI() { 
    let input = document.getElementById('moodeUiUrlInput');
    let url = input ? input.value : '';
    let iframe = document.getElementById('moodeIframe');
    if(iframe) iframe.src = url || ("http://" + (window.location.hostname || "127.0.0.1")); 
    let over = document.getElementById('moodeUiOverlay');
    if(over) over.style.display = 'flex'; 
}

function closeMoodeUI() { 
    let over = document.getElementById('moodeUiOverlay');
    if(over) over.style.display = 'none'; 
    let iframe = document.getElementById('moodeIframe');
    if(iframe) iframe.src = ''; 
}

window.addEventListener('resize', () => { 
    let dl = document.getElementById('deviceLayout');
    if (dl && dl.value === 'auto') applyDeviceLayout(); 
});

window.onload = async () => {
    // 1. Lingua e filtri
    let lng = typeof currentLang !== 'undefined' ? currentLang : (localStorage.getItem('hifi_language') || 'it');
    applyTranslations(lng);
    initAlphaFilters();
    
    // 2. Carica le impostazioni di base
    await loadSettings();
    
    // 3. Ottimizzazione sistema in background
    fetch(`${API}?action=sys_optimize&mode=startup`)
        .then(res => res.json())
        .then(data => {
            if (data.message) console.log("Startup Optimize:", data.message);
        })
        .catch(e => console.error("Errore ottimizzazione:", e));

    // 4. Inizializzazione motore grafico e salvaschermo
    if(typeof initScreensaverAndVU === 'function') {
        initScreensaverAndVU();
    }

    // 5. Mostra l'OSD in tempo reale mentre si muove lo slider
    let volSlider = document.getElementById('volSlider');
    if (volSlider) {
        volSlider.addEventListener('input', function() {
            showVolumeOSD(this.value, this.value == 0);
        });
    }
};

setInterval(fetchStatus, 400); 

setInterval(() => {
    let qTab = document.getElementById('tab-queue');
    if (qTab && qTab.classList.contains('active')) {
        loadQueue(false);
    }
}, 5000);

let statusAbortController = null;
let isFetchingStatus = false; 

async function fetchStatus() {
    if (isFetchingStatus) return; 
    isFetchingStatus = true;

    if (statusAbortController) statusAbortController.abort();
    statusAbortController = new AbortController();
    
    // Timeout di 3 secondi per capire se MPD è bloccato
    const timeoutId = setTimeout(() => statusAbortController.abort(), 3000);

    try {
        let res = await fetch(`${API}?action=status`, { signal: statusAbortController.signal });
        clearTimeout(timeoutId); 

        if (!res.ok) throw new Error('Network error');
        let d = await res.json();
        
        // --- GESTIONE VOLUME E TRIGGER OSD ---
        if (d.volume !== undefined) {
            let incomingVol = parseInt(d.volume);
            
            // Se il volume del server è diverso dall'ultimo che conoscevamo
            if (lastKnownVolume !== -1 && lastKnownVolume !== incomingVol) {
                
                // Mostra l'OSD solo se sono passati almeno 2 secondi dall'ultima 
                // volta che hai toccato lo slider a mano (evita il rimbalzo)
                if (Date.now() - lastLocalVolumeChange > 2000) {
                    let volSld = document.getElementById('volSlider');
                    if (volSld) volSld.value = incomingVol;
                    
                    showVolumeOSD(incomingVol, incomingVol === 0);
                    lastKnownVolume = incomingVol;
                }
            } else if (lastKnownVolume === -1) {
                // Inizializzazione al primo caricamento
                lastKnownVolume = incomingVol;
            }
        }
        
        // --- Aggiornamento Stato Play/Pausa Ottimizzato ---
        if (d.state) {
            let newIcon = d.state === 'play' ? '<i class="bi bi-pause-fill"></i>' : '<i class="bi bi-play-fill"></i>';
            ['btnPlay', 'ssBtnPlay', 'mpBtnPlay'].forEach(id => {
                let btn = document.getElementById(id);
                if (btn && btn.innerHTML !== newIcon) {
                    btn.innerHTML = newIcon;
                }
            });
        }
        
        // Richiama l'aggiornamento grafico
        if (typeof updateNowPlaying === 'function') {
            updateNowPlaying(d);
        }
        
    } catch (e) {
        // ===============================================================
        // GESTIONE OFFLINE: Intercetta il timeout o l'assenza di rete
        // ===============================================================
        let isStream = window.lastPlayedFile && (window.lastPlayedFile.startsWith('http') || window.lastPlayedFile.toUpperCase().includes('RADIO'));
        
        if (isStream && (e.name === 'AbortError' || !navigator.onLine)) {
            
            // 1. Forza l'uscita dal salvaschermo se l'utente era lì
            if (typeof exitScreensaver === 'function' && typeof ssActive !== 'undefined' && ssActive) {
                exitScreensaver();
            }

            // 2. Aggiorna visivamente il player senza bloccare il browser con alert
            let mainTitle = document.getElementById('mainTitle');
            if (mainTitle && mainTitle.textContent !== t('msg_network_error')) {
                mainTitle.textContent = t('msg_network_error'); // Usa la traduzione
                mainTitle.style.color = "#ff3d00"; 
                setTimeout(() => { mainTitle.style.color = ""; }, 5000); 
            }
            
            let ssTrackInfo = document.getElementById('ssTrackInfo');
            if (ssTrackInfo) ssTrackInfo.textContent = t('msg_offline'); // Usa la traduzione
            
            let btnPlay = document.getElementById('btnPlay');
            let newIcon = '<i class="bi bi-play-fill"></i>';
            if(btnPlay && btnPlay.innerHTML !== newIcon) btnPlay.innerHTML = newIcon;

            // 3. Invia il comando di STOP in background per sganciare MPD dal loop
            fetch(`${API}?action=command&cmd=stop`).catch(() => {});
        }
    } finally {
        isFetchingStatus = false;
    }
}

function updateNowPlaying(d) {
    try {
        currentDuration = d.duration || 0; 
        currentRepeat = d.repeat || '0'; 
        currentRandom = d.random || '0'; 
        rawInfoCache = d.raw_info || {};

        let safeTitle = d.title || t('msg_waiting');
        let safeArtist = d.artist || t('msg_unknown');
        let safeAlbum = (d.raw_info && d.raw_info.album) ? d.raw_info.album : '-';

        let mainTitleEl = document.getElementById('mainTitle');
        if (mainTitleEl) mainTitleEl.textContent = safeTitle;

        let mainArtistEl = document.getElementById('mainArtist');
        if (mainArtistEl) mainArtistEl.textContent = safeArtist;

        let infoAlbumEl = document.getElementById('infoAlbum');
        if (infoAlbumEl) infoAlbumEl.textContent = safeAlbum;

        let mpTitle = document.getElementById('mpTitle');
        if(mpTitle) {
            mpTitle.textContent = safeTitle; 
            let mpA = document.getElementById('mpArtist');
            if(mpA) mpA.textContent = safeArtist;
            
            let mpBP = document.getElementById('mpBtnPlay');
            let newMpIcon = d.state === 'play' ? '<i class="bi bi-pause-fill"></i>' : '<i class="bi bi-play-fill"></i>';
            if(mpBP && mpBP.innerHTML !== newMpIcon) mpBP.innerHTML = newMpIcon;
            
            let progEl = document.getElementById('mpProgress'); 
            if(progEl) progEl.style.width = (currentDuration > 0 ? ((d.elapsed || 0) / currentDuration) * 100 : 0) + '%';
        }

        let fileStr = d.file || ''; 
        let fileUpper = fileStr.toUpperCase();
        let isStream = (
            fileStr.startsWith('http://') || 
            fileStr.startsWith('https://') ||
            fileUpper.startsWith('RADIO/') || 
            fileUpper.startsWith('WEBRADIO/') ||
            fileUpper.endsWith('.M3U') ||
            fileUpper.endsWith('.PLS') ||
            fileUpper.endsWith('.M3U8')
        );

        // --- 1. RILEVAMENTO CAMBIO TRACCIA ---
        if (typeof window.lastPlayedFile === 'undefined') {
            window.lastPlayedFile = fileStr;
            window.lastPlayedTitle = safeTitle;
        }

        let fileChanged = (window.lastPlayedFile !== fileStr);
        let titleChanged = (window.lastPlayedTitle !== safeTitle);

        window.lastPlayedFile = fileStr;
        window.lastPlayedTitle = safeTitle;

        // --- 2. AZIONE: RITORNO AL PLAYER (CON ECCEZIONE RADIO E INTERRUTTORE) ---
        let shouldWakeUp = false;
        
        if (isStream) {
            // Radio: sveglia l'interfaccia SOLO se cambia la stazione (URL)
            shouldWakeUp = fileChanged;
        } else {
            // Audio locale: sveglia l'interfaccia se cambia il file o il titolo
            shouldWakeUp = (fileChanged || titleChanged);
        }

        // Legge lo stato dell'interruttore (di default è acceso)
        let wakeEnabled = localStorage.getItem('camilla_wake_on_track') !== 'false';

        // Scatta solo se il cambio traccia lo richiede E se l'interruttore è acceso
        if (shouldWakeUp && wakeEnabled) {
            
            if (typeof ssActive !== 'undefined' && ssActive) {
                if (typeof exitScreensaver === 'function') exitScreensaver();
            }

            let activeTab = document.querySelector('.tab-pane.active');
            if (activeTab && activeTab.id !== 'tab-nowplaying') {
                switchTab('nowplaying');
            }
        }

        let inferredExtension = '';
        if (isStream) {
            let cleanUrl = fileStr.split('?')[0].toLowerCase();
            let extMatch = cleanUrl.match(/\.([a-z0-9]+)$/);
            
            if (extMatch) {
                let ext = extMatch[1].toUpperCase();
                if (['M3U', 'PLS', 'M3U8'].includes(ext)) {
                    inferredExtension = 'WEB STREAM';
                } else {
                    inferredExtension = ext;
                }
            } else {
                if (cleanUrl.includes('aac')) inferredExtension = 'AAC';
                else if (cleanUrl.includes('flac')) inferredExtension = 'FLAC';
                else if (cleanUrl.includes('ogg')) inferredExtension = 'VORBIS';
                else if (cleanUrl.includes('opus')) inferredExtension = 'OPUS';
                else if (cleanUrl.includes('mp3')) inferredExtension = 'MP3';
                else if (d.audio_format) inferredExtension = 'WEB STREAM'; 
            }
        }

        let codec = isStream ? (inferredExtension || 'AUDIO') : (fileStr.split('.').pop().toUpperCase() || 'AUDIO');
        if (codec === 'M4A') codec = 'ALAC'; 
        if (codec === 'OGG') codec = 'VORBIS';
        if (codec === 'DSF' || codec === 'DFF') codec = 'DSD';
        
        if (!isStream && d.moode_meta && d.moode_meta.encoded) {
            let moodeCodec = d.moode_meta.encoded.split(',')[0].trim().toUpperCase();
            if (moodeCodec !== 'HW_PARAMS' && !moodeCodec.includes('ASOUND') && !moodeCodec.includes('/')) {
                codec = moodeCodec;
            }
        }

        let finalCoverUrl = d.coverUrl || '';
        if (finalCoverUrl === '/coverart.php') finalCoverUrl = '';

        if (isStream) {
            let stationLogo = '';
            if (typeof savedRadios !== 'undefined') {
                let matchedRadio = savedRadios.find(r =>
                    fileStr.includes(r.url) ||
                    r.url.includes(fileStr) ||
                    (d.title && r.name && d.title.toLowerCase().includes(r.name.toLowerCase())) ||
                    (d.artist && r.name && d.artist.toLowerCase().includes(r.name.toLowerCase()))
                );
                if (matchedRadio && matchedRadio.cover) {
                    stationLogo = matchedRadio.cover;
                }
            }
            if (!finalCoverUrl) {
                finalCoverUrl = stationLogo;
            }

            let stationNameTag = (d.raw_info && d.raw_info.name) ? d.raw_info.name : '';
            if (!stationNameTag && fileStr) {
                let parts = fileStr.split('/');
                stationNameTag = parts[parts.length - 1] || 'Web Radio';
            }
            
            if (safeArtist === 'Sconosciuto' || safeArtist === '') {
                safeArtist = stationNameTag;
                let mainArtistEl = document.getElementById('mainArtist');
                if (mainArtistEl) mainArtistEl.textContent = safeArtist;
            }
        }

        if (!isStream && safeAlbum === '-' && d.moode_meta && d.moode_meta.album) {
            safeAlbum = d.moode_meta.album;
            let infoAlbumEl = document.getElementById('infoAlbum');
            if (infoAlbumEl) infoAlbumEl.textContent = safeAlbum;
        }

        let sourceDetails = '';
        let formatStr = d.audio_format || ''; 
        let bitrate = (d.raw_info && d.raw_info.bitrate) ? parseInt(d.raw_info.bitrate) : 0; 

        if (formatStr) {
            if (formatStr.toLowerCase().includes('dsd')) {
                let p = formatStr.split(':');
                codec = p[0].toUpperCase(); 
                let dsdCh = p.length > 1 ? p[p.length - 1] : '2';
                let chStr = dsdCh === '2' ? '2ch' : (dsdCh === '1' ? '1ch' : dsdCh + 'ch');
                sourceDetails = `1-bit, ${chStr}`;
            } else if (formatStr.includes(':')) {
                let p = formatStr.split(':');
                let srRaw = parseInt(p[0]); 
                let bitsRaw = p[1]; 
                let chRaw = p[2];
                
                if (!isNaN(srRaw) && bitsRaw !== '?' && bitsRaw !== 'f') {
                    let srKhz = srRaw / 1000;
                    let srStr = srKhz % 1 === 0 ? srKhz : srKhz.toFixed(1); 
                    let chStr = chRaw === '2' ? '2ch' : (chRaw === '1' ? '1ch' : chRaw + 'ch'); 
                    sourceDetails = `PCM ${bitsRaw} bit ${srStr} kHz, ${chStr}`;
                }
            }
            
            if (bitrate > 0) {
                if (bitrate >= 1000) {
                    sourceDetails += `, ${(bitrate / 1000).toFixed(3)} Mbps`;
                } else {
                    sourceDetails += `, ${bitrate} kbps`;
                }
            }
        }

        let techLine1 = `${codec}`;
        if (sourceDetails) {
            techLine1 += ` | ${sourceDetails}`;
        }
        
        let techLine2 = ''; 
        if (d.dac_format && d.dac_rate) {
            let rateKhz = (parseInt(d.dac_rate) / 1000).toFixed(1);
            let bits = d.dac_format.replace(/[^0-9]/g, ''); 
            if (!bits) bits = "32"; 
            
            if (d.dac_format.includes('DSD')) {
                let rateMhz = (parseInt(d.dac_rate) / 1000000).toFixed(4);
                techLine2 = `<i class="bi bi-activity"></i> PCM (DoP) a DSD ${rateMhz} MHz`;
            } else {
                techLine2 = `<i class="bi bi-activity"></i> PCM ${rateKhz} kHz / ${bits}-bit`;
            }
        }

        if (isStream && fileStr) {
            if (techLine2 !== '') techLine2 += '<br>';
            techLine2 += `<i class="bi bi-link-45deg"></i> <span style="font-size: 0.85em; opacity: 0.8; word-break: break-all;">${fileStr}</span>`;
        }

        let infoContainer = document.getElementById('infoTechContainer');
        if(infoContainer) {
            if (d.state === 'play' || d.state === 'pause') { 
                infoContainer.style.display = 'block'; 
                let l1 = document.getElementById('infoTechLine1');
                if(l1) l1.textContent = techLine1; 
                let l2 = document.getElementById('infoTechLine2');
                if(l2) {
                    l2.innerHTML = techLine2; 
                    l2.style.display = techLine2 ? 'block' : 'none';
                }
            } else { 
                infoContainer.style.display = 'none'; 
            }
        }

        let ssTrackInfo = document.getElementById('ssTrackInfo');
        if (ssTrackInfo) {
            let rawTrack = (d.raw_info && d.raw_info.track) ? String(d.raw_info.track) : ''; 
            let tNum = rawTrack ? rawTrack.split('/')[0].padStart(2, '0') : '';
            let parts = []; 
            if (tNum) parts.push(`Track ${tNum}`); 
            if (safeAlbum !== '-') parts.push(safeAlbum); 
            parts.push(safeArtist); 
            parts.push(safeTitle);
            
            parts.push(codec); 
            if (sourceDetails) { 
                parts.push(sourceDetails); 
            }
            
            if (d.dac_format && d.dac_rate) {
                 let rateKhz = (parseInt(d.dac_rate) / 1000).toFixed(1);
                 let bits = d.dac_format.replace(/[^0-9]/g, '');
                 if (!bits) bits = "32";
                 if (d.dac_format.includes('DSD')) {
                     parts.push(`DAC: DSD ${ (parseInt(d.dac_rate) / 1000000).toFixed(4) } MHz`);
                 } else {
                     parts.push(`DAC: PCM ${rateKhz} kHz / ${bits}-bit`);
                 }
            }

            if (isStream && fileStr) {
                parts.push(`URL: ${fileStr}`);
            }
            
            let trackDisplay = parts.join('   -   ');
            if (ssTrackInfo.textContent !== trackDisplay) {
                ssTrackInfo.textContent = trackDisplay;
            }
        }

        let safeCover = finalCoverUrl ? finalCoverUrl.replace(/'/g, "\\'") : '';
        let mainCoverEl = document.getElementById('mainCover');
        let dynBgEl = document.getElementById('dynamicBackground');
        let mpCoverEl = document.getElementById('mpCover');
        
        if (safeCover) {
            if (mainCoverEl && mainCoverEl.dataset.currentCover !== safeCover) {
                mainCoverEl.dataset.currentCover = safeCover;
                mainCoverEl.style.backgroundImage = `url('${safeCover}')`;
                if (isStream) {
                    mainCoverEl.style.backgroundSize = 'contain';
                    mainCoverEl.style.backgroundRepeat = 'no-repeat';
                } else {
                    mainCoverEl.style.backgroundSize = 'cover';
                }
                mainCoverEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = 'none');
            }
            if (dynBgEl && dynBgEl.dataset.currentCover !== safeCover) {
                dynBgEl.dataset.currentCover = safeCover;
                dynBgEl.style.backgroundImage = `url('${safeCover}')`;
                dynBgEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = 'none');
            }
            if (mpCoverEl && mpCoverEl.dataset.currentCover !== safeCover) {
                mpCoverEl.dataset.currentCover = safeCover;
                mpCoverEl.style.backgroundImage = `url('${safeCover}')`;
                mpCoverEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = 'none');
            }
        } else {
            if (fileChanged || (!isStream && titleChanged) || (!isStream && mainCoverEl && mainCoverEl.dataset.currentCover !== 'none')) {
                if (mainCoverEl && mainCoverEl.dataset.currentCover !== 'none') {
                    mainCoverEl.dataset.currentCover = 'none';
                    mainCoverEl.style.backgroundImage = 'var(--ss-faceplate)';
                    mainCoverEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = '');
                }
                if (dynBgEl && dynBgEl.dataset.currentCover !== 'none') {
                    dynBgEl.dataset.currentCover = 'none';
                    dynBgEl.style.backgroundImage = 'radial-gradient(circle at 50% 30%, var(--hl-color) 0%, #000 80%)';
                    dynBgEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = '');
                }
                if (mpCoverEl && mpCoverEl.dataset.currentCover !== 'none') {
                    mpCoverEl.dataset.currentCover = 'none';
                    mpCoverEl.style.backgroundImage = 'var(--ss-faceplate)';
                    mpCoverEl.querySelectorAll('i, img, svg').forEach(el => el.style.display = '');
                }
            }
        }

        let btnRepeat = document.getElementById('btnRepeat');
        if(btnRepeat) btnRepeat.classList.toggle('active', d.repeat === '1'); 
        
        let ssBtnRepeat = document.getElementById('ssBtnRepeat');
        if(ssBtnRepeat) ssBtnRepeat.classList.toggle('active', d.repeat === '1');
        
        let btnRandom = document.getElementById('btnRandom');
        if(btnRandom) btnRandom.classList.toggle('active', d.random === '1');

        let ssBtnRandom = document.getElementById('ssBtnRandom');
        if(ssBtnRandom) ssBtnRandom.classList.toggle('active', d.random === '1');

        let ssBtnPlay = document.getElementById('ssBtnPlay');
        let newSsIcon = d.state === 'play' ? '<i class="bi bi-pause-fill"></i>' : '<i class="bi bi-play-fill"></i>';
        if(ssBtnPlay && ssBtnPlay.innerHTML !== newSsIcon) ssBtnPlay.innerHTML = newSsIcon;

        let camillaTgl = document.getElementById('camillaDspToggle');
        if (camillaTgl) {
            let wrapper = camillaTgl.closest('.simple-switch-wrapper');
            if (d.state === 'play') {
                camillaTgl.disabled = true;
                if (wrapper) {
                    wrapper.style.opacity = '0.4';
                    wrapper.style.cursor = 'not-allowed';
                    wrapper.title = t('tip_dsp_pause');
                }
            } else {
                camillaTgl.disabled = false;
                if (wrapper) {
                    wrapper.style.opacity = '1';
                    wrapper.style.cursor = 'default';
                    wrapper.title = "";
                }
            }
        }

        if (typeof isStreamingActive !== 'undefined' && isStreamingActive) {
            if(typeof disconnectCamilla === 'function') disconnectCamilla();
        } else if (d.state === 'play') {
            if(typeof connectCamilla === 'function') connectCamilla();
        } else {
            if(typeof disconnectCamilla === 'function') disconnectCamilla();
        }

        let muteIcon = document.getElementById('muteIcon');
        let btnMute = document.getElementById('btnMute');
        if (muteIcon && btnMute) {
            if(d.volume === 0) { 
                muteIcon.className = 'bi bi-volume-mute-fill'; 
                btnMute.classList.add('mute-active'); 
            } else { 
                muteIcon.className = 'bi bi-volume-up-fill'; 
                btnMute.classList.remove('mute-active'); 
            }
        }

        let elElapsed = document.getElementById('timeElapsed');
        if(elElapsed) elElapsed.textContent = formatTime(d.elapsed); 
        
        let elTotal = document.getElementById('timeTotal');
        if(elTotal) elTotal.textContent = formatTime(currentDuration);
        
        let progFill = document.getElementById('progressFill');
        if(progFill) progFill.style.width = (currentDuration > 0 ? ((d.elapsed || 0) / currentDuration) * 100 : 0) + '%';
        
        let volSlider = document.getElementById('volSlider');
        if(volSlider && document.activeElement !== volSlider) {
            volSlider.value = d.volume || 0;
            let localPlayer = document.getElementById('localAudioPlayer');
            if (localPlayer) {
                localPlayer.volume = (d.volume || 0) / 100;
            }
        }
    } catch(err) {
        console.error(err);
    }
}

async function sendCmd(cmd, param = '', type = '') { 
    let btnPlay = document.getElementById('btnPlay');
    let isCurrentlyPlaying = btnPlay && btnPlay.innerHTML.includes('pause-fill');
    let finalCmd = cmd;

    // Bypass rapido per toggle (decide se mettere in pausa o stop)
    if (cmd === 'toggle') {
        let isStream = window.lastPlayedFile && (
            window.lastPlayedFile.startsWith('http') || 
            window.lastPlayedFile.toUpperCase().includes('RADIO')
        );
        finalCmd = isCurrentlyPlaying ? (isStream ? 'stop' : 'pause') : 'play';
    }

    // Raggruppamento delle azioni per semplificare la logica
    let isPlayAction = ['play', 'next', 'previous', 'playid'].includes(finalCmd);
    let isStopAction = ['pause', 'stop'].includes(finalCmd);

    if (isPlayAction || isStopAction) {
        
        // 1. Aggiornamento UI Immediato e Uniformato
        let newIcon = isPlayAction 
            ? '<i class="bi bi-pause-fill"></i>' 
            : '<i class="bi bi-play-fill"></i>';
        
        ['btnPlay', 'ssBtnPlay', 'mpBtnPlay'].forEach(id => {
            let btn = document.getElementById(id);
            if (btn && btn.innerHTML !== newIcon) {
                btn.innerHTML = newIcon;
            }
        });

        // 2. Gestione Sincronizzata del Player Locale (Svuota buffer e ricarica)
        let localPlayer = document.getElementById('localAudioPlayer');
        
        if (localPlayer && typeof isStreamingActive !== 'undefined' && isStreamingActive) {
            
            if (isStopAction) {
                // Ferma e svuota il buffer di colpo
                localPlayer.pause();
                localPlayer.removeAttribute('src');
                localPlayer.load();
                if(typeof disconnectLocalAnalyzer === 'function') disconnectLocalAnalyzer();
                
            } else if (isPlayAction) {
                // Per Next, Prev e PlayID dobbiamo obbligare il browser a tagliare il buffer 
                // della traccia vecchia prima di ricaricare il flusso HTTP dal server.
                if (['next', 'previous', 'playid'].includes(finalCmd)) {
                    localPlayer.pause();
                    localPlayer.removeAttribute('src');
                    localPlayer.load();
                }

                // Fai ripartire lo stream fresco con nuovo timestamp anticascata
                let streamUrl = document.getElementById('streamUrlInput') ? document.getElementById('streamUrlInput').value : '';
                if (streamUrl) {
                    localPlayer.src = streamUrl + "?t=" + new Date().getTime();
                    localPlayer.play().then(() => {
                        if(typeof connectLocalAnalyzer === 'function') connectLocalAnalyzer();
                    }).catch(e => console.log("Attesa interazione utente per l'audio locale", e));
                }
            }
        }
    }

    // Invio comando al server in background
    let url = `${API}?action=command&cmd=${finalCmd}&param=${encodeURIComponent(param)}`; 
    if(type) url += `&type=${encodeURIComponent(type)}`; 
    
    fetch(url).then(() => fetchStatus()).catch(e => console.error(e)); 
}

function playAdd(path, type = 'file', mode = 'play') { 
    if (event) event.stopPropagation(); 
    let url = `${API}?action=command&cmd=addplay&param=${encodeURIComponent(path)}&type=${encodeURIComponent(type)}&mode=${mode}`; 
    
    if (mode === 'play') {
        // Uniforma l'icona Play subito
        let newIcon = '<i class="bi bi-pause-fill"></i>';
        ['btnPlay', 'ssBtnPlay', 'mpBtnPlay'].forEach(id => {
            let btn = document.getElementById(id);
            if (btn && btn.innerHTML !== newIcon) btn.innerHTML = newIcon;
        });

        // Svuota buffer se siamo in cuffia
        let localPlayer = document.getElementById('localAudioPlayer');
        if (localPlayer && typeof isStreamingActive !== 'undefined' && isStreamingActive) {
            localPlayer.pause();
            localPlayer.removeAttribute('src');
            localPlayer.load();
            
            let streamUrl = document.getElementById('streamUrlInput') ? document.getElementById('streamUrlInput').value : '';
            if (streamUrl) {
                localPlayer.src = streamUrl + "?t=" + new Date().getTime();
                localPlayer.play().then(() => {
                    if(typeof connectLocalAnalyzer === 'function') connectLocalAnalyzer();
                }).catch(e => console.log("Attesa interazione utente", e));
            }
        }
        
        switchTab('nowplaying'); 
    }

    fetch(url).then(() => { 
        fetchStatus(); 
        if(mode === 'enqueue') alert(t('msg_added_queue')); 
    }); 
}

function seekTrack(e) { 
    if (currentDuration === 0) return; 
    let pBg = document.getElementById('progressBg');
    if(!pBg) return;
    const rect = pBg.getBoundingClientRect(); 
    sendCmd('seek', Math.floor(((e.clientX - rect.left) / rect.width) * currentDuration)); 
}

async function loadQueue(forceScroll = false) { 
    let data = await (await fetch(`${API}?action=queue`)).json(); 
    if(!Array.isArray(data)) data = []; 
    let html = '';
    let currentlyPlayingId = null; 
    
    data.forEach((s, i) => { 
        if (s.current) currentlyPlayingId = s.id; 
        html += `<div class="list-item ${s.current ? 'queue-playing' : ''}"><div style="width:30px; color:#777;">${i+1}</div><div class="list-item-content" onclick="sendCmd('playid', '${s.id}')"><div style="font-weight:bold; color:#fff;">${s.title}</div><div style="font-size:0.8rem; color:#aaa;">${s.artist || s.file}</div></div><div style="color:#777; margin-right: 1rem;">${formatTime(s.duration)}</div><button class="btn-addplay" style="width:auto; margin-top:0;" onclick="sendCmd('playid', '${s.id}')"><i class="bi bi-play-fill"></i></button></div>`; 
    }); 
    
    let qList = document.getElementById('queueList');
    if(qList) qList.innerHTML = html || `<div style="padding:2rem; text-align:center;">${t('msg_empty')}</div>`; 
    
    if (forceScroll || currentlyPlayingId !== lastPlayingId) { 
        lastPlayingId = currentlyPlayingId; 
        setTimeout(() => { 
            let playingEl = document.querySelector('.queue-playing'); 
            if (playingEl) playingEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
        }, 100); 
    } 
}

function toggleLocalStream() {
    let player = document.getElementById('localAudioPlayer');
    let btn = document.getElementById('btnLocalStream');
    let streamUrl = document.getElementById('streamUrlInput').value;

    if (!streamUrl) { alert(t('msg_stream_url_missing')); return; }

    if (player.paused) {
        player.src = streamUrl + "?t=" + new Date().getTime();
        player.play().then(() => {
            btn.style.color = 'var(--hl-color)';
            btn.style.textShadow = '0 0 10px var(--hl-glow)';
            isStreamingActive = true;
            if(typeof disconnectCamilla === 'function') disconnectCamilla();
            if(typeof connectLocalAnalyzer === 'function') connectLocalAnalyzer();
        }).catch(e => alert(t('msg_stream_error') + e.message));
    } else {
        player.pause();
        
        // --- INIZIO MODIFICA: Svuotamento istantaneo del buffer ---
        player.removeAttribute('src'); 
        player.load(); 
        // --- FINE MODIFICA ---

        btn.style.color = '#aaa';
        btn.style.textShadow = 'none';
        isStreamingActive = false;
        if(typeof disconnectLocalAnalyzer === 'function') disconnectLocalAnalyzer();
        let playBtnHtml = document.getElementById('btnPlay').innerHTML || "";
        if (playBtnHtml.includes('pause-fill')) {
            if(typeof connectCamilla === 'function') connectCamilla();
        }
    }
}

async function clearQueue() { 
    if(confirm(t('confirm_clear_queue'))) { 
        await fetch(`${API}?action=command&cmd=clear`); 
        loadQueue(); 
    } 
}

async function savePlaylist() { 
    let name = prompt(t('prompt_playlist_name')); 
    if(name && name.trim() !== "") { 
        await fetch(`${API}?action=command&cmd=save_playlist&param=${encodeURIComponent(name.trim())}`); 
        alert(t('msg_playlist_saved')); 
    } 
}

async function loadPlaylists() { 
    let plGrid = document.getElementById('playlistGrid');
    if(plGrid) plGrid.innerHTML = `<div style="padding:2rem; text-align:center;">${t('msg_loading')}</div>`; 
    
    let data = await (await fetch(`${API}?action=playlists`)).json(); 
    if(!Array.isArray(data)) data = []; 
    let html = ''; 
    data.forEach(p => { 
        let safeP = p.replace(/'/g, "\\'"); 
        let sortChar = p ? p.charAt(0).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : '#';
        if (!/[A-Z]/.test(sortChar)) sortChar = '#';

        html += `<div class="list-item" data-letter="${sortChar}"><i class="bi bi-journal-album" style="font-size:1.5rem; color:#888; margin-right:15px;"></i><div class="list-item-content" onclick="playPlaylist('${safeP}')"><div style="font-weight:bold; font-size:1.1rem; color:#fff;">${p}</div></div><div style="display:flex; gap: 5px;"><button class="btn-addplay" style="width:auto; margin-top:0;" onclick="playPlaylist('${safeP}')"><i class="bi bi-play-fill"></i> Play</button><button class="btn-addplay" style="width:auto; margin-top:0; border-color:rgba(220,53,69,0.5); color:#dc3545; background:rgba(220,53,69,0.1);" onclick="deletePlaylist('${safeP}')"><i class="bi bi-trash3"></i></button></div></div>`; 
    }); 
    if(plGrid) plGrid.innerHTML = html || `<div style="padding:2rem; text-align:center;">${t('msg_empty')}</div>`; 
    
    let alphaPl = document.getElementById('alpha-playlists');
    if(alphaPl) { alphaPl.style.display = 'flex'; resetAlphaFilter('alpha-playlists', 'playlistGrid'); }
}

function playPlaylist(name) { 
    fetch(`${API}?action=command&cmd=load_playlist&param=${encodeURIComponent(name)}`).then(() => { 
        switchTab('nowplaying'); 
        fetchStatus(); 
    }); 
}

function deletePlaylist(name) { 
    if(confirm(`${t('confirm_delete_playlist')} "${name}"?`)) {
        fetch(`${API}?action=command&cmd=delete_playlist&param=${encodeURIComponent(name)}`).then(() => { 
            loadPlaylists(); 
        }); 
    }
}

async function loadFolders(path, useCache = false) {
    currentFolderPath = path;
    let pathLabel = document.getElementById('folderPath');
    if(pathLabel) pathLabel.textContent = path ? '/' + path : '/ (Root)';
    
    let mode = viewModes['folderGrid'];
    let fGrid = document.getElementById('folderGrid');
    if(fGrid) fGrid.className = mode === 'grid' ? 'grid-container' : 'list-container';

    if (!useCache || cachedFolders.path !== path) {
        if(fGrid) fGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_loading')}</div>`;
        let data = await (await fetch(`${API}?action=browse&uri=${encodeURIComponent(path)}`)).json();
        cachedFolders.data = Array.isArray(data) ? data : [];
        cachedFolders.path = path;
    }

    let html = '';
    cachedFolders.data.forEach(d => {
        let safePath = d.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        let icon = d.type === 'directory' ? 'bi-folder2-open' : (d.type === 'playlist' ? 'bi-music-note-list' : 'bi-music-note');
        let sub = d.type === 'directory' ? t('item_folder') : (d.type === 'playlist' ? t('item_playlist') : t('item_track'));
        let displayName = d.name;
        let isDirOrPlaylist = (d.type === 'directory' || d.type === 'playlist');

        let pathUpper = safePath.toUpperCase();

        if (path === '') {
            if (pathUpper === 'NAS') { icon = 'bi-hdd-network'; d.coverUrl = ''; }
            else if (pathUpper === 'OSDISK' || pathUpper === 'USB') { icon = 'bi-device-hdd'; d.coverUrl = ''; }
            else if (pathUpper === 'RADIO' || pathUpper === 'WEBRADIO') { icon = 'bi-broadcast'; d.coverUrl = ''; }
            else if (pathUpper.includes('DEFAULT') || d.type === 'playlist') { icon = 'bi-music-note-list'; d.coverUrl = ''; }
        }

        if (d.type !== 'directory' && (pathUpper.startsWith('RADIO/') || pathUpper.startsWith('WEBRADIO/'))) {
            icon = 'bi-broadcast';
            sub = 'Web Radio';
            displayName = displayName.replace(/\.(pls|m3u|m3u8)$/i, '');
            isDirOrPlaylist = false; 
        }

        html += buildItemHtml(mode, null, safePath, d.coverUrl, displayName, sub, isDirOrPlaylist, icon);
    });
    
    if(fGrid) fGrid.innerHTML = html || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`;
    document.querySelectorAll('#folderGrid .grid-item, #folderGrid .list-item').forEach(el => coverObserver.observe(el));
    
    let alphaFold = document.getElementById('alpha-folders');
    if(alphaFold) {
        alphaFold.style.display = 'flex';
        resetAlphaFilter('alpha-folders', 'folderGrid');
    }
}

function navFoldersUp() { 
    if(!currentFolderPath) return; 
    let p = currentFolderPath.split('/'); 
    p.pop(); 
    loadFolders(p.join('/')); 
}

async function loadAlbums(useCache = false) {
    albumState.active = false; 
    let backBtn = document.getElementById('albumBackBtn');
    if(backBtn) backBtn.style.display = 'none'; 
    let aPath = document.getElementById('albumPath');
    if(aPath) aPath.textContent = t('tab_albums');
    
    let mode = viewModes['albumGrid']; 
    let aGrid = document.getElementById('albumGrid');
    if(aGrid) aGrid.className = mode === 'grid' ? 'grid-container' : 'list-container';
    
    if (!useCache || cachedAlbums === null) {
        if(aGrid) aGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_loading')}</div>`;
        let data = await (await fetch(`${API}?action=albums`)).json(); 
        cachedAlbums = Array.isArray(data) ? data : [];
    }
    let html = '';
    cachedAlbums.forEach(a => { 
        let dataAttr = a.replace(/"/g, '&quot;'); 
        let safeAlbum = a.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
        html += buildItemHtml(mode, dataAttr, safeAlbum, null, a, t('item_album'), false, 'bi-disc'); 
    });
    if(aGrid) aGrid.innerHTML = html || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`;
    document.querySelectorAll('#albumGrid .grid-item, #albumGrid .list-item').forEach(el => coverObserver.observe(el));
    
    let alphaAlbums = document.getElementById('alpha-albums');
    if(alphaAlbums) { alphaAlbums.style.display = 'flex'; resetAlphaFilter('alpha-albums', 'albumGrid'); }
}

async function loadAlbumTracks(album, context = 'album', useCache = false) { 
    let gridId = context === 'album' ? 'albumGrid' : 'artistGrid'; 
    let mode = viewModes[gridId]; 
    let gEl = document.getElementById(gridId);
    if(gEl) gEl.className = mode === 'grid' ? 'grid-container' : 'list-container'; 
    
    if (context === 'album') { 
        albumState.active = true; 
        let bb = document.getElementById('albumBackBtn'); if(bb) bb.style.display = 'flex'; 
        let ap = document.getElementById('albumPath'); if(ap) ap.textContent = album; 
        let aa = document.getElementById('alpha-albums'); if(aa) aa.style.display = 'none'; 
    } else { 
        artistState.album = album; 
        let ap = document.getElementById('artistPath'); if(ap) ap.textContent = `${artistState.artist} / ${album}`; 
        let aa = document.getElementById('alpha-artists'); if(aa) aa.style.display = 'none'; 
    } 
    let cacheKey = context + '_' + album;
    if (!useCache || cachedSubLevel.id !== cacheKey) { 
        if(gEl) gEl.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem;">${t('msg_loading')}</div>`; 
        let data = await (await fetch(`${API}?action=album_tracks&album=${encodeURIComponent(album)}`)).json(); 
        cachedSubLevel.data = Array.isArray(data) ? data : []; 
        cachedSubLevel.id = cacheKey; 
    }
    let html = ''; 
    cachedSubLevel.data.forEach(d => { 
        let safeFile = d.file.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
        html += buildItemHtml(mode, null, safeFile, d.coverUrl, d.title, `${t('item_track')} ${d.track || ''}`, false, 'bi-music-note'); 
    }); 
    if(gEl) gEl.innerHTML = html || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`; 
}

function navAlbumsUp() { if (albumState.active) loadAlbums(); }

async function loadArtists(useCache = false) { 
    artistState.artist = ''; artistState.album = ''; 
    let abb = document.getElementById('artistBackBtn'); if(abb) abb.style.display = 'none'; 
    let ap = document.getElementById('artistPath'); if(ap) ap.textContent = t('tab_artists'); 
    let mode = viewModes['artistGrid']; 
    let ag = document.getElementById('artistGrid');
    if(ag) ag.className = mode === 'grid' ? 'grid-container' : 'list-container'; 
    
    if (!useCache || cachedArtists === null) { 
        if(ag) ag.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_loading')}</div>`; 
        let data = await (await fetch(`${API}?action=artists`)).json(); 
        cachedArtists = Array.isArray(data) ? data : []; 
    }
    let html = ''; 
    cachedArtists.forEach(a => { 
        let dataAttr = a.replace(/"/g, '&quot;'); 
        let safeArtist = a.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
        html += buildItemHtml(mode, dataAttr, safeArtist, null, a, t('item_artist'), false, 'bi-person-lines-fill'); 
    }); 
    if(ag) ag.innerHTML = html || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`; 
    document.querySelectorAll('#artistGrid .grid-item, #artistGrid .list-item').forEach(el => coverObserver.observe(el)); 
    
    let aart = document.getElementById('alpha-artists');
    if(aart) { aart.style.display = 'flex'; resetAlphaFilter('alpha-artists', 'artistGrid'); }
}

async function loadArtistAlbums(artist, useCache = false) { 
    artistState.artist = artist; artistState.album = ''; 
    let abb = document.getElementById('artistBackBtn'); if(abb) abb.style.display = 'flex'; 
    let ap = document.getElementById('artistPath'); if(ap) ap.textContent = artist; 
    let aart = document.getElementById('alpha-artists'); if(aart) aart.style.display = 'none';
    
    let mode = viewModes['artistGrid']; 
    let ag = document.getElementById('artistGrid');
    if(ag) ag.className = mode === 'grid' ? 'grid-container' : 'list-container'; 
    
    let cacheKey = 'artist_alb_' + artist;
    if (!useCache || cachedSubLevel.id !== cacheKey) { 
        if(ag) ag.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_loading')}</div>`; 
        let data = await (await fetch(`${API}?action=artist_albums&artist=${encodeURIComponent(artist)}`)).json(); 
        cachedSubLevel.data = Array.isArray(data) ? data : []; 
        cachedSubLevel.id = cacheKey; 
    }
    let html = ''; 
    cachedSubLevel.data.forEach(album => { 
        let dataAttr = album.replace(/"/g, '&quot;'); 
        let safeAlbum = album.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
        html += buildItemHtml(mode, dataAttr, safeAlbum, null, album, t('item_album'), false, 'bi-disc'); 
    }); 
    if(ag) ag.innerHTML = html || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`; 
    document.querySelectorAll('#artistGrid .grid-item, #artistGrid .list-item').forEach(el => coverObserver.observe(el)); 
}

function navArtistsUp() { if (artistState.album) loadArtistAlbums(artistState.artist); else if (artistState.artist) loadArtists(); }

function updateSearchDisplay() { 
    let si = document.getElementById('searchInput');
    if(si) si.textContent = searchString || '_'; 
}

function kbType(char) { searchString += char; updateSearchDisplay(); } 
function kbDel() { searchString = searchString.slice(0, -1); updateSearchDisplay(); } 
function kbClear() { 
    searchString = ''; updateSearchDisplay(); 
    let sg = document.getElementById('searchGrid');
    if(sg) sg.innerHTML = ''; 
}

async function doSearch(useCache = false) { 
    if(!searchString) return; 
    let mode = viewModes['searchGrid']; 
    let sg = document.getElementById('searchGrid');
    if(sg) sg.className = mode === 'grid' ? 'grid-container' : 'list-container'; 
    
    if (!useCache) {
        if(sg) sg.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_loading')}</div>`; 
        cachedSearchResults = []; 
        try { 
            let searchTypeEl = document.getElementById('searchType');
            let searchType = searchTypeEl ? searchTypeEl.value : 'any'; 
            let lowerQ = searchString.toLowerCase(); 
            
            if (searchType === 'any' || searchType === 'radio') { 
                let localRadios = (typeof savedRadios !== 'undefined' ? savedRadios : []).filter(r => r.name.toLowerCase().includes(lowerQ) || r.url.toLowerCase().includes(lowerQ)); 
                localRadios.forEach(r => { 
                    cachedSearchResults.push({ dataAttr: null, safeParam: r.url.replace(/'/g, "\\'"), coverUrl: r.cover || '', titleStr: r.name, subStr: 'Web Radio (Custom)', isDir: false, iconClass: 'bi-broadcast' }); 
                }); 
            } 
            if (searchType === 'radio') { 
                let res = await fetch(`${API}?action=browse&uri=RADIO`); 
                if (res.ok) { 
                    let data = await res.json(); 
                    let mpdRadios = Array.isArray(data) ? data.filter(d => d.type !== 'directory') : []; 
                    mpdRadios.forEach(d => { 
                        let nameStr = d.name || d.title || ''; 
                        if (nameStr.toLowerCase().includes(lowerQ)) { 
                            let safePath = d.path.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
                            let cleanName = nameStr.replace(/\.(pls|m3u|m3u8)$/i, ''); 
                            let isPls = (d.type === 'playlist' || nameStr.toLowerCase().endsWith('.pls') || nameStr.toLowerCase().endsWith('.m3u')); 
                            cachedSearchResults.push({ dataAttr: null, safeParam: safePath, coverUrl: '', titleStr: cleanName, subStr: isPls ? t('item_playlist') : 'Web Radio', isDir: false, iconClass: 'bi-broadcast' }); 
                        } 
                    }); 
                } 
            } 
            if (searchType !== 'radio') { 
                let currentAppLang = (typeof currentLang !== 'undefined') ? currentLang : (localStorage.getItem('hifi_language') || 'it');
                let response = await fetch(`${API}?action=search&type=${searchType}&q=${encodeURIComponent(searchString)}&lang=${currentAppLang}`); 
                
                if (!response.ok) throw new Error("Errore Rete"); 
                let data = await response.json(); 
                if(!Array.isArray(data)) data = []; 
                if (data.length > 0) { 
                    data.forEach(d => { 
                        let itemType = d.type || 'file', rawParam = d.file; 
                        if (itemType === 'album' || itemType === 'artist') rawParam = d.name; 
                        if (itemType === 'directory') rawParam = d.path; 
                        let safeParam = (rawParam || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
                        let titleStr = d.title || d.name || t('msg_unknown');
                        let subStr = d.artist || d.album || '-'; 
                        if (itemType === 'album') subStr = t('item_album'); 
                        if (itemType === 'artist') subStr = t('item_artist'); 
                        if (itemType === 'directory') subStr = t('item_folder'); 
                        let iconClass = 'bi-music-note'; 
                        if (itemType === 'album') iconClass = 'bi-disc'; 
                        if (itemType === 'artist') iconClass = 'bi-person-lines-fill'; 
                        if (itemType === 'directory') iconClass = 'bi-folder2-open'; 
                        if (rawParam && rawParam.toUpperCase().startsWith('RADIO/')) { 
                            iconClass = 'bi-broadcast'; subStr = 'Web Radio'; titleStr = titleStr.replace(/\.(pls|m3u|m3u8)$/i, ''); 
                        } 
                        let dataAttr = (itemType === 'album' || itemType === 'artist') ? safeParam : null; 
                        cachedSearchResults.push({ dataAttr: dataAttr, safeParam: safeParam, coverUrl: d.coverUrl, titleStr: titleStr, subStr: subStr, isDir: itemType === 'directory', iconClass: iconClass }); 
                    }); 
                } 
            } 
        } catch (err) { 
            if(sg) sg.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: #dc3545; padding: 2rem;">Errore Server.</div>'; 
            return; 
        } 
    }
    let resultsHtml = ''; 
    cachedSearchResults.forEach(item => { 
        resultsHtml += buildItemHtml(mode, item.dataAttr, item.safeParam, item.coverUrl, item.titleStr, item.subStr, item.isDir, item.iconClass); 
    });
    if(sg) sg.innerHTML = resultsHtml || `<div style="grid-column:1/-1; text-align:center; padding: 2rem;">${t('msg_empty')}</div>`; 
}

function formatTime(s) { 
    if (!s) return '0:00'; 
    let m = Math.floor(s / 60), secs = Math.floor(s % 60); 
    return `${m}:${secs < 10 ? '0' : ''}${secs}`; 
}

function switchTab(tabId) {
    let currentActive = document.querySelector('.tab-pane.active');
    let isAlreadyActive = (currentActive && currentActive.id === 'tab-' + tabId);

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); 
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    let activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`); if(activeBtn) activeBtn.classList.add('active');
    let activePane = document.getElementById('tab-' + tabId); if(activePane) activePane.classList.add('active');
    
    let ma = document.getElementById('mainArea');
    if(ma) ma.scrollTo({ top: 0, behavior: 'smooth' });
    
    let miniPlayer = document.getElementById('miniPlayer'); 
    if (miniPlayer) miniPlayer.style.display = (tabId === 'nowplaying') ? 'none' : 'flex';
    
    if(tabId === 'queue') {
        loadQueue(!isAlreadyActive); 
    }
    
    if(tabId === 'webradio') renderRadioList(true); 
    if(tabId === 'folders') loadFolders(currentFolderPath, true); 
    if(tabId === 'albums') { if(albumState.active) loadAlbumTracks(albumState.album, 'album', true); else loadAlbums(true); } 
    if(tabId === 'playlists') loadPlaylists(); 
    if(tabId === 'artists') { if(artistState.album) loadAlbumTracks(artistState.album, 'artist', true); else if(artistState.artist) loadArtistAlbums(artistState.artist, true); else loadArtists(true); } 
    if(tabId === 'search' && searchString) doSearch(true); 
    if(tabId === 'favorites') renderFavorites();
}

async function clearRackCache(btn) { 
    if (confirm(t('confirm_sync'))) { 
        let so = document.getElementById('syncOverlay');
        if(so) so.style.display = 'flex'; 
        cachedFolders = { path: null, data: [] }; cachedAlbums = null; cachedArtists = null; cachedSubLevel = { id: null, data: [] }; cachedMpdRadios = null; cachedRbRadios = null;
        try { 
            await fetch(`${API}?action=clear_cache`); 
            alert(t('msg_sync_ok')); 
        } catch(e) { 
            alert(t('msg_error')); 
        } 
        if(so) so.style.display = 'none'; 
        let alg = document.getElementById('albumGrid'); if(alg) alg.innerHTML = ''; 
        let artg = document.getElementById('artistGrid'); if(artg) artg.innerHTML = ''; 
        let fog = document.getElementById('folderGrid'); if(fog) fog.innerHTML = ''; 
        let actTab = document.querySelector('.tab-pane.active');
        if(actTab) {
            let tId = actTab.id.replace('tab-', ''); 
            if (['albums', 'artists', 'folders'].includes(tId)) switchTab(tId); 
        }
    } 
}

function initAlphaFilters() {
    const containers = { 
        'alpha-webradio': 'radioListGrid', 
        'alpha-albums': 'albumGrid', 
        'alpha-artists': 'artistGrid',
        'alpha-favorites': 'favoritesGrid',
        'alpha-playlists': 'playlistGrid',
        'alpha-folders': 'folderGrid'
    };
    const chars = ['ALL', '#', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    for (let [containerId, targetGrid] of Object.entries(containers)) { 
        let el = document.getElementById(containerId); 
        if (!el) continue; 
        let html = ''; 
        chars.forEach(c => { 
            let label = c === 'ALL' ? 'Tutti' : c, active = c === 'ALL' ? 'active' : ''; 
            html += `<button class="alpha-btn ${active}" onclick="applyAlphaFilter('${targetGrid}', '${c}', this, '${containerId}')">${label}</button>`; 
        }); 
        el.innerHTML = html; 
    }
}

function applyAlphaFilter(gridId, letter, btn, filterContainerId) {
    let filterContainer = document.getElementById(filterContainerId); 
    if(filterContainer) { 
        filterContainer.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active')); 
        if(btn) btn.classList.add('active'); 
    }
    let grid = document.getElementById(gridId); if(!grid) return;
    let items = grid.querySelectorAll('.grid-item, .list-item'); 
    items.forEach(item => { 
        let itemLetter = item.getAttribute('data-letter'); 
        if(letter === 'ALL' || itemLetter === letter) { item.style.display = ''; } else { item.style.display = 'none'; } 
    });
    if (gridId === 'radioListGrid') { 
        let headers = grid.querySelectorAll('.radio-group-header'); 
        headers.forEach(h => { h.style.display = letter === 'ALL' ? 'block' : 'none'; }); 
    }
}

function resetAlphaFilter(containerId, gridId) { 
    let container = document.getElementById(containerId); 
    if(container) { 
        let allBtn = container.querySelector('.alpha-btn'); 
        if(allBtn) applyAlphaFilter(gridId, 'ALL', allBtn, containerId); 
    } 
}

function toggleUniversalFav(btn, type, path, title, cover, subtitle, iconClass) {
    let index = universalFavorites.findIndex(f => f.path === path); 
    let isFav = false;
    
    if (index > -1) { 
        universalFavorites.splice(index, 1); isFav = false; 
    } else { 
        universalFavorites.push({ type, path, title, cover, subtitle, iconClass }); isFav = true; 
    }
    localStorage.setItem('hifi_universal_favs', JSON.stringify(universalFavorites));
    
    if (btn) { 
        let icon = btn.querySelector('i'); 
        if (icon) { icon.className = isFav ? 'bi bi-heart-fill' : 'bi bi-heart'; } 
        btn.style.color = isFav ? '#dc3545' : '#aaa'; 
    }
    
    let activeTab = document.querySelector('.tab-pane.active'); 
    if (activeTab && activeTab.id === 'tab-favorites') { renderFavorites(); }
}

function renderFavorites() {
    const grid = document.getElementById('favoritesGrid');
    const navBar = document.getElementById('favNavButtons'); 
    if(!grid || !navBar) return;

    let mode = 'grid'; 
    grid.className = mode === 'grid' ? 'grid-container' : 'list-container';
    
    if (universalFavorites.length === 0) { 
        navBar.innerHTML = ''; 
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 2rem; color: #aaa;">${t('msg_empty')}</div>`; 
        return; 
    }
    
    const categories = { 
        'directory': { label: t('item_folder'), icon: 'bi-folder2-open', items: [] }, 
        'album': { label: t('item_album'), icon: 'bi-disc', items: [] }, 
        'artist': { label: t('item_artist'), icon: 'bi-person-lines-fill', items: [] }, 
        'file': { label: 'Web Radio & Tracce', icon: 'bi-broadcast', items: [] }, 
        'playlist': { label: t('item_playlist'), icon: 'bi-music-note-list', items: [] } 
    };
    
    universalFavorites.forEach(f => { 
        if (categories[f.type]) { categories[f.type].items.push(f); } 
        else { categories['file'].items.push(f); } 
    });
    
    let html = '', navHtml = '';
    Object.keys(categories).forEach(catKey => {
        let cat = categories[catKey];
        if (cat.items.length > 0) {
            let sectionId = `fav-sec-${catKey}`;
            navHtml += `<button class="btn-addplay" style="width:auto; margin:0; padding: 0.5rem 1rem;" onclick="jumpToFavCategory('${sectionId}')"><i class="bi ${cat.icon}"></i> ${cat.label} (${cat.items.length})</button>`;
            html += `<div id="${sectionId}" class="radio-group-header" style="grid-column:1/-1; padding: 1.5rem 1rem 0.5rem 1rem; color: var(--hl-color); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 0.5rem; font-size: 1.2rem;"><i class="bi ${cat.icon}"></i> ${cat.label}</div>`;
            cat.items.forEach(item => { 
                let safePath = item.path.replace(/'/g, "\\'");
                let dataAttr = (item.type === 'album' || item.type === 'artist') ? safePath : null; 
                html += buildItemHtml(mode, dataAttr, safePath, item.cover, item.title, item.subtitle, item.type === 'directory', item.iconClass); 
            });
        }
    });
    navBar.innerHTML = navHtml; 
    grid.innerHTML = html;
    
    document.querySelectorAll('#favoritesGrid .grid-item, #favoritesGrid .list-item').forEach(el => coverObserver.observe(el));
    
    let alphaFav = document.getElementById('alpha-favorites');
    if(alphaFav) {
        alphaFav.style.display = 'flex';
        resetAlphaFilter('alpha-favorites', 'favoritesGrid');
    }
}

function jumpToFavCategory(sectionId) { 
    let target = document.getElementById(sectionId);
    let scrollArea = document.getElementById('mainArea'); 
    if(!scrollArea || !target) return;
    
    if (lastFavJump === sectionId) { 
        scrollArea.scrollTo({ top: 0, behavior: 'smooth' }); 
        lastFavJump = ''; 
    } else { 
        let topPos = target.offsetTop - scrollArea.offsetTop - 10;
        scrollArea.scrollTo({ top: topPos, behavior: 'smooth' });
        lastFavJump = sectionId; 
    } 
}

let savedRadios = JSON.parse(localStorage.getItem('hifi_webradios')) || [ 
    { name: "Radio Paradise FLAC (Main)", url: "http://stream.radioparadise.com/flac", cover: "" }, 
    { name: "Radio Paradise Rock FLAC", url: "http://stream.radioparadise.com/rock-flac", cover: "" }, 
    { name: "Sector Radio FLAC", url: "http://sectorradio.ru:8000/sector-flac", cover: "" } 
];

async function renderRadioList(useCache = false) {
    const container = document.getElementById('radioListGrid'); 
    if(!container) return;
    
    let mode = viewModes['radioListGrid'] || 'list';
    container.className = mode === 'grid' ? 'grid-container' : 'list-container';
    
    let html = '';
    
    if (savedRadios.length > 0) { 
        html += '<div class="radio-group-header" style="grid-column:1/-1; width: 100%; padding: 0.5rem 1rem; color: var(--hl-color); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 0.5rem;">Stazioni Personalizzate</div>'; 
        savedRadios.forEach((radio, index) => { 
            const safeUrl = radio.url.replace(/'/g, "\\'");
            const coverDisplay = radio.cover ? `src="${radio.cover}" style="display:block;"` : `style="display:none;"`;
            const iconDisplay = radio.cover ? 'style="display:none;"' : ''; 
            let sortChar = radio.name ? radio.name.charAt(0).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : '#'; 
            if (!/[A-Z]/.test(sortChar)) sortChar = '#'; 
            
            let isFav = universalFavorites.some(f => f.path === radio.url);
            let heartIcon = isFav ? 'bi-heart-fill' : 'bi-heart';
            let heartColor = isFav ? 'color: #dc3545;' : 'color: #aaa;'; 
            let safeName = (radio.name || '').replace(/'/g, "\\'"), safeCover = (radio.cover || '').replace(/'/g, "\\'"); 
            
            let btnPlay = `<button class="btn-addplay" style="width: auto; flex: 1 1 auto; margin-top:0; padding: 0.5rem 0.8rem;" onclick="playAdd('${safeUrl}', 'file', 'play')" title="Ascolta"><i class="bi bi-play-fill"></i></button>`;
            let btnFav = `<button class="btn-addplay" style="width: auto; flex: 1 1 auto; margin-top:0; padding: 0.5rem 0.8rem; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); ${heartColor}" onclick="toggleUniversalFav(this, 'file', '${safeUrl}', '${safeName}', '${safeCover}', 'Web Radio (Custom)', 'bi-broadcast'); event.stopPropagation();" title="Preferiti"><i class="bi ${heartIcon}"></i></button>`;
            let btnEdit = `<button class="btn-addplay" style="width: auto; flex: 1 1 auto; margin-top:0; padding: 0.5rem 0.8rem; border-color:rgba(13,110,253,0.5); color:#0d6efd; background:rgba(13,110,253,0.1);" onclick="editRadio(${index})" title="Modifica"><i class="bi bi-pencil"></i></button>`;
            let btnDel = `<button class="btn-addplay" style="width: auto; flex: 1 1 auto; margin-top:0; padding: 0.5rem 0.8rem; border-color:rgba(220,53,69,0.5); color:#dc3545; background:rgba(220,53,69,0.1);" onclick="deleteRadio(${index})" title="Elimina"><i class="bi bi-trash3"></i></button>`;

            if (mode === 'grid') {
                html += `
                <div class="grid-item" data-letter="${sortChar}">
                    <div class="grid-cover" onclick="playAdd('${safeUrl}', 'file', 'play')"><i class="bi bi-broadcast" ${iconDisplay}></i><img class="lazy-cover" id="radio-cover-${index}" ${coverDisplay}></div>
                    <div class="grid-title" onclick="playAdd('${safeUrl}', 'file', 'play')">${radio.name}</div>
                    <div class="grid-sub">Web Radio (Custom)</div>
                    <div style="display:flex; gap: 5px; margin-top:0.6rem; flex-wrap: wrap;">${btnPlay}${btnFav}${btnEdit}${btnDel}</div>
                </div>`;
            } else {
                html += `
                <div class="list-item" data-letter="${sortChar}">
                    <div class="list-cover" onclick="playAdd('${safeUrl}', 'file', 'play')"><i class="bi bi-broadcast" ${iconDisplay}></i><img class="lazy-cover" id="radio-cover-${index}" ${coverDisplay}></div>
                    <div class="list-item-content" onclick="playAdd('${safeUrl}', 'file', 'play')" style="min-width: 0; padding-right: 10px;"><div style="font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${radio.name}</div><div style="font-size:0.8rem; color:#aaa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${radio.url}</div></div>
                    <div style="display:flex; gap: 6px; flex-shrink: 0; margin-left: auto;">${btnPlay}${btnFav}${btnEdit}${btnDel}</div>
                </div>`; 
            }
        }); 
    }
    
    if (!useCache || cachedMpdRadios === null || cachedRbRadios === null) { 
        if (!useCache) container.innerHTML = `<div style="grid-column:1/-1; padding:2rem; text-align:center;">${t('msg_loading')}</div>`; 
        try { let res = await fetch(`${API}?action=radios`); cachedMpdRadios = res.ok ? await res.json() : []; } catch(e) { cachedMpdRadios = []; } 
        try { let res2 = await fetch(`${API}?action=radio_recent`); cachedRbRadios = res2.ok ? await res2.json() : []; } catch(e) { cachedRbRadios = []; } 
    }
    
    if (cachedMpdRadios.length > 0) { 
        html += '<div class="radio-group-header" style="grid-column:1/-1; width: 100%; padding: 0.5rem 1rem; color: var(--hl-color); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem; margin-bottom: 0.5rem;">Web Radio moOde</div>'; 
        cachedMpdRadios.forEach(d => { 
            let safePath = d.file.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
            let cleanName = (d.name || d.title || '').replace(/\.(pls|m3u|m3u8)$/i, ''); 
            html += buildItemHtml(mode, null, safePath, d.coverUrl, cleanName, `${d.country || ''} ${d.genre ? ' - ' + d.genre : ''}`, false, 'bi-broadcast'); 
        }); 
    }
    
    if (cachedRbRadios.length > 0) { 
        html += '<div class="radio-group-header" style="grid-column:1/-1; width: 100%; padding: 0.5rem 1rem; color: var(--hl-color); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem; margin-bottom: 0.5rem;">Radio Browser (Recenti)</div>'; 
        cachedRbRadios.forEach(d => { 
            let safePath = d.file.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
            let cleanName = (d.name || '').replace(/\.(pls|m3u|m3u8)$/i, ''); 
            html += buildItemHtml(mode, null, safePath, d.coverUrl, cleanName, d.country || '', false, 'bi-broadcast'); 
        }); 
    }
    
    container.innerHTML = html || `<div style="grid-column:1/-1; padding:2rem; text-align:center;">${t('msg_empty')}</div>`; 
    if (typeof resetAlphaFilter === 'function') resetAlphaFilter('alpha-webradio', 'radioListGrid');
}

function addCustomRadio() { 
    const nameInput = document.getElementById('newRadioName');
    const urlInput = document.getElementById('newRadioUrl');
    const logoInput = document.getElementById('newRadioLogo'); 
    
    if (!nameInput.value || !urlInput.value) { alert(t('msg_fill_required')); return; } 
    savedRadios.push({ name: nameInput.value.trim(), url: urlInput.value.trim(), cover: logoInput.value ? logoInput.value.trim() : "" }); 
    localStorage.setItem('hifi_webradios', JSON.stringify(savedRadios)); 
    nameInput.value = ''; urlInput.value = ''; logoInput.value = ''; 
    renderRadioList(); 
}

function editRadio(index) { 
    const r = savedRadios[index]; 
    document.getElementById('newRadioName').value = r.name; 
    document.getElementById('newRadioUrl').value = r.url; 
    document.getElementById('newRadioLogo').value = r.cover || ''; 
    savedRadios.splice(index, 1); 
    localStorage.setItem('hifi_webradios', JSON.stringify(savedRadios)); 
    renderRadioList(); 
    let ma = document.getElementById('mainArea');
    if(ma) ma.scrollTo({ top: 0, behavior: 'smooth' }); 
}

function deleteRadio(index) { 
    if (confirm(`${t('confirm_delete_radio')} "${savedRadios[index].name}"?`)) { 
        savedRadios.splice(index, 1); localStorage.setItem('hifi_webradios', JSON.stringify(savedRadios)); renderRadioList(); 
    } 
}

function toggleCamillaDSP(checked) {
    let cmd = checked ? 'camilladsp_on' : 'camilladsp_off';
    let toggleEl = document.getElementById('camillaDspToggle');
    
    if (toggleEl) toggleEl.disabled = true;

    localStorage.setItem('camilla_dsp_state', checked);

    fetch(`${API}?action=sys_control&cmd=${cmd}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                console.log("CamillaDSP State:", data.state);
            } else {
                alert(t('msg_sys_error'));
                if (toggleEl) {
                    toggleEl.checked = !checked; 
                    localStorage.setItem('camilla_dsp_state', !checked); 
                }
            }
        })
        .catch(err => {
            console.error("Errore API:", err);
            if (toggleEl) {
                toggleEl.checked = !checked;
                localStorage.setItem('camilla_dsp_state', !checked);
            }
        })
        .finally(() => {
            if (toggleEl) toggleEl.disabled = false;
        });
}

function changeCover(folderPath) {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg, image/png';
    
    input.onchange = e => {
        let file = e.target.files[0];
        if (!file) return;
        
        const MAX_SIZE_MB = 2;
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
            alert(`L'immagine è troppo pesante. Il limite è ${MAX_SIZE_MB}MB.`);
            return;
        }

        let img = new Image();
        img.onload = function() {
            URL.revokeObjectURL(this.src);

            const MAX_WIDTH = 1200;  
            const MAX_HEIGHT = 1200;
            
            if (this.width > MAX_WIDTH || this.height > MAX_HEIGHT) {
                alert(`Le dimensioni dell'immagine (${this.width}x${this.height}) superano il limite massimo di ${MAX_WIDTH}x${MAX_HEIGHT} pixel.`);
                return;
            }
            
            let formData = new FormData();
            formData.append('cover', file);
            formData.append('folder', folderPath);

            fetch(`${API}?action=set_custom_cover`, {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert("Copertina aggiornata con successo! Clicca sulla Sincronizzazione per ricaricare.");
                    if (typeof clearRackCache === 'function') clearRackCache();
                } else {
                    alert("Errore durante il salvataggio della copertina.");
                }
            })
            .catch(err => alert("Errore di rete durante l'upload."));
        };
        
        img.onerror = function() {
            alert("File immagine non valido o corrotto.");
        };
        
        img.src = URL.createObjectURL(file);
    };
    
    input.click();
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('customContextMenu')) {
        let menu = document.createElement('div');
        menu.id = 'customContextMenu';
        menu.style.cssText = 'display:none; position:fixed; z-index:99999; background:#222; border:1px solid rgba(255,255,255,0.15); border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.5); padding:6px 0; min-width:160px;';
        menu.innerHTML = `
            <div id="ctxChangeCover" style="padding:10px 16px; color:#fff; font-size:0.9rem; cursor:pointer; display:flex; align-items:center; gap:10px;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                <i class="bi bi-image"></i> Cambia copertina
            </div>
        `;
        document.body.appendChild(menu);

        document.addEventListener('click', () => { menu.style.display = 'none'; });
        document.addEventListener('scroll', () => { menu.style.display = 'none'; }, true);
    }
});

let activeContextMenuPath = '';

function showContextMenu(e, actionPath) {
    e.preventDefault(); 
    activeContextMenuPath = actionPath;

    let menu = document.getElementById('customContextMenu');
    if (!menu) return;

    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    document.getElementById('ctxChangeCover').onclick = () => {
        menu.style.display = 'none';
        changeCover(activeContextMenuPath);
    };
}

let mouseIdleTimer;

function resetMouseTimer() {
    document.body.style.cursor = 'default';
    
    clearTimeout(mouseIdleTimer);
    
    mouseIdleTimer = setTimeout(() => {
        document.body.style.cursor = 'none';
    }, 3000);
}

document.addEventListener('mousemove', resetMouseTimer);
document.addEventListener('mousedown', resetMouseTimer);
document.addEventListener('keydown', resetMouseTimer);
document.addEventListener('touchstart', resetMouseTimer);

resetMouseTimer();

window.addEventListener('unload', () => {
    navigator.sendBeacon(`${API}?action=sys_optimize&mode=shutdown`);
});

function aggiornaMiniPlayerSS() {
    const toggle = document.getElementById('miniPlayerSsToggle');
    const ssControls = document.getElementById('ssControlsOverlay');
    
    if (toggle) {
        localStorage.setItem('mostraMiniPlayerSS', toggle.checked);
        
        if (ssControls && ssControls.style.opacity === '1') {
            ssControls.style.display = toggle.checked ? 'flex' : 'none';
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const preferenza = localStorage.getItem('mostraMiniPlayerSS');
    const toggle = document.getElementById('miniPlayerSsToggle');
    
    if (toggle) {
        toggle.checked = preferenza !== 'false'; 
    }
});

function exportConfig() {
    const keysToExport = [
        'hifi_universal_favs', 
        'hifi_webradios', 
        'camilla_ss_timeout', 'camilla_ss_random', 'camilla_vu_style', 
        'camilla_ws_uri', 'moode_ui_url', 'camilla_stream_url', 
        'camilla_backlight', 'camilla_inline_vu', 'camilla_local_analyzer', 
        'camilla_device_layout', 'camilla_dsp_state', 'hifi_language',
        'view_folderGrid', 'view_albumGrid', 'view_artistGrid', 
        'view_searchGrid', 'view_radioListGrid', 'mostraMiniPlayerSS'
    ];

    let config = {};
    keysToExport.forEach(key => {
        let val = localStorage.getItem(key);
        if (val !== null) config[key] = val;
    });

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mymoode_backup_" + new Date().toISOString().split('T')[0] + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importConfig(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const config = JSON.parse(e.target.result);
            
            Object.keys(config).forEach(key => {
                localStorage.setItem(key, config[key]);
            });

            alert("Configurazione ripristinata con successo! L'interfaccia si riavvierà.");
            location.reload(); 
        } catch (err) {
            alert("Errore nel file di backup. Assicurati che sia un file JSON valido.");
        }
    };
    reader.readAsText(file);
}

// ==========================================
// AGGIORNAMENTO DINAMICO MENU A TENDINA
// ==========================================
setInterval(() => {
    try {
        let labels = JSON.parse(localStorage.getItem('customLabels') || '{}');
        let select = document.getElementById('vuStyleSelect');
        if (select) {
            Array.from(select.options).forEach(opt => {
                let key = opt.value.replace('vu_', '');
                if (labels[key] && labels[key].trim() !== '') {
                    opt.textContent = labels[key];
                }
            });
        }
    } catch(e) {}
}, 1500);
