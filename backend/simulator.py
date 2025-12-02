"""
Adaptive Network Simulator
- Generates realistic per-agent metrics and security events
- Supports anomaly injection, retries with backoff, graceful shutdown
- Air-gapped friendly (no external deps beyond 'requests')
- Fully configurable via environment variables or CLI flags

Run:
  python simulator.py
  python simulator.py --interval 3 --verify-tls false --concurrency per-agent

Env (overrides defaults):
  SIM_DASHBOARD_URL=http://127.0.0.1:8000/api/report
  SIM_EVENT_URL=http://127.0.0.1:8000/api/event
  SIM_INTERVAL=5
  SIM_TIMEOUT=5
  SIM_VERIFY_TLS=false
  SIM_MAX_RETRIES=3
  SIM_BACKOFF_BASE=0.75
  SIM_BACKOFF_MAX=5
  SIM_CONCURRENCY=per-agent   # or single
  SIM_JITTER=true
  SIM_JITTER_MAX_MS=750
  SIM_ANOMALY_RATE=0.2
  SIM_AGENTS_JSON='[{"agent_id":"a1",...}]'  # optional full override of agents list
"""

from __future__ import annotations

import argparse
import json
import os
import random
import signal
import string
import threading
import time
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional

import requests


# ----------------------------
# Configuration
# ----------------------------

@dataclass
class Settings:
    DASHBOARD_URL: str = os.getenv("SIM_DASHBOARD_URL", "http://127.0.0.1:8000/api/report")
    EVENT_URL: str = os.getenv("SIM_EVENT_URL", "http://127.0.0.1:8000/api/event")
    INTERVAL: float = float(os.getenv("SIM_INTERVAL", "5"))  # seconds
    TIMEOUT: float = float(os.getenv("SIM_TIMEOUT", "5"))  # seconds
    VERIFY_TLS: bool = os.getenv("SIM_VERIFY_TLS", "false").lower() == "true"
    MAX_RETRIES: int = int(os.getenv("SIM_MAX_RETRIES", "3"))
    BACKOFF_BASE: float = float(os.getenv("SIM_BACKOFF_BASE", "0.75"))  # seconds
    BACKOFF_MAX: float = float(os.getenv("SIM_BACKOFF_MAX", "5"))  # seconds
    CONCURRENCY: str = os.getenv("SIM_CONCURRENCY", "per-agent").lower()  # 'per-agent' or 'single'
    JITTER: bool = os.getenv("SIM_JITTER", "true").lower() == "true"
    JITTER_MAX_MS: int = int(os.getenv("SIM_JITTER_MAX_MS", "750"))
    ANOMALY_RATE: float = float(os.getenv("SIM_ANOMALY_RATE", "0.2"))
    AGENTS_JSON: Optional[str] = os.getenv("SIM_AGENTS_JSON")
    SEED: Optional[int] = int(os.getenv("SIM_SEED")) if os.getenv("SIM_SEED") else None


SETTINGS = Settings()


# ----------------------------
# HTTP session (air-gapped safe)
# ----------------------------

session = requests.Session()
session.trust_env = False  # ignore system proxy to avoid accidental egress


def safe_post_json(url: str, payload: dict) -> bool:
    """
    Bounded retry with exponential backoff and jitter.
    Returns True on success, False otherwise.
    """
    for attempt in range(1, SETTINGS.MAX_RETRIES + 1):
        try:
            resp = session.post(url, json=payload, timeout=SETTINGS.TIMEOUT, verify=SETTINGS.VERIFY_TLS)
            resp.raise_for_status()
            return True
        except Exception as e:
            backoff = min(SETTINGS.BACKOFF_BASE * (2 ** (attempt - 1)), SETTINGS.BACKOFF_MAX)
            if SETTINGS.JITTER:
                backoff += random.uniform(0, SETTINGS.JITTER_MAX_MS / 1000.0)
            print(f"[WARN] POST attempt {attempt} to {url} failed: {e}. Retrying in {backoff:.2f}s")
            time.sleep(backoff)
    return False


# ----------------------------
# Agent model and data generation
# ----------------------------

@dataclass
class Baseline:
    allowed_processes: List[str]
    allowed_ports: List[int]
    allowed_disk_usage: float
    allowed_memory: float


@dataclass
class AgentProfile:
    agent_id: str
    normal_cpu_range: Tuple[float, float]
    normal_memory_range: Tuple[float, float]
    normal_disk_range: Tuple[float, float]
    baseline: Baseline


DEFAULT_AGENTS: List[AgentProfile] = [
    AgentProfile(
        agent_id="web-server-01",
        normal_cpu_range=(15.0, 40.0),
        normal_memory_range=(50.0, 70.0),
        normal_disk_range=(30.0, 50.0),
        baseline=Baseline(
            allowed_processes=["nginx", "python", "gunicorn"],
            allowed_ports=[80, 443],
            allowed_disk_usage=85,
            allowed_memory=80,
        ),
    ),
    AgentProfile(
        agent_id="database-server-01",
        normal_cpu_range=(20.0, 50.0),
        normal_memory_range=(60.0, 85.0),
        normal_disk_range=(50.0, 75.0),
        baseline=Baseline(
            allowed_processes=["postgres", "pgaudit"],
            allowed_ports=[5432],
            allowed_disk_usage=90,
            allowed_memory=95,
        ),
    ),
    AgentProfile(
        agent_id="workstation-dev-05",
        normal_cpu_range=(5.0, 25.0),
        normal_memory_range=(40.0, 60.0),
        normal_disk_range=(20.0, 40.0),
        baseline=Baseline(
            allowed_processes=["code", "docker", "chrome", "slack"],
            allowed_ports=[80, 443, 8080],
            allowed_disk_usage=90,
            allowed_memory=90,
        ),
    ),
]


def load_agents() -> List[AgentProfile]:
    """
    Optionally override the default agents via SIM_AGENTS_JSON env.
    """
    if not SETTINGS.AGENTS_JSON:
        return DEFAULT_AGENTS
    try:
        raw = json.loads(SETTINGS.AGENTS_JSON)
        agents: List[AgentProfile] = []
        for item in raw:
            agents.append(
                AgentProfile(
                    agent_id=item["agent_id"],
                    normal_cpu_range=tuple(item["normal_cpu_range"]),
                    normal_memory_range=tuple(item["normal_memory_range"]),
                    normal_disk_range=tuple(item["normal_disk_range"]),
                    baseline=Baseline(**item["baseline"]),
                )
            )
        return agents
    except Exception as e:
        print(f"[WARN] Invalid SIM_AGENTS_JSON: {e}. Falling back to defaults.")
        return DEFAULT_AGENTS


def _rand_process_name() -> str:
    # yields superficially plausible process names
    prefixes = ["sys", "daemon", "svc", "agent", "update", "telemetry", "health"]
    core = "".join(random.choices(string.ascii_lowercase, k=random.randint(4, 9)))
    suffixes = ["", ".exe", ".sh", ".bin", ".py"]
    return f"{random.choice(prefixes)}_{core}{random.choice(suffixes)}"


def generate_metrics(agent: AgentProfile) -> Dict:
    """
    Generates metrics with subtle correlations for realism.
    - Slightly correlates memory with cpu
    - Disk varies slower
    """
    cpu = round(random.uniform(*agent.normal_cpu_range), 2)
    # memory follows cpu trend a bit
    base_mem = random.uniform(*agent.normal_memory_range)
    memory = round(min(100.0, max(0.0, base_mem + (cpu - sum(agent.normal_cpu_range) / 2) * 0.05)), 2)

    # disk moves slower: last value with tiny delta (keep a per-thread attribute)
    tlocal = threading.current_thread().__dict__
    last_disk = tlocal.get("last_disk", random.uniform(*agent.normal_disk_range))
    drift = random.uniform(-0.8, 0.8)
    disk = round(min(100.0, max(0.0, last_disk + drift)), 2)
    tlocal["last_disk"] = disk

    # top process: one from baseline
    process = random.choice(agent.baseline.allowed_processes)
    top_process_cpu = round(random.uniform(0.0, min(cpu, 10.0)), 2)

    network_sent = random.randint(1_000, 50_000)
    network_recv = random.randint(10_000, 500_000)

    return {
        "cpu": cpu,
        "memory": memory,
        "disk": disk,
        "process": process,
        "top_process_cpu": top_process_cpu,
        "network_sent": network_sent,
        "network_recv": network_recv,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def maybe_inject_anomaly(agent: AgentProfile, metrics: Dict) -> Tuple[Dict, Optional[str]]:
    """
    With probability ANOMALY_RATE, inject one of several anomaly types.
    """
    if random.random() >= SETTINGS.ANOMALY_RATE:
        return metrics, None

    anomaly_type = random.choice(
        [
            "cpu_spike",
            "bad_process",
            "disk_full",
            "memory_leak",
            "suspicious_port",
            "sustained_high_cpu",
        ]
    )
    print(f">>> Injecting ANOMALY ({anomaly_type}) for {agent.agent_id} <<<")

    if anomaly_type == "cpu_spike":
        metrics["cpu"] = round(random.uniform(95.0, 99.9), 2)
    elif anomaly_type == "bad_process":
        metrics["process"] = _rand_process_name()
    elif anomaly_type == "disk_full":
        metrics["disk"] = round(random.uniform(95.0, 99.9), 2)
    elif anomaly_type == "memory_leak":
        metrics["memory"] = round(random.uniform(92.0, 99.0), 2)
    elif anomaly_type == "suspicious_port":
        # add a port outside baseline for event payload only
        metrics["port"] = random.choice([22, 25, 8081, 3389, 4444])
    elif anomaly_type == "sustained_high_cpu":
        # boost cpu for the next few iterations by setting thread-local state
        tlocal = threading.current_thread().__dict__
        tlocal["sustained_cpu_until"] = time.monotonic() + random.uniform(10, 25)
        metrics["cpu"] = max(metrics["cpu"], random.uniform(85.0, 95.0))

    # If sustained_high_cpu was set, ensure next iterations stay elevated
    tlocal = threading.current_thread().__dict__
    until = tlocal.get("sustained_cpu_until")
    if until and time.monotonic() < until:
        metrics["cpu"] = max(metrics["cpu"], random.uniform(80.0, 95.0))
    elif until and time.monotonic() >= until:
        tlocal.pop("sustained_cpu_until", None)

    return metrics, anomaly_type


def build_report_payload(agent: AgentProfile, metrics: Dict) -> Dict:
    return {
        "agent_id": agent.agent_id,
        "cpu": metrics["cpu"],
        "memory": metrics["memory"],
        "disk": metrics["disk"],
        "top_process": metrics["process"],
        "top_process_cpu": metrics.get("top_process_cpu", 0.0),
        "network_sent": metrics["network_sent"],
        "network_recv": metrics["network_recv"],
        "workload": random.randint(10, 80),
    }


def build_event_payload(agent: AgentProfile, metrics: Dict) -> Dict:
    return {
        "agent_id": agent.agent_id,
        "event": metrics,
        "baseline": asdict(agent.baseline),
    }


# ----------------------------
# Simulation loops
# ----------------------------

stop_event = threading.Event()


def _sleep_interval():
    if SETTINGS.JITTER:
        # +/- up to JITTER_MAX_MS/1000 around INTERVAL
        jitter = random.uniform(-SETTINGS.JITTER_MAX_MS / 1000.0, SETTINGS.JITTER_MAX_MS / 1000.0)
        return max(0.1, SETTINGS.INTERVAL + jitter)
    return SETTINGS.INTERVAL


def simulate_agent(agent: AgentProfile):
    print(f"🛰️  Starting agent simulation: {agent.agent_id}")
    while not stop_event.is_set():
        metrics = generate_metrics(agent)
        metrics, anomaly = maybe_inject_anomaly(agent, metrics)

        # 1) Report metrics
        report_payload = build_report_payload(agent, metrics)
        ok_report = safe_post_json(SETTINGS.DASHBOARD_URL, report_payload)
        if ok_report:
            print(f"[{time.strftime('%H:%M:%S')}] Report sent for {agent.agent_id}")
        else:
            print(f"[ERROR] Report failed for {agent.agent_id}")

        # 2) Send event for analysis
        event_payload = build_event_payload(agent, metrics)
        ok_event = safe_post_json(SETTINGS.EVENT_URL, event_payload)
        if ok_event:
            print(f"[{time.strftime('%H:%M:%S')}] Event sent for {agent.agent_id}"
                  f"{' (ANOMALY: ' + anomaly + ')' if anomaly else ''}")
        else:
            print(f"[ERROR] Event failed for {agent.agent_id}")

        time.sleep(_sleep_interval())

    print(f"🛑 Stopped agent simulation: {agent.agent_id}")


def simulate_single_cycle(agents: List[AgentProfile]):
    """
    Single-threaded mode: iterate agents sequentially each cycle.
    """
    print("🚀 Starting network simulation (single-thread mode)...")
    while not stop_event.is_set():
        for agent in agents:
            if stop_event.is_set():
                break
            metrics = generate_metrics(agent)
            metrics, anomaly = maybe_inject_anomaly(agent, metrics)

            report_payload = build_report_payload(agent, metrics)
            safe_post_json(SETTINGS.DASHBOARD_URL, report_payload)
            event_payload = build_event_payload(agent, metrics)
            safe_post_json(SETTINGS.EVENT_URL, event_payload)

            print(f"[{time.strftime('%H:%M:%S')}] Cycle complete for {agent.agent_id}"
                  f"{' (ANOMALY: ' + anomaly + ')' if anomaly else ''}")

        print("--- Cycle Complete ---")
        time.sleep(_sleep_interval())
    print("🛑 Simulation stopped (single-thread mode).")


# ----------------------------
# Entrypoint and CLI
# ----------------------------

def handle_signal(signum, frame):
    print(f"\n[INFO] Received signal {signum}, stopping simulation...")
    stop_event.set()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Adaptive Network Simulator")
    p.add_argument("--dashboard-url", default=SETTINGS.DASHBOARD_URL, help="Report endpoint URL")
    p.add_argument("--event-url", default=SETTINGS.EVENT_URL, help="Event endpoint URL")
    p.add_argument("--interval", type=float, default=SETTINGS.INTERVAL, help="Seconds between sends")
    p.add_argument("--timeout", type=float, default=SETTINGS.TIMEOUT, help="HTTP request timeout (s)")
    p.add_argument("--verify-tls", type=str, default=str(SETTINGS.VERIFY_TLS).lower(),
                   choices=["true", "false"], help="Verify TLS certificate")
    p.add_argument("--max-retries", type=int, default=SETTINGS.MAX_RETRIES, help="Max HTTP retries")
    p.add_argument("--backoff-base", type=float, default=SETTINGS.BACKOFF_BASE, help="Backoff base seconds")
    p.add_argument("--backoff-max", type=float, default=SETTINGS.BACKOFF_MAX, help="Backoff max seconds")
    p.add_argument("--concurrency", default=SETTINGS.CONCURRENCY, choices=["per-agent", "single"],
                   help="per-agent threads or single-thread loop")
    p.add_argument("--jitter", type=str, default=str(SETTINGS.JITTER).lower(), choices=["true", "false"],
                   help="Enable random jitter (+/-) around interval")
    p.add_argument("--jitter-max-ms", type=int, default=SETTINGS.JITTER_MAX_MS, help="Max jitter in ms")
    p.add_argument("--anomaly-rate", type=float, default=SETTINGS.ANOMALY_RATE,
                   help="Probability of anomaly per agent per cycle (0..1)")
    p.add_argument("--seed", type=int, default=SETTINGS.SEED if SETTINGS.SEED is not None else None,
                   help="Random seed for reproducibility")
    return p.parse_args()


def apply_overrides(args: argparse.Namespace):
    SETTINGS.DASHBOARD_URL = args.dashboard_url
    SETTINGS.EVENT_URL = args.event_url
    SETTINGS.INTERVAL = args.interval
    SETTINGS.TIMEOUT = args.timeout
    SETTINGS.VERIFY_TLS = args.verify_tls == "true"
    SETTINGS.MAX_RETRIES = args.max_retries
    SETTINGS.BACKOFF_BASE = args.backoff_base
    SETTINGS.BACKOFF_MAX = args.backoff_max
    SETTINGS.CONCURRENCY = args.concurrency
    SETTINGS.JITTER = args.jitter == "true"
    SETTINGS.JITTER_MAX_MS = args.jitter_max_ms
    SETTINGS.ANOMALY_RATE = args.anomaly_rate
    if args.seed is not None:
        SETTINGS.SEED = args.seed
        random.seed(args.seed)


def main():
    args = parse_args()
    apply_overrides(args)

    # Signals
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    agents = load_agents()

    if SETTINGS.CONCURRENCY == "per-agent":
        threads: List[threading.Thread] = []
        for agent in agents:
            t = threading.Thread(target=simulate_agent, args=(agent,), daemon=True, name=f"sim-{agent.agent_id}")
            t.start()
            threads.append(t)

        print("🚀 Simulation started (per-agent threads). Press Ctrl+C to stop.")
        try:
            while any(t.is_alive() for t in threads):
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            stop_event.set()
            for t in threads:
                t.join(timeout=2.0)
            print("✅ Simulation stopped.")
    else:
        try:
            simulate_single_cycle(agents)
        except KeyboardInterrupt:
            stop_event.set()
            print("✅ Simulation stopped.")


if __name__ == "__main__":
    main()