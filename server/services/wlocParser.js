const zlib = require('zlib');

const COORDINATE_SCALE = 100000000;
const MAX_CLUSTER_DISTANCE_KM = 5;
const APPLE_WLOC_MARKER = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);

function readUInt16BE(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error('uint16 exceeds buffer');
  return (buffer[offset] << 8) | buffer[offset + 1];
}

function readUInt32BE(buffer, offset) {
  if (offset + 4 > buffer.length) throw new Error('uint32 exceeds buffer');
  return buffer.readUInt32BE(offset);
}

function decodeVarint(buffer, offset = 0) {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) return { value, nextOffset: cursor };

    shift += 7n;
    if (shift > 70n) throw new Error('varint is too long');
  }

  throw new Error('unterminated varint');
}

function parseFields(buffer) {
  const fields = [];
  let offset = 0;

  while (offset < buffer.length) {
    const keyStart = offset;
    const key = decodeVarint(buffer, offset);
    offset = key.nextOffset;

    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 0x07n);
    if (fieldNumber <= 0) throw new Error('invalid protobuf field number');

    let valueStart = offset;
    let valueEnd;
    let varintValue = null;

    if (wireType === 0) {
      const decoded = decodeVarint(buffer, offset);
      varintValue = decoded.value;
      valueEnd = decoded.nextOffset;
    } else if (wireType === 1) {
      valueEnd = offset + 8;
    } else if (wireType === 2) {
      const lengthInfo = decodeVarint(buffer, offset);
      const length = Number(lengthInfo.value);
      if (!Number.isSafeInteger(length) || length < 0) throw new Error('invalid protobuf length');
      valueStart = lengthInfo.nextOffset;
      valueEnd = valueStart + length;
    } else if (wireType === 5) {
      valueEnd = offset + 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wireType}`);
    }

    if (valueEnd > buffer.length) throw new Error('protobuf field exceeds buffer');

    fields.push({
      fieldNumber,
      wireType,
      varintValue,
      value: buffer.subarray(valueStart, valueEnd),
      raw: buffer.subarray(keyStart, valueEnd)
    });
    offset = valueEnd;
  }

  return fields;
}

function tryParseFields(buffer) {
  try {
    const fields = parseFields(buffer);
    return fields.length > 0 ? fields : null;
  } catch (error) {
    return null;
  }
}

function findField(fields, fieldNumber, wireType) {
  return fields.find(field => field.fieldNumber === fieldNumber
    && (wireType === undefined || field.wireType === wireType));
}

function parseLocationPayload(buffer, source = 'unknown') {
  const fields = tryParseFields(buffer);
  if (!fields) return null;

  const latitudeField = findField(fields, 1, 0);
  const longitudeField = findField(fields, 2, 0);
  if (!latitudeField || !longitudeField) return null;

  const signedLatitude = BigInt.asIntN(64, latitudeField.varintValue);
  const signedLongitude = BigInt.asIntN(64, longitudeField.varintValue);
  const latitude = Number(signedLatitude) / COORDINATE_SCALE;
  const longitude = Number(signedLongitude) / COORDINATE_SCALE;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180) {
    return null;
  }

  const accuracyField = findField(fields, 3, 0);
  const rawAccuracy = accuracyField ? Number(accuracyField.varintValue) : 40;
  const accuracy = Number.isFinite(rawAccuracy) && rawAccuracy > 0 && rawAccuracy <= 100000
    ? rawAccuracy
    : 40;

  return { lat: latitude, lng: longitude, accuracy, source };
}

function parseArpcPayload(buffer) {
  let offset = 0;
  if (buffer.length < 16) throw new Error('ARPC body is too short');

  offset += 2;
  for (let index = 0; index < 3; index += 1) {
    const stringLength = readUInt16BE(buffer, offset);
    offset += 2 + stringLength;
    if (offset > buffer.length) throw new Error('ARPC string exceeds buffer');
  }

  offset += 4;
  const payloadLength = readUInt32BE(buffer, offset);
  offset += 4;
  if (payloadLength <= 0 || offset + payloadLength > buffer.length) {
    throw new Error('ARPC payload exceeds buffer');
  }

  const payload = buffer.subarray(offset, offset + payloadLength);
  if (!tryParseFields(payload)) throw new Error('ARPC payload is not protobuf');
  return payload;
}

function extractAppleWlocPayload(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 2) throw new Error('WLOC body is empty');

  if (buffer.length >= 10
    && buffer[0] === 0x00
    && buffer[1] === 0x01
    && buffer[6] === 0x00
    && buffer[7] === 0x00) {
    const payloadLength = readUInt16BE(buffer, 8);
    const payloadOffset = 10;
    if (payloadLength > 0 && payloadOffset + payloadLength <= buffer.length) {
      const payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);
      if (tryParseFields(payload)) return { payload, kind: 'prefixed' };
    }
  }

  try {
    return { payload: parseArpcPayload(buffer), kind: 'arpc' };
  } catch (error) {
    // Continue with marker and bare protobuf fallbacks.
  }

  const markerIndex = buffer.indexOf(APPLE_WLOC_MARKER);
  if (markerIndex >= 0) {
    const lengthOffset = markerIndex + APPLE_WLOC_MARKER.length;
    for (const lengthSize of [2, 4]) {
      if (lengthOffset + lengthSize > buffer.length) continue;
      const payloadLength = lengthSize === 2
        ? readUInt16BE(buffer, lengthOffset)
        : readUInt32BE(buffer, lengthOffset);
      const payloadOffset = lengthOffset + lengthSize;
      if (payloadLength <= 0 || payloadOffset + payloadLength > buffer.length) continue;

      const payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);
      if (tryParseFields(payload)) return { payload, kind: `marker-${lengthSize * 8}` };
    }
  }

  if (tryParseFields(buffer)) return { payload: buffer, kind: 'bare' };
  throw new Error('AppleWLoc protobuf envelope was not found');
}

function decompressWlocBody(buffer, contentEncoding = '') {
  const encoding = String(contentEncoding || '').toLowerCase();
  const looksGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  try {
    if (looksGzip || encoding.includes('gzip')) return zlib.gunzipSync(buffer);
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (encoding.includes('deflate')) {
      try {
        return zlib.inflateSync(buffer);
      } catch (error) {
        return zlib.inflateRawSync(buffer);
      }
    }
  } catch (error) {
    // Some proxy runtimes keep the header after already decoding the body.
    return buffer;
  }

  return buffer;
}

function addCandidate(candidates, seen, candidate) {
  if (!candidate) return;
  const key = `${candidate.lat.toFixed(8)}:${candidate.lng.toFixed(8)}:${candidate.accuracy}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(candidate);
}

function extractSchemaLocations(payload) {
  const rootFields = parseFields(payload);
  const candidates = [];
  const seen = new Set();

  for (const field of rootFields) {
    if (field.fieldNumber === 2 && field.wireType === 2) {
      const wifiFields = tryParseFields(field.value);
      if (!wifiFields) continue;
      for (const locationField of wifiFields) {
        if (locationField.fieldNumber === 2 && locationField.wireType === 2) {
          addCandidate(candidates, seen, parseLocationPayload(locationField.value, 'wifi'));
        }
      }
    }

    if ((field.fieldNumber === 22 || field.fieldNumber === 24) && field.wireType === 2) {
      const cellFields = tryParseFields(field.value);
      if (!cellFields) continue;
      for (const locationField of cellFields) {
        if (locationField.fieldNumber === 5 && locationField.wireType === 2) {
          addCandidate(candidates, seen, parseLocationPayload(locationField.value, 'cell'));
        }
      }
    }
  }

  return candidates;
}

function extractRecursiveLocations(payload, maxDepth = 6) {
  const candidates = [];
  const seen = new Set();

  function visit(message, depth) {
    if (depth > maxDepth) return;
    addCandidate(candidates, seen, parseLocationPayload(message, 'fallback'));

    const fields = tryParseFields(message);
    if (!fields) return;
    for (const field of fields) {
      if (field.wireType === 2 && field.value.length > 0) visit(field.value, depth + 1);
    }
  }

  visit(payload, 0);
  return candidates;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const deltaLatitude = (lat2 - lat1) * Math.PI / 180;
  const deltaLongitude = (lon2 - lon1) * Math.PI / 180;
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function resolveLocation(points) {
  if (!points.length) return null;

  let clusterSeed = points[0];
  let largestNeighborCount = -1;
  for (const point of points) {
    const neighborCount = points.filter(candidate => calculateDistanceKm(
      point.lat,
      point.lng,
      candidate.lat,
      candidate.lng
    ) <= MAX_CLUSTER_DISTANCE_KM).length;

    if (neighborCount > largestNeighborCount
      || (neighborCount === largestNeighborCount && point.accuracy < clusterSeed.accuracy)) {
      clusterSeed = point;
      largestNeighborCount = neighborCount;
    }
  }

  const validPoints = points.filter(point => calculateDistanceKm(
    clusterSeed.lat,
    clusterSeed.lng,
    point.lat,
    point.lng
  ) <= MAX_CLUSTER_DISTANCE_KM);

  let totalWeight = 0;
  let weightedLatitude = 0;
  let weightedLongitude = 0;
  for (const point of validPoints) {
    const normalizedAccuracy = Math.max(5, point.accuracy);
    const weight = 1 / (normalizedAccuracy ** 2);
    totalWeight += weight;
    weightedLatitude += point.lat * weight;
    weightedLongitude += point.lng * weight;
  }

  const latitude = weightedLatitude / totalWeight;
  const longitude = weightedLongitude / totalWeight;
  const spreadMeters = validPoints.reduce((total, point) => total + calculateDistanceKm(
    latitude,
    longitude,
    point.lat,
    point.lng
  ) * 1000, 0) / validPoints.length;
  const bestAccuracy = Math.min(...validPoints.map(point => point.accuracy));

  return {
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7)),
    accuracy: Math.max(15, Math.min(5000, Math.round(Math.max(bestAccuracy, spreadMeters)))),
    point_count: validPoints.length,
    raw_point_count: points.length,
    outliers_filtered: points.length - validPoints.length,
    sources: [...new Set(validPoints.map(point => point.source))]
  };
}

function parseWlocPayloadDetailed(base64Payload, options = {}) {
  if (!base64Payload || typeof base64Payload !== 'string') {
    return { location: null, error: 'missing_base64_payload' };
  }

  try {
    const encodedBody = Buffer.from(base64Payload, 'base64');
    if (encodedBody.length < 2) return { location: null, error: 'empty_binary_body' };

    const body = decompressWlocBody(encodedBody, options.contentEncoding);
    if (body.length > 20 * 1024 * 1024) {
      return { location: null, error: 'decompressed_body_too_large' };
    }

    const extraction = extractAppleWlocPayload(body);
    let points = extractSchemaLocations(extraction.payload);
    if (points.length === 0) points = extractRecursiveLocations(extraction.payload);
    const location = resolveLocation(points);

    return {
      location,
      error: location ? null : 'no_coordinate_messages',
      envelope_kind: extraction.kind,
      encoded_body_length: encodedBody.length,
      decoded_body_length: body.length,
      candidate_count: points.length
    };
  } catch (error) {
    return { location: null, error: error.message };
  }
}

function parseWlocPayload(base64Payload, options = {}) {
  return parseWlocPayloadDetailed(base64Payload, options).location;
}

function extractCoordinatesFromProtobuf(buffer) {
  const extraction = extractAppleWlocPayload(Buffer.from(buffer));
  const schemaPoints = extractSchemaLocations(extraction.payload);
  return schemaPoints.length > 0 ? schemaPoints : extractRecursiveLocations(extraction.payload);
}

module.exports = {
  COORDINATE_SCALE,
  decodeVarint,
  parseFields,
  parseLocationPayload,
  extractAppleWlocPayload,
  extractCoordinatesFromProtobuf,
  decompressWlocBody,
  calculateDistanceKm,
  resolveLocation,
  parseWlocPayload,
  parseWlocPayloadDetailed
};
