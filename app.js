// Zomato Operations Central JavaScript Client
let stateData = { users: {}, restaurants: {}, orders: {}, recommendations: {}, recent_events: [] };
let selectedUserId = null;
let activeMenuRestaurantId = null;
let currentCart = { item: null, quantity: 1, price: 0, restaurantId: null };
let systemStartTime = Date.now();

// Connect to backend (if running on a different port like Live Server 5500, fallback to default 8080)
const BACKEND_URL = (window.location.port !== '8080' && window.location.port !== '8085' && window.location.port !== '') 
    ? 'http://127.0.0.1:8080' 
    : '';

// Canvas Coordinates Projection State
const canvas = document.getElementById('liveMapCanvas');
const ctx = canvas.getContext('2d');
let bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
let hoveredElement = null; // { type: 'user'|'restaurant', id, x, y, radius }

// UI Elements
const customerSelector = document.getElementById('customer-selector');
const customerOrderCard = document.getElementById('customer-order-card');
const noCustomerSelected = document.getElementById('no-customer-selected');
const appUserName = document.getElementById('app-user-name');
const appUserCuisine = document.getElementById('app-user-cuisine');
const appRestaurantList = document.getElementById('app-restaurant-list');
const appMenuSection = document.getElementById('app-menu-section');
const appMenuRestaurantName = document.getElementById('app-menu-restaurant-name');
const appMenuList = document.getElementById('app-menu-list');
const closeMenuBtn = document.getElementById('close-menu-btn');

const cartItemName = document.getElementById('cart-item-name');
const cartQty = document.getElementById('cart-qty');
const cartDecBtn = document.getElementById('cart-dec-btn');
const cartIncBtn = document.getElementById('cart-inc-btn');
const cartTotal = document.getElementById('cart-total');
const placeOrderBtn = document.getElementById('place-order-btn');

const activeOrdersBadge = document.getElementById('active-orders-badge');
const pipePending = document.getElementById('pipe-pending');
const pipePreparing = document.getElementById('pipe-preparing');
const pipeDelivery = document.getElementById('pipe-delivery');
const pipeDelivered = document.getElementById('pipe-delivered');
const logConsoleStream = document.getElementById('log-console-stream');
const clearLogsBtn = document.getElementById('clear-logs-btn');

const mapTooltip = document.getElementById('mapTooltip');
const systemUptime = document.getElementById('system-uptime');
const toggleAutoMove = document.getElementById('toggle-auto-move');
const toggleAutoOrders = document.getElementById('toggle-auto-orders');

// Modal Elements
const addUserTrigger = document.getElementById('add-user-trigger');
const addUserModal = document.getElementById('add-user-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addUserForm = document.getElementById('add-user-form');
const newUserCuisine = document.getElementById('new-user-cuisine');
const newUserName = document.getElementById('new-user-name');
const resetViewBtn = document.getElementById('reset-view-btn');

// -------------------------------------------------------------------------
// Startup & Core Loop
// -------------------------------------------------------------------------
function init() {
    setupEventListeners();
    resizeCanvas();
    fetchState();
    setInterval(fetchState, 1000);
    setInterval(updateUptime, 1000);
}

// Adjust canvas resolution dynamically
function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawMap();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// -------------------------------------------------------------------------
// API Comm Layer
// -------------------------------------------------------------------------
async function fetchState() {
    try {
        const response = await fetch(`${BACKEND_URL}/data`);
        if (!response.ok) throw new Error("Network status not OK");
        stateData = await response.json();
        
        // Synchronize backend config toggles with UI
        if (stateData.config) {
            toggleAutoMove.checked = stateData.config.auto_move_enabled;
            toggleAutoOrders.checked = stateData.config.auto_orders_enabled;
        }
        
        updateSelectors();
        updateCustomerOrderApp();
        updatePipelines();
        updateLogConsole();
        drawMap();
    } catch (error) {
        console.error("Error fetching state:", error);
    }
}

async function postRequest(path, payload) {
    try {
        const response = await fetch(`${BACKEND_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        fetchState(); // Refresh state immediately
        return result;
    } catch (error) {
        console.error(`Error on POST ${path}:`, error);
        alert(`API Error: ${error.message}`);
    }
}

// -------------------------------------------------------------------------
// UI Handlers & Interactivity
// -------------------------------------------------------------------------
function setupEventListeners() {
    // Config Toggles
    const sendConfigUpdate = () => {
        postRequest('/api/config', {
            auto_move_enabled: toggleAutoMove.checked,
            auto_orders_enabled: toggleAutoOrders.checked
        });
    };
    toggleAutoMove.addEventListener('change', sendConfigUpdate);
    toggleAutoOrders.addEventListener('change', sendConfigUpdate);

    // Select customer to control
    customerSelector.addEventListener('change', (e) => {
        selectedUserId = e.target.value;
        customerOrderCard.classList.remove('hidden');
        noCustomerSelected.classList.add('hidden');
        activeMenuRestaurantId = null;
        appMenuSection.classList.add('hidden');
        resetCart();
        updateCustomerOrderApp();
    });

    // Close restaurant menu view
    closeMenuBtn.addEventListener('click', () => {
        activeMenuRestaurantId = null;
        appMenuSection.classList.add('hidden');
        resetCart();
    });

    // Cart Qty Controls
    cartDecBtn.addEventListener('click', () => {
        if (currentCart.quantity > 1) {
            currentCart.quantity--;
            updateCartSummary();
        }
    });

    cartIncBtn.addEventListener('click', () => {
        currentCart.quantity++;
        updateCartSummary();
    });

    // Place simulated order
    placeOrderBtn.addEventListener('click', () => {
        if (!selectedUserId || !currentCart.item) return;
        
        const payload = {
            user_id: selectedUserId,
            restaurant_id: currentCart.restaurantId,
            item_name: currentCart.item.name,
            quantity: currentCart.quantity,
            total_amount: currentCart.price * currentCart.quantity
        };
        
        postRequest('/api/orders', payload).then(res => {
            if (res && res.status === "success") {
                activeMenuRestaurantId = null;
                appMenuSection.classList.add('hidden');
                resetCart();
            }
        });
    });

    // Clear logs
    clearLogsBtn.addEventListener('click', () => {
        logConsoleStream.innerHTML = '';
        stateData.recent_events = [];
    });

    // Modal triggers
    addUserTrigger.addEventListener('click', () => {
        addUserModal.classList.remove('hidden');
    });
    
    const closeModal = () => {
        addUserModal.classList.add('hidden');
        addUserForm.reset();
    };
    closeModalBtn.addEventListener('click', closeModal);
    cancelAddBtn.addEventListener('click', closeModal);

    // Create user submission
    addUserForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const payload = {
            name: newUserName.value,
            preference_cuisine: newUserCuisine.value,
            // Place near center with slight random offset
            lat: 19.0760 + (Math.random() - 0.5) * 0.006,
            lon: 72.8777 + (Math.random() - 0.5) * 0.006
        };
        postRequest('/api/users/add', payload).then(res => {
            if (res && res.status === "success") {
                closeModal();
            }
        });
    });

    // Canvas interactivity
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('click', handleCanvasClick);
    
    // Reset visual map bounds
    resetViewBtn.addEventListener('click', () => {
        bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
        drawMap();
    });
}

function updateUptime() {
    const elapsed = Math.floor((Date.now() - systemStartTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    systemUptime.innerText = `${hrs}:${mins}:${secs}`;
}

function updateSelectors() {
    const currentSelVal = customerSelector.value;
    // Populate select values if counts differ
    const userKeys = Object.keys(stateData.users);
    
    // Check if dropdown option count matches user list + 1 default
    if (customerSelector.options.length !== userKeys.length + 1) {
        // Keep initial option
        customerSelector.innerHTML = '<option value="" disabled selected>Choose a customer...</option>';
        userKeys.forEach(uid => {
            const u = stateData.users[uid];
            const opt = document.createElement('option');
            opt.value = uid;
            opt.innerText = `${u.name} (Preference: ${u.preference_cuisine})`;
            customerSelector.appendChild(opt);
        });
        
        // Restore selection if valid
        if (stateData.users[currentSelVal]) {
            customerSelector.value = currentSelVal;
        } else {
            selectedUserId = null;
            customerOrderCard.classList.add('hidden');
            noCustomerSelected.classList.remove('hidden');
        }
    }
}

function updateCustomerOrderApp() {
    if (!selectedUserId || !stateData.users[selectedUserId]) {
        customerOrderCard.classList.add('hidden');
        noCustomerSelected.classList.remove('hidden');
        return;
    }

    const user = stateData.users[selectedUserId];
    appUserName.innerText = user.name;
    appUserCuisine.innerText = `${user.preference_cuisine} Preference`;

    // Render Recommendations List
    const recs = stateData.recommendations[selectedUserId] || [];
    appRestaurantList.innerHTML = '';
    
    if (recs.length === 0) {
        appRestaurantList.innerHTML = '<div class="empty-state">No matching restaurants within 5km range.</div>';
        return;
    }

    recs.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <div class="item-left">
                <span class="item-name">📍 ${r.name}</span>
                <span class="item-desc">${r.cuisine} Cuisine • ⭐ ${r.rating}</span>
            </div>
            <div class="item-right">${r.distance_km} km</div>
        `;
        
        item.addEventListener('click', () => openRestaurantMenu(r.restaurant_id, r.name));
        appRestaurantList.appendChild(item);
    });
}

function openRestaurantMenu(restId, restName) {
    const rest = stateData.restaurants[restId];
    if (!rest) return;

    activeMenuRestaurantId = restId;
    appMenuRestaurantName.innerText = rest.name;
    appMenuSection.classList.remove('hidden');
    
    appMenuList.innerHTML = '';
    rest.menu.forEach(m => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <div class="item-left">
                <span class="item-name">${m.name}</span>
                <span class="item-desc">Freshly prepared</span>
            </div>
            <div class="item-right">&#8377;${m.price.toFixed(2)}</div>
        `;
        
        item.addEventListener('click', () => selectCartItem(m, restId));
        appMenuList.appendChild(item);
    });

    // Auto-select first item in menu
    if (rest.menu.length > 0) {
        selectCartItem(rest.menu[0], restId);
    }
}

function selectCartItem(menuItem, restId) {
    currentCart.item = menuItem;
    currentCart.price = menuItem.price;
    currentCart.restaurantId = restId;
    currentCart.quantity = 1;
    updateCartSummary();
}

function updateCartSummary() {
    if (!currentCart.item) {
        resetCart();
        return;
    }
    cartItemName.innerText = currentCart.item.name;
    cartQty.innerText = currentCart.quantity;
    cartTotal.innerText = (currentCart.price * currentCart.quantity).toFixed(2);
}

function resetCart() {
    currentCart = { item: null, quantity: 1, price: 0, restaurantId: null };
    cartItemName.innerText = 'None';
    cartQty.innerText = '1';
    cartTotal.innerText = '0.00';
}

// -------------------------------------------------------------------------
// Order Pipelines & Log Console updates
// -------------------------------------------------------------------------
function updatePipelines() {
    const orders = stateData.orders || {};
    const oKeys = Object.keys(orders);
    
    // Separate into statuses
    const groups = { PENDING: [], PREPARING: [], OUT_FOR_DELIVERY: [], DELIVERED: [] };
    let activeCount = 0;
    
    oKeys.forEach(oid => {
        const o = orders[oid];
        if (groups[o.status] !== undefined) {
            groups[o.status].push(o);
        }
        if (o.status !== 'DELIVERED') {
            activeCount++;
        }
    });

    activeOrdersBadge.innerText = `${activeCount} Active`;

    const populatePipe = (container, list) => {
        container.innerHTML = '';
        if (list.length === 0) {
            container.innerHTML = '<span style="font-size:0.6rem; color:var(--text-inactive); text-align:center; display:block; margin-top:20px;">Empty</span>';
            return;
        }
        list.slice().reverse().forEach(o => {
            const card = document.createElement('div');
            card.className = 'pipe-card';
            card.innerHTML = `
                <div class="pipe-card-header">
                    <span>${o.order_id}</span>
                    <span>&#8377;${o.total_amount.toFixed(0)}</span>
                </div>
                <div class="pipe-card-body">${o.quantity}x ${o.item_name}</div>
                <div class="pipe-card-footer">${o.restaurant_name} &rarr; ${o.user_name}</div>
            `;
            container.appendChild(card);
        });
    };

    populatePipe(pipePending, groups.PENDING);
    populatePipe(pipePreparing, groups.PREPARING);
    populatePipe(pipeDelivery, groups.OUT_FOR_DELIVERY);
    populatePipe(pipeDelivered, groups.DELIVERED);
}

function updateLogConsole() {
    const logs = stateData.recent_events || [];
    
    // We only want to append new logs to console stream to avoid clearing scroll state
    const currentLinesCount = logConsoleStream.childElementCount;
    if (logs.length === 0) return;
    
    // If list was cleared, reset console
    if (currentLinesCount > logs.length) {
        logConsoleStream.innerHTML = '';
    }
    
    // Append any events not yet in the stream
    const itemsToAdd = logs.slice(logConsoleStream.childElementCount);
    itemsToAdd.forEach(evt => {
        const line = document.createElement('div');
        line.className = `log-line ${evt.event_type}`;
        
        let payloadStr = '';
        if (evt.event_type === 'USER_MOVE') {
            payloadStr = `${evt.payload.name} updated location to <strong>(${evt.payload.lat.toFixed(4)}, ${evt.payload.lon.toFixed(4)})</strong>`;
        } else if (evt.event_type === 'RECOMMENDATION_MATCHED') {
            payloadStr = `Matched ${evt.payload.matches_count} shops for user ${evt.payload.user_id.substring(0,6)}... Best: <strong>${evt.payload.closest_restaurant}</strong> (${evt.payload.closest_distance_km}km)`;
        } else if (evt.event_type === 'NEW_ORDER') {
            payloadStr = `Order ${evt.payload.order_id} placed: <strong>${evt.payload.quantity}x ${evt.payload.item_name}</strong> at ${evt.payload.restaurant_name}`;
        } else if (evt.event_type === 'ORDER_STATUS_UPDATE') {
            payloadStr = `Order ${evt.payload.order_id} status updated to <span class="accent-color">${evt.payload.status}</span>`;
        } else {
            payloadStr = JSON.stringify(evt.payload);
        }

        const tStr = evt.timestamp.split('T')[1].substring(0,8);
        line.innerHTML = `
            <span class="timestamp">[${tStr}]</span>
            <strong>${evt.event_type}</strong>: ${payloadStr}
        `;
        logConsoleStream.appendChild(line);
        logConsoleStream.scrollTop = logConsoleStream.scrollHeight; // Auto-scroll
    });
}

// -------------------------------------------------------------------------
// Live Canvas Maps drawing and projections
// -------------------------------------------------------------------------
function computeBounds() {
    const userKeys = Object.keys(stateData.users);
    const restKeys = Object.keys(stateData.restaurants);
    
    if (userKeys.length === 0 && restKeys.length === 0) return;
    
    // Compute current scale constraints
    const updateBounds = (lat, lon) => {
        if (lat < bounds.minLat) bounds.minLat = lat;
        if (lat > bounds.maxLat) bounds.maxLat = lat;
        if (lon < bounds.minLon) bounds.minLon = lon;
        if (lon > bounds.maxLon) bounds.maxLon = lon;
    };
    
    userKeys.forEach(uid => updateBounds(stateData.users[uid].lat, stateData.users[uid].lon));
    restKeys.forEach(rid => updateBounds(stateData.restaurants[rid].lat, stateData.restaurants[rid].lon));
}

function projectCoordinates(lat, lon) {
    const padding = 50;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    
    // Expand boundary margins slightly to keep points inside
    const latSpan = (bounds.maxLat - bounds.minLat) || 0.002;
    const lonSpan = (bounds.maxLon - bounds.minLon) || 0.002;
    
    const minLat = bounds.minLat - latSpan * 0.1;
    const maxLat = bounds.maxLat + latSpan * 0.1;
    const minLon = bounds.minLon - lonSpan * 0.1;
    const maxLon = bounds.maxLon + lonSpan * 0.1;
    
    const x = padding + ((lon - minLon) / ((maxLon - minLon) || 0.001)) * w;
    const y = padding + (1.0 - (lat - minLat) / ((maxLat - minLat) || 0.001)) * h;
    return { x, y };
}

function deprojectCoordinates(x, y) {
    // Reverse coordinates mapping from screen x/y to lat/lon
    const padding = 50;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    
    const latSpan = (bounds.maxLat - bounds.minLat) || 0.002;
    const lonSpan = (bounds.maxLon - bounds.minLon) || 0.002;
    
    const minLat = bounds.minLat - latSpan * 0.1;
    const maxLat = bounds.maxLat + latSpan * 0.1;
    const minLon = bounds.minLon - lonSpan * 0.1;
    const maxLon = bounds.maxLon + lonSpan * 0.1;
    
    const lon = minLon + ((x - padding) / w) * (maxLon - minLon);
    const lat = minLat + (1.0 - (y - padding) / h) * (maxLat - minLat);
    return { lat, lon };
}

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    computeBounds();
    
    const userKeys = Object.keys(stateData.users);
    const restKeys = Object.keys(stateData.restaurants);
    
    if (userKeys.length === 0 && restKeys.length === 0) return;
    
    // 1. Draw grid coordinate lines
    ctx.strokeStyle = '#181b28';
    ctx.lineWidth = 1;
    const gridDivisions = 5;
    for (let i = 0; i <= gridDivisions; i++) {
        const gridX = 50 + (i / gridDivisions) * (canvas.width - 100);
        ctx.beginPath(); ctx.moveTo(gridX, 50); ctx.lineTo(gridX, canvas.height - 50); ctx.stroke();
        
        const gridY = 50 + (i / gridDivisions) * (canvas.height - 100);
        ctx.beginPath(); ctx.moveTo(50, gridY); ctx.lineTo(canvas.width - 50, gridY); ctx.stroke();
    }
    
    // Collect coordinates projection map for hover checks
    const currentPins = [];
    
    // 2. Draw closest matched lines
    ctx.lineWidth = 1.5;
    userKeys.forEach(uid => {
        const u = stateData.users[uid];
        const recs = stateData.recommendations[uid] || [];
        const uPos = projectCoordinates(u.lat, u.lon);
        
        if (recs.length > 0) {
            // Draw link to nearest matched restaurant
            const nearest = recs[0];
            const rPos = projectCoordinates(nearest.lat, nearest.lon);
            
            // Highlight link if user is selected
            if (uid === selectedUserId) {
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
                ctx.setLineDash([5, 3]);
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.setLineDash([]);
            }
            ctx.beginPath(); ctx.moveTo(uPos.x, uPos.y); ctx.lineTo(rPos.x, rPos.y); ctx.stroke();
        }
    });
    ctx.setLineDash([]); // Reset dash state

    // 3. Draw Restaurant Pins
    restKeys.forEach(rid => {
        const rest = stateData.restaurants[rid];
        const pos = projectCoordinates(rest.lat, rest.lon);
        const radius = 8;
        
        // Push to hover target tracker
        currentPins.push({ type: 'restaurant', id: rid, x: pos.x, y: pos.y, radius, name: rest.name, cuisine: rest.cuisine, rating: rest.rating });
        
        // Glow effect
        ctx.fillStyle = 'rgba(255, 63, 108, 0.15)';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 14, 0, Math.PI*2); ctx.fill();
        
        ctx.fillStyle = '#ff3f6c';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.fill();
        
        // Center white core
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2); ctx.fill();
        
        // Highlight active browsing menu restaurant
        if (activeMenuRestaurantId === rid) {
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 11, 0, Math.PI*2); ctx.stroke();
        }
        
        // Text labels
        ctx.fillStyle = 'var(--text-main)';
        ctx.font = '500 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(rest.name, pos.x, pos.y - 12);
    });
    
    // 4. Draw User Pins
    userKeys.forEach(uid => {
        const u = stateData.users[uid];
        const pos = projectCoordinates(u.lat, u.lon);
        const radius = 6;
        const isSelected = (uid === selectedUserId);
        
        currentPins.push({ type: 'user', id: uid, x: pos.x, y: pos.y, radius, name: u.name, cuisine: u.preference_cuisine, data: u });
        
        // Draw matched discovery radius circle (5km) if user is selected
        if (isSelected) {
            const rangePos = projectCoordinates(u.lat + 0.005, u.lon); // Approx 5km offset
            const visualRadius = Math.abs(pos.y - rangePos.y);
            
            ctx.strokeStyle = 'rgba(0, 230, 118, 0.15)';
            ctx.fillStyle = 'rgba(0, 230, 118, 0.015)';
            ctx.beginPath(); ctx.arc(pos.x, pos.y, visualRadius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            // Outer selector ring
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 11, 0, Math.PI*2); ctx.stroke();
        }
        
        ctx.fillStyle = isSelected ? '#00e5ff' : '#00e676';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.fill();
        
        // Text labels
        ctx.fillStyle = isSelected ? '#00e5ff' : 'var(--text-muted)';
        ctx.font = isSelected ? '600 11px Outfit' : '400 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(u.name, pos.x, pos.y + 16);
    });
    
    // Save current projected points globally for mouse movements
    window.projectedPins = currentPins;
}

function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    let found = null;
    if (window.projectedPins) {
        for (let pin of window.projectedPins) {
            const dist = Math.hypot(x - pin.x, y - pin.y);
            if (dist <= pin.radius + 6) {
                found = pin;
                break;
            }
        }
    }
    
    if (found) {
        hoveredElement = found;
        canvas.style.cursor = 'pointer';
        
        // Show tooltip overlay
        mapTooltip.style.opacity = '1';
        mapTooltip.style.left = `${e.clientX - rect.left + 15}px`;
        mapTooltip.style.top = `${e.clientY - rect.top + 15}px`;
        
        if (found.type === 'restaurant') {
            mapTooltip.innerHTML = `
                <div style="font-weight:700; color:var(--accent);">🍔 ${found.name}</div>
                <div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">Cuisine: ${found.cuisine} • Rating: ⭐${found.rating}</div>
            `;
        } else {
            mapTooltip.innerHTML = `
                <div style="font-weight:700; color:var(--accent-success);">👤 ${found.name}</div>
                <div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">Preference: ${found.cuisine}</div>
                <div style="font-size:0.6rem; color:var(--text-inactive);">Click to select • Double click to drag</div>
            `;
        }
    } else {
        hoveredElement = null;
        canvas.style.cursor = 'crosshair';
        mapTooltip.style.opacity = '0';
    }
}

function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 1. Check if user clicked on an existing user to select them
    if (hoveredElement) {
        if (hoveredElement.type === 'user') {
            selectedUserId = hoveredElement.id;
            customerSelector.value = selectedUserId;
            customerSelector.dispatchEvent(new Event('change'));
            return;
        } else if (hoveredElement.type === 'restaurant') {
            openRestaurantMenu(hoveredElement.id, hoveredElement.name);
            return;
        }
    }
    
    // 2. Click in empty space moves the active user to clicked coordinates immediately
    if (selectedUserId) {
        const coords = deprojectCoordinates(x, y);
        postRequest('/api/users/location', {
            user_id: selectedUserId,
            lat: coords.lat,
            lon: coords.lon
        });
    }
}

// Start execution
window.onload = init;
