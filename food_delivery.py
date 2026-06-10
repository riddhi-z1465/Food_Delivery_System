#!/usr/bin/env python3
"""
Location-Based Food Discovery & Delivery System Simulation.
A multi-threaded backend simulation mimicking Zomato/Uber Eats operations.

Features:
- Thread-safe Global State representing users, restaurants, recommendations, and orders.
- Message Broker simulation using queue.Queue for asynchronous event handling.
- Location-Based Matching Engine computing distances via the Haversine formula.
- Background Simulator threads for real-time user movement (random walks) and order processing.
- Threading HTTP Server serving system data at `/data` and an interactive operations dashboard at `/`.
- Robust shutdown controls for clean exit on keyboard interrupt.
"""

import sys
import math
import time
import uuid
import queue
import random
import json
import logging
import threading
from datetime import datetime
import os
import signal
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("ZomatoSimulation")

# Global Configuration
MUMBAI_CENTER_LAT = 19.0760
MUMBAI_CENTER_LON = 72.8777
COORDINATE_DELTA = 0.005  # Scale of movement/distribution (approx 500 meters)
MATCH_RADIUS_KM = 5.0    # Discovery radius for restaurants
NUM_USERS = 5
UPDATE_INTERVAL_SEC = 2.0  # Speed of movement simulation
SHUTDOWN_EVENT = threading.Event()

# -------------------------------------------------------------------------
# Core Helper Functions
# -------------------------------------------------------------------------
def haversine(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two points on the Earth 
    using the Haversine formula (returned in kilometers).
    """
    R = 6371.0 # Earth's radius in kilometers

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (math.sin(dphi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) *
         math.sin(dlambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return R * c

# -------------------------------------------------------------------------
# Models & Data Classes
# -------------------------------------------------------------------------
class Event:
    """Represents a system event flowing through the Message Broker."""
    def __init__(self, event_type: str, payload: dict):
        self.event_id = str(uuid.uuid4())
        self.timestamp = datetime.now().isoformat()
        self.event_type = event_type
        self.payload = payload

    def to_dict(self):
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "payload": self.payload
        }

# -------------------------------------------------------------------------
# Global State Management
# -------------------------------------------------------------------------
class GlobalState:
    """Thread-safe global state storing user, restaurant, and order data."""
    def __init__(self):
        self.lock = threading.Lock()
        self.users = {}
        self.restaurants = {}
        self.orders = {}
        self.recommendations = {} # user_id -> list of recommended restaurants
        self.recent_events = []   # Ring buffer of recent system events
        self.max_events = 50
        self.auto_move_enabled = False
        self.auto_orders_enabled = False

    def add_user(self, user_id: str, data: dict):
        with self.lock:
            self.users[user_id] = data

    def update_user_location(self, user_id: str, lat: float, lon: float):
        with self.lock:
            if user_id in self.users:
                self.users[user_id]["lat"] = lat
                self.users[user_id]["lon"] = lon

    def get_users(self):
        with self.lock:
            return json.loads(json.dumps(self.users))

    def add_restaurant(self, rest_id: str, data: dict):
        with self.lock:
            self.restaurants[rest_id] = data

    def get_restaurants(self):
        with self.lock:
            return json.loads(json.dumps(self.restaurants))

    def update_recommendations(self, user_id: str, recommendations: list):
        with self.lock:
            self.recommendations[user_id] = recommendations

    def get_recommendations(self):
        with self.lock:
            return json.loads(json.dumps(self.recommendations))

    def add_order(self, order_id: str, data: dict):
        with self.lock:
            self.orders[order_id] = data

    def update_order_status(self, order_id: str, status: str):
        with self.lock:
            if order_id in self.orders:
                self.orders[order_id]["status"] = status
                self.orders[order_id]["updated_at"] = datetime.now().isoformat()

    def get_orders(self):
        with self.lock:
            return json.loads(json.dumps(self.orders))

    def log_event(self, event: Event):
        with self.lock:
            self.recent_events.append(event.to_dict())
            if len(self.recent_events) > self.max_events:
                self.recent_events.pop(0)

    def get_recent_events(self):
        with self.lock:
            return list(self.recent_events)

    def get_snapshot(self):
        """Constructs a full JSON-serializable snapshot of the system state."""
        with self.lock:
            return {
                "users": json.loads(json.dumps(self.users)),
                "restaurants": json.loads(json.dumps(self.restaurants)),
                "orders": json.loads(json.dumps(self.orders)),
                "recommendations": json.loads(json.dumps(self.recommendations)),
                "recent_events": list(self.recent_events),
                "timestamp": datetime.now().isoformat(),
                "config": {
                    "auto_move_enabled": self.auto_move_enabled,
                    "auto_orders_enabled": self.auto_orders_enabled
                }
            }

    def update_config(self, auto_move: bool, auto_orders: bool):
        with self.lock:
            self.auto_move_enabled = auto_move
            self.auto_orders_enabled = auto_orders

# Instantiate singleton global state
global_state = GlobalState()

# -------------------------------------------------------------------------
# Message Broker (Queue Wrapper)
# -------------------------------------------------------------------------
class MessageBroker:
    """Simulates an event broker (e.g. RabbitMQ/Kafka) for pub-sub messages."""
    def __init__(self):
        self.queue = queue.Queue()

    def publish(self, event_type: str, payload: dict):
        event = Event(event_type, payload)
        # Log to global state event stream
        global_state.log_event(event)
        self.queue.put(event)

    def consume(self, timeout=0.5):
        try:
            return self.queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def task_done(self):
        self.queue.task_done()

# Instantiate singleton broker
message_broker = MessageBroker()

# -------------------------------------------------------------------------
# Background Thread 1: User Simulator
# -------------------------------------------------------------------------
class UserSimulator(threading.Thread):
    """
    Simulates users moving through the city. 
    Performs random walks and periodically publishes location updates.
    """
    def __init__(self):
        super().__init__(name="UserSimulatorThread", daemon=True)

    def run(self):
        logger.info("User Simulator Thread started.")
        while not SHUTDOWN_EVENT.is_set():
            if global_state.auto_move_enabled:
                users = global_state.get_users()
                for user_id, user_data in users.items():
                    # Random walk simulation within bounding delta
                    lat_step = random.uniform(-0.0008, 0.0008)
                    lon_step = random.uniform(-0.0008, 0.0008)
                    
                    new_lat = user_data["lat"] + lat_step
                    new_lon = user_data["lon"] + lon_step
                    
                    # Update location in global state
                    global_state.update_user_location(user_id, new_lat, new_lon)
                    
                    # Publish event to the broker
                    message_broker.publish("USER_MOVE", {
                        "user_id": user_id,
                        "name": user_data["name"],
                        "lat": new_lat,
                        "lon": new_lon
                    })
            
            if global_state.auto_orders_enabled:
                # Periodically generate random mock orders
                if random.random() < 0.15: # 15% chance of order generation per tick
                    self._generate_mock_order()

            SHUTDOWN_EVENT.wait(UPDATE_INTERVAL_SEC)
        logger.info("User Simulator Thread shutting down.")

    def _generate_mock_order(self):
        users = global_state.get_users()
        rests = global_state.get_restaurants()
        if not users or not rests:
            return
            
        user_id = random.choice(list(users.keys()))
        rest_id = random.choice(list(rests.keys()))
        
        user = users[user_id]
        restaurant = rests[rest_id]
        
        # Calculate distance to confirm feasibility
        dist = haversine(user["lat"], user["lon"], restaurant["lat"], restaurant["lon"])
        if dist > 6.0: # Only order if restaurant is reasonably close
            return

        order_id = f"ORD-{uuid.uuid4().hex[:6].upper()}"
        item = random.choice(restaurant["menu"])
        quantity = random.randint(1, 3)
        total_amount = round(item["price"] * quantity, 2)
        
        order_data = {
            "order_id": order_id,
            "user_id": user_id,
            "user_name": user["name"],
            "restaurant_id": rest_id,
            "restaurant_name": restaurant["name"],
            "item_name": item["name"],
            "quantity": quantity,
            "total_amount": total_amount,
            "status": "PENDING",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        global_state.add_order(order_id, order_data)
        message_broker.publish("NEW_ORDER", order_data)
        logger.info(f"Order created: {order_id} by {user['name']} at {restaurant['name']}.")

# -------------------------------------------------------------------------
# Background Thread 2: Matching Engine
# -------------------------------------------------------------------------
class MatchingEngine(threading.Thread):
    """
    Asynchronously processes events from the Broker:
    - On USER_MOVE: Recalculates matching nearest restaurants and caches recommendations.
    - On NEW_ORDER: Matches orders to available delivery riders (mock state progression).
    """
    def __init__(self):
        super().__init__(name="MatchingEngineThread", daemon=True)

    def run(self):
        logger.info("Matching Engine Thread started.")
        while not SHUTDOWN_EVENT.is_set():
            event = message_broker.consume(timeout=0.5)
            if event is None:
                continue

            try:
                if event.event_type == "USER_MOVE":
                    self._handle_user_move(event.payload)
                elif event.event_type == "NEW_ORDER":
                    self._handle_new_order(event.payload)
            except Exception as e:
                logger.error(f"Error handling event {event.event_type}: {e}", exc_info=True)
            finally:
                message_broker.task_done()
        logger.info("Matching Engine Thread shutting down.")

    def _handle_user_move(self, payload):
        user_id = payload["user_id"]
        user_lat = payload["lat"]
        user_lon = payload["lon"]

        # Find nearby restaurants using Haversine
        restaurants = global_state.get_restaurants()
        nearby_matches = []

        for rest_id, rest in restaurants.items():
            distance = haversine(user_lat, user_lon, rest["lat"], rest["lon"])
            if distance <= MATCH_RADIUS_KM:
                # Add metadata for recommendation logic
                nearby_matches.append({
                    "restaurant_id": rest_id,
                    "name": rest["name"],
                    "cuisine": rest["cuisine"],
                    "rating": rest["rating"],
                    "lat": rest["lat"],
                    "lon": rest["lon"],
                    "distance_km": round(distance, 2)
                })

        # Sort matches by distance
        nearby_matches.sort(key=lambda x: x["distance_km"])

        # Update recommendations (Store matching results to Global State)
        global_state.update_recommendations(user_id, nearby_matches)

        # Log recommendation match event
        if len(nearby_matches) > 0:
            rec_event = Event("RECOMMENDATION_MATCHED", {
                "user_id": user_id,
                "matches_count": len(nearby_matches),
                "closest_restaurant": nearby_matches[0]["name"],
                "closest_distance_km": nearby_matches[0]["distance_km"]
            })
            global_state.log_event(rec_event)

    def _handle_new_order(self, payload):
        """Asynchronously triggers order state updates."""
        order_id = payload["order_id"]
        # Spin up a small thread to simulate food preparation and delivery states in real-time
        threading.Thread(
            target=self._simulate_order_lifecycle,
            args=(order_id,),
            name=f"OrderLifecycle-{order_id}",
            daemon=True
        ).start()

    def _simulate_order_lifecycle(self, order_id):
        """Transitions order state through standard lifecycle stages."""
        statuses = ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"]
        for status in statuses:
            if SHUTDOWN_EVENT.is_set():
                break
            # Preparation takes 4 seconds, delivery takes 4 seconds
            time.sleep(4.0)
            
            global_state.update_order_status(order_id, status)
            message_broker.publish("ORDER_STATUS_UPDATE", {
                "order_id": order_id,
                "status": status
            })
            logger.info(f"Order {order_id} transitioned to status: {status}")

# -------------------------------------------------------------------------
# HTTP API & Web Dashboard Server
# -------------------------------------------------------------------------
class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer with SO_REUSEADDR enabled to avoid 'Address already in use' errors."""
    allow_reuse_address = True


class SimulationAPIHandler(BaseHTTPRequestHandler):
    """
    Handles API requests.
    Serves static files (index.html, style.css, app.js) and exposes REST endpoints.
    """
    def log_message(self, format, *args):
        # Suppress logging in console to prevent console pollution
        pass

    def do_OPTIONS(self):
        """Enable CORS pre-flight handshake."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/data":
            self._handle_data_endpoint()
        elif self.path in ("/", "/index.html", "/dashboard"):
            self._serve_file("index.html", "text/html")
        elif self.path == "/style.css":
            self._serve_file("style.css", "text/css")
        elif self.path == "/app.js":
            self._serve_file("app.js", "application/javascript")
        else:
            self._send_error(404, "Endpoint not found")

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        try:
            payload = json.loads(post_data.decode('utf-8')) if content_length > 0 else {}
        except Exception as e:
            self._send_error(400, f"Invalid JSON body: {e}")
            return

        if self.path == "/api/orders":
            self._handle_create_order(payload)
        elif self.path == "/api/users/location":
            self._handle_update_user_location(payload)
        elif self.path == "/api/users/add":
            self._handle_add_user(payload)
        elif self.path == "/api/config":
            self._handle_update_config(payload)
        else:
            self._send_error(404, "Endpoint not found")

    def _serve_file(self, filename: str, content_type: str):
        import os
        script_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(script_dir, filename)
        
        if not os.path.exists(file_path):
            self._send_error(404, f"File {filename} not found")
            return
            
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self._send_error(500, f"Error reading file {filename}: {e}")

    def _handle_data_endpoint(self):
        """Returns the complete current simulation snapshot as JSON."""
        snapshot = global_state.get_snapshot()
        self._send_json_response(200, snapshot)

    def _handle_create_order(self, payload):
        """Places a custom simulated order from the client app."""
        required = ["user_id", "restaurant_id", "item_name", "quantity", "total_amount"]
        if not all(k in payload for k in required):
            self._send_error(400, f"Missing required fields in payload. Must include: {required}")
            return
            
        user_id = payload["user_id"]
        rest_id = payload["restaurant_id"]
        
        # Get users and restaurants from state
        users = global_state.get_users()
        rests = global_state.get_restaurants()
        
        if user_id not in users:
            self._send_error(404, f"User {user_id} not found")
            return
        if rest_id not in rests:
            self._send_error(404, f"Restaurant {rest_id} not found")
            return
            
        order_id = f"ORD-{uuid.uuid4().hex[:6].upper()}"
        order_data = {
            "order_id": order_id,
            "user_id": user_id,
            "user_name": users[user_id]["name"],
            "restaurant_id": rest_id,
            "restaurant_name": rests[rest_id]["name"],
            "item_name": payload["item_name"],
            "quantity": int(payload["quantity"]),
            "total_amount": float(payload["total_amount"]),
            "status": "PENDING",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        global_state.add_order(order_id, order_data)
        message_broker.publish("NEW_ORDER", order_data)
        logger.info(f"Custom Order created: {order_id} via API.")
        self._send_json_response(201, {"status": "success", "order_id": order_id})

    def _handle_update_user_location(self, payload):
        """Manually updates a user's location coordinates (teleportation)."""
        if "user_id" not in payload or "lat" not in payload or "lon" not in payload:
            self._send_error(400, "Missing user_id, lat, or lon in payload")
            return
            
        user_id = payload["user_id"]
        lat = float(payload["lat"])
        lon = float(payload["lon"])
        
        users = global_state.get_users()
        if user_id not in users:
            self._send_error(404, f"User {user_id} not found")
            return
            
        global_state.update_user_location(user_id, lat, lon)
        
        # Publish move event to trigger matches recalculation
        message_broker.publish("USER_MOVE", {
            "user_id": user_id,
            "name": users[user_id]["name"],
            "lat": lat,
            "lon": lon
        })
        logger.info(f"User {users[user_id]['name']} relocated manually via API.")
        self._send_json_response(200, {"status": "success"})

    def _handle_add_user(self, payload):
        """Adds a new online customer to the simulation."""
        if "name" not in payload or "preference_cuisine" not in payload or "lat" not in payload or "lon" not in payload:
            self._send_error(400, "Missing name, preference_cuisine, lat, or lon in payload")
            return
            
        user_id = f"USER-{uuid.uuid4().hex[:4].upper()}"
        user_data = {
            "user_id": user_id,
            "name": payload["name"],
            "preference_cuisine": payload["preference_cuisine"],
            "lat": float(payload["lat"]),
            "lon": float(payload["lon"]),
            "status": "ONLINE"
        }
        
        global_state.add_user(user_id, user_data)
        message_broker.publish("USER_MOVE", user_data)
        logger.info(f"New User {payload['name']} registered via API.")
        self._send_json_response(201, {"status": "success", "user_id": user_id})

    def _handle_update_config(self, payload):
        """Updates simulation configuration dynamically."""
        auto_move = payload.get("auto_move_enabled", False)
        auto_orders = payload.get("auto_orders_enabled", False)
        global_state.update_config(auto_move, auto_orders)
        logger.info(f"Simulation config updated: Auto-Move={auto_move}, Auto-Orders={auto_orders}")
        self._send_json_response(200, {"status": "success"})

    def _send_json_response(self, code: int, data: dict):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def _send_error(self, code: int, message: str):
        self._send_json_response(code, {"error": message})

# -------------------------------------------------------------------------
# Main Simulator Initialization and Orchestrator
# -------------------------------------------------------------------------
def initialize_mock_data():
    """Seeds the in-memory GlobalState with initial users and restaurants."""
    # 1. Add static restaurants in Mumbai cluster
    restaurants = [
        {
            "restaurant_id": "REST-001",
            "name": "The Gourmet Hub",
            "cuisine": "Indian",
            "rating": 4.8,
            "lat": MUMBAI_CENTER_LAT + 0.0012,
            "lon": MUMBAI_CENTER_LON - 0.0015,
            "menu": [
                {"name": "Paneer Butter Masala", "price": 280.00},
                {"name": "Butter Naan", "price": 60.00},
                {"name": "Dal Makhani", "price": 220.00}
            ]
        },
        {
            "restaurant_id": "REST-002",
            "name": "Pizza Express",
            "cuisine": "Italian",
            "rating": 4.5,
            "lat": MUMBAI_CENTER_LAT - 0.0025,
            "lon": MUMBAI_CENTER_LON + 0.0031,
            "menu": [
                {"name": "Margherita Pizza", "price": 350.00},
                {"name": "Pepperoni Feast Pizza", "price": 450.00},
                {"name": "Garlic Bread Sticks", "price": 120.00}
            ]
        },
        {
            "restaurant_id": "REST-003",
            "name": "Sushi Delight",
            "cuisine": "Japanese",
            "rating": 4.9,
            "lat": MUMBAI_CENTER_LAT + 0.0041,
            "lon": MUMBAI_CENTER_LON + 0.0018,
            "menu": [
                {"name": "Salmon Nigiri (4pcs)", "price": 480.00},
                {"name": "California Sushi Roll", "price": 380.00},
                {"name": "Miso Soup", "price": 150.00}
            ]
        },
        {
            "restaurant_id": "REST-004",
            "name": "Wok & Roll",
            "cuisine": "Chinese",
            "rating": 4.2,
            "lat": MUMBAI_CENTER_LAT - 0.0010,
            "lon": MUMBAI_CENTER_LON - 0.0040,
            "menu": [
                {"name": "Veg Fried Rice", "price": 190.00},
                {"name": "Manchurian Gravy", "price": 210.00},
                {"name": "Spring Rolls (6pcs)", "price": 130.00}
            ]
        },
        {
            "restaurant_id": "REST-005",
            "name": "Burger Castle",
            "cuisine": "American",
            "rating": 4.4,
            "lat": MUMBAI_CENTER_LAT - 0.0035,
            "lon": MUMBAI_CENTER_LON - 0.0022,
            "menu": [
                {"name": "Classic Cheese Burger", "price": 180.00},
                {"name": "Crispy Chicken Burger", "price": 220.00},
                {"name": "Salted French Fries", "price": 90.00}
            ]
        },
        {
            "restaurant_id": "REST-006",
            "name": "Cafe Coffee Day",
            "cuisine": "Cafe",
            "rating": 4.1,
            "lat": MUMBAI_CENTER_LAT + 0.0020,
            "lon": MUMBAI_CENTER_LON - 0.0035,
            "menu": [
                {"name": "Cappuccino", "price": 140.00},
                {"name": "Cold Coffee with Ice Cream", "price": 180.00},
                {"name": "Chocolate Brownie", "price": 110.00}
            ]
        }
    ]

    for rest in restaurants:
        global_state.add_restaurant(rest["restaurant_id"], rest)
        logger.info(f"Initialized Restaurant: {rest['name']} at ({rest['lat']}, {rest['lon']})")

    # 2. Add moving users scattered around the center coordinates
    users = [
        {"id": "USER-1", "name": "Rahul", "pref": "Indian"},
        {"id": "USER-2", "name": "Sarah", "pref": "Italian"},
        {"id": "USER-3", "name": "Amit", "pref": "Chinese"},
        {"id": "USER-4", "name": "Jessica", "pref": "Japanese"},
        {"id": "USER-5", "name": "Priya", "pref": "Cafe"}
    ]

    for u in users:
        # Give them starting coordinates slightly offset from center
        start_lat = MUMBAI_CENTER_LAT + random.uniform(-COORDINATE_DELTA, COORDINATE_DELTA)
        start_lon = MUMBAI_CENTER_LON + random.uniform(-COORDINATE_DELTA, COORDINATE_DELTA)
        
        user_data = {
            "user_id": u["id"],
            "name": u["name"],
            "preference_cuisine": u["pref"],
            "lat": start_lat,
            "lon": start_lon,
            "status": "ONLINE"
        }
        global_state.add_user(u["id"], user_data)
        # Publish initial USER_MOVE so MatchingEngine computes recommendations on startup
        message_broker.publish("USER_MOVE", user_data)
        logger.info(f"Initialized User: {u['name']} at ({start_lat}, {start_lon})")

def main():
    """Orchestrates system startup and background thread lifecycles."""
    logger.info("Initializing Zomato Real-Time System Simulation...")
    initialize_mock_data()

    # Create background worker threads
    matching_engine = MatchingEngine()
    user_simulator = UserSimulator()

    # Configure HTTP server on localhost:8080 (or custom environment PORT)
    port = int(os.environ.get("PORT", 8080))

    # Auto-kill any stale process still holding the port
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True
        )
        pids = [p for p in result.stdout.strip().split() if p]
        killed = False
        for pid in pids:
            pid = int(pid)
            if pid != os.getpid():
                os.kill(pid, signal.SIGKILL)
                logger.info(f"Killed stale process PID {pid} holding port {port}.")
                killed = True
        if killed:
            time.sleep(1.0)  # Give the OS a moment to release the socket
    except Exception:
        pass  # Non-fatal: proceed and let SO_REUSEADDR handle it

    server_address = ('127.0.0.1', port)
    httpd = ReusableThreadingHTTPServer(server_address, SimulationAPIHandler)
    
    server_thread = threading.Thread(
        target=httpd.serve_forever,
        name="HTTPServerThread",
        daemon=True
    )

    logger.info("Starting background worker threads...")
    matching_engine.start()
    user_simulator.start()
    server_thread.start()

    logger.info(f"Zomato Simulation dashboard active at http://127.0.0.1:{port}/")
    logger.info("Press Ctrl+C to terminate simulation.")

    try:
        # Main execution loop - wait for shutdown
        while not SHUTDOWN_EVENT.is_set():
            time.sleep(1.0)
    except KeyboardInterrupt:
        logger.info("Received KeyboardInterrupt. Initiating graceful shutdown...")
    finally:
        # Trigger shutdown event
        SHUTDOWN_EVENT.set()
        
        # Shutdown HTTP server
        logger.info("Stopping HTTP server...")
        httpd.shutdown()
        httpd.server_close()
        
        # Wait for threads to close cleanly
        logger.info("Waiting for background worker threads to exit...")
        matching_engine.join(timeout=2.0)
        user_simulator.join(timeout=2.0)
        server_thread.join(timeout=2.0)
        
        logger.info("Zomato System Simulation terminated successfully.")

if __name__ == "__main__":
    main()
