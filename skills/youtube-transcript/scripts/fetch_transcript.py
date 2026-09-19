#!/usr/bin/env python3
"""Retrieve YouTube captions with timestamps; never download audio or video."""
import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlparse


class TranscriptError(Exception):
    pass


def canonical_url(value):
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', value):
        return f'https://www.youtube.com/watch?v={value}'
    parsed = urlparse(value)
    host = (parsed.hostname or '').lower()
    parts = parsed.path.strip('/').split('/')
    video = ''
    if parsed.scheme not in ('https', 'http') or parsed.username or parsed.password:
        raise TranscriptError('Supply a YouTube video URL or an 11-character video ID.')
    if host in ('youtu.be', 'www.youtu.be') and len(parts) == 1:
        video = parts[0]
    elif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        if parsed.path == '/watch':
            video = parse_qs(parsed.query).get('v', [''])[0]
        elif len(parts) == 2 and parts[0] in ('shorts', 'live', 'embed'):
            video = parts[1]
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
        raise TranscriptError('Unsupported URL: a single YouTube video is required, not a playlist.')
    return f'https://www.youtube.com/watch?v={video}'


def select_track(info, language):
    preferred = [language] + (['en-US', 'en-GB'] if language == 'en' else [])
    for source, automatic in (('subtitles', False), ('automatic_captions', True)):
        tracks = info.get(source) or {}
        if not isinstance(tracks, dict):
            continue
        candidates = preferred + sorted(key for key in tracks if key.startswith(language + '-') and key not in preferred)
        for code in candidates:
            formats = tracks.get(code)
            if isinstance(formats, list) and any(isinstance(track, dict) and track.get('ext') == 'json3' for track in formats):
                return code, automatic
    raise TranscriptError(f'No accessible {language} captions in JSON3 format. No audio transcription was attempted.')


def finite_ms(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def parse_captions(data, url):
    if not isinstance(data, dict) or not isinstance(data.get('events'), list):
        raise TranscriptError('Invalid JSON3 caption data.')
    cues = []
    for event in data['events']:
        if not isinstance(event, dict) or not finite_ms(event.get('tStartMs')):
            continue
        segments = event.get('segs')
        if not isinstance(segments, list):
            continue
        # Preserve segment spacing and repeated spoken phrases; do not globally deduplicate text.
        text = ''.join(seg.get('utf8', '') for seg in segments if isinstance(seg, dict) and isinstance(seg.get('utf8'), str))
        text = ' '.join(text.split())
        if not text:
            continue
        start = event['tStartMs'] / 1000
        duration = event.get('dDurationMs', 0)
        duration = duration / 1000 if finite_ms(duration) else 0
        cue = {'start': start, 'duration': duration, 'text': text, 'url': f'{url}&t={int(start)}s'}
        if not cues or (cues[-1]['start'], cues[-1]['text']) != (start, text):
            cues.append(cue)
    cues.sort(key=lambda cue: cue['start'])
    if not cues:
        raise TranscriptError('Caption response contains no usable text with timestamps.')
    return cues


def invoke(binary, args):
    command = [binary, '--ignore-config', '--no-playlist', '--skip-download', '--no-cache-dir',
               '--socket-timeout', '15', '--retries', '1', *args]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired as error:
        raise TranscriptError('yt-dlp timed out. Retry later; no media was downloaded.') from error
    except OSError as error:
        raise TranscriptError(f'Could not launch yt-dlp: {error.strerror}') from error
    if result.returncode:
        # Do not expose signed caption URLs in diagnostics.
        diagnostic = re.sub(r'https?://\S+', '[URL]', result.stderr.strip())[-1800:]
        raise TranscriptError(f'yt-dlp failed (exit {result.returncode}): {diagnostic}')
    return result.stdout


def fetch(value, language='en'):
    url = canonical_url(value)
    if not re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*', language):
        raise TranscriptError('Use a caption language code such as en, en-US, or fr.')
    binary = shutil.which('yt-dlp')
    if not binary:
        raise TranscriptError('yt-dlp is missing. Install the approved dependency with: uv tool install yt-dlp')
    print('Reading video metadata…', file=sys.stderr)
    try:
        info = json.loads(invoke(binary, ['--dump-single-json', '--', url]))
    except json.JSONDecodeError as error:
        raise TranscriptError('yt-dlp returned invalid metadata JSON.') from error
    if not isinstance(info, dict):
        raise TranscriptError('yt-dlp returned invalid metadata.')
    code, automatic = select_track(info, language)
    print(f'Reading {"automatic" if automatic else "manual"} captions ({code})…', file=sys.stderr)
    with tempfile.TemporaryDirectory(prefix='youtube-captions-') as directory:
        invoke(binary, ['--write-auto-subs' if automatic else '--write-subs',
                        '--sub-langs', '^' + re.escape(code) + '$', '--sub-format', 'json3',
                        '--output', str(Path(directory) / 'captions.%(ext)s'), '--', url])
        files = list(Path(directory).glob('*.json3'))
        if len(files) != 1:
            raise TranscriptError('Expected one caption file; yt-dlp did not produce the selected track.')
        try:
            cues = parse_captions(json.loads(files[0].read_text(encoding='utf-8')), url)
        except (ValueError, OSError) as error:
            raise TranscriptError('Could not read the downloaded caption data.') from error
    return {'title': info.get('title') or 'Untitled video', 'url': url, 'language': code,
            'caption_source': 'automatic' if automatic else 'manual', 'cues': cues,
            'transcript': ' '.join(cue['text'] for cue in cues)}


def time_label(seconds):
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f'{hours}:{minutes:02}:{seconds:02}' if hours else f'{minutes}:{seconds:02}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Single YouTube URL or video ID')
    parser.add_argument('--language', default='en')
    parser.add_argument('--format', choices=('json', 'markdown'), default='json')
    args = parser.parse_args()
    try:
        result = fetch(args.url, args.language)
    except TranscriptError as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    if args.format == 'json':
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"# {result['title']}\n\nSource: {result['url']}\nCaptions: {result['caption_source']} ({result['language']})\n")
        for cue in result['cues']:
            print(f"[{time_label(cue['start'])}]({cue['url']}) {cue['text']}\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
