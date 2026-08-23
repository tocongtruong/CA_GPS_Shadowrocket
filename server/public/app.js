/**
 * iOS Location Lab - Web Dashboard & Database Management (Production Version)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements - Tabs
  const tabBtnMap = document.getElementById('tabBtnMap');
  const tabBtnDb = document.getElementById('tabBtnDb');
  const viewMap = document.getElementById('viewMap');
  const viewDb = document.getElementById('viewDb');

  // Elements - Header & Map
  const deviceSelect = document.getElementById('deviceSelect');
  const datePicker = document.getElementById('datePicker');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnCenterCurrent = document.getElementById('btnCenterCurrent');
  const btnFitRoute = document.getElementById('btnFitRoute');

  const curLat = document.getElementById('curLat');
  const curLng = document.getElementById('curLng');
  const curAccuracy = document.getElementById('curAccuracy');
  const curSource = document.getElementById('curSource');
  const lastUpdated = document.getElementById('lastUpdated');
  const btnGmaps = document.getElementById('btnGmaps');

  const statDistance = document.getElementById('statDistance');
  const statPoints = document.getElementById('statPoints');
  const statStops = document.getElementById('statStops');
  const statDuration = document.getElementById('statDuration');
  const routeDateLabel = document.getElementById('routeDateLabel');

  const timelineSlider = document.getElementById('timelineSlider');
  const playbackTimeDisplay = document.getElementById('playbackTimeDisplay');
  const btnPlay = document.getElementById('btnPlay');
  const playSpeed = document.getElementById('playSpeed');

  const sysTotalRecords = document.getElementById('sysTotalRecords');
  const sysDbSize = document.getElementById('sysDbSize');
  const sysOldest = document.getElementById('sysOldest');

  // Elements - Database CRUD
  const dbFilterDevice = document.getElementById('dbFilterDevice');
  const dbTableBody = document.getElementById('dbTableBody');
  const dbShowingCount = document.getElementById('dbShowingCount');
  const dbTotalCount = document.getElementById('dbTotalCount');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageIndicator = document.getElementById('pageIndicator');
  const btnAddLocation = document.getElementById('btnAddLocation');
  const btnClearDb = document.getElementById('btnClearDb');

  // Elements - Modal
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const locationForm = document.getElementById('locationForm');
  const formId = document.getElementById('formId');
  const formDeviceId = document.getElementById('formDeviceId');
  const formLat = document.getElementById('formLat');
  const formLng = document.getElementById('formLng');
  const formAccuracy = document.getElementById('formAccuracy');
  const formSource = document.getElementById('formSource');

  // State
  let currentDeviceId = 'iphone_01';
  let routePoints = [];
  let isPlaying = false;
  let playInterval = null;
  let playIndex = 0;

  let dbPage = 0;
  const dbLimit = 25;
  let dbTotal = 0;

  // Set default date
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  datePicker.value = todayStr;

  // -------------------------------------------------------------
  // 1. KHỞI TẠO BẢN ĐỒ LEAFLET
  // -------------------------------------------------------------
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView([21.0285, 105.8542], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  const routeLayer = L.featureGroup().addTo(map);
  const stopLayer = L.featureGroup().addTo(map);
  let currentMarker = null;
  let playbackMarker = null;
  let accuracyCircle = null;

  // -------------------------------------------------------------
  // 2. HELPER FUNCTIONS
  // -------------------------------------------------------------
  function formatVietnamTime(timestamp) {
    if (!timestamp) return '--:--:--';
    return new Date(timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  }

  function timeAgo(timestamp) {
    if (!timestamp) return '--';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s trước`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m trước`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h trước`;
  }

  function getSourceBadge(source) {
    if (!source) return '<span class="badge-source">Chờ tín hiệu</span>';
    if (source.includes('shortcut') || source.includes('manual')) {
      return '<span class="badge-source" style="background:rgba(16,185,129,0.2); color:#10b981;">🎯 GPS Chuẩn</span>';
    }
    if (source.includes('resolved')) {
      return '<span class="badge-source" style="background:rgba(6,182,212,0.2); color:#06b6d4;">📡 WLOC Giải Mã</span>';
    }
    return '<span class="badge-source" style="background:rgba(59,130,246,0.2); color:#3b82f6;">🟢 Tín Hiệu Mạng</span>';
  }

  // -------------------------------------------------------------
  // 3. TAB SWITCHING
  // -------------------------------------------------------------
  tabBtnMap.addEventListener('click', () => {
    tabBtnMap.classList.add('active');
    tabBtnDb.classList.remove('active');
    viewMap.classList.add('active');
    viewDb.classList.remove('active');
    setTimeout(() => map.invalidateSize(), 200);
  });

  tabBtnDb.addEventListener('click', () => {
    tabBtnDb.classList.add('active');
    tabBtnMap.classList.remove('active');
    viewDb.classList.add('active');
    viewMap.classList.remove('active');
    loadDatabaseTable();
  });

  // -------------------------------------------------------------
  // 4. TẢI DANH SÁCH THIẾT BỊ
  // -------------------------------------------------------------
  async function loadDevices() {
    try {
      const res = await fetch('/api/devices');
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        deviceSelect.innerHTML = '';
        dbFilterDevice.innerHTML = '<option value="all">Tất cả thiết bị</option>';

        json.data.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.device_id;
          opt.textContent = `📱 ${d.name || d.device_id} (${d.total_pings} tín hiệu)`;
          if (d.device_id === currentDeviceId) opt.selected = true;
          deviceSelect.appendChild(opt);

          const opt2 = document.createElement('option');
          opt2.value = d.device_id;
          opt2.textContent = d.device_id;
          dbFilterDevice.appendChild(opt2);
        });

        const exists = json.data.some(d => d.device_id === currentDeviceId);
        if (!exists) {
          currentDeviceId = json.data[0].device_id;
          deviceSelect.value = currentDeviceId;
        }
      }
    } catch (e) {
      console.warn('Lỗi tải thiết bị:', e);
    }
  }

  // -------------------------------------------------------------
  // 5. CẬP NHẬT VỊ TRÍ MỚI NHẤT TRÊN MAP
  // -------------------------------------------------------------
  async function updateLatestLocation() {
    try {
      const res = await fetch(`/api/location/latest?device_id=${encodeURIComponent(currentDeviceId)}`);
      const json = await res.json();

      if (json.success && json.data) {
        const d = json.data;
        curSource.innerHTML = getSourceBadge(d.source);
        lastUpdated.textContent = `${formatVietnamTime(d.event_time)} (${timeAgo(d.event_time)})`;

        if (d.latitude !== null && d.longitude !== null) {
          curLat.textContent = d.latitude.toFixed(6);
          curLng.textContent = d.longitude.toFixed(6);
          curAccuracy.textContent = `~${Math.round(d.accuracy || 30)} m`;

          btnGmaps.href = `https://maps.google.com/?q=${d.latitude},${d.longitude}`;
          btnGmaps.style.display = 'block';

          const latlng = [d.latitude, d.longitude];

          if (!currentMarker) {
            const pulseIcon = L.divIcon({
              className: 'current-marker-pulse',
              iconSize: [18, 18],
              iconAnchor: [9, 9]
            });
            currentMarker = L.marker(latlng, { icon: pulseIcon }).addTo(map);
            currentMarker.bindPopup(`<b>📍 Vị trí hiện tại</b><br>Thiết bị: ${currentDeviceId}<br>Thời gian: ${formatVietnamTime(d.event_time)}`);

            accuracyCircle = L.circle(latlng, {
              radius: d.accuracy || 30,
              color: '#06b6d4',
              fillColor: '#06b6d4',
              fillOpacity: 0.15,
              weight: 1
            }).addTo(map);

            map.setView(latlng, 15);
          } else {
            currentMarker.setLatLng(latlng);
            if (accuracyCircle) {
              accuracyCircle.setLatLng(latlng);
              accuracyCircle.setRadius(d.accuracy || 30);
            }
          }
        } else {
          curLat.textContent = 'Chưa có tọa độ';
          curLng.textContent = 'Chưa có tọa độ';
          curAccuracy.textContent = 'Đang chờ gói WLOC';
          btnGmaps.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('Lỗi latest location:', e);
    }
  }

  // -------------------------------------------------------------
  // 6. TẢI VÀ VẼ LỘ TRÌNH THEO NGÀY
  // -------------------------------------------------------------
  async function loadRoute() {
    const selectedDate = datePicker.value;
    routeDateLabel.textContent = selectedDate === todayStr ? 'Hôm nay' : selectedDate;

    try {
      const res = await fetch(`/api/location/route?device_id=${encodeURIComponent(currentDeviceId)}&date=${selectedDate}`);
      const json = await res.json();

      routeLayer.clearLayers();
      stopLayer.clearLayers();
      routePoints = [];
      stopPlayback();

      if (json.success && json.data.points && json.data.points.length > 0) {
        const data = json.data;
        routePoints = data.points;
        statPoints.textContent = data.total_valid_points;
        statDistance.textContent = `${data.total_distance_km} km`;

        const startTime = routePoints[0].event_time;
        const endTime = routePoints[routePoints.length - 1].event_time;
        const durationMin = Math.round((endTime - startTime) / 60000);
        const durHours = Math.floor(durationMin / 60);
        const durMins = durationMin % 60;
        statDuration.textContent = `${durHours}h ${durMins}m`;

        const latlngs = routePoints.map(p => [p.latitude, p.longitude]);

        const polyline = L.polyline(latlngs, {
          color: '#06b6d4',
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1
        }).addTo(routeLayer);

        if (data.stop_points && data.stop_points.length > 0) {
          statStops.textContent = data.stop_points.length;
          data.stop_points.forEach((sp, idx) => {
            const stopIcon = L.divIcon({
              className: 'stop-marker-pin',
              html: `<span>${idx + 1}</span>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11]
            });

            L.marker([sp.latitude, sp.longitude], { icon: stopIcon })
              .bindPopup(`<b>🛑 Điểm dừng #${idx + 1}</b><br>Từ: ${formatVietnamTime(sp.start_time)}<br>Đến: ${formatVietnamTime(sp.end_time)}<br>Thời lượng: ~<b>${sp.duration_minutes} phút</b>`)
              .addTo(stopLayer);
          });
        } else {
          statStops.textContent = '0';
        }

        timelineSlider.disabled = false;
        timelineSlider.max = routePoints.length - 1;
        timelineSlider.value = 0;
        btnPlay.disabled = false;
        updatePlaybackPosition(0);

        map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
      } else {
        statDistance.textContent = '0.0 km';
        statPoints.textContent = '0';
        statStops.textContent = '0';
        statDuration.textContent = '--:--';
        timelineSlider.disabled = true;
        btnPlay.disabled = true;
        playbackTimeDisplay.textContent = '00:00:00';
      }
    } catch (e) {
      console.warn('Lỗi tải lộ trình:', e);
    }
  }

  function updatePlaybackPosition(index) {
    if (!routePoints || routePoints.length === 0 || index >= routePoints.length) return;
    const p = routePoints[index];
    playIndex = index;
    timelineSlider.value = index;
    playbackTimeDisplay.textContent = formatVietnamTime(p.event_time);

    const latlng = [p.latitude, p.longitude];
    if (!playbackMarker) {
      const carIcon = L.divIcon({
        className: 'playback-car-marker',
        html: '<div style="background:#f59e0b; width:16px; height:16px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px #f59e0b;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      playbackMarker = L.marker(latlng, { icon: carIcon }).addTo(map);
    } else {
      playbackMarker.setLatLng(latlng);
    }
  }

  function startPlayback() {
    if (routePoints.length === 0) return;
    isPlaying = true;
    btnPlay.textContent = '⏸ Tạm dừng';
    const speedMultiplier = parseInt(playSpeed.value, 10) || 3;
    const intervalMs = Math.max(100, 1000 / speedMultiplier);

    playInterval = setInterval(() => {
      if (playIndex >= routePoints.length - 1) {
        stopPlayback();
        return;
      }
      playIndex++;
      updatePlaybackPosition(playIndex);
    }, intervalMs);
  }

  function stopPlayback() {
    isPlaying = false;
    btnPlay.textContent = '▶ Phát';
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }

  btnPlay.addEventListener('click', () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (playIndex >= routePoints.length - 1) playIndex = 0;
      startPlayback();
    }
  });

  timelineSlider.addEventListener('input', (e) => {
    stopPlayback();
    updatePlaybackPosition(parseInt(e.target.value, 10));
  });

  // -------------------------------------------------------------
  // 7. QUẢN LÝ DATABASE CRUD
  // -------------------------------------------------------------
  async function loadDatabaseTable() {
    const filter = dbFilterDevice.value;
    const offset = dbPage * dbLimit;

    try {
      const res = await fetch(`/api/admin/locations?limit=${dbLimit}&offset=${offset}&device_id=${encodeURIComponent(filter)}`);
      const json = await res.json();

      if (json.success) {
        dbTotal = json.total;
        dbShowingCount.textContent = json.rows.length;
        dbTotalCount.textContent = json.total;

        const maxPage = Math.max(1, Math.ceil(json.total / dbLimit));
        pageIndicator.textContent = `Trang ${dbPage + 1} / ${maxPage}`;
        btnPrevPage.disabled = dbPage === 0;
        btnNextPage.disabled = dbPage >= maxPage - 1;

        if (json.rows.length === 0) {
          dbTableBody.innerHTML = `<tr><td colspan="8" class="text-center">Không có bản ghi nào trong database.</td></tr>`;
          return;
        }

        dbTableBody.innerHTML = '';
        json.rows.forEach(r => {
          const tr = document.createElement('tr');
          const latText = r.latitude !== null ? r.latitude.toFixed(6) : '<span style="color:#64748b">null</span>';
          const lngText = r.longitude !== null ? r.longitude.toFixed(6) : '<span style="color:#64748b">null</span>';
          const accText = r.accuracy ? `~${Math.round(r.accuracy)}m` : '--';

          tr.innerHTML = `
            <td><strong>#${r.id}</strong></td>
            <td><code>${r.device_id}</code></td>
            <td>${latText}</td>
            <td>${lngText}</td>
            <td>${accText}</td>
            <td>${getSourceBadge(r.source)}</td>
            <td><small>${formatVietnamTime(r.event_time)}</small></td>
            <td class="action-cell">
              <button class="btn btn-sm btn-action" onclick="openEditModal(${r.id}, '${r.device_id}', ${r.latitude}, ${r.longitude}, ${r.accuracy}, '${r.source}')">✏️ Sửa</button>
              <button class="btn btn-sm btn-danger" onclick="deleteLocationRow(${r.id})">🗑️ Xóa</button>
            </td>
          `;
          dbTableBody.appendChild(tr);
        });
      }
    } catch (e) {
      console.warn('Lỗi tải bảng database:', e);
    }
  }

  btnPrevPage.addEventListener('click', () => {
    if (dbPage > 0) {
      dbPage--;
      loadDatabaseTable();
    }
  });

  btnNextPage.addEventListener('click', () => {
    dbPage++;
    loadDatabaseTable();
  });

  dbFilterDevice.addEventListener('change', () => {
    dbPage = 0;
    loadDatabaseTable();
  });

  // Modal Handlers
  function openAddModal() {
    modalTitle.textContent = '➕ Thêm Vị Trí Mới';
    formId.value = '';
    formDeviceId.value = currentDeviceId;
    formLat.value = '';
    formLng.value = '';
    formAccuracy.value = '15';
    formSource.value = 'manual_admin';
    modalBackdrop.classList.add('show');
  }

  window.openEditModal = function(id, deviceId, lat, lng, acc, src) {
    modalTitle.textContent = `✏️ Sửa Bản Ghi #${id}`;
    formId.value = id;
    formDeviceId.value = deviceId;
    formLat.value = lat !== null ? lat : '';
    formLng.value = lng !== null ? lng : '';
    formAccuracy.value = acc || '15';
    formSource.value = src || 'manual_admin';
    modalBackdrop.classList.add('show');
  };

  function closeModal() {
    modalBackdrop.classList.remove('show');
  }

  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);
  btnAddLocation.addEventListener('click', openAddModal);

  locationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = formId.value;
    const payload = {
      device_id: formDeviceId.value.trim(),
      latitude: parseFloat(formLat.value),
      longitude: parseFloat(formLng.value),
      accuracy: parseFloat(formAccuracy.value) || 10,
      source: formSource.value
    };

    try {
      let res;
      if (id) {
        // Edit
        res = await fetch(`/api/admin/locations/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Add
        res = await fetch('/api/admin/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const json = await res.json();
      if (json.success) {
        closeModal();
        loadDatabaseTable();
        loadDevices();
        updateLatestLocation();
        loadRoute();
      } else {
        alert('Lỗi: ' + json.error);
      }
    } catch (err) {
      alert('Lỗi kết nối server: ' + err.message);
    }
  });

  window.deleteLocationRow = async function(id) {
    if (!confirm(`Bạn có chắc chắn muốn xóa bản ghi #${id} không?`)) return;

    try {
      const res = await fetch(`/api/admin/locations/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        loadDatabaseTable();
        loadDevices();
        updateLatestLocation();
        loadRoute();
      }
    } catch (e) {
      alert('Lỗi xóa: ' + e.message);
    }
  };

  btnClearDb.addEventListener('click', async () => {
    if (!confirm('⚠️ CẢNH BÁO: Thao tác này sẽ xóa toàn bộ các bản ghi trong database! Bạn có chắc chắn không?')) return;

    try {
      const res = await fetch('/api/admin/locations/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'all' })
      });
      const json = await res.json();
      if (json.success) {
        alert('Đã dọn dẹp sạch toàn bộ database.');
        loadDatabaseTable();
        loadDevices();
        updateLatestLocation();
        loadRoute();
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    }
  });

  // -------------------------------------------------------------
  // 8. THỐNG KÊ HỆ THỐNG
  // -------------------------------------------------------------
  async function loadSystemStats() {
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.success && json.data) {
        const s = json.data;
        sysTotalRecords.textContent = s.total_locations.toLocaleString();
        sysDbSize.textContent = `${s.db_size_mb} MB`;
        sysOldest.textContent = s.oldest_record ? new Date(s.oldest_record).toLocaleDateString('vi-VN') : '--';
      }
    } catch (e) {
      console.warn('Lỗi tải stats:', e);
    }
  }

  // -------------------------------------------------------------
  // 9. EVENTS
  // -------------------------------------------------------------
  deviceSelect.addEventListener('change', () => {
    currentDeviceId = deviceSelect.value;
    updateLatestLocation();
    loadRoute();
  });

  datePicker.addEventListener('change', loadRoute);

  btnRefresh.addEventListener('click', () => {
    loadDevices().then(() => {
      updateLatestLocation();
      loadRoute();
      loadSystemStats();
      if (viewDb.classList.contains('active')) {
        loadDatabaseTable();
      }
    });
  });

  btnCenterCurrent.addEventListener('click', () => {
    if (currentMarker) {
      map.setView(currentMarker.getLatLng(), 16);
      currentMarker.openPopup();
    }
  });

  btnFitRoute.addEventListener('click', () => {
    if (routeLayer.getLayers().length > 0) {
      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    }
  });

  loadDevices().then(() => {
    updateLatestLocation();
    loadRoute();
  });
  loadSystemStats();

  setInterval(loadDevices, 10000);
  setInterval(updateLatestLocation, 4000);
  setInterval(loadSystemStats, 30000);
});
