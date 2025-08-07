🛡️ Aegis of Alderaan: AI Network Guardian

An AI-powered, predictive monitoring system designed to ensure the resilience and security of a distributed network. This project uses real-time anomaly detection and time-series forecasting to anticipate and flag threats before they impact the system.

(Action Required: Add a screenshot or a GIF of your running application here! A GIF showing the 3D view and the dashboard would be very effective.)
![Aegis of Alderaan Dashboard](https://i.imgur.com/your-screenshot.png)

✨ Features

This project is a multi-phase implementation of a resilient networking system, featuring:

    Real-time Network Monitoring: A dynamic frontend that displays the health and status of all connected network devices in real-time. 

AI-Powered Anomaly Detection: Uses the Groq API to send device events to a Large Language Model (Llama3) for deep analysis, returning structured JSON feedback on anomalies. 

Predictive Analytics: Implements time-series forecasting with Prophet to predict future CPU spikes and potential resource bottlenecks based on historical trends. 

Dynamic Baseline Learning: The system automatically learns a "normal" behavioral baseline for each agent over time and uses it for more accurate anomaly detection. 

Advanced Frontend Visualization:

    An interactive UI built with React, TypeScript, and Tailwind CSS. 

    Multiple views: A high-level Guardian AI dashboard, a 3D network topology visualization (using Three.js), and a detailed device analytics view.

    Clear data visualization with charts from Recharts.

Multi-Agent Simulation: A powerful simulator that mimics a diverse network of devices (web servers, databases, workstations), each with unique behavioral profiles and periodic, randomized anomaly injection. 

🗺️ How We Implemented Each Phase

This project was built incrementally, tackling each phase of the "Aegis of Alderaan" challenge.

Phase 1: Gather Data - The Sensors of the Aegis

    Endpoint Agents: We chose Option B: Active Mesh of Endpoint Agents. The 

simulator.py script represents these agents, each collecting and reporting metrics like CPU, memory, and disk usage. 

Central Dashboard: The FastAPI backend (dashboard.py) serves as the central hub, receiving status reports from all simulated agents. 

Central Guardian: The guardian_logic thread in dashboard.py oversees the system, identifying rogue agents via timeout and flagging busy/idle agents for potential load balancing. 

Phase 2: Monitor Network Health - The Eyes of the Aegis

    Real-time & Behavioral Monitoring: We collect detailed system metrics (CPU, memory, disk, process stats) via the simulator. 

AI-Powered Anomaly Detection: We integrated the Groq API to analyze events. The 

analyze_with_groq function sends an event and a baseline to Llama3, which returns a structured JSON object indicating if the event is an anomaly. 

Training the System: Our "training" process involves the update_baselines function, which learns a device's normal behavior by observing its metrics over time, fulfilling the requirement to "recognize normal traffic patterns". 

Phase 3: Identify and Predict Threats - The Intuition of the Aegis

    Historical Trend Analysis: The backend logs all incoming metrics to metrics_history.csv.

    Predictive Models: The prediction_service_loop periodically uses Pandas and Prophet to train a time-series model for each agent. 

Forecast Future Risks: This model forecasts future CPU usage and prints a PREDICTIVE ALERT if it anticipates a spike above the defined threshold, directly implementing the "Forecast potential traffic spikes" requirement. 

Phase 4 & Beyond (Next Steps)

While our current implementation focuses on Phases 1-3, the modular architecture allows for easy expansion into Phase 4:

    Automated Actions: The "DECISION" and "ALERT" logs from the Guardian can be replaced with subprocess calls to modular scripts (e.g., isolate.sh) to perform automated remediation. 

Learn from Documentation: The analyze_with_groq function can be enhanced with a RAG pipeline to provide even more context-aware suggestions based on technical documents. 

🛠️ Tech Stack

    Backend:

        Framework: FastAPI

        Language: Python

        Time-Series: Prophet & Pandas

        AI Integration: Requests

    Frontend:

        Framework: React

        Language: TypeScript

        Styling: Tailwind CSS

        3D Visualization: Three.js & GSAP

        Charting: Recharts

    AI Service:

        Groq API (Llama3)

🚀 Getting Started

Follow these instructions to get the project up and running on your local machine.

Prerequisites

    Python 3.8+ & pip

    Node.js & npm

    A Groq API Key

Backend Setup

    Clone the repository.

    Navigate to the backend directory and create/activate a virtual environment:
    Bash

# In the project's root directory
python -m venv venv
source venv/bin/activate  # On Windows, use `venv\Scripts\activate`

Install Python dependencies:
Bash

    pip install "fastapi[all]" pandas prophet requests python-dotenv

    Create an environment file:

        Create a file named .env in the root directory.

        Add your Groq API key to this file:

        GROQ_API_KEY=gsk_YourSecretKeyGoesHere

Frontend Setup

    Navigate to the frontend directory:
    Bash

cd frontend 

Install npm dependencies:
Bash

    npm install

⚡ How to Run

You will need to run three separate processes in three different terminals.

    Terminal 1: Start the Backend Server

        From the root directory (where dashboard.py is):
    Bash

uvicorn dashboard:app --reload

Terminal 2: Start the Network Simulator

    From the root directory (where simulator.py is):

Bash

python simulator.py

Terminal 3: Start the Frontend Application

    From the frontend directory:

Bash

    npm start

    Now, open your web browser and navigate to http://localhost:3000 to see the Aegis of Alderaan dashboard in action.
