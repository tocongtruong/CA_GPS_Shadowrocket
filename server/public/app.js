document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    tabBtnMap: document.getElementById('tabBtnMap'),
    tabBtnDb: document.getElementById('tabBtnDb'),
    viewMap: document.getElementById('viewMap'),
    viewDb: document.getElementById('viewDb'),
    deviceSelect: document.getElementById('deviceSelect'),
    datePicker: document.getElementById('datePicker'),
    btnRefresh: document.getElementById('btnRefresh'),
    liveStatus: document.getElementById('liveStatus'),
    liveStatusText: document.getElementById('liveStatusText'),
    locationHint: document.getElementById('locationHint'),
    curLat: document.getElementById('curLat'),
    curLng: document.getElementById('curLng'),
    curAccuracy: document.getElementById('curAccuracy'),
    curSource: document.getElementById('curSource'),
    lastUpdated: document.getElementById('lastUpdated'),
    btnGmaps: document.getElementById('btnGmaps'),
    statDistance: document.getElementById('statDistance'),
    statPoints: document.getElementById('statPoints'),
    statStops: document.getElementById('statStops'),
    statDuration: document.getElementById('statDuration'),
    routeDateLabel: document.getElementById('routeDateLabel'),
    emptyRouteMessage: document.getElementById('emptyRouteMessage'),
    timelineSlider: document.getElementById('timelineSlider'),
    playbackTimeDisplay: document.getElementById('playbackTimeDisplay'),
    btnPlay: document.getElementById('btnPlay'),
    playSpeed: document.getElementById('playSpeed'),
    btnCenterCurrent: document.getElementById('btnCenterCurrent'),
    btnFitRoute: document.getElementById('btnFitRoute'),
    sysTotalRecords: document.getElementById('sysTotalRecords'),
    sysDbSize: document.getElementById('sysDbSize'),
    sysOldest: document.getElementById('sysOldest'),
    dbFilterDevice: document.getElementById('dbFilterDevice'),
    dbTableBody: document.getElementById('dbTableBody'),
    dbShowingCount: document.getElementById('dbShowingCount'),
    dbTotalCount: document.getElementById('dbTotalCount'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    pageIndicator: document.getElementById('pageIndicator'),
    btnAddLocation: document.getElementById('btnAddLocation'),
    btnClearDb: document.getElementById('btnClearDb'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalCancelBtn: document.getElementById('modalCancelBtn'),
    locationForm: document.getElementById('locationForm'),
    formId: document.getElementById('formId'),
    formDeviceId: document.getElementById('formDeviceId'),
    formLat: document.getElementById('formLat'),
    formLng: document.getElementById('formLng'),
    formAccuracy: document.getElementById('formAccuracy'),
    formSource: document.getElementById('formSource'),
    appNotice: document.getElementById('appNotice')
  };

  const state = {
    currentDeviceId: 'iphone_01',
    routePoints: [],
    isPlaying: false,
    playTimer: null,
    playIndex: 0,
    dbPage: 0,
    dbLimit: 25,
    dbTotal: 0,
    deviceSignature: '',
    previousModalFocus: null,
    noticeTimer: null
  };

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  elements.datePicker.value = today;
  elements.datePicker.max = today;

  const css = getComputedStyle(document.documentElement);
  const mapColors = {
    accent: css.getPropertyValue('--accent').trim(),
    warning: css.getPropertyValue('--warning').trim(),
    text: css.getPropertyValue('--text-primary').trim()
  };

  let map = null;
  let routeLayer = null;
  let stopLayer = null;
  let currentMarker = null;
  let playbackMarker = null;
  let accuracyCircle = null;

  function showNotice(message, type = 'neutral', timeout = 4500) {
    clearTimeout(state.noticeTimer);
    elements.appNotice.textContent = message;
    elements.appNotice.className = `app-notice notice-${type}`;
    elements.appNotice.hidden = false;
    state.noticeTimer = setTimeout(() => {
      elements.appNotice.hidden = true;
    }, timeout);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function initMap() {
    if (!window.L) {
      setConnectionState('error', 'Bản đồ lỗi');
      showNotice('Không tải được thư viện bản đồ. Kiểm tra kết nối Internet hoặc CDN.', 'error', 10000);
      return;
    }

    map = L.map('map', {
      zoomControl: true,
      attributionControl: false
    }).setView([21.0285, 105.8542], 13);

    const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    });
    tiles.on('tileerror', () => {
      showNotice('Không tải được một số ô bản đồ. Dữ liệu tọa độ vẫn được giữ nguyên.', 'error');
    });
    tiles.addTo(map);

    routeLayer = L.featureGroup().addTo(map);
    stopLayer = L.featureGroup().addTo(map);
  }

  function setConnectionState(kind, label) {
    elements.liveStatus.className = `connection-status status-${kind}`;
    elements.liveStatusText.textContent = label;
  }

  function setLocationMessage(kind, message) {
    elements.locationHint.className = `state-message state-${kind}`;
    elements.locationHint.textContent = message;
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 9000);
    const requestOptions = {
      ...options,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    };
    delete requestOptions.timeout;

    try {
      const response = await fetch(url, requestOptions);
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json')
        ? await response.json()
        : { success: false, error: `Máy chủ trả về HTTP ${response.status}.` };

      if (!response.ok || body.success === false) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Máy chủ phản hồi quá chậm.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function formatVietnamTime(timestamp) {
    if (!timestamp) return 'Chưa có';
    return new Date(timestamp).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'medium'
    });
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'chưa có thời gian';
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 60) return `${seconds} giây trước`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
  }

  function hasCoordinates(record) {
    if (!record
      || record.latitude === null || record.latitude === undefined || record.latitude === ''
      || record.longitude === null || record.longitude === undefined || record.longitude === '') {
      return false;
    }

    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90
      && longitude >= -180 && longitude <= 180;
  }

  function createSourceBadge(source, resolved) {
    const badge = document.createElement('span');
    badge.className = 'source-badge source-neutral';
    const normalized = String(source || '');

    if (normalized.includes('module_probe')) {
      badge.className = 'source-badge source-wloc';
      badge.textContent = 'Module đã kết nối';
    } else if (normalized.includes('shortcut') || normalized.includes('manual')) {
      badge.className = 'source-badge source-gps';
      badge.textContent = normalized.includes('manual_admin') ? 'Nhập thủ công' : 'GPS chủ động';
    } else if (normalized.includes('resolved') || resolved) {
      badge.className = 'source-badge source-wloc';
      badge.textContent = 'WLOC đã giải mã';
    } else if (normalized.includes('wloc')) {
      badge.className = 'source-badge source-warning';
      badge.textContent = 'WLOC thiếu tọa độ';
    } else if (normalized) {
      badge.textContent = normalized;
    } else {
      badge.textContent = 'Đang chờ';
    }
    return badge;
  }

  function setSource(source, resolved) {
    elements.curSource.replaceChildren(createSourceBadge(source, resolved));
  }

  function clearCurrentMarker() {
    if (!map) return;
    if (currentMarker) map.removeLayer(currentMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    currentMarker = null;
    accuracyCircle = null;
    elements.btnCenterCurrent.disabled = true;
  }

  function renderCurrentMarker(record) {
    if (!map || !hasCoordinates(record)) return;
    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    const accuracy = Math.max(1, Number(record.accuracy) || 30);
    const latLng = [latitude, longitude];

    if (!currentMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="current-marker-pulse"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      currentMarker = L.marker(latLng, { icon }).addTo(map);
      accuracyCircle = L.circle(latLng, {
        radius: accuracy,
        color: mapColors.accent,
        fillColor: mapColors.accent,
        fillOpacity: 0.12,
        weight: 1
      }).addTo(map);
      map.setView(latLng, 15);
    } else {
      currentMarker.setLatLng(latLng);
      accuracyCircle.setLatLng(latLng);
      accuracyCircle.setRadius(accuracy);
    }

    currentMarker.bindPopup(
      `<strong>Vị trí mới nhất</strong><br>Thiết bị: ${escapeHtml(state.currentDeviceId)}`
      + `<br>Thời gian: ${escapeHtml(formatVietnamTime(record.event_time))}`
    );
    elements.btnCenterCurrent.disabled = false;
  }

  function resetLocationPanel(message = 'Chưa có bản ghi cho thiết bị này.') {
    elements.curLat.textContent = 'Chưa có';
    elements.curLng.textContent = 'Chưa có';
    elements.curAccuracy.textContent = 'Chưa xác định';
    elements.lastUpdated.textContent = 'Chưa có dữ liệu';
    elements.btnGmaps.hidden = true;
    setSource('', false);
    setLocationMessage('neutral', message);
    clearCurrentMarker();
  }

  async function loadDevices() {
    const body = await fetchJson('/api/devices');
    const devices = Array.isArray(body.data) ? body.data : [];
    const previousFilter = elements.dbFilterDevice.value || 'all';
    const signature = JSON.stringify(devices.map(device => [
      device.device_id,
      device.name,
      device.total_pings,
      device.last_seen
    ]));

    if (signature === state.deviceSignature) return devices;
    state.deviceSignature = signature;

    elements.deviceSelect.replaceChildren();
    elements.dbFilterDevice.replaceChildren(new Option('Tất cả thiết bị', 'all'));

    if (devices.length === 0) {
      elements.deviceSelect.append(new Option('iphone_01, chưa có tín hiệu', 'iphone_01'));
      state.currentDeviceId = 'iphone_01';
      return devices;
    }

    for (const device of devices) {
      const label = `${device.name || device.device_id} · ${device.total_pings} tín hiệu`;
      elements.deviceSelect.append(new Option(label, device.device_id));
      elements.dbFilterDevice.append(new Option(device.device_id, device.device_id));
    }

    if (!devices.some(device => device.device_id === state.currentDeviceId)) {
      state.currentDeviceId = devices[0].device_id;
    }
    elements.deviceSelect.value = state.currentDeviceId;

    const validFilters = Array.from(elements.dbFilterDevice.options).map(option => option.value);
    elements.dbFilterDevice.value = validFilters.includes(previousFilter) ? previousFilter : 'all';
    return devices;
  }

  async function updateLatestLocation() {
    try {
      const body = await fetchJson(`/api/location/latest?device_id=${encodeURIComponent(state.currentDeviceId)}`);
      const record = body.data;
      if (!record) {
        resetLocationPanel();
        setConnectionState('warning', 'Chưa có tín hiệu');
        return;
      }

      const signal = record.latest_signal || record;
      const coordinateAvailable = hasCoordinates(record);
      const signalHasCoordinates = hasCoordinates(signal);
      const signalAge = Date.now() - Number(signal.event_time || 0);
      const coordinateAge = coordinateAvailable ? Date.now() - Number(record.event_time || 0) : Infinity;

      if (coordinateAvailable) {
        const latitude = Number(record.latitude);
        const longitude = Number(record.longitude);
        elements.curLat.textContent = latitude.toFixed(6);
        elements.curLng.textContent = longitude.toFixed(6);
        elements.curAccuracy.textContent = `Khoảng ${Math.round(Number(record.accuracy) || 30)} m`;
        elements.lastUpdated.textContent = `${formatVietnamTime(record.event_time)} · ${timeAgo(record.event_time)}`;
        elements.btnGmaps.href = `https://maps.google.com/?q=${latitude},${longitude}`;
        elements.btnGmaps.hidden = false;
        setSource(record.source, true);
        renderCurrentMarker(record);

        if (!signalHasCoordinates && Number(signal.event_time) > Number(record.event_time)) {
          setConnectionState('warning', 'Thiếu tọa độ mới');
          setLocationMessage(
            'warning',
            `Server vừa nhận ${signal.source || 'tín hiệu WLOC'} nhưng payload chưa có tọa độ. Đang hiển thị vị trí cũ.`
          );
        } else if (coordinateAge <= 2 * 60 * 1000) {
          setConnectionState('live', 'Vị trí mới');
          setLocationMessage('success', 'Tọa độ hợp lệ vừa được cập nhật từ thiết bị.');
        } else if (coordinateAge <= 15 * 60 * 1000) {
          setConnectionState('warning', 'Dữ liệu chậm');
          setLocationMessage('warning', `Vị trí gần nhất được cập nhật ${timeAgo(record.event_time)}.`);
        } else {
          setConnectionState('warning', 'Dữ liệu cũ');
          setLocationMessage('warning', `Chưa có tọa độ mới trong ${timeAgo(record.event_time)}.`);
        }
      } else {
        elements.curLat.textContent = 'Chưa có';
        elements.curLng.textContent = 'Chưa có';
        elements.curAccuracy.textContent = 'Chưa xác định';
        elements.lastUpdated.textContent = `${formatVietnamTime(signal.event_time)} · ${timeAgo(signal.event_time)}`;
        elements.btnGmaps.hidden = true;
        setSource(signal.source, false);
        clearCurrentMarker();

        if (String(signal.source).includes('module_probe')) {
          setConnectionState('warning', 'Module đã kết nối');
          setLocationMessage(
            'warning',
            'Module đã gọi được collector. Hãy mở Apple Maps để chờ request/response WLOC chứa tọa độ.'
          );
        } else if (String(signal.source).includes('wloc')) {
          setConnectionState(signalAge < 5 * 60 * 1000 ? 'warning' : 'error', 'WLOC thiếu tọa độ');
          setLocationMessage(
            'warning',
            'Server nhận được request hoặc response WLOC, nhưng binary body chưa tạo ra tọa độ. Hãy nhập lại module riêng tư và xem log Shadowrocket.'
          );
        } else {
          setConnectionState('warning', 'Chưa có tọa độ');
          setLocationMessage('warning', 'Bản ghi gần nhất không chứa latitude và longitude hợp lệ.');
        }
      }
    } catch (error) {
      setConnectionState('error', 'Mất kết nối');
      setLocationMessage('error', `Không tải được dữ liệu vị trí: ${error.message}`);
      showNotice(`Lỗi tải vị trí: ${error.message}`, 'error');
    }
  }

  function resetRouteView() {
    state.routePoints = [];
    state.playIndex = 0;
    stopPlayback(true);
    if (routeLayer) routeLayer.clearLayers();
    if (stopLayer) stopLayer.clearLayers();
    elements.statDistance.textContent = '0,0 km';
    elements.statPoints.textContent = '0';
    elements.statStops.textContent = '0';
    elements.statDuration.textContent = 'Chưa có';
    elements.timelineSlider.min = '0';
    elements.timelineSlider.max = '0';
    elements.timelineSlider.value = '0';
    elements.timelineSlider.disabled = true;
    elements.btnPlay.disabled = true;
    elements.btnFitRoute.disabled = true;
    elements.playbackTimeDisplay.textContent = 'Chưa có';
    elements.emptyRouteMessage.hidden = false;
  }

  async function loadRoute() {
    const selectedDate = elements.datePicker.value || today;
    elements.routeDateLabel.textContent = selectedDate === today ? 'hôm nay' : selectedDate;
    resetRouteView();

    try {
      const body = await fetchJson(
        `/api/location/route?device_id=${encodeURIComponent(state.currentDeviceId)}&date=${encodeURIComponent(selectedDate)}`
      );
      const route = body.data;
      if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

      state.routePoints = route.points.filter(hasCoordinates);
      if (state.routePoints.length === 0) return;

      elements.emptyRouteMessage.hidden = true;
      elements.statDistance.textContent = `${Number(route.total_distance_km || 0).toLocaleString('vi-VN')} km`;
      elements.statPoints.textContent = String(route.total_valid_points || state.routePoints.length);
      elements.statStops.textContent = String(Array.isArray(route.stop_points) ? route.stop_points.length : 0);

      const startTime = Number(state.routePoints[0].event_time);
      const endTime = Number(state.routePoints[state.routePoints.length - 1].event_time);
      const durationMinutes = Math.max(0, Math.round((endTime - startTime) / 60000));
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      elements.statDuration.textContent = hours > 0 ? `${hours} giờ ${minutes} phút` : `${minutes} phút`;

      const latLngs = state.routePoints.map(point => [Number(point.latitude), Number(point.longitude)]);
      if (map && routeLayer) {
        L.polyline(latLngs, {
          color: mapColors.accent,
          weight: 4,
          opacity: 0.88,
          smoothFactor: 1
        }).addTo(routeLayer);
      }

      if (map && stopLayer && Array.isArray(route.stop_points)) {
        route.stop_points.forEach((stop, index) => {
          const icon = L.divIcon({
            className: '',
            html: `<div class="stop-marker-pin">${index + 1}</div>`,
            iconSize: [23, 23],
            iconAnchor: [11, 11]
          });
          L.marker([Number(stop.latitude), Number(stop.longitude)], { icon })
            .bindPopup(
              `<strong>Điểm dừng ${index + 1}</strong>`
              + `<br>Từ: ${escapeHtml(formatVietnamTime(stop.start_time))}`
              + `<br>Đến: ${escapeHtml(formatVietnamTime(stop.end_time))}`
              + `<br>Khoảng ${Number(stop.duration_minutes)} phút`
            )
            .addTo(stopLayer);
        });
      }

      elements.timelineSlider.max = String(state.routePoints.length - 1);
      elements.timelineSlider.disabled = false;
      elements.btnPlay.disabled = false;
      elements.btnFitRoute.disabled = !map;
      updatePlaybackPosition(0);

      if (map) {
        if (latLngs.length === 1) map.setView(latLngs[0], 16);
        else map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
      }
    } catch (error) {
      elements.emptyRouteMessage.hidden = false;
      elements.emptyRouteMessage.textContent = `Không tải được lộ trình: ${error.message}`;
      showNotice(`Lỗi tải lộ trình: ${error.message}`, 'error');
    }
  }

  function updatePlaybackPosition(index) {
    if (!state.routePoints.length) return;
    const safeIndex = Math.min(Math.max(Number(index) || 0, 0), state.routePoints.length - 1);
    const point = state.routePoints[safeIndex];
    state.playIndex = safeIndex;
    elements.timelineSlider.value = String(safeIndex);
    elements.playbackTimeDisplay.textContent = formatVietnamTime(point.event_time);

    if (!map || !routeLayer) return;
    const latLng = [Number(point.latitude), Number(point.longitude)];
    if (!playbackMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="playback-marker"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      playbackMarker = L.marker(latLng, { icon }).addTo(routeLayer);
    } else {
      playbackMarker.setLatLng(latLng);
    }
  }

  function startPlayback() {
    if (!state.routePoints.length) return;
    state.isPlaying = true;
    elements.btnPlay.textContent = 'Tạm dừng';
    const speed = Math.max(1, Number(elements.playSpeed.value) || 3);
    state.playTimer = setInterval(() => {
      if (state.playIndex >= state.routePoints.length - 1) {
        stopPlayback(false);
        return;
      }
      updatePlaybackPosition(state.playIndex + 1);
    }, Math.max(125, 1000 / speed));
  }

  function stopPlayback(removeMarker = false) {
    state.isPlaying = false;
    elements.btnPlay.textContent = 'Phát';
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    if (removeMarker && playbackMarker && routeLayer) {
      routeLayer.removeLayer(playbackMarker);
      playbackMarker = null;
    }
  }

  function switchTab(tab) {
    const mapActive = tab === 'map';
    elements.tabBtnMap.classList.toggle('active', mapActive);
    elements.tabBtnDb.classList.toggle('active', !mapActive);
    elements.tabBtnMap.setAttribute('aria-selected', String(mapActive));
    elements.tabBtnDb.setAttribute('aria-selected', String(!mapActive));
    elements.viewMap.classList.toggle('active', mapActive);
    elements.viewDb.classList.toggle('active', !mapActive);

    if (mapActive) {
      setTimeout(() => map && map.invalidateSize(), 100);
    } else {
      loadDatabaseTable();
    }
  }

  function createTableCell(content, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (content instanceof Node) cell.append(content);
    else cell.textContent = String(content);
    return cell;
  }

  function renderDatabaseRows(rows) {
    elements.dbTableBody.replaceChildren();
    if (!rows.length) {
      const row = document.createElement('tr');
      row.append(createTableCell('Không có bản ghi phù hợp.', 'text-center'));
      row.firstChild.colSpan = 8;
      elements.dbTableBody.append(row);
      return;
    }

    for (const record of rows) {
      const row = document.createElement('tr');
      const latitude = record.latitude === null ? null : Number(record.latitude);
      const longitude = record.longitude === null ? null : Number(record.longitude);
      row.append(createTableCell(`#${record.id}`));
      row.append(createTableCell(record.device_id));
      row.append(createTableCell(latitude === null ? 'Không có' : latitude.toFixed(6), latitude === null ? 'table-muted' : ''));
      row.append(createTableCell(longitude === null ? 'Không có' : longitude.toFixed(6), longitude === null ? 'table-muted' : ''));
      row.append(createTableCell(Number(record.accuracy) > 0 ? `${Math.round(Number(record.accuracy))} m` : 'Chưa có'));
      row.append(createTableCell(createSourceBadge(record.source, String(record.source).includes('resolved'))));
      row.append(createTableCell(formatVietnamTime(record.event_time)));

      const actions = document.createElement('div');
      actions.className = 'action-cell';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-secondary btn-sm';
      editButton.textContent = 'Sửa';
      editButton.addEventListener('click', () => openEditModal(record));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-danger btn-sm';
      deleteButton.textContent = 'Xóa';
      deleteButton.addEventListener('click', () => deleteLocation(record.id));
      actions.append(editButton, deleteButton);
      row.append(createTableCell(actions));
      elements.dbTableBody.append(row);
    }
  }

  async function loadDatabaseTable() {
    const filter = elements.dbFilterDevice.value || 'all';
    const offset = state.dbPage * state.dbLimit;
    try {
      const body = await fetchJson(
        `/api/admin/locations?limit=${state.dbLimit}&offset=${offset}&device_id=${encodeURIComponent(filter)}`
      );
      state.dbTotal = Number(body.total) || 0;
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const maxPage = Math.max(1, Math.ceil(state.dbTotal / state.dbLimit));
      if (state.dbPage >= maxPage) {
        state.dbPage = maxPage - 1;
        return loadDatabaseTable();
      }

      elements.dbShowingCount.textContent = String(rows.length);
      elements.dbTotalCount.textContent = state.dbTotal.toLocaleString('vi-VN');
      elements.pageIndicator.textContent = `Trang ${state.dbPage + 1} / ${maxPage}`;
      elements.btnPrevPage.disabled = state.dbPage === 0;
      elements.btnNextPage.disabled = state.dbPage >= maxPage - 1;
      renderDatabaseRows(rows);
    } catch (error) {
      renderDatabaseRows([]);
      showNotice(`Không tải được bảng dữ liệu: ${error.message}`, 'error');
    }
  }

  function openModal() {
    state.previousModalFocus = document.activeElement;
    elements.modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => elements.formDeviceId.focus(), 0);
  }

  function openAddModal() {
    elements.locationForm.reset();
    elements.modalTitle.textContent = 'Thêm vị trí';
    elements.formId.value = '';
    elements.formDeviceId.value = state.currentDeviceId;
    elements.formAccuracy.value = '10';
    elements.formSource.value = 'manual_admin';
    openModal();
  }

  function openEditModal(record) {
    elements.locationForm.reset();
    elements.modalTitle.textContent = `Sửa bản ghi #${record.id}`;
    elements.formId.value = String(record.id);
    elements.formDeviceId.value = record.device_id || '';
    elements.formLat.value = record.latitude ?? '';
    elements.formLng.value = record.longitude ?? '';
    elements.formAccuracy.value = Number(record.accuracy) || 10;
    elements.formSource.value = record.source || 'manual_admin';
    openModal();
  }

  function closeModal() {
    elements.modalBackdrop.hidden = true;
    document.body.style.overflow = '';
    if (state.previousModalFocus instanceof HTMLElement) state.previousModalFocus.focus();
  }

  async function refreshAll({ includeDatabase = false } = {}) {
    elements.btnRefresh.disabled = true;
    try {
      await loadDevices();
      await Promise.all([updateLatestLocation(), loadRoute(), loadSystemStats()]);
      if (includeDatabase || elements.viewDb.classList.contains('active')) await loadDatabaseTable();
    } finally {
      elements.btnRefresh.disabled = false;
    }
  }

  async function saveLocation(event) {
    event.preventDefault();
    const latitude = Number(elements.formLat.value);
    const longitude = Number(elements.formLng.value);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      showNotice('Vĩ độ phải từ -90 đến 90, kinh độ phải từ -180 đến 180.', 'error');
      return;
    }

    const id = elements.formId.value;
    const payload = {
      device_id: elements.formDeviceId.value.trim(),
      latitude,
      longitude,
      accuracy: Math.max(0, Number(elements.formAccuracy.value) || 10),
      source: elements.formSource.value
    };

    try {
      await fetchJson(id ? `/api/admin/locations/${id}` : '/api/admin/locations', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      state.deviceSignature = '';
      await refreshAll({ includeDatabase: true });
      showNotice(id ? 'Đã cập nhật bản ghi.' : 'Đã thêm vị trí.', 'success');
    } catch (error) {
      showNotice(`Không lưu được bản ghi: ${error.message}`, 'error');
    }
  }

  async function deleteLocation(id) {
    if (!window.confirm(`Xóa bản ghi #${id}? Thao tác này không thể hoàn tác.`)) return;
    try {
      await fetchJson(`/api/admin/locations/${id}`, { method: 'DELETE' });
      state.deviceSignature = '';
      await refreshAll({ includeDatabase: true });
      showNotice('Đã xóa bản ghi.', 'success');
    } catch (error) {
      showNotice(`Không xóa được bản ghi: ${error.message}`, 'error');
    }
  }

  async function clearDatabase() {
    if (!window.confirm('Xóa toàn bộ dữ liệu vị trí và thiết bị? Thao tác này không thể hoàn tác.')) return;
    try {
      await fetchJson('/api/admin/locations/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'all' })
      });
      state.dbPage = 0;
      state.deviceSignature = '';
      await refreshAll({ includeDatabase: true });
      showNotice('Đã xóa toàn bộ dữ liệu vị trí.', 'success');
    } catch (error) {
      showNotice(`Không xóa được dữ liệu: ${error.message}`, 'error');
    }
  }

  async function loadSystemStats() {
    try {
      const body = await fetchJson('/api/stats');
      const stats = body.data || {};
      elements.sysTotalRecords.textContent = Number(stats.total_locations || 0).toLocaleString('vi-VN');
      elements.sysDbSize.textContent = `${Number(stats.db_size_mb || 0).toLocaleString('vi-VN')} MB`;
      elements.sysOldest.textContent = stats.oldest_record
        ? new Date(stats.oldest_record).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : 'Chưa có';
    } catch (error) {
      elements.sysTotalRecords.textContent = 'Lỗi';
      elements.sysDbSize.textContent = 'Lỗi';
      elements.sysOldest.textContent = 'Lỗi';
    }
  }

  elements.tabBtnMap.addEventListener('click', () => switchTab('map'));
  elements.tabBtnDb.addEventListener('click', () => switchTab('db'));
  elements.deviceSelect.addEventListener('change', () => {
    state.currentDeviceId = elements.deviceSelect.value;
    updateLatestLocation();
    loadRoute();
  });
  elements.datePicker.addEventListener('change', loadRoute);
  elements.btnRefresh.addEventListener('click', () => refreshAll({ includeDatabase: true }));
  elements.btnPlay.addEventListener('click', () => {
    if (state.isPlaying) stopPlayback(false);
    else {
      if (state.playIndex >= state.routePoints.length - 1) updatePlaybackPosition(0);
      startPlayback();
    }
  });
  elements.timelineSlider.addEventListener('input', event => {
    stopPlayback(false);
    updatePlaybackPosition(event.target.value);
  });
  elements.btnCenterCurrent.addEventListener('click', () => {
    if (map && currentMarker) {
      map.setView(currentMarker.getLatLng(), 16);
      currentMarker.openPopup();
    }
  });
  elements.btnFitRoute.addEventListener('click', () => {
    if (map && routeLayer && routeLayer.getLayers().length > 0) {
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    }
  });
  elements.btnPrevPage.addEventListener('click', () => {
    if (state.dbPage > 0) {
      state.dbPage -= 1;
      loadDatabaseTable();
    }
  });
  elements.btnNextPage.addEventListener('click', () => {
    state.dbPage += 1;
    loadDatabaseTable();
  });
  elements.dbFilterDevice.addEventListener('change', () => {
    state.dbPage = 0;
    loadDatabaseTable();
  });
  elements.btnAddLocation.addEventListener('click', openAddModal);
  elements.btnClearDb.addEventListener('click', clearDatabase);
  elements.modalCloseBtn.addEventListener('click', closeModal);
  elements.modalCancelBtn.addEventListener('click', closeModal);
  elements.modalBackdrop.addEventListener('click', event => {
    if (event.target === elements.modalBackdrop) closeModal();
  });
  elements.locationForm.addEventListener('submit', saveLocation);

  document.addEventListener('keydown', event => {
    if (elements.modalBackdrop.hidden) return;
    if (event.key === 'Escape') {
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(elements.modalBackdrop.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href]'
    ));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('offline', () => {
    setConnectionState('error', 'Thiết bị offline');
    showNotice('Thiết bị hiện không có kết nối mạng.', 'error');
  });
  window.addEventListener('online', () => refreshAll());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAll({ includeDatabase: elements.viewDb.classList.contains('active') });
  });

  initMap();
  refreshAll().catch(error => {
    setConnectionState('error', 'Không khởi tạo được');
    showNotice(`Không khởi tạo được dashboard: ${error.message}`, 'error', 10000);
  });

  setInterval(() => {
    if (!document.hidden) updateLatestLocation();
  }, 5000);
  setInterval(() => {
    if (!document.hidden) {
      loadDevices().catch(() => {});
      loadSystemStats();
    }
  }, 60000);
});
