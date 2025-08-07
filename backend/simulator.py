import requests
import time
import random
import threading

DASHBOARD_URL = "http://127.0.0.1:8000/api/report"
EVENT_URL = "http://127.0.0.1:8000/api/event"
SIMULATION_INTERVAL = 5  # seconds

# --- Define Your Simulated Network Devices ---
SIMULATED_AGENTS = [
    {
        "agent_id": "web-server-01",
        "normal_cpu_range": (15.0, 40.0),
        "normal_memory_range": (50.0, 70.0),
        "normal_disk_range": (30.0, 50.0),
        "baseline": {
            "allowed_processes": ["nginx", "python", "gunicorn"],
            "allowed_ports": [80, 443],
            "allowed_disk_usage": 85,
            "allowed_memory": 80,
        }
    },
    {
        "agent_id": "database-server-01",
        "normal_cpu_range": (20.0, 50.0),
        "normal_memory_range": (60.0, 85.0),
        "normal_disk_range": (50.0, 75.0),
        "baseline": {
            "allowed_processes": ["postgres", "pgaudit"],
            "allowed_ports": [5432],
            "allowed_disk_usage": 90,
            "allowed_memory": 95,
        }
    },
    {
        "agent_id": "workstation-dev-05",
        "normal_cpu_range": (5.0, 25.0),
        "normal_memory_range": (40.0, 60.0),
        "normal_disk_range": (20.0, 40.0),
        "baseline": {
            "allowed_processes": ["code", "docker", "chrome", "slack"],
            "allowed_ports": [80, 443, 8080],
            "allowed_disk_usage": 90,
            "allowed_memory": 90,
        }
    }
]

def generate_agent_data(config):
    """Generates metrics for a single agent, with a chance of anomaly."""
    
    # Generate normal data based on the agent's profile
    metrics = {
        "cpu": round(random.uniform(*config["normal_cpu_range"]), 2),
        "memory": round(random.uniform(*config["normal_memory_range"]), 2),
        "disk": round(random.uniform(*config["normal_disk_range"]), 2),
        "process": random.choice(config["baseline"]["allowed_processes"]),
        "network_sent": random.randint(1000, 50000),
        "network_recv": random.randint(10000, 500000),
        "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
    }

    # With a 20% chance, inject a random anomaly
    if random.random() < 0.20:
        anomaly_type = random.choice(["cpu_spike", "bad_process", "disk_full"])
        print(f">>> Injecting ANOMALY ({anomaly_type}) for {config['agent_id']} <<<")
        
        if anomaly_type == "cpu_spike":
            metrics["cpu"] = round(random.uniform(95.0, 99.9), 2)
        elif anomaly_type == "bad_process":
            metrics["process"] = "malicious_script.sh"
        elif anomaly_type == "disk_full":
            metrics["disk"] = round(random.uniform(95.0, 99.9), 2)
            
    return metrics

def run_simulation():
    """Main simulation loop to send data for all agents."""
    print("🚀 Starting network simulation...")
    while True:
        for agent_config in SIMULATED_AGENTS:
            agent_id = agent_config["agent_id"]
            
            # Generate data for the current agent in the loop
            metrics = generate_agent_data(agent_config)
            
            # 1. Send the health report to the /report endpoint
            report_payload = {
                "agent_id": agent_id,
                "cpu": metrics["cpu"],
                "memory": metrics["memory"],
                "disk": metrics["disk"],
                "top_process": metrics["process"],
                "network_sent": metrics["network_sent"],
                "network_recv": metrics["network_recv"],
                "workload": random.randint(10, 80)
            }
            try:
                requests.post(DASHBOARD_URL, json=report_payload, timeout=3)
                print(f"[{time.strftime('%H:%M:%S')}] Health report sent for {agent_id}")
            except requests.RequestException as e:
                print(f"Error sending report for {agent_id}: {e}")

            # 2. Send the event to the /event endpoint for AI analysis
            event_payload = {
                "agent_id": agent_id,
                "event": metrics,
                "baseline": agent_config["baseline"]
            }
            try:
                requests.post(EVENT_URL, json=event_payload, timeout=5)
                print(f"[{time.strftime('%H:%M:%S')}] Analysis event sent for {agent_id}")
            except requests.RequestException as e:
                print(f"Error sending event for {agent_id}: {e}")

        print("--- Cycle Complete ---")
        time.sleep(SIMULATION_INTERVAL)

if __name__ == "__main__":
    run_simulation()