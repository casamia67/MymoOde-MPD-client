<?php
error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

@ini_set('max_execution_time', '300');
@ini_set('memory_limit', '512M');

define('HIFI_CACHE_DIR', '/var/www/vumeter/cache');
define('HIFI_DEFAULT_SETTINGS', '/var/www/vumeter/cache/default_settings.json');
define('MOODE_DB_PATH', '/var/local/www/db/moode-sqlite3.db');

$action = $_GET['action'] ?? 'status';
$socket = @fsockopen('127.0.0.1', 6600, $errno, $errstr, 2);

if (!$socket) {
    echo json_encode(['success' => false, 'error' => 'MPD Offline o Rifiutato']);
    exit;
}

fgets($socket);

function send_mpd_command($socket, $command) {
    fwrite($socket, $command . "\n");
    $response = '';
    while (!feof($socket)) {
        $line = fgets($socket);
        if ($line === false || strncasecmp($line, 'OK', 2) === 0 || strncasecmp($line, 'ACK', 3) === 0) {
            break;
        }
        $response .= $line;
    }
    return $response;
}

function get_cache_file_path($key) {
    if (!is_dir(HIFI_CACHE_DIR)) {
        @mkdir(HIFI_CACHE_DIR, 0775, true);
    }
    return HIFI_CACHE_DIR . '/' . md5($key) . '.json';
}

function get_cached_data($key, $ttl_seconds, $callback) {
    $file = get_cache_file_path($key);

    if (file_exists($file) && (time() - filemtime($file)) < $ttl_seconds) {
        $cached = json_decode(@file_get_contents($file), true);
        if ($cached !== null) return $cached;
    }

    $data = $callback();
    @file_put_contents($file, json_encode($data));
    return $data;
}

function get_moode_db() {
    if (file_exists(MOODE_DB_PATH)) {
        $db = new SQLite3(MOODE_DB_PATH);
        $db->busyTimeout(2000);
        return $db;
    }
    return null;
}

function get_cached_cover_url($file) {
    if (empty($file)) return '';

    if (strpos($file, 'http://') === 0 || strpos($file, 'https://') === 0) {
        return '';
    }

    $dir_path = dirname($file);
    $file_base = pathinfo($file, PATHINFO_FILENAME);

    $rel_dir = ltrim($dir_path, '/');
    $encoded_dir = implode('/', array_map('rawurlencode', explode('/', $rel_dir)));
    $encoded_file = implode('/', array_map('rawurlencode', explode('/', ltrim($file, '/'))));

    $hash = md5($rel_dir);
    
    $path_upper = strtoupper($file);
    $is_radio = (strpos($path_upper, 'RADIO') !== false || strpos($path_upper, 'WEBRADIO') !== false);
    $is_playlist = (substr($path_upper, -4) === '.M3U' || substr($path_upper, -4) === '.PLS' || substr($path_upper, -5) === '.M3U8');

    if ($is_playlist) {
        if (@file_exists('/var/local/www/imagesw/playlist-covers/' . $file_base . '.jpg')) {
            return '/imagesw/playlist-covers/' . rawurlencode($file_base) . '.jpg';
        }
    }

    if (!$is_radio && !$is_playlist) {
        if (@file_exists('/var/local/www/imagesw/thmcache/' . $hash . '.jpg')) {
            return '/imagesw/thmcache/' . $hash . '.jpg';
        }
        if (@file_exists(HIFI_CACHE_DIR . '/' . $hash . '.jpg')) return 'cache/' . $hash . '.jpg';
        if (@file_exists(HIFI_CACHE_DIR . '/' . $hash . '.jpeg')) return 'cache/' . $hash . '.jpeg';
        if (@file_exists(HIFI_CACHE_DIR . '/' . $hash . '.png')) return 'cache/' . $hash . '.png';
    }

    $abs_dir = '/mnt/MPD/' . $rel_dir;
    if (!is_dir($abs_dir)) {
        $abs_dir = '/var/lib/mpd/music/' . $rel_dir;
    }

    if ($is_radio) {
        $radio_search_names = [$file_base, basename($file)];
        foreach ($radio_search_names as $r_name) {
            if (empty($r_name)) continue;
            $clean_r_name = pathinfo($r_name, PATHINFO_FILENAME);
            
            if (@file_exists('/var/local/www/imagesw/radio-logos/thumbs/' . $clean_r_name . '.jpg')) {
                return '/imagesw/radio-logos/thumbs/' . rawurlencode($clean_r_name) . '.jpg';
            }
            if (@file_exists('/var/local/www/imagesw/radio-logos/' . $clean_r_name . '.jpg')) {
                return '/imagesw/radio-logos/' . rawurlencode($clean_r_name) . '.jpg';
            }
            if (@file_exists('/var/local/www/imagesw/rb-logos/thumbs/' . $clean_r_name . '.jpg')) {
                return '/imagesw/rb-logos/thumbs/' . rawurlencode($clean_r_name) . '.jpg';
            }
            if (@file_exists('/var/local/www/imagesw/rb-logos/' . $clean_r_name . '.jpg')) {
                return '/imagesw/rb-logos/' . rawurlencode($clean_r_name) . '.jpg';
            }
            if (@file_exists('/var/local/www/imagesw/rb-logos/' . $clean_r_name . '.png')) {
                return '/imagesw/rb-logos/' . rawurlencode($clean_r_name) . '.png';
            }
        }
    }

    if (is_dir($abs_dir)) {
        $specific_imgs = [$file_base . '.jpg', $file_base . '.png', $file_base . '.jpeg', $file_base . '.gif', $file_base . '.JPG', $file_base . '.PNG'];
        foreach ($specific_imgs as $s_img) {
            if (@file_exists($abs_dir . '/' . $s_img)) {
                return '/coverart.php/' . $encoded_dir . '/' . rawurlencode($s_img);
            }
        }

        $std_names = ['thumb.jpg', 'thumb.png', 'Thumb.jpg', 'Thumb.png', 'folder.jpg', 'cover.jpg', 'front.jpg', 'folder.png', 'cover.png', 'Folder.jpg', 'Cover.jpg', 'Front.jpg'];
        foreach($std_names as $std) {
            if (@file_exists($abs_dir . '/' . $std)) {
                return '/coverart.php/' . $encoded_dir . '/' . rawurlencode($std);
            }
        }

        if (!$is_radio) {
            $files = @scandir($abs_dir);
            if ($files) {
                foreach ($files as $f) {
                    if ($f !== '.' && $f !== '..') {
                        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
                        if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif'])) {
                            return '/coverart.php/' . $encoded_dir . '/' . rawurlencode($f);
                        }
                    }
                }
            }
        }
    }

    return '';
}

try {
    if ($action === 'sys_control') {
        $cmd = $_GET['cmd'] ?? '';
        
        if ($cmd === 'camilladsp_on') {
            exec('sudo systemctl start camilladsp');
            echo json_encode(['success' => true, 'state' => 'on']);
        } 
        else if ($cmd === 'camilladsp_off') {
            exec('sudo systemctl stop camilladsp');
            echo json_encode(['success' => true, 'state' => 'off']);
        } 
        else if ($cmd === 'camilladsp_status') {
            $status = trim(exec('sudo systemctl is-active camilladsp'));
            echo json_encode(['success' => true, 'active' => ($status === 'active')]);
        }
        else {
            echo json_encode(['success' => false, 'error' => 'Comando sconosciuto']);
        }
        exit;
    }

    if ($action === 'sys_optimize') {
        $mode = $_GET['mode'] ?? 'startup';

        if ($mode === 'startup') {
            exec('pkill -f radiocover_plus.py');
            echo json_encode(['success' => true, 'message' => 'Ottimizzazione di avvio completata']);
        } 
        else if ($mode === 'shutdown') {
            exec('rm -f ' . HIFI_CACHE_DIR . '/py_*.txt');
            echo json_encode(['success' => true, 'message' => 'Servizi ripristinati in uscita']);
        }
        exit;
    }

    if ($action === 'get_default_settings') {
        clearstatcache();
        if (file_exists(HIFI_DEFAULT_SETTINGS)) {
            $settings = json_decode(file_get_contents(HIFI_DEFAULT_SETTINGS), true);
            if ($settings !== null) {
                ob_clean();
                echo json_encode($settings);
                exit;
            }
        }
        ob_clean();
        echo json_encode([]);
        exit;
    }

    if ($action === 'set_default_settings') {
        $json = file_get_contents('php://input');
        $data = json_decode($json, true);
        // --- GESTIONE CONFIGURAZIONI CLIENT SPECIFICHE ---
    if ($action === 'save_client_settings') {
        $json = file_get_contents('php://input');
        $data = json_decode($json, true);
        
        if ($data !== null) {
            if (!is_dir(HIFI_CACHE_DIR)) {
                @mkdir(HIFI_CACHE_DIR, 0775, true);
            }
            $client_ip = $_SERVER['REMOTE_ADDR'];
            $file = HIFI_CACHE_DIR . '/client_' . md5($client_ip) . '.json';
            
            if (file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT))) {
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Impossibile scrivere il file.']);
            }
        } else {
            echo json_encode(['success' => false, 'error' => 'Payload JSON non valido.']);
        }
        exit;
    }

    if ($action === 'get_client_settings') {
        $client_ip = $_SERVER['REMOTE_ADDR'];
        $file = HIFI_CACHE_DIR . '/client_' . md5($client_ip) . '.json';
        
        if (file_exists($file)) {
            echo file_get_contents($file);
        } else {
            echo json_encode(['success' => false, 'error' => 'Not found']);
        }
        exit;
    }

    if ($action === 'delete_client_settings') {
        $client_ip = $_SERVER['REMOTE_ADDR'];
        $file = HIFI_CACHE_DIR . '/client_' . md5($client_ip) . '.json';
        
        if (file_exists($file)) {
            @unlink($file);
        }
        echo json_encode(['success' => true]);
        exit;
    }

        if ($data !== null) {
            if (!is_dir(HIFI_CACHE_DIR)) {
                @mkdir(HIFI_CACHE_DIR, 0775, true);
            }
            if (file_put_contents(HIFI_DEFAULT_SETTINGS, json_encode($data, JSON_PRETTY_PRINT))) {
                echo json_encode(['success' => true]);
                exit;
            } else {
                echo json_encode(['success' => false, 'error' => 'Impossibile scrivere il file.']);
                exit;
            }
        } else {
            echo json_encode(['success' => false, 'error' => 'Payload JSON non valido.']);
            exit;
        }
    }

    if ($action === 'status') {
        $status_raw = send_mpd_command($socket, 'status');
        $song_raw = send_mpd_command($socket, 'currentsong');

        $moode_meta = [];
        if (file_exists('/var/local/www/currentsong.txt')) {
            $lines = @file('/var/local/www/currentsong.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if ($lines) {
                foreach($lines as $line) {
                    $parts = explode('=', $line, 2);
                    if(count($parts) === 2) {
                        $moode_meta[trim($parts[0])] = trim($parts[1]);
                    }
                }
            }
        }

        $status = [];
        foreach (explode("\n", $status_raw) as $line) {
            if (strpos($line, ':') !== false) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) $status[trim($parts[0])] = trim($parts[1]);
            }
        }

        $song = [];
        foreach (explode("\n", $song_raw) as $line) {
            if (strpos($line, ':') !== false) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) $song[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
        }

        $file = $song['file'] ?? '';
        $title_tag = $song['title'] ?? '';
        $station_tag = $song['name'] ?? '';

        $file_upper = strtoupper($file);

        $is_webradio = (
            strpos($file, 'http://') === 0 || 
            strpos($file, 'https://') === 0 || 
            strpos($file_upper, 'RADIO/') === 0 || 
            strpos($file_upper, 'WEBRADIO/') === 0 ||
            substr($file_upper, -4) === '.M3U' ||
            substr($file_upper, -4) === '.PLS' ||
            substr($file_upper, -5) === '.M3U8'
        );

        $final_title = $title_tag;
        $final_artist = $song['artist'] ?? '';

        $coverUrl = $file ? get_cached_cover_url($file) : '';

        if ($is_webradio) {
            $found_cover = false;
            
            if (!empty($title_tag) || !empty($station_tag)) {
                $current_track_hash = md5($station_tag . '_' . $title_tag);
                $python_cache_file = HIFI_CACHE_DIR . '/py_' . $current_track_hash . '.txt';

                if (file_exists($python_cache_file)) {
                    $cached_url = trim(@file_get_contents($python_cache_file));
                    if (!empty($cached_url) && strpos($cached_url, 'http') === 0) {
                        $coverUrl = $cached_url;
                        $found_cover = true;
                    }
                } else {
                    $cmd_title = escapeshellarg($title_tag ?: 'Unknown');
                    $cmd_station = escapeshellarg($station_tag ?: 'Unknown');
                    $py_script_path = '/var/www/util/radiocover_plus.py';
                    
                    if (file_exists($py_script_path)) {
                        @file_put_contents($python_cache_file, 'LOADING');
                        $bg_cmd = "/usr/bin/python3 $py_script_path --title $cmd_title --station $cmd_station > " . escapeshellarg($python_cache_file) . " 2>/dev/null &";
                        exec($bg_cmd);
                    }
                }
            }

            if (!$found_cover && !empty($file)) {
                $db = get_moode_db();
                if ($db) {
                    $stmt = $db->prepare("SELECT name FROM cfg_radio WHERE station = :url LIMIT 1");
                    $stmt->bindValue(':url', $file);
                    $res = $stmt->execute();
                    if ($row = $res->fetchArray(SQLITE3_ASSOC)) {
                        $db_name = $row['name'];
                        $logo_paths = [
                            '/var/local/www/imagesw/radio-logos/thumbs/' . $db_name . '.jpg',
                            '/var/local/www/imagesw/radio-logos/' . $db_name . '.jpg',
                            '/var/local/www/imagesw/rb-logos/thumbs/' . $db_name . '.jpg',
                            '/var/local/www/imagesw/rb-logos/' . $db_name . '.jpg',
                            '/var/local/www/imagesw/rb-logos/' . $db_name . '.png'
                        ];
                        foreach ($logo_paths as $p) {
                            if (@file_exists($p)) {
                                $coverUrl = str_replace('/var/local/www', '', $p);
                                $parts = explode('/', $coverUrl);
                                $parts[count($parts)-1] = rawurlencode($parts[count($parts)-1]);
                                $coverUrl = implode('/', $parts);
                                $found_cover = true;
                                break;
                            }
                        }
                    }
                    $db->close();
                }
            }

            if (!$found_cover) {
                $recent_file = '/var/local/www/rb-cache/recently_played.json';
                $logo_name = '';
                
                if (file_exists($recent_file)) {
                    $radios = json_decode(@file_get_contents($recent_file), true);
                    if (is_array($radios)) {
                        foreach ($radios as $radio) {
                            if (!empty($radio['url']) && (strpos($file, $radio['url']) !== false || strpos($radio['url'], $file) !== false)) {
                                if (!empty($radio['favicon'])) {
                                    $coverUrl = $radio['favicon'];
                                    $found_cover = true;
                                }
                                $logo_name = $radio['name'];
                                break;
                            }
                        }
                    }
                }

                if (!$found_cover && !empty($logo_name)) {
                    $paths = [
                        '/var/local/www/imagesw/rb-logos/thumbs/' . $logo_name . '.jpg',
                        '/var/local/www/imagesw/rb-logos/' . $logo_name . '.jpg'
                    ];
                    foreach ($paths as $p) {
                        if (@file_exists($p)) {
                            $coverUrl = str_replace('/var/local/www', '', $p);
                            $parts = explode('/', $coverUrl);
                            $parts[count($parts)-1] = rawurlencode($parts[count($parts)-1]);
                            $coverUrl = implode('/', $parts);
                            $found_cover = true;
                            break;
                        }
                    }
                }
            }

            if (!$found_cover && !empty($station_tag)) {
                $search_name = strtolower(trim($station_tag));
                $thumb_dirs = [
                    '/var/local/www/imagesw/rb-logos/thumbs/',
                    '/var/local/www/imagesw/rb-logos/',
                    '/var/local/www/imagesw/radio-logos/thumbs/',
                    '/var/local/www/imagesw/radio-logos/'
                ];
                
                foreach ($thumb_dirs as $dir) {
                    if ($found_cover) break;
                    if (is_dir($dir)) {
                        $files = scandir($dir);
                        foreach ($files as $f) {
                            if ($f !== '.' && $f !== '..') {
                                $f_clean = strtolower(pathinfo($f, PATHINFO_FILENAME));
                                if (strpos($search_name, $f_clean) !== false || strpos($f_clean, $search_name) !== false) {
                                    $rel_dir = str_replace('/var/local/www', '', $dir);
                                    $coverUrl = $rel_dir . rawurlencode($f);
                                    $found_cover = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if (!$found_cover) { $coverUrl = ''; }
        }

        $is_bluetooth = (stripos($file, 'bluetooth') !== false || stripos($song['title'] ?? '', 'bluetooth') !== false);
        
        $dac_format = '';
        $dac_rate = '';
        $hw_files = glob('/proc/asound/card*/pcm0p/sub0/hw_params');
        if (is_array($hw_files)) {
            foreach ($hw_files as $file_hw) {
                $content = @file_get_contents($file_hw);
                if ($content && preg_match('/^format:\s*(\w+)/m', $content, $m)) {
                    $dac_format = $m[1];
                    if (preg_match('/^rate:\s*(\d+)/m', $content, $m_rate)) {
                        $dac_rate = $m_rate[1];
                    }
                    break;
                }
            }
        }
        
        if (empty($dac_format) && isset($status['audio'])) {
            $parts = explode(':', $status['audio']);
            if (count($parts) >= 2) {
                $dac_rate = $parts[0];
                $dac_format = (strpos($status['audio'], 'dsd') !== false) ? 'DSD' : $parts[1] . ' (DSP)';
            }
        }

        $response = [
            'state' => $status['state'] ?? 'stop',
            'volume' => isset($status['volume']) ? (int)$status['volume'] : 0,
            'elapsed' => isset($status['elapsed']) ? (float)$status['elapsed'] : 0,
            'duration' => isset($status['duration']) ? (float)$status['duration'] : (isset($song['duration']) ? (float)$song['duration'] : 0),
            'title' => $final_title,
            'artist' => $final_artist,
            'file' => $file,
            'coverUrl' => $coverUrl,
            'audio_format' => $status['audio'] ?? '',
            'repeat' => $status['repeat'] ?? '0',
            'random' => $status['random'] ?? '0',
            'is_bluetooth' => $is_bluetooth,
            'moode_meta' => $moode_meta,
            'dac_format' => $dac_format,
            'dac_rate' => $dac_rate,
            'raw_info' => array_merge($status, $song)
        ];

        echo json_encode($response);
    }

    else if ($action === 'radios') {
        $radios = [];
        $folders = ['RADIO', 'WEBRADIO'];

        foreach ($folders as $folder) {
            $ls_raw = send_mpd_command($socket, 'lsinfo "' . $folder . '"');
            $current_item = [];

            foreach (explode("\n", $ls_raw) as $line) {
                if (strpos($line, ': ') !== false) {
                    $parts = explode(': ', $line, 2);
                    if (count($parts) === 2) {
                        $k = strtolower(trim($parts[0]));
                        $v = trim($parts[1]);

                        if ($k === 'file' || $k === 'playlist') {
                            if (!empty($current_item)) {
                                $radios[] = $current_item;
                            }
                            $cover = get_cached_cover_url($v);
                            $current_item = [
                                'type' => 'radio',
                                'file' => $v,
                                'name' => basename($v),
                                'coverUrl' => $cover,
                                'genre' => 'Cartella ' . $folder,
                                'country' => ''
                            ];
                        } else if ($k === 'title' && !empty($current_item)) {
                            $current_item['name'] = $v;
                        }
                    }
                }
            }
            if (!empty($current_item)) {
                $radios[] = $current_item;
            }
        }

        echo json_encode($radios);
    }
    else if ($action === 'radio_recent') {
        $recent_file = '/var/local/www/rb-cache/recently_played.json';
        if (file_exists($recent_file)) {
            $json_data = @file_get_contents($recent_file);
            $radios = json_decode($json_data, true);
            $results = [];
            if (is_array($radios)) {
                foreach ($radios as $radio) {
                    $results[] = [
                        'type' => 'radio_browser',
                        'name' => $radio['name'] ?? 'Sconosciuta',
                        'file' => $radio['url'] ?? '',
                        'coverUrl' => !empty($radio['favicon']) ? $radio['favicon'] : '/imagesw/rb-logos/thumbs/' . rawurlencode($radio['name']) . '.jpg',
                        'genre' => $radio['tags'] ?? '',
                        'country' => $radio['country'] ?? ''
                    ];
                }
            }
            echo json_encode($results);
        } else {
            echo json_encode([]);
        }
    }

    else if ($action === 'queue') {
        $playlist_raw = send_mpd_command($socket, 'playlistinfo');
        $status_raw = send_mpd_command($socket, 'status');

        $status = [];
        foreach (explode("\n", $status_raw) as $line) {
            if (strpos($line, 'songid:') === 0) $status['songid'] = trim(substr($line, 7));
        }
        $current_songid = $status['songid'] ?? -1;

        $queue = [];
        $current_song = [];
        foreach (explode("\n", $playlist_raw) as $line) {
            if (strpos($line, ':') !== false) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $k = strtolower(trim($parts[0]));
                    $v = trim($parts[1]);
                    if ($k === 'file') {
                        if (!empty($current_song)) $queue[] = $current_song;
                        $current_song = ['file' => $v, 'title' => basename($v), 'artist' => '', 'duration' => 0, 'id' => '0', 'current' => false];
                    }
                    if ($k === 'title') $current_song['title'] = $v;
                    if ($k === 'artist') $current_song['artist'] = $v;
                    if ($k === 'duration') $current_song['duration'] = (float)$v;
                    if ($k === 'id') $current_song['id'] = $v;
                }
            }
        }
        if (!empty($current_song)) $queue[] = $current_song;
        foreach ($queue as &$item) { $item['current'] = ($item['id'] === $current_songid); }
        echo json_encode($queue);
    }
    
    else if ($action === 'playlists') {
        $raw = send_mpd_command($socket, 'listplaylists');
        $res = [];
        foreach (explode("\n", $raw) as $line) {
            if (strpos($line, 'playlist: ') === 0) $res[] = trim(substr($line, 10));
        }
        echo json_encode($res);
    }

    else if ($action === 'browse') {
        $uri = $_GET['uri'] ?? '';
        $mpd_cmd = $uri ? 'lsinfo "' . str_replace('"', '\"', $uri) . '"' : 'lsinfo';
        $ls_raw = send_mpd_command($socket, $mpd_cmd);
        $res = [];
        $current_item = [];

        foreach (explode("\n", $ls_raw) as $line) {
            if (strpos($line, ': ') !== false) {
                $parts = explode(': ', $line, 2);
                if (count($parts) === 2) {
                    $k = strtolower(trim($parts[0]));
                    $v = trim($parts[1]);

                    if ($k === 'directory' || $k === 'file' || $k === 'playlist') {
                        if (!empty($current_item)) $res[] = $current_item;
                        $type = $k;
                        $cover = '';
                        if ($k === 'file' || $k === 'playlist') {
                            $cover = get_cached_cover_url($v);
                        }
                        $current_item = ['type' => $type, 'path' => $v, 'name' => basename($v), 'coverUrl' => $cover];
                    } else if ($k === 'title' && !empty($current_item)) {
                        $current_item['title'] = $v;
                    }
                }
            }
        }
        if (!empty($current_item)) $res[] = $current_item;
        echo json_encode($res);
    }

    else if ($action === 'folder_cover') {
        $folder = str_replace('"', '\"', $_GET['folder'] ?? '');
        $coverUrl = get_cached_cover_url($folder . '/dummy.ext');
        if (strpos($coverUrl, 'dummy.ext') !== false) {
            $coverUrl = '';
        }
        echo json_encode(['coverUrl' => $coverUrl]);
    }

    else if ($action === 'artists') {
        $items = get_cached_data('all_artists', 86400, function() use ($socket) {
            $raw = send_mpd_command($socket, 'list artist');
            $res = [];
            foreach (explode("\n", $raw) as $line) {
                if (strpos($line, 'Artist: ') === 0) $res[] = trim(substr($line, 8));
            }
            return array_values(array_filter($res));
        });
        echo json_encode($items);
    }
    
    else if ($action === 'artist_albums') {
        $artist = str_replace('"', '\"', $_GET['artist'] ?? '');
        $items = get_cached_data('albums_of_' . md5($artist), 86400, function() use ($socket, $artist) {
            $raw = send_mpd_command($socket, 'list album artist "' . $artist . '"');
            $res = [];
            foreach (explode("\n", $raw) as $line) {
                if (strpos($line, 'Album: ') === 0) $res[] = trim(substr($line, 7));
            }
            return array_values(array_filter($res));
        });
        echo json_encode($items);
    }
    
    else if ($action === 'albums') {
        $items = get_cached_data('all_albums', 86400, function() use ($socket) {
            $raw = send_mpd_command($socket, 'list album');
            $res = [];
            foreach (explode("\n", $raw) as $line) {
                if (strpos($line, 'Album: ') === 0) $res[] = trim(substr($line, 7));
            }
            return array_values(array_filter($res));
        });
        echo json_encode($items);
    }
    
    else if ($action === 'album_tracks') {
        $album = str_replace('"', '\"', $_GET['album'] ?? '');
        $results = get_cached_data('tracks_of_' . md5($album), 86400, function() use ($socket, $album) {
            $raw = send_mpd_command($socket, 'find album "' . $album . '"');
            $res = [];
            $current = [];
            foreach (explode("\n", $raw) as $line) {
                if (strpos($line, ':') !== false) {
                    $parts = explode(':', $line, 2);
                    if (count($parts) === 2) {
                        $k = strtolower(trim($parts[0]));
                        $v = trim($parts[1]);
                        if ($k === 'file') {
                            if (!empty($current)) $res[] = $current;
                            $coverUrl = get_cached_cover_url($v);
                            $current = ['file' => $v, 'title' => basename($v), 'artist' => '', 'track' => '', 'coverUrl' => $coverUrl];
                        }
                        if ($k === 'title') $current['title'] = $v;
                        if ($k === 'artist') $current['artist'] = $v;
                        if ($k === 'track') $current['track'] = $v;
                    }
                }
            }
            if (!empty($current)) $res[] = $current;
            return $res;
        });
        echo json_encode($results);
    }
    
    else if ($action === 'album_cover' || $action === 'artist_cover') {
        $type = $action === 'album_cover' ? 'album' : 'artist';
        $val = str_replace('"', '\"', $_GET[$type] ?? '');

        $cover_data = get_cached_data("cover_path_{$type}_" . md5($val), 86400, function() use ($socket, $type, $val) {
            $raw = send_mpd_command($socket, "find $type \"$val\"");
            $coverUrl = '';
            foreach (explode("\n", $raw) as $line) {
                if (stripos($line, 'file: ') === 0) {
                    $v = trim(substr($line, 6));
                    $coverUrl = get_cached_cover_url($v);
                    break;
                }
            }
            return ['coverUrl' => $coverUrl];
        });
        echo json_encode($cover_data);
    }

    else if ($action === 'search') {
        $raw_query = trim($_GET['q'] ?? '');
        $lang = $_GET['lang'] ?? 'it';
        $search_term = strtolower($raw_query);
        
        $detected_type = 'any';
        $intents = [
            'album'    => ['album '],
            'artist'   => ['artista ', 'cantante ', 'gruppo '],
            'title'    => ['brano ', 'canzone ', 'traccia '],
            'playlist' => ['playlist '],
            'genre'    => ['genere ', 'tipo ']
        ];

        foreach ($intents as $type => $keywords) {
            foreach ($keywords as $kw) {
                if (strpos($search_term, $kw) !== false) {
                    $detected_type = $type;
                    $search_term = str_replace($kw, '', $search_term);
                    break 2;
                }
            }
        }

        $stop_words_library = [
            'it' => ['metti', 'riproduci', 'suona', 'ascolta', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'della', 'per', 'favore']
        ];
        $stop_words = $stop_words_library[$lang] ?? $stop_words_library['it'];

        $words = explode(' ', $search_term);
        $clean_words = array_filter($words, function($w) use ($stop_words) {
            return !in_array($w, $stop_words) && strlen($w) > 1;
        });

        $final_query = empty($clean_words) ? trim($search_term) : implode(' ', $clean_words);
        
        $aliases = ["dark side" => "The Dark Side of the Moon", "the wall" => "The Wall"];
        if (isset($aliases[$final_query])) {
            $final_query = $aliases[$final_query];
            if ($detected_type === 'any') $detected_type = 'album'; 
        }

        $safe_q = str_replace('"', '\"', $final_query);
        $search_type = $_GET['type'] ?? $detected_type;
        
        $mpd_search_type = in_array($search_type, ['album', 'artist', 'title']) ? $search_type : 'any';

        $raw = send_mpd_command($socket, "search $mpd_search_type \"$safe_q\"");
        
        $results = [];
        $current = [];
        $seen_albums = [];
        $seen_artists = [];
        
        $process_item = function($item) use (&$results, &$seen_albums, &$seen_artists, $search_type, $final_query) {
            if (empty($item['file'])) return;
            $coverUrl = get_cached_cover_url($item['file']);

            if ($search_type === 'album') {
                if (!empty($item['album']) && stripos($item['album'], $final_query) !== false) {
                    $artist_tag = $item['albumartist'] ?? $item['artist'] ?? '';
                    $alb_key = md5(strtolower(trim($item['album'])) . '_' . strtolower(trim($artist_tag)));
                    
                    if (!isset($seen_albums[$alb_key])) {
                        $seen_albums[$alb_key] = true;
                        $results[] = [
                            'type' => 'album', 
                            'name' => $item['album'], 
                            'artist' => $artist_tag, 
                            'coverUrl' => $coverUrl
                        ];
                    }
                }
            } else if ($search_type === 'artist') {
                if (!empty($item['artist']) && stripos($item['artist'], $final_query) !== false) {
                    $art_key = strtolower(trim($item['artist']));
                    if (!isset($seen_artists[$art_key])) {
                        $seen_artists[$art_key] = true;
                        $results[] = ['type' => 'artist', 'name' => $item['artist'], 'coverUrl' => $coverUrl];
                    }
                }
            } else {
                $match = false;
                
                if ($search_type === 'any' || $search_type === 'radio') {
                    $match = true;
                }
                else if ($search_type === 'title' && stripos($item['title'] ?? '', $final_query) !== false) {
                    $match = true;
                }
                else if ($search_type === 'genre' && stripos($item['genre'] ?? '', $final_query) !== false) {
                    $match = true;
                }
                else if ($search_type === 'file' && stripos($item['file'] ?? '', $final_query) !== false) {
                    $match = true;
                }

                if ($match) {
                    $results[] = [
                        'type' => 'file', 
                        'file' => $item['file'], 
                        'title' => $item['title'] ?? basename($item['file']), 
                        'artist' => $item['artist'] ?? '', 
                        'album' => $item['album'] ?? '', 
                        'coverUrl' => $coverUrl
                    ];
                }
            }
        };

        foreach (explode("\n", $raw) as $line) {
            if (strpos($line, ':') !== false) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $k = strtolower(trim($parts[0]));
                    $v = trim($parts[1]);

                    if ($k === 'file') {
                        if (!empty($current)) $process_item($current);
                        $current = ['file' => $v, 'title' => '', 'artist' => '', 'album' => '', 'albumartist' => '', 'genre' => ''];
                    } else if (in_array($k, ['title', 'artist', 'album', 'albumartist', 'genre'])) {
                        $current[$k] = $v;
                    }
                }
            }
        }
        if (!empty($current)) $process_item($current);

        $final_results = array_values($results);

        if (isset($_GET['autoplay']) && $_GET['autoplay'] === 'true') {
            send_mpd_command($socket, 'clear'); 
            
            if (!empty($final_results)) {
                $best = $final_results[0];
                
                if ($search_type === 'playlist') {
                    send_mpd_command($socket, 'load "' . str_replace('"', '\"', $safe_q) . '"');
                } else if ($search_type === 'album') {
                    send_mpd_command($socket, 'findadd album "' . str_replace('"', '\"', $best['name']) . '"');
                } else if ($search_type === 'artist') {
                    send_mpd_command($socket, 'findadd artist "' . str_replace('"', '\"', $best['name']) . '"');
                } else {
                    send_mpd_command($socket, 'searchadd ' . $mpd_search_type . ' "' . str_replace('"', '\"', $safe_q) . '"');
                }
            }
            
            send_mpd_command($socket, 'play');
            echo json_encode(['success' => true, 'played' => ['intent' => $search_type, 'query' => $final_query]]);
            exit;
        }

        echo json_encode($final_results);
    }

    else if ($action === 'command') { 
        $cmd = $_GET['cmd'] ?? '';
        $param = $_GET['param'] ?? '';
        $mpd_cmd = '';

        if ($cmd === 'toggle') {
            $status_raw = send_mpd_command($socket, 'status');
            $song_raw = send_mpd_command($socket, 'currentsong');
            
            $state = '';
            $file = '';
            
            foreach (explode("\n", $status_raw) as $line) {
                if (strpos($line, 'state:') === 0) $state = trim(substr($line, 6));
            }
            foreach (explode("\n", $song_raw) as $line) {
                if (stripos($line, 'file:') === 0) $file = trim(substr($line, 6));
            }
            
            $is_webradio = (
                stripos($file, 'http://') === 0 || 
                stripos($file, 'https://') === 0 || 
                stripos($file, 'RADIO/') === 0 || 
                stripos($file, 'WEBRADIO/') === 0
            );

            if ($state === 'play') {
                $mpd_cmd = $is_webradio ? 'stop' : 'pause 1';
            } else {
                $mpd_cmd = 'play';
            }
        }
        else if ($cmd === 'play') $mpd_cmd = 'play';
        else if ($cmd === 'stop') $mpd_cmd = 'stop'; 
        else if ($cmd === 'pause') {
            $song_raw = send_mpd_command($socket, 'currentsong');
            $file = '';
            foreach (explode("\n", $song_raw) as $line) {
                if (stripos($line, 'file:') === 0) $file = trim(substr($line, 6));
            }
            $is_webradio = (
                stripos($file, 'http://') === 0 || 
                stripos($file, 'https://') === 0 || 
                stripos($file, 'RADIO/') === 0 || 
                stripos($file, 'WEBRADIO/') === 0
            );
            $mpd_cmd = $is_webradio ? 'stop' : 'pause 1';
        }
        else if ($cmd === 'next') $mpd_cmd = 'next';
        else if ($cmd === 'previous') $mpd_cmd = 'previous';
        else if ($cmd === 'volume') $mpd_cmd = 'setvol ' . intval($param);
        else if ($cmd === 'playid') $mpd_cmd = 'playid ' . intval($param);
        else if ($cmd === 'seek') $mpd_cmd = 'seekcur ' . intval($param);
        else if ($cmd === 'repeat') $mpd_cmd = 'repeat ' . intval($param);
        else if ($cmd === 'random') $mpd_cmd = 'random ' . intval($param);
        else if ($cmd === 'clear') $mpd_cmd = 'clear';
        else if ($cmd === 'save_playlist') {
            $safe_param = str_replace('"', '\"', $param);
            $mpd_cmd = 'save "' . $safe_param . '"';
        }
        else if ($cmd === 'load_playlist') {
            $safe_param = str_replace('"', '\"', $param);
            send_mpd_command($socket, 'clear');
            send_mpd_command($socket, 'load "' . $safe_param . '"');
            $mpd_cmd = 'play';
        }
        else if ($cmd === 'delete_playlist') {
            $safe_param = str_replace('"', '\"', $param);
            $mpd_cmd = 'rm "' . $safe_param . '"';
        }
        else if ($cmd === 'addplay') {
            $type = $_GET['type'] ?? 'file';
            $mode = $_GET['mode'] ?? 'play';
            $safe_param = str_replace('"', '\"', $param);

            $ext = strtolower(pathinfo($param, PATHINFO_EXTENSION));
            if (in_array($ext, ['pls', 'm3u', 'm3u8'])) {
                $type = 'playlist';
            }

            if ($mode === 'play') send_mpd_command($socket, 'clear');

            if ($type === 'album') send_mpd_command($socket, 'findadd album "' . $safe_param . '"');
            else if ($type === 'artist') send_mpd_command($socket, 'findadd artist "' . $safe_param . '"');
            else if ($type === 'playlist') send_mpd_command($socket, 'load "' . $safe_param . '"');
            else send_mpd_command($socket, 'add "' . $safe_param . '"');

            if ($mode === 'play') send_mpd_command($socket, 'play');

            echo json_encode(['success' => true]);
            exit;
        }

        if ($mpd_cmd) {
            send_mpd_command($socket, $mpd_cmd);
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Comando non valido']);
        }
    }

    else if ($action === 'set_custom_cover') {
        $folder = $_POST['folder'] ?? '';
        
        if (isset($_FILES['cover']) && !empty($folder)) {
            $rel_dir = ltrim($folder, '/');
            $hash = md5($rel_dir);
            $dest = HIFI_CACHE_DIR . '/' . $hash . '.jpg';
            
            if (!is_dir(HIFI_CACHE_DIR)) {
                @mkdir(HIFI_CACHE_DIR, 0775, true);
            }

            if (move_uploaded_file($_FILES['cover']['tmp_name'], $dest)) {
                echo json_encode(['success' => true, 'coverUrl' => 'cache/' . $hash . '.jpg']);
                exit;
            }
        }
        echo json_encode(['success' => false, 'error' => 'Upload fallito']);
        exit;
    }

} 
catch (\Throwable $e) {
    echo json_encode([
        'success' => false, 
        'error' => 'PHP Fatal Error: ' . $e->getMessage() . ' in ' . $e->getFile() . ' on line ' . $e->getLine()
    ]);
}

if ($socket) fclose($socket);
?>
