#!/usr/bin/env python3
"""Read local PDFs using system Poppler; never modify the source PDF."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


class PdfError(Exception):
    pass


def tool(name):
    # Prefer the ordinary system installation over agent-private PATH wrappers.
    system = Path('/usr/bin') / name
    found = str(system) if system.is_file() and os.access(system, os.X_OK) else shutil.which(name)
    if not found:
        raise PdfError(f'Missing {name}; Poppler must be installed before this command can run.')
    return found


def invoke(name, args):
    try:
        result = subprocess.run([tool(name), *args], capture_output=True, text=True,
                                timeout=90, env={**os.environ, 'LC_ALL': 'C'})
    except subprocess.TimeoutExpired as error:
        raise PdfError(f'{name} timed out; narrow the page range.') from error
    except OSError as error:
        raise PdfError(f'{name} could not run: {error.strerror}') from error
    if result.returncode:
        raise PdfError(f'{name} failed: {result.stderr.strip()[-1600:]}')
    return result.stdout


def info(path):
    raw = invoke('pdfinfo', [str(path)])
    metadata = {}
    for line in raw.splitlines():
        key, separator, value = line.partition(':')
        if separator:
            metadata[key.strip()] = value.strip()
    count = metadata.get('Pages', '')
    if not count.isdigit() or int(count) < 1:
        raise PdfError('Could not determine the PDF page count.')
    return {'path': str(path), 'pages': int(count), 'metadata': metadata}


def page_numbers(spec, count):
    if spec == 'all':
        return list(range(1, count + 1))
    selected = set()
    for part in spec.split(','):
        match = re.fullmatch(r'\s*(\d+)(?:-(\d+))?\s*', part)
        if not match:
            raise PdfError('Pages must be all, a page number, a range, or a comma-separated combination.')
        start, end = int(match[1]), int(match[2] or match[1])
        if not 1 <= start <= end <= count:
            raise PdfError(f'Page range {part} is outside 1–{count} or reversed.')
        selected.update(range(start, end + 1))
    return sorted(selected)


def extract(path, pages):
    # Group contiguous pages to avoid one process per page on long documents.
    groups = []
    for page in pages:
        if groups and page == groups[-1][-1] + 1:
            groups[-1].append(page)
        else:
            groups.append([page])
    result = []
    for group in groups:
        text = invoke('pdftotext', ['-f', str(group[0]), '-l', str(group[-1]), '-layout', '-enc', 'UTF-8', str(path), '-'])
        chunks = text.split('\f')
        if len(chunks) < len(group):
            raise PdfError('Text extraction omitted page boundaries; cannot assign reliable page numbers.')
        for page, chunk in zip(group, chunks):
            result.append({'page': page, 'text': chunk.strip(), 'characters': len(chunk.strip())})
    return result


def search(pages, query, limit):
    if not query.strip():
        raise PdfError('Search query must not be blank.')
    hits = []
    count = 0
    for page in pages:
        for line_number, line in enumerate(page['text'].splitlines(), 1):
            if query.casefold() in line.casefold():
                count += 1
                if len(hits) < limit:
                    hits.append({'page': page['page'], 'line': line_number, 'text': line[:1000]})
    return {'matching_lines': count, 'truncated': count > limit, 'hits': hits}


def render(path, pages, dpi, output):
    if not 72 <= dpi <= 300:
        raise PdfError('Use a DPI between 72 and 300.')
    if output:
        output = output.expanduser().resolve()
        if not output.is_dir():
            raise PdfError('--output-dir must be an existing directory.')
    # Always create a fresh child folder so existing images cannot be overwritten.
    directory = Path(tempfile.mkdtemp(prefix='pdf-pages-', dir=output))
    images = []
    try:
        for page in pages:
            prefix = directory / f'page-{page}'
            invoke('pdftoppm', ['-f', str(page), '-l', str(page), '-r', str(dpi), '-scale-to', '2400', '-png', '-singlefile', str(path), str(prefix)])
            image = prefix.with_suffix('.png')
            if not image.is_file():
                raise PdfError(f'No image produced for page {page}.')
            images.append({'page': page, 'path': str(image)})
    except Exception:
        shutil.rmtree(directory)
        raise
    return {'directory': str(directory), 'images': images, 'max_image_dimension': 2400}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('command', choices=('info', 'extract', 'search', 'render'))
    cli.add_argument('pdf', type=Path)
    cli.add_argument('query', nargs='?')
    cli.add_argument('--pages', help='1-indexed pages: all, 3, 1-5, or 1,3-5')
    cli.add_argument('--dpi', type=int, default=150)
    cli.add_argument('--output-dir', type=Path)
    cli.add_argument('--limit', type=int, default=40)
    args = cli.parse_args()
    try:
        path = args.pdf.expanduser().resolve()
        if not path.is_file():
            raise PdfError('The source PDF must be an existing local file.')
        metadata = info(path)
        if args.command == 'info':
            result = metadata
        else:
            default = 'all' if args.command == 'search' else ('1' if args.command == 'render' else f'1-{min(5, metadata["pages"])}')
            pages = page_numbers(args.pages or default, metadata['pages'])
            if args.command == 'render':
                result = {'source': str(path), **render(path, pages, args.dpi, args.output_dir)}
            elif args.command == 'extract':
                result = {'source': str(path), 'total_pages': metadata['pages'], 'pages': extract(path, pages)}
            else:
                if not args.query or args.limit < 1:
                    raise PdfError('Search requires a query and a positive --limit.')
                result = {'source': str(path), **search(extract(path, pages), args.query, args.limit)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except PdfError as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
