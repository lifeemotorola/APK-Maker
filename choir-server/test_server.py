"""Contract tests use explicitly injected fixtures, never claim neural inference.
Run: python -m unittest discover -s choir-server -p 'test_*.py' -v
"""
import array
import io
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave

from fastapi.testclient import TestClient
from app import Settings, create_app
from pipeline import Pipeline, ProcessingError, Cancelled, run_command, normalize

KEY = "test-only-operator-key-not-for-deployment"
HEADERS = {"X-Choir-Key": KEY, "X-Choir-Consent": "upload-audio"}


def audio_bytes(seconds=1.2):
    samples = array.array("h")
    for i in range(int(22050 * seconds)):
        value = sum(math.sin(2 * math.pi * f * i / 22050) * .08 for f in [98, 196, 329.63, 659.25])
        samples.append(round(value * 32767))
    if sys.byteorder != "little":
        samples.byteswap()
    data = io.BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setparams((1, 2, 22050, len(samples), "NONE", "not compressed"))
        wav.writeframes(samples.tobytes())
    return data.getvalue()


class FixtureProvider:
    """Only injected in tests; a copied mix is NOT model-isolated audio."""
    def separate(self, mixture, work, cancel):
        work.mkdir(parents=True)
        for name in ("vocals", "no_vocals"):
            shutil.copyfile(mixture, work / (name + ".wav"))
        return work / "vocals.wav", work / "no_vocals.wav"


class PipelineTests(unittest.TestCase):
    def test_fixture_pipeline_estimated_guides_and_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "input.bin"; source.write_bytes(audio_bytes())
            stages = []
            result = Pipeline(provider=FixtureProvider())(source, folder, stages.append, threading.Event())
            self.assertEqual(result["separation"]["satb"], "range_guided_estimate")
            self.assertFalse(any(f["kind"] == "satb_stem" for f in result["files"]))
            self.assertFalse((folder / "result/soprano.wav").exists())
            self.assertFalse(source.exists()); self.assertFalse((folder / "work").exists())
            for voice in ["soprano", "alto", "tenor", "bass"]:
                self.assertTrue(result["analysis"]["parts"][voice]["notes"], voice)
                with wave.open(str(folder / ("result/guide-" + voice + ".wav"))) as guide:
                    self.assertEqual(guide.getframerate(), 22050)
                    self.assertEqual(guide.getnchannels(), 1)
                self.assertEqual((folder / ("result/" + voice + ".mid")).read_bytes()[:4], b"MThd")
            self.assertIn("Neural vocal isolation (Demucs)", stages)

    def test_external_model_contract_and_missing_output_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # This fixture validates invocation, naming, alignment and labels,
            # not a trained separator. No fixture path is packaged in the APK.
            script = root / "adapter.py"
            script.write_text("import argparse,shutil,pathlib\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output-dir');a=p.parse_args()\nfor v in ['soprano','alto','tenor','bass']: shutil.copyfile(a.input,pathlib.Path(a.output_dir)/(v+'.wav'))\n")
            folder = root / "job"; folder.mkdir()
            source = folder / "input.bin"; source.write_bytes(audio_bytes())
            result = Pipeline(provider=FixtureProvider(), satb_command=[sys.executable, str(script)])(source, folder, lambda s: None, threading.Event())
            self.assertEqual(result["separation"]["satb"], "external_model")
            self.assertEqual(sum(f["kind"] == "satb_stem" for f in result["files"]), 4)
            bad = root / "bad"; bad.mkdir(); source = bad / "input.bin"; source.write_bytes(audio_bytes())
            with self.assertRaisesRegex(ProcessingError, "must output four"):
                Pipeline(provider=FixtureProvider(), satb_command=[sys.executable, "-c", "pass"])(source, bad, lambda s: None, threading.Event())
            self.assertFalse(source.exists())

    def test_playlist_demuxers_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'input.bin'
            source.write_text('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://untrusted.example/audio.ts\n')
            with self.assertRaises(ProcessingError):
                normalize(source, Path(tmp) / 'out.wav', threading.Event())

    def test_subprocess_cancel_and_command_validation(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(Cancelled):
            run_command([sys.executable, "-c", "import time;time.sleep(20)"], cancel)
        with self.assertRaises(ValueError):
            Pipeline(satb_command="shell commands are not accepted")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def complete(self, client, identifier):
        for _ in range(200):
            response = client.get('/api/choir/v1/jobs/' + identifier, headers=HEADERS)
            if response.status_code == 200 and response.json()["status"] in ("complete", "failed"):
                return response.json()
            time.sleep(.01)
        self.fail("Job did not finish")

    @staticmethod
    def processor(source, folder, stage, cancel):
        stage("Test fixture only")
        result = folder / "result"; result.mkdir()
        (result / "vocals.wav").write_bytes(audio_bytes(.1))
        return {"files": [{"name": "vocals.wav", "kind": "vocal_stem"}], "testOnly": True}

    def test_auth_consent_limits_cors_and_private_download_delete(self):
        settings = Settings(KEY, self.root, max_upload=100000)
        app = create_app(settings, self.processor)
        with TestClient(app) as client:
            base = '/api/choir/v1'
            self.assertEqual(client.get(base + '/health').status_code, 401)
            self.assertEqual(client.get(base + '/health', headers=HEADERS).status_code, 200)
            self.assertEqual(client.post(base + '/jobs', content=b'a', headers={'X-Choir-Key': KEY}).status_code, 400)
            self.assertEqual(client.post(base + '/jobs', content=b'', headers=HEADERS).status_code, 400)
            self.assertEqual(client.post(base + '/jobs', content=b'x' * 100001, headers=HEADERS).status_code, 413)
            self.assertEqual(client.post(base + '/jobs', content=iter([b'x' * 60000, b'x' * 60000]), headers=HEADERS).status_code, 413)
            preflight = client.options(base + '/jobs', headers={'Origin': 'https://appassets.androidplatform.net', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Choir-Key,X-Choir-Consent'})
            self.assertEqual(preflight.headers['access-control-allow-origin'], 'https://appassets.androidplatform.net')
            self.assertEqual(client.options(base + '/jobs', headers={'Origin': 'https://untrusted.example', 'Access-Control-Request-Method': 'POST'}).status_code, 400)
            response = client.post(base + '/jobs', content=b'test fixture', headers=HEADERS)
            self.assertEqual(response.status_code, 202); identifier = response.json()['id']
            self.assertEqual(self.complete(client, identifier)['status'], 'complete')
            path = base + '/jobs/' + identifier
            self.assertEqual(client.get(path + '/files/vocals.wav').status_code, 401)
            download = client.get(path + '/files/vocals.wav', headers=HEADERS)
            self.assertEqual(download.status_code, 200); self.assertEqual(download.content[:4], b'RIFF')
            self.assertEqual(download.headers['cache-control'], 'no-store')
            self.assertEqual(client.get(path + '/files/input.bin', headers=HEADERS).status_code, 404)
            self.assertEqual(client.get(path + '/result', headers=HEADERS).status_code, 200)
            self.assertEqual(client.delete(path, headers=HEADERS).status_code, 202)
            self.assertEqual(client.get(path, headers=HEADERS).status_code, 404)
            self.assertFalse(list(self.root.glob('job-*')))
            self.assertEqual(client.get('/').status_code, 200)

    def test_expiry_and_bounded_queue_cancellation(self):
        def blocking(source, folder, stage, cancel):
            while not cancel.wait(.01):
                pass
            raise Cancelled('Cancelled')
        app = create_app(Settings(KEY, self.root, max_pending=1), blocking)
        with TestClient(app) as client:
            base = '/api/choir/v1/jobs'
            identifier = client.post(base, content=b'x', headers=HEADERS).json()['id']
            self.assertEqual(client.post(base, content=b'x', headers=HEADERS).status_code, 503)
            self.assertEqual(client.get(base + '/' + identifier + '/result', headers=HEADERS).status_code, 409)
            client.delete(base + '/' + identifier, headers=HEADERS)
            for _ in range(100):
                if not list(self.root.glob('job-*')):
                    break
                time.sleep(.01)
            self.assertFalse(list(self.root.glob('job-*')))
        app = create_app(Settings(KEY, self.root, ttl=10), self.processor)
        with TestClient(app) as client:
            identifier = client.post('/api/choir/v1/jobs', content=b'x', headers=HEADERS).json()['id']
            self.complete(client, identifier)
            app.state.jobs.records[identifier]['updated'] = time.time() - 11
            self.assertEqual(client.get('/api/choir/v1/jobs/' + identifier, headers=HEADERS).status_code, 404)
            self.assertFalse(list(self.root.glob('job-*')))

    def test_exclusive_work_directory_and_private_static_boundary(self):
        app = create_app(Settings(KEY, self.root), self.processor)
        try:
            with self.assertRaisesRegex(RuntimeError, 'Another choir service'):
                create_app(Settings(KEY, self.root), self.processor)
        finally:
            app.state.jobs.close()
        public = Path(__file__).resolve().parents[1] / 'android-choirtune' / 'web' / 'private-data'
        with self.assertRaisesRegex(ValueError, 'public web assets'):
            create_app(Settings(KEY, public), self.processor)
        self.assertFalse(public.exists())

    def test_model_failure_is_not_a_fake_success(self):
        def broken(source, folder, stage, cancel):
            raise ProcessingError('Vocal model unavailable')
        app = create_app(Settings(KEY, self.root), broken)
        with TestClient(app) as client:
            identifier = client.post('/api/choir/v1/jobs', content=b'x', headers=HEADERS).json()['id']
            self.assertEqual(self.complete(client, identifier)['status'], 'failed')
            self.assertEqual(client.get('/api/choir/v1/jobs/' + identifier + '/result', headers=HEADERS).status_code, 409)
            self.assertFalse(list(self.root.glob('job-*')))


if __name__ == '__main__':
    unittest.main()
