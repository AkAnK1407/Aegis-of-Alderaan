import requests
import time
import psutil
import random
import os
from fastapi import FastAPI
from fastapi.responses import JSONResponse
import threading
import uvicorn

AGENT_ID = os.uname().nodename if hasattr(os, 'uname') else "agent-" + str(random.randint(1000, 9999))
DASHBOARD_URL = "http://127.0.0.1:8000/api/report"
EVENT_URL = "http://127.0.0.1:8000/api/event"
REPORT_INTERVAL = 5
EVENT_INTERVAL = 15
PEER_PORT = 9001

current_metrics = {}

def collect_metrics():
    cpu_usage = psutil.cpu_percent(interval=1)
    memory_info = psutil.virtual_memory()
    memory_usage = memory_info.percent
    disk_usage = psutil.disk_usage('/').percent
    processes = [(p.info['name'], p.info['cpu_percent']) for p in psutil.process_iter(['name', 'cpu_percent'])]
    top_process = max(processes, key=lambda x: x[1], default=("unknown", 0))
    net_io = psutil.net_io_counters()
    network_sent = net_io.bytes_sent
    network_recv = net_io.bytes_recv
    workload = random.randint(30, 95)
    return {
        "cpu": cpu_usage,
        "memory": memory_usage,
        "disk": disk_usage,
        "top_process": top_process[0],
        "top_process_cpu": top_process[1],
        "network_sent": network_sent,
        "network_recv": network_recv,
        "workload": workload
    }

def send_tetragon_event():
    while True:
        metrics = collect_metrics()
        
        event_payload = {
            "cpu": metrics["cpu"],
            "memory": metrics["memory"],
            "disk": metrics["disk"],
            "process": metrics["top_process"],
            "process_cpu": metrics["top_process_cpu"],
            "network_sent": metrics["network_sent"],
            "network_recv": metrics["network_recv"],
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
        }

        # --- ANOMALY SIMULATION BLOCK ---
        # With a 30% chance, send an anomalous event to test the AI
        if random.random() < 0.3:
            print(">>> Simulating an ANOMALOUS event! <<<")
            event_payload.update({
                "process": "evil_process.exe", # This process is not in the baseline
                "disk": 98.5,                  # This disk usage is above the baseline
            })
        # --- END OF SIMULATION BLOCK ---

        event = {
            "agent_id": AGENT_ID,
            "event": event_payload,
            "baseline": {
                "allowed_processes": ["python", "nginx", "systemd", "svchost.exe", "System Idle Process"],
                "allowed_ports": [80, 443],
                "allowed_disk_usage": 90,
                "allowed_memory": 95,
            }
        }
        
        try:
            response = requests.post(EVENT_URL, json=event, timeout=3)
            response.raise_for_status()
            print(f"[{event['event']['timestamp']}] Tetragon event sent.")
        except Exception as e:
            print(f"Error sending Tetragon event: {e}")
            
        time.sleep(EVENT_INTERVAL)

def run_agent():
    print(f"Starting Aegis Agent: {AGENT_ID}")
    while True:
        try:
            metrics = collect_metrics()
            current_metrics.update(metrics)
            payload = {"agent_id": AGENT_ID, **metrics}
            response = requests.post(DASHBOARD_URL, json=payload, timeout=3)
            response.raise_for_status()
            print(f"[{time.strftime('%H:%M:%S')}] Report sent.")

            if metrics["cpu"] > 90:
                peer_urls = ["http://127.0.0.1:9000/status"]
                for url in peer_urls:
                    try:
                        peer_status = requests.get(url, timeout=2).json()
                        if peer_status["cpu"] < 20:
                            requests.post(url.replace("/status", "/take_task"), json={"from": AGENT_ID})
                            print(f"Negotiation: Offloaded task to peer at {url}")
                            break
                    except Exception as e:
                        print(f"Peer negotiation failed: {e}")
        except requests.exceptions.RequestException as e:
            print(f"Error reporting to dashboard: {e}")
        time.sleep(REPORT_INTERVAL)

app = FastAPI()

@app.get("/status")
def status():
    return current_metrics

@app.post("/take_task")
def take_task(data: dict):
    print(f"Accepted task from {data.get('from')}")
    return JSONResponse({"status": "accepted"})

def start_peer_api():
    uvicorn.run(app, host="0.0.0.0", port=PEER_PORT)

if __name__ == '__main__':
    threading.Thread(target=run_agent, daemon=True).start()
    threading.Thread(target=send_tetragon_event, daemon=True).start()
    start_peer_api()