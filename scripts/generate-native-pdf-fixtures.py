"""Deterministic synthetic acceptance PDFs; no private documents or external tools."""
from pathlib import Path
import hashlib
import json
root = Path(__file__).resolve().parents[1]
out = root / 'test/fixtures/native-pdf'
out.mkdir(exist_ok=True)

def pdf(objects):
    data = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(data)
    data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        data += f'{offset:010} 00000 n \n'.encode()
    data += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    return data

def stream(data, dictionary=b''):
    return b'<< /Length ' + str(len(data)).encode() + b' ' + dictionary + b' >>\nstream\n' + data + b'\nendstream'

objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
kids = []
for page in range(1,201):
    index = len(objects)+1
    kids.append(f'{index} 0 R')
    contents = b'BT /F1 14 Tf 30 450 Td (Page ' + str(page).encode() + b' repeated text) Tj 0 -30 Td (Second line repeated text) Tj ET'
    objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 3 0 R >> >> /Contents {index+1} 0 R >>'.encode(), stream(contents)]
objects[1] = f'<< /Type /Pages /Count 200 /Kids [{" ".join(kids)}] >>'.encode()
(out/'two-hundred-pages.pdf').write_bytes(pdf(objects))
# A real raster XObject, no hidden text.
(out/'scan.pdf').write_bytes(pdf([
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>',
    stream(b'q 400 0 0 500 0 0 cm /Im Do Q'),
    stream(bytes([30,60,90,220,220,220,255,255,255,60,30,90]),b'/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8')
]))
(out/'corrupt.pdf').write_bytes(b'%PDF-1.4\nnot a PDF body\n')
paths = [*out.glob('*.pdf'), * (root/'test/compat/fixtures/pdf').glob('*.pdf'), *(root/'test/fixtures/pdf').glob('*.pdf'), *(root/'test/compat/fixtures/highlights').glob('pdf-*.json')]
manifest = {str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(paths)}
(out/'hashes.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Native PDF fixture hashes:',len(manifest))
