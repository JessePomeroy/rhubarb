import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import sessions


def usage(tokens, cost):
    return {'totalTokens': tokens, 'input': tokens, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'cost': {'total': cost}}


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, records, cwd='/projects/demo'):
        path = self.root / 'project' / (name + '.jsonl')
        path.parent.mkdir(parents=True, exist_ok=True)
        header = {'type': 'session', 'id': name, 'cwd': cwd, 'timestamp': '2026-09-01T00:00:00Z'}
        path.write_text('\n'.join(json.dumps(row) for row in [header, *records]) + '\n')
        return path

    def msg(self, identifier, text, role='user', parent=None, date='2026-09-19T10:00:00Z', **extra):
        return {'type': 'message', 'id': identifier, 'parentId': parent, 'timestamp': date,
                'message': {'role': role, 'content': [{'type': 'text', 'text': text}], **extra}}

    def query(self, *args):
        return sessions.run(sessions.parser().parse_args([*args, '--root', str(self.root)]))

    def test_search_filters_message_dates_and_project_with_bounded_context(self):
        self.write('parent', [self.msg('old', 'Herdr old', date='2026-09-01T00:00:00Z'), self.msg('new', 'prefix ' * 100 + 'Herdr useful')])
        self.write('other', [self.msg('other', 'Herdr unrelated')], cwd='/projects/other')
        result = self.query('search', 'herdr', '--cwd', 'demo', '--since', '2026-09-18', '--max-chars', '80')
        self.assertEqual(result['matching_records'], 1)
        self.assertEqual(result['results'][0]['entry_id'], 'new')
        self.assertIn('Herdr useful', result['results'][0]['text'])

    def test_explicit_and_probable_children_excluded_unless_requested(self):
        child = self.write('linked', [self.msg('u', 'Delegated task')])
        self.write('inferred', [self.msg('i', 'Inspect tests')])
        self.write('parent', [self.msg('p', 'My request', role='assistant'),
            {'type': 'custom', 'data': {'sessionFilePath': str(child)}},
            {'type': 'message', 'message': {'role': 'assistant', 'content': [
                {'type': 'toolCall', 'name': 'subagent_spawn', 'arguments': {'prompt': 'Inspect tests'}}]}}])
        self.assertEqual([row['id'] for row in self.query('list')['results']], ['parent'])
        self.assertEqual(self.query('list', '--include-children')['matching_records'], 3)
        self.assertEqual(self.query('show', '--session', 'linked')['results'][0]['text'], 'Delegated task')

    def test_prompts_excludes_assistant_tool_and_thinking_but_labels_unknown_origin(self):
        self.write('parent', [self.msg('u', 'My correction'), self.msg('a', 'Response', role='assistant'), self.msg('t', 'tool secret', role='toolResult')])
        result = self.query('prompts')
        self.assertEqual(result['matching_records'], 1)
        self.assertEqual(result['results'][0]['session']['origin'], 'unknown')
        self.assertIn('not proof of human authorship', result['notice'])
        self.assertEqual(self.query('show', '--session', 'parent')['matching_records'], 2)
        self.assertEqual(self.query('show', '--session', 'parent', '--include-tools')['matching_records'], 3)

    def test_partial_json_is_reported_without_losing_valid_records(self):
        path = self.write('parent', [self.msg('u', 'Useful')])
        with path.open('a') as stream:
            stream.write('{"type":')
        result = self.query('prompts')
        self.assertEqual(result['matching_records'], 1)
        self.assertEqual(result['warnings'], {'malformed_records': 1})

    def test_usage_uses_latest_branch_and_latest_child_revision_without_mirrors(self):
        def ledger(identifier, parent, tokens, cost, reported):
            return {'type': 'custom', 'id': identifier, 'parentId': parent, 'customType': 'rhubarb-child-usage',
                    'data': {'version': 1, 'key': 'subagent:sa-1:1', 'kind': 'subagent', 'usage': usage(tokens, cost), 'reportedToParent': reported}}
        self.write('parent', [self.msg('a', 'Answer', role='assistant', usage=usage(10, 1)),
                             ledger('l1', 'a', 20, 2, False),
                             ledger('l2', 'l1', 20, 2, True),
                             self.msg('mirror', 'Child result', role='toolResult', parent='l2', toolName='subagent_wait', usage=usage(20, 2)),
                             self.msg('abandoned', 'Other branch', role='assistant', parent='mirror', usage=usage(999, 99)),
                             {'type': 'compaction', 'id': 'c', 'parentId': 'mirror', 'usage': usage(5, .5)}])
        result = self.query('usage', '--session', 'parent')
        self.assertEqual(result['groups']['parent']['tokens'], 15)
        self.assertEqual(result['groups']['parent']['recorded_cost_usd'], 1.5)
        self.assertEqual(result['groups']['subagents']['tokens'], 20)
        self.assertEqual(result['groups']['subagents']['records'], 1)

    def test_ambiguous_prefix_missing_branch_and_invalid_filters_fail(self):
        self.write('same-one', [self.msg('u', 'First')])
        self.write('same-two', [self.msg('x', 'Second', parent='missing')])
        with self.assertRaisesRegex(ValueError, 'unique'):
            self.query('show', '--session', 'same')
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            self.query('usage', '--session', 'same-two')
        with self.assertRaisesRegex(ValueError, 'required'):
            self.query('usage')
        with self.assertRaisesRegex(ValueError, 'date filters'):
            self.query('usage', '--session', 'same-one', '--since', '7d')

    def test_redaction_and_pagination(self):
        self.write('parent', [self.msg('a', 'API_KEY=supersecret Bearer othersecret'), self.msg('b', 'Second')])
        first = self.query('prompts', '--limit', '1')
        self.assertNotIn('supersecret', first['results'][0]['text'])
        self.assertNotIn('othersecret', first['results'][0]['text'])
        self.assertEqual(first['next_offset'], 1)
        self.assertEqual(self.query('prompts', '--offset', '1')['results'][0]['text'], 'Second')

    def test_cli_keeps_session_bytes_unchanged(self):
        path = self.write('parent', [self.msg('u', 'Find this fact')])
        before = path.read_bytes()
        result = subprocess.run([sys.executable, str(Path(sessions.__file__)), 'search', 'fact', '--root', str(self.root), '--json'], check=True, capture_output=True, text=True)
        self.assertEqual(json.loads(result.stdout)['matching_records'], 1)
        self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
