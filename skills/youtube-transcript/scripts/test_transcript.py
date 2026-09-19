import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import fetch_transcript as transcript

URL = 'https://www.youtube.com/watch?v=iKwPaB5TUdI'
TRACK = [{'ext': 'json3'}]
DATA = {'events': [
    {'tStartMs': 1500, 'dDurationMs': 2400, 'segs': [{'utf8': 'Hello'}, {'utf8': ' world'}]},
    {'tStartMs': 4000, 'dDurationMs': 1200, 'segs': [{'utf8': 'Hello world'}]},
    {'tStartMs': 5000, 'segs': [{'utf8': '\n'}]},
]}


class TranscriptTests(unittest.TestCase):
    def test_url_normalization_and_rejection(self):
        for value in ['iKwPaB5TUdI', 'https://youtu.be/iKwPaB5TUdI?t=10', URL + '&list=anything', 'https://www.youtube.com/shorts/iKwPaB5TUdI']:
            self.assertEqual(transcript.canonical_url(value), URL)
        for value in ['--exec=bad', 'https://youtube.com.attacker.com/watch?v=iKwPaB5TUdI', 'https://youtube.com/playlist?list=123']:
            with self.assertRaises(transcript.TranscriptError):
                transcript.canonical_url(value)

    def test_manual_first_then_automatic_and_language_selection(self):
        info = {'subtitles': {'en-GB': TRACK}, 'automatic_captions': {'en': TRACK}}
        self.assertEqual(transcript.select_track(info, 'en'), ('en-GB', False))
        self.assertEqual(transcript.select_track({'automatic_captions': {'en-orig': TRACK}}, 'en'), ('en-orig', True))
        self.assertEqual(transcript.select_track({'subtitles': {'fr': TRACK}}, 'fr'), ('fr', False))
        with self.assertRaises(transcript.TranscriptError):
            transcript.select_track({'subtitles': {'en': []}}, 'en')

    def test_timestamps_links_spacing_and_spoken_repetition(self):
        cues = transcript.parse_captions(DATA, URL)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0], {'start': 1.5, 'duration': 2.4, 'text': 'Hello world', 'url': URL + '&t=1s'})
        self.assertEqual(cues[1]['text'], 'Hello world')
        self.assertEqual(transcript.time_label(3661.9), '1:01:01')
        with self.assertRaises(transcript.TranscriptError):
            transcript.parse_captions({'events': [{'tStartMs': -1, 'segs': [{'utf8': 'Invalid'}]}]}, URL)

    def test_fetch_uses_caption_only_flags_and_cleans_temporary_files(self):
        calls, directories = [], []
        def run(command, **kwargs):
            calls.append(command)
            self.assertIn('--ignore-config', command)
            self.assertIn('--no-playlist', command)
            self.assertIn('--skip-download', command)
            self.assertFalse(kwargs.get('shell', False))
            if '--dump-single-json' in command:
                return subprocess.CompletedProcess(command, 0, json.dumps({'title': 'Test', 'subtitles': {'en': TRACK}}), '')
            template = command[command.index('--output') + 1]
            directory = Path(template).parent
            directories.append(directory)
            (directory / 'captions.en.json3').write_text(json.dumps(DATA))
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(transcript.shutil, 'which', return_value='/bin/yt-dlp'), patch.object(transcript.subprocess, 'run', side_effect=run):
            result = transcript.fetch(URL)
        self.assertEqual(result['caption_source'], 'manual')
        self.assertEqual(len(result['cues']), 2)
        self.assertEqual(len(calls), 2)
        self.assertIn('--write-subs', calls[1])
        self.assertTrue(all(not directory.exists() for directory in directories))

    def test_network_errors_timeouts_and_missing_dependency_are_explicit(self):
        with patch.object(transcript.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(transcript.TranscriptError, 'missing'):
                transcript.fetch(URL)
        with patch.object(transcript.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'HTTP Error 429 https://example.com?token=private')):
            with self.assertRaises(transcript.TranscriptError) as error:
                transcript.invoke('yt-dlp', [])
            self.assertIn('429', str(error.exception))
            self.assertNotIn('private', str(error.exception))
        with patch.object(transcript.subprocess, 'run', side_effect=subprocess.TimeoutExpired('yt-dlp', 90)):
            with self.assertRaisesRegex(transcript.TranscriptError, 'timed out'):
                transcript.invoke('yt-dlp', [])


if __name__ == '__main__':
    unittest.main()
