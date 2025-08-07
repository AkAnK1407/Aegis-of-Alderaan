from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import threading
import time
import json
import requests
from collections import defaultdict, Counter
from dotenv import load_dotenv
import os
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware


import pandas as pd
from prophet import Prophet
import csv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


agent_data = {}
tetragon_events = []  # Store all received events
agent_baselines = defaultdict(dict)  # Learned baseline per agent
load_balancing_actions = []  # Store recent load balancing actions

# --- Phase 3: New Constants ---
METRICS_HISTORY_FILE = 'metrics_history.csv'
PREDICTION_INTERVAL = 60 # Run prediction service every 15 minutes
PREDICTIVE_CPU_THRESHOLD = 90.0

BUSY_CPU_THRESHOLD = 60.0  # Lower threshold for busy agent
IDLE_CPU_THRESHOLD = 20.0
AGENT_TIMEOUT_SEC = 30
BASELINE_UPDATE_INTERVAL = 60  # seconds

GROQ_API_URL = os.getenv("GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")  # Set your Groq key in .env

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specify your frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- Phase 3: Function to Store Historical Data ---
def log_metric_to_csv(data):
    """Appends a new metric report to the CSV file."""
    file_exists = os.path.isfile(METRICS_HISTORY_FILE)
    with open(METRICS_HISTORY_FILE, 'a', newline='') as csvfile:
        fieldnames = ['timestamp', 'agent_id', 'cpu', 'memory', 'disk']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames, extrasaction='ignore')

        if not file_exists:
            writer.writeheader()
        
        # Prepare data for CSV
        log_data = data.copy()
        log_data['timestamp'] = time.strftime('%Y-%m-%d %H:%M:%S')
        writer.writerow(log_data)

# --- Phase 3: Time-Series Prediction Function ---
def train_and_predict(agent_id, return_forecast=False):
    print(f"🔮 [Predictor] Starting analysis for {agent_id}...")
    try:
        df = pd.read_csv(METRICS_HISTORY_FILE)
        agent_df = df[df['agent_id'] == agent_id].copy()

        if len(agent_df) < 5: # Need enough data to make a meaningful forecast
            print(f"🔮 [Predictor] Not enough historical data for {agent_id}. Skipping.")
            return {"error": "Not enough historical data."} if return_forecast else None

        agent_df.rename(columns={'timestamp': 'ds', 'cpu': 'y'}, inplace=True)
        agent_df['ds'] = pd.to_datetime(agent_df['ds'])

        model = Prophet(interval_width=0.95, daily_seasonality=True)
        model.fit(agent_df)

        future = model.make_future_dataframe(periods=60, freq='min')
        forecast = model.predict(future)

        future_spikes = forecast[forecast['yhat'] > PREDICTIVE_CPU_THRESHOLD]

        spike_info = None
        if not future_spikes.empty:
            predicted_time = future_spikes['ds'].iloc[0]
            predicted_value = round(future_spikes['yhat'].iloc[0], 2)
            spike_info = {
                "predicted_time": predicted_time.strftime('%Y-%m-%d %H:%M:%S'),
                "predicted_value": predicted_value
            }
            print(f"🚨 PREDICTIVE ALERT for {agent_id} 🚨")
            print(f"    -> Potential CPU spike to {predicted_value}% forecasted around {predicted_time.strftime('%H:%M')}.")
        if return_forecast:
            # Return relevant forecast data
            return {
                "spike_info": spike_info,
                "forecast": forecast[['ds', 'yhat']].tail(60).to_dict(orient='records')
            }
    except Exception as e:
        print(f"Error during prediction for {agent_id}: {e}")
        return {"error": str(e)} if return_forecast else None

# --- Phase 3: New Background Service for Prediction ---
def prediction_service_loop():
    """Periodically runs the prediction model for all active agents."""
    while True:
        print("\n--- Prediction Service Running ---")
        active_agents = list(agent_data.keys())
        if not active_agents:
            print("No active agents to analyze.")
        else:
            for agent_id in active_agents:
                train_and_predict(agent_id)
        
        time.sleep(PREDICTION_INTERVAL)

def analyze_with_groq(baseline, event):
    """
    Sends baseline and event to Groq API and returns a structured JSON analysis.
    """
    # 1. Define the desired JSON structure in the system prompt
    system_prompt = """
    You are a network security analyst. Your task is to compare a new event to a baseline of normal behavior.
    Respond ONLY with a JSON object. The JSON object must have the following structure:
    {
      "is_anomaly": boolean,
      "problematic_fields": ["field1", "field2", ...],
      "suggestion": "A brief, actionable suggestion for the user."
    }
    Analyze the new event against the baseline and provide your response in this format.
    """
    
    # 2. Create the user prompt with the data
    user_prompt = (
        f"Analyze the following data.\n"
        f"Baseline (normal behavior): {json.dumps(baseline)}\n"
        f"New Event: {json.dumps(event)}"
    )

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": "llama3-70b-8192",  # Corrected to a valid Groq model name
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 512,
        "response_format": {"type": "json_object"}  # 3. Enable JSON Mode
    }

    try:
        response = requests.post(GROQ_API_URL, json=data, headers=headers, timeout=15)
        response.raise_for_status()
        result_text = response.json()["choices"][0]["message"]["content"]
        # 4. Parse the JSON string from the LLM into a Python dictionary
        return json.loads(result_text)
    except Exception as e:
        return {"error": f"Error processing AI request: {e}"}


def guardian_logic():
    while True:
        time.sleep(3)  # Run load balancing every 3 seconds
        print("\n--- Guardian Report ---")
        if not agent_data:
            print("No agents reporting.")
            continue
        busy_agents = []
        idle_agents = []
        all_agent_ids = list(agent_data.keys())
        for agent_id in all_agent_ids:
            agent = agent_data.get(agent_id)
            if not agent:
                continue
            last_seen_time = time.strptime(agent['last_seen'], '%Y-%m-%d %H:%M:%S')
            if (time.time() - time.mktime(last_seen_time)) > AGENT_TIMEOUT_SEC:
                print(f"🔴 ALERT: Agent '{agent_id}' is ROGUE (no report for >{AGENT_TIMEOUT_SEC}s). Triggering isolation.")
                del agent_data[agent_id]
                continue
            if agent.get('cpu') > BUSY_CPU_THRESHOLD:
                busy_agents.append(agent_id)
            elif agent.get('cpu') < IDLE_CPU_THRESHOLD:
                idle_agents.append(agent_id)
        print(f"Guardian Report: {len(busy_agents)} busy agent(s), {len(idle_agents)} idle agent(s).")
        if busy_agents and idle_agents:
            busy_agent_id = busy_agents[0]
            idle_agent_id = idle_agents[0]
            print(f"⚖️ DECISION: Offloading tasks from '{busy_agent_id}' to '{idle_agent_id}'.")
            # Store the action for frontend
            action = {
                "id": f"{busy_agent_id}_to_{idle_agent_id}_{int(time.time())}",
                "type": "offload",
                "sourceDevice": busy_agent_id,
                "targetDevice": idle_agent_id,
                "status": "active",
                "estimatedBenefit": round(agent_data[busy_agent_id]["cpu"] - agent_data[idle_agent_id]["cpu"], 2) if busy_agent_id in agent_data and idle_agent_id in agent_data else 0,
                "workloadAmount": agent_data[busy_agent_id].get("workload", 0) if busy_agent_id in agent_data else 0,
                "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
            }
            load_balancing_actions.append(action)
            # Keep only the last 20 actions
            if len(load_balancing_actions) > 20:
                load_balancing_actions.pop(0)
@app.get("/api/load_balancing")
async def get_load_balancing_actions():
    return load_balancing_actions

def update_baselines():
    """
    Periodically analyzes received Tetragon events to build/update a baseline profile for each agent.
    """
    while True:
        time.sleep(BASELINE_UPDATE_INTERVAL)
        print("\n--- Baseline Update ---")
        events_by_agent = defaultdict(list)
        for event in tetragon_events:
            agent_id = event.get("agent_id")
            if agent_id:
                events_by_agent[agent_id].append(event.get("event", {}))
        for agent_id, events in events_by_agent.items():
            processes = [e.get("process") for e in events if "process" in e]
            ports = [e.get("port") for e in events if "port" in e]
            disk_usages = [e.get("disk") for e in events if "disk" in e]
            memory_usages = [e.get("memory") for e in events if "memory" in e]
            allowed_processes = list(Counter(processes).keys())
            allowed_ports = list(Counter(ports).keys())
            allowed_disk_usage = max(disk_usages) if disk_usages else 90
            allowed_memory = max(memory_usages) if memory_usages else 95
            agent_baselines[agent_id] = {
                "allowed_processes": allowed_processes,
                "allowed_ports": allowed_ports,
                "allowed_disk_usage": allowed_disk_usage,
                "allowed_memory": allowed_memory
            }
            print(f"Updated baseline for {agent_id}: {agent_baselines[agent_id]}")

@app.post("/api/report")
async def receive_report(request: Request):
    data = await request.json()
    agent_id = data.get("agent_id")
    if agent_id:
        agent_data[agent_id] = {**data, "last_seen": time.strftime('%Y-%m-%d %H:%M:%S')}
        # Log data for historical analysis
        log_metric_to_csv(data)
        return JSONResponse({"status": "success", "message": f"Data received from {agent_id}"})
    return JSONResponse({"status": "error", "message": "Missing agent_id"}, status_code=400)

@app.get("/api/status")
async def get_status():
    return agent_data

@app.post("/api/timeseries")
async def run_timeseries_analysis():
    results = {}
    active_agents = list(agent_data.keys())
    for agent_id in active_agents:
        result = train_and_predict(agent_id, return_forecast=True)
        results[agent_id] = result
    return {"status": "analysis complete", "results": results}

@app.get("/metrics_history.csv")
async def get_metrics_csv():
    return FileResponse("metrics_history.csv", media_type="text/csv")

@app.post("/api/event")
async def receive_event(request: Request):
    """
    Receives an event, gets a structured analysis from Groq AI,
    and returns a complete nested JSON object.
    """
    event_data_full = await request.json()
    tetragon_events.append(event_data_full)  # Store for baseline learning

    agent_id = event_data_full.get("agent_id")
    new_event = event_data_full.get("event", {})
    # Use the learned baseline for the agent, or the one sent with the event as a fallback
    baseline = agent_baselines.get(agent_id, event_data_full.get("baseline", {}))

    # Get the structured analysis from the AI
    structured_analysis = analyze_with_groq(baseline, new_event)
    print(f"Groq AI Analysis for {agent_id}: {structured_analysis}")

    # Construct the final nested JSON response as requested
    final_response = {
        "agent_id": agent_id,
        "baseline_data": baseline,
        "event_data": new_event,
        "analysis": structured_analysis # The analysis is now a nested JSON object
    }

    return JSONResponse(final_response)


@app.on_event("startup")
async def startup_event_handler():
    """
    This function will be called once when the FastAPI application starts up.
    It's the recommended way to start background tasks.
    """
    print("Application starting up... Initializing background services.")
    
    guardian_thread = threading.Thread(target=guardian_logic, daemon=True)
    guardian_thread.start()
    
    baseline_thread = threading.Thread(target=update_baselines, daemon=True)
    baseline_thread.start()
    
    prediction_thread = threading.Thread(target=prediction_service_loop, daemon=True)
    prediction_thread.start()