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

  // 주의: 이 API는 파라미터명 대소문자를 구분합니다 (ServiceKey, 소문자 serviceKey 아님)
  const url = `http://ws.bus.go.kr/api/rest/stationinfo/getStationByUidItem?ServiceKey=${key}&arsId=${encodeURIComponent(
    arsId
  )}`;

  try {
    const upstream = await fetch(url);
    const xml = await upstream.text();

    const headerCd = getTag(xml, 'headerCd');
    const headerMsg = getTag(xml, 'headerMsg');

    if (headerCd && headerCd !== '0') {
      return res.status(502).json({ ok: false, error: headerMsg || '버스 API 오류', code: headerCd });
    }

    const items = parseItems(xml);
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '버스 API 호출 실패', detail: String(e) });
  }
}
