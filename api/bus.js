// /api/bus?arsId=12345
// 서울시 정류소별 도착예정정보 API(XML 전용)를 서버에서 호출해
// 1) CORS 문제를 없애고 2) 인증키를 클라이언트에 노출하지 않고 3) XML을 JSON으로 변환해줍니다.

function getTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function parseItems(xml) {
  const blocks = xml.match(/<itemList>[\s\S]*?<\/itemList>/gi) || [];
  return blocks.map((b) => ({
    rtNm: getTag(b, 'rtNm'),
    arsId: getTag(b, 'arsId'),
    adirection: getTag(b, 'adirection'),
    arrmsg1: getTag(b, 'arrmsg1'),
    arrmsg2: getTag(b, 'arrmsg2'),
  }));
}

async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { arsId } = req.query;
  const key = process.env.BUS_SERVICE_KEY;

  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'BUS_SERVICE_KEY 환경변수가 설정되지 않았습니다. Vercel Settings > Environment Variables 에서 추가해주세요.',
    });
  }
  if (!arsId) {
    return res.status(400).json({ ok: false, error: 'arsId 쿼리 파라미터가 필요합니다.' });
  }

  const trimmedKey = key.trim();
  // 서울시 API가 게이트웨이를 변경한 것으로 보여 파라미터명을 대소문자 둘 다 포함해서 전송 (안전하게)
  const url = `http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid?serviceKey=${trimmedKey}&ServiceKey=${trimmedKey}&arsId=${encodeURIComponent(
    arsId
  )}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const upstream = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: '*/*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const xml = await upstream.text();

    if (req.query.debug) {
      return res.status(200).json({
        ok: true,
        debug: true,
        status: upstream.status,
        raw: xml.slice(0, 3000),
        keyCheck: {
          length: key.length,
          trimmedLength: trimmedKey.length,
          hasWhitespace: key !== trimmedKey,
          preview: key.slice(0, 6) + '...' + key.slice(-4),
        },
      });
    }

    // 서울시 API가 JSON 형식의 에러를 줄 수도 있어서(게이트웨이 변경 대응) 우선 확인
    const trimmedXml = xml.trim();
    if (trimmedXml.startsWith('{')) {
      try {
        const asJson = JSON.parse(trimmedXml);
        if (asJson.error || asJson.message) {
          return res.status(502).json({ ok: false, error: asJson.message || asJson.error || 'API 오류', raw: xml.slice(0, 500) });
        }
      } catch (e) {
        // JSON 파싱 실패 시 무시하고 아래 XML 파싱 로직으로 계속 진행
      }
    }

    const headerCd = getTag(xml, 'headerCd');
    const headerMsg = getTag(xml, 'headerMsg');

    if (headerCd && headerCd !== '0') {
      return res.status(502).json({ ok: false, error: headerMsg || '버스 API 오류', code: headerCd, raw: xml.slice(0, 500) });
    }

    const items = parseItems(xml);
    return res.status(200).json({ ok: true, items, rawLen: xml.length, headerCd });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '버스 API 호출 실패', detail: String(e) });
  }
}
