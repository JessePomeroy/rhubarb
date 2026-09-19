import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import pdf_read as pdf


class PdfTests(unittest.TestCase):
    def test_page_ranges_deduplicate_and_reject_out_of_bounds(self):
        self.assertEqual(pdf.page_numbers('1,3-5,3', 6), [1, 3, 4, 5])
        self.assertEqual(pdf.page_numbers('all', 3), [1, 2, 3])
        for spec in ('0', '7', '4-2', '-1', '1; rm', ''):
            with self.assertRaises(pdf.PdfError):
                pdf.page_numbers(spec, 6)

    def test_page_numbers_survive_blank_and_discontinuous_pages(self):
        with patch.object(pdf, 'invoke', side_effect=['First\f\fThird\f', 'Fifth\f']):
            result = pdf.extract(Path('/example.pdf'), [1, 2, 3, 5])
        self.assertEqual([(p['page'], p['text']) for p in result], [(1, 'First'), (2, ''), (3, 'Third'), (5, 'Fifth')])

    def test_search_is_literal_case_insensitive_and_bounded(self):
        result = pdf.search([{'page': 2, 'text': 'A+B\na+b\nOther'}], 'a+b', 1)
        self.assertEqual(result['matching_lines'], 2)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['hits'][0]['page'], 2)

    def test_render_failure_removes_only_its_own_new_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            keep = Path(directory) / 'keep.png'
            keep.write_bytes(b'keep')
            with patch.object(pdf, 'invoke', side_effect=pdf.PdfError('broken PDF')):
                with self.assertRaises(pdf.PdfError):
                    pdf.render(Path('/broken.pdf'), [1], 150, Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [keep])

    @unittest.skipUnless(Path('/usr/share/gutenprint/doc/gutenprint-users-manual.pdf').exists(), 'system PDF fixture unavailable')
    def test_real_system_pdf_metadata_extract_search_render_and_source_preservation(self):
        path = Path('/usr/share/gutenprint/doc/gutenprint-users-manual.pdf')
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertGreaterEqual(pdf.info(path)['pages'], 1)
        pages = pdf.extract(path, [1])
        self.assertTrue(pages[0]['text'])
        query = pages[0]['text'].split()[0]
        self.assertGreater(pdf.search(pages, query, 10)['matching_lines'], 0)
        with tempfile.TemporaryDirectory() as directory:
            result = pdf.render(path, [1], 100, Path(directory))
            image = Path(result['images'][0]['path'])
            self.assertEqual(image.read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)


if __name__ == '__main__':
    unittest.main()
