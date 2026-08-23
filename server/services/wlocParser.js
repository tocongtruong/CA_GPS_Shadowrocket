/**
 * Bộ giải mã nhị phân Apple WLOC Protobuf nâng cao
 * - Bóc tách tọa độ Wi-Fi / Cell Tower
 * - Lọc bỏ nhiễu Outliers (> 5km so với cụm trung tâm)
 * - Tính trọng tâm dựa trên độ chính xác (Accuracy-Weighted Centroid)
 */

function readVarint(buffer, offset) {
  let res = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    res += (byte & 0x7f) * Math.pow(2, shift);
    shift += 7;
    if ((byte & 0x80) === 0) break;
    if (bytesRead > 10) break;
  }

  return { value: res, bytesRead };
}

function toCoordinate(val) {
  if (val > 0x7fffffffffff) {
    val = val - 0x10000000000000000;
  }
  return val / 1e7;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function extractCoordinatesFromProtobuf(buffer) {
  const extractedPoints = [];
  let offset = 0;

  const markerIndex = buffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]));
  if (markerIndex !== -1 && markerIndex + 8 < buffer.length) {
    offset = markerIndex + 8;
  }

  function parseMessage(msgBuf, depth = 0) {
    if (depth > 5) return;
    let pos = 0;
    let currentLat = null;
    let currentLng = null;
    let currentAcc = 0;

    while (pos < msgBuf.length) {
      const keyVar = readVarint(msgBuf, pos);
      pos += keyVar.bytesRead;
      if (keyVar.bytesRead === 0) break;

      const tag = keyVar.value >> 3;
      const wireType = keyVar.value & 0x07;

      if (wireType === 0) {
        // Varint
        const valVar = readVarint(msgBuf, pos);
        pos += valVar.bytesRead;
        if (tag === 1) {
          const lat = toCoordinate(valVar.value);
          if (lat >= -90 && lat <= 90 && lat !== 0) currentLat = lat;
        } else if (tag === 2) {
          const lng = toCoordinate(valVar.value);
          if (lng >= -180 && lng <= 180 && lng !== 0) currentLng = lng;
        } else if (tag === 3) {
          currentAcc = valVar.value;
        }
      } else if (wireType === 1) {
        pos += 8;
      } else if (wireType === 2) {
        const lenVar = readVarint(msgBuf, pos);
        pos += lenVar.bytesRead;
        const length = lenVar.value;

        if (pos + length <= msgBuf.length) {
          const subBuf = msgBuf.slice(pos, pos + length);
          parseMessage(subBuf, depth + 1);
          pos += length;
        } else {
          break;
        }
      } else if (wireType === 5) {
        pos += 4;
      } else {
        break;
      }

      if (currentLat !== null && currentLng !== null) {
        extractedPoints.push({
          lat: currentLat,
          lng: currentLng,
          accuracy: currentAcc > 0 ? currentAcc : 40
        });
        currentLat = null;
        currentLng = null;
        currentAcc = 0;
      }
    }
  }

  try {
    parseMessage(buffer.slice(offset));
  } catch (e) {
    // Fail-safe
  }

  return extractedPoints;
}

/**
 * Phân tích payload nhị phân Base64 của WLOC với bộ lọc Outlier & Trọng số Accuracy
 */
function parseWlocPayload(base64Payload) {
  if (!base64Payload || typeof base64Payload !== 'string') return null;

  try {
    const buffer = Buffer.from(base64Payload, 'base64');
    if (buffer.length < 16) return null;

    const rawPoints = extractCoordinatesFromProtobuf(buffer);
    if (!rawPoints || rawPoints.length === 0) return null;

    // 1. Sắp xếp theo độ chính xác tăng dần (bán kính nhỏ = tin cậy cao)
    rawPoints.sort((a, b) => a.accuracy - b.accuracy);

    // 2. Lấy điểm tham chiếu ban đầu từ điểm có accuracy tốt nhất
    const bestPoint = rawPoints[0];

    // 3. Lọc bỏ các điểm ngoại lai (Outliers) cách điểm tốt nhất > 5km (ví dụ router bị di dời địa lý)
    const validPoints = rawPoints.filter(p => {
      const dist = calculateDistanceKm(bestPoint.lat, bestPoint.lng, p.lat, p.lng);
      return dist <= 5.0; // Tối đa 5km quanh cụm
    });

    if (validPoints.length === 0) return null;

    // 4. Tính toán trọng tâm có trọng số (Accuracy-Weighted Centroid)
    // Trọng số w = 1 / (accuracy + 5)^2
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let bestAcc = validPoints[0].accuracy;

    for (const p of validPoints) {
      const w = 1 / Math.pow(p.accuracy + 5, 2);
      totalWeight += w;
      weightedLat += p.lat * w;
      weightedLng += p.lng * w;
      if (p.accuracy < bestAcc) bestAcc = p.accuracy;
    }

    const finalLat = Number((weightedLat / totalWeight).toFixed(6));
    const finalLng = Number((weightedLng / totalWeight).toFixed(6));
    const finalAccuracy = Math.max(15, Math.round(bestAcc));

    return {
      latitude: finalLat,
      longitude: finalLng,
      accuracy: finalAccuracy,
      point_count: validPoints.length,
      outliers_filtered: rawPoints.length - validPoints.length
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  parseWlocPayload,
  extractCoordinatesFromProtobuf
};
