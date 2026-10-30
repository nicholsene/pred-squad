"""Vendor the pinned, free number reader. No photographs are used by this script."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

MODEL_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz'
MODEL_SHA = '5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('node_modules', type=Path, help='npm install --prefix DIR tesseract.js@7.0.0; then DIR/node_modules')
    args = parser.parse_args()
    js, core = (args.node_modules / name for name in ['tesseract.js', 'tesseract.js-core'])
    for package in [js, core]:
        if json.loads((package / 'package.json').read_text())['version'] != '7.0.0':
            raise SystemExit('Both packages must be pinned to 7.0.0.')
    with urlopen(MODEL_URL, timeout=45) as response:
        model = gzip.decompress(response.read())
    if hashlib.sha256(model).hexdigest() != MODEL_SHA:
        raise SystemExit('Language model did not match the benchmarked bytes.')
    # Unmodified upstream code, concatenated so it needs no CDN/importScripts.
    bundle = (core / 'tesseract-core-lstm.wasm.js').read_bytes() + b'\n;\n' + (js / 'dist/worker.min.js').read_bytes()
    target = Path(__file__).resolve().parents[1] / 'docs/vendor/numericocr'
    target.mkdir(parents=True, exist_ok=True)
    manifest = {'engine': 'tesseract.js@7.0.0', 'core': 'tesseract.js-core@7.0.0', 'model': MODEL_URL, 'modelSha256': MODEL_SHA, 'assets': {}}
    for name, data in [('worker.js.gz', bundle), ('eng.traineddata.gz', model)]:
        zipped = gzip.compress(data, mtime=0)
        (target / name).write_bytes(zipped)
        manifest['assets'][name] = {'bytes': len(zipped), 'sha256': hashlib.sha256(zipped).hexdigest()}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    notice = 'Pinned Tesseract.js 7.0.0 and Tesseract.js-core 7.0.0, Apache-2.0.\n' \
             'https://github.com/naptha/tesseract.js\nhttps://github.com/naptha/tesseract.js-core\n' \
             'English integer LSTM model from @tesseract.js-data/eng@1.0.0, Apache-2.0.\n' + MODEL_URL + '\n\n'
    notice += '\n\n'.join(next(package.glob('LICENSE*')).read_text() for package in [js, core])
    for name in ['worker.min.js.LICENSE.txt']:
        notice += '\n\n' + (js / 'dist' / name).read_text()
    (target / 'NOTICE.txt').write_text(notice)
    print(json.dumps(manifest))

if __name__ == '__main__':
    main()
