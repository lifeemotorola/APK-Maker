"""Private, bounded separation API. Run one Uvicorn worker behind HTTPS.
Global operator key + unguessable job IDs; recordings are never public static
assets. Consent is mandatory per upload. Models/weights are operator-installed.
"""
from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import importlib.util
import fcntl
import json
import logging
import os
from pathlib import Path
import secrets
import shutil
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pipeline import Pipeline, Cancelled, ProcessingError

WEB = Path(__file__).resolve().parents[1] / "android-choirtune" / "web"


@dataclass
class Settings:
    key: str
    root: Path
    ttl: int = 3600
    max_upload: int = 40 * 1024 * 1024
    max_pending: int = 3
    max_results: int = 10
    origins: list[str] = field(default_factory=lambda: ["https://appassets.androidplatform.net"])


class Jobs:
    def __init__(self, settings, processor):
        self.settings, self.processor = settings, processor
        self.lock = threading.RLock()
        self.records = {}
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="choir")
        settings.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory_lock = (settings.root / '.choir.lock').open('a')
        try:
            fcntl.flock(self.directory_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.directory_lock.close()
            self.pool.shutdown(wait=False)
            raise RuntimeError('Another choir service owns this work directory')
        # This directory is exclusively owned by one service instance. Remove
        # abandoned previous-run data; never serve stale recordings after restart.
        for path in settings.root.glob("job-*"):
            if path.is_dir():
                shutil.rmtree(path)

    def cleanup(self):
        with self.lock:
            finished = sorted((r for r in self.records.values() if r["status"] in ("complete", "failed", "cancelled")), key=lambda r: r["updated"])
            overflow = max(0, len(finished) - self.settings.max_results)
            for i, r in enumerate(finished):
                if r["deleted"] or i < overflow or time.time() - r["updated"] >= self.settings.ttl:
                    shutil.rmtree(r["folder"], ignore_errors=True)
                    self.records.pop(r["id"], None)

    def create(self):
        self.cleanup()
        with self.lock:
            if sum(r["status"] in ("uploading", "queued", "running") for r in self.records.values()) >= self.settings.max_pending:
                raise HTTPException(503, "Server busy. Try again later.")
            identifier = secrets.token_urlsafe(24)
            folder = self.settings.root / ("job-" + identifier)
            folder.mkdir(mode=0o700)
            r = dict(id=identifier, folder=folder, status="uploading", stage="Receiving recording", updated=time.time(),
                     cancel=threading.Event(), deleted=False, result=None, error=None)
            self.records[identifier] = r
            return r

    def get(self, identifier):
        self.cleanup()
        with self.lock:
            r = self.records.get(identifier)
            if not r or r["deleted"]:
                raise HTTPException(404, "Job not found or expired")
            return r

    def process(self, r):
        def stage(message):
            with self.lock:
                if r["cancel"].is_set():
                    raise Cancelled("Cancelled")
                r.update(stage=message, updated=time.time())
        try:
            with self.lock:
                r.update(status="running")
            stage("Starting")
            result = self.processor(r["folder"] / "input.bin", r["folder"], stage, r["cancel"])
            if r["cancel"].is_set():
                raise Cancelled("Cancelled")
            with self.lock:
                r.update(status="complete", stage="Ready", result=result, updated=time.time())
        except Cancelled:
            with self.lock:
                r.update(status="cancelled", stage="Cancelled", updated=time.time())
        except Exception as error:
            logging.exception("Choir job failed")
            message = str(error) if isinstance(error, ProcessingError) else "Processing failed. Ask the server operator to check the logs."
            with self.lock:
                r.update(status="failed", stage="Failed", error=message, updated=time.time())
        finally:
            (r["folder"] / "input.bin").unlink(missing_ok=True)
            if r["status"] != "complete":
                shutil.rmtree(r["folder"], ignore_errors=True)
            self.cleanup()

    def close(self):
        with self.lock:
            for r in self.records.values():
                r["cancel"].set()
        self.pool.shutdown(wait=True)
        with self.lock:
            for r in self.records.values():
                shutil.rmtree(r["folder"], ignore_errors=True)
            self.records.clear()
        self.directory_lock.close()


def create_app(settings=None, processor=None):
    if settings is None:
        key = os.getenv("CHOIR_API_KEY", "")
        if len(key) < 24:
            raise RuntimeError("Set CHOIR_API_KEY to an operator-generated secret of at least 24 characters")
        settings = Settings(key=key, root=Path(os.getenv("CHOIR_WORK_DIR", "choir-server-data")).resolve(),
                            ttl=min(86400, max(60, int(os.getenv("CHOIR_RETENTION_SECONDS", "3600")))),
                            origins=os.getenv("CHOIR_ORIGINS", "https://appassets.androidplatform.net").split(","))
    if len(settings.key) < 24:
        raise ValueError("Operator key must contain at least 24 characters")
    if settings.root.resolve().is_relative_to(WEB.resolve()):
        raise ValueError("Private job data cannot be inside the public web assets directory")
    if processor is None:
        command = json.loads(os.environ["CHOIR_SATB_COMMAND_JSON"]) if os.getenv("CHOIR_SATB_COMMAND_JSON") else None
        processor = Pipeline(satb_command=command)
    jobs = Jobs(settings, processor)

    @asynccontextmanager
    async def lifespan(app):
        async def prune():
            while True:
                await asyncio.sleep(5)
                jobs.cleanup()
        task = asyncio.create_task(prune())
        yield
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.to_thread(jobs.close)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.jobs = jobs
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["X-Choir-Key", "X-Choir-Consent", "Content-Type"], expose_headers=["Content-Disposition"])

    def authorize(request):
        if not secrets.compare_digest(request.headers.get("X-Choir-Key", "").encode(), settings.key.encode()):
            raise HTTPException(401, "A valid server access key is required")

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/choir/v1/health")
    async def health(request: Request):
        authorize(request)
        return dict(schemaVersion=1, vocalModel="demucs_htdemucs", demucsInstalled=importlib.util.find_spec("demucs") is not None,
                    satbModelConfigured=bool(getattr(processor, "satb_command", None)), maxUploadBytes=settings.max_upload,
                    retentionSeconds=settings.ttl,
                    notice="SATB audio requires an operator-supplied model. Otherwise outputs are synthesized pitch guides. Model weights and inference readiness must be verified by the operator.")

    @app.post("/api/choir/v1/jobs", status_code=202)
    async def upload(request: Request):
        authorize(request)
        if request.headers.get("X-Choir-Consent") != "upload-audio":
            raise HTTPException(400, "Explicit consent is required for each upload")
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            raise HTTPException(400, "Invalid content length")
        if length < 0 or length > settings.max_upload:
            raise HTTPException(413, "Recording exceeds 40 MB upload limit")
        r = jobs.create()
        try:
            size = 0
            with (r["folder"] / "input.bin").open("wb") as out:
                try:
                    async with asyncio.timeout(120):
                        async for chunk in request.stream():
                            size += len(chunk)
                            if size > settings.max_upload:
                                raise HTTPException(413, "Recording exceeds upload limit")
                            out.write(chunk)
                except TimeoutError:
                    raise HTTPException(408, "Upload timed out")
            if not size:
                raise HTTPException(400, "Recording is empty")
            r.update(status="queued", stage="Queued", updated=time.time())
            jobs.pool.submit(jobs.process, r)
            return dict(id=r["id"], status="queued", retentionSeconds=settings.ttl)
        except BaseException:
            with jobs.lock:
                jobs.records.pop(r["id"], None)
            shutil.rmtree(r["folder"], ignore_errors=True)
            raise

    @app.get("/api/choir/v1/jobs/{identifier}")
    async def status(identifier: str, request: Request):
        authorize(request)
        r = jobs.get(identifier)
        with jobs.lock:
            return {k: r[k] for k in ("id", "status", "stage", "error")}

    @app.get("/api/choir/v1/jobs/{identifier}/result")
    async def result(identifier: str, request: Request):
        authorize(request)
        r = jobs.get(identifier)
        if r["status"] != "complete":
            raise HTTPException(409, "Job is not complete")
        return r["result"]

    @app.get("/api/choir/v1/jobs/{identifier}/files/{name}")
    async def download(identifier: str, name: str, request: Request):
        authorize(request)
        r = jobs.get(identifier)
        allowed = {f["name"] for f in r["result"]["files"]} if r["status"] == "complete" else set()
        if name not in allowed or Path(name).name != name:
            raise HTTPException(404, "Artifact not found")
        path = r["folder"] / "result" / name
        if path.is_symlink() or not path.is_file():
            raise HTTPException(404, "Artifact not found")
        return FileResponse(path, filename=name)

    @app.delete("/api/choir/v1/jobs/{identifier}", status_code=202)
    async def delete(identifier: str, request: Request):
        authorize(request)
        r = jobs.get(identifier)
        with jobs.lock:
            r["deleted"] = True
            r["cancel"].set()
        jobs.cleanup()
        return {"status": "deleting"}

    # Serve only shipped browser assets, never uploaded or generated job data.
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
    return app
