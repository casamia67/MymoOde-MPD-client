#!/bin/bash

# ==========================================
# 1. RECUPERO COMPLETO DEI METADATI E STREAM
# ==========================================
SONG_RAW=$(echo -e "currentsong\nclose" | nc localhost 6600)
STATUS_RAW=$(echo -e "status\nclose" | nc localhost 6600)

ARTIST=$(echo "$SONG_RAW" | grep -i "^Artist:" | cut -d' ' -f2-)
TITLE=$(echo "$SONG_RAW" | grep -i "^Title:" | cut -d' ' -f2-)
NAME=$(echo "$SONG_RAW" | grep -i "^Name:" | cut -d' ' -f2-)
ALBUM=$(echo "$SONG_RAW" | grep -i "^Album:" | cut -d' ' -f2-)
DATE=$(echo "$SONG_RAW" | grep -i "^Date:" | cut -d' ' -f2-)
GENRE=$(echo "$SONG_RAW" | grep -i "^Genre:" | cut -d' ' -f2-)
TRACK=$(echo "$SONG_RAW" | grep -i "^Track:" | cut -d' ' -f2-)
FILE=$(echo "$SONG_RAW" | grep -i "^file:" | cut -d' ' -f2-)
TIME=$(echo "$SONG_RAW" | grep -i "^Time:" | cut -d' ' -f2-)

if [ -z "$FILE" ]; then
    echo "Stato: Nessun file in riproduzione o MPD è in stop."
    exit 0
fi

# ==========================================
# 2. IDENTIFICAZIONE SORGENTE (Locale vs Stream)
# ==========================================
IS_STREAM=0
if [[ "$FILE" =~ ^https?:// ]] || [[ "$FILE" =~ ^mms?:// ]] || [[ "$FILE" =~ ^rtsp:// ]]; then
    IS_STREAM=1
fi

# ==========================================
# 3. LOGICA DI COMPENSAZIONE E METADATI STREAM
# ==========================================
if [ "$IS_STREAM" -eq 1 ]; then
    STREAM_STATION="${NAME:-Web Radio}"
    
    if [ -z "$TITLE" ]; then
        TITLE=$(basename "$FILE")
        ARTIST="$STREAM_STATION"
    else
        [ -z "$ARTIST" ] && ARTIST="$STREAM_STATION"
    fi
    
    [ -z "$ALBUM" ] && ALBUM="Streaming in Diretta"
    [ -z "$GENRE" ] && GENRE="Radio / Web Stream"
    [ -z "$TIME" ]  && TIME="Live Stream"
else
    if [ -z "$TITLE" ]; then
        TITLE=$(basename "$FILE")
        ARTIST="Sconosciuto"
    fi
    [ -z "$ALBUM" ] && ALBUM="-"
    [ -z "$DATE" ]  && DATE="-"
    [ -z "$GENRE" ] && GENRE="-"
    [ -z "$TRACK" ] && TRACK="-"
    [ -z "$TIME" ]  && TIME="Sconosciuta"
fi

[ -z "$DATE" ]  && DATE="-"
[ -z "$TRACK" ] && TRACK="-"

STATE_LINE=$(mpc status | sed -n 2p)
PLAY_STATE=$(echo "$STATE_LINE" | awk '{print $1}' | tr -d '[]')

# ==========================================
# 4. ANALISI SORGENTE E SPECIFICHE TECNICHE
# ==========================================
if [ "$IS_STREAM" -eq 1 ]; then
    # Web Radio: Analisi tramite ffprobe
    FFPROBE_OUT=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -show_entries format=bit_rate -of default=noprint_wrappers=1 "$FILE" 2>/dev/null)
    
    if [ -n "$FFPROBE_OUT" ]; then
        FF_CODEC=$(echo "$FFPROBE_OUT" | grep "codec_name=" | cut -d'=' -f2 | tr '[:lower:]' '[:upper:]')
        FF_RATE=$(echo "$FFPROBE_OUT" | grep "sample_rate=" | cut -d'=' -f2)
        FF_CH=$(echo "$FFPROBE_OUT" | grep "channels=" | cut -d'=' -f2)
        FF_BR=$(echo "$FFPROBE_OUT" | grep "bit_rate=" | cut -d'=' -f2)

        if [ -n "$FF_RATE" ] && [ "$FF_RATE" -gt 0 ] 2>/dev/null; then
            FREQ_KHZ=$(awk "BEGIN {printf \"%.1f\", $FF_RATE/1000}")
            RATE_TEXT="${FREQ_KHZ} kHz"
        else
            RATE_TEXT="N/D"
        fi

        [ "$FF_CH" == "2" ] && CH_TXT="Stereo" || CH_TXT="Canali: ${FF_CH:-N/D}"

        if [ -n "$FF_BR" ] && [ "$FF_BR" -gt 0 ] 2>/dev/null; then
            BR_KBPS=$((FF_BR / 1000))
        fi

        SRC_INFO="$FF_CODEC ($RATE_TEXT | $CH_TXT)"
        BITRATE_RAW=${BR_KBPS:-$(echo "$STATUS_RAW" | grep "bitrate:" | cut -d' ' -f2)}
    else
        STREAM_BITRATE=$(echo "$STATUS_RAW" | grep "bitrate:" | cut -d' ' -f2)
        SRC_INFO="Web Stream (${STREAM_BITRATE:-N/D} kbps)"
        BITRATE_RAW="$STREAM_BITRATE"
    fi
else
    # File Locali: Estrapolazione da parametri nativi MPD
    SRC_RAW=$(echo "$SONG_RAW" | grep -i "^format:" | cut -d' ' -f2)
    EXT="${FILE##*.}"
    EXT_UPPER=$(echo "$EXT" | tr '[:lower:]' '[:upper:]')

    if [[ "$SRC_RAW" =~ ^dsd ]]; then
        DSD_RATE=$(echo "$SRC_RAW" | cut -d':' -f1 | tr '[:lower:]' '[:upper:]')
        CHANNELS=$(echo "$SRC_RAW" | cut -d':' -f2)
        [ "$CHANNELS" == "2" ] && CH_TXT="Stereo" || CH_TXT="Canali: $CHANNELS"
        SRC_INFO="$EXT_UPPER / $DSD_RATE (1-bit | $CH_TXT)"
    elif [ -n "$SRC_RAW" ]; then
        FREQ_HZ=$(echo "$SRC_RAW" | cut -d':' -f1)
        BITS=$(echo "$SRC_RAW" | cut -d':' -f2)
        CHANNELS=$(echo "$SRC_RAW" | cut -d':' -f3)
        FREQ_KHZ=$(awk "BEGIN {printf \"%.1f\", $FREQ_HZ/1000}")
        [ "$CHANNELS" == "2" ] && CH_TXT="Stereo" || CH_TXT="Canali: $CHANNELS"
        SRC_INFO="$EXT_UPPER (${FREQ_KHZ} kHz | ${BITS}-bit | $CH_TXT)"
    else
        SRC_INFO="$EXT_UPPER (Formato non specificato)"
    fi
    BITRATE_RAW=$(echo "$STATUS_RAW" | grep "bitrate:" | cut -d' ' -f2)
fi

# ==========================================
# 5. ANALISI USCITA AL DAC
# ==========================================
MPD_OUT_RAW=$(echo "$STATUS_RAW" | grep "^audio:" | cut -d' ' -f2)
HW_PARAMS=$(cat /proc/asound/card*/pcm0p/sub0/hw_params 2>/dev/null | head -n 10)

if [[ -z "$HW_PARAMS" ]] || [[ "$HW_PARAMS" != *"format:"* ]]; then
    if [ -n "$MPD_OUT_RAW" ]; then
        FREQ_HZ=$(echo "$MPD_OUT_RAW" | cut -d':' -f1)
        BITS=$(echo "$MPD_OUT_RAW" | cut -d':' -f2)
        CHANNELS=$(echo "$MPD_OUT_RAW" | cut -d':' -f3)
        [ "$CHANNELS" == "2" ] && CH_TXT="Stereo" || CH_TXT="Canali: $CHANNELS"

        if [[ "$MPD_OUT_RAW" == *"dsd"* ]]; then
            FREQ_MHZ=$(awk "BEGIN {printf \"%.4f\", $FREQ_HZ/1000000}")
            OUT_INFO="Uscita DSP/MPD: DSD (${FREQ_MHZ} MHz | 1-bit | $CH_TXT)"
        else
            FREQ_KHZ=$(awk "BEGIN {printf \"%.1f\", $FREQ_HZ/1000}")
            OUT_INFO="Uscita DSP/MPD: PCM (${FREQ_KHZ} kHz | ${BITS}-bit | $CH_TXT)"
        fi
    else
        OUT_INFO="Nessun flusso hardware rilevato (Audio Chiuso)"
    fi
else
    OUT_FORMAT=$(echo "$HW_PARAMS" | grep -E '^format:' | awk '{print $2}')
    OUT_RATE=$(echo "$HW_PARAMS" | grep "rate:" | awk '{print $2}')

    case "$OUT_FORMAT" in
        DSD_U32_BE|DSD_U32_LE|DSD_U16_BE|DSD_U16_LE)
            OUT_FREQ_MHZ=$(awk "BEGIN {printf \"%.4f\", $OUT_RATE/1000000}")
            OUT_INFO="DSD Puro Diretto (${OUT_FREQ_MHZ} MHz | Formato: $OUT_FORMAT)"
            ;;
        S24_LE|S24_BE|S32_LE|S32_BE)
            OUT_FREQ_KHZ=$(awk "BEGIN {printf \"%.1f\", $OUT_RATE/1000}")
            if [ "$OUT_RATE" -eq 176400 ] || [ "$OUT_RATE" -eq 352800 ] || [ "$OUT_RATE" -eq 705600 ]; then
                OUT_INFO="DoP / PCM Diretto ($OUT_FREQ_KHZ kHz | Formato: $OUT_FORMAT)"
            else
                OUT_INFO="PCM Hi-Res Diretto ($OUT_FREQ_KHZ kHz | Formato: $OUT_FORMAT)"
            fi
            ;;
        *)
            OUT_FREQ_KHZ=$(awk "BEGIN {printf \"%.1f\", $OUT_RATE/1000}")
            OUT_INFO="PCM Diretto ($OUT_FREQ_KHZ kHz | Formato: $OUT_FORMAT)"
            ;;
    esac
fi

# ==========================================
# 6. STAMPA DEL REPORT FINALE
# ==========================================
echo "========================================================================="
if [ "$IS_STREAM" -eq 1 ]; then
    echo " METADATI WEB RADIO / STREAMING (Stato: $PLAY_STATE)"
else
    echo " METADATI BRANO LOCALE (Stato: $PLAY_STATE)"
fi
echo "========================================================================="

if [ "$IS_STREAM" -eq 1 ]; then
    echo "Stazione / Nome: ${NAME:-Sconosciuta}"
    echo "Brano in onda:   $TITLE"
    echo "Artista/Autore:  $ARTIST"
    echo "Genere Stream:   $GENRE"
    echo "URL Flusso:      $FILE"
else
    echo "Artista:         $ARTIST"
    echo "Titolo:          $TITLE"
    echo "Album:           $ALBUM"
    echo "Genere:          $GENRE"
    echo "Anno:            $DATE"
    echo "Traccia:         $TRACK"
    echo "Durata:          $TIME"
    echo "Percorso:        $FILE"
fi

echo "========================================================================="
echo " SPECIFICHE TECNICHE AUDIO"
echo "========================================================================="
echo "Sorgente File:   $SRC_INFO"
echo "Uscita al DAC:   $OUT_INFO"
echo "Bitrate:         ${BITRATE_RAW:-Sconosciuto} kbps"
echo "========================================================================="
echo -e "Sorgente (MPD):  $(echo "$STATUS_RAW" | grep 'audio:' | cut -d' ' -f2)"

RAW_HW=$(cat /proc/asound/card*/pcm0p/sub0/hw_params 2>/dev/null | grep -E '(format|rate)')
if [[ -n "$RAW_HW" ]]; then
    echo -e "Uscita Reale (DAC):\n$RAW_HW"
else
    echo "Uscita Reale (DAC): [Chiuso o non disponibile]"
fi
