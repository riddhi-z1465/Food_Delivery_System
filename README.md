# 🛵 Zomato Live: Real-Time Operations Central & Match Dispatch Simulator

A high-performance, multi-threaded simulation mimicking real-time food delivery platforms like Zomato or Uber Eats. It demonstrates asynchronous event handling, real-time spatial recommendations, concurrent order state machines, and a dynamic HTML5 Canvas operations dashboard.

---

## 🏗️ Architecture Overview

The system is split into a multi-threaded Python backend and a lightweight, interactive frontend dashboard:

```mermaid
graph TD
    subgraph Python Backend
        A[Threading HTTPServer] -->|State Snapshot / API Posts| B(Global State - Thread Safe)
        C[User Simulator Thread] -->|Auto-Move / Auto-Orders| D(Message Broker - queue.Queue)
        E[Matching Engine Thread] -->|Consume Events| D
        E -->|Calculate Recommendations / Distances| B
        E -->|Order Lifecycle Simulation Threads| B
    end
    subgraph Frontend Dashboard
        F[HTML5 / Vanilla CSS UI] <-->|Fetch Loop & POST Actions| A
        G[Canvas Visualizer] -->|Project Coordinates| F
    end
```

### 1. The Multi-Threaded Engine (Python Backend)
* **Thread-Safe Global State (`GlobalState`)**: Implements strict thread-safety using Python's `threading.Lock` to coordinate real-time updates of users, restaurants, recommendations, orders, and configuration variables.
* **Message Broker (`MessageBroker`)**: A simulated pub-sub queue utilizing `queue.Queue` to handle system-wide events asynchronously.
* **Location-Based Matching Engine (`MatchingEngine`)**: Computes great-circle distances between customers and restaurants dynamically using the **Haversine formula**. It updates available restaurant recommendations for online customers in real-time (within a default 5.0 km radius).
* **Simulators**:
  * **User Simulator**: Runs random walks (real-time user coordinate changes) and schedules randomized mock order placement.
  * **Order Lifecycle Simulator**: Spawns detached threads executing state transitions: `PENDING` ➔ `PREPARING` ➔ `OUT_FOR_DELIVERY` ➔ `DELIVERED`.
* **Lightweight Web API**: A `ThreadingHTTPServer` that hosts dashboard static files and processes REST API payloads.

### 2. Operations Central Dashboard (Frontend)
* **Live Location Dispatch Grid**: Built on HTML5 Canvas. Projects geographical coordinates (Lat/Lon) to screen pixels. It draws connection lines representing the closest restaurant match, glows active browsing sessions, and enables dragging/teleportation interactively.
* **Customer Control Hub**: Enables testing system responsiveness by manually choosing a customer, browsing menus, and ordering specific items.
* **Kanban-Style Live Order Board**: Tracks simulated order progress through Pipeline Columns (Pending ➔ Kitchen ➔ Delivery ➔ Delivered).
* **Live Message Logs Terminal**: Streams events from the `MessageBroker` in real-time.

---

## 🗺️ Production-Grade Microservices Architecture (Zomato-Like)

For production scale, the simple multi-threaded simulation scales up to a robust, layered, event-driven microservices system:

```mermaid
graph TD
    %% 1. Client Layer
    subgraph Client [1. Client Layer]
        Mobile["📱 Mobile App (iOS/Android)"]
        Web["💻 Web App"]
    end

    %% 2. API Gateway Layer
    subgraph Gateway [2. API Gateway Layer]
        APIGW["🛡️ API Gateway <br> (Auth, Routing, Rate Limiting, Load Balancing)"]
    end
    Client --> APIGW

    %% 3. Microservices Layer
    subgraph Microservices [3. Microservices Layer]
        UserSvc["👤 User Service <br> (Auth, Profile, Preferences)"]
        RestSvc["🍴 Restaurant Service <br> (Details, Menus, Availability)"]
        SearchSvc["🔍 Search Service <br> (Full-text - Elasticsearch)"]
        LocSvc["📍 Location Service <br> (GeoHash, PostGIS, Quadtree)"]
        ReviewSvc["⭐ Review & Rating <br> (Reviews, Aggregation)"]
        RecSvc["🤖 Recommendation Svc <br> (ML Ranking, Personalize)"]
        OrderSvc["📦 Order Service <br> (Cart, Checkout, Tracking)"]
    end
    APIGW --> UserSvc
    APIGW --> RestSvc
    APIGW --> SearchSvc
    APIGW --> LocSvc
    APIGW --> ReviewSvc
    APIGW --> RecSvc
    APIGW --> OrderSvc

    %% 4. Cache Layer
    subgraph Cache [5. Cache Layer]
        Redis[("⚡ Redis Cache <br> (Nearby, Popular, Details, Sessions)")]
    end
    RestSvc -.->|Cache Access| Redis
    LocSvc -.->|Cache Access| Redis
    OrderSvc -.->|Cache Access| Redis

    %% 5. Data Layer
    subgraph Data [4. Data Layer]
        UserDB[("🗄️ User DB <br> PostgreSQL")]
        RestDB[("🗄️ Restaurant DB <br> SQL/NoSQL")]
        SearchIdx[("🗄️ Search Index <br> Elasticsearch")]
        GeoIdx[("🗄️ Geo-Spatial Index <br> PostGIS / Redis GEO")]
        ReviewDB[("🗄️ Review DB <br> MongoDB")]
        OrderDB[("🗄️ Order DB <br> SQL")]
    end
    UserSvc --> UserDB
    RestSvc --> RestDB
    SearchSvc --> SearchIdx
    LocSvc --> GeoIdx
    ReviewSvc --> ReviewDB
    OrderSvc --> OrderDB

    %% 6. Event Streaming Layer
    subgraph EventStream [6. Event Streaming Layer]
        Kafka[["⚙️ Apache Kafka / Message Queue <br> (User Activity, Ratings, Restaurant Updates, ML Training)"]]
    end
    UserSvc -->|User Activity| Kafka
    ReviewSvc -->|Ratings & Reviews| Kafka
    RestSvc -->|Restaurant Status| Kafka
    OrderSvc -->|Order Events| Kafka

    %% 7. Recommendation System
    subgraph RecSystem [7. Recommendation System]
        FeatureStore[("💾 Feature Store <br> User & Restaurant features")]
        MLModel["🧠 ML Ranking Model <br> (Inference Service)"]
        PersEngine["⚙️ Personalization Engine <br> (Kafka Consumer)"]
    end
    Kafka -->|Consume Events| PersEngine
    PersEngine --> FeatureStore
    FeatureStore --> MLModel
    MLModel --> RecSvc

    %% 8. Media Storage
    subgraph Media [8. Media Storage]
        S3[("🪣 Object Storage S3 <br> Restaurant/Menu/Profile images")]
        CDN["🌐 CDN <br> (Image delivery)"]
    end
    RestSvc --> S3
    S3 --> CDN

    %% 9. External Services
    subgraph External [9. External Services]
        Payment["💳 Payment Gateway <br> (Razorpay / Stripe)"]
        Maps["🗺️ Maps API <br> (Google / Mapbox)"]
        Notify["🔔 Notifications <br> (SMS / Email / Push)"]
    end
    OrderSvc --> Payment
    LocSvc --> Maps
    OrderSvc --> Notify
```

### Architectural Breakdown

1. **Client Layer**: The client application (Mobile/Web) sends API calls and telemetry updates.
2. **API Gateway Layer**: Manages security, authentication, and balances/routes requests to target microservices.
3. **Microservices Layer**: Distributed autonomous microservices handling specialized scopes:
   - **User Service**: Manages accounts, profiles, and cuisine preferences.
   - **Restaurant Service**: Manages menus, restaurant metadata, and operation times.
   - **Search Service**: Performs fuzzy-search matches over menus.
   - **Location Service**: Tracks active delivery rider GPS and handles distance/ETA queries.
   - **Review Service**: Registers user feedback and tracks rating scores.
   - **Recommendation Service**: Powers discovery screens with personalized feeds.
   - **Order Service**: Coordinates order placement, payments, and delivery orchestration.
4. **Cache Layer**: Redis buffers queries for nearby venues, geo-spatial lists, and active session details.
5. **Data Layer**: Specialized polyglot storage databases matching individual service needs (e.g. relational PostgreSQL/MySQL, search indexes in Elasticsearch, geo-indices in PostGIS/Redis, and MongoDB for reviews).
6. **Event Streaming Layer**: Apache Kafka acts as the event-driven backbone, broadcasting high-volume updates (e.g., rider location tracks, order status telemetry).
7. **Recommendation System**: Aggregates behavioral features into a Feature Store to serve real-time predictions via an ML Ranking model.
8. **Media Storage**: Uses cloud object storage (e.g., AWS S3) cached close to the user via a Content Delivery Network (CDN) for fast image rendering.
9. **External Services**: Interfaces with third-party networks for processing payments, rendering map interfaces, and pushing app notifications.

---

## ⚡ Key Features

* **Visual Teleportation**: Click anywhere on the map to relocate the selected customer. The nearest restaurant recommendations are updated instantly.
* **Interactive Toggles**: Tweak `🤖 Auto-Move` (users wander around Mumbai) and `🍕 Auto-Orders` (automated customer orders) via dashboard control pills.
* **Broker Event Stream**: View structural logs like `USER_MOVE`, `RECOMMENDATION_MATCHED`, `NEW_ORDER`, and `ORDER_STATUS_UPDATE` as they happen.
* **Simulate Custom Orders**: Browse cuisine-specific menus (Indian, Italian, Japanese, etc.), increment item quantities, and place custom orders directly from the UI.

---

## 🚀 Getting Started

### Prerequisites
* **Python 3.x**
* No external dependencies required (built entirely using Python standard libraries).

### Running the Simulator
1. Clone the repository and navigate to the directory:
   ```bash
   git clone https://github.com/riddhi-z1465/Food_Delivery_System.git
   cd Food_Delivery_System
   ```
2. Start the simulation:
   ```bash
   python3 simulation.py
   ```
3. Open your browser and navigate to:
   ```
   http://127.0.0.1:8080/
   ```

---

## 🔌 API Reference

The backend exposes a JSON REST API for querying and controlling the simulator:

### 1. Get Simulation Snapshot
* **Endpoint:** `GET /data`
* **Response:** Returns the complete system state snapshot (users, restaurants, orders, recommendations, event streams, and configs).

### 2. Place Custom Order
* **Endpoint:** `POST /api/orders`
* **Body:**
  ```json
  {
    "user_id": "USER-1",
    "restaurant_id": "REST-001",
    "item_name": "Paneer Butter Masala",
    "quantity": 2,
    "total_amount": 560.00
  }
  ```

### 3. Update User Location
* **Endpoint:** `POST /api/users/location`
* **Body:**
  ```json
  {
    "user_id": "USER-1",
    "lat": 19.0772,
    "lon": 72.8762
  }
  ```

### 4. Create Dynamic User
* **Endpoint:** `POST /api/users/add`
* **Body:**
  ```json
  {
    "name": "Rohan",
    "preference_cuisine": "Italian",
    "lat": 19.0760,
    "lon": 72.8777
  }
  ```

### 5. Update Simulation Config
* **Endpoint:** `POST /api/config`
* **Body:**
  ```json
  {
    "auto_move_enabled": true,
    "auto_orders_enabled": false
  }
  ```
