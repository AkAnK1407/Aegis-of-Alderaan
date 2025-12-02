import os
import csv
import json
import time
import threading
import logging
from logging.handlers import RotatingFileHandler
from collections import defaultdict, Counter
from typing import Dict, Any, Optional, List
import asyncio

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

import requests

# Optional deps
try:
    import pandas as pd  # type: ignore
except Exception:
    pd = None

try:
    from prophet import Prophet  # type: ignore
    HAVE_PROPHET = True
except Exception:
    HAVE_PROPHET = False

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass


class Settings:
    BASE_DIR: str = os.path.dirname(__file__)
    DATA_DIR: str = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data"))
    LOG_DIR: str = os.getenv("LOG_DIR", os.path.join(BASE_DIR, "logs"))
    METRICS_HISTORY_FILE: str = os.getenv("METRICS_HISTORY_FILE", os.path.join(DATA_DIR, "metrics_history.csv"))

    PREDICTION_INTERVAL_SEC: int = int(os.getenv("PREDICTION_INTERVAL_SEC", "60"))
    PREDICTIVE_CPU_THRESHOLD: float = float(os.getenv("PREDICTIVE_CPU_THRESHOLD", "90.0"))
    BUSY_CPU_THRESHOLD: float = float(os.getenv("BUSY_CPU_THRESHOLD", "60.0"))
    IDLE_CPU_THRESHOLD: float = float(os.getenv("IDLE_CPU_THRESHOLD", "20.0"))
    AGENT_TIMEOUT_SEC: int = int(os.getenv("AGENT_TIMEOUT_SEC", "30"))
    BASELINE_UPDATE_INTERVAL_SEC: int = int(os.getenv("BASELINE_UPDATE_INTERVAL_SEC", "60"))
    FORECAST_PERIODS_MIN: int = int(os.getenv("FORECAST_PERIODS_MIN", "60"))

    # Added: pressure-based classification thresholds (env-tunable)
    PRESSURE_BUSY: float = float(os.getenv("PRESSURE_BUSY", "65.0"))
    PRESSURE_IDLE: float = float(os.getenv("PRESSURE_IDLE", "25.0"))

    ALLOW_ORIGINS: List[str] = (
        os.getenv("ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if os.getenv("ALLOW_ORIGINS")
        else ["*"]
    )
    REQUEST_TIMEOUT: float = float(os.getenv("REQUEST_TIMEOUT", "10"))
    MAX_LOAD_BALANCING_ACTIONS: int = int(os.getenv("MAX_LOAD_BALANCING_ACTIONS", "20"))
    MAX_TETRAGON_EVENTS: int = int(os.getenv("MAX_TETRAGON_EVENTS", "50000"))
    MAX_RECENT_ANOMALIES: int = int(os.getenv("MAX_RECENT_ANOMALIES", "100"))

    ENABLE_GROQ: bool = os.getenv("ENABLE_GROQ", "false").lower() == "true"
    GROQ_API_URL: str = os.getenv("GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions")
    GROQ_API_KEY: Optional[str] = os.getenv("GROQ_API_KEY")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama3-70b-8192")
    GROQ_TIMEOUT: float = float(os.getenv("GROQ_TIMEOUT", "15"))

SETTINGS = Settings()
os.makedirs(SETTINGS.DATA_DIR, exist_ok=True)
os.makedirs(SETTINGS.LOG_DIR, exist_ok=True)

logger = logging.getLogger("aegis-dashboard")
logger.setLevel(logging.INFO)
file_handler = RotatingFileHandler(os.path.join(SETTINGS.LOG_DIR, "dashboard.log"), maxBytes=5_000_000, backupCount=5)
fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(threadName)s | %(message)s")
file_handler.setFormatter(fmt)
logger.addHandler(file_handler)
console = logging.StreamHandler()
console.setFormatter(fmt)
logger.addHandler(console)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=SETTINGS.ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared state
agent_data_lock = threading.Lock()
tetragon_lock = threading.Lock()
baseline_lock = threading.Lock()
actions_lock = threading.Lock()
csv_lock = threading.Lock()
recent_anomalies_lock = threading.Lock()

agent_data: Dict[str, Dict[str, Any]] = {}
tetragon_events: List[Dict[str, Any]] = []
agent_baselines: Dict[str, Dict[str, Any]] = defaultdict(dict)
load_balancing_actions: List[Dict[str, Any]] = []
recent_anomalies: List[Dict[str, Any]] = []

stop_event = threading.Event()

# Real-time SSE subscribers
APP_LOOP: Optional[asyncio.AbstractEventLoop] = None
_sse_subscribers: List[asyncio.Queue] = []
_sse_lock = threading.Lock()


def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def sse_subscribe(q: asyncio.Queue) -> None:
    with _sse_lock:
        _sse_subscribers.append(q)


def sse_unsubscribe(q: asyncio.Queue) -> None:
    with _sse_lock:
        if q in _sse_subscribers:
            _sse_subscribers.remove(q)


def sse_publish(event_type: str, data: Dict[str, Any]) -> None:
    """
    Thread-safe publish to all SSE subscribers.
    """
    message = {"type": event_type, "time": now_str(), "data": data}
    with _sse_lock:
        targets = list(_sse_subscribers)
    if not targets or APP_LOOP is None or not APP_LOOP.is_running():
        return
    for q in targets:
        try:
            asyncio.run_coroutine_threadsafe(q.put(message), APP_LOOP)
        except Exception as e:
            logger.debug("SSE publish failed: %s", e)


def append_load_balancing_action(action: Dict[str, Any]) -> None:
    with actions_lock:
        load_balancing_actions.append(action)
        if len(load_balancing_actions) > SETTINGS.MAX_LOAD_BALANCING_ACTIONS:
            del load_balancing_actions[0: len(load_balancing_actions) - SETTINGS.MAX_LOAD_BALANCING_ACTIONS]
    sse_publish("load_balancing", action)


def push_tetragon_event(evt: Dict[str, Any]) -> None:
    with tetragon_lock:
        tetragon_events.append(evt)
        if len(tetragon_events) > SETTINGS.MAX_TETRAGON_EVENTS:
            del tetragon_events[0: len(tetragon_events) - SETTINGS.MAX_TETRAGON_EVENTS]


def record_anomaly(entry: Dict[str, Any]) -> None:
    with recent_anomalies_lock:
        recent_anomalies.append(entry)
        if len(recent_anomalies) > SETTINGS.MAX_RECENT_ANOMALIES:
            del recent_anomalies[0: len(recent_anomalies) - SETTINGS.MAX_RECENT_ANOMALIES]
    sse_publish("anomaly", entry)


def log_metric_to_csv(data: Dict[str, Any]) -> None:
    path = SETTINGS.METRICS_HISTORY_FILE
    headers = ["timestamp", "agent_id", "cpu", "memory", "disk"]
    try:
        with csv_lock:
            file_exists = os.path.isfile(path)
            with open(path, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
                if not file_exists:
                    writer.writeheader()
                row = {
                    "timestamp": now_str(),
                    "agent_id": data.get("agent_id"),
                    "cpu": data.get("cpu"),
                    "memory": data.get("memory"),
                    "disk": data.get("disk"),
                }
                writer.writerow(row)
    except Exception as e:
        logger.error("Failed to write metrics CSV: %s", e)


def build_summary() -> Dict[str, Any]:
    with agent_data_lock:
        agents = dict(agent_data)
    with actions_lock:
        actions = list(load_balancing_actions)[-5:]
    with recent_anomalies_lock:
        anomalies = list(recent_anomalies)[-5:]

    # Top busy by CPU
    top_busy = sorted(
        [{"agent_id": aid, "cpu": float(rec.get("cpu", 0.0))} for aid, rec in agents.items()],
        key=lambda x: x["cpu"],
        reverse=True,
    )[:5]

    summary = {
        "agents_total": len(agents),
        "top_busy": top_busy,
        "recent_actions": actions,
        "recent_anomalies": anomalies,
        "timestamp": now_str(),
    }
    return summary


def naive_forecast(agent_id: str) -> Dict[str, Any]:
    try:
        if not pd or not os.path.exists(SETTINGS.METRICS_HISTORY_FILE):
            return {"error": "No history available"}
        df = pd.read_csv(SETTINGS.METRICS_HISTORY_FILE)
        agent_df = df[df["agent_id"] == agent_id].copy()
        if len(agent_df) < 5:
            return {"error": "Not enough historical data."}
        agent_df["timestamp"] = pd.to_datetime(agent_df["timestamp"])
        agent_df.sort_values("timestamp", inplace=True)
        window = min(30, len(agent_df))
        mean_cpu = float(agent_df["cpu"].tail(window).mean())
        last_ts = agent_df["timestamp"].iloc[-1]
        future = [
            {"ds": (last_ts + pd.Timedelta(minutes=i + 1)).strftime("%Y-%m-%d %H:%M:%S"), "yhat": mean_cpu}
            for i in range(SETTINGS.FORECAST_PERIODS_MIN)
        ]
        spike_info = None
        if mean_cpu > SETTINGS.PREDICTIVE_CPU_THRESHOLD:
            spike_info = {"predicted_time": future[0]["ds"], "predicted_value": round(mean_cpu, 2)}
        return {"spike_info": spike_info, "forecast": future}
    except Exception as e:
        return {"error": str(e)}


def train_and_predict(agent_id: str, return_forecast: bool = False) -> Optional[Dict[str, Any]]:
    try:
        if not pd or not os.path.exists(SETTINGS.METRICS_HISTORY_FILE):
            return naive_forecast(agent_id) if return_forecast else None

        df = pd.read_csv(SETTINGS.METRICS_HISTORY_FILE)
        agent_df = df[df["agent_id"] == agent_id].copy()
        if len(agent_df) < 5:
            return {"error": "Not enough historical data."} if return_forecast else None

        agent_df.rename(columns={"timestamp": "ds", "cpu": "y"}, inplace=True)
        agent_df["ds"] = pd.to_datetime(agent_df["ds"])

        if HAVE_PROPHET:
            model = Prophet(interval_width=0.95, daily_seasonality=True)
            model.fit(agent_df)
            future = model.make_future_dataframe(periods=SETTINGS.FORECAST_PERIODS_MIN, freq="min")
            forecast = model.predict(future)
            future_spikes = forecast[forecast["yhat"] > SETTINGS.PREDICTIVE_CPU_THRESHOLD]
            spike_info = None
            if not future_spikes.empty:
                predicted_time = future_spikes["ds"].iloc[0]
                predicted_value = round(float(future_spikes["yhat"].iloc[0]), 2)
                spike_info = {"predicted_time": predicted_time.strftime("%Y-%m-%d %H:%M:%S"), "predicted_value": predicted_value}

            if return_forecast:
                data = {
                    "spike_info": spike_info,
                    "forecast": forecast[["ds", "yhat"]].tail(SETTINGS.FORECAST_PERIODS_MIN).assign(
                        ds=lambda x: x["ds"].dt.strftime("%Y-%m-%d %H:%M:%S"),
                        yhat=lambda x: x["yhat"].astype(float),
                    ).to_dict(orient="records"),
                }
                return data
            return None
        else:
            return naive_forecast(agent_id) if return_forecast else None
    except Exception as e:
        return {"error": str(e)} if return_forecast else None


def analyze_with_groq(baseline: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    def local_rules() -> Dict[str, Any]:
        problems: List[str] = []
        allowed_procs = set(baseline.get("allowed_processes", []))
        allowed_ports = set(baseline.get("allowed_ports", []))
        max_disk = baseline.get("allowed_disk_usage", 90)
        max_mem = baseline.get("allowed_memory", 95)

        proc = event.get("process")
        port = event.get("port")
        disk = event.get("disk")
        mem = event.get("memory")

        if proc and allowed_procs and proc not in allowed_procs:
            problems.append("process")
        if port and allowed_ports and port not in allowed_ports:
            problems.append("port")
        if isinstance(disk, (int, float)) and disk > max_disk:
            problems.append("disk")
        if isinstance(mem, (int, float)) and mem > max_mem:
            problems.append("memory")

        return {
            "is_anomaly": bool(problems),
            "problematic_fields": problems,
            "suggestion": "Review offending fields; isolate or throttle the service if necessary.",
            "engine": "local",
        }

    if not (SETTINGS.ENABLE_GROQ and SETTINGS.GROQ_API_KEY):
        return local_rules()

    headers = {"Authorization": f"Bearer {SETTINGS.GROQ_API_KEY}", "Content-Type": "application/json"}
    system_prompt = """
    You are a network security analyst. Compare the new event to the baseline.
    Respond ONLY as JSON:
    {"is_anomaly": boolean, "problematic_fields": ["field1", ...], "suggestion": "brief action"}
    """
    user_prompt = f"Baseline: {json.dumps(baseline)}\nEvent: {json.dumps(event)}"
    body = {
        "model": SETTINGS.GROQ_MODEL,
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        "temperature": 0.1,
        "max_tokens": 512,
        "response_format": {"type": "json_object"},
    }
    try:
        resp = requests.post(SETTINGS.GROQ_API_URL, json=body, headers=headers, timeout=SETTINGS.GROQ_TIMEOUT)
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        parsed["engine"] = "groq"
        return parsed
    except Exception as e:
        fb = local_rules()
        fb["error"] = str(e)
        return fb


def guardian_logic() -> None:
    while not stop_event.is_set():
        time.sleep(3)
        with agent_data_lock:
            if not agent_data:
                continue

            busy_agents: List[str] = []
            idle_agents: List[str] = []
            now_epoch = time.time()
            to_remove: List[str] = []

            for agent_id, rec in agent_data.items():
                last_seen_epoch = rec.get("last_seen_epoch", 0.0)
                if now_epoch - float(last_seen_epoch) > SETTINGS.AGENT_TIMEOUT_SEC:
                    to_remove.append(agent_id)
                    continue

                # Read metrics (default to 0.0 if missing)
                cpu = float(rec.get("cpu", 0.0))
                mem = float(rec.get("memory", 0.0))
                wl  = float(rec.get("workload", 0.0))

                # Pressure score (tunable: 60% CPU, 30% Memory, 10% Workload)
                pressure = 0.6 * cpu + 0.3 * mem + 0.1 * wl

                busy_thresh = SETTINGS.PRESSURE_BUSY
                idle_thresh = SETTINGS.PRESSURE_IDLE

                if pressure >= busy_thresh:
                    busy_agents.append(agent_id)
                elif pressure <= idle_thresh:
                    idle_agents.append(agent_id)

            for aid in to_remove:
                agent_data.pop(aid, None)
                sse_publish("agent_offline", {"agent_id": aid, "at": now_str()})

        if busy_agents and idle_agents:
            busy_id = busy_agents[0]
            idle_id = idle_agents[0]
            with agent_data_lock:
                busy_cpu = float(agent_data.get(busy_id, {}).get("cpu", 0.0))
                idle_cpu = float(agent_data.get(idle_id, {}).get("cpu", 0.0))
                workload = int(agent_data.get(busy_id, {}).get("workload", 0))
            action = {
                "id": f"{busy_id}_to_{idle_id}_{int(time.time())}",
                "type": "offload",
                "sourceDevice": busy_id,
                "targetDevice": idle_id,
                "status": "active",
                "estimatedBenefit": round(busy_cpu - idle_cpu, 2),
                "workloadAmount": workload,
                "timestamp": now_str(),
            }
            append_load_balancing_action(action)


def update_baselines() -> None:
    while not stop_event.is_set():
        time.sleep(SETTINGS.BASELINE_UPDATE_INTERVAL_SEC)
        events_by_agent: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        with tetragon_lock:
            for e in tetragon_events:
                aid = e.get("agent_id")
                if aid:
                    events_by_agent[aid].append(e.get("event", {}))

        updated = []
        with baseline_lock:
            for agent_id, events in events_by_agent.items():
                processes = [e.get("process") for e in events if "process" in e]
                ports = [e.get("port") for e in events if "port" in e]
                disk_usages = [e.get("disk") for e in events if isinstance(e.get("disk"), (int, float))]
                memory_usages = [e.get("memory") for e in events if isinstance(e.get("memory"), (int, float))]

                allowed_processes = list(Counter([p for p in processes if p]).keys())
                allowed_ports = list(Counter([p for p in ports if p is not None]).keys())
                allowed_disk_usage = max(disk_usages) if disk_usages else 90
                allowed_memory = max(memory_usages) if memory_usages else 95

                agent_baselines[agent_id] = {
                    "allowed_processes": allowed_processes,
                    "allowed_ports": allowed_ports,
                    "allowed_disk_usage": allowed_disk_usage,
                    "allowed_memory": allowed_memory,
                }
                updated.append({"agent_id": agent_id, "baseline": agent_baselines[agent_id]})
        if updated:
            sse_publish("baseline_update", {"updated": updated})
        sse_publish("summary", build_summary())


def prediction_service_loop() -> None:
    while not stop_event.is_set():
        with agent_data_lock:
            active_agents = list(agent_data.keys())
        for aid in active_agents:
            train_and_predict(aid, return_forecast=False)
        time.sleep(SETTINGS.PREDICTION_INTERVAL_SEC)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "aegis-dashboard", "time": now_str()}


@app.get("/api/status")
def get_status() -> Dict[str, Any]:
    with agent_data_lock:
        return agent_data


@app.get("/api/load_balancing")
def get_load_balancing_actions() -> List[Dict[str, Any]]:
    with actions_lock:
        return list(load_balancing_actions)


@app.get("/api/summary")
def get_summary() -> Dict[str, Any]:
    return build_summary()


@app.get("/metrics_history.csv")
def get_metrics_csv():
    if not os.path.exists(SETTINGS.METRICS_HISTORY_FILE):
        raise HTTPException(status_code=404, detail="No metrics history available.")
    return FileResponse(SETTINGS.METRICS_HISTORY_FILE, media_type="text/csv")


@app.get("/api/stream")
async def sse_stream():
    """
    Server-Sent Events stream for real-time updates.
    Sends an initial snapshot + incremental updates.
    """
    q: asyncio.Queue = asyncio.Queue()
    sse_subscribe(q)

    async def event_gen():
        try:
            # Initial snapshot
            with agent_data_lock:
                snapshot_agents = dict(agent_data)
            with actions_lock:
                snapshot_actions = list(load_balancing_actions)[-5:]
            with recent_anomalies_lock:
                snapshot_anomalies = list(recent_anomalies)[-5:]
            initial = {
                "type": "snapshot",
                "time": now_str(),
                "data": {
                    "agents": snapshot_agents,
                    "actions": snapshot_actions,
                    "anomalies": snapshot_anomalies,
                    "summary": build_summary(),
                },
            }
            yield f"data: {json.dumps(initial)}\n\n"

            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(item)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive comment for proxies/clients
                    yield ": keep-alive\n\n"
        finally:
            sse_unsubscribe(q)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.post("/api/report")
async def receive_report(request: Request):
    data = await request.json()
    agent_id = data.get("agent_id")
    if not agent_id:
        return JSONResponse({"status": "error", "message": "Missing agent_id"}, status_code=400)

    record = dict(data)
    record["last_seen"] = now_str()
    record["last_seen_epoch"] = time.time()

    with agent_data_lock:
        agent_data[agent_id] = record

    log_metric_to_csv({"agent_id": agent_id, **data})
    sse_publish("agent_update", {"agent_id": agent_id, "metrics": record})
    sse_publish("summary", build_summary())
    return JSONResponse({"status": "success", "message": f"Data received from {agent_id}"})


@app.post("/api/event")
async def receive_event(request: Request):
    event_data_full = await request.json()
    push_tetragon_event(event_data_full)

    agent_id = event_data_full.get("agent_id")
    new_event = event_data_full.get("event", {}) or {}
    with baseline_lock:
        baseline = agent_baselines.get(agent_id) or event_data_full.get("baseline", {}) or {}

    structured = analyze_with_groq(baseline, new_event)
    resp = {
        "agent_id": agent_id,
        "baseline_data": baseline,
        "event_data": new_event,
        "analysis": structured,
    }
    sse_publish("event", resp)
    if structured.get("is_anomaly"):
        record_anomaly({"agent_id": agent_id, "event": new_event, "analysis": structured, "time": now_str()})
    sse_publish("summary", build_summary())
    return JSONResponse(resp)


@app.post("/api/timeseries")
def run_timeseries_analysis():
    with agent_data_lock:
        active_agents = list(agent_data.keys())
    results: Dict[str, Any] = {}
    for agent_id in active_agents:
        results[agent_id] = train_and_predict(agent_id, return_forecast=True)
    payload = {"status": "analysis complete", "results": results}
    sse_publish("prediction", payload)
    return payload


@app.on_event("startup")
def on_startup():
    global APP_LOOP
    APP_LOOP = asyncio.get_event_loop()
    logger.info("Dashboard starting up...")
    threading.Thread(target=guardian_logic, name="guardian", daemon=True).start()
    threading.Thread(target=update_baselines, name="baseline", daemon=True).start()
    threading.Thread(target=prediction_service_loop, name="predictor", daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    logger.info("Dashboard shutting down...")
    stop_event.set()