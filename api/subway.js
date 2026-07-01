// /api/subway?station=금호&line=1003
// 서울 열린데이터광장의 지하철 실시간 도착정보 API를 대신 호출합니다.
// 주의: 이 API는 data.go.kr 키가 아니라 data.seoul.go.kr에서 발급받는
// "실시간 지하철 인증키"가 별도로 필요합니다. (환경변수: SUBWAY_SERVICE_KEY)

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(url, options, attempts = [9000, 9000, 9000]) {
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await fetchWithTimeout(url, options, attempts[i]);
    } catch (e) {
      lastErr = e;
      if (i < attempts.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { station, line, lines } = req.query;
  const key = process.env.SUBWAY_SERVICE_KEY;

  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'SUBWAY_SERVICE_KEY 환경변수가 설정되지 않았습니다. data.seoul.go.kr에서 "실시간 지하철 인증키"를 발급받아 Vercel에 등록해주세요.',
    });
  }
  if (!station) {
    return res.status(400).json({ ok: false, error: 'station 쿼리 파라미터(역명)가 필요합니다.' });
  }

  const trimmedKey = key.trim();
  // 0/10 은 조회 시작~끝 인덱스 (최대 10건 요청)
  const url = `http://swopenAPI.seoul.go.kr/api/subway/${trimmedKey}/json/realtimeStationArrival/0/10/${encodeURIComponent(
    station
  )}`;

  try {
    const upstream = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: '*/*',
      },
    });

    const text = await upstream.text();

    if (req.query.debug) {
      return res.status(200).json({ ok: true, debug: true, status: upstream.status, raw: text.slice(0, 3000) });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: '지하철 API가 JSON이 아닌 응답을 반환했습니다 (인증키를 확인해주세요).',
        raw: text.slice(0, 500),
      });
    }

    const err = data.errorMessage;
    if (err && err.code && err.code !== 'INFO-000') {
      return res.status(502).json({ ok: false, error: err.message || '지하철 API 오류', code: err.code });
    }

    let items = data.realtimeArrivalList || [];
    const lineList = (lines ? lines.split(',') : (line ? [line] : [])).filter(Boolean);
    if (lineList.length) {
      items = items.filter((it) => lineList.includes(it.subwayId));
    }

    const simplified = items.map((it) => ({
      subwayId: it.subwayId,
      updnLine: it.updnLine, // 상행/하행 (호선에 따라 내선/외선 등으로 표기되기도 함)
      trainLineNm: it.trainLineNm, // 예: "대화행 - 오금 방면"
      arvlMsg2: it.arvlMsg2, // 예: "3분 후 (강남 도착)"
      arvlMsg3: it.arvlMsg3,
      statnNm: it.statnNm,
      recptnDt: it.recptnDt,
    }));

    return res.status(200).json({ ok: true, items: simplified });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '지하철 API 호출 실패', detail: String(e) });
  }
}
