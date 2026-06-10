// Zomato Operations Central JavaScript Client
let stateData = { users: {}, restaurants: {}, orders: {}, recommendations: {}, recent_events: [] };
let selectedUserId = null;
let activeMenuRestaurantId = null;
let currentCart = { item: null, quantity: 1, price: 0, restaurantId: null };
let systemStartTime = Date.now();

// Interactive Filter & Search states
let activeCuisineFilter = 'all';
let menuItemSearchQuery = '';
let activeLogFilter = 'all';
let serverClientOffset = 0;

// Coordinate interpolation & animations state
let userInterpolations = {};
let activeRiders = {};
let ripples = [];

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
    
    // Start continuous rendering loop for smoother transitions & animations
    requestAnimationFrame(animationLoop);
}

function animationLoop() {
    drawMap();
    requestAnimationFrame(animationLoop);
}

// Adjust canvas resolution dynamically
function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
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
        
        // Calculate server time offset
        if (stateData.timestamp) {
            const serverTime = new Date(stateData.timestamp).getTime();
            serverClientOffset = serverTime - Date.now();
        }
        
        // Synchronize backend config toggles with UI
        if (stateData.config) {
            toggleAutoMove.checked = stateData.config.auto_move_enabled;
            toggleAutoOrders.checked = stateData.config.auto_orders_enabled;
        }
        
        // Track orders in OUT_FOR_DELIVERY state for scooter animation
        const orders = stateData.orders || {};
        Object.keys(orders).forEach(oid => {
            const o = orders[oid];
            if (o.status === 'OUT_FOR_DELIVERY') {
                if (!activeRiders[oid]) {
                    activeRiders[oid] = {
                        orderId: oid,
                        restaurantId: o.restaurant_id,
                        userId: o.user_id,
                        startTime: Date.now(),
                        duration: 4000 // 4 seconds state timer
                    };
                }
            } else if (activeRiders[oid]) {
                // Remove rider and add success ripple if order status changed from delivery
                const rider = activeRiders[oid];
                const rest = stateData.restaurants[rider.restaurantId];
                const u = stateData.users[rider.userId];
                if (rest && u) {
                    const userPos = projectCoordinates(u.lat, u.lon);
                    ripples.push({
                        x: userPos.x,
                        y: userPos.y,
                        radius: 5,
                        maxRadius: 35,
                        alpha: 1.0,
                        speed: 0.8
                    });
                }
                delete activeRiders[oid];
            }
        });
        
        updateSelectors();
        updateCustomerOrderApp();
        updatePipelines();
        updateLogConsole();
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

    // Cuisine Filter Tags click handling
    const cuisineTags = document.querySelectorAll('.cuisine-tag');
    cuisineTags.forEach(tag => {
        tag.addEventListener('click', () => {
            cuisineTags.forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            activeCuisineFilter = tag.dataset.cuisine;
            updateCustomerOrderApp();
        });
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

    // Console logs filter chips handling
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeLogFilter = chip.dataset.filter;
            updateLogConsole();
        });
    });

    // Clear logs
    clearLogsBtn.addEventListener('click', () => {
        logConsoleStream.innerHTML = '';
        stateData.recent_events = [];
    });

    // Copy logs to clipboard
    const copyLogsBtn = document.getElementById('copy-logs-btn');
    if (copyLogsBtn) {
        copyLogsBtn.addEventListener('click', () => {
            const linesText = Array.from(logConsoleStream.querySelectorAll('.log-line'))
                .map(line => line.innerText)
                .join('\n');
            navigator.clipboard.writeText(linesText).then(() => {
                const prevText = copyLogsBtn.innerText;
                copyLogsBtn.innerText = 'Copied!';
                setTimeout(() => { copyLogsBtn.innerText = prevText; }, 1500);
            }).catch(err => {
                console.error("Copy failed: ", err);
            });
        });
    }

    // Menu search filter logic
    const menuSearchInput = document.getElementById('menu-item-search');
    if (menuSearchInput) {
        menuSearchInput.addEventListener('input', (e) => {
            menuItemSearchQuery = e.target.value.toLowerCase();
            if (activeMenuRestaurantId) {
                renderMenu(activeMenuRestaurantId);
            }
        });
    }

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
        userInterpolations = {};
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
    const userKeys = Object.keys(stateData.users);
    
    if (customerSelector.options.length !== userKeys.length + 1) {
        customerSelector.innerHTML = '<option value="" disabled selected>Choose a customer...</option>';
        userKeys.forEach(uid => {
            const u = stateData.users[uid];
            const opt = document.createElement('option');
            opt.value = uid;
            opt.innerText = `${u.name} (Preference: ${u.preference_cuisine})`;
            customerSelector.appendChild(opt);
        });
        
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

    // Filter by active cuisine selection
    let filteredRecs = recs;
    if (activeCuisineFilter !== 'all') {
        filteredRecs = recs.filter(r => r.cuisine === activeCuisineFilter);
    }

    if (filteredRecs.length === 0) {
        appRestaurantList.innerHTML = `<div class="empty-state" style="padding: 1rem;">No ${activeCuisineFilter} restaurants nearby.</div>`;
        return;
    }

    filteredRecs.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        
        let distClass = 'dist-near';
        if (r.distance_km > 3.5) {
            distClass = 'dist-far';
        } else if (r.distance_km > 1.5) {
            distClass = 'dist-medium';
        }
        
        const ratingVal = Math.round(r.rating);
        const starsStr = '★'.repeat(ratingVal) + '☆'.repeat(5 - ratingVal);
        
        item.innerHTML = `
            <div class="item-left">
                <span class="item-name">📍 ${r.name}</span>
                <span class="item-desc">${r.cuisine} Cuisine • <span style="color:var(--accent-warning);">${starsStr}</span> ${r.rating.toFixed(1)}</span>
            </div>
            <div class="item-right">
                <span class="badge-distance ${distClass}">${r.distance_km} km</span>
            </div>
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
    
    // Reset search query
    menuItemSearchQuery = '';
    const menuSearchInput = document.getElementById('menu-item-search');
    if (menuSearchInput) menuSearchInput.value = '';
    
    renderMenu(restId);
}

function renderMenu(restId) {
    const rest = stateData.restaurants[restId];
    if (!rest) return;

    appMenuList.innerHTML = '';
    
    // Filter dishes by search
    const filteredMenu = rest.menu.filter(m => 
        m.name.toLowerCase().includes(menuItemSearchQuery)
    );
    
    if (filteredMenu.length === 0) {
        appMenuList.innerHTML = '<div class="empty-state" style="padding:1rem;">No matching items found.</div>';
        return;
    }

    filteredMenu.forEach(m => {
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

    if (filteredMenu.length > 0 && (!currentCart.item || !filteredMenu.find(m => m.name === currentCart.item.name))) {
        selectCartItem(filteredMenu[0], restId);
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

    const populatePipe = (container, list, hasProgress) => {
        container.innerHTML = '';
        if (list.length === 0) {
            container.innerHTML = '<span style="font-size:0.6rem; color:var(--text-inactive); text-align:center; display:block; margin-top:20px;">Empty</span>';
            return;
        }
        list.slice().reverse().forEach(o => {
            const card = document.createElement('div');
            card.className = 'pipe-card';
            
            let progressBarHtml = '';
            if (hasProgress && o.status !== 'DELIVERED') {
                const orderAgeMs = (Date.now() + serverClientOffset) - new Date(o.updated_at).getTime();
                const pct = Math.min(100, Math.max(0, (orderAgeMs / 4000) * 100));
                progressBarHtml = `
                    <div class="pipe-card-progress-container">
                        <div class="pipe-card-progress-bar" style="width: ${pct}%"></div>
                    </div>
                `;
            }
            
            card.innerHTML = `
                <div class="pipe-card-header">
                    <span>${o.order_id}</span>
                    <span>&#8377;${o.total_amount.toFixed(0)}</span>
                </div>
                <div class="pipe-card-body">${o.quantity}x ${o.item_name}</div>
                <div class="pipe-card-footer">${o.restaurant_name} &rarr; ${o.user_name}</div>
                ${progressBarHtml}
            `;
            container.appendChild(card);
        });
    };

    populatePipe(pipePending, groups.PENDING, true);
    populatePipe(pipePreparing, groups.PREPARING, true);
    populatePipe(pipeDelivery, groups.OUT_FOR_DELIVERY, true);
    populatePipe(pipeDelivered, groups.DELIVERED, false);
}

function updateLogConsole() {
    const logs = stateData.recent_events || [];
    logConsoleStream.innerHTML = '';
    if (logs.length === 0) return;
    
    // Filter events
    const filteredLogs = logs.filter(evt => {
        if (activeLogFilter === 'all') return true;
        return evt.event_type === activeLogFilter;
    });

    filteredLogs.forEach(evt => {
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
    });
    logConsoleStream.scrollTop = logConsoleStream.scrollHeight; // Auto-scroll
}

// -------------------------------------------------------------------------
// Live Canvas Maps drawing and projections
// -------------------------------------------------------------------------
function computeBounds() {
    const userKeys = Object.keys(stateData.users);
    const restKeys = Object.keys(stateData.restaurants);
    
    if (userKeys.length === 0 && restKeys.length === 0) return;
    
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
    
    // -- VECTOR BACKGROUND DRAWINGS --
    // 1. Draw River / Coastline
    ctx.fillStyle = 'rgba(0, 150, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.7);
    ctx.bezierCurveTo(canvas.width * 0.3, canvas.height * 0.75, canvas.width * 0.6, canvas.height * 0.55, canvas.width, canvas.height * 0.6);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fill();

    // 2. Draw Park Area
    ctx.fillStyle = 'rgba(0, 230, 118, 0.03)';
    ctx.beginPath();
    ctx.arc(canvas.width * 0.75, canvas.height * 0.3, 75, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(0, 230, 118, 0.12)';
    ctx.font = 'italic 500 10px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText("Green Zone Park", canvas.width * 0.75, canvas.height * 0.3);

    // 3. Draw Grid lines (Street network layout)
    ctx.strokeStyle = 'rgba(32, 36, 56, 0.4)';
    ctx.lineWidth = 1;
    const gridDivisions = 6;
    for (let i = 0; i <= gridDivisions; i++) {
        const gridX = 50 + (i / gridDivisions) * (canvas.width - 100);
        ctx.beginPath(); ctx.moveTo(gridX, 50); ctx.lineTo(gridX, canvas.height - 50); ctx.stroke();
        
        const gridY = 50 + (i / gridDivisions) * (canvas.height - 100);
        ctx.beginPath(); ctx.moveTo(50, gridY); ctx.lineTo(canvas.width - 50, gridY); ctx.stroke();
    }

    // 4. Draw street names / sector labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.font = '600 9px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText("SECTOR 1 / NORTH-WEST", 20, 30);
    ctx.fillText("SECTOR 2 / EAST PARK", canvas.width - 135, 30);
    ctx.fillText("COASTAL DISTRICT", 20, canvas.height - 20);

    const currentPins = [];
    
    // -- closest match line drawing --
    ctx.lineWidth = 1.5;
    userKeys.forEach(uid => {
        const u = stateData.users[uid];
        
        // Coordinates interpolation logic for users
        if (!userInterpolations[uid]) {
            userInterpolations[uid] = { lat: u.lat, lon: u.lon };
        } else {
            // Smoothly ease user towards target coords
            userInterpolations[uid].lat += (u.lat - userInterpolations[uid].lat) * 0.08;
            userInterpolations[uid].lon += (u.lon - userInterpolations[uid].lon) * 0.08;
        }

        const recs = stateData.recommendations[uid] || [];
        const uPos = projectCoordinates(userInterpolations[uid].lat, userInterpolations[uid].lon);
        
        if (recs.length > 0) {
            const nearest = recs[0];
            const rPos = projectCoordinates(nearest.lat, nearest.lon);
            
            if (uid === selectedUserId) {
                ctx.strokeStyle = 'rgba(0, 245, 255, 0.5)';
                ctx.setLineDash([5, 3]);
                ctx.beginPath(); ctx.moveTo(uPos.x, uPos.y); ctx.lineTo(rPos.x, rPos.y); ctx.stroke();
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
                ctx.setLineDash([]);
                ctx.beginPath(); ctx.moveTo(uPos.x, uPos.y); ctx.lineTo(rPos.x, rPos.y); ctx.stroke();
            }
        }
    });
    ctx.setLineDash([]);

    // 5. Draw Active Riders scooting along routes
    Object.keys(activeRiders).forEach(oid => {
        const rider = activeRiders[oid];
        const rest = stateData.restaurants[rider.restaurantId];
        const u = stateData.users[rider.userId];
        
        if (rest && u) {
            const elapsed = Date.now() - rider.startTime;
            let pct = elapsed / rider.duration;
            if (pct > 1.0) pct = 1.0;
            
            // Interpolate coordinates
            const riderLat = rest.lat + (u.lat - rest.lat) * pct;
            const riderLon = rest.lon + (u.lon - rest.lon) * pct;
            
            const restPos = projectCoordinates(rest.lat, rest.lon);
            const userPos = projectCoordinates(u.lat, u.lon);
            const riderPos = projectCoordinates(riderLat, riderLon);
            
            // Draw background route line (dashed cyan)
            ctx.strokeStyle = 'rgba(0, 245, 255, 0.2)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(restPos.x, restPos.y);
            ctx.lineTo(userPos.x, userPos.y);
            ctx.stroke();
            
            // Draw traveled path line (solid cyan)
            ctx.strokeStyle = 'rgba(0, 245, 255, 0.8)';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(restPos.x, restPos.y);
            ctx.lineTo(riderPos.x, riderPos.y);
            ctx.stroke();
            
            // Draw Rider Scooter Circle
            ctx.fillStyle = '#00f5ff';
            ctx.beginPath();
            ctx.arc(riderPos.x, riderPos.y, 11, 0, Math.PI*2);
            ctx.fill();
            
            ctx.font = '12px Outfit';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🛵', riderPos.x, riderPos.y);
            
            // Active route label
            ctx.fillStyle = 'rgba(0, 245, 255, 0.9)';
            ctx.font = '600 8px JetBrains Mono';
            ctx.fillText(oid, riderPos.x, riderPos.y - 15);
        }
    });

    // 6. Draw success ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i];
        ripple.radius += ripple.speed;
        ripple.alpha -= 0.025;
        
        ctx.strokeStyle = `rgba(0, 230, 118, ${ripple.alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
        
        if (ripple.alpha <= 0) {
            ripples.splice(i, 1);
        }
    }

    // 7. Draw Restaurant Pins
    restKeys.forEach(rid => {
        const rest = stateData.restaurants[rid];
        const pos = projectCoordinates(rest.lat, rest.lon);
        const radius = 8;
        
        currentPins.push({ type: 'restaurant', id: rid, x: pos.x, y: pos.y, radius, name: rest.name, cuisine: rest.cuisine, rating: rest.rating });
        
        const isHovered = (hoveredElement && hoveredElement.type === 'restaurant' && hoveredElement.id === rid);
        const isActiveMenu = (activeMenuRestaurantId === rid);
        
        // Glowing halo effect
        if (isHovered || isActiveMenu) {
            ctx.fillStyle = 'rgba(255, 63, 112, 0.25)';
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 18, 0, Math.PI*2); ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 63, 112, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 14, 0, Math.PI*2); ctx.stroke();
        } else {
            ctx.fillStyle = 'rgba(255, 63, 112, 0.15)';
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 13, 0, Math.PI*2); ctx.fill();
        }
        
        ctx.fillStyle = '#ff3f70';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2); ctx.fill();
        
        ctx.fillStyle = 'var(--text-main)';
        ctx.font = '600 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(rest.name, pos.x, pos.y - 12);
    });
    
    // 8. Draw User Pins
    userKeys.forEach(uid => {
        const u = stateData.users[uid];
        const interp = userInterpolations[uid] || u;
        const pos = projectCoordinates(interp.lat, interp.lon);
        const radius = 6;
        const isSelected = (uid === selectedUserId);
        const isHovered = (hoveredElement && hoveredElement.type === 'user' && hoveredElement.id === uid);
        
        currentPins.push({ type: 'user', id: uid, x: pos.x, y: pos.y, radius, name: u.name, cuisine: u.preference_cuisine, data: u });
        
        if (isSelected) {
            const rangePos = projectCoordinates(interp.lat + 0.005, interp.lon);
            const visualRadius = Math.abs(pos.y - rangePos.y);
            
            ctx.strokeStyle = 'rgba(0, 230, 118, 0.12)';
            ctx.fillStyle = 'rgba(0, 230, 118, 0.01)';
            ctx.beginPath(); ctx.arc(pos.x, pos.y, visualRadius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            const pulseRadius = 11 + Math.sin(Date.now() / 150) * 1.5;
            ctx.strokeStyle = 'rgba(0, 245, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, pulseRadius, 0, Math.PI*2); ctx.stroke();
        } else if (isHovered) {
            ctx.strokeStyle = 'rgba(0, 230, 118, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(pos.x, pos.y, 10, 0, Math.PI*2); ctx.stroke();
        }
        
        ctx.fillStyle = isSelected ? '#00f5ff' : '#00e676';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.fill();
        
        ctx.fillStyle = isSelected ? '#00f5ff' : 'var(--text-muted)';
        ctx.font = isSelected ? '600 11px Outfit' : '400 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(u.name, pos.x, pos.y + 16);
    });
    
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
        
        mapTooltip.style.opacity = '1';
        mapTooltip.style.left = `${e.clientX - rect.left + 15}px`;
        mapTooltip.style.top = `${e.clientY - rect.top + 15}px`;
        
        if (found.type === 'restaurant') {
            const stars = '★'.repeat(Math.round(found.rating)) + '☆'.repeat(5 - Math.round(found.rating));
            mapTooltip.innerHTML = `
                <div style="font-weight:700; color:var(--accent); display:flex; align-items:center; gap:4px;">🍔 ${found.name}</div>
                <div style="font-size:0.7rem; color:var(--text-main); margin-top:3px;">Cuisine: ${found.cuisine}</div>
                <div style="font-size:0.65rem; color:var(--accent-warning); margin-top:2px;">${stars} ${found.rating.toFixed(1)}</div>
            `;
        } else {
            mapTooltip.innerHTML = `
                <div style="font-weight:700; color:var(--accent-success);">👤 ${found.name}</div>
                <div style="font-size:0.7rem; color:var(--text-main); margin-top:3px;">Fav: ${found.cuisine}</div>
                <div style="font-size:0.6rem; color:var(--text-inactive); margin-top:4px;">Click to control user</div>
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
