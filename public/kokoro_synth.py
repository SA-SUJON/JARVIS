import argparse
import sys
import soundfile as sf
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--voices', required=True)
parser.add_argument('--voice', default='af_sarah')
parser.add_argument('--output', required=True)
args = parser.parse_args()

text = sys.stdin.read().strip()
if not text:
    raise SystemExit('No input text received')

engine = Kokoro(args.model, args.voices)
samples, sample_rate = engine.create(text, voice=args.voice, speed=1.0, lang='en-us')
sf.write(args.output, samples, sample_rate)
print(args.output)
