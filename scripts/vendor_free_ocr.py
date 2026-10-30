"""Rebuild the pinned, locally hosted free OCR assets. No user images are uploaded."""
from pathlib import Path
import gzip,hashlib,json,requests

ROOT=Path(__file__).resolve().parent.parent
VENDOR=ROOT/'docs/vendor/paddleocr'
PACKAGES=ROOT/'tools/free-ocr/node_modules'
if not PACKAGES.exists():PACKAGES=ROOT/'.test-deps/paddle-browser/node_modules'
MODELS=ROOT/'.test-deps/paddle-models'
PINNED=[
 ('worker.js.gz',PACKAGES/'@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js','477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52'),
 ('ort-wasm-simd-threaded.jsep.mjs',PACKAGES/'onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs','9a99acd12acc495184c9ea4d458ac9424f8180aacfbc7b8371ed64f9351e4a81'),
 ('runtime.wasm.gz',PACKAGES/'onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm','2e0a3d0e3f6b7c13ecfaba38c13691fd19c9ed470e72f9d7d8416ca59ab6dbcd'),
 ('det.tar.gz',MODELS/'PP-OCRv6_tiny_det.tar','ff6ab415b0a6e0c488550f2fb5d5046f1719848df220b2dc21b56402a65bc05d'),
 ('rec.tar.gz',MODELS/'PP-OCRv6_tiny_rec.tar','1e13b22717b1edd89d4cde4fda272b6c17d5b505c97c2baea99da1a3a2d54b29'),
]
def build():
 VENDOR.mkdir(parents=True,exist_ok=True)
 entries={}
 for name,path,sha in PINNED:
  if not path.exists() and path.parent==MODELS:
   MODELS.mkdir(parents=True,exist_ok=True);url='https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/'+path.stem+'_onnx_infer.tar';r=requests.get(url,timeout=60);r.raise_for_status();path.write_bytes(r.content)
  raw=path.read_bytes()
  if hashlib.sha256(raw).hexdigest()!=sha: raise ValueError('Upstream artifact changed: '+path.name)
  data=gzip.compress(raw,compresslevel=9,mtime=0) if name.endswith('.gz') else raw
  (VENDOR/name).write_bytes(data)
  entries[name]={'sha256':hashlib.sha256(data).hexdigest(),'rawSha256':sha,'bytes':len(data),'rawBytes':len(raw)}
 manifest={'sdk':'@paddleocr/paddleocr-js@0.4.2','ort':'onnxruntime-web@1.24.3','model':'PP-OCRv6_tiny','assets':entries}
 (VENDOR/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 licenses=[
 ('PaddleOCR / PaddleOCR.js / PP-OCR models — Apache-2.0','https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE'),
 ('ONNX Runtime — MIT','https://raw.githubusercontent.com/microsoft/onnxruntime/v1.24.3/LICENSE'),
 ('Clipper 6.4.2 — Boost Software License 1.0','https://www.boost.org/LICENSE_1_0.txt'),
 ]
 text=['Pinned free OCR distribution. Source: https://github.com/PaddlePaddle/PaddleOCR\n\n'
       'PaddleOCR.js 0.4.2; ONNX Runtime Web 1.24.3; OpenCV.js 4.10.0-release.1; '
       'clipper-lib 6.4.2; js-yaml 4.1.1. The SDK worker is unmodified; gzip only.\n']
 for label,url in licenses:
  r=requests.get(url,timeout=30);r.raise_for_status();text += ['\n'+label+'\n'+url+'\n\n'+r.text]
 for package in ['@techstark/opencv-js','js-yaml']:
  p=PACKAGES/package/'LICENSE'
  text += ['\n'+package+'\n\n'+p.read_text()]
 (VENDOR/'NOTICE.txt').write_text('\n'.join(text))
 print(json.dumps({'assets':len(entries),'downloadBytes':sum(e['bytes'] for e in entries.values()),'manifest':str(VENDOR/'manifest.json')}))
if __name__=='__main__':build()

