import os
import time
import json
import uuid
import queue
import psutil
import random
import signal
import socket
import threading
import logging
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional

import requests
from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn

# ----------------------------
# Configuration
# ----------------------------

class Settings:
    # Agent identity and runtime
    AGENT_ID: str = os.getenv("AGENT_ID") or socket.gethostname() or f"agent-{uuid.uuid4().hex[:8]}"
    REPORT_INTERVAL: float = float(os.getenv("REPORT_INTERVAL", "5"))       # seconds
    EVENT_INTERVAL: float = float(os.getenv("EVENT_INTERVAL", "15"))        # seconds
    PEER_PORT: int = int(os.getenv("PEER_PORT", "9001"))

    # Dashboard endpoints (must be reachable inside air-gapped network)
    DASHBOARD_URL: str = os.getenv("DASHBOARD_URL", "http://127.0.0.1:8000/api/report")
    EVENT_URL: str = os.getenv("EVENT_URL", "http://127.0.0.1:8000/api/event")

    # HTTP client and security
    REQUEST_TIMEOUT: float = float(os.getenv("REQUEST_TIMEOUT", "3"))
    VERIFY_TLS: bool = os.getenv("VERIFY_TLS", "false").lower() == "true"   # default false for local/dev
    MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))
    BACKOFF_SECONDS: float = float(os.getenv("BACKOFF_SECONDS", "1.0"))

    # Offline buffering (for air-gapped / intermittent connectivity)
    DATA_DIR: str = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
    BUFFER_FILE: str = os.getenv("BUFFER_FILE", "event_buffer.jsonl")
    FLUSH_INTERVAL: float = float(os.getenv("FLUSH_INTERVAL", "10"))

    # Baseline policy (can be customized via env JSON)
    BASELINE_JSON: Optional[str] = os.getenv("BASELINE_JSON")

    @property
    def buffer_path(self) -> str:
        return os.path.join(self.DATA_DIR, self.BUFFER_FILE)

SETTINGS = Settings()

# ----------------------------
# Logging
# ----------------------------

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("aegis-agent")
logger.setLevel(logging.INFO)

log_handler = RotatingFileHandler(os.path.join(LOG_DIR, "agent.log"), maxBytes=2_000_000, backupCount=5)
log_formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(threadName)s | %(name)s | %(message)s"
)
log_handler.setFormatter(log_formatter)
logger.addHandler(log_handler)

# Also log to console for dev
console = logging.StreamHandler()
console.setFormatter(log_formatter)
logger.addHandler(console)

# ----------------------------
# HTTP session (no external proxies; ideal for air-gapped)
# ----------------------------

session = requests.Session()
session.trust_env = False  # ignore system proxies to avoid accidental egress

# ----------------------------
# State and synchronization
# ----------------------------

current_metrics: Dict[str, Any] = {}
stop_event = threading.Event()
buffer_lock = threading.Lock()
os.makedirs(SETTINGS.DATA_DIR, exist_ok=True)

# ----------------------------
# Utilities
# ----------------------------

def load_baseline() -> Dict[str, Any]:
    if SETTINGS.BASELINE_JSON:
        try:
            return json.loads(SETTINGS.BASELINE_JSON)
        except Exception as e:
            logger.warning("Invalid BASELINE_JSON: %s", e)
    # Default baseline
    return {
        "allowed_processes": ["python", "nginx", "systemd", "svchost.exe", "System Idle Process"],
        "allowed_ports": [80, 443],
        "allowed_disk_usage": 90,
        "allowed_memory": 95,
    }

BASELINE = load_baseline()

def collect_metrics() -> Dict[str, Any]:
    cpu_usage = psutil.cpu_percent(interval=0.5)
    memory_info = psutil.virtual_memory()
    disk_usage = psutil.disk_usage('/').percent

    # Safely compute top process by CPU
    processes = []
    for p in psutil.process_iter(['name', 'cpu_percent']):
        try:
            info = p.info
            name = info.get('name') or "unknown"
            cpu_p = info.get('cpu_percent') or 0.0
            processes.append((name, cpu_p))
        except Exception:
            continue
    top_process = max(processes, key=lambda x: x[1], default=("unknown", 0.0))

    net_io = psutil.net_io_counters()
    network_sent = net_io.bytes_sent
    network_recv = net_io.bytes_recv

    # Simulated workload proxy
    workload = random.randint(30, 95)

    return {
        "cpu": float(cpu_usage),
        "memory": float(memory_info.percent),
        "disk": float(disk_usage),
        "top_process": str(top_process[0]),
        "top_process_cpu": float(top_process[1]),
        "network_sent": int(network_sent),
        "network_recv": int(network_recv),
        "workload": int(workload),
        "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
    }

def safe_post_json(url: str, payload: Dict[str, Any]) -> bool:
    """
    Attempts to POST JSON with limited retries and backoff.
    Returns True if sent; False if failed (caller may buffer offline).
    """
    for attempt in range(1, SETTINGS.MAX_RETRIES + 1):
        try:
            resp = session.post(
                url,
                json=payload,
                timeout=SETTINGS.REQUEST_TIMEOUT,
                verify=SETTINGS.VERIFY_TLS,
            )
            resp.raise_for_status()
            return True
        except Exception as e:
            logger.warning("POST attempt %d to %s failed: %s", attempt, url, e)
            if attempt < SETTINGS.MAX_RETRIES:
                time.sleep(SETTINGS.BACKOFF_SECONDS * attempt)
    return False

def buffer_event(record: Dict[str, Any]) -> None:
    try:
        with buffer_lock, open(SETTINGS.buffer_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        logger.error("Failed to buffer event: %s", e)

def flush_buffered_events() -> None:
    tmp_path = SETTINGS.buffer_path + ".tmp"
    try:
        with buffer_lock:
            if not os.path.exists(SETTINGS.buffer_path):
                return
            # Move to tmp to avoid rewriting while flushing
            os.replace(SETTINGS.buffer_path, tmp_path)

        # Re-send each buffered line
        sent_all = True
        with open(tmp_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                url = record.get("_url")
                data = record.get("_data")
                if not url or data is None:
                    continue
                if not safe_post_json(url, data):
                    # If any fail, re-buffer and mark failure
                    buffer_event(record)
                    sent_all = False
        # Cleanup tmp if everything sent
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        if sent_all:
            logger.info("Buffered events flushed successfully.")
        else:
            logger.info("Buffered events partially flushed; remaining kept in buffer.")
    except FileNotFoundError:
        # Nothing to flush
        pass
    except Exception as e:
        logger.error("Error flushing buffer: %s", e)
        # If tmp still exists, merge back
        try:
            if os.path.exists(tmp_path):
                with open(tmp_path, "r", encoding="utf-8") as f:
                    for line in f:
                        try:
                            record = json.loads(line)
                            buffer_event(record)
                        except Exception:
                            continue
                os.remove(tmp_path)
        except Exception:
            pass

# ----------------------------
# Threads
# ----------------------------

def tetragon_event_loop() -> None:
    """
    Simulates security/telemetry events for the anomaly detector.
    """
    logger.info("Tetragon event loop started.")
    while not stop_event.is_set():
        metrics = collect_metrics()
        event_payload = {
            "cpu": metrics["cpu"],
            "memory": metrics["memory"],
            "disk": metrics["disk"],
            "process": metrics["top_process"],
            "process_cpu": metrics["top_process_cpu"],
            "network_sent": metrics["network_sent"],
            "network_recv": metrics["network_recv"],
            "timestamp": metrics["timestamp"],
        }

        # Anomaly simulation to exercise detection pipeline (30% chance)
        if random.random() < 0.3:
            logger.info("Simulating anomalous event for testing.")
            event_payload.update({
                "process": "evil_process.exe",
                "disk": 98.5,
            })

        event = {
            "agent_id": SETTINGS.AGENT_ID,
            "event": event_payload,
            "baseline": BASELINE,
        }

        if not safe_post_json(SETTINGS.EVENT_URL, event):
            buffer_event({"_url": SETTINGS.EVENT_URL, "_data": event})

        # Wait with stop-aware sleep
        if stop_event.wait(SETTINGS.EVENT_INTERVAL):
            break

def report_loop() -> None:
    """
    Periodic system metrics reporting with simple peer offload simulation.
    """
    logger.info("Report loop started.")
    peer_urls = ["http://127.0.0.1:9000/status"]  # Placeholder; can be made configurable

    while not stop_event.is_set():
        metrics = collect_metrics()
        current_metrics.update(metrics)

        payload = {"agent_id": SETTINGS.AGENT_ID, **metrics}
        if not safe_post_json(SETTINGS.DASHBOARD_URL, payload):
            buffer_event({"_url": SETTINGS.DASHBOARD_URL, "_data": payload})

        # Offload simulation: if CPU high, try a peer
        try:
            if metrics["cpu"] > 90:
                for url in peer_urls:
                    try:
                        r = session.get(url, timeout=2, verify=SETTINGS.VERIFY_TLS)
                        r.raise_for_status()
                        peer_status = r.json()
                        if peer_status.get("cpu", 100) < 20:
                            take_url = url.replace("/status", "/take_task")
                            ok = safe_post_json(take_url, {"from": SETTINGS.AGENT_ID})
                            if ok:
                                logger.info("Negotiation: Offloaded task to peer at %s", url)
                                break
                    except Exception as e:
                        logger.debug("Peer negotiation failed (%s): %s", url, e)
        except Exception as e:
            logger.debug("Offload logic error: %s", e)

        if stop_event.wait(SETTINGS.REPORT_INTERVAL):
            break

def buffer_flush_loop() -> None:
    logger.info("Buffer flush loop started.")
    while not stop_event.is_set():
        flush_buffered_events()
        if stop_event.wait(SETTINGS.FLUSH_INTERVAL):
            break

# ----------------------------
# FastAPI peer endpoints
# ----------------------------

app = FastAPI()

@app.get("/status")
def status():
    return current_metrics or {"status": "initializing"}

@app.get("/live")
def liveness():
    return {"status": "alive", "agent_id": SETTINGS.AGENT_ID}

@app.get("/ready")
def readiness():
    # Ready if we have at least one metrics collection
    return {"status": "ready" if current_metrics else "starting", "agent_id": SETTINGS.AGENT_ID}

@app.post("/take_task")
def take_task(data: dict):
    logger.info("Accepted task from %s", data.get('from'))
    return JSONResponse({"status": "accepted"})

def start_peer_api() -> None:
    uvicorn.run(app, host="0.0.0.0", port=SETTINGS.PEER_PORT, log_level="info")

# ----------------------------
# Signal handling and main
# ----------------------------

def handle_signal(signum, frame):
    logger.info("Received signal %s, shutting down...", signum)
    stop_event.set()

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

def main():
    logger.info("Starting Aegis Agent: %s", SETTINGS.AGENT_ID)
    t1 = threading.Thread(target=report_loop, name="report-loop", daemon=True)
    t2 = threading.Thread(target=tetragon_event_loop, name="tetragon-loop", daemon=True)
    t3 = threading.Thread(target=buffer_flush_loop, name="buffer-flush", daemon=True)
    t1.start()
    t2.start()
    t3.start()
    start_peer_api()  # blocks until shutdown

if __name__ == "__main__":
    main()